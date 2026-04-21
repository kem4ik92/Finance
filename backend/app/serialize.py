from __future__ import annotations

from typing import Any

from .db import Account, Category, Debt, Goal, Transaction, Workspace


def account_dto(a: Account) -> dict[str, Any]:
    return {
        "id": a.id,
        "name": a.name,
        "type": a.type,
        "openingBalance": a.opening_balance,
        "color": a.color,
        "icon": a.icon,
        "createdAt": a.created_at.isoformat() if a.created_at else None,
    }


def category_dto(c: Category) -> dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "type": c.type,
        "color": c.color,
        "icon": c.icon,
    }


def transaction_dto(t: Transaction) -> dict[str, Any]:
    return {
        "id": t.id,
        "type": t.type,
        "amount": t.amount,
        "accountId": t.account_id,
        "toAccountId": t.to_account_id,
        "categoryId": t.category_id,
        "note": t.note,
        "date": t.date,
        "createdAt": t.created_at.isoformat() if t.created_at else None,
    }


def debt_dto(d: Debt) -> dict[str, Any]:
    return {
        "id": d.id,
        "name": d.name,
        "totalAmount": d.total_amount,
        "paidAmount": d.paid_amount,
        "creditor": d.creditor,
        "dueDate": d.due_date,
        "color": d.color,
        "icon": d.icon,
        "note": d.note,
        "createdAt": d.created_at.isoformat() if d.created_at else None,
        "closedAt": d.closed_at.isoformat() if d.closed_at else None,
    }


def goal_dto(g: Goal) -> dict[str, Any]:
    return {
        "id": g.id,
        "name": g.name,
        "targetAmount": g.target_amount,
        "savedAmount": g.saved_amount,
        "deadline": g.deadline,
        "color": g.color,
        "icon": g.icon,
        "createdAt": g.created_at.isoformat() if g.created_at else None,
        "completedAt": g.completed_at.isoformat() if g.completed_at else None,
    }


def workspace_state(ws: Workspace) -> dict[str, Any]:
    return {
        "workspace": {
            "id": ws.id,
            "linkCode": ws.link_code,
            "name": ws.name,
        },
        "accounts": [account_dto(a) for a in ws.accounts],
        "categories": [category_dto(c) for c in ws.categories],
        "transactions": sorted(
            (transaction_dto(t) for t in ws.transactions),
            key=lambda d: (d.get("date") or "", d.get("createdAt") or ""),
            reverse=True,
        ),
        "debts": [debt_dto(d) for d in ws.debts],
        "goals": [goal_dto(g) for g in ws.goals],
    }
