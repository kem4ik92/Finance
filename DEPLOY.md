# Manat — self-hosting guide

This document describes how to run **Manat** (web app + backend + Telegram bot) on
your own machine or server, so your data never leaves your hardware.

Manat has three parts:

| Часть          | Что это                                    | Где живёт                |
|----------------|--------------------------------------------|--------------------------|
| **Frontend**   | Статичный сайт (HTML/CSS/JS, React + Vite) | любой HTTPS-хостинг      |
| **Backend**    | Python API на FastAPI + SQLite             | VPS, Docker, Fly.io, etc |
| **Telegram-бот** | встроен в backend (webhook)              | тот же процесс           |

Данные (балансы, транзакции, долги, цели) хранятся **только в backend**, в одном файле
`manat.db`. Frontend ничего не хранит, кроме «какой кошелёк я открыл в этом браузере».

---

## 0. Архитектура доступа

```
┌──────────┐   code + PIN   ┌──────────┐   /start    ┌─────────────┐
│ Frontend │ ─────────────> │ Backend  │ <─────────  │ Telegram API│
│  (site)  │ <───── token ──│ + bot    │             └─────────────┘
└──────────┘   Bearer       └──────────┘
                                   │
                                   ▼
                               manat.db
```

* 6-значный **code** показывается в боте (кнопка «🔗 Код») — это «публичный идентификатор» кошелька.
* Владелец кошелька может установить **PIN** («🔒 Поставить код-пароль») — тогда без PIN сайт ничего не отдаст.
* После успешной пары `(code + PIN)` сайт получает **Bearer-токен** и хранит его в `localStorage`. Любая смена PIN в боте сразу разлогинивает все сессии.
* Для незащищённого кошелька (PIN не задан) сайт работает по коду без PIN — как раньше.

---

## 1. Требования

* **Backend**: Python ≥ 3.11, ~50 MB диска, исходящий интернет (Telegram + OpenRouter).
* **Frontend**: любой статик-хостинг с HTTPS (nginx, Vercel, Netlify, Cloudflare Pages, S3+CloudFront, …).
* **HTTPS на backend обязателен** — Telegram отказывается отправлять webhook-обновления на http://. Если у тебя нет TLS, поставь Caddy — он сам получит сертификат от Let’s Encrypt.
* **Домен или публичный HTTPS-URL** для backend (пример: `https://api.my-finance.example`).

---

## 2. Backend — ручной запуск (без Docker)

```bash
# 1. Клонируем и ставим зависимости
git clone https://github.com/kem4ik92/Finance.git
cd Finance/backend
python -m venv .venv
source .venv/bin/activate
pip install -e .

# 2. Создаём файл с секретами
cp .secrets.env.example .secrets.env   # или создай руками, см. ниже
```

Формат `backend/.secrets.env`:

```env
TELEGRAM_BOT_TOKEN=123456789:AA...              # @BotFather → /newbot
PUBLIC_BASE_URL=https://api.my-finance.example  # HTTPS, без слэша в конце
OPENROUTER_API_KEY=sk-or-v1-...                 # опционально, для кнопки «🤖 AI»
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free # опционально
MANAT_DB_PATH=/var/lib/manat/manat.db            # опционально, куда класть БД
```

> ⚠️ `.secrets.env` уже указан в `.gitignore` — его никогда не коммить.

Запуск:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Проверка: `curl http://localhost:8080/healthz` → `{"ok": true}`.

### systemd-юнит (для продакшена)

`/etc/systemd/system/manat.service`:

```ini
[Unit]
Description=Manat backend
After=network.target

[Service]
Type=simple
User=manat
WorkingDirectory=/opt/manat/backend
EnvironmentFile=/opt/manat/backend/.secrets.env
ExecStart=/opt/manat/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8080
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now manat
```

### nginx + Let’s Encrypt

