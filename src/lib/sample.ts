import { v4 as uuid } from "uuid";
import type { AppData, Transaction } from "../types";

function randomAmount(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function generateSampleTransactions(data: AppData): Transaction[] {
  const out: Transaction[] = [];
  const now = new Date();
  const catsExpense = data.categories.filter((c) => c.type === "expense");
  const catsIncome = data.categories.filter((c) => c.type === "income");
  const accounts = data.accounts;

  for (let m = 2; m >= 0; m--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
    // Salary 1st and 16th
    [1, 16].forEach((day) => {
      const d = new Date(monthStart);
      d.setDate(day);
      if (d <= now) {
        out.push({
          id: uuid(),
          type: "income",
          amount: 3000,
          accountId: accounts.find((a) => a.type === "card")?.id ?? accounts[0].id,
          categoryId: catsIncome.find((c) => c.name === "Зарплата")?.id,
          note: day === 1 ? "Аванс" : "Зарплата",
          date: iso(d),
          createdAt: new Date().toISOString(),
        });
      }
    });

    // Random expenses ~25 per month
    const endOfMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const limit = m === 0 ? now : endOfMonth;
    const daysInPeriod = Math.max(1, Math.ceil((limit.getTime() - monthStart.getTime()) / 86_400_000));
    const count = Math.min(30, Math.max(10, Math.round(daysInPeriod * 0.8)));
    for (let i = 0; i < count; i++) {
      const cat = catsExpense[Math.floor(Math.random() * catsExpense.length)];
      const d = new Date(monthStart);
      d.setDate(1 + Math.floor(Math.random() * daysInPeriod));
      if (d > now) continue;
      const baseAmounts: Record<string, [number, number]> = {
        Продукты: [40, 300],
        "Кафе и рестораны": [30, 200],
        Транспорт: [5, 60],
        Коммунальные: [150, 600],
        Аренда: [1500, 2500],
        Здоровье: [50, 400],
        Одежда: [100, 800],
        Образование: [100, 500],
        Развлечения: [50, 300],
        Подарки: [50, 400],
        "Семья и дети": [100, 600],
        Прочее: [20, 200],
      };
      const [min, max] = baseAmounts[cat.name] ?? [20, 200];
      out.push({
        id: uuid(),
        type: "expense",
        amount: randomAmount(min, max),
        accountId:
          Math.random() > 0.3
            ? accounts.find((a) => a.type === "card")?.id ?? accounts[0].id
            : accounts.find((a) => a.type === "cash")?.id ?? accounts[0].id,
        categoryId: cat.id,
        note: "",
        date: iso(d),
        createdAt: new Date().toISOString(),
      });
    }
  }

  return out;
}
