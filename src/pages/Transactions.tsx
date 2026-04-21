import { useMemo, useState } from "react";
import { useStore } from "../state/context";
import { formatDate } from "../lib/date";
import { formatMoney } from "../lib/currency";
import { Modal } from "../components/Modal";
import { TransactionForm } from "../components/TransactionForm";
import { EmptyState } from "../components/EmptyState";
import type { Transaction } from "../types";

export function Transactions() {
  const { data, deleteTransaction } = useStore();
  const [filter, setFilter] = useState<"all" | "income" | "expense" | "transfer">("all");
  const [q, setQ] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (filter !== "all" && t.type !== filter) return false;
      if (accountFilter !== "all" && t.accountId !== accountFilter && t.toAccountId !== accountFilter)
        return false;
      if (qq) {
        const cat = data.categories.find((c) => c.id === t.categoryId)?.name?.toLowerCase() ?? "";
        const acc = data.accounts.find((a) => a.id === t.accountId)?.name?.toLowerCase() ?? "";
        const note = (t.note ?? "").toLowerCase();
        if (!(`${cat} ${acc} ${note}`.includes(qq))) return false;
      }
      return true;
    });
  }, [data, filter, q, accountFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of filtered) {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date)!.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="card flex flex-col gap-3 md:flex-row md:items-center">
        <input
          className="input md:max-w-xs"
          placeholder="Поиск по комментарию, категории..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input md:max-w-[180px]"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">Все типы</option>
          <option value="income">Доходы</option>
          <option value="expense">Расходы</option>
          <option value="transfer">Переводы</option>
        </select>
        <select
          className="input md:max-w-[200px]"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value="all">Все счета</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.icon} {a.name}
            </option>
          ))}
        </select>
        <div className="md:ml-auto">
          <button className="btn-primary" onClick={() => setAdding(true)}>
            + Добавить
          </button>
        </div>
      </div>

      {grouped.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="Нет транзакций"
          description="Нажми «Добавить», чтобы записать первую операцию."
          action={
            <button className="btn-primary" onClick={() => setAdding(true)}>
              + Добавить транзакцию
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, items]) => {
            const dayTotal = items.reduce(
              (acc, t) => acc + (t.type === "income" ? t.amount : t.type === "expense" ? -t.amount : 0),
              0,
            );
            return (
              <div key={date} className="card">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-700">{formatDate(date, "EEEE, d MMMM yyyy")}</h4>
                  <div
                    className={`text-xs font-medium ${dayTotal >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {formatMoney(dayTotal, { sign: dayTotal !== 0 })}
                  </div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {items.map((t) => {
                    const acc = data.accounts.find((a) => a.id === t.accountId);
                    const toAcc = t.toAccountId
                      ? data.accounts.find((a) => a.id === t.toAccountId)
                      : null;
                    const cat = data.categories.find((c) => c.id === t.categoryId);
                    const sign = t.type === "income" ? 1 : t.type === "expense" ? -1 : 0;
                    return (
                      <li key={t.id} className="group flex items-center justify-between py-2">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-9 w-9 items-center justify-center rounded-xl text-base"
                            style={{ background: (cat?.color ?? acc?.color ?? "#e2e8f0") + "22" }}
                          >
                            {cat?.icon ?? (t.type === "transfer" ? "🔁" : acc?.icon ?? "•")}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-slate-800">
                              {t.note || cat?.name || (t.type === "transfer" ? "Перевод" : "—")}
                            </div>
                            <div className="text-xs text-slate-500">
                              {acc?.name ?? "—"}
                              {toAcc ? ` → ${toAcc.name}` : ""}
                              {cat ? ` · ${cat.name}` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div
                            className={`text-sm font-semibold ${
                              t.type === "income"
                                ? "text-emerald-600"
                                : t.type === "expense"
                                ? "text-rose-600"
                                : "text-slate-600"
                            }`}
                          >
                            {formatMoney(sign * t.amount, { sign: sign !== 0 })}
                          </div>
                          <div className="flex opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                            <button
                              className="btn-ghost !min-h-0 !px-2 !py-1"
                              onClick={() => setEditing(t)}
                              title="Редактировать"
                              aria-label="Редактировать"
                            >
                              ✎
                            </button>
                            <button
                              className="btn-ghost !min-h-0 !px-2 !py-1 text-rose-500 hover:bg-rose-50"
                              onClick={() => {
                                if (confirm("Удалить операцию?")) deleteTransaction(t.id);
                              }}
                              title="Удалить"
                              aria-label="Удалить"
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Новая транзакция">
        <TransactionForm onDone={() => setAdding(false)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Редактировать">
        {editing && <TransactionForm initial={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
