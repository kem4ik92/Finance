/**
 * Rich Excel report generator.
 *
 * Builds a multi-sheet workbook (`exceljs`) covering every angle of the user's
 * finances and embeds a PNG chart of monthly income / expense / balance on a
 * dedicated "Движения" sheet. Works fully client-side — no backend roundtrip.
 */

import type * as ExcelJSType from "exceljs";
import type { Account, AppData, Category, Debt, Goal, Transaction } from "../types";

type Worksheet = ExcelJSType.Worksheet;

// -------- colors / styles ---------------------------------------------------

const C = {
  income: "FF16A34A",      // green-600
  expense: "FFDC2626",     // red-600
  transfer: "FF475569",    // slate-600
  balance: "FF2563EB",     // blue-600
  muted: "FF64748B",       // slate-500
  headerBg: "FF1F6FEB",    // brand-600
  headerFg: "FFFFFFFF",
  zebra: "FFF8FAFC",       // slate-50
  border: "FFE2E8F0",      // slate-200
};

const TMT = "#,##0.00\\ \"м.\"";
const TMT_SIGNED = "+#,##0.00\\ \"м.\";-#,##0.00\\ \"м.\";0\\ \"м.\"";
const DATE = "dd.mm.yyyy";

type Row = (string | number | Date | null)[];

// -------- small helpers -----------------------------------------------------

function ym(date: string): string {
  return date.slice(0, 7); // yyyy-mm
}

function parseYM(key: string): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m };
}

const MONTH_RU = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function ymLabel(key: string): string {
  const { year, month } = parseYM(key);
  return `${MONTH_RU[month - 1]}. ${year}`;
}

function clampDate(t: Transaction): Date {
  const d = new Date(t.date);
  return isNaN(d.getTime()) ? new Date() : d;
}

function categoryOf(t: Transaction, cats: Map<string, Category>): string {
  if (!t.categoryId) return t.type === "transfer" ? "Перевод" : "Без категории";
  return cats.get(t.categoryId)?.name ?? "Без категории";
}

function accountOf(id: string | undefined, accounts: Map<string, Account>): string {
  if (!id) return "";
  return accounts.get(id)?.name ?? "—";
}

function signedAmount(t: Transaction): number {
  if (t.type === "income") return t.amount;
  if (t.type === "expense") return -t.amount;
  return 0;
}

// -------- header / table styling helpers -----------------------------------

function styleHeader(ws: Worksheet, rowNumber = 1) {
  const row = ws.getRow(rowNumber);
  row.eachCell({ includeEmpty: false }, (cell) => {
    cell.font = { bold: true, color: { argb: C.headerFg }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.headerBg } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: C.border } },
      bottom: { style: "thin", color: { argb: C.border } },
      left: { style: "thin", color: { argb: C.border } },
      right: { style: "thin", color: { argb: C.border } },
    };
  });
  row.height = 22;
}

function zebra(ws: Worksheet, from = 2) {
  for (let i = from; i <= ws.rowCount; i++) {
    if ((i - from) % 2 === 1) {
      const row = ws.getRow(i);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.zebra } };
      });
    }
  }
}

function autoWidth(ws: Worksheet, headers: string[], rows: Row[]) {
  headers.forEach((h, i) => {
    let max = h.length;
    for (const r of rows) {
      const v = r[i];
      if (v == null) continue;
      const s = v instanceof Date ? DATE : String(v);
      if (s.length > max) max = s.length;
    }
    const col = ws.getColumn(i + 1);
    col.width = Math.min(Math.max(max + 2, 10), 48);
  });
}

function addTable(
  ws: Worksheet,
  headers: string[],
  rows: Row[],
  numberFormats?: (string | null)[],
) {
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  styleHeader(ws, 1);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (numberFormats) {
    numberFormats.forEach((fmt, i) => {
      if (!fmt) return;
      const col = ws.getColumn(i + 1);
      col.numFmt = fmt;
    });
  }
  autoWidth(ws, headers, rows);
  zebra(ws);
  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: headers.length },
    };
  }
}

// -------- chart rendering (PNG on offscreen canvas) -------------------------

interface MonthBucket {
  ym: string;
  income: number;
  expense: number;
  net: number;
  cumulative: number;
}

