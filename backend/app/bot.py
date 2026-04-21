from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import date
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from .advice import compute_advice
from .ai import ai_available, answer_question
from .db import (
    Account,
    Category,
    Debt,
    Goal,
    Transaction,
    User,
    Workspace,
    WorkspaceMember,
    db_session,
    new_link_code,
    new_workspace_id,
    now_dt,
)
import secrets as _pysecrets
from .defaults import seed_defaults

log = logging.getLogger("bot")
TELEGRAM_API = "https://api.telegram.org"
DEFAULT_ACCOUNT_ID = "acc-card"

WEB_URL = os.environ.get("WEB_URL", "https://dist-tgjbvjlo.devinapps.com")

# Main reply keyboard — always visible at the bottom on mobile.
MAIN_KEYBOARD: dict[str, Any] = {
    "keyboard": [
        [{"text": "💸 Расход"}, {"text": "💰 Доход"}],
        [{"text": "💳 Баланс"}, {"text": "📊 Отчёт"}],
        [{"text": "🏦 Долги"}, {"text": "🎯 Цели"}],
        [{"text": "💡 Советы"}, {"text": "🤖 AI"}],
        [{"text": "👛 Кошельки"}, {"text": "🔗 Код"}],
    ],
    "resize_keyboard": True,
    "is_persistent": True,
}


def _token() -> str:
    t = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not t:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not set")
    return t


def _ru(n: float) -> str:
    s = f"{n:,.2f}".replace(",", "\u00a0").replace(".", ",")
    return f"{s} м."


# ---------- Telegram HTTP helpers ----------

async def _tg(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    token = _token()
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(f"{TELEGRAM_API}/bot{token}/{method}", json=payload)
        if r.status_code >= 300:
            log.warning("telegram %s failed: %s %s", method, r.status_code, r.text[:300])
        try:
            return r.json()
        except Exception:
            return {}


async def send_message(
    chat_id: int,
    text: str,
    reply_markup: Optional[dict[str, Any]] = None,
    reply_to: Optional[int] = None,
) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    if reply_to:
        payload["reply_to_message_id"] = reply_to
        payload["allow_sending_without_reply"] = True
    await _tg("sendMessage", payload)


async def edit_message_text(
    chat_id: int,
    message_id: int,
    text: str,
    reply_markup: Optional[dict[str, Any]] = None,
) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    await _tg("editMessageText", payload)


async def answer_callback(callback_id: str, text: str = "", alert: bool = False) -> None:
    payload: dict[str, Any] = {"callback_query_id": callback_id}
    if text:
        payload["text"] = text
    if alert:
        payload["show_alert"] = True
    await _tg("answerCallbackQuery", payload)


def set_webhook_sync(base_url: str) -> None:
    """Blocking; called once at startup."""
    token = _token()
    url = f"{base_url.rstrip('/')}/tg/webhook"
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(
                f"{TELEGRAM_API}/bot{token}/setWebhook",
                json={"url": url, "allowed_updates": ["message", "callback_query"]},
            )
            log.info("setWebhook -> %s: %s", url, r.text[:200])
            # Register command descriptions for the "/" menu.
            client.post(
                f"{TELEGRAM_API}/bot{token}/setMyCommands",
                json={
                    "commands": [
                        {"command": "start", "description": "Главное меню"},
                        {"command": "add", "description": "Расход: /add 350 продукты"},
                        {"command": "income", "description": "Доход: /income 5000 зарплата"},
                        {"command": "balance", "description": "Баланс по счетам"},
                        {"command": "debts", "description": "Долги"},
                        {"command": "goals", "description": "Цели"},
                        {"command": "advice", "description": "Советы по экономии"},
                        {"command": "report", "description": "Отчёт за месяц"},
                        {"command": "ask", "description": "Спросить AI про финансы"},
                        {"command": "wallets", "description": "Мои кошельки"},
                        {"command": "link", "description": "Код для сайта"},
                    ]
                },
            )
    except Exception as exc:
        log.warning("setWebhook failed: %s", exc)


# ---------- user + workspace + state ----------

def _new_user_id() -> str:
    return _pysecrets.token_urlsafe(12)


def _create_workspace(session: Session, owner: User, name: Optional[str]) -> Workspace:
    ws = Workspace(
        id=new_workspace_id(),
        link_code=new_link_code(),
        telegram_id=owner.telegram_id,
        created_at=now_dt(),
        name=(name or "").strip()[:128] or None,
    )
    session.add(ws)
    session.flush()
    session.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="owner"))
    seed_defaults(session, ws)
    session.flush()
    return ws


def _ensure_user(session: Session, telegram_id: int, name: Optional[str]) -> User:
    """Return the User for this telegram_id, migrating legacy data as needed.

    On first contact: creates a User + a default personal Workspace ("Личный").
    Legacy workspaces (created before multi-user) are attached as memberships.
    """
    user = session.query(User).filter(User.telegram_id == telegram_id).one_or_none()
    if user is not None:
        if name and user.name != name:
            user.name = name[:128]
        if user.current_workspace_id is None:
            first = (
                session.query(WorkspaceMember)
                .filter(WorkspaceMember.user_id == user.id)
                .first()
            )
            user.current_workspace_id = first.workspace_id if first else None
        if user.current_workspace_id is None:
            ws = _create_workspace(session, user, "Личный")
            user.current_workspace_id = ws.id
        return user

    # Attach legacy workspace (pre-multi-user, linked by telegram_id only).
    legacy_ws = (
        session.query(Workspace)
        .filter(Workspace.telegram_id == telegram_id)
        .first()
    )
    user = User(
        id=_new_user_id(),
        telegram_id=telegram_id,
        name=(name or None) and name[:128],
        pending_state=legacy_ws.pending_state if legacy_ws is not None else None,
    )
    session.add(user)
    session.flush()
    if legacy_ws is not None:
        session.add(
            WorkspaceMember(workspace_id=legacy_ws.id, user_id=user.id, role="owner")
        )
        user.current_workspace_id = legacy_ws.id
    else:
        ws = _create_workspace(session, user, "Личный")
        user.current_workspace_id = ws.id
    session.flush()
    return user


def _current_ws(session: Session, user: User) -> Workspace:
    """Return the user's current Workspace, repairing current_workspace_id if stale."""
    ws: Optional[Workspace] = None
    if user.current_workspace_id:
        ws = session.get(Workspace, user.current_workspace_id)
        if ws is not None:
            is_member = (
                session.query(WorkspaceMember)
                .filter(
                    WorkspaceMember.workspace_id == ws.id,
                    WorkspaceMember.user_id == user.id,
                )
                .one_or_none()
            )
            if is_member is None:
                ws = None
    if ws is None:
        membership = (
            session.query(WorkspaceMember)
            .filter(WorkspaceMember.user_id == user.id)
            .first()
        )
        if membership is not None:
            ws = session.get(Workspace, membership.workspace_id)
    if ws is None:
        ws = _create_workspace(session, user, "Личный")
    user.current_workspace_id = ws.id
    return ws


