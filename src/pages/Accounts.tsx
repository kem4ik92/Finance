import { useState } from "react";
import { useStore } from "../state/context";
import { useAccountBalances } from "../state/hooks";
import { formatMoney, parseMoney } from "../lib/currency";
import { Modal } from "../components/Modal";
import type { Account } from "../types";

const PRESET_COLORS = ["#2186ff", "#22c55e", "#a855f7", "#f97316", "#ef4444", "#14b8a6", "#0ea5e9", "#f59e0b"];
const PRESET_ICONS = ["💳", "💵", "🏦", "💰", "📱", "🧾", "💼", "👛"];

export function Accounts() {
  const { data, addAccount, updateAccount, deleteAccount } = useStore();
  const balances = useAccountBalances();
  const [editing, setEditing] = useState<Account | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Мои счета</h2>
          <p className="text-sm text-slate-500">Наличные, карты, сбережения — учитываются отдельно.</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + Новый счёт
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data.accounts.map((a) => (
          <div key={a.id} className="card relative overflow-hidden">
            <div
              className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20"
              style={{ background: a.color }}
            />
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
                style={{ background: a.color + "22", color: a.color }}
              >
                {a.icon ?? "💳"}
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-800">{a.name}</div>
                <div className="text-xs text-slate-500">
                  {a.type === "cash"
                    ? "Наличные"
                    : a.type === "card"
                    ? "Карта"
                    : a.type === "savings"
                    ? "Сбережения"
                    : "Другое"}
                </div>
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {formatMoney(balances[a.id] ?? 0)}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn-secondary !py-1.5 text-xs" onClick={() => setEditing(a)}>
                Изменить
              </button>
              <button
                className="btn-danger !py-1.5 text-xs"
                onClick={() => {
                  if (data.accounts.length <= 1) {
                    alert("Нужен хотя бы один счёт.");
                    return;
                  }
                  if (confirm(`Удалить счёт «${a.name}» и все его операции?`)) deleteAccount(a.id);
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Новый счёт">
        <AccountForm
          onDone={() => setAdding(false)}
          onSubmit={(a) =>
            addAccount({
              name: a.name,
              type: a.type,
              openingBalance: a.openingBalance,
              color: a.color,
              icon: a.icon,
            })
          }
        />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Счёт">
        {editing && (
          <AccountForm
            initial={editing}
            onDone={() => setEditing(null)}
            onSubmit={(a) => updateAccount({ ...editing, ...a })}
          />
        )}
      </Modal>
    </div>
  );
}

interface FormValue {
  name: string;
  type: Account["type"];
  openingBalance: number;
  color: string;
  icon: string;
}

function AccountForm({
  initial,
  onSubmit,
  onDone,
}: {
  initial?: Account;
  onSubmit: (v: FormValue) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<Account["type"]>(initial?.type ?? "card");
  const [balance, setBalance] = useState(initial ? String(initial.openingBalance) : "0");
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon ?? PRESET_ICONS[0]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({ name: name.trim(), type, openingBalance: parseMoney(balance), color, icon });
        onDone();
      }}
      className="space-y-4"
    >
      <div>
        <label className="label" htmlFor="acc-name">Название</label>
        <input
          id="acc-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например, Halkbank"
          required
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="acc-type">Тип</label>
          <select
            id="acc-type"
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as Account["type"])}
          >
            <option value="cash">Наличные</option>
            <option value="card">Карта</option>
            <option value="savings">Сбережения</option>
            <option value="other">Другое</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="acc-balance">Начальный баланс (TMT)</label>
          <input
            id="acc-balance"
            className="input"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>
      <div>
        <div className="label">Иконка</div>
        <div className="flex flex-wrap gap-2">
          {PRESET_ICONS.map((i) => (
            <button
              type="button"
              key={i}
              onClick={() => setIcon(i)}
              className={`h-9 w-9 rounded-lg text-lg ${
                icon === i ? "bg-brand-100 ring-2 ring-brand-500" : "bg-slate-100 hover:bg-slate-200"
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
          {PRESET_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full ring-offset-2 transition ${
                color === c ? "ring-2 ring-slate-900" : ""
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
