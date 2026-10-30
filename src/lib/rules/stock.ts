/**
 * Centralized stock and expiry rules, shared by dashboard, planning and alerts.
 * Defaults apply until a company saves its own settings in Supabase.
 */

export type StockSettings = {
  /** Balance at or below min × ratio is "crítico". */
  criticalRatio: number;
  /** Days before expiry to flag "próximo do vencimento". */
  expiryWarningDays: number;
  /** Minimum days of history before estimating consumption. */
  minHistoryDays: number;
};

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  criticalRatio: 0.5,
  expiryWarningDays: 30,
  minHistoryDays: 7,
};

export type StockStatus =
  "sem_saldo" | "critico" | "baixo" | "adequado" | "acima";

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  sem_saldo: "Sem saldo",
  critico: "Estoque crítico",
  baixo: "Estoque baixo",
  adequado: "Estoque adequado",
  acima: "Acima do máximo",
};

export function classifyStock(
  input: { balance: number; min: number; max?: number | null },
  settings: StockSettings = DEFAULT_STOCK_SETTINGS,
): StockStatus {
  // A ordem importa: saldo zero e crítico têm prioridade sobre as faixas seguintes.
  const { balance, min, max } = input;
  if (balance <= 0) return "sem_saldo";
  if (min > 0 && balance <= min * settings.criticalRatio) return "critico";
  if (balance < min) return "baixo";
  if (max != null && balance > max) return "acima";
  return "adequado";
}

/**
 * Suggested quantity = max(0, target − balance).
 * Target is the explicit target when set, otherwise the max stock.
 * Returns null when no target exists (cannot suggest).
 */
export function suggestReorder(input: {
  balance: number;
  max?: number | null;
  target?: number | null;
}): number | null {
  // Usa a meta explícita; na ausência dela, usa o estoque máximo como referência.
  const target = input.target ?? input.max ?? null;
  if (target == null) return null;
  return Math.max(0, target - input.balance);
}

/** Average daily consumption, or null when history is insufficient. */
export function averageDailyConsumption(
  totalOut: number,
  historyDays: number,
  settings: StockSettings = DEFAULT_STOCK_SETTINGS,
): number | null {
  if (historyDays < settings.minHistoryDays || totalOut <= 0) return null;
  return totalOut / historyDays;
}

/** Days of coverage for the current balance, or null when not estimable. */
export function coverageDays(
  balance: number,
  avgDaily: number | null,
): number | null {
  if (avgDaily == null || avgDaily <= 0) return null;
  return Math.max(0, balance) / avgDaily;
}

export type ExpiryStatus = "vencido" | "proximo" | "valido";

/** Dates as YYYY-MM-DD (local operational dates). */
export function classifyExpiry(
  expiryDate: string,
  today: string,
  settings: StockSettings = DEFAULT_STOCK_SETTINGS,
): ExpiryStatus {
  // Datas são comparadas como dias de calendário UTC para evitar variação de fuso local.
  const diffDays = Math.round(
    (Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  if (diffDays < 0) return "vencido";
  if (diffDays <= settings.expiryWarningDays) return "proximo";
  return "valido";
}
