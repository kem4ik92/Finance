import type { AppData, Category, Transaction } from "../types";

export interface CategorySpend {
  categoryId: string | null;
  name: string;
  icon: string;
  color: string;
  amount: number;
  share: number;
  monthly: number;
}

export interface SavingsTip {
  categoryId: string | null;
  name: string;
  icon: string;
  color: string;
  monthly: number;
  share: number;
  /** Suggested cut as share of current spend, e.g. 0.2 = −20%. */
  cutShare: number;
  /** Monthly savings in TMT if user cuts this amount. */
  monthlySavings: number;
  message: string;
}

export interface DebtAdvice {
  /** Total remaining debt (sum of totalAmount − paidAmount). */
  totalRemaining: number;
  /** How many months of income the debt equals (if avg income > 0). */
  monthsOfIncome: number | null;
  /** Months of cushion the user currently has (income − expense > 0). */
  currentMonthsCushion: number | null;
  /** Suggested monthly cuts, sorted by biggest impact. */
  tips: SavingsTip[];
  /** Projected months to close debt with current pace (income − expense). */
  monthsAtCurrentPace: number | null;
  /** Projected months if user follows ALL the suggested cuts. */
  monthsWithCuts: number | null;
  /** How many recent months of data were analysed (1..6). */
  monthsAnalysed: number;
}

function monthsBack(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function analyseRecentSpending(data: AppData, lookback = 3): {
  monthlyIncome: number;
  monthlyExpense: number;
  monthsAnalysed: number;
  perCategory: CategorySpend[];
} {
  const window = new Set(monthsBack(lookback));
  const relevant: Transaction[] = data.transactions.filter((t) => window.has(monthKey(t.date)));
  const activeMonths = new Set(relevant.map((t) => monthKey(t.date)));
  const monthsAnalysed = Math.max(1, activeMonths.size);

  let income = 0;
  let expense = 0;
  const byCat = new Map<string, { amount: number }>();
  for (const t of relevant) {
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") {
      expense += t.amount;
      const key = t.categoryId ?? "__none__";
      const cur = byCat.get(key) ?? { amount: 0 };
      cur.amount += t.amount;
      byCat.set(key, cur);
    }
  }

  const categoryById = new Map<string, Category>(data.categories.map((c) => [c.id, c]));
  const perCategory: CategorySpend[] = Array.from(byCat.entries())
    .map(([key, { amount }]) => {
      const cat = key === "__none__" ? null : (categoryById.get(key) ?? null);
      return {
        categoryId: cat ? cat.id : null,
        name: cat ? cat.name : "Без категории",
        icon: cat?.icon ?? "•",
        color: cat?.color ?? "#94a3b8",
        amount,
        share: expense > 0 ? amount / expense : 0,
        monthly: amount / monthsAnalysed,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    monthlyIncome: income / monthsAnalysed,
    monthlyExpense: expense / monthsAnalysed,
    monthsAnalysed,
    perCategory,
  };
}

/**
 * Categories considered "essential" — we suggest smaller cuts here.
 * Match by default category IDs.
 */
const ESSENTIAL_IDS = new Set([
  "cat-rent",
  "cat-utilities",
  "cat-health",
  "cat-education",
  "cat-family",
  "cat-transport",
]);

const DISCRETIONARY_IDS = new Set([
  "cat-cafe",
  "cat-entertainment",
  "cat-clothes",
  "cat-gifts",
]);

function cutShareFor(categoryId: string | null, share: number): number {
  if (!categoryId) return Math.min(0.3, 0.1 + share);
  if (DISCRETIONARY_IDS.has(categoryId)) return 0.3;
  if (ESSENTIAL_IDS.has(categoryId)) return 0.1;
  return 0.2;
}

function formatCutMessage(tip: SavingsTip): string {
  const pct = Math.round(tip.cutShare * 100);
  return `Сократите «${tip.name}» на ${pct}% — это освободит ~${Math.round(
    tip.monthlySavings,
  )} м./мес. на погашение долгов.`;
}

export function computeDebtAdvice(data: AppData, lookback = 3): DebtAdvice {
  const openDebts = data.debts.filter((d) => !d.closedAt && d.totalAmount - d.paidAmount > 0);
  const totalRemaining = openDebts.reduce(
    (sum, d) => sum + Math.max(0, d.totalAmount - d.paidAmount),
    0,
  );
  const { monthlyIncome, monthlyExpense, monthsAnalysed, perCategory } = analyseRecentSpending(
    data,
    lookback,
  );
  const currentCushion = monthlyIncome - monthlyExpense;

  const rawTips: SavingsTip[] = perCategory
    .filter((c) => c.monthly > 0)
    .slice(0, 5)
    .map((c) => {
      const cutShare = cutShareFor(c.categoryId, c.share);
      const monthlySavings = c.monthly * cutShare;
      const tip: SavingsTip = {
        categoryId: c.categoryId,
        name: c.name,
        icon: c.icon,
        color: c.color,
        monthly: c.monthly,
        share: c.share,
        cutShare,
        monthlySavings,
        message: "",
      };
      tip.message = formatCutMessage(tip);
      return tip;
    })
    .filter((t) => t.monthlySavings > 0)
    .sort((a, b) => b.monthlySavings - a.monthlySavings)
    .slice(0, 3);

  const totalSavings = rawTips.reduce((s, t) => s + t.monthlySavings, 0);
  const paceWithCuts = currentCushion + totalSavings;

  return {
    totalRemaining,
    monthsOfIncome: monthlyIncome > 0 ? totalRemaining / monthlyIncome : null,
    currentMonthsCushion:
      currentCushion > 0 && totalRemaining > 0 ? totalRemaining / currentCushion : null,
    tips: rawTips,
    monthsAtCurrentPace:
      currentCushion > 0 && totalRemaining > 0 ? totalRemaining / currentCushion : null,
    monthsWithCuts:
      paceWithCuts > 0 && totalRemaining > 0 ? totalRemaining / paceWithCuts : null,
    monthsAnalysed,
  };
}
