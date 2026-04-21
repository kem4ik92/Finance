import { useState } from "react";
import { useStore } from "../state/context";
import { Modal } from "../components/Modal";
import type { Category } from "../types";

const CAT_ICONS = ["🛒", "🍽️", "🚌", "💡", "🏠", "💊", "👕", "📚", "🎮", "🎁", "👨‍👩‍👧", "💼", "💻", "🎖️", "•"];
const CAT_COLORS = ["#f97316", "#ef4444", "#0ea5e9", "#64748b", "#7c3aed", "#16a34a", "#db2777", "#0891b2", "#f59e0b", "#10b981", "#14b8a6"];

export function Categories() {
  const { data, addCategory, updateCategory, deleteCategory } = useStore();
  const [tab, setTab] = useState<"expense" | "income">("expense");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const items = data.categories.filter((c) => c.type === tab);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Категории</h2>
          <p className="text-sm text-slate-500">Настройте список категорий под свои привычки.</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + Новая категория
        </button>
      </div>
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {(["expense", "income"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              tab === t ? "bg-white text-slate-900 shadow" : "text-slate-600"
            }`}
          >
            {t === "expense" ? "Расходы" : "Доходы"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {items.map((c) => (
          <div key={c.id} className="card flex items-center justify-between !p-4">
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
                style={{ background: c.color + "22", color: c.color }}
              >
                {c.icon ?? "•"}
              </div>
              <div className="text-sm font-medium text-slate-800">{c.name}</div>
            </div>
            <div className="flex">
              <button className="btn-ghost !px-2 !py-1" onClick={() => setEditing(c)} aria-label="Редактировать">
                ✎
              </button>
              <button
                className="btn-ghost !px-2 !py-1 text-rose-500 hover:bg-rose-50"
                onClick={() => {
                  if (confirm(`Удалить категорию «${c.name}»?`)) deleteCategory(c.id);
                }}
                aria-label="Удалить"
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Новая категория">
        <CategoryForm type={tab} onDone={() => setAdding(false)} onSubmit={(c) => addCategory(c)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Категория">
        {editing && (
          <CategoryForm
            initial={editing}
            type={editing.type}
            onDone={() => setEditing(null)}
            onSubmit={(c) => updateCategory({ ...editing, ...c })}
          />
        )}
      </Modal>
    </div>
  );
}

function CategoryForm({
  initial,
  type,
  onSubmit,
  onDone,
}: {
  initial?: Category;
  type: Category["type"];
  onSubmit: (c: Omit<Category, "id">) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? CAT_COLORS[0]);
  const [icon, setIcon] = useState(initial?.icon ?? CAT_ICONS[0]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({ name: name.trim(), type, color, icon });
        onDone();
      }}
      className="space-y-4"
    >
      <div>
        <label className="label" htmlFor="cat-name">Название</label>
        <input id="cat-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <div>
        <div className="label">Иконка</div>
        <div className="flex flex-wrap gap-2">
          {CAT_ICONS.map((i) => (
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
          {CAT_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-slate-900" : ""}`}
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
