# Manat — учёт финансов (TMT)

Личное веб-приложение для учёта доходов, расходов, целей накоплений и долгов в туркменских манатах (TMT).
Все данные хранятся локально в браузере (localStorage) — никаких серверов и регистрации.

**Онлайн-версия:** https://dist-tgjbvjlo.devinapps.com

## Возможности
- Учёт доходов и расходов, переводы между счетами
- Счета (наличные, карта, сбережения — можно добавлять свои)
- Категории с иконками и цветами
- Цели накоплений с прогресс-баром
- **Долги** с кнопкой «+ Погасить» и прогрессом выплат
- **Советы по экономии**: на основе ваших расходов за последние 3 месяца предлагает, на чём сократить траты, чтобы быстрее закрыть долги
- Напоминания о регулярных платежах
- Аналитика: динамика за 6 месяцев, расходы по категориям
- Экспорт в CSV / Excel / JSON (резервная копия) + импорт

## Технологии
React 19 + TypeScript, Vite, TailwindCSS, Recharts, date-fns.

---

## Запуск локально

Нужен **Node.js 20+** (скачать: https://nodejs.org/).

```bash
# 1. Распакуйте архив / склонируйте репозиторий
cd finance-tracker

# 2. Установите зависимости (первый раз ~1–2 мин)
npm install

# 3. Запустите dev-сервер
npm run dev
```

Откройте в браузере адрес, который покажет Vite (обычно http://localhost:5173).

### Сборка продакшен-версии
```bash
npm run build
```
После сборки папка `dist/` содержит статические файлы — их можно открыть в любом браузере или положить на любой веб-сервер.

---

## Развёртывание на удалённом сервере

Приложение — **полностью статическое**, бэкенда нет. Подойдёт любой способ хостинга статики:

### Вариант 1: VPS c nginx (например, на arka.com.tm / timeweb / любой)
```bash
npm run build
scp -r dist/* user@your-server:/var/www/manat/
```
Минимальный конфиг nginx:
```nginx
server {
  listen 80;
  server_name manat.example.com;
  root /var/www/manat;
  index index.html;
  location / { try_files $uri /index.html; }
}
```

### Вариант 2: Бесплатный хостинг (клик-и-готово)
- **Vercel**: зайти на https://vercel.com → New Project → Import repo → Deploy. Автоматически определит Vite.
- **Netlify**: https://app.netlify.com → Add new site → Deploy manually → перетащить папку `dist/`.
- **GitHub Pages**: запушить в репозиторий, включить Pages в настройках (для Vite нужно выставить `base: '/repo-name/'` в `vite.config.ts`).
- **Cloudflare Pages**: https://pages.cloudflare.com → Upload → папка `dist/`.

### Вариант 3: Devinapps (уже настроено)
Текущая версия живёт на https://dist-tgjbvjlo.devinapps.com. Чтобы обновить — пересобрать и загрузить папку `dist/` тем же способом.

---

## Резервное копирование данных
Все транзакции, счета, долги и цели хранятся в браузере. Чтобы переехать на другое устройство или не потерять данные:

1. Открыть **Настройки** → **Резервная копия (JSON)** — скачается файл `finance-backup-YYYY-MM-DD.json`.
2. На новом устройстве/браузере: **Настройки** → **Загрузить JSON** — выбрать сохранённый файл.

## Структура проекта
```
src/
  components/   — переиспользуемые компоненты (Modal, TransactionForm, SavingsAdvice…)
  pages/        — страницы (Dashboard, Transactions, Debts, Goals, Analytics…)
  lib/          — бизнес-логика (currency, date, advice, export, storage)
  state/        — Context + useReducer (store.tsx, context.ts, hooks.ts)
  types.ts      — общие TypeScript-типы
```
