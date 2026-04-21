"""
Light-weight OpenRouter client used by the Telegram bot to answer free-form
questions about a user's finances. Stateless: each call builds a fresh prompt
from the current workspace snapshot.
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Optional

import httpx

from .db import Account, Category, Debt, Goal, Transaction, Workspace

log = logging.getLogger("ai")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free"
REQUEST_TIMEOUT = 60.0
MAX_CONTEXT_TX = 60  # most recent transactions included in the prompt


def _api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    return key


def _model() -> str:
    return os.environ.get("OPENROUTER_MODEL", "").strip() or DEFAULT_MODEL


def _fmt_amount(n: float) -> str:
    s = f"{n:,.2f}".replace(",", " ").replace(".", ",")
    return f"{s} м."


@dataclass
class SnapshotContext:
    text: str
    token_estimate: int


def build_snapshot(ws: Workspace) -> SnapshotContext:
    """
    Render a concise markdown summary of the workspace the LLM can reason over.
    Keeps it under a few KB so we stay well within Gemma's context window.
    """
    today = date.today().isoformat()
    lines: list[str] = [f"# Финансовый снимок (на {today})", ""]

    # --- Accounts + balance ---
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
    total = sum(by_acc.values())
    lines.append("## Счета")
    for a in ws.accounts:
        v = by_acc.get(a.id, a.opening_balance)
        lines.append(f"- {a.name}: {_fmt_amount(v)}")
    lines.append(f"**Общий баланс: {_fmt_amount(total)}**")
    lines.append("")

    # --- Categories (for reference) ---
    cat_by_id = {c.id: c for c in ws.categories}

    # --- Last 3 months: income, expense, top categories ---
    today_d = date.today()
    months: list[str] = []
    for i in range(3):
        y = today_d.year + (today_d.month - 1 - i) // 12
        m = (today_d.month - 1 - i) % 12 + 1
        months.append(f"{y:04d}-{m:02d}")
    months.reverse()

    per_month_income: dict[str, float] = defaultdict(float)
    per_month_expense: dict[str, float] = defaultdict(float)
    per_month_cat: dict[tuple[str, str], float] = defaultdict(float)
    for t in ws.transactions:
        ym = (t.date or "")[:7]
        if ym not in months:
            continue
        if t.type == "income":
            per_month_income[ym] += t.amount
        elif t.type == "expense":
            per_month_expense[ym] += t.amount
            cat_name = cat_by_id[t.category_id].name if t.category_id in cat_by_id else "Без категории"
            per_month_cat[(ym, cat_name)] += t.amount

    lines.append("## Последние 3 месяца")
    for ym in months:
        inc = per_month_income.get(ym, 0.0)
        exp = per_month_expense.get(ym, 0.0)
        lines.append(f"- {ym}: доходы {_fmt_amount(inc)}, расходы {_fmt_amount(exp)}, баланс {_fmt_amount(inc - exp)}")
    lines.append("")

    # Top categories over last 3 months
    cat_totals: dict[str, float] = defaultdict(float)
    for (_ym, cname), v in per_month_cat.items():
        cat_totals[cname] += v
    if cat_totals:
        lines.append("## Топ категорий расходов (за 3 мес.)")
        top = sorted(cat_totals.items(), key=lambda kv: kv[1], reverse=True)[:8]
        for name, v in top:
            monthly = v / len(months)
            lines.append(f"- {name}: {_fmt_amount(v)} всего · {_fmt_amount(monthly)}/мес.")
        lines.append("")

    # --- Debts ---
    active_debts = [d for d in ws.debts if not d.closed_at]
    if active_debts:
        lines.append("## Активные долги")
        total_remaining = 0.0
        for d in active_debts:
            remaining = max(0.0, d.total_amount - d.paid_amount)
            total_remaining += remaining
            cred = f" ({d.creditor})" if d.creditor else ""
            due = f", срок {d.due_date}" if d.due_date else ""
            lines.append(
                f"- {d.name}{cred}: осталось {_fmt_amount(remaining)} из {_fmt_amount(d.total_amount)}{due}"
            )
        lines.append(f"**Всего остаток по долгам: {_fmt_amount(total_remaining)}**")
        lines.append("")

    # --- Goals ---
    active_goals = [g for g in ws.goals if not g.completed_at]
    if active_goals:
        lines.append("## Цели накоплений")
        for g in active_goals:
            remaining = max(0.0, g.target_amount - g.saved_amount)
            dl = f", дедлайн {g.deadline}" if g.deadline else ""
            lines.append(
                f"- {g.name}: накоплено {_fmt_amount(g.saved_amount)} из {_fmt_amount(g.target_amount)}, осталось {_fmt_amount(remaining)}{dl}"
            )
        lines.append("")

    # --- Recent transactions ---
    txs = sorted(
        ws.transactions,
        key=lambda t: (t.date or "", t.created_at or datetime.min),
        reverse=True,
    )[:MAX_CONTEXT_TX]
    if txs:
        lines.append(f"## Последние {len(txs)} операций")
        for t in txs:
            cat_name = cat_by_id[t.category_id].name if t.category_id in cat_by_id else "—"
            note = f" · {t.note}" if t.note else ""
            sign = "+" if t.type == "income" else "-" if t.type == "expense" else "↔"
            lines.append(f"- {t.date} {sign}{_fmt_amount(t.amount)} [{cat_name}]{note}")
        lines.append("")

    text = "\n".join(lines)
    return SnapshotContext(text=text, token_estimate=len(text) // 3)


SYSTEM_PROMPT = (
    "Ты — личный финансовый ассистент. Отвечаешь коротко, конкретно, по-русски. "
    "Всегда используй валюту «туркменский манат» (сокращённо «м.»). "
    "Используй только цифры из снимка, не выдумывай транзакции. "
    "Если данных не хватает — скажи прямо. Давай практические советы. "
    "Формат: компактный, без Markdown-заголовков; можно списки через «— »."
)


async def answer_question(ws: Workspace, question: str) -> str:
    key = _api_key()
    model = _model()
    snapshot = build_snapshot(ws)
    user_content = (
        f"{snapshot.text}\n\n---\n"
        f"Вопрос пользователя: {question.strip()}"
    )
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.3,
        "max_tokens": 512,
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://dist-tgjbvjlo.devinapps.com",
        "X-Title": "Manat Finance Bot",
    }
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        try:
            r = await client.post(OPENROUTER_URL, json=payload, headers=headers)
        except httpx.RequestError as exc:
            log.warning("openrouter network error: %s", exc)
            raise RuntimeError("Не могу достучаться до AI. Попробуй через минуту.")
    if r.status_code >= 300:
        log.warning("openrouter %s: %s", r.status_code, r.text[:300])
        if r.status_code == 401:
            raise RuntimeError("AI не авторизован — проверь OPENROUTER_API_KEY.")
        if r.status_code == 429:
            raise RuntimeError("Слишком много запросов к AI. Подожди минуту.")
        raise RuntimeError(f"AI вернул ошибку {r.status_code}.")
    data: dict[str, Any] = {}
    try:
        data = r.json()
    except Exception:
        raise RuntimeError("AI вернул некорректный ответ.")
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        log.warning("openrouter unexpected shape: %s", data)
        raise RuntimeError("AI не ответил. Попробуй переформулировать вопрос.")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("AI ответил пусто. Попробуй переформулировать вопрос.")
    return content.strip()


def ai_available() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY", "").strip())
