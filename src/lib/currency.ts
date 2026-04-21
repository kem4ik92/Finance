export const CURRENCY = "TMT";
export const CURRENCY_SYMBOL = "м."; // короткое обозначение туркменского маната

const formatter = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatMoney(amount: number, options?: { sign?: boolean; compact?: boolean }) {
  const abs = Math.abs(amount);
  const formatted = options?.compact ? compactFormatter.format(abs) : formatter.format(abs);
  const sign = options?.sign && amount !== 0 ? (amount > 0 ? "+" : "−") : amount < 0 ? "−" : "";
  return `${sign}${formatted} ${CURRENCY_SYMBOL}`;
}

export function parseMoney(value: string): number {
  if (!value) return 0;
  const cleaned = value
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