def _user_workspaces(session: Session, user: User) -> list[Workspace]:
    rows = (
        session.query(WorkspaceMember, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .filter(WorkspaceMember.user_id == user.id)
        .order_by(WorkspaceMember.joined_at.asc())
        .all()
    )
    return [ws for _, ws in rows]


def _is_owner(session: Session, user: User, ws: Workspace) -> bool:
    m = (
        session.query(WorkspaceMember)
        .filter(
            WorkspaceMember.workspace_id == ws.id,
            WorkspaceMember.user_id == user.id,
        )
        .one_or_none()
    )
    return bool(m and m.role == "owner")


def _get_state(user: User) -> dict[str, Any]:
    raw = getattr(user, "pending_state", None)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _set_state(user: User, state: Optional[dict[str, Any]]) -> None:
    user.pending_state = json.dumps(state) if state else None


def _default_account(session: Session, ws: Workspace) -> Optional[Account]:
    preferred = f"{ws.id}:{DEFAULT_ACCOUNT_ID}"
    acc = session.query(Account).filter(Account.id == preferred).one_or_none()
    if acc:
        return acc
    return (
        session.query(Account)
        .filter(Account.workspace_id == ws.id)
        .order_by(Account.created_at)
        .first()
    )


def _find_category(session: Session, ws: Workspace, query: str, type_: str) -> Optional[Category]:
    q = query.strip().lower()
    if not q:
        return None
    cats = (
        session.query(Category)
        .filter(Category.workspace_id == ws.id, Category.type == type_)
        .all()
    )
    for c in cats:
        if c.name.lower() == q:
            return c
    for c in cats:
        if q in c.name.lower():
            return c
    return None


def _parse_amount(s: str) -> Optional[float]:
    s = s.replace(",", ".").replace("\u00a0", "").replace(" ", "")
    try:
        v = float(s)
    except ValueError:
        return None
    if v <= 0:
        return None
    return v


def _parse_add_args(text: str) -> tuple[Optional[float], str, str]:
    parts = text.strip().split(maxsplit=2)
    if not parts:
        return None, "", ""
    amount = _parse_amount(parts[0])
    if amount is None:
        return None, "", ""
    if len(parts) == 1:
        return amount, "", ""
    category = parts[1]
    note = parts[2] if len(parts) >= 3 else ""
    return amount, category, note


# ---------- keyboards ----------

def _category_keyboard(cats: list[Category], prefix: str) -> dict[str, Any]:
    rows: list[list[dict[str, Any]]] = []
    row: list[dict[str, Any]] = []
    for c in cats:
        label = f"{c.icon or '🏷'} {c.name}"
        row.append({"text": label[:32], "callback_data": f"{prefix}:{c.id}"})
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([{"text": "❌ Отмена", "callback_data": "cancel"}])
    return {"inline_keyboard": rows}


def _debts_keyboard(debts: list[Debt]) -> dict[str, Any]:
    rows: list[list[dict[str, Any]]] = []
    for d in debts:
        if d.closed_at:
            continue
        remaining = max(0.0, d.total_amount - d.paid_amount)
        rows.append([
            {"text": f"💸 Погасить «{d.name}» ({_ru(remaining)})", "callback_data": f"pay:{d.id}"},
        ])
        rows.append([
            {"text": "🗑 Удалить", "callback_data": f"deldebt:{d.id}"},
        ])
    rows.append([{"text": "➕ Добавить долг", "callback_data": "newdebt"}])
    return {"inline_keyboard": rows}


def _goals_keyboard(goals: list[Goal]) -> dict[str, Any]:
    rows: list[list[dict[str, Any]]] = []
    for g in goals:
        if g.completed_at:
            continue
        remaining = max(0.0, g.target_amount - g.saved_amount)
        rows.append([
            {"text": f"💰 Пополнить «{g.name}» ({_ru(remaining)})", "callback_data": f"goal:{g.id}"},
        ])
        rows.append([
            {"text": "🗑 Удалить", "callback_data": f"delgoal:{g.id}"},
        ])
    rows.append([{"text": "➕ Добавить цель", "callback_data": "newgoal"}])
    return {"inline_keyboard": rows}


def _confirm_keyboard(yes_data: str, no_data: str = "cancel") -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [
                {"text": "✅ Да, удалить", "callback_data": yes_data},
                {"text": "← Отмена", "callback_data": no_data},
            ]
        ]
    }


# ---------- high-level views ----------

async def show_menu(chat_id: int, greeting: str) -> None:
    await send_message(chat_id, greeting, reply_markup=MAIN_KEYBOARD)


async def show_balance(chat_id: int, ws: Workspace) -> None:
    by_acc: dict[str, float] = {a.id: a.opening_balance for a in ws.accounts}
    for t in ws.transactions:
        if t.type == "income":
            by_acc[t.account_id] = by_acc.get(t.account_id, 0.0) + t.amount
        elif t.type == "expense":
            by_acc[t.account_id] = by_acc.get(t.account_id, 0.0) - t.amount
        elif t.type == "transfer":
            by_acc[t.account_id] = by_acc.get(t.account_id, 0.0) - t.amount
            if t.to_account_id:
                by_acc[t.to_account_id] = by_acc.get(t.to_account_id, 0.0) + t.amount
    lines: list[str] = []
    total = 0.0
    for a in ws.accounts:
        v = by_acc.get(a.id, a.opening_balance)
        total += v
        lines.append(f"{a.icon or '•'} <b>{a.name}</b>: {_ru(v)}")
    body = "\n".join(lines) if lines else "Нет счетов."
    await send_message(chat_id, f"💰 <b>Общий баланс: {_ru(total)}</b>\n\n{body}")


async def show_debts(chat_id: int, ws: Workspace) -> None:
    debts = list(ws.debts)
    active = [d for d in debts if not d.closed_at]
    if not debts:
        await send_message(
            chat_id,
            "Долгов нет. Нажми «➕ Добавить долг» или используй команду <code>/debt Кредит 10000 Halkbank</code>.",
            reply_markup=_debts_keyboard(debts),
        )
        return
    lines = ["💳 <b>Твои долги</b>\n"]
    total_remaining = 0.0
    for d in debts:
        remaining = max(0.0, d.total_amount - d.paid_amount)
        total_remaining += remaining if not d.closed_at else 0.0
        progress = (d.paid_amount / d.total_amount * 100) if d.total_amount else 0.0
        status = "✅ закрыт" if d.closed_at else f"осталось {_ru(remaining)}"
        cred = f" · {d.creditor}" if d.creditor else ""
        lines.append(f"• <b>{d.name}</b>{cred}\n  {status} ({progress:.0f}% из {_ru(d.total_amount)})")
    if active:
        lines.append(f"\n<b>Всего осталось: {_ru(total_remaining)}</b>")
    await send_message(chat_id, "\n".join(lines), reply_markup=_debts_keyboard(debts))


