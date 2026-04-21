import { useMemo, useState } from "react";
import { useStore } from "../state/context";
import { formatMoney } from "../lib/currency";
import { formatMonth, monthKey } from "../lib/date";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "../components/EmptyState";

export function Analytics() {
  const { data } = useStore();
  const months = useMemo(() => {
    const s = new Set<string>();
    data.transactions.forEach((t) => s.add(monthKey(t.date)));
    return Array.from(s).sort();
  }, [data.transactions]);
  const [selectedMonth, setSelectedMonth] = useState<string>(months[months.length - 1] ?? "");

  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (const t of data.transactions) {
      const key = monthKey(t.date);
      if (!map.has(key)) map.set(key, { income: 0, expense: 0 });
      const e = map.get(key)!;
      if (t.type === "income") e.income += t.amount;
      else if (t.type === "expense") e.expense += t.amount;
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([ym, v]) => ({
        month: formatMonth(ym).slice(0, 3),
        Доходы: Math.round(v.income),
        Расходы: Math.round(v.expense),
        Баланс: Math.round(v.income - v.expense),
      }));
  }, [data.transactions]);

  const expenseByCategory = useMemo(() => {
    const target = selectedMonth;
    const map = new Map<string, number>();
    for (const t of data.transactions) {
      if (t.type !== "expense") continue;
      if (target && monthKey(t.date) !== target) continue;
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
  }, [data.transactions, data.categories, selectedMonth]);

  const incomeByCategory = useMemo(() => {
    const target = selectedMonth;
    const map = new Map<string, number>();
    for (const t of data.transactions) {
      if (t.type !== "income") continue;
      if (target && monthKey(t.date) !== target) continue;
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
  }, [data.transactions, data.categories, selectedMonth]);

  if (data.transactions.length === 0) {
    return (
      <EmptyState
        icon="📊"
        title="Нет данных для аналитики"
        description="Добавь транзакции — и здесь появятся подробные графики."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Динамика доходов и расходов</h3>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={monthlyTrend}>
              <defs>
                <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExpense" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip formatter={(v: number) => formatMoney(v)} />
              <Legend />
              <Area type="monotone" dataKey="Доходы" stroke="#10b981" fill="url(#gIncome)" />
              <Area type="monotone" dataKey="Расходы" stroke="#ef4444" fill="url(#gExpense)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Чистый баланс по месяцам</h3>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip formatter={(v: number) => formatMoney(v)} />
              <Line type="monotone" dataKey="Баланс" stroke="#2186ff" strokeWidth={2.5} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Структура за период</h3>
          <select
            className="input max-w-[200px]"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            <option value="">Все месяцы</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <CategoryBreakdown title="Расходы" data={expenseByCategory} />
          <CategoryBreakdown title="Доходы" data={incomeByCategory} />
        </div>
      </div>
    </div>
  );
}

function CategoryBreakdown({ title, data }: { title: string; data: { name: string; color: string; value: number }[] }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-slate-700">{title}</h4>
      {data.length === 0 ? (
        <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Нет данных</div>
      ) : (
        <>
          <div className="h-52">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80} paddingAngle={2}>
                  {data.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatMoney(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {data.map((d) => (
              <li key={d.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                  {d.name}
                </span>
                <span className="font-medium text-slate-800">
                  {formatMoney(d.value)}{" "}
                  <span className="text-xs text-slate-500">
                    ({total > 0 ? ((d.value / total) * 100).toFixed(0) : 0}%)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
