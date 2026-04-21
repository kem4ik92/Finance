import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { v4 as uuid } from "uuid";
import type { AppData, Debt, Goal, Transaction } from "../types";
import { loadData, saveData, resetData } from "../lib/storage";
import { addFrequency, todayIso } from "../lib/date";
import { createDefaultData } from "../lib/defaults";
import { isSynced, pullState, sync } from "../lib/sync";
import {
  StoreContext,
  type StoreAction,
  type StoreContextValue,
} from "./context";

function reducer(state: AppData, action: StoreAction): AppData {
  switch (action.type) {
    case "replace":
      return action.data;
    case "addTransaction":
      return { ...state, transactions: [action.tx, ...state.transactions] };
    case "updateTransaction":
      return {
        ...state,
        transactions: state.transactions.map((t) =>
          t.id === action.tx.id ? action.tx : t,
        ),
      };
    case "deleteTransaction":
      return {
        ...state,
        transactions: state.transactions.filter((t) => t.id !== action.id),
      };
    case "addAccount":
      return { ...state, accounts: [...state.accounts, action.acc] };
    case "updateAccount":
      return {
        ...state,
        accounts: state.accounts.map((a) =>
          a.id === action.acc.id ? action.acc : a,
        ),
      };
    case "deleteAccount":
      return {
        ...state,
        accounts: state.accounts.filter((a) => a.id !== action.id),
        transactions: state.transactions.filter(
          (t) => t.accountId !== action.id && t.toAccountId !== action.id,
        ),
      };
    case "addCategory":
      return { ...state, categories: [...state.categories, action.cat] };
    case "updateCategory":
      return {
        ...state,
        categories: state.categories.map((c) =>
          c.id === action.cat.id ? action.cat : c,
        ),
      };
    case "deleteCategory":
      return {
        ...state,
        categories: state.categories.filter((c) => c.id !== action.id),
        transactions: state.transactions.map((t) =>
          t.categoryId === action.id ? { ...t, categoryId: undefined } : t,
        ),
      };
    case "addGoal":
      return { ...state, goals: [...state.goals, action.goal] };
    case "updateGoal":
      return {
        ...state,
        goals: state.goals.map((g) => (g.id === action.goal.id ? action.goal : g)),
      };
    case "deleteGoal":
      return { ...state, goals: state.goals.filter((g) => g.id !== action.id) };
    case "contributeGoal": {
      const goal = state.goals.find((g) => g.id === action.goalId);
      if (!goal) return state;
      const newSaved = Math.max(0, goal.savedAmount + action.amount);
      const completed = newSaved >= goal.targetAmount;
      const updatedGoal: Goal = {
        ...goal,
        savedAmount: newSaved,
        completedAt:
          completed && !goal.completedAt ? new Date().toISOString() : goal.completedAt,
      };
      const newGoals = state.goals.map((g) => (g.id === goal.id ? updatedGoal : g));
      const newTxs = action.accountId
        ? [
            {
              id: uuid(),
              type: action.amount >= 0 ? ("expense" as const) : ("income" as const),
              amount: Math.abs(action.amount),
              accountId: action.accountId,
              note: action.note ?? `Пополнение цели «${goal.name}»`,
              date: todayIso(),
              createdAt: new Date().toISOString(),
            },
            ...state.transactions,
          ]
        : state.transactions;
      return { ...state, goals: newGoals, transactions: newTxs };
    }
    case "addDebt":
      return { ...state, debts: [...state.debts, action.debt] };
    case "updateDebt":
      return {
        ...state,
        debts: state.debts.map((d) => (d.id === action.debt.id ? action.debt : d)),
      };
    case "deleteDebt":
      return { ...state, debts: state.debts.filter((d) => d.id !== action.id) };
    case "payDebt": {
      const debt = state.debts.find((d) => d.id === action.debtId);
      if (!debt) return state;
      const newPaid = Math.min(debt.totalAmount, debt.paidAmount + action.amount);
      const closed = newPaid >= debt.totalAmount;
      const updatedDebt: Debt = {
        ...debt,
        paidAmount: newPaid,
        closedAt:
          closed && !debt.closedAt ? new Date().toISOString() : debt.closedAt,
      };
      const newDebts = state.debts.map((d) => (d.id === debt.id ? updatedDebt : d));
      const newTxs = action.accountId
        ? [
            {
              id: uuid(),
              type: "expense" as const,
              amount: action.amount,
              accountId: action.accountId,
              note: action.note ?? `Погашение долга «${debt.name}»`,
              date: todayIso(),
              createdAt: new Date().toISOString(),
            },
            ...state.transactions,
          ]
        : state.transactions;
      return { ...state, debts: newDebts, transactions: newTxs };
    }
    case "addReminder":
      return { ...state, reminders: [...state.reminders, action.reminder] };
    case "updateReminder":
      return {
        ...state,
        reminders: state.reminders.map((r) =>
          r.id === action.reminder.id ? action.reminder : r,
        ),
      };
    case "deleteReminder":
      return {
        ...state,
        reminders: state.reminders.filter((r) => r.id !== action.id),
      };
    case "applyReminder": {
      const r = state.reminders.find((x) => x.id === action.id);
      if (!r) return state;
      const tx: Transaction = {
        id: uuid(),
        type: r.type,
        amount: r.amount,
        accountId: r.accountId,
        categoryId: r.categoryId,
        note: r.title,
        date: r.nextDate,
        createdAt: new Date().toISOString(),
      };
      const next = addFrequency(r.nextDate, r.frequency);
      return {
        ...state,
        transactions: [tx, ...state.transactions],
        reminders: state.reminders.map((x) =>
          x.id === r.id
            ? { ...x, nextDate: next, lastAppliedAt: new Date().toISOString() }
            : x,
        ),
      };
    }
    case "reset":
      resetData();
      return createDefaultData();
    default:
      return state;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, undefined, loadData);

  useEffect(() => {
    saveData(data);
  }, [data]);

  // On mount (and when sync gets enabled), pull fresh state from backend.
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      if (!isSynced()) return;
      try {
        const remote = await pullState();
        if (!cancelled && remote) {
          dispatch({ type: "replace", data: { ...data, ...remote } });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[sync] initial pull failed:", err);
      }
    }
    hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-pull on focus, visibility change, and poll while the tab is visible
  // so that changes made via the Telegram bot show up without a manual refresh.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function refresh() {
      if (!isSynced() || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const remote = await pullState();
        if (!cancelled && remote) {
          dispatch({ type: "replace", data: { ...data, ...remote } });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[sync] refresh failed:", err);
      } finally {
        inFlight = false;
      }
    }

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 20000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [data]);

  const value: StoreContextValue = useMemo(
    () => ({
      data,
      dispatch,
      addTransaction: (tx) => {
        const full: Transaction = { ...tx, id: uuid(), createdAt: new Date().toISOString() };
        dispatch({ type: "addTransaction", tx: full });
        sync.addTransaction(full);
      },
      updateTransaction: (tx) => {
        dispatch({ type: "updateTransaction", tx });
        sync.updateTransaction(tx);
      },
      deleteTransaction: (id) => {
        dispatch({ type: "deleteTransaction", id });
        sync.deleteTransaction(id);
      },
      addAccount: (acc) => {
        const full = { ...acc, id: uuid(), createdAt: new Date().toISOString() };
        dispatch({ type: "addAccount", acc: full });
        sync.addAccount(full);
      },
      updateAccount: (acc) => {
        dispatch({ type: "updateAccount", acc });
        sync.updateAccount(acc);
      },
      deleteAccount: (id) => {
        dispatch({ type: "deleteAccount", id });
        sync.deleteAccount(id);
      },
      addCategory: (cat) => {
        const full = { ...cat, id: uuid() };
        dispatch({ type: "addCategory", cat: full });
        sync.addCategory(full);
      },
      updateCategory: (cat) => {
        dispatch({ type: "updateCategory", cat });
        sync.updateCategory(cat);
      },
      deleteCategory: (id) => {
        dispatch({ type: "deleteCategory", id });
        sync.deleteCategory(id);
      },
      addGoal: (g) => {
        const full: Goal = {
          ...g,
          id: uuid(),
          savedAmount: g.savedAmount ?? 0,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "addGoal", goal: full });
        sync.addGoal(full);
      },
      updateGoal: (goal) => {
        dispatch({ type: "updateGoal", goal });
        sync.updateGoal(goal);
      },
      deleteGoal: (id) => {
        dispatch({ type: "deleteGoal", id });
        sync.deleteGoal(id);
      },
      contributeGoal: (goalId, amount, accountId, note) => {
        dispatch({ type: "contributeGoal", goalId, amount, accountId, note });
        const current = data.goals.find((g) => g.id === goalId);
        if (current) {
          const next: Goal = {
            ...current,
            savedAmount: Math.max(0, current.savedAmount + amount),
          };
          sync.updateGoal(next);
        }
      },
      addDebt: (d) => {
        const full: Debt = {
          ...d,
          id: uuid(),
          paidAmount: d.paidAmount ?? 0,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "addDebt", debt: full });
        sync.addDebt(full);
      },
      updateDebt: (debt) => {
        dispatch({ type: "updateDebt", debt });
        sync.updateDebt(debt);
      },
      deleteDebt: (id) => {
        dispatch({ type: "deleteDebt", id });
        sync.deleteDebt(id);
      },
      payDebt: (debtId, amount, accountId, note) => {
        dispatch({ type: "payDebt", debtId, amount, accountId, note });
        sync.payDebt(debtId, amount, accountId, note);
      },
      addReminder: (r) =>
        dispatch({
          type: "addReminder",
          reminder: { ...r, id: uuid(), createdAt: new Date().toISOString() },
        }),
      updateReminder: (reminder) => dispatch({ type: "updateReminder", reminder }),
      deleteReminder: (id) => dispatch({ type: "deleteReminder", id }),
      applyReminder: (id) => dispatch({ type: "applyReminder", id }),
      reset: () => dispatch({ type: "reset" }),
      importData: (d) => dispatch({ type: "replace", data: d }),
    }),
    [data],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}