```nginx
server {
    server_name api.my-finance.example;
    listen 443 ssl;

    ssl_certificate     /etc/letsencrypt/live/api.my-finance.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.my-finance.example/privkey.pem;

    client_max_body_size 5m;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

`sudo certbot --nginx -d api.my-finance.example` — получить TLS-сертификат.

### Caddy (один файл, TLS автоматом)

`/etc/caddy/Caddyfile`:

```
api.my-finance.example {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

---

## 3. Backend — Docker

`backend/Dockerfile` уже есть в репе. Собрать и запустить:

```bash
docker build -t manat-backend ./backend
docker run -d --name manat \
  -p 8080:8080 \
  -v /srv/manat-data:/data \
  -e TELEGRAM_BOT_TOKEN=... \
  -e PUBLIC_BASE_URL=https://api.my-finance.example \
  -e OPENROUTER_API_KEY=... \
  -e MANAT_DB_PATH=/data/manat.db \
  --restart unless-stopped \
  manat-backend
```

**Важно**: примонтируй `/data` (или другую папку) как volume — иначе БД потеряется
при пересоздании контейнера.

### Fly.io (как у нас в продакшене)

```bash
cd backend
fly launch          # выберет имя, регион, создаст fly.toml
fly volumes create manat_data --size 1 --region <reg>
fly secrets set TELEGRAM_BOT_TOKEN=...
fly secrets set PUBLIC_BASE_URL=https://<appname>.fly.dev
fly secrets set OPENROUTER_API_KEY=...
fly secrets set MANAT_DB_PATH=/data/manat.db
fly deploy
```

В `fly.toml` убедись, что том `manat_data` смонтирован в `/data`.

---

## 4. Frontend

```bash
# в корне репо, НЕ в backend/
npm install
# настрой адрес своего backend (см. ниже) и:
npm run build
# результат: папка dist/ — статика, которую можно положить куда угодно
```

### Настройка адреса backend

В `src/lib/sync.ts` есть строка:

```ts
const DEFAULT_API_BASE = "https://manat-backend-txrnbhuq.fly.dev";
```

Замени её на свой URL и пересобери. Альтернатива: не трогать код — тогда пользователь
сам впишет `apiBase` в `localStorage` через DevTools. Простой путь — пропатчить.

### Варианты хостинга frontend

| Хостинг                | Шаги                                                          |
|------------------------|---------------------------------------------------------------|
| **nginx у себя**       | `scp -r dist/* user@server:/var/www/manat/` + блок ниже       |
| **Vercel / Netlify**   | Подключить репо, build command `npm run build`, dir `dist`    |
| **Cloudflare Pages**   | Framework preset: Vite, build command `npm run build`         |
| **GitHub Pages**       | `npm run build`, коммитить `dist/` в ветку `gh-pages`         |
| **Локально, офлайн**   | Открыть `dist/index.html` напрямую — работает и без сервера   |

Блок nginx (для статики + SPA-fallback):

```nginx
server {
    listen 443 ssl;
    server_name my-finance.example;

    root /var/www/manat;
    index index.html;

    ssl_certificate     /etc/letsencrypt/live/my-finance.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/my-finance.example/privkey.pem;

    location / {
        try_files $uri /index.html;
    }

    # Долгий кэш для хешированных ассетов
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## 5. Защита данных

Два уровня, оба опциональные и дополняют друг друга:

### 5.1 PIN кошелька (рекомендуется)

1. В боте: **👛 Кошельки** → выбери кошелёк → **🔒 Поставить код-пароль**.
2. Придумай 4–32 символа. Бот хранит только `sha256(salt + pin)` — сам PIN не восстановить.
3. На сайте при подключении спросят и **код**, и **PIN**.
4. Смена PIN мгновенно разлогинивает все устройства (токены в таблице `workspace_sessions` удаляются).
5. Убрать PIN: **❌ Снять код-пароль** — кошелёк снова открывается только по коду.

### 5.2 HTTP Basic на frontend (опционально)

Если хочешь закрыть сам сайт от посторонних (не только данные):

```nginx
location / {
    auth_basic           "Manat";
    auth_basic_user_file /etc/nginx/.manat-htpasswd;
    try_files $uri /index.html;
}
```

```bash
sudo htpasswd -c /etc/nginx/.manat-htpasswd kemal
```

Теперь при открытии сайта браузер будет спрашивать логин/пароль ДО того, как покажет
форму подключения.

### 5.3 Ротация секретов

* Telegram-токен: **@BotFather → `/revoke`** → перевыпустить → обновить `TELEGRAM_BOT_TOKEN` в `.secrets.env` / `fly secrets set` → перезапустить backend.
* OpenRouter-ключ: https://openrouter.ai/keys → Revoke → создать новый → обновить `OPENROUTER_API_KEY` → перезапустить.
* Любой Bearer-токен сайта можно «убить» из бота сменой PIN на соответствующем кошельке.

---

## 6. Резервная копия БД

Вся твоя финансовая история — в одном файле `manat.db`.

**Ручной бэкап** (пока backend работает):

```bash
sqlite3 /var/lib/manat/manat.db ".backup '/var/lib/manat/backup-$(date +%F).db'"
```

Безопасно в любой момент — SQLite гарантирует консистентность снапшота.

**Ежедневно по cron**:

```cron
15 3 * * *  /usr/bin/sqlite3 /var/lib/manat/manat.db ".backup '/var/backups/manat-$(date +\%F).db'" && find /var/backups/manat-*.db -mtime +30 -delete
```

**Для Docker-установки**:

```bash
docker exec manat sqlite3 /data/manat.db ".backup '/data/backup-$(date +%F).db'"
```

**Для Fly.io**:

```bash
fly ssh sftp get /data/manat.db manat-$(date +%F).db
```

**Восстановление**: просто положи `manat.db` обратно по пути `MANAT_DB_PATH` и
перезапусти backend. Никаких миграций вручную запускать не нужно — бот сам
добавит недостающие колонки при следующем старте.

---

## 7. Обновления

```bash
cd Finance
git pull
cd backend
source .venv/bin/activate
pip install -e .
sudo systemctl restart manat
cd ..
npm install
npm run build
sudo rsync -a --delete dist/ /var/www/manat/
```

Docker:

```bash
git pull
docker build -t manat-backend ./backend
docker stop manat && docker rm manat
docker run -d ... manat-backend   # команда из раздела 3
```

Fly.io:

```bash
git pull
cd backend && fly deploy
```

---

## 8. Ежедневные напоминания

Backend сам запускает фоновую задачу, которая каждый день в **09:00 по Ашхабаду**
(UTC+5) проверяет у всех пользователей:

* долги с `due_date` в пределах ближайших 7 дней (и уже просроченные, пока `closed_at == NULL`);
* цели с `deadline` в пределах 14 дней.

Если есть что напомнить — бот пришлёт одним сообщением сводку по всем кошелькам
пользователя. Если нечего — ничего не отправляется. Ничего настраивать не надо;
достаточно чтобы backend работал 24/7.

Если backend лежал на момент 09:00 — уведомления за этот день пропускаются. Ничего
страшного: на следующий день придёт актуальный список.

---

## 9. Частые проблемы

| Симптом                                         | Решение                                                                 |
|--------------------------------------------------|-------------------------------------------------------------------------|
| «PUBLIC_BASE_URL missing; skipping webhook»     | Добавь `PUBLIC_BASE_URL` в `.secrets.env`, перезапусти.                  |
| Бот отвечает, но сайт не видит данных           | Проверь `DEFAULT_API_BASE` в `src/lib/sync.ts` и CORS (`allow_origins`). |
| 401 «pin required»                              | У кошелька включён PIN — введи его на сайте, или сними в боте.           |
| После смены PIN сайт показывает старые данные    | Нажми «Отключить», подключись заново — токен разлогинен намеренно.       |
| Telegram «webhook returned 502»                  | Backend упал или не слушает. Смотри `journalctl -u manat -f`.            |
| AI-кнопка отвечает «нет ключа»                   | `OPENROUTER_API_KEY` отсутствует или неверный.                           |
| На мобильном форма «прыгает» при фокусе         | Обнови сайт — в `index.html` мы выставляем `viewport` и `font-size:16px` на input’ах. |

---

## 10. Что точно **нельзя** коммитить в git

* `backend/.secrets.env` — там токены бота и AI.
* `backend/manat.db` и любые `*.db`, `*.sqlite`, `*.sqlite3`.
* Папки `.venv/`, `node_modules/`, `dist/`.
* Личные JSON-бэкапы из «Настройки → Резервная копия».

Всё это уже указано в `.gitignore`, но стоит проверить `git status` перед каждым коммитом.
