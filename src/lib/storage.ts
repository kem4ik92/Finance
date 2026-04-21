import type { AppData } from "../types";
import { createDefaultData } from "./defaults";

const STORAGE_KEY = "finance-tracker-data-v1";

export function loadData(): AppData {
  if (typeof window === "undefined") return createDefaultData();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultData();
    const parsed = JSON.parse(raw) as Partial<AppData>;
    const defaults = createDefaultData();
    return {
      version: parsed.version ?? defaults.version,
      accounts: parsed.accounts ?? defaults.accounts,
      categories: parsed.categories ?? defaults.categories,
      transactions: parsed.transactions ?? [],
      goals: parsed.goals ?? [],
      debts: parsed.debts ?? [],
      reminders: parsed.reminders ?? [],
      settings: { ...defaults.settings, ...(parsed.settings ?? {}) },
    };
  } catch (err) {
    console.warn("Не удалось прочитать сохранённые данные:", err);
    return createDefaultData();
  }
}

export function saveData(data: AppData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("Не удалось сохранить данные:", err);
  }
}

export function resetData() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
