const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dateYearFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function formatDate(ms: number, withYear = false): string {
  return (withYear ? dateYearFmt : dateFmt).format(ms);
}

export function formatTime(ms: number): string {
  return timeFmt.format(ms);
}

export function formatDateTime(ms: number): string {
  return `${weekdayFmt.format(ms)}, ${timeFmt.format(ms)}`;
}

export function formatRange(start: number, end: number): string {
  return `${dateFmt.format(start)} – ${dateFmt.format(end)}`;
}

export function formatDuration(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 7 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return formatDate(ms, Math.abs(new Date(ms).getFullYear() - new Date(now).getFullYear()) > 0);
}

export function memberSince(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(ms);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** Combine a yyyy-mm-dd date and hh:mm time in the user's local zone into epoch ms. */
export function combineDateTime(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0).getTime();
}

export function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount);
}
