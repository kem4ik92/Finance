import { format, parseISO, isValid } from "date-fns";
import { ru } from "date-fns/locale";

export function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDate(iso: string, pattern = "d MMM yyyy"): string {
  try {
    const d = parseISO(iso);
    if (!isValid(d)) return iso;
    return format(d, pattern, { locale: ru });
  } catch {
    return iso;
  }
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function formatMonth(ym: string): string {
  try {
    const d = parseISO(`${ym}-01`);
    return format(d, "LLLL yyyy", { locale: ru });
  } catch {
    return ym;
  }
}

export function addFrequency(iso: string, freq: "daily" | "weekly" | "monthly" | "yearly"): string {
  const d = parseISO(iso);
  if (!isValid(d)) return iso;
  switch (freq) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

export function daysUntil(iso: string): number {
  const d = parseISO(iso);
  if (!isValid(d)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = d.getTime() - today.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