function monthlyBuckets(data: AppData): MonthBucket[] {
  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const t of data.transactions) {
    if (t.type === "transfer") continue;
    const key = ym(t.date);
    const entry = byMonth.get(key) ?? { income: 0, expense: 0 };
    if (t.type === "income") entry.income += t.amount;
    else entry.expense += t.amount;
    byMonth.set(key, entry);
  }
  const keys = Array.from(byMonth.keys()).sort();
  const openingBalance = data.accounts.reduce((s, a) => s + a.openingBalance, 0);
  let cum = openingBalance;
  return keys.map((k) => {
    const { income, expense } = byMonth.get(k)!;
    const net = income - expense;
    cum += net;
    return { ym: k, income, expense, net, cumulative: cum };
  });
}

function renderChartPng(buckets: MonthBucket[]): ArrayBuffer | null {
  if (buckets.length === 0) return null;
  const W = 1200;
  const H = 520;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // title
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 22px Inter, Arial";
  ctx.fillText("Движения денег: доход · расход · остаток", 24, 36);

  const padL = 70;
  const padR = 40;
  const padT = 72;
  const padB = 80;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // scale for bars
  const maxBar = Math.max(1, ...buckets.map((b) => Math.max(b.income, b.expense)));
  // scale for balance line (can go negative)
  const balances = buckets.map((b) => b.cumulative);
  const bMin = Math.min(0, ...balances);
  const bMax = Math.max(0, ...balances, maxBar);
  const bRange = bMax - bMin || 1;

  // gridlines (income/expense axis on left, 4 steps)
  ctx.strokeStyle = "#e2e8f0";
  ctx.fillStyle = "#64748b";
  ctx.font = "12px Inter, Arial";
  ctx.lineWidth = 1;
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padT + (plotH * i) / steps;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    const leftVal = Math.round(maxBar * (1 - i / steps));
    ctx.textAlign = "right";
    ctx.fillText(leftVal.toLocaleString("ru-RU"), padL - 8, y + 4);
    const rightVal = Math.round(bMax - (bRange * i) / steps);
    ctx.textAlign = "left";
    ctx.fillStyle = "#2563eb";
    ctx.fillText(rightVal.toLocaleString("ru-RU"), W - padR + 6, y + 4);
    ctx.fillStyle = "#64748b";
  }

  // bars
  const groupW = plotW / buckets.length;
  const barW = Math.max(6, Math.min(24, groupW * 0.35));
  buckets.forEach((b, i) => {
    const cx = padL + groupW * (i + 0.5);
    const incH = (b.income / maxBar) * plotH;
    const expH = (b.expense / maxBar) * plotH;
    // income bar (left)
    ctx.fillStyle = "#16a34a";
    ctx.fillRect(cx - barW - 2, padT + plotH - incH, barW, incH);
    // expense bar (right)
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(cx + 2, padT + plotH - expH, barW, expH);
  });

  // balance line
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  buckets.forEach((b, i) => {
    const cx = padL + groupW * (i + 0.5);
    const y = padT + plotH - ((b.cumulative - bMin) / bRange) * plotH;
    if (i === 0) ctx.moveTo(cx, y);
    else ctx.lineTo(cx, y);
  });
  ctx.stroke();
  // balance points
  ctx.fillStyle = "#2563eb";
  buckets.forEach((b, i) => {
    const cx = padL + groupW * (i + 0.5);
    const y = padT + plotH - ((b.cumulative - bMin) / bRange) * plotH;
    ctx.beginPath();
    ctx.arc(cx, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // x-axis labels
  ctx.fillStyle = "#475569";
  ctx.font = "12px Inter, Arial";
  ctx.textAlign = "center";
  buckets.forEach((b, i) => {
    const cx = padL + groupW * (i + 0.5);
    const label = ymLabel(b.ym);
    ctx.fillText(label, cx, H - padB + 20);
  });

  // legend
  const legendY = H - 26;
  const entries: [string, string][] = [
    ["#16a34a", "Доход"],
    ["#dc2626", "Расход"],
    ["#2563eb", "Остаток (накопительно)"],
  ];
  let lx = padL;
  entries.forEach(([color, label]) => {
    ctx.fillStyle = color;
    ctx.fillRect(lx, legendY, 14, 14);
    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "left";
    ctx.fillText(label, lx + 20, legendY + 12);
    lx += 24 + ctx.measureText(label).width + 24;
  });

  // data → ArrayBuffer (PNG)
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

// -------- main entrypoint ---------------------------------------------------

export async function exportRichXlsx(data: AppData): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Manat";
  wb.created = new Date();

  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const categories = new Map(data.categories.map((c) => [c.id, c]));

  const txs = [...data.transactions].sort((a, b) => (a.date < b.date ? 1 : -1));

  // ========== 1. Сводка ==========
  {
    const ws = wb.addWorksheet("Сводка", { properties: { tabColor: { argb: "FF2563EB" } } });
    ws.columns = [
      { width: 38 },
      { width: 22 },
    ];
    ws.addRow(["Manat — детальный финансовый отчёт"]);
    ws.getRow(1).font = { bold: true, size: 16, color: { argb: "FF0F172A" } };
    ws.mergeCells("A1:B1");
    ws.addRow(["Дата отчёта", new Date()]);
    ws.getCell("B2").numFmt = `${DATE} hh:mm`;
    ws.addRow([]);

    const totalIncome = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const totalExpense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const openingBalance = data.accounts.reduce((s, a) => s + a.openingBalance, 0);
    const currentBalance = openingBalance + totalIncome - totalExpense;
    const activeDebt = (data.debts ?? [])
      .filter((d) => !d.closedAt)
      .reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0);
    const savedInGoals = data.goals.reduce((s, g) => s + g.savedAmount, 0);

    const rows: [string, number | string][] = [
      ["Счетов", data.accounts.length],
      ["Начальный баланс всех счетов", openingBalance],
      ["Всего операций", txs.length],
      ["Из них доходов", txs.filter((t) => t.type === "income").length],
      ["Из них расходов", txs.filter((t) => t.type === "expense").length],
      ["Из них переводов", txs.filter((t) => t.type === "transfer").length],
      ["Суммарный доход за всю историю", totalIncome],
      ["Суммарный расход за всю историю", totalExpense],
      ["Чистый итог (доход − расход)", totalIncome - totalExpense],
      ["Текущий общий баланс", currentBalance],
      ["Активных долгов (шт)", (data.debts ?? []).filter((d) => !d.closedAt).length],
      ["Осталось выплатить по долгам", activeDebt],
      ["Активных целей (шт)", data.goals.filter((g) => !g.completedAt).length],
      ["Накоплено на целях", savedInGoals],
    ];
    for (const r of rows) ws.addRow(r);
    for (let i = 4; i <= ws.rowCount; i++) {
      const label = ws.getCell(`A${i}`);
      const value = ws.getCell(`B${i}`);
      label.font = { color: { argb: "FF475569" } };
      label.border = { bottom: { style: "hair", color: { argb: C.border } } };
      value.border = { bottom: { style: "hair", color: { argb: C.border } } };
      value.alignment = { horizontal: "right" };
      if (typeof value.value === "number") value.numFmt = TMT;
    }
    ws.getCell("B6").numFmt = "0"; // counts rows
    // Specifically force integer formatting on count cells:
    [4, 6, 7, 8, 9, 14, 16].forEach((i) => {
      ws.getCell(`B${i}`).numFmt = "0";
    });
  }

  // ========== 2. Движения (chart) ==========
  {
    const ws = wb.addWorksheet("Движения", { properties: { tabColor: { argb: "FF16A34A" } } });
    const buckets = monthlyBuckets(data);
    const png = renderChartPng(buckets);
    if (png) {
      const imageId = wb.addImage({ buffer: png, extension: "png" });
      ws.addImage(imageId, {
        tl: { col: 0, row: 0 },
        ext: { width: 1100, height: 470 },
      });
      // leave room for the image
      for (let i = 1; i <= 25; i++) ws.getRow(i).height = 18;
    }
    // Supporting data below the chart
    const dataStart = 28;
    ws.getCell(`A${dataStart - 1}`).value = "Данные по месяцам (те же, что на графике)";
    ws.getCell(`A${dataStart - 1}`).font = { bold: true, size: 12 };

    const headers = ["Месяц", "Доход", "Расход", "Чистый итог", "Остаток накопительно"];
    ws.getRow(dataStart).values = headers;
    styleHeader(ws, dataStart);
    ws.views = [{ state: "frozen", ySplit: dataStart }];

    buckets.forEach((b, idx) => {
      const row = ws.getRow(dataStart + 1 + idx);
      row.values = [ymLabel(b.ym), b.income, b.expense, b.net, b.cumulative];
      row.getCell(2).numFmt = TMT;
      row.getCell(3).numFmt = TMT;
      row.getCell(4).numFmt = TMT_SIGNED;
      row.getCell(5).numFmt = TMT;
      row.getCell(2).font = { color: { argb: C.income } };
      row.getCell(3).font = { color: { argb: C.expense } };
      row.getCell(4).font = {
        color: { argb: b.net >= 0 ? C.income : C.expense },
        bold: true,
      };
      row.getCell(5).font = { color: { argb: C.balance }, bold: true };
    });

    ws.getColumn(1).width = 14;
    for (let i = 2; i <= 5; i++) ws.getColumn(i).width = 22;
  }

  // ========== 3. Операции (детально) ==========
  {
    const ws = wb.addWorksheet("Операции", { properties: { tabColor: { argb: "FFDC2626" } } });
    const headers = [
      "Дата",
      "День недели",
      "Тип",
      "Сумма",
      "Знак",
      "Счёт",
      "Счёт (куда)",
      "Категория",
      "Группа",
      "Комментарий",
      "Месяц",
      "Год",
    ];
    const dow = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
    const rows: Row[] = txs.map((t) => {
      const d = clampDate(t);
      const typeLabel = t.type === "income" ? "Доход" : t.type === "expense" ? "Расход" : "Перевод";
      const sign = signedAmount(t);
      return [
        d,
        dow[d.getDay()],
        typeLabel,
        t.amount,
        sign,
        accountOf(t.accountId, accounts),
        accountOf(t.toAccountId, accounts),
        categoryOf(t, categories),
        t.type === "transfer" ? "Переводы" : typeLabel,
        t.note ?? "",
        ymLabel(t.date),
        parseYM(ym(t.date)).year,
      ];
    });
    addTable(ws, headers, rows, [
      DATE, null, null, TMT, TMT_SIGNED, null, null, null, null, null, null, "0",
    ]);
    // highlight sign column
    for (let i = 2; i <= rows.length + 1; i++) {
      const cell = ws.getCell(i, 5);
      const v = typeof cell.value === "number" ? cell.value : 0;
      cell.font = {
        color: { argb: v > 0 ? C.income : v < 0 ? C.expense : C.transfer },
        bold: true,
      };
    }
  }

  // ========== 4. По месяцам ==========
  {
    const ws = wb.addWorksheet("По месяцам");
    const buckets = monthlyBuckets(data);
    const headers = [
      "Месяц",
      "Доход",
      "Расход",
      "Чистый итог",
      "Сбережения %",
      "Остаток накопительно",
    ];
    const rows: Row[] = buckets.map((b) => [
      ymLabel(b.ym),
      b.income,
      b.expense,
      b.net,
      b.income > 0 ? b.net / b.income : 0,
      b.cumulative,
    ]);
    addTable(ws, headers, rows, [null, TMT, TMT, TMT_SIGNED, "0.0%", TMT]);
  }

  // ========== 5. Категории (расходы) ==========
  {
    const ws = wb.addWorksheet("Расходы по категориям");
    const expenseTotal = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const grouped = new Map<string, { amount: number; count: number }>();
    for (const t of txs) {
      if (t.type !== "expense") continue;
      const cat = categoryOf(t, categories);
      const e = grouped.get(cat) ?? { amount: 0, count: 0 };
      e.amount += t.amount;
      e.count += 1;
      grouped.set(cat, e);
    }
    const rows: Row[] = Array.from(grouped.entries())
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, v]) => [
        name,
        v.amount,
        expenseTotal > 0 ? v.amount / expenseTotal : 0,
        v.count,
        v.count > 0 ? v.amount / v.count : 0,
      ]);
    addTable(
      ws,
      ["Категория", "Сумма расходов", "Доля", "Операций", "Средний чек"],
      rows,
      [null, TMT, "0.0%", "0", TMT],
    );
  }

  // ========== 6. Категории (доходы) ==========
  {
    const ws = wb.addWorksheet("Доходы по категориям");
    const incomeTotal = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const grouped = new Map<string, { amount: number; count: number }>();
    for (const t of txs) {
      if (t.type !== "income") continue;
      const cat = categoryOf(t, categories);
      const e = grouped.get(cat) ?? { amount: 0, count: 0 };
      e.amount += t.amount;
      e.count += 1;
      grouped.set(cat, e);
    }
    const rows: Row[] = Array.from(grouped.entries())
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, v]) => [
        name,
        v.amount,
        incomeTotal > 0 ? v.amount / incomeTotal : 0,
        v.count,
        v.count > 0 ? v.amount / v.count : 0,
      ]);
    addTable(
      ws,
      ["Категория", "Сумма доходов", "Доля", "Операций", "Средний чек"],
      rows,
      [null, TMT, "0.0%", "0", TMT],
    );
  }

  // ========== 7. Счета с оборотами ==========
  {
    const ws = wb.addWorksheet("Счета");
    const rows: Row[] = data.accounts.map((a) => {
      let income = 0;
      let expense = 0;
      let transferIn = 0;
      let transferOut = 0;
      for (const t of txs) {
        if (t.accountId === a.id) {
          if (t.type === "income") income += t.amount;
          else if (t.type === "expense") expense += t.amount;
          else if (t.type === "transfer") transferOut += t.amount;
        }
        if (t.toAccountId === a.id && t.type === "transfer") transferIn += t.amount;
      }
      const current = a.openingBalance + income - expense + transferIn - transferOut;
      return [
        a.name,
        a.type,
        a.openingBalance,
        income,
        expense,
        transferIn,
        transferOut,
        current,
      ];
    });
    addTable(
      ws,
      [
        "Счёт",
        "Тип",
        "Начальный",
        "Доходы",
        "Расходы",
        "Переводы на",
        "Переводы со",
        "Текущий остаток",
      ],
      rows,
      [null, null, TMT, TMT, TMT, TMT, TMT, TMT],
    );
  }

  // ========== 8. Долги ==========
  {
    const ws = wb.addWorksheet("Долги");
    const debts: Debt[] = data.debts ?? [];
    const rows: Row[] = debts.map((d) => {
      const remaining = Math.max(0, d.totalAmount - d.paidAmount);
      const progress = d.totalAmount > 0 ? d.paidAmount / d.totalAmount : 0;
      return [
        d.name,
        d.creditor ?? "",
        d.totalAmount,
        d.paidAmount,
        remaining,
        progress,
        d.dueDate ? new Date(d.dueDate) : null,
        d.closedAt ? "Закрыт" : "Активный",
        d.note ?? "",
      ];
    });
    addTable(
      ws,
      [
        "Название",
        "Кредитор",
        "Сумма долга",
        "Выплачено",
        "Осталось",
        "Прогресс",
        "Срок",
        "Статус",
        "Заметка",
      ],
      rows,
      [null, null, TMT, TMT, TMT, "0.0%", DATE, null, null],
    );
  }

  // ========== 9. Цели ==========
  {
    const ws = wb.addWorksheet("Цели");
    const rows: Row[] = data.goals.map((g: Goal) => {
      const remaining = Math.max(0, g.targetAmount - g.savedAmount);
      const progress = g.targetAmount > 0 ? g.savedAmount / g.targetAmount : 0;
      return [
        g.name,
        g.targetAmount,
        g.savedAmount,
        remaining,
        progress,
        g.deadline ? new Date(g.deadline) : null,
        g.completedAt ? "Готово" : "Активная",
      ];
    });
    addTable(
      ws,
      [
        "Цель",
        "Целевая сумма",
        "Накоплено",
        "Осталось",
        "Прогресс",
        "Срок",
        "Статус",
      ],
      rows,
      [null, TMT, TMT, TMT, "0.0%", DATE, null],
    );
  }

  // ========== write + download ==========
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `manat-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
