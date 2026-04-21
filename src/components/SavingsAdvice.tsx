import { useMemo } from "react";
import { useStore } from "../state/context";
import { computeDebtAdvice } from "../lib/advice";
import { formatMoney } from "../lib/currency";

interface Props {
  /** Optional compact rendering (smaller card for dashboard). */
  compact?: boolean;
}

export function SavingsAdvice({ compact }: Props) {
  const { data } = useStore();
  const advice = useMemo(() => computeDebtAdvice(data, 3), [data]);

  const hasDebts = advice.totalRemaining > 0;
  if (!hasDebts) return null;

  const monthsTxt = (m: number | null) => {
    if (m === null || !Number.isFinite(m)) return "—";
    if (m > 120) return "больше 10 лет";
    if (m < 1) return "меньше месяца";
    const months = Math.round(m);
    const years = Math.floor(months / 12);
    const rem = months % 12;
    if (years > 0 && rem > 0) return `${years} г. ${rem} мес.`;
    if (years > 0) return `${years} г.`;
    return `${months} мес.`;
  };

  return (
    <div className="card border-2 border-amber-100 bg-amber-50/60">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-xl text-white shadow">
          💡
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900">
            На чём сэкономить, чтобы быстрее закрыть долги
          </h3>
          <p className="mt-0.5 text-xs text-slate-600">
            Совет основан на расходах за последние {advice.monthsAnalysed} мес. Осталось выплатить{" "}
            <b>{formatMoney(advice.totalRemaining)}</b>.
          </p>
        </div>
      </div>

      {advice.tips.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          Пока нет расходов, которые можно сократить — добавьте историю трат, и я предложу план.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {advice.tips.map((t) => (
            <li
              key={t.categoryId ?? "__none__"}
              className="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-amber-100"
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base"
                style={{ background: t.color + "22", color: t.color }}
              >
                {t.icon}
              </div>
              <div className="flex-1 text-sm">
                <div className="font-medium text-slate-800">
                  «{t.name}» — тратите {formatMoney(t.monthly)} в мес.
                </div>
                <div className="text-xs text-slate-600">
                  Сократите на{" "}
                  <b className="text-amber-700">{Math.round(t.cutShare * 100)}%</b> → освободится{" "}
                  <b className="text-emerald-700">
                    {formatMoney(t.monthlySavings)}
                  </b>{" "}
                  в месяц на долги.
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!compact && (advice.monthsAtCurrentPace !== null || advice.monthsWithCuts !== null) && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-white p-3 ring-1 ring-rose-100">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Текущим темпом
            </div>
            <div className="mt-1 text-sm font-semibold text-rose-700">
              {monthsTxt(advice.monthsAtCurrentPace)}
            </div>
          </div>
          <div className="rounded-xl bg-white p-3 ring-1 ring-emerald-100">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              С этими сокращениями
            </div>
            <div className="mt-1 text-sm font-semibold text-emerald-700">
              {monthsTxt(advice.monthsWithCuts)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