async def show_goals(chat_id: int, ws: Workspace) -> None:
    goals = list(ws.goals)
    if not goals:
        await send_message(
            chat_id,
            "Целей нет. Нажми «➕ Добавить цель», чтобы начать копить.",
            reply_markup=_goals_keyboard(goals),
        )
        return
    lines = ["🎯 <b>Твои цели</b>\n"]
    for g in goals:
        remaining = max(0.0, g.target_amount - g.saved_amount)
        progress = (g.saved_amount / g.target_amount * 100) if g.target_amount else 0.0
        status = "🎉 достигнута" if g.completed_at else f"осталось {_ru(remaining)}"
        lines.append(f"• <b>{g.name}</b>\n  {status} ({progress:.0f}% из {_ru(g.target_amount)})")
    await send_message(chat_id, "\n".join(lines), reply_markup=_goals_keyboard(goals))


async def show_advice(chat_id: int, ws: Workspace) -> None:
    advice = compute_advice(
        transactions=list(ws.transactions),
        categories=list(ws.categories),
        debts=list(ws.debts),
        lookback=3,
    )
    if advice.total_remaining <= 0:
        await send_message(
            chat_id,
            "У тебя нет активных долгов 🎉 Нажми «🏦 Долги» → «➕ Добавить долг», если нужно.",
        )
        return
    if not advice.tips:
        await send_message(
            chat_id,
            f"Осталось выплатить: <b>{_ru(advice.total_remaining)}</b>.\n"
            "Пока мало истории расходов — добавь несколько через «💸 Расход», и я предложу, на чём сократить.",
        )
        return
    lines = [
        "💡 <b>На чём сэкономить, чтобы быстрее закрыть долги</b>",
        f"Анализ за {advice.months_analysed} мес. · осталось выплатить <b>{_ru(advice.total_remaining)}</b>",
        "",
    ]
    for t in advice.tips:
        lines.append(
            f"{t.icon} <b>{t.name}</b> — тратишь {_ru(t.monthly)}/мес.\n"
            f"   Сократи на <b>{round(t.cut_share * 100)}%</b> → освободит <b>{_ru(t.monthly_savings)}</b>/мес."
        )
    if advice.months_at_current_pace is not None and advice.months_with_cuts is not None:
        lines.append("")
        lines.append(f"Текущим темпом: ~{advice.months_at_current_pace:.0f} мес.")
        lines.append(f"С этими сокращениями: ~{advice.months_with_cuts:.0f} мес.")
    await send_message(chat_id, "\n".join(lines))


async def show_report(chat_id: int, ws: Workspace) -> None:
    ym = date.today().strftime("%Y-%m")
    income = 0.0
    expense = 0.0
    by_cat: dict[str, float] = {}
    cat_names = {c.id: c.name for c in ws.categories}
    for t in ws.transactions:
        if (t.date or "")[:7] != ym:
            continue
        if t.type == "income":
            income += t.amount
        elif t.type == "expense":
            expense += t.amount
            name = cat_names.get(t.category_id or "", "Без категории")
            by_cat[name] = by_cat.get(name, 0.0) + t.amount
    lines = [
        "📊 <b>Сводка за месяц</b>",
        f"Доходы: {_ru(income)}",
        f"Расходы: {_ru(expense)}",
        f"Баланс: <b>{_ru(income - expense)}</b>",
    ]
    if by_cat:
        lines.append("\n<b>Расходы по категориям:</b>")
        for name, amount in sorted(by_cat.items(), key=lambda kv: kv[1], reverse=True)[:8]:
            lines.append(f"• {name}: {_ru(amount)}")
    await send_message(chat_id, "\n".join(lines))


AI_SUGGESTIONS = [
    "Сколько я трачу на еду в среднем?",
    "Какой долг лучше закрыть первым?",
    "На чём реально сэкономить?",
    "Когда я накоплю на свою цель текущим темпом?",
]


async def start_ai_flow(chat_id: int, user: User) -> None:
    if not ai_available():
        await send_message(
            chat_id,
            "AI не подключён (нет ключа OPENROUTER_API_KEY на сервере).",
            reply_markup=MAIN_KEYBOARD,
        )
        return
    _set_state(user, {"flow": "ask_question"})
    ideas = "\n".join(f"— {s}" for s in AI_SUGGESTIONS)
    await send_message(
        chat_id,
        (
            "🤖 <b>AI-ассистент</b>\n"
            "Задай любой вопрос про свои финансы. Я знаю твои счета, последние операции, долги и цели.\n\n"
            f"Примеры:\n{ideas}\n\n"
            "Напиши вопрос одним сообщением."
        ),
    )


async def run_ai_question(chat_id: int, ws: Workspace, question: str) -> None:
    question = question.strip()
    if not question:
        await send_message(chat_id, "Пустой вопрос. Попробуй ещё раз.")
        return
    if len(question) > 1000:
        await send_message(chat_id, "Слишком длинный вопрос (больше 1000 символов). Сократи.")
        return
    try:
        await _tg("sendChatAction", {"chat_id": chat_id, "action": "typing"})
    except Exception:
        pass
    try:
        answer = await answer_question(ws, question)
    except RuntimeError as exc:
        await send_message(chat_id, f"🤖 {exc}", reply_markup=MAIN_KEYBOARD)
        return
    except Exception:
        log.exception("ai answer failed")
        await send_message(
            chat_id,
            "🤖 Не получилось спросить AI. Попробуй позже.",
            reply_markup=MAIN_KEYBOARD,
        )
        return
    # Trim overly long answers
    MAX = 3800
    if len(answer) > MAX:
        answer = answer[:MAX] + "…"
    await send_message(chat_id, f"🤖 {answer}", reply_markup=MAIN_KEYBOARD)


async def show_wallets(chat_id: int, user: User, session: Session) -> None:
    """Render the list of the user's wallets with inline management buttons."""
    current_id = user.current_workspace_id
    wallets = _user_workspaces(session, user)

    lines = ["<b>👛 Твои кошельки</b>\n"]
    rows: list[list[dict[str, Any]]] = []
    for w in wallets:
        is_current = w.id == current_id
        owner = _is_owner(session, user, w)
        role_mark = " ⭐" if owner else ""
        marker = "✅ " if is_current else "• "
        name = w.name or "Без имени"
        lines.append(f"{marker}<b>{name}</b>{role_mark} — код <code>{w.link_code}</code>")
        label_switch = f"{'✓ ' if is_current else ''}Выбрать «{name[:20]}»"
        rows.append([
            {"text": label_switch[:64], "callback_data": f"wspick:{w.id}"},
        ])
        admin_row: list[dict[str, Any]] = [
            {"text": "📤 Пригласить", "callback_data": f"wsinvite:{w.id}"},
        ]
        if owner:
            admin_row.append({"text": "✏ Переименовать", "callback_data": f"wsrename:{w.id}"})
        rows.append(admin_row)
        leave_row: list[dict[str, Any]] = []
        if owner and len(wallets) > 1:
            leave_row.append({"text": "🗑 Удалить", "callback_data": f"wsdel:{w.id}"})
        elif not owner:
            leave_row.append({"text": "🚪 Выйти", "callback_data": f"wsleave:{w.id}"})
        if leave_row:
            rows.append(leave_row)
        rows.append([{"text": "─────────", "callback_data": "noop"}])

    rows.append([
        {"text": "➕ Создать новый", "callback_data": "wsnew"},
        {"text": "🔗 Подключиться по коду", "callback_data": "wsjoin"},
    ])

    lines.append(
        "\n<i>⭐ — твой кошелёк (ты владелец). "
        "Код рядом с кошельком можно дать другому человеку — он напишет боту /start и "
        "нажмёт «Подключиться по коду», чтобы вести этот кошелёк вместе с тобой. "
        "Его же можно вставить в Настройки на сайте.</i>"
    )
    await send_message(
        chat_id,
        "\n".join(lines),
        reply_markup={"inline_keyboard": rows},
    )


