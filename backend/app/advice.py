from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

from .db import Category, Debt, Transaction


ESSENTIAL_IDS = {"cat-rent", "cat-utilities", "cat-health", "cat-education", "cat-family", "cat-transport"}
DISCRETIONARY_IDS = {"cat-cafe", "cat-entertainment", "cat-clothes", "cat-gifts"}


def _strip_prefix(cat_id: Optional[str]) -> Optional[str]:
    """Map workspace-scoped category id `<ws>:cat-food` → `cat-food`."""
    if not cat_id:
        return None
    return cat_id.split(":", 1)[-1]


@dataclass
class SavingsTip:
    category_id: Optional[str]
    name: str
    icon: str
    color: str
    monthly: float
    cut_share: float
    monthly_savings: float

    @property
    def message(self) -> str:
        pct = round(self.cut_share * 100)
        return (f"Сократите «{self.name}» на {pct}% — "
                f"это освободит ~{round(self.monthly_savings)} м./мес. на погашение долгов.")


@dataclass
class DebtAdvice:
    total_remaining: float
    monthly_income: float
    monthly_expense: float
    months_analysed: int
    tips: list[SavingsTip]
    months_at_current_pace: Optional[float]
    months_with_cuts: Optional[float]


def _cut_share_for(cat_id: Optional[str], share: float) -> float:
    if not cat_id:
        return min(0.3, 0.1 + share)
    if cat_id in DISCRETIONARY_IDS:
        return 0.3
    if cat_id in ESSENTIAL_IDS:
        return 0.1
    return 0.2


def _months_window(lookback: int) -> set[str]:
    today = date.today()
    out: set[str] = set()
    y, m = today.year, today.month
    for _ in range(lookback):
        out.add(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return out


def compute_advice(
    *,
    transactions: Iterable[Transaction],
    categories: Iterable[Category],
    debts: Iterable[Debt],
    lookback: int = 3,
) -> DebtAdvice:
    window = _months_window(lookback)
    tx_in_window = [t for t in transactions if (t.date or "")[:7] in window]

    active_months = {(t.date or "")[:7] for t in tx_in_window if (t.date or "")}
    months_analysed = max(1, len(active_months))

    income = 0.0
    expense = 0.0
    by_cat: dict[str, float] = {}
    for t in tx_in_window:
        if t.type == "income":
            income += t.amount
        elif t.type == "expense":
            expense += t.amount
            key = t.category_id or "__none__"
            by_cat[key] = by_cat.get(key, 0.0) + t.amount

    cat_index: dict[str, Category] = {c.id: c for c in categories}

    total_remaining = sum(
        max(0.0, d.total_amount - d.paid_amount) for d in debts if not d.closed_at
    )

    tips: list[SavingsTip] = []
    for key, amount in sorted(by_cat.items(), key=lambda kv: kv[1], reverse=True):
        cat = cat_index.get(key) if key != "__none__" else None
        cat_id_stripped = _strip_prefix(cat.id) if cat else None
        share = amount / expense if expense > 0 else 0.0
        monthly = amount / months_analysed
        cut_share = _cut_share_for(cat_id_stripped, share)
        monthly_savings = monthly * cut_share
        if monthly_savings <= 0:
            continue
        tips.append(SavingsTip(
            category_id=cat_id_stripped,
            name=cat.name if cat else "Без категории",
            icon=(cat.icon if cat else "•") or "•",
            color=(cat.color if cat else "#94a3b8") or "#94a3b8",
            monthly=monthly,
            cut_share=cut_share,
            monthly_savings=monthly_savings,
        ))
    tips.sort(key=lambda t: t.monthly_savings, reverse=True)
    tips = tips[:3]

    monthly_income = income / months_analysed
    monthly_expense = expense / months_analysed
    cushion = monthly_income - monthly_expense
    total_savings = sum(t.monthly_savings for t in tips)
    pace_with_cuts = cushion + total_savings

    return DebtAdvice(
        total_remaining=total_remaining,
        monthly_income=monthly_income,
        monthly_expense=monthly_expense,
        months_analysed=months_analysed,
        tips=tips,
        months_at_current_pace=(
            total_remaining / cushion if cushion > 0 and total_remaining > 0 else None
        ),
        months_with_cuts=(
            total_remaining / pace_with_cuts if pace_with_cuts > 0 and total_remaining > 0 else None
        ),
    )
