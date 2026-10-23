export const OPERATIONAL_TZ = "America/Bahia";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OPERATIONAL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Current date (YYYY-MM-DD) and time (HH:MM) in America/Bahia. */
export function nowInOperationalTz(now: Date = new Date()): {
  date: string;
  time: string;
} {
  const p = Object.fromEntries(
    partsFormatter.formatToParts(now).map((x) => [x.type, x.value]),
  );
  return {
    date: `${p["year"]}-${p["month"]}-${p["day"]}`,
    time: `${p["hour"]}:${p["minute"]}`,
  };
}

/** Converts an America/Bahia wall-clock value into a UTC ISO instant. */
export function operationalDateTimeToIso(
  date: string,
  time: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (
    !year ||
    !month ||
    !day ||
    hour === undefined ||
    minute === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    return null;
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(target);
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  )
    return null;

  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      partsFormatter
        .formatToParts(new Date(guess))
        .map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts["year"]),
      Number(parts["month"]) - 1,
      Number(parts["day"]),
      Number(parts["hour"]),
      Number(parts["minute"]),
    );
    const delta = target - represented;
    if (delta === 0) return new Date(guess).toISOString();
    guess += delta;
  }
  return null;
}

export function formatDateLong(now: Date = new Date()): string {
  const text = new Intl.DateTimeFormat("pt-BR", {
    timeZone: OPERATIONAL_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDateTime(value: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: OPERATIONAL_TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(typeof value === "string" ? new Date(value) : value);
}

/** Formats a YYYY-MM-DD date as dd/mm/aaaa. */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export type PeriodPreset = "hoje" | "7d" | "30d" | "mes" | "personalizado";

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "mes", label: "Mês atual" },
  { value: "personalizado", label: "Personalizado" },
];

function shiftIsoDate(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Inclusive date range (YYYY-MM-DD, America/Bahia) for a preset. */
export function getPeriodRange(
  preset: PeriodPreset,
  now: Date = new Date(),
  custom?: { from: string; to: string },
): { from: string; to: string } | null {
  const today = nowInOperationalTz(now).date;
  switch (preset) {
    case "hoje":
      return { from: today, to: today };
    case "7d":
      return { from: shiftIsoDate(today, -6), to: today };
    case "30d":
      return { from: shiftIsoDate(today, -29), to: today };
    case "mes":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "personalizado":
      if (!custom?.from || !custom?.to || custom.from > custom.to) return null;
      return custom;
  }
}
