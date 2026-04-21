from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from ._config_loader import load_once as _load_env_file

_load_env_file()

from .api import router as api_router  # noqa: E402
from .bot import dispatch_update, set_webhook_sync  # noqa: E402
from .db import init_db  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")

app = FastAPI(title="Manat backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    base = os.environ.get("PUBLIC_BASE_URL")
    if base and os.environ.get("TELEGRAM_BOT_TOKEN"):
        set_webhook_sync(base)
    else:
        log.warning("PUBLIC_BASE_URL or TELEGRAM_BOT_TOKEN missing; skipping webhook setup")


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True}


@app.get("/")
def root() -> dict[str, Any]:
    return {"service": "manat-backend", "status": "ok"}


@app.post("/tg/webhook")
async def tg_webhook(request: Request) -> dict[str, Any]:
    payload = await request.json()
    try:
        await dispatch_update(payload)
    except Exception:
        log.exception("webhook dispatch failed")
    # always 200 so Telegram doesn't retry-bomb us
    return {"ok": True}