async def show_link(chat_id: int, ws: Workspace) -> None:
    await send_message(
        chat_id,
        (
            f"🔗 <b>Код синхронизации:</b> <code>{ws.link_code}</code>\n\n"
            f"1) Открой {WEB_URL}\n"
            f"2) Настройки → «Синхронизация с Telegram-ботом»\n"
            f"3) Вставь код и нажми «Подключить»\n\n"
            "После этого операции, долги и цели станут общими между ботом и сайтом."
        ),
    )


async def show_start(chat_id: int, ws: Workspace) -> None:
    await send_message(
        chat_id,
        (
            "<b>Привет! 🎉</b> Я бот Manat — помогаю вести учёт финансов в туркменских манатах.\n\n"
            "Используй кнопки внизу экрана — они всё умеют.\n"
            "Для синхронизации с сайтом нажми «🔗 Код»."
        ),
        reply_markup=MAIN_KEYBOARD,
    )


# ---------- transaction writer ----------

def _create_tx(
    session: Session,
    ws: Workspace,
    *,
    type_: str,
    amount: float,
    account_id: str,
    category_id: Optional[str],
    note: Optional[str] = None,
) -> float:
    tx = Transaction(
        id=str(uuid.uuid4()),
        workspace_id=ws.id,
        type=type_,
        amount=amount,
        account_id=account_id,
        to_account_id=None,
        category_id=category_id,
        note=note,
        date=date.today().isoformat(),
        created_at=now_dt(),
    )
    session.add(tx)
    session.flush()
    # Return total balance
    by_acc: dict[str, float] = {a.id: a.opening_balance for a in ws.accounts}
    for t in ws.transactions:
        if t.type == "income":
            by_acc[t.account_id] = by_acc.get(t.account_id, 0.0) + t.amount
        elif t.type == "expense":
            by_acc[t.account_id] = by_acc.get(t.account_id, 0.0) - t.amount
    return sum(by_acc.values())


# ---------- text-command flows (still supported) ----------

async def handle_add_command(
    chat_id: int,
    ws: Workspace,
    session: Session,
    rest: str,
    type_: str,
) -> None:
    amount, cat_query, note = _parse_add_args(rest)
    if amount is None:
        tpl = "/income 5000 зарплата" if type_ == "income" else "/add 350 продукты хлеб"
        await send_message(chat_id, f"Не понял сумму. Пример: <code>{tpl}</code>")
        return
    account = _default_account(session, ws)
    if account is None:
        await send_message(chat_id, "У тебя нет счетов. Нажми /start.")
        return
    cat = _find_category(session, ws, cat_query, type_) if cat_query else None
    combined_note = note
    if cat_query and cat is None:
        combined_note = (cat_query + (" " + note if note else "")).strip()
    if cat is None:
        fb = f"{ws.id}:" + ("cat-other-inc" if type_ == "income" else "cat-other-exp")
        cat = session.query(Category).filter(Category.id == fb).one_or_none()
    total = _create_tx(
        session,
        ws,
        type_=type_,
        amount=amount,
        account_id=account.id,
        category_id=cat.id if cat else None,
        note=combined_note or None,
    )
    cat_name = cat.name if cat else "—"
    sign = "+" if type_ == "income" else "−"
    ico = "💼" if type_ == "income" else "🧾"
    text = (
        f"{ico} Записано: <b>{sign}{_ru(amount)}</b>\n"
        f"Категория: {cat_name}\n"
        f"Счёт: {account.name}\n"
        f"Общий баланс: <b>{_ru(total)}</b>"
    )
    if combined_note:
        text += f"\nКомментарий: {combined_note}"
    await send_message(chat_id, text, reply_markup=MAIN_KEYBOARD)


async def handle_debt_add_command(chat_id: int, ws: Workspace, rest: str) -> None:
    m = re.match(r"^\s*(.+?)\s+(\d+[\d.,]*)\s*(.*)$", rest)
    if not m:
        await send_message(chat_id, "Пример: <code>/debt Кредит 10000 Halkbank</code>")
        return
    name, amount_s, creditor = m.group(1), m.group(2), m.group(3).strip()
    amount = _parse_amount(amount_s)
    if amount is None:
        await send_message(chat_id, "Сумма должна быть положительной.")
        return
    with db_session() as session:
        ws = session.get(Workspace, ws.id) or ws
        d = Debt(
            id=str(uuid.uuid4()),
            workspace_id=ws.id,
            name=name.strip()[:128],
            total_amount=amount,
            paid_amount=0.0,
            creditor=creditor[:128] if creditor else None,
            color="#ef4444",
            icon="💳",
            created_at=now_dt(),
        )
        session.add(d)
    await send_message(
        chat_id,
        f"💳 Добавил долг <b>{name}</b> на <b>{_ru(amount)}</b>.",
        reply_markup=MAIN_KEYBOARD,
    )


async def handle_pay_command(chat_id: int, ws: Workspace, session: Session, rest: str) -> None:
    parts = rest.rsplit(maxsplit=1)
    if len(parts) != 2:
        await send_message(chat_id, "Пример: <code>/pay Кредит 500</code>")
        return
    name_q, amount_s = parts[0].strip(), parts[1].strip()
    amount = _parse_amount(amount_s)
    if amount is None or not name_q:
        await send_message(chat_id, "Пример: <code>/pay Кредит 500</code>")
        return
    nq = name_q.lower()
    target: Optional[Debt] = None
    for d in ws.debts:
        if d.closed_at:
            continue
        if d.name.lower() == nq:
            target = d
            break
    if target is None:
        for d in ws.debts:
            if d.closed_at:
                continue
            if nq in d.name.lower():
                target = d
                break
    if target is None:
        names = ", ".join(d.name for d in ws.debts if not d.closed_at) or "нет активных долгов"
        await send_message(chat_id, f"Не нашёл долг «{name_q}». Активные: {names}")
        return
    await _apply_debt_payment(chat_id, ws, session, target, amount)


