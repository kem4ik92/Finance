import { useState } from "react";
import { useStore } from "../state/context";
import { formatMoney, parseMoney } from "../lib/currency";
import { daysUntil, formatDate } from "../lib/date";
import { Modal } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import { SavingsAdvice } from "../components/SavingsAdvice";
import type { Debt } from "../types";

const DEBT_ICONS = ["💳", "🏦", "🧾", "🏠", "🚗", "📱", "🎓", "🤝", "💸", "📉"];
const DEBT_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#a855f7", "#2186ff", "#14b8a6"];

export function Debts() {
  const { data, addDebt, updateDebt, deleteDebt, payDebt } = useStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [paying, setPaying] = useState<Debt | null>(null);

  const openDebts = data.debts.filter((d) => !d.closedAt);
  const closedDebts = data.debts.filter((d) => d.closedAt);
  const totalRemaining = openDebts.reduce(
    (sum, d) => sum + Math.max(0, d.totalAmount - d.paidAmount),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Долги</h2>
          <p className="text-sm text-slate-500">
            Отслеживайте, сколько осталось выплатить, и получайте советы, как закрыть быстрее.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + Новый долг
        </button>
      </div>

      {openDebts.length > 0 && (
        <div className="card bg-gradient-to-br from-rose-500 to-rose-700 text-white">
          <div className="text-xs font-medium opacity-80">Всего осталось выплатить</div>
          <div className="mt-1 text-2xl font-bold">{formatMoney(totalRemaining)}</div>
          <div className="mt-1 text-xs opacity-80">
            Активных долгов: {openDebts.length}
            {closedDebts.length > 0 ? ` · закрыто: ${closedDebts.length}` : ""}
          </div>
        </div>
      )}

      <SavingsAdvice />

      {data.debts.length === 0 ? (
        <EmptyState
          icon="💳"
          title="Пока нет долгов"
          description="Добавьте кредит или долг другу, чтобы видеть прогресс выплат и получать советы по экономии."
          action={
            <button className="btn-primary" onClick={() => setAdding(true)}>
              + Добавить долг
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.debts.map((d) => {
            const remaining = Math.max(0, d.totalAmount - d.paidAmount);
            const progress =
              d.totalAmount > 0 ? Math.min(100, (d.paidAmount / d.totalAmount) * 100) : 0;
            const days = d.dueDate ? daysUntil(d.dueDate) : null;
            const closed = !!d.closedAt;
            return (
              <div key={d.id} className="card relative overflow-hidden">
                <div
                  className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20"
                  style={{ background: d.color }}
                />
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-xl"
                      style={{ background: d.color + "22" }}
                    >
                      {d.icon ?? "💳"}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{d.name}</div>
                      <div className="text-xs text-slate-500">
                        {d.creditor ? `${d.creditor} · ` : ""}
                        {d.dueDate ? `до ${formatDate(d.dueDate)}` : "без срока"}
                      </div>
                    </div>
                  </div>
                  {closed && (
                    <span className="chip bg-emerald-100 text-emerald-700">Закрыт</span>
                  )}
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <div className="text-2xl font-bold text-rose-600">
                    {formatMoney(remaining)}
                  </div>
                  <div className="text-xs text-slate-500">
                    из {formatMoney(d.totalAmount)}
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${progress}%`, background: d.color }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>выплачено {progress.toFixed(0)}%</span>
                  <span>
                    {closed
                      ? "готово"
                      : days !== null && d.dueDate
                        ? days < 0
                          ? <span className="text-rose-600">просрочено на {-days} дн.</span>
                          : days === 0
                            ? "сегодня"
                            : `${days} дн.`
                        : `${formatMoney(d.paidAmount)} выплачено`}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="btn-primary !py-1.5 text-xs"
                    onClick={() => setPaying(d)}
                    disabled={closed}
                  >
                    + Погасить
                  </button>
                  <button
                    className="btn-secondary !py-1.5 text-xs"
                    onClick={() => setEditing(d)}
                  >
                    Изменить
                  </button>
                  <button
                    className="btn-danger !py-1.5 text-xs"
                    onClick={() => {
                      if (confirm(`Удалить долг «${d.name}»?`)) deleteDebt(d.id);
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

      <Modal open={adding} onClose={() => setAdding(false)} title="Новый долг">
        <DebtForm onDone={() => setAdding(false)} onSubmit={(d) => addDebt(d)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Редактировать долг">
        {editing && (
          <DebtForm
            initial={editing}
            onDone={() => setEditing(null)}
            onSubmit={(d) => updateDebt({ ...editing, ...d })}
          />
        )}
      </Modal>
      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={paying ? `Погасить «${paying.name}»` : ""}
      >
        {paying && (
          <PayDebtForm
            debt={paying}
            onDone={() => setPaying(null)}
            onSubmit={(amount, accountId) => payDebt(paying.id, amount, accountId)}
          />
        )}
      </Modal>
    </div>
  );
}

function DebtForm({
  initial,
  onSubmit,
  onDone,
}: {
  initial?: Debt;
  onSubmit: (d: Omit<Debt, "id" | "createdAt">) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [total, setTotal] = useState(initial ? String(initial.totalAmount) : "");
  const [paid, setPaid] = useState(initial ? String(initial.paidAmount) : "0");
  const [creditor, setCreditor] = useState(initial?.creditor ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [color, setColor] = useState(initial?.color ?? DEBT_COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon ?? DEBT_ICONS[0]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = parseMoney(total);
        if (!name.trim() || !(t > 0)) return;
        onSubmit({
          name: name.trim(),
          totalAmount: t,
          paidAmount: Math.min(t, parseMoney(paid)),
          creditor: creditor.trim() || undefined,
          dueDate: dueDate || undefined,
          note: note.trim() || undefined,
          color,
          icon,
          closedAt: initial?.closedAt,
        });
        onDone();
      }}
      className="space-y-4"
    >
      <div>
        <label className="label" htmlFor="debt-name">
          Название
        </label>
        <input
          id="debt-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Кредит в банке"
          required
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="debt-total">
            Сумма долга (TMT)
          </label>
          <input
            id="debt-total"
            className="input"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            inputMode="decimal"
            placeholder="15000"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="debt-paid">
            Уже выплачено (TMT)
          </label>
          <input
            id="debt-paid"
            className="input"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="debt-creditor">
            Кому должен (необязательно)
          </label>
          <input
            id="debt-creditor"
            className="input"
            value={creditor}
            onChange={(e) => setCreditor(e.target.value)}
            placeholder="Банк, друг…"
          />
        </div>
        <div>
          <label className="label" htmlFor="debt-due">
            Срок (необязательно)
          </label>
          <input
            id="debt-due"
            className="input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="debt-note">
          Комментарий
        </label>
        <input
          id="debt-note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="(необязательно)"
        />
      </div>
      <div>
        <div className="label">Иконка</div>
        <div className="flex flex-wrap gap-2">
          {DEBT_ICONS.map((i) => (
            <button
              type="button"
              key={i}
              onClick={() => setIcon(i)}
              className={`h-9 w-9 rounded-lg text-lg ${
                icon === i
                  ? "bg-brand-100 ring-2 ring-brand-500"
                  : "bg-slate-100 hover:bg-slate-200"
              }`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="label">Цвет</div>
        <div className="flex flex-wrap gap-2">
          {DEBT_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full transition ${
                color === c ? "ring-2 ring-offset-2 ring-slate-900" : ""
              }`}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </div>
      </div>
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

function PayDebtForm({
  debt,
  onSubmit,
  onDone,
}: {
  debt: Debt;
  onSubmit: (amount: number, accountId?: string) => void;
  onDone: () => void;
}) {
  const { data } = useStore();
  const remaining = Math.max(0, debt.totalAmount - debt.paidAmount);
  const [amount, setAmount] = useState("");
  const [withdraw, setWithdraw] = useState(true);
  const [accountId, setAccountId] = useState<string>(data.accounts[0]?.id ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const a = parseMoney(amount);
        if (!(a > 0)) return;
        onSubmit(a, withdraw ? accountId : undefined);
        onDone();
      }}
      className="space-y-4"
    >
      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        Осталось выплатить: <b>{formatMoney(remaining)}</b>
      </div>
      <div>
        <label className="label" htmlFor="pay-amount">
          Сумма (TMT)
        </label>
        <input
          id="pay-amount"
          className="input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder={String(remaining || "")}
          autoFocus
          required
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={withdraw}
          onChange={(e) => setWithdraw(e.target.checked)}
        />
        Списать со счёта как расход
      </label>
      {withdraw && (
        <div>
          <label className="label" htmlFor="pay-account">
            Счёт
          </label>
          <select
            id="pay-account"
            className="input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon ?? ""}
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-ghost" onClick={onDone}>
          Отмена
        </button>
        <button type="submit" className="btn-primary">
          Погасить
        </button>
      </div>
    </form>
  );
}
