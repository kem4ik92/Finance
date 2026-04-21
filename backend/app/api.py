from __future__ import annotations

import hashlib
import secrets as _secrets
import uuid
from datetime import date as date_cls
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .advice import compute_advice
from .db import (
    Account,
    Category,
    Debt,
    Goal,
    Transaction,
    Workspace,
    WorkspaceSession,
    db_session,
    new_link_code,
    new_workspace_id,
    now_dt,
)
from .defaults import seed_defaults
from .serialize import (
    account_dto,
    category_dto,
    debt_dto,
    goal_dto,
    transaction_dto,
    workspace_state,
)

router = APIRouter(prefix="/api")


def _load_ws(session: Session, workspace_id: str) -> Workspace:
    ws = session.query(Workspace).filter(Workspace.id == workspace_id).one_or_none()
    if ws is None:
        raise HTTPException(404, "workspace not found")
    return ws


# ---------- PIN helpers & auth ----------

def _hash_pin(pin: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{pin}".encode("utf-8")).hexdigest()


def set_workspace_pin(session: Session, ws: Workspace, pin: Optional[str]) -> None:
    """Set or clear the workspace PIN. Clearing invalidates all sessions."""
    if pin is None or pin == "":
        ws.pin_hash = None
        ws.pin_salt = None
    else:
        salt = _secrets.token_hex(8)
        ws.pin_salt = salt
        ws.pin_hash = _hash_pin(pin, salt)
    # Invalidate any existing web sessions whenever PIN changes.
    session.query(WorkspaceSession).filter(
        WorkspaceSession.workspace_id == ws.id
    ).delete()


def _issue_session(session: Session, workspace_id: str) -> str:
    token = _secrets.token_urlsafe(32)
    session.add(WorkspaceSession(token=token, workspace_id=workspace_id, created_at=now_dt()))
    session.flush()
    return token


def _token_from_header(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return authorization.strip() or None


def require_ws_access(
    workspace_id: str,
    authorization: Optional[str] = Header(None),
) -> None:
    """FastAPI dependency: allow only if the workspace is unprotected OR the
    caller presents a valid Bearer session token for this workspace.
    """
    with db_session() as session:
        ws = _load_ws(session, workspace_id)
        if ws.pin_hash is None:
            return  # unprotected — backward-compatible public access by code
        token = _token_from_header(authorization)
        if not token:
            raise HTTPException(401, "pin required")
        row = (
            session.query(WorkspaceSession)
            .filter(
                WorkspaceSession.token == token,
                WorkspaceSession.workspace_id == workspace_id,
            )
            .one_or_none()
        )
        if row is None:
            raise HTTPException(401, "invalid session")


# ---------- workspace management ----------

@router.post("/workspaces")
def create_workspace(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    name = (payload.get("name") or "").strip() or None
    with db_session() as session:
        ws = Workspace(
            id=new_workspace_id(),
            link_code=new_link_code(),
            name=name,
            created_at=now_dt(),
        )
        session.add(ws)
        session.flush()
        seed_defaults(session, ws)
        session.flush()
        session.refresh(ws)
        return workspace_state(ws)


@router.get("/workspaces/by-code/{code}")
def resolve_code(code: str) -> dict[str, Any]:
    with db_session() as session:
        ws = session.query(Workspace).filter(Workspace.link_code == code.upper()).one_or_none()
        if ws is None:
            raise HTTPException(404, "code not found")
        return {
            "workspaceId": ws.id,
            "linkCode": ws.link_code,
            "name": ws.name,
            "requiresPin": ws.pin_hash is not None,
        }


@router.get("/workspaces/{workspace_id}/meta")
def get_meta(workspace_id: str) -> dict[str, Any]:
    with db_session() as session:
        ws = session.get(Workspace, workspace_id)
        if ws is None:
            raise HTTPException(404, "workspace not found")
        return {
            "workspaceId": ws.id,
            "linkCode": ws.link_code,
            "name": ws.name,
            "requiresPin": ws.pin_hash is not None,
        }


class AuthIn(BaseModel):
    code: str
    pin: Optional[str] = None


@router.post("/workspaces/auth")
def auth_workspace(payload: AuthIn) -> dict[str, Any]:
    """Exchange (code, pin) for a web session token.

    Returns 401 if workspace requires PIN and it is missing/wrong.
    For unprotected workspaces, `pin` is ignored and a token is still issued
    so clients can consistently send Authorization headers if they want to.
    """
    with db_session() as session:
        ws = session.query(Workspace).filter(Workspace.link_code == payload.code.upper()).one_or_none()
        if ws is None:
            raise HTTPException(404, "code not found")
        if ws.pin_hash is not None:
            pin = (payload.pin or "").strip()
            if not pin:
                raise HTTPException(401, "pin required")
            if _hash_pin(pin, ws.pin_salt or "") != ws.pin_hash:
                raise HTTPException(401, "wrong pin")
        token = _issue_session(session, ws.id)
        return {
            "workspaceId": ws.id,
            "linkCode": ws.link_code,
            "name": ws.name,
            "requiresPin": ws.pin_hash is not None,
            "token": token,
        }


@router.post("/workspaces/{workspace_id}/logout")
def logout(
    workspace_id: str,
    authorization: Optional[str] = Header(None),
) -> dict[str, bool]:
    token = _token_from_header(authorization)
    if not token:
        return {"ok": True}
    with db_session() as session:
        session.query(WorkspaceSession).filter(
            WorkspaceSession.token == token,
            WorkspaceSession.workspace_id == workspace_id,
        ).delete()
    return {"ok": True}


@router.get("/workspaces/{workspace_id}/state")
def get_state(
    workspace_id: str,
    _: None = Depends(require_ws_access),
) -> dict[str, Any]:
    with db_session() as session:
        ws = _load_ws(session, workspace_id)
        return workspace_state(ws)


# ---------- accounts ----------

class AccountIn(BaseModel):
    id: Optional[str] = None
    name: str
    type: str = Field(pattern=r"^(cash|card|savings|other)$")
    openingBalance: float = 0.0
    color: str = "#2186ff"
    icon: Optional[str] = None


@router.post("/workspaces/{workspace_id}/accounts")
def create_account(
    workspace_id: str, payload: AccountIn, _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        _load_ws(session, workspace_id)
        a = Account(
            id=payload.id or f"{workspace_id}:acc-{uuid.uuid4().hex[:8]}",
            workspace_id=workspace_id,
            name=payload.name,
            type=payload.type,
            opening_balance=payload.openingBalance,
            color=payload.color,
            icon=payload.icon,
            created_at=now_dt(),
        )
        session.add(a)
        session.flush()
        return account_dto(a)


@router.patch("/workspaces/{workspace_id}/accounts/{account_id}")
def update_account(
    workspace_id: str, account_id: str, payload: dict[str, Any], _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        a = session.query(Account).filter(Account.id == account_id, Account.workspace_id == workspace_id).one_or_none()
        if a is None:
            raise HTTPException(404, "account not found")
        for f_src, f_dst in (("name", "name"), ("type", "type"), ("color", "color"), ("icon", "icon"), ("openingBalance", "opening_balance")):
            if f_src in payload:
                setattr(a, f_dst, payload[f_src])
        session.flush()
        return account_dto(a)


@router.delete("/workspaces/{workspace_id}/accounts/{account_id}")
def delete_account(
    workspace_id: str, account_id: str, _: None = Depends(require_ws_access)
) -> dict[str, bool]:
    with db_session() as session:
        a = session.query(Account).filter(Account.id == account_id, Account.workspace_id == workspace_id).one_or_none()
        if a is None:
            raise HTTPException(404, "account not found")
        session.delete(a)
    return {"ok": True}


# ---------- categories ----------

class CategoryIn(BaseModel):
    id: Optional[str] = None
    name: str
    type: str = Field(pattern=r"^(income|expense)$")
    color: str = "#94a3b8"
    icon: Optional[str] = None


@router.post("/workspaces/{workspace_id}/categories")
def create_category(
    workspace_id: str, payload: CategoryIn, _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        _load_ws(session, workspace_id)
        c = Category(
            id=payload.id or f"{workspace_id}:cat-{uuid.uuid4().hex[:8]}",
            workspace_id=workspace_id,
            name=payload.name,
            type=payload.type,
            color=payload.color,
            icon=payload.icon,
        )
        session.add(c)
        session.flush()
        return category_dto(c)


@router.patch("/workspaces/{workspace_id}/categories/{category_id}")
def update_category(
    workspace_id: str, category_id: str, payload: dict[str, Any], _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        c = session.query(Category).filter(Category.id == category_id, Category.workspace_id == workspace_id).one_or_none()
        if c is None:
            raise HTTPException(404, "category not found")
        for f in ("name", "type", "color", "icon"):
            if f in payload:
                setattr(c, f, payload[f])
        session.flush()
        return category_dto(c)


@router.delete("/workspaces/{workspace_id}/categories/{category_id}")
def delete_category(
    workspace_id: str, category_id: str, _: None = Depends(require_ws_access)
) -> dict[str, bool]:
    with db_session() as session:
        c = session.query(Category).filter(Category.id == category_id, Category.workspace_id == workspace_id).one_or_none()
        if c is None:
            raise HTTPException(404, "category not found")
        session.delete(c)
    return {"ok": True}


# ---------- transactions ----------

class TransactionIn(BaseModel):
    id: Optional[str] = None
    type: str = Field(pattern=r"^(income|expense|transfer)$")
    amount: float = Field(gt=0)
    accountId: str
    toAccountId: Optional[str] = None
    categoryId: Optional[str] = None
    note: Optional[str] = None
    date: Optional[str] = None  # YYYY-MM-DD


@router.post("/workspaces/{workspace_id}/transactions")
def create_transaction(
    workspace_id: str, payload: TransactionIn, _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        _load_ws(session, workspace_id)
        t = Transaction(
            id=payload.id or str(uuid.uuid4()),
            workspace_id=workspace_id,
            type=payload.type,
            amount=payload.amount,
            account_id=payload.accountId,
            to_account_id=payload.toAccountId,
            category_id=payload.categoryId,
            note=payload.note,
            date=payload.date or date_cls.today().isoformat(),
            created_at=now_dt(),
        )
        session.add(t)
        session.flush()
        return transaction_dto(t)


@router.patch("/workspaces/{workspace_id}/transactions/{tx_id}")
def update_transaction(
    workspace_id: str, tx_id: str, payload: dict[str, Any], _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        t = session.query(Transaction).filter(Transaction.id == tx_id, Transaction.workspace_id == workspace_id).one_or_none()
        if t is None:
            raise HTTPException(404, "transaction not found")
        mapping = {
            "type": "type", "amount": "amount", "accountId": "account_id",
            "toAccountId": "to_account_id", "categoryId": "category_id",
            "note": "note", "date": "date",
        }
        for src, dst in mapping.items():
            if src in payload:
                setattr(t, dst, payload[src])
        session.flush()
        return transaction_dto(t)


@router.delete("/workspaces/{workspace_id}/transactions/{tx_id}")
def delete_transaction(
    workspace_id: str, tx_id: str, _: None = Depends(require_ws_access)
) -> dict[str, bool]:
    with db_session() as session:
        t = session.query(Transaction).filter(Transaction.id == tx_id, Transaction.workspace_id == workspace_id).one_or_none()
        if t is None:
            raise HTTPException(404, "transaction not found")
        session.delete(t)
    return {"ok": True}


# ---------- debts ----------

class DebtIn(BaseModel):
    id: Optional[str] = None
    name: str
    totalAmount: float = Field(gt=0)
    paidAmount: float = 0.0
    creditor: Optional[str] = None
    dueDate: Optional[str] = None
    color: str = "#ef4444"
    icon: Optional[str] = None
    note: Optional[str] = None


@router.post("/workspaces/{workspace_id}/debts")
def create_debt(
    workspace_id: str, payload: DebtIn, _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        _load_ws(session, workspace_id)
        d = Debt(
            id=payload.id or str(uuid.uuid4()),
            workspace_id=workspace_id,
            name=payload.name,
            total_amount=payload.totalAmount,
            paid_amount=payload.paidAmount,
            creditor=payload.creditor,
            due_date=payload.dueDate,
            color=payload.color,
            icon=payload.icon,
            note=payload.note,
            created_at=now_dt(),
        )
        session.add(d)
        session.flush()
        return debt_dto(d)


@router.patch("/workspaces/{workspace_id}/debts/{debt_id}")
def update_debt(
    workspace_id: str, debt_id: str, payload: dict[str, Any], _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        d = session.query(Debt).filter(Debt.id == debt_id, Debt.workspace_id == workspace_id).one_or_none()
        if d is None:
            raise HTTPException(404, "debt not found")
        mapping = {
            "name": "name", "totalAmount": "total_amount", "paidAmount": "paid_amount",
            "creditor": "creditor", "dueDate": "due_date", "color": "color", "icon": "icon", "note": "note",
        }
        for src, dst in mapping.items():
            if src in payload:
                setattr(d, dst, payload[src])
        if d.paid_amount >= d.total_amount and not d.closed_at:
            d.closed_at = now_dt()
        if d.paid_amount < d.total_amount and d.closed_at:
            d.closed_at = None
        session.flush()
        return debt_dto(d)


@router.delete("/workspaces/{workspace_id}/debts/{debt_id}")
def delete_debt(
    workspace_id: str, debt_id: str, _: None = Depends(require_ws_access)
) -> dict[str, bool]:
    with db_session() as session:
        d = session.query(Debt).filter(Debt.id == debt_id, Debt.workspace_id == workspace_id).one_or_none()
        if d is None:
            raise HTTPException(404, "debt not found")
        session.delete(d)
    return {"ok": True}


class PayDebtIn(BaseModel):
    amount: float = Field(gt=0)
    accountId: Optional[str] = None
    note: Optional[str] = None


@router.post("/workspaces/{workspace_id}/debts/{debt_id}/pay")
def pay_debt(
    workspace_id: str, debt_id: str, payload: PayDebtIn, _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        d = session.query(Debt).filter(Debt.id == debt_id, Debt.workspace_id == workspace_id).one_or_none()
        if d is None:
            raise HTTPException(404, "debt not found")
        d.paid_amount = min(d.total_amount, d.paid_amount + payload.amount)
        if d.paid_amount >= d.total_amount and not d.closed_at:
            d.closed_at = now_dt()
        tx_dto: Optional[dict[str, Any]] = None
        if payload.accountId:
            t = Transaction(
                id=str(uuid.uuid4()),
                workspace_id=workspace_id,
                type="expense",
                amount=payload.amount,
                account_id=payload.accountId,
                to_account_id=None,
                category_id=None,
                note=payload.note or f"Погашение долга «{d.name}»",
                date=date_cls.today().isoformat(),
                created_at=now_dt(),
            )
            session.add(t)
            session.flush()
            tx_dto = transaction_dto(t)
        session.flush()
        return {"debt": debt_dto(d), "transaction": tx_dto}


# ---------- goals ----------

class GoalIn(BaseModel):
    id: Optional[str] = None
    name: str
    targetAmount: float = Field(gt=0)
    savedAmount: float = 0.0
    deadline: Optional[str] = None
    color: str = "#2186ff"
    icon: Optional[str] = None


@router.post("/workspaces/{workspace_id}/goals")
def create_goal(
    workspace_id: str, payload: GoalIn, _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        _load_ws(session, workspace_id)
        g = Goal(
            id=payload.id or str(uuid.uuid4()),
            workspace_id=workspace_id,
            name=payload.name,
            target_amount=payload.targetAmount,
            saved_amount=payload.savedAmount,
            deadline=payload.deadline,
            color=payload.color,
            icon=payload.icon,
            created_at=now_dt(),
        )
        session.add(g)
        session.flush()
        return goal_dto(g)


@router.patch("/workspaces/{workspace_id}/goals/{goal_id}")
def update_goal(
    workspace_id: str, goal_id: str, payload: dict[str, Any], _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        g = session.query(Goal).filter(Goal.id == goal_id, Goal.workspace_id == workspace_id).one_or_none()
        if g is None:
            raise HTTPException(404, "goal not found")
        mapping = {
            "name": "name", "targetAmount": "target_amount", "savedAmount": "saved_amount",
            "deadline": "deadline", "color": "color", "icon": "icon",
        }
        for src, dst in mapping.items():
            if src in payload:
                setattr(g, dst, payload[src])
        if g.saved_amount >= g.target_amount and not g.completed_at:
            g.completed_at = now_dt()
        session.flush()
        return goal_dto(g)


@router.delete("/workspaces/{workspace_id}/goals/{goal_id}")
def delete_goal(
    workspace_id: str, goal_id: str, _: None = Depends(require_ws_access)
) -> dict[str, bool]:
    with db_session() as session:
        g = session.query(Goal).filter(Goal.id == goal_id, Goal.workspace_id == workspace_id).one_or_none()
        if g is None:
            raise HTTPException(404, "goal not found")
        session.delete(g)
    return {"ok": True}


# ---------- advice ----------

@router.get("/workspaces/{workspace_id}/advice")
def get_advice(
    workspace_id: str, _: None = Depends(require_ws_access)
) -> dict[str, Any]:
    with db_session() as session:
        ws = _load_ws(session, workspace_id)
        adv = compute_advice(
            transactions=list(ws.transactions),
            categories=list(ws.categories),
            debts=list(ws.debts),
        )
    return {
        "totalRemaining": adv.total_remaining,
        "monthlyIncome": adv.monthly_income,
        "monthlyExpense": adv.monthly_expense,
        "monthsAnalysed": adv.months_analysed,
        "monthsAtCurrentPace": adv.months_at_current_pace,
        "monthsWithCuts": adv.months_with_cuts,
        "tips": [
            {
                "categoryId": t.category_id,
                "name": t.name,
                "icon": t.icon,
                "color": t.color,
                "monthly": t.monthly,
                "cutShare": t.cut_share,
                "monthlySavings": t.monthly_savings,
                "message": t.message,
            }
            for t in adv.tips
        ],
    }
