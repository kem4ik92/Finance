import { useMemo, useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Transactions } from "./pages/Transactions";
import { Accounts } from "./pages/Accounts";
import { Goals } from "./pages/Goals";
import { Debts } from "./pages/Debts";
import { Categories } from "./pages/Categories";
import { Reminders } from "./pages/Reminders";
import { Analytics } from "./pages/Analytics";
import { Settings } from "./pages/Settings";
import { Modal } from "./components/Modal";
import { TransactionForm } from "./components/TransactionForm";
import { useStore } from "./state/context";
import { useAccountBalances } from "./state/hooks";
import { formatMoney } from "./lib/currency";
import { daysUntil } from "./lib/date";
import { generateSampleTransactions } from "./lib/sample";

type PageKey =
  | "dashboard"
  | "transactions"
  | "analytics"
  | "accounts"
  | "goals"
  | "debts"
  | "categories"
  | "reminders"
  | "settings";

const NAV: { key: PageKey; label: string; icon: string }[] = [
  { key: "dashboard", label: "Главная", icon: "🏠" },
  { key: "transactions", label: "Операции", icon: "🧾" },
  { key: "analytics", label: "Аналитика", icon: "📊" },
  { key: "accounts", label: "Счета", icon: "💳" },
  { key: "goals", label: "Цели", icon: "🎯" },
  { key: "debts", label: "Долги", icon: "💳" },
  { key: "categories", label: "Категории", icon: "🏷️" },
  { key: "reminders", label: "Напоминания", icon: "⏰" },
  { key: "settings", label: "Настройки", icon: "⚙️" },
];

export default function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const [addOpen, setAddOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { data, importData } = useStore();
  const balances = useAccountBalances();
  const total = Object.values(balances).reduce((a, b) => a + b, 0);

  const dueReminders = useMemo(
    () => data.reminders.filter((r) => r.active && daysUntil(r.nextDate) <= 0).length,
    [data.reminders],
  );

  function loadSample() {
    if (!confirm("Загрузить демо-данные? Это добавит транзакции к уже существующим.")) return;
    const sample = generateSampleTransactions(data);
    importData({ ...data, transactions: [...sample, ...data.transactions] });
  }

  const pageTitle = NAV.find((n) => n.key === page)?.label ?? "";

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform bg-white border-r border-slate-100 p-4 transition-transform md:static md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow">
            <span className="font-bold">T</span>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">Manat</div>
            <div className="text-[11px] text-slate-500">Учёт финансов · TMT</div>
          </div>
        </div>

        <div className="mb-5 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-white shadow-card">
          <div className="text-xs font-medium opacity-80">Общий баланс</div>
          <div className="mt-1 text-xl font-bold">{formatMoney(total)}</div>
          <button
            className="mt-3 w-full rounded-xl bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur hover:bg-white/25"
            onClick={() => setAddOpen(true)}
          >
            + Быстрое добавление
          </button>
        </div>

        <nav className="space-y-1">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => {
                setPage(n.key);
                setMobileNavOpen(false);
              }}
              className={`nav-item w-full text-left ${page === n.key ? "active" : ""}`}
            >
              <span className="w-5">{n.icon}</span>
              <span className="flex-1">{n.label}</span>
              {n.key === "reminders" && dueReminders > 0 && (
                <span className="chip bg-amber-500 text-white">{dueReminders}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-6 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500">
          💡 Данные хранятся локально в этом браузере. Сделайте резервную копию в «Настройках».
        </div>
      </aside>

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Main */}
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-100 bg-white/90 px-3 py-2 backdrop-blur md:gap-3 md:px-8 md:py-3">
          <button
            className="btn-ghost !min-h-[40px] !px-3 md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Меню"
          >
            ☰
          </button>
          <h1 className="truncate text-base font-semibold text-slate-800 md:text-lg">{pageTitle}</h1>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-secondary hidden md:inline-flex" onClick={loadSample}>
              Демо-данные
            </button>
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <span className="hidden sm:inline">+ Добавить</span>
              <span className="sm:hidden">＋</span>
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-3 py-4 pb-24 md:px-8 md:py-6 md:pb-6">
          {page === "dashboard" && (
            <Dashboard onAddClick={() => setAddOpen(true)} onTestData={loadSample} />
          )}
          {page === "transactions" && <Transactions />}
          {page === "analytics" && <Analytics />}
          {page === "accounts" && <Accounts />}
          {page === "goals" && <Goals />}
          {page === "debts" && <Debts />}
          {page === "categories" && <Categories />}
          {page === "reminders" && <Reminders />}
          {page === "settings" && <Settings onLoadSample={loadSample} />}
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        {(
          [
            { key: "dashboard", label: "Главная", icon: "🏠" },
            { key: "transactions", label: "Операции", icon: "🧾" },
            { key: "analytics", label: "Аналит.", icon: "📊" },
            { key: "debts", label: "Долги", icon: "🏦" },
            { key: "goals", label: "Цели", icon: "🎯" },
          ] as { key: PageKey; label: string; icon: string }[]
        ).map((n) => (
          <button
            key={n.key}
            onClick={() => setPage(n.key)}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
              page === n.key ? "text-brand-700" : "text-slate-500"
            }`}
          >
            <span className="text-lg leading-none">{n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Новая транзакция">
        <TransactionForm onDone={() => setAddOpen(false)} />
      </Modal>
    </div>
  );
}
