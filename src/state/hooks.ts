import { useMemo } from "react";
import { useStore } from "./context";

export function useAccountBalances(): Record<string, number> {
  const { data } = useStore();
  return useMemo(() => {
    const balances: Record<string, number> = {};
    data.accounts.forEach((a) => {
      balances[a.id] = a.openingBalance;
    });
    data.transactions.forEach((t) => {
      if (t.type === "income") balances[t.accountId] = (balances[t.accountId] ?? 0) + t.amount;
      else if (t.type === "expense")
        balances[t.accountId] = (balances[t.accountId] ?? 0) - t.amount;
      else if (t.type === "transfer" && t.toAccountId) {
        balances[t.accountId] = (balances[t.accountId] ?? 0) - t.amount;
        balances[t.toAccountId] = (balances[t.toAccountId] ?? 0) + t.amount;
      }
    });
    return balances;
  }, [data]);
}
