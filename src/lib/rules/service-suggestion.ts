import {
  SERVICE_OPTIONS,
  SERVICE_TIME_RULES,
  type ServiceCode,
  type TimeRule,
} from "@/lib/config/services";

export type ServiceSuggestion =
  | { kind: "single"; service: ServiceCode; rule: TimeRule }
  | { kind: "choice"; services: ServiceCode[]; rule: TimeRule }
  | { kind: "pending"; rule: TimeRule }
  | { kind: "none" };

export type ServiceSelection = {
  value: ServiceCode | null;
  /** true once the user picked a service themselves */
  manual: boolean;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function toMinutes(time: string): number | null {
  const m = TIME_RE.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Returns the suggestion for a HH:MM time (America/Bahia local time). */
export function suggestServiceForTime(
  time: string,
  rules: TimeRule[] = SERVICE_TIME_RULES,
): ServiceSuggestion {
  const minutes = toMinutes(time);
  if (minutes === null) return { kind: "none" };
  const rule = rules.find((r) => {
    const start = toMinutes(r.start);
    const end = toMinutes(r.end);
    return start !== null && end !== null && minutes >= start && minutes <= end;
  });
  if (!rule) return { kind: "none" };
  if (rule.kind === "single")
    return { kind: "single", service: rule.service, rule };
  if (rule.kind === "choice")
    return { kind: "choice", services: rule.services, rule };
  return { kind: "pending", rule };
}

/**
 * Applies a (new) suggestion to the current selection.
 * - Without a manual choice, the suggestion is applied (only when it is a single service).
 * - A manual choice is never overwritten; a differing suggestion is returned as alternatives.
 */
export function applySuggestion(
  selection: ServiceSelection,
  suggestion: ServiceSuggestion,
): { selection: ServiceSelection; alternatives: ServiceCode[] } {
  if (!selection.manual) {
    return {
      selection: {
        value: suggestion.kind === "single" ? suggestion.service : null,
        manual: false,
      },
      alternatives: [],
    };
  }
  let alternatives: ServiceCode[] = [];
  if (suggestion.kind === "single" && suggestion.service !== selection.value) {
    alternatives = [suggestion.service];
  } else if (
    suggestion.kind === "choice" &&
    (selection.value === null || !suggestion.services.includes(selection.value))
  ) {
    alternatives = suggestion.services;
  }
  return { selection, alternatives };
}

export function selectServiceManually(service: ServiceCode): ServiceSelection {
  return { value: service, manual: true };
}

export function validateServiceSelection(
  value: string | null | undefined,
): string | null {
  if (!value) return "Selecione o serviço de destino.";
  if (!SERVICE_OPTIONS.some((s) => s.code === value))
    return "Serviço de destino inválido.";
  return null;
}