async def _apply_debt_payment(
    chat_id: int,
    ws: Workspace,
    session: Session,
    target: Debt,
    amount: float,
) -> None:
    target.paid_amount = min(target.total_amount, target.paid_amount + amount)
    closed = target.paid_amount >= target.total_amount
    if closed and not target.closed_at:
        target.closed_at = now_dt()
    account = _default_account(session, ws)
    if account is not None:
        session.add(
            Transaction(
                id=str(uuid.uuid4()),
                workspace_id=ws.id,
                type="expense",
                amount=amount,
                account_id=account.id,
                to_account_id=None,
                category_id=None,
                note=f"Погашение долга «{target.name}»",
                date=date.today().isoformat(),
                created_at=now_dt(),
            )
        )
    remaining = max(0.0, target.total_amount - target.paid_amount)
    tail = "\n🎉 Долг полностью закрыт!" if closed else f"\nОсталось: <b>{_ru(remaining)}</b>"
    await send_message(
        chat_id,
        f"✅ Погасил <b>{_ru(amount)}</b> по «<b>{target.name}</b>».{tail}",
        reply_markup=MAIN_KEYBOARD,
    )


async def _apply_goal_contribution(
    chat_id: int,
    ws: Workspace,
    session: Session,
    goal: Goal,
    amount: float,
) -> None:
    goal.saved_amount = max(0.0, goal.saved_amount + amount)
    completed = goal.saved_amount >= goal.target_amount
    if completed and not goal.completed_at:
        goal.completed_at = now_dt()
    account = _default_account(session, ws)
    if account is not None:
        session.add(
            Transaction(
                id=str(uuid.uuid4()),
                workspace_id=ws.id,
                type="expense",
                amount=amount,
                account_id=account.id,
                to_account_id=None,
                category_id=None,
                note=f"В цель «{goal.name}»",
                date=date.today().isoformat(),
                created_at=now_dt(),
            )
        )
    remaining = max(0.0, goal.target_amount - goal.saved_amount)
    tail = "\n🎉 Цель достигнута!" if completed else f"\nДо цели осталось: <b>{_ru(remaining)}</b>"
    await send_message(
        chat_id,
        f"✅ Отложил <b>{_ru(amount)}</b> в цель «<b>{goal.name}</b>».{tail}",
        reply_markup=MAIN_KEYBOARD,
    )


# ---------- state-aware text handler ----------

async def handle_state_text(
    chat_id: int,
    user: User,
    ws: Workspace,
    session: Session,
    state: dict[str, Any],
    text: str,
) -> bool:
    """Return True if the state consumed the text."""
    flow = state.get("flow")

    # 1) waiting for amount for expense/income
    if flow in ("expense_amount", "income_amount"):
        amount = _parse_amount(text.split()[0]) if text else None
        if amount is None:
            await send_message(chat_id, "Нужна сумма числом. Пример: 350 или 350.50. Напиши ещё раз или нажми кнопку отмены в меню.")
            return True
        type_ = "expense" if flow == "expense_amount" else "income"
        cats = [c for c in ws.categories if c.type == type_]
        if not cats:
            # No categories — just save directly
            account = _default_account(session, ws)
            if account is None:
                await send_message(chat_id, "Нет счетов. Нажми /start.")
                _set_state(user, None)
                return True
            total = _create_tx(
                session, ws, type_=type_, amount=amount,
                account_id=account.id, category_id=None,
            )
            _set_state(user, None)
            sign = "+" if type_ == "income" else "−"
            await send_message(
                chat_id,
                f"✅ Записал {sign}{_ru(amount)}. Общий баланс: <b>{_ru(total)}</b>",
                reply_markup=MAIN_KEYBOARD,
            )
            return True
        prefix = "exp" if type_ == "expense" else "inc"
        _set_state(user, {"flow": f"{flow}_cat", "amount": amount, "type": type_})
        header = "🧾 <b>Расход</b>" if type_ == "expense" else "💼 <b>Доход</b>"
        await send_message(
            chat_id,
            f"{header}\nСумма: <b>{_ru(amount)}</b>\n\nВыбери категорию:",
            reply_markup=_category_keyboard(cats, prefix),
        )
        return True

    # 2) waiting for debt payment amount
    if flow == "pay_amount":
        debt_id = state.get("debt_id")
        target = session.query(Debt).filter(Debt.id == debt_id, Debt.workspace_id == ws.id).one_or_none()
        if target is None:
            await send_message(chat_id, "Этот долг больше не существует.", reply_markup=MAIN_KEYBOARD)
            _set_state(user, None)
            return True
        amount = _parse_amount(text.split()[0]) if text else None
        if amount is None:
            await send_message(chat_id, "Нужна сумма числом. Пример: 500")
            return True
        _set_state(user, None)
        await _apply_debt_payment(chat_id, ws, session, target, amount)
        return True

    # 3) waiting for goal contribution amount
    if flow == "goal_amount":
        goal_id = state.get("goal_id")
        target = session.query(Goal).filter(Goal.id == goal_id, Goal.workspace_id == ws.id).one_or_none()
        if target is None:
            await send_message(chat_id, "Эта цель больше не существует.", reply_markup=MAIN_KEYBOARD)
            _set_state(user, None)
            return True
        amount = _parse_amount(text.split()[0]) if text else None
        if amount is None:
            await send_message(chat_id, "Нужна сумма числом. Пример: 500")
            return True
        _set_state(user, None)
        await _apply_goal_contribution(chat_id, ws, session, target, amount)
        return True

    # 4) waiting for new debt details: "name amount [creditor]"
    if flow == "new_debt":
        m = re.match(r"^\s*(.+?)\s+(\d+[\d.,]*)\s*(.*)$", text)
        if not m:
            await send_message(chat_id, "Формат: <code>Название Сумма [кредитор]</code>. Пример: <code>Кредит 10000 Halkbank</code>")
            return True
        name, amount_s, creditor = m.group(1), m.group(2), m.group(3).strip()
        amount = _parse_amount(amount_s)
        if amount is None:
            await send_message(chat_id, "Сумма должна быть положительной.")
            return True
        d = Debt(
            id=str(uuid.uuid4()),
            workspace_id=ws.id,
            name=name.strip()[:128],
            total_amount=amount,
            paid_amount=0.0,
            creditor=creditor[:128] if creditor else None,
            color="#ef4444",
            icon="💳",
            created_at=now_dt(),
        )
        session.add(d)
        _set_state(user, None)
        await send_message(
            chat_id,
            f"💳 Добавил долг <b>{name.strip()}</b> на <b>{_ru(amount)}</b>.",
            reply_markup=MAIN_KEYBOARD,
        )
        return True

    # 5) waiting for new goal: "name amount"
    if flow == "new_goal":
        parts = text.strip().rsplit(maxsplit=1)
        if len(parts) != 2:
            await send_message(chat_id, "Формат: <code>Название Сумма</code>. Пример: <code>Ноутбук 10000</code>")
            return True
        name = parts[0].strip()
        amount = _parse_amount(parts[1])
        if not name or amount is None:
            await send_message(chat_id, "Не понял. Пример: <code>Ноутбук 10000</code>")
            return True
        g = Goal(
            id=str(uuid.uuid4()),
            workspace_id=ws.id,
            name=name[:128],
            target_amount=amount,
            saved_amount=0.0,
            color="#2186ff",
            icon="🎯",
            created_at=now_dt(),
        )
        session.add(g)
        _set_state(user, None)
        await send_message(
            chat_id,
            f"🎯 Добавил цель <b>{name}</b> на <b>{_ru(amount)}</b>.",
            reply_markup=MAIN_KEYBOARD,
        )
        return True

    # 6) AI question
    if flow == "ask_question":
        _set_state(user, None)
        await run_ai_question(chat_id, ws, text)
        return True

    # 7) workspace management flows
    if flow == "new_workspace":
        _set_state(user, None)
        name = text.strip()[:128]
        if not name:
            await send_message(chat_id, "Пустое имя. Давай ещё раз.")
            return True
        new_ws = _create_workspace(session, user, name)
        user.current_workspace_id = new_ws.id
        await send_message(
            chat_id,
            f"👛 Создал кошелёк <b>{name}</b> и сделал его текущим.\nКод для синхронизации/приглашения: <code>{new_ws.link_code}</code>",
            reply_markup=MAIN_KEYBOARD,
        )
        await show_wallets(chat_id, user, session)
        return True

    if flow == "rename_workspace":
        target_id = state.get("workspace_id")
        _set_state(user, None)
        if not target_id:
            return True
        target_ws = session.get(Workspace, target_id)
        if target_ws is None or not _is_owner(session, user, target_ws):
            await send_message(chat_id, "Не могу переименовать этот кошелёк.", reply_markup=MAIN_KEYBOARD)
            return True
        name = text.strip()[:128]
        if not name:
            await send_message(chat_id, "Пустое имя. Давай ещё раз.")
            return True
        target_ws.name = name
        await send_message(
            chat_id,
            f"✏ Переименовал в <b>{name}</b>.",
            reply_markup=MAIN_KEYBOARD,
        )
        await show_wallets(chat_id, user, session)
        return True

    if flow == "join_workspace":
        _set_state(user, None)
        code = text.strip().upper()
        code = re.sub(r"[^A-Z0-9]", "", code)[:16]
        if len(code) != 6:
            await send_message(chat_id, "Код — это 6 символов (буквы/цифры). Пример: <code>KKVRJD</code>")
            return True
        target_ws = session.query(Workspace).filter(Workspace.link_code == code).one_or_none()
        if target_ws is None:
            await send_message(chat_id, "Не нашёл кошелёк по этому коду.", reply_markup=MAIN_KEYBOARD)
            return True
        existing = (
            session.query(WorkspaceMember)
            .filter(
                WorkspaceMember.workspace_id == target_ws.id,
                WorkspaceMember.user_id == user.id,
            )
            .one_or_none()
        )
        if existing is None:
            session.add(
                WorkspaceMember(workspace_id=target_ws.id, user_id=user.id, role="member")
            )
        user.current_workspace_id = target_ws.id
        await send_message(
            chat_id,
            f"✅ Подключил тебя к кошельку <b>{target_ws.name or 'Без имени'}</b> и сделал его текущим.",
            reply_markup=MAIN_KEYBOARD,
        )
        await show_wallets(chat_id, user, session)
        return True

    return False


