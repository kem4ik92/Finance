import { useState } from "react";
import { useStore } from "../state/context";
import { Modal } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { formatDate, daysUntil, todayIso } from "../lib/date";
import { formatMoney, parseMoney } from "../lib/currency";
import type { Reminder } from "../types";

export function Reminders() {
  const { data, addReminder, updateReminder, deleteReminder, applyReminder } = useStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);

  const sorted = [...data.reminders].sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
  const due = sorted.filter((r) => r.active && daysUntil(r.nextDate) <= 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Напоминания и регулярные платежи</h2>
          <p className="text-sm text-slate-500">
            Подписки, аренда, зарплата — создайте шаблон, и он будет вовремя напоминать о себе.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + Новое напоминание
        </button>
      </div>

      {due.length > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <h3 className="mb-2 text-sm font-semibold text-amber-900">Пора записать ({due.length})</h3>
          <ul className="space-y-2">
            {due.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(r.nextDate)} · {formatMoney(r.amount)}
                  </div>
                </div>
                <button className="btn-primary !py-1.5 text-xs" onClick={() => applyReminder(r.id)}>
                  Добавить операцию
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon="⏰"
          title="Напоминаний пока нет"
          description="Добавьте регулярные доходы и платежи — они будут автоматически учитываться."
          action={
            <button className="btn-primary" onClick={() => setAdding(true)}>
              + Создать напоминание
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sorted.map((r) => {
            const days = daysUntil(r.nextDate);
            const acc = data.accounts.find((a) => a.id === r.accountId);
            const cat = data.categories.find((c) => c.id === r.categoryId);
            return (
              <div key={r.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${
                        r.type === "income" ? "bg-emerald-100" : "bg-rose-100"
                      }`}
                    >
                      {r.type === "income" ? "📥" : "📤"}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{r.title}</div>
                      <div className="text-xs text-slate-500">
                        {acc?.name ?? "—"}
                        {cat ? ` · ${cat.name}` : ""} ·{" "}
                        {r.frequency === "daily"
                          ? "ежедневно"
                          : r.frequency === "weekly"
                          ? "еженедельно"
                          : r.frequency === "monthly"
                          ? "ежемесячно"
                          : "ежегодно"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-sm font-semibold ${
                        r.type === "income" ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {formatMoney(r.type === "income" ? r.amount : -r.amount, { sign: true })}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDate(r.nextDate)}
                      {" · "}
                      {days < 0 ? (
                        <span className="text-rose-600">просрочено на {-days} дн.</span>
                      ) : days === 0 ? (
                        <span className="text-amber-600">сегодня</span>
                      ) : (
                        `через ${days} дн.`
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn-primary !py-1.5 text-xs"
                    onClick={() => applyReminder(r.id)}
                    disabled={!r.active}
                  >
                    Записать сейчас
                  </button>
                  <button
                    className="btn-secondary !py-1.5 text-xs"
                    onClick={() => updateReminder({ ...r, active: !r.active })}
                  >
                    {r.active ? "На паузу" : "Возобновить"}
                  </button>
                  <button className="btn-secondary !py-1.5 text-xs" onClick={() => setEditing(r)}>
                    Изменить
                  </button>
                  <button
                    className="btn-danger !py-1.5 text-xs"
                    onClick={() => {
                      if (confirm(`Удалить напоминание «${r.title}»?`)) deleteReminder(r.id);
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Новое напоминание">
        <ReminderForm onDone={() => setAdding(false)} onSubmit={(r) => addReminder(r)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Напоминание">
        {editing && (
          <ReminderForm
            initial={editing}
            onDone={() => setEditing(null)}
            onSubmit={(r) => updateReminder({ ...editing, ...r })}
          />
        )}
      </Modal>
    </div>
  );
}

function ReminderForm({
  initial,
  onSubmit,
  onDone,
}: {
  initial?: Reminder;
  onSubmit: (r: Omit<Reminder, "id" | "createdAt">) => void;
  onDone: () => void;
}) {
  const { data } = useStore();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [type, setType] = useState<Reminder["type"]>(initial?.type ?? "expense");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? data.accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [frequency, setFrequency] = useState<Reminder["frequency"]>(initial?.frequency ?? "monthly");
  const [nextDate, setNextDate] = useState(initial?.nextDate ?? todayIso());
  const [active, setActive] = useState(initial?.active ?? true);

  const categories = data.categories.filter((c) => c.type === type);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const a = parseMoney(amount);
        if (!title.trim() || !(a > 0) || !accountId) return;
        onSubmit({
          title: title.trim(),
          type,
          amount: a,
          accountId,
          categoryId: categoryId || undefined,
          frequency,
          nextDate,
          active,
        });
        onDone();
      }}
      className="space-y-4"
    >
      <div>
        <label className="label" htmlFor="rem-title">Название</label>
        <input
          id="rem-title"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Аренда квартиры"
          required
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="rem-type">Тип</label>
          <select
            id="rem-type"
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as Reminder["type"])}
          >
            <option value="expense">Расход</option>
            <option value="income">Доход</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rem-amount">Сумма (TMT)</label>
          <input
            id="rem-amount"
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="rem-account">Счёт</label>
          <select
            id="rem-account"
            className="input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rem-category">Категория</label>
          <select
            id="rem-category"
            className="input"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">— без категории —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="rem-freq">Периодичность</label>
          <select
            id="rem-freq"
            className="input"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Reminder["frequency"])}
          >
            <option value="daily">Ежедневно</option>
            <option value="weekly">Еженедельно</option>
            <option value="monthly">Ежемесячно</option>
            <option value="yearly">Ежегодно</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rem-date">Следующая дата</label>
          <input
            id="rem-date"
            className="input"
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Активно
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-ghost" onClick={onDone}>
          Отмена
        </button>
        <button type="submit" className="btn-primary">
          Сохранить
        </button>
      </div>
    </form>
  );
}
