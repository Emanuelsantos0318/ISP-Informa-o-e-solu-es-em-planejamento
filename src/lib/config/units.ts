/** Units of measure. Balances are never summed across different units. */
export const UNITS = [
  { code: "un", label: "Unidade", short: "un", decimals: 0 },
  { code: "pct", label: "Pacote", short: "pct", decimals: 0 },
  { code: "cx", label: "Caixa", short: "cx", decimals: 0 },
  { code: "ct", label: "Cento", short: "ct", decimals: 0 },
  { code: "mi", label: "Milheiro", short: "mi", decimals: 0 },
  { code: "m", label: "Metro", short: "m", decimals: 3 },
  { code: "kg", label: "Quilograma", short: "kg", decimals: 3 },
  { code: "l", label: "Litro", short: "L", decimals: 3 },
] as const;

export type UnitCode = (typeof UNITS)[number]["code"];

export function unitShort(code: string | null | undefined): string {
  return UNITS.find((u) => u.code === code)?.short ?? "";
}
