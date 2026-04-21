from __future__ import annotations

from .db import Account, Category, Workspace, now_iso

DEFAULT_ACCOUNTS = [
    {"id": "acc-cash", "name": "Наличные", "type": "cash", "color": "#22c55e", "icon": "💵"},
    {"id": "acc-card", "name": "Карта", "type": "card", "color": "#2186ff", "icon": "💳"},
    {"id": "acc-savings", "name": "Сбережения", "type": "savings", "color": "#a855f7", "icon": "🏦"},
]

DEFAULT_CATEGORIES = [
    # Expenses
    {"id": "cat-food", "name": "Продукты", "type": "expense", "color": "#f97316", "icon": "🛒"},
    {"id": "cat-cafe", "name": "Кафе и рестораны", "type": "expense", "color": "#ef4444", "icon": "🍽️"},
    {"id": "cat-transport", "name": "Транспорт", "type": "expense", "color": "#0ea5e9", "icon": "🚌"},
    {"id": "cat-utilities", "name": "Коммунальные", "type": "expense", "color": "#64748b", "icon": "💡"},
    {"id": "cat-rent", "name": "Аренда", "type": "expense", "color": "#7c3aed", "icon": "🏠"},
    {"id": "cat-health", "name": "Здоровье", "type": "expense", "color": "#16a34a", "icon": "💊"},
    {"id": "cat-clothes", "name": "Одежда", "type": "expense", "color": "#db2777", "icon": "👕"},
    {"id": "cat-education", "name": "Образование", "type": "expense", "color": "#0891b2", "icon": "📚"},
    {"id": "cat-entertainment", "name": "Развлечения", "type": "expense", "color": "#f59e0b", "icon": "🎮"},
    {"id": "cat-gifts", "name": "Подарки", "type": "expense", "color": "#e11d48", "icon": "🎁"},
    {"id": "cat-family", "name": "Семья и дети", "type": "expense", "color": "#d946ef", "icon": "👨‍👩‍👧"},
    {"id": "cat-other-exp", "name": "Прочее", "type": "expense", "color": "#94a3b8", "icon": "•"},
    # Income
    {"id": "cat-salary", "name": "Зарплата", "type": "income", "color": "#10b981", "icon": "💼"},
    {"id": "cat-bonus", "name": "Премия", "type": "income", "color": "#22c55e", "icon": "🎖️"},
    {"id": "cat-gift-in", "name": "Подарок", "type": "income", "color": "#84cc16", "icon": "🎁"},
    {"id": "cat-freelance", "name": "Фриланс", "type": "income", "color": "#14b8a6", "icon": "💻"},
    {"id": "cat-other-inc", "name": "Прочее", "type": "income", "color": "#06b6d4", "icon": "•"},
]


def seed_defaults(session, workspace: Workspace) -> None:
    for a in DEFAULT_ACCOUNTS:
        session.add(Account(
            id=f"{workspace.id}:{a['id']}",
            workspace_id=workspace.id,
            name=a["name"], type=a["type"], opening_balance=0.0,
            color=a["color"], icon=a["icon"],
        ))
    for c in DEFAULT_CATEGORIES:
        session.add(Category(
            id=f"{workspace.id}:{c['id']}",
            workspace_id=workspace.id,
            name=c["name"], type=c["type"],
            color=c["color"], icon=c["icon"],
        ))
