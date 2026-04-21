"""Daily reminders about upcoming debts and goals.

Runs as an asyncio background task started from the FastAPI app. Once per
calendar day (Ashgabat time = UTC+5), for each workspace member the bot
delivers a consolidated reminder with:

  - debts whose `due_date` is within the next 7 days (and any overdue ones)
  - goals whose `deadline` is within the next 14 days and not yet completed

Each user gets at most one reminder per day; workspaces/users with nothing
urgent are silently skipped.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from .db import Debt, Goal, User, Workspace, WorkspaceMember, db_session

log = logging.getLogger("reminders")

# Ashgabat is UTC+5 with no DST.
_ASHGABAT_OFFSET = timedelta(hours=5)

DEBT_WINDOW_DAYS = 7
GOAL_WINDOW_DAYS = 14


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except Exception:
        return None


def _fmt_amount(amount: float) -> str:
    return f"{amount:,.2f}".replace(",", " ").replace(".", ",") + " м."


def _fmt_due(d: date, today: date) -> str:
    delta = (d - today).days
    if delta < 0:
        return f"просрочен на {-delta} дн."
    if delta == 0:
        return "сегодня"
    if delta == 1:
        return "завтра"
    return f"через {delta} дн."


def _fmt_deadline(d: date, today: date) -> str:
    delta = (d - today).days
    if delta < 0:
        return f"дедлайн прошёл {-delta} дн. назад"
    if delta == 0:
        return "дедлайн сегодня"
    if delta == 1:
        return "до дедлайна 1 день"
    return f"до дедлайна {delta} дн."


def _collect_user_message(session: Session, user: User, today: date) -> str | None:
    """Build a reminder text for a single user across all their workspaces.

    Returns None if there is nothing to remind about.
    """
    memberships: list[WorkspaceMember] = list(user.memberships)
    if not memberships:
        return None

    debt_window = today + timedelta(days=DEBT_WINDOW_DAYS)
    goal_window = today + timedelta(days=GOAL_WINDOW_DAYS)

    blocks: list[str] = []
    for m in memberships:
        ws: Workspace | None = session.get(Workspace, m.workspace_id)
        if ws is None:
            continue
        debt_lines: list[str] = []
        for d in ws.debts:
            if d.closed_at is not None:
                continue
            due = _parse_date(d.due_date)
            if due is None:
                continue
            if due > debt_window:
                continue
            remaining = max(0.0, float(d.total_amount) - float(d.paid_amount))
            if remaining <= 0.0:
                continue
            creditor = f" ({d.creditor})" if d.creditor else ""
            debt_lines.append(
                f"  • <b>{d.name}</b>{creditor} — осталось {_fmt_amount(remaining)}, {_fmt_due(due, today)}"
            )

        goal_lines: list[str] = []
        for g in ws.goals:
            if g.completed_at is not None:
                continue
            if g.saved_amount >= g.target_amount:
                continue
            deadline = _parse_date(g.deadline)
            if deadline is None:
                continue
            if deadline > goal_window:
                continue
            remaining = max(0.0, float(g.target_amount) - float(g.saved_amount))
            goal_lines.append(
                f"  • <b>{g.name}</b> — нужно ещё {_fmt_amount(remaining)}, {_fmt_deadline(deadline, today)}"
            )

        if not debt_lines and not goal_lines:
            continue

        ws_block = [f"<b>👛 {ws.name or 'Без имени'}</b>"]
        if debt_lines:
            ws_block.append("🏦 Ближайшие платежи:")
            ws_block.extend(debt_lines)
        if goal_lines:
            ws_block.append("🎯 Цели на подходе:")
            ws_block.extend(goal_lines)
        blocks.append("\n".join(ws_block))

    if not blocks:
        return None

    header = "⏰ <b>Напоминания</b>\n"
    footer = (
        "\n\n<i>Открой «🏦 Долги» чтобы погасить, или «💡 Советы» чтобы увидеть "
        "на чём можно сэкономить в этом месяце.</i>"
    )
    return header + "\n\n".join(blocks) + footer


async def _run_reminders_once() -> None:
    """Send reminders to every user who has anything due today."""
    from .bot import send_message  # local import to avoid circulars at startup

    today = (datetime.now(timezone.utc) + _ASHGABAT_OFFSET).date()
    recipients: list[tuple[int, str]] = []
    with db_session() as session:
        users = session.query(User).all()
        for u in users:
            if not u.telegram_id:
                continue
            text = _collect_user_message(session, u, today)
            if text is None:
                continue
            recipients.append((int(u.telegram_id), text))

    for chat_id, text in recipients:
        try:
            await send_message(chat_id, text)
        except Exception:
            log.exception("failed to deliver reminder to %s", chat_id)


async def _reminders_loop() -> None:
    """Sleep until the next Ashgabat 09:00 and fire reminders once per day."""
    # Small defensive delay so we don't hammer on cold-start crash loops.
    await asyncio.sleep(5)
    while True:
        now_utc = datetime.now(timezone.utc)
        now_ash = now_utc + _ASHGABAT_OFFSET
        target_ash = now_ash.replace(hour=9, minute=0, second=0, microsecond=0)
        if now_ash >= target_ash:
            target_ash = target_ash + timedelta(days=1)
        sleep_seconds = max(30.0, (target_ash - now_ash).total_seconds())
        log.info("reminders: sleeping %.0fs until next 09:00 Ashgabat", sleep_seconds)
        try:
            await asyncio.sleep(sleep_seconds)
        except asyncio.CancelledError:
            raise
        try:
            await _run_reminders_once()
        except Exception:
            log.exception("reminders: run failed")


def start_reminders_task() -> asyncio.Task[Any]:
    return asyncio.create_task(_reminders_loop(), name="reminders")
