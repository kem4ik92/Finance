import { useState } from "react";
import { useStore } from "../state/context";
import { formatMoney, parseMoney } from "../lib/currency";
import { daysUntil, formatDate } from "../lib/date";
import { Modal } from "../components/Modal";
import { EmptyState } from "../components/EmptyState";
import type { Goal } from "../types";

const GOAL_ICONS = ["🏠", "🚗", "✈️", "📱", "💍", "🎓", "💻", "🛋️", "🎁", "🏖️", "👶"];
const GOAL_COLORS = ["#2186ff", "#22c55e", "#a855f7", "#f97316", "#ef4444", "#14b8a6", "#f59e0b"];

export function Goals() {
  const { data, addGoal, updateGoal, deleteGoal, contributeGoal } = useStore();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [contributing, setContributing] = useState<Goal | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Цели накоплений</h2>
          <p className="text-sm text-slate-500">Копите на конкретные вещи и отслеживайте прогресс.</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + Новая цель
        </button>
      </div>

      {data.goals.length === 0 ? (
        <EmptyState
          icon="🎯"
          title="Пока нет целей"
          description="Например: «Новый ноутбук — 15 000 TMT к декабрю». Маленькие шаги — большие победы."
          action={
            <button className="btn-primary" onClick={() => setAdding(true)}>
              + Создать первую цель
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.goals.map((g) => {
            const progress = g.targetAmount > 0 ? Math.min(100, (g.savedAmount / g.targetAmount) * 100) : 0;
            const remaining = Math.max(0, g.targetAmount - g.savedAmount);
            const days = g.deadline ? daysUntil(g.deadline) : null;
            const done = g.savedAmount >= g.targetAmount;
            return (
              <div key={g.id} className="card relative overflow-hidden">
                <div
                  className="absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20"
                  style={{ background: g.color }}
                />
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-xl"
                      style={{ background: g.color + "22" }}
                    >
                      {g.icon ?? "🎯"}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{g.name}</div>
                      <div className="text-xs text-slate-500">
                        {g.deadline ? `до ${formatDate(g.deadline)}` : "без срока"}
                      </div>
                    </div>
                  </div>
                  {done && <span className="chip bg-emerald-100 text-emerald-700">Цель достигнута</span>}
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <div className="text-2xl font-bold text-slate-900">{formatMoney(g.savedAmount)}</div>
                  <div className="text-xs text-slate-500">из {formatMoney(g.targetAmount)}</div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${progress}%`, background: g.color }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{progress.toFixed(0)}%</span>
                  <span>
                    {remaining > 0 ? `осталось ${formatMoney(remaining)}` : "готово"}
                    {days !== null && g.deadline && !done ? (
                      <span className={days < 0 ? "text-rose-600" : ""}>
                        {" · "}
                        {days < 0 ? `просрочено на ${-days} дн.` : days === 0 ? "сегодня" : `${days} дн.`}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="btn-primary !py-1.5 text-xs"
                    onClick={() => setContributing(g)}
                    disabled={done}
                  >
                    + Пополнить
                  </button>
                  <button className="btn-secondary !py-1.5 text-xs" onClick={() => setEditing(g)}>
                    Изменить
                  </button>
                  <button
                    className="btn-danger !py-1.5 text-xs"
                    onClick={() => {
                      if (confirm(`Удалить цель «${g.name}»?`)) deleteGoal(g.id);
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

      <Modal open={adding} onClose={() => setAdding(false)} title="Новая цель">
        <GoalForm
          onDone={() => setAdding(false)}
          onSubmit={(g) => addGoal(g)}
        />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Цель">
        {editing && (
          <GoalForm
            initial={editing}
            onDone={() => setEditing(null)}
            onSubmit={(g) => updateGoal({ ...editing, ...g })}
          />
        )}
      </Modal>
      <Modal
        open={!!contributing}
        onClose={() => setContributing(null)}
        title={contributing ? `Пополнить «${contributing.name}»` : ""}
      >
        {contributing && (
          <ContributeForm
            goal={contributing}
            onDone={() => setContributing(null)}
            onSubmit={(amount, accountId) =>
              contributeGoal(contributing.id, amount, accountId)
            }
          />
        )}
      </Modal>
    </div>
  );
}

function GoalForm({
  initial,
  onSubmit,
  onDone,
}: {
  initial?: Goal;
  onSubmit: (g: Omit<Goal, "id" | "createdAt">) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [target, setTarget] = useState(initial ? String(initial.targetAmount) : "");
  const [saved, setSaved] = useState(initial ? String(initial.savedAmount) : "0");
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [color, setColor] = useState(initial?.color ?? GOAL_COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon ?? GOAL_ICONS[0]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = parseMoney(target);
        if (!name.trim() || !(t > 0)) return;
        onSubmit({
          name: name.trim(),
          targetAmount: t,
          savedAmount: parseMoney(saved),
          deadline: deadline || undefined,
          color,
          icon,
        });
        onDone();
      }}
      className="space-y-4"
    >
      <div>
        <label className="label" htmlFor="goal-name">Название цели</label>
        <input
          id="goal-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Новый телефон"
          required
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="goal-target">Целевая сумма (TMT)</label>
          <input
            id="goal-target"
            className="input"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            placeholder="10000"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="goal-saved">Уже накоплено (TMT)</label>
          <input
            id="goal-saved"
            className="input"
            value={saved}
            onChange={(e) => setSaved(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="goal-deadline">Срок (необязательно)</label>
        <input
          id="goal-deadline"
          className="input"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </div>
      <div>
        <div className="label">Иконка</div>
        <div className="flex flex-wrap gap-2">
          {GOAL_ICONS.map((i) => (
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
          {GOAL_COLORS.map((c) => (
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

function ContributeForm({
  goal,
  onSubmit,
  onDone,
}: {
  goal: Goal;
  onSubmit: (amount: number, accountId?: string) => void;
  onDone: () => void;
}) {
  const { data } = useStore();
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<string>(data.accounts[0]?.id ?? "");
  const [logAsTransaction, setLogAsTransaction] = useState(true);
  const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const a = parseMoney(amount);
        if (!(a > 0)) return;
        onSubmit(a, logAsTransaction ? accountId : undefined);
        onDone();
      }}
      className="space-y-4"
    >
      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        До цели осталось: <b>{formatMoney(remaining)}</b>
      </div>
      <div>
        <label className="label" htmlFor="contrib-amount">Сумма (TMT)</label>
        <input
          id="contrib-amount"
          className="input text-lg font-semibold"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          autoFocus
          required
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={logAsTransaction}
          onChange={(e) => setLogAsTransaction(e.target.checked)}
        />
        Списать со счёта как расход
      </label>
      {logAsTransaction && (
        <div>
          <label className="label" htmlFor="contrib-account">Счёт</label>
          <select
            id="contrib-account"
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
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-ghost" onClick={onDone}>
          Отмена
        </button>
        <button type="submit" className="btn-primary">
          Пополнить
        </button>
      </div>
    </form>
  );
}
