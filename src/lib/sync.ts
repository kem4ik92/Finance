import type {
  Account,
  AppData,
  Category,
  Debt,
  Goal,
  Transaction,
} from "../types";

const SYNC_KEY = "finance-tracker-sync-v1";

export interface SyncConfig {
  apiBase: string;
  workspaceId: string;
  linkCode: string;
  connectedAt: string;
}

const DEFAULT_API_BASE = "https://manat-backend-txrnbhuq.fly.dev";

export function getApiBase(): string {
  const cfg = getSyncConfig();
  return cfg?.apiBase ?? DEFAULT_API_BASE;
}

export function getSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncConfig;
    if (!parsed?.workspaceId || !parsed?.apiBase) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSyncConfig(cfg: SyncConfig) {
  localStorage.setItem(SYNC_KEY, JSON.stringify(cfg));
}

export function clearSyncConfig() {
  localStorage.removeItem(SYNC_KEY);
}

export function isSynced(): boolean {
  return getSyncConfig() !== null;
}

async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<T> {
  const cfg = getSyncConfig();
  const base = cfg?.apiBase ?? DEFAULT_API_BASE;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init?.headers ?? {}),
  };
  const opts: RequestInit = {
    method: init?.method ?? "GET",
    headers,
  };
  if (init?.body !== undefined) {
    opts.body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  }
  const res = await fetch(base + path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface WorkspaceState {
  workspace: { id: string; linkCode: string; name: string | null };
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  debts: Debt[];
  goals: Goal[];
}

export async function resolveCode(
  code: string,
  apiBase: string = DEFAULT_API_BASE,
): Promise<{ workspaceId: string; linkCode: string }> {
  const clean = code.trim().toUpperCase();
  if (!clean) throw new Error("Введите код");
  const res = await fetch(`${apiBase}/api/workspaces/by-code/${clean}`);
  if (res.status === 404) throw new Error("Код не найден. Проверь /link в боте.");
  if (!res.ok) throw new Error(`Ошибка ${res.status}`);
  return (await res.json()) as { workspaceId: string; linkCode: string };
}

export async function pullState(): Promise<Partial<AppData> | null> {
  const cfg = getSyncConfig();
  if (!cfg) return null;
  const s = await api<WorkspaceState>(
    `/api/workspaces/${cfg.workspaceId}/state`,
  );
  return {
    accounts: s.accounts,
    categories: s.categories,
    transactions: s.transactions,
    debts: s.debts,
    goals: s.goals,
  };
}

export async function connect(
  code: string,
  apiBase: string = DEFAULT_API_BASE,
): Promise<void> {
  const { workspaceId, linkCode } = await resolveCode(code, apiBase);
  setSyncConfig({
    apiBase,
    workspaceId,
    linkCode,
    connectedAt: new Date().toISOString(),
  });
}

export function disconnect() {
  clearSyncConfig();
}

// -------- per-action sync helpers (fire-and-forget) --------

function warn(err: unknown, what: string) {
  // eslint-disable-next-line no-console
  console.warn(`[sync] ${what} failed:`, err);
}

function wsPath(segment: string): string | null {
  const cfg = getSyncConfig();
  if (!cfg) return null;
  return `/api/workspaces/${cfg.workspaceId}${segment}`;
}

async function post(path: string, body: unknown): Promise<void> {
  const full = wsPath(path);
  if (!full) return;
  await api(full, { method: "POST", body });
}

async function patch(path: string, body: unknown): Promise<void> {
  const full = wsPath(path);
  if (!full) return;
  await api(full, { method: "PATCH", body });
}

async function del(path: string): Promise<void> {
  const full = wsPath(path);
  if (!full) return;
  await api(full, { method: "DELETE" });
}

// Convert Transaction → backend payload (camelCase already matches)
function txPayload(t: Transaction) {
  return {
    id: t.id,
    type: t.type,
    amount: t.amount,
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    categoryId: t.categoryId,
    note: t.note,
    date: t.date,
  };
}

export const sync = {
  addTransaction(tx: Transaction) {
    post("/transactions", txPayload(tx)).catch((e) => warn(e, "addTransaction"));
  },
  updateTransaction(tx: Transaction) {
    patch(`/transactions/${tx.id}`, txPayload(tx)).catch((e) =>
      warn(e, "updateTransaction"),
    );
  },
  deleteTransaction(id: string) {
    del(`/transactions/${id}`).catch((e) => warn(e, "deleteTransaction"));
  },

  addAccount(a: Account) {
    post("/accounts", {
      id: a.id,
      name: a.name,
      type: a.type,
      openingBalance: a.openingBalance,
      color: a.color,
      icon: a.icon,
    }).catch((e) => warn(e, "addAccount"));
  },
  updateAccount(a: Account) {
    patch(`/accounts/${a.id}`, {
      name: a.name,
      type: a.type,
      openingBalance: a.openingBalance,
      color: a.color,
      icon: a.icon,
    }).catch((e) => warn(e, "updateAccount"));
  },
  deleteAccount(id: string) {
    del(`/accounts/${id}`).catch((e) => warn(e, "deleteAccount"));
  },

  addCategory(c: Category) {
    post("/categories", {
      id: c.id,
      name: c.name,
      type: c.type,
      color: c.color,
      icon: c.icon,
    }).catch((e) => warn(e, "addCategory"));
  },
  updateCategory(c: Category) {
    patch(`/categories/${c.id}`, {
      name: c.name,
      type: c.type,
      color: c.color,
      icon: c.icon,
    }).catch((e) => warn(e, "updateCategory"));
  },
  deleteCategory(id: string) {
    del(`/categories/${id}`).catch((e) => warn(e, "deleteCategory"));
  },

  addDebt(d: Debt) {
    post("/debts", {
      id: d.id,
      name: d.name,
      totalAmount: d.totalAmount,
      paidAmount: d.paidAmount,
      creditor: d.creditor,
      dueDate: d.dueDate,
      color: d.color,
      icon: d.icon,
      note: d.note,
    }).catch((e) => warn(e, "addDebt"));
  },
  updateDebt(d: Debt) {
    patch(`/debts/${d.id}`, {
      name: d.name,
      totalAmount: d.totalAmount,
      paidAmount: d.paidAmount,
      creditor: d.creditor,
      dueDate: d.dueDate,
      color: d.color,
      icon: d.icon,
      note: d.note,
    }).catch((e) => warn(e, "updateDebt"));
  },
  deleteDebt(id: string) {
    del(`/debts/${id}`).catch((e) => warn(e, "deleteDebt"));
  },
  payDebt(id: string, amount: number, accountId?: string, note?: string) {
    post(`/debts/${id}/pay`, { amount, accountId, note }).catch((e) =>
      warn(e, "payDebt"),
    );
  },

  addGoal(g: Goal) {
    post("/goals", {
      id: g.id,
      name: g.name,
      targetAmount: g.targetAmount,
      savedAmount: g.savedAmount,
      deadline: g.deadline,
      color: g.color,
      icon: g.icon,
    }).catch((e) => warn(e, "addGoal"));
  },
  updateGoal(g: Goal) {
    patch(`/goals/${g.id}`, {
      name: g.name,
      targetAmount: g.targetAmount,
      savedAmount: g.savedAmount,
      deadline: g.deadline,
      color: g.color,
      icon: g.icon,
    }).catch((e) => warn(e, "updateGoal"));
  },
  deleteGoal(id: string) {
    del(`/goals/${id}`).catch((e) => warn(e, "deleteGoal"));
  },
};
