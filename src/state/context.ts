import { createContext, useContext } from "react";
import type {
  Account,
  AppData,
  Category,
  Debt,
  Goal,
  Reminder,
  Transaction,
} from "../types";

export type StoreAction =
  | { type: "replace"; data: AppData }
  | { type: "addTransaction"; tx: Transaction }
  | { type: "updateTransaction"; tx: Transaction }
  | { type: "deleteTransaction"; id: string }
  | { type: "addAccount"; acc: Account }
  | { type: "updateAccount"; acc: Account }
  | { type: "deleteAccount"; id: string }
  | { type: "addCategory"; cat: Category }
  | { type: "updateCategory"; cat: Category }
  | { type: "deleteCategory"; id: string }
  | { type: "addGoal"; goal: Goal }
  | { type: "updateGoal"; goal: Goal }
  | { type: "deleteGoal"; id: string }
  | {
      type: "contributeGoal";
      goalId: string;
      amount: number;
      accountId?: string;
      note?: string;
    }
  | { type: "addDebt"; debt: Debt }
  | { type: "updateDebt"; debt: Debt }
  | { type: "deleteDebt"; id: string }
  | {
      type: "payDebt";
      debtId: string;
      amount: number;
      accountId?: string;
      note?: string;
    }
  | { type: "addReminder"; reminder: Reminder }
  | { type: "updateReminder"; reminder: Reminder }
  | { type: "deleteReminder"; id: string }
  | { type: "applyReminder"; id: string }
  | { type: "reset" };

export interface StoreContextValue {
  data: AppData;
  dispatch: React.Dispatch<StoreAction>;
  addTransaction: (tx: Omit<Transaction, "id" | "createdAt">) => void;
  updateTransaction: (tx: Transaction) => void;
  deleteTransaction: (id: string) => void;
  addAccount: (acc: Omit<Account, "id" | "createdAt">) => void;
  updateAccount: (acc: Account) => void;
  deleteAccount: (id: string) => void;
  addCategory: (cat: Omit<Category, "id">) => void;
  updateCategory: (cat: Category) => void;
  deleteCategory: (id: string) => void;
  addGoal: (
    g: Omit<Goal, "id" | "createdAt" | "savedAmount"> & { savedAmount?: number },
  ) => void;
  updateGoal: (g: Goal) => void;
  deleteGoal: (id: string) => void;
  contributeGoal: (goalId: string, amount: number, accountId?: string, note?: string) => void;
  addDebt: (
    d: Omit<Debt, "id" | "createdAt" | "paidAmount"> & { paidAmount?: number },
  ) => void;
  updateDebt: (d: Debt) => void;
  deleteDebt: (id: string) => void;
  payDebt: (debtId: string, amount: number, accountId?: string, note?: string) => void;
  addReminder: (r: Omit<Reminder, "id" | "createdAt">) => void;
  updateReminder: (r: Reminder) => void;
  deleteReminder: (id: string) => void;
  applyReminder: (id: string) => void;
  reset: () => void;
  importData: (data: AppData) => void;
}

export const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore вне <StoreProvider />");
  return ctx;
}