# ---------- dispatcher ----------

COMMAND_RE = re.compile(r"^/([a-zA-Z_]+)(?:@\w+)?(?:\s+(.*))?$", flags=re.DOTALL)

MENU_BUTTONS = {
    "💸 Расход": "menu_expense",
    "💰 Доход": "menu_income",
    "💳 Баланс": "menu_balance",
    "📊 Отчёт": "menu_report",
    "🏦 Долги": "menu_debts",
    "🎯 Цели": "menu_goals",
    "💡 Советы": "menu_advice",
    "🤖 AI": "menu_ai",
    "👛 Кошельки": "menu_wallets",
    "🔗 Код": "menu_link",
}


async def dispatch_update(update: dict[str, Any]) -> None:
    if "callback_query" in update:
        await _dispatch_callback(update["callback_query"])
        return
    message = update.get("message") or update.get("edited_message")
    if not message:
        return
    text = (message.get("text") or "").strip()
    chat = message.get("chat") or {}
    user = message.get("from") or {}
    chat_id = chat.get("id")
    user_id = user.get("id")
    if chat_id is None or user_id is None:
        return
    user_name = user.get("first_name") or user.get("username")

    try:
        with db_session() as session:
            user = _ensure_user(session, user_id, user_name)
            ws = _current_ws(session, user)
            state = _get_state(user)

            # Menu buttons
            if text in MENU_BUTTONS:
                _set_state(user, None)
                action = MENU_BUTTONS[text]
                if action == "menu_expense":
                    _set_state(user, {"flow": "expense_amount"})
                    await send_message(chat_id, "Сколько потратил? Напиши число. Пример: 350")
                elif action == "menu_income":
                    _set_state(user, {"flow": "income_amount"})
                    await send_message(chat_id, "Сколько получил? Напиши число. Пример: 5000")
                elif action == "menu_balance":
                    await show_balance(chat_id, ws)
                elif action == "menu_report":
                    await show_report(chat_id, ws)
                elif action == "menu_debts":
                    await show_debts(chat_id, ws)
                elif action == "menu_goals":
                    await show_goals(chat_id, ws)
                elif action == "menu_advice":
                    await show_advice(chat_id, ws)
                elif action == "menu_ai":
                    await start_ai_flow(chat_id, user)
                elif action == "menu_wallets":
                    await show_wallets(chat_id, user, session)
                elif action == "menu_link":
                    await show_link(chat_id, ws)
                return

            # Active state
            if state and await handle_state_text(chat_id, user, ws, session, state, text):
                return

            # Slash commands
            m = COMMAND_RE.match(text)
            if not m:
                # Loose parsing: bare number → expense
                first = text.split()[0] if text else ""
                if first and _parse_amount(first) is not None:
                    await handle_add_command(chat_id, ws, session, text, "expense")
                    return
                await send_message(
                    chat_id,
                    "Используй кнопки внизу экрана или /start.",
                    reply_markup=MAIN_KEYBOARD,
                )
                return
            cmd = m.group(1).lower()
            rest = (m.group(2) or "").strip()
            if cmd in ("start", "help", "menu"):
                await show_start(chat_id, ws)
            elif cmd == "link":
                await show_link(chat_id, ws)
            elif cmd in ("wallets", "wallet"):
                await show_wallets(chat_id, user, session)
            elif cmd == "add":
                await handle_add_command(chat_id, ws, session, rest, "expense")
            elif cmd == "income":
                await handle_add_command(chat_id, ws, session, rest, "income")
            elif cmd == "balance":
                await show_balance(chat_id, ws)
            elif cmd == "debts":
                await show_debts(chat_id, ws)
            elif cmd == "debt":
                await handle_debt_add_command(chat_id, ws, rest)
            elif cmd == "pay":
                await handle_pay_command(chat_id, ws, session, rest)
            elif cmd == "goals":
                await show_goals(chat_id, ws)
            elif cmd == "advice":
                await show_advice(chat_id, ws)
            elif cmd == "report":
                await show_report(chat_id, ws)
            elif cmd == "ask":
                if rest:
                    await run_ai_question(chat_id, ws, rest)
                else:
                    await start_ai_flow(chat_id, user)
            elif cmd == "cancel":
                _set_state(user, None)
                await send_message(chat_id, "Отменил.", reply_markup=MAIN_KEYBOARD)
            else:
                await send_message(
                    chat_id,
                    "Неизвестная команда. Нажми /start или кнопку меню.",
                    reply_markup=MAIN_KEYBOARD,
                )
    except Exception:
        log.exception("message handler failed")
        try:
            await send_message(chat_id, "Упс, ошибка. Попробуй ещё раз или нажми /start.")
        except Exception:
            pass


