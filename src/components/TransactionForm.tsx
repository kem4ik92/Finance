import { useState } from "react";
import { useStore } from "../state/context";
import type { Transaction } from "../types";
import { todayIso } from "../lib/date";
import { parseMoney } from "../lib/currency";

interface Props {
  onDone: () => void;
  initial?: Transaction;
  defaultType?: Transaction["type"];
}

export function TransactionForm({ onDone, initial, defaultType = "expense" }: Props) {
  const { data, addTransaction, updateTransaction } = useStore();
  const [type, setTypeState] = useState<Transaction["type"]>(initial?.type ?? defaultType);
  const [amount, setAmount] = useState<string>(initial ? String(initial.amount) : "");
  const [accountId, setAccountId] = useState<string>(
    initial?.accountId ?? data.accounts[0]?.id ?? "",
  );
  const [toAccountId, setToAccountId] = useState<string>(
    initial?.toAccountId ?? (data.accounts[1]?.id ?? ""),
  );
  const [categoryId, setCategoryId] = useState<string>(() => {
    if (initial?.categoryId) return initial.categoryId;
    const initialType = initial?.type ?? defaultType;
    if (initialType === "transfer") return "";
    const firstMatch = data.categories.find((c) => c.type === initialType);
    return firstMatch?.id ?? "";
  });
  const [note, setNote] = useState<string>(initial?.note ?? "");
  const [date, setDate] = useState<string>(initial?.date ?? todayIso());

  function setType(newType: Transaction["type"]) {
    setTypeState(newType);
    if (newType !== "transfer") {
      const valid = data.categories.some(
        (c) => c.id === categoryId && c.type === newType,
      );
      if (!valid) {
        const firstMatch = data.categories.find((c) => c.type === newType);
        setCategoryId(firstMatch?.id ?? "");
      }
    }
  }

  const categories = data.categories.filter((c) =>
    type === "income" ? c.type === "income" : c.type === "expense",
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseMoney(amount);
    if (!(amt > 0) || !accountId) return;
    if (type === "transfer" && (!toAccountId || toAccountId === accountId)) return;

    const payload: Omit<Transaction, "id" | "createdAt"> = {
      type,
      amount: amt,
      accountId,
      toAccountId: type === "transfer" ? toAccountId : undefined,
      categoryId: type === "transfer" ? undefined : categoryId || undefined,
      note: note.trim() || undefined,
      date,
    };

    if (initial) {
      updateTransaction({ ...initial, ...payload });
    } else {
      addTransaction(payload);
    }
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {([
          ["expense", "Расход", "bg-rose-500"],
          ["income", "Доход", "bg-emerald-500"],
          ["transfer", "Перевод", "bg-slate-500"],
        ] as const).map(([key, label, color]) => (
          <button
            type="button"
            key={key}
            onClick={() => setType(key)}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
              type === key
                ? `${color} text-white shadow-sm`
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        <label className="label" htmlFor="tx-amount">Сумма (TMT)</label>
        <input
          id="tx-amount"
          className="input text-lg font-semibold"
          placeholder="0,00"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tx-account">Счёт</label>
          <select
            id="tx-account"
            className="input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </div>
        {type === "transfer" ? (
          <div>
            <label className="label" htmlFor="tx-to-account">Куда</label>
            <select
              id="tx-to-account"
              className="input"
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              required
            >
              {data.accounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name}
                  </option>
                ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="tx-category">Категория</label>
            <select
              id="tx-category"
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
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tx-date">Дата</label>
          <input
            id="tx-date"
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="tx-note">Комментарий</label>
          <input
            id="tx-note"
            className="input"
            placeholder="(необязательно)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onDone} className="btn-ghost">
          Отмена
        </button>
        <button type="submit" className="btn-primary">
          {initial ? "Сохранить" : "Добавить"}
        </button>
      </div>
    </form>
  );
}
