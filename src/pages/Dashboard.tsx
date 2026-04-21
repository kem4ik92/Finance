import { useMemo } from "react";
import { useStore } from "../state/context";
import { useAccountBalances } from "../state/hooks";
import { formatMoney } from "../lib/currency";
import { formatDate, monthKey, todayIso, formatMonth } from "../lib/date";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "../components/EmptyState";
import { SavingsAdvice } from "../components/SavingsAdvice";

interface Props {
  onAddClick: () => void;
  onTestData: () => void;
}

export function Dashboard({ onAddClick, onTestData }: Props) {
  const { data } = useStore();
  const balances = useAccountBalances();

  const total = Object.values(balances).reduce((a, b) => a + b, 0);

  const thisMonth = monthKey(todayIso());

  const monthStats = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of data.transactions) {
      if (monthKey(t.date) !== thisMonth) continue;
      if (t.type === "income") income += t.amount;
      else if (t.type === "expense") expense += t.amount;
    }
    return { income, expense, balance: income - expense };
  }, [data.transactions, thisMonth]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of data.transactions) {
      if (t.type !== "expense" || monthKey(t.date) !== thisMonth) continue;
      const key = t.categoryId ?? "uncat";
      map.set(key, (map.get(key) ?? 0) + t.amount);
    }
    return Array.from(map.entries())
      .map(([catId, value]) => {
        const cat = data.categories.find((c) => c.id === catId);
        return {
          name: cat?.name ?? "Без категории",
          color: cat?.color ?? "#94a3b8",
          value,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [data.transactions, data.categories, thisMonth]);

  const byMonth = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (const t of data.transactions) {
      const key = monthKey(t.date);
      if (!map.has(key)) map.set(key, { income: 0, expense: 0 });
      const entry = map.get(key)!;
      if (t.type === "income") entry.income += t.amount;
      else if (t.type === "expense") entry.expense += t.amount;
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-6)
      .map(([ym, { income, expense }]) => ({
        month: formatMonth(ym).slice(0, 3),
        Доходы: Math.round(income),
        Расходы: Math.round(expense),
      }));
  }, [data.transactions]);

  const recent = data.transactions.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Общий баланс" value={total} tone="brand" />
        <StatCard label="Доходы за месяц" value={monthStats.income} tone="emerald" />
        <StatCard label="Расходы за месяц" value={monthStats.expense} tone="rose" />
        <StatCard
          label="Баланс за месяц"
          value={monthStats.balance}
          tone={monthStats.balance >= 0 ? "emerald" : "rose"}
          signed
        />
      </div>

      <SavingsAdvice />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Динамика за 6 месяцев</h3>
            <span className="text-xs text-slate-500">Доходы vs расходы</span>
          </div>
          {byMonth.length === 0 ? (
            <EmptyState
              icon="📈"
              title="Пока нет данных"
              description="Добавь первую транзакцию или загрузи пример, чтобы увидеть аналитику."
              action={
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={onAddClick}>
                    + Добавить транзакцию
                  </button>
                  <button className="btn-secondary" onClick={onTestData}>
                    Загрузить пример
                  </button>
                </div>
              }
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip
                    formatter={(v: number) => formatMoney(v)}
                    contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}
                  />
                  <Legend />
                  <Bar dataKey="Доходы" fill="#10b981" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Расходы" fill="#ef4444" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="mb-4 text-sm font-semibold text-slate-800">Расходы по категориям</h3>
          {byCategory.length === 0 ? (
            <EmptyState icon="🧭" title="Нет расходов в этом месяце" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byCategory}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {byCategory.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => formatMoney(v)}
                    contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {byCategory.length > 0 && (
            <div className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm">
              {byCategory.slice(0, 5).map((c) => (
                <div key={c.name} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-700">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                    {c.name}
                  </span>
                  <span className="font-medium text-slate-800">{formatMoney(c.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Последние операции</h3>
          <span className="text-xs text-slate-500">{data.transactions.length} всего</span>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            icon="🗒️"
            title="Ещё нет операций"
            description="Начни с добавления дохода или расхода."
            action={
              <button className="btn-primary" onClick={onAddClick}>
                + Добавить транзакцию
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((t) => {
              const acc = data.accounts.find((a) => a.id === t.accountId);
              const cat = data.categories.find((c) => c.id === t.categoryId);
              const sign = t.type === "income" ? 1 : t.type === "expense" ? -1 : 0;
              return (
                <li key={t.id} className="flex items-center justify-between py-3">
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
                        {formatDate(t.date)} · {acc?.name ?? "—"}
                      </div>
                    </div>
                  </div>
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  signed,
}: {
  label: string;
  value: number;
  tone: "brand" | "emerald" | "rose";
  signed?: boolean;
}) {
  const toneClass = {
    brand: "from-brand-500 to-brand-700 text-white",
    emerald: "from-emerald-500 to-emerald-700 text-white",
    rose: "from-rose-500 to-rose-700 text-white",
  }[tone];
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${toneClass} p-5 shadow-card`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold">{formatMoney(value, { sign: signed })}</div>
    </div>
  );
}