async def _dispatch_callback(cb: dict[str, Any]) -> None:
    cb_id = cb.get("id") or ""
    data = cb.get("data") or ""
    message = cb.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    message_id = message.get("message_id")
    user = cb.get("from") or {}
    user_id = user.get("id")
    user_name = user.get("first_name") or user.get("username")
    if chat_id is None or user_id is None:
        await answer_callback(cb_id)
        return

    try:
        with db_session() as session:
            user = _ensure_user(session, user_id, user_name)
            ws = _current_ws(session, user)

            if data == "cancel":
                _set_state(user, None)
                await answer_callback(cb_id, "Отменено")
                if message_id:
                    try:
                        await edit_message_text(
                            chat_id,
                            message_id,
                            "Отменено.",
                        )
                    except Exception:
                        pass
                return

            if data.startswith("exp:") or data.startswith("inc:"):
                state = _get_state(user)
                if state.get("flow") not in ("expense_amount_cat", "income_amount_cat"):
                    await answer_callback(cb_id, "Нажми «💸 Расход» или «💰 Доход» сначала.", alert=True)
                    return
                cat_id = data.split(":", 1)[1]
                cat = session.query(Category).filter(
                    Category.id == cat_id, Category.workspace_id == ws.id
                ).one_or_none()
                amount = float(state.get("amount") or 0)
                type_ = state.get("type") or ("expense" if data.startswith("exp:") else "income")
                account = _default_account(session, ws)
                if amount <= 0 or account is None or cat is None:
                    await answer_callback(cb_id, "Не удалось сохранить.", alert=True)
                    _set_state(user, None)
                    return
                total = _create_tx(
                    session, ws, type_=type_, amount=amount,
                    account_id=account.id, category_id=cat.id,
                )
                _set_state(user, None)
                sign = "+" if type_ == "income" else "−"
                ico = "💼" if type_ == "income" else "🧾"
                text = (
                    f"{ico} Записано: <b>{sign}{_ru(amount)}</b>\n"
                    f"Категория: {cat.name}\n"
                    f"Счёт: {account.name}\n"
                    f"Общий баланс: <b>{_ru(total)}</b>"
                )
                await answer_callback(cb_id, "Сохранено ✓")
                if message_id:
                    try:
                        await edit_message_text(chat_id, message_id, text)
                    except Exception:
                        await send_message(chat_id, text, reply_markup=MAIN_KEYBOARD)
                else:
                    await send_message(chat_id, text, reply_markup=MAIN_KEYBOARD)
                return

            if data.startswith("pay:"):
                debt_id = data.split(":", 1)[1]
                debt = session.query(Debt).filter(
                    Debt.id == debt_id, Debt.workspace_id == ws.id
                ).one_or_none()
                if not debt:
                    await answer_callback(cb_id, "Долг не найден.", alert=True)
                    return
                _set_state(user, {"flow": "pay_amount", "debt_id": debt.id})
                await answer_callback(cb_id)
                remaining = max(0.0, debt.total_amount - debt.paid_amount)
                await send_message(
                    chat_id,
                    f"Сколько погашаешь по «<b>{debt.name}</b>»? Осталось {_ru(remaining)}.\nНапиши число.",
                )
                return

            if data.startswith("goal:"):
                goal_id = data.split(":", 1)[1]
                goal = session.query(Goal).filter(
                    Goal.id == goal_id, Goal.workspace_id == ws.id
                ).one_or_none()
                if not goal:
                    await answer_callback(cb_id, "Цель не найдена.", alert=True)
                    return
                _set_state(user, {"flow": "goal_amount", "goal_id": goal.id})
                await answer_callback(cb_id)
                remaining = max(0.0, goal.target_amount - goal.saved_amount)
                await send_message(
                    chat_id,
                    f"Сколько отложить в «<b>{goal.name}</b>»? До цели {_ru(remaining)}.\nНапиши число.",
                )
                return

            if data.startswith("deldebt:"):
                debt_id = data.split(":", 1)[1]
                debt = session.query(Debt).filter(
                    Debt.id == debt_id, Debt.workspace_id == ws.id
                ).one_or_none()
                if not debt:
                    await answer_callback(cb_id, "Уже удалён.", alert=True)
                    return
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    f"Удалить долг «<b>{debt.name}</b>»? Это не вернёт уже сделанные платежи.",
                    reply_markup=_confirm_keyboard(f"confdeldebt:{debt.id}"),
                )
                return

            if data.startswith("confdeldebt:"):
                debt_id = data.split(":", 1)[1]
                debt = session.query(Debt).filter(
                    Debt.id == debt_id, Debt.workspace_id == ws.id
                ).one_or_none()
                if debt:
                    session.delete(debt)
                await answer_callback(cb_id, "Удалено")
                if message_id:
                    try:
                        await edit_message_text(chat_id, message_id, "🗑 Долг удалён.")
                    except Exception:
                        pass
                return

            if data.startswith("delgoal:"):
                goal_id = data.split(":", 1)[1]
                goal = session.query(Goal).filter(
                    Goal.id == goal_id, Goal.workspace_id == ws.id
                ).one_or_none()
                if not goal:
                    await answer_callback(cb_id, "Уже удалена.", alert=True)
                    return
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    f"Удалить цель «<b>{goal.name}</b>»?",
                    reply_markup=_confirm_keyboard(f"confdelgoal:{goal.id}"),
                )
                return

            if data.startswith("confdelgoal:"):
                goal_id = data.split(":", 1)[1]
                goal = session.query(Goal).filter(
                    Goal.id == goal_id, Goal.workspace_id == ws.id
                ).one_or_none()
                if goal:
                    session.delete(goal)
                await answer_callback(cb_id, "Удалено")
                if message_id:
                    try:
                        await edit_message_text(chat_id, message_id, "🗑 Цель удалена.")
                    except Exception:
                        pass
                return

            if data == "newdebt":
                _set_state(user, {"flow": "new_debt"})
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    "Напиши: <b>Название Сумма [кредитор]</b>\nПример: <code>Кредит 10000 Halkbank</code>",
                )
                return

            if data == "newgoal":
                _set_state(user, {"flow": "new_goal"})
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    "Напиши: <b>Название Сумма</b>\nПример: <code>Ноутбук 10000</code>",
                )
                return

            # ---------- wallet management ----------
            if data == "noop":
                await answer_callback(cb_id)
                return

            if data == "wsnew":
                _set_state(user, {"flow": "new_workspace"})
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    "Как назвать новый кошелёк? Напиши одно слово или фразу.\nПример: <code>Бизнес</code> или <code>Семейный</code>.",
                )
                return

            if data == "wsjoin":
                _set_state(user, {"flow": "join_workspace"})
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    "Напиши 6-значный код кошелька, к которому хочешь подключиться.\nКод можно получить у владельца кошелька — в его боте «👛 Кошельки» → «📤 Пригласить».",
                )
                return

            if data.startswith("wspick:"):
                target_id = data.split(":", 1)[1]
                target_ws = session.get(Workspace, target_id)
                member = (
                    session.query(WorkspaceMember)
                    .filter(
                        WorkspaceMember.workspace_id == target_id,
                        WorkspaceMember.user_id == user.id,
                    )
                    .one_or_none()
                )
                if target_ws is None or member is None:
                    await answer_callback(cb_id, "Этот кошелёк недоступен.", alert=True)
                    return
                user.current_workspace_id = target_ws.id
                _set_state(user, None)
                await answer_callback(cb_id, f"Выбран: {target_ws.name or 'Без имени'}")
                await show_wallets(chat_id, user, session)
                return

            if data.startswith("wsinvite:"):
                target_id = data.split(":", 1)[1]
                target_ws = session.get(Workspace, target_id)
                member = (
                    session.query(WorkspaceMember)
                    .filter(
                        WorkspaceMember.workspace_id == target_id,
                        WorkspaceMember.user_id == user.id,
                    )
                    .one_or_none()
                )
                if target_ws is None or member is None:
                    await answer_callback(cb_id, "Этот кошелёк недоступен.", alert=True)
                    return
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    (
                        f"📤 <b>Приглашение в «{target_ws.name or 'Без имени'}»</b>\n\n"
                        f"Код: <code>{target_ws.link_code}</code>\n\n"
                        "Передай этот код тому, кого хочешь пригласить. Ему нужно:\n"
                        "• в боте @finance_kema_bot написать /start, нажать «👛 Кошельки» → «🔗 Подключиться по коду» и ввести этот код;\n"
                        f"• или на сайте {WEB_URL} в Настройках вставить этот код."
                    ),
                )
                return

            if data.startswith("wsrename:"):
                target_id = data.split(":", 1)[1]
                target_ws = session.get(Workspace, target_id)
                if target_ws is None or not _is_owner(session, user, target_ws):
                    await answer_callback(cb_id, "Только владелец может переименовать.", alert=True)
                    return
                _set_state(user, {"flow": "rename_workspace", "workspace_id": target_id})
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    f"Как переименовать «{target_ws.name or 'Без имени'}»? Напиши новое название.",
                )
                return

            if data.startswith("wsleave:"):
                target_id = data.split(":", 1)[1]
                target_ws = session.get(Workspace, target_id)
                member = (
                    session.query(WorkspaceMember)
                    .filter(
                        WorkspaceMember.workspace_id == target_id,
                        WorkspaceMember.user_id == user.id,
                    )
                    .one_or_none()
                )
                if target_ws is None or member is None:
                    await answer_callback(cb_id, "Ты не состоишь в этом кошельке.", alert=True)
                    return
                if member.role == "owner":
                    await answer_callback(cb_id, "Владелец не может выйти — используй «Удалить».", alert=True)
                    return
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    f"Выйти из кошелька «<b>{target_ws.name or 'Без имени'}</b>»? Операции в нём останутся, но ты перестанешь его видеть.",
                    reply_markup=_confirm_keyboard(f"confwsleave:{target_id}"),
                )
                return

            if data.startswith("confwsleave:"):
                target_id = data.split(":", 1)[1]
                member = (
                    session.query(WorkspaceMember)
                    .filter(
                        WorkspaceMember.workspace_id == target_id,
                        WorkspaceMember.user_id == user.id,
                    )
                    .one_or_none()
                )
                if member is None:
                    await answer_callback(cb_id, "Уже не состоишь.", alert=True)
                    return
                if member.role == "owner":
                    await answer_callback(cb_id, "Владелец не может выйти.", alert=True)
                    return
                session.delete(member)
                if user.current_workspace_id == target_id:
                    user.current_workspace_id = None
                session.flush()
                _current_ws(session, user)  # reassign fallback
                await answer_callback(cb_id, "Вышел из кошелька")
                if message_id:
                    try:
                        await edit_message_text(chat_id, message_id, "🚪 Вышел из кошелька.")
                    except Exception:
                        pass
                await show_wallets(chat_id, user, session)
                return

            if data.startswith("wsdel:"):
                target_id = data.split(":", 1)[1]
                target_ws = session.get(Workspace, target_id)
                if target_ws is None or not _is_owner(session, user, target_ws):
                    await answer_callback(cb_id, "Только владелец может удалять.", alert=True)
                    return
                wallets = _user_workspaces(session, user)
                if len(wallets) <= 1:
                    await answer_callback(cb_id, "Нельзя удалить единственный кошелёк — сначала создай ещё один.", alert=True)
                    return
                await answer_callback(cb_id)
                await send_message(
                    chat_id,
                    (
                        f"Удалить кошелёк «<b>{target_ws.name or 'Без имени'}</b>»?\n"
                        "Это удалит все счета, операции, долги и цели внутри него для всех участников. Это не отменить."
                    ),
                    reply_markup=_confirm_keyboard(f"confwsdel:{target_id}"),
                )
                return

            if data.startswith("confwsdel:"):
                target_id = data.split(":", 1)[1]
                target_ws = session.get(Workspace, target_id)
                if target_ws is None:
                    await answer_callback(cb_id, "Уже удалён.", alert=True)
                    return
                if not _is_owner(session, user, target_ws):
                    await answer_callback(cb_id, "Только владелец может удалять.", alert=True)
                    return
                session.delete(target_ws)
                if user.current_workspace_id == target_id:
                    user.current_workspace_id = None
                session.flush()
                _current_ws(session, user)
                await answer_callback(cb_id, "Кошелёк удалён")
                if message_id:
                    try:
                        await edit_message_text(chat_id, message_id, "🗑 Кошелёк удалён.")
                    except Exception:
                        pass
                await show_wallets(chat_id, user, session)
                return

            await answer_callback(cb_id)
    except Exception:
        log.exception("callback handler failed data=%s", data)
        try:
            await answer_callback(cb_id, "Ошибка, попробуй ещё раз.", alert=True)
        except Exception:
            pass
