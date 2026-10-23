/**
 * Central configuration for stock-exit classification.
 * Codes are stored in the database; labels are display-only.
 * Prepared to be replaced by a settings table editable by authorized users.
 */

export const SERVICE_OPTIONS = [
  { code: "desjejum", label: "Desjejum" },
  { code: "colacao", label: "Colação" },
  { code: "almoco", label: "Almoço" },
  { code: "lanche", label: "Lanche" },
  { code: "ceia_completa", label: "Ceia completa" },
  { code: "ceia_leve", label: "Ceia leve" },
] as const;

export type ServiceCode = (typeof SERVICE_OPTIONS)[number]["code"];

export const EXIT_TYPES = [
  { code: "programada_padrao", label: "Programada padrão" },
  { code: "extra", label: "Extra" },
] as const;

export type ExitTypeCode = (typeof EXIT_TYPES)[number]["code"];

export type TimeRule =
  | {
      id: string;
      start: string;
      end: string;
      label: string;
      kind: "single";
      service: ServiceCode;
    }
  | {
      id: string;
      start: string;
      end: string;
      label: string;
      kind: "choice";
      services: ServiceCode[];
    }
  | {
      id: string;
      start: string;
      end: string;
      label: string;
      kind: "pending";
      note: string;
    };

/** Initial ranges (America/Bahia). Inclusive on both ends. */
export const SERVICE_TIME_RULES: TimeRule[] = [
  {
    id: "desjejum",
    start: "03:00",
    end: "05:00",
    label: "Desjejum",
    kind: "single",
    service: "desjejum",
  },
  {
    id: "almoco",
    start: "05:10",
    end: "13:30",
    label: "Almoço",
    kind: "single",
    service: "almoco",
  },
  {
    id: "jantar",
    start: "13:50",
    end: "18:00",
    label: "Jantar",
    kind: "pending",
    note: "Mapeamento operacional pendente. Selecione manualmente um dos serviços válidos.",
  },
  {
    id: "ceia",
    start: "18:20",
    end: "21:00",
    label: "Ceia",
    kind: "choice",
    services: ["ceia_completa", "ceia_leve"],
  },
];

export function serviceLabel(code: ServiceCode | null | undefined): string {
  return SERVICE_OPTIONS.find((s) => s.code === code)?.label ?? "—";
}

export function exitTypeLabel(code: ExitTypeCode | null | undefined): string {
  return EXIT_TYPES.find((t) => t.code === code)?.label ?? "—";
}
