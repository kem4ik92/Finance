from __future__ import annotations

import os
import secrets
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


DB_PATH = os.environ.get("DB_PATH", "/data/manat.db")
# On Fly, /data is a volume; fall back to a local file in dev.
if not os.path.isdir(os.path.dirname(DB_PATH)):
    DB_PATH = os.path.abspath(os.environ.get("DB_FALLBACK", "manat.db"))

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_dt() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


def _new_code(n: int = 6) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(n))


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    link_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    telegram_id: Mapped[Optional[int]] = mapped_column(Integer, index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_dt)
    name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    pending_state: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    accounts: Mapped[list["Account"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    categories: Mapped[list["Category"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    transactions: Mapped[list["Transaction"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    debts: Mapped[list["Debt"]] = relationship(cascade="all, delete-orphan", lazy="selectin")
    goals: Mapped[list["Goal"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(32), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    type: Mapped[str] = mapped_column(String(16))  # cash|card|savings|other
    opening_balance: Mapped[float] = mapped_column(Float, default=0.0)
    color: Mapped[str] = mapped_column(String(16), default="#2186ff")
    icon: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_dt)




class Category(Base):
    __tablename__ = "categories"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(32), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    type: Mapped[str] = mapped_column(String(16))  # income|expense
    color: Mapped[str] = mapped_column(String(16), default="#94a3b8")
    icon: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(32), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(16))  # income|expense|transfer
    amount: Mapped[float] = mapped_column(Float)
    account_id: Mapped[str] = mapped_column(String(64))
    to_account_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    category_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    date: Mapped[str] = mapped_column(String(16))  # ISO YYYY-MM-DD
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_dt)

    workspace: Mapped[Workspace] = relationship(back_populates="transactions")


class Debt(Base):
    __tablename__ = "debts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(32), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    total_amount: Mapped[float] = mapped_column(Float)
    paid_amount: Mapped[float] = mapped_column(Float, default=0.0)
    creditor: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    due_date: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    color: Mapped[str] = mapped_column(String(16), default="#ef4444")
    icon: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_dt)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Goal(Base):
    __tablename__ = "goals"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(32), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    target_amount: Mapped[float] = mapped_column(Float)
    saved_amount: Mapped[float] = mapped_column(Float, default=0.0)
    deadline: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    color: Mapped[str] = mapped_column(String(16), default="#2186ff")
    icon: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_dt)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


def init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True) if os.path.dirname(DB_PATH) else None
    Base.metadata.create_all(engine)
    # Lightweight additive migrations for SQLite.
    with engine.begin() as conn:
        cols = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(workspaces)").fetchall()}
        if "pending_state" not in cols:
            conn.exec_driver_sql("ALTER TABLE workspaces ADD COLUMN pending_state TEXT")


@contextmanager
def db_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def new_workspace_id() -> str:
    return secrets.token_urlsafe(12)


def new_link_code() -> str:
    return _new_code(6)
