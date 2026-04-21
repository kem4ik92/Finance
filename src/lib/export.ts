import * as XLSX from "xlsx";
import type { AppData, Transaction } from "../types";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function txRows(data: AppData) {
  const accountMap = new Map(data.accounts.map((a) => [a.id, a.name]));
  const categoryMap = new Map(data.categories.map((c) => [c.id, c.name]));
  return data.transactions.map((t) => ({
    Дата: t.date,
    Тип: t.type === "income" ? "Доход" : t.type === "expense" ? "Расход" : "Перевод",
    Сумма: t.amount,
    Счёт: accountMap.get(t.accountId) ?? "—",
    "Счёт (куда)": t.toAccountId ? (accountMap.get(t.toAccountId) ?? "") : "",
    Категория: t.categoryId ? (categoryMap.get(t.categoryId) ?? "") : "",
    Комментарий: t.note ?? "",
  }));
}

export function exportCsv(data: AppData) {
  const rows = txRows(data);
  if (rows.length === 0) {
    alert("Нет транзакций для экспорта.");
    return;
  }
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [headers.join(";"), ...rows.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  download(blob, `finance-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function exportXlsx(data: AppData) {
  const wb = XLSX.utils.book_new();
  const txSheet = XLSX.utils.json_to_sheet(txRows(data));
  XLSX.utils.book_append_sheet(wb, txSheet, "Транзакции");
  const accSheet = XLSX.utils.json_to_sheet(
    data.accounts.map((a) => ({
      Название: a.name,
      Тип: a.type,
      "Начальный баланс": a.openingBalance,
    })),
  );
  XLSX.utils.book_append_sheet(wb, accSheet, "Счета");
  const catSheet = XLSX.utils.json_to_sheet(
    data.categories.map((c) => ({
      Название: c.name,
      Тип: c.type === "income" ? "Доход" : "Расход",
    })),
  );
  XLSX.utils.book_append_sheet(wb, catSheet, "Категории");
  const goalSheet = XLSX.utils.json_to_sheet(
    data.goals.map((g) => ({
      Цель: g.name,
      "Целевая сумма": g.targetAmount,
      Накоплено: g.savedAmount,
      Срок: g.deadline ?? "",
    })),
  );
  XLSX.utils.book_append_sheet(wb, goalSheet, "Цели");
  const debtSheet = XLSX.utils.json_to_sheet(
    (data.debts ?? []).map((d) => ({
      Долг: d.name,
      Кредитор: d.creditor ?? "",
      "Сумма долга": d.totalAmount,
      Выплачено: d.paidAmount,
      Осталось: Math.max(0, d.totalAmount - d.paidAmount),
      Срок: d.dueDate ?? "",
      Статус: d.closedAt ? "Закрыт" : "Активный",
    })),
  );
  XLSX.utils.book_append_sheet(wb, debtSheet, "Долги");
  XLSX.writeFile(wb, `finance-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportJson(data: AppData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  download(blob, `finance-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function importJsonFile(file: File): Promise<AppData> {
  const text = await file.text();
  const parsed = JSON.parse(text) as AppData;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.accounts)) {
    throw new Error("Неверный формат файла резервной копии.");
  }
  return parsed;
}

export async function importCsvAsTransactions(
  file: File,
  data: AppData,
): Promise<Transaction[]> {
  const text = await file.text();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const parseLine = (line: string) => {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === delimiter) {
          result.push(cur);
          cur = "";
        } else cur += ch;
      }
    }
    result.push(cur);
    return result;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.findIndex((h) => h === name.toLowerCase());
  const dateIdx = idx("Дата");
  const typeIdx = idx("Тип");
  const amountIdx = idx("Сумма");
  const accountIdx = idx("Счёт");
  const toAccountIdx = idx("Счёт (куда)");
  const categoryIdx = idx("Категория");
  const noteIdx = idx("Комментарий");
  if (dateIdx < 0 || typeIdx < 0 || amountIdx < 0 || accountIdx < 0) {
    throw new Error("CSV должен содержать столбцы: Дата, Тип, Сумма, Счёт");
  }
  const accountByName = new Map(data.accounts.map((a) => [a.name.toLowerCase(), a.id]));
  const categoryByName = new Map(data.categories.map((c) => [c.name.toLowerCase(), c.id]));
  const out: Transaction[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const typeStr = (cols[typeIdx] ?? "").trim().toLowerCase();
    const type: Transaction["type"] = typeStr.startsWith("дох")
      ? "income"
      : typeStr.startsWith("пер")
      ? "transfer"
      : "expense";
    const amount = Number((cols[amountIdx] ?? "0").replace(",", "."));
    const accName = (cols[accountIdx] ?? "").trim().toLowerCase();
    const accId = accountByName.get(accName);
    if (!accId) continue;
    const toAccId =
      toAccountIdx >= 0 && cols[toAccountIdx]
        ? accountByName.get(cols[toAccountIdx].trim().toLowerCase())
        : undefined;
    const catId =
      categoryIdx >= 0 && cols[categoryIdx]
        ? categoryByName.get(cols[categoryIdx].trim().toLowerCase())
        : undefined;
    out.push({
      id: crypto.randomUUID(),
      type,
      amount: Math.abs(amount),
      accountId: accId,
      toAccountId: toAccId,
      categoryId: catId,
      note: noteIdx >= 0 ? cols[noteIdx] : undefined,
      date: (cols[dateIdx] ?? "").trim(),
      createdAt: new Date().toISOString(),
    });
  }
  return out;
}
