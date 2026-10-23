import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXIT_TYPES,
  SERVICE_OPTIONS,
  SERVICE_TIME_RULES,
  type TimeRule,
  type ServiceCode,
} from "@/lib/config/services";

export type OperationalSettings = {
  serviceLabels: Record<string, string>;
  exitTypeLabels: Record<string, string>;
  serviceTimeRules: TimeRule[];
};

export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  serviceLabels: Object.fromEntries(
    SERVICE_OPTIONS.map((item) => [item.code, item.label]),
  ),
  exitTypeLabels: Object.fromEntries(
    EXIT_TYPES.map((item) => [item.code, item.label]),
  ),
  serviceTimeRules: SERVICE_TIME_RULES,
};

function labelsOrDefaults(value: unknown, defaults: Record<string, string>) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return defaults;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(defaults).map(([code, label]) => {
      const candidate = record[code];
      return [
        code,
        typeof candidate === "string" && candidate.trim()
          ? candidate.trim()
          : label,
      ];
    }),
  );
}

function validRules(value: unknown): TimeRule[] {
  if (!Array.isArray(value) || value.length !== SERVICE_TIME_RULES.length)
    return SERVICE_TIME_RULES;
  const validCodes = new Set<string>(SERVICE_OPTIONS.map((item) => item.code));
  const rules: TimeRule[] = [];
  for (let index = 0; index < SERVICE_TIME_RULES.length; index += 1) {
    const base = SERVICE_TIME_RULES[index];
    const raw = value[index];
    if (!base || !raw || typeof raw !== "object") return SERVICE_TIME_RULES;
    const item = raw as Record<string, unknown>;
    const start = item["start"];
    const end = item["end"];
    const label = item["label"];
    if (
      item["id"] !== base.id ||
      typeof start !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      typeof end !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
      typeof label !== "string" ||
      !label.trim()
    )
      return SERVICE_TIME_RULES;
    if (base.kind !== "pending" && item["kind"] !== base.kind)
      return SERVICE_TIME_RULES;
    if (item["kind"] === "single") {
      const service = item["service"];
      if (typeof service !== "string" || !validCodes.has(service))
        return SERVICE_TIME_RULES;
      rules.push({
        id: base.id,
        start,
        end,
        label: label.trim(),
        kind: "single",
        service: service as ServiceCode,
      });
    } else if (item["kind"] === "choice") {
      const services = item["services"];
      if (
        !Array.isArray(services) ||
        services.length !== 2 ||
        services.some(
          (code) => typeof code !== "string" || !validCodes.has(code),
        ) ||
        services[0] === services[1]
      )
        return SERVICE_TIME_RULES;
      rules.push({
        id: base.id,
        start,
        end,
        label: label.trim(),
        kind: "choice",
        services: services as ServiceCode[],
      });
    } else if (item["kind"] === "pending" && base.kind === "pending") {
      rules.push({ ...base, start, end, label: label.trim() });
    } else return SERVICE_TIME_RULES;
  }
  const minutes = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  for (let i = 0; i < rules.length; i += 1) {
    const a = rules[i];
    if (!a || minutes(a.start) > minutes(a.end)) return SERVICE_TIME_RULES;
    for (let j = i + 1; j < rules.length; j += 1) {
      const b = rules[j];
      if (
        b &&
        minutes(a.start) <= minutes(b.end) &&
        minutes(b.start) <= minutes(a.end)
      )
        return SERVICE_TIME_RULES;
    }
  }
  return rules;
}

export function normalizeOperationalSettings(
  row: Record<string, unknown> | null,
): OperationalSettings {
  if (!row) return DEFAULT_OPERATIONAL_SETTINGS;
  return {
    serviceLabels: labelsOrDefaults(
      row["service_labels"],
      DEFAULT_OPERATIONAL_SETTINGS.serviceLabels,
    ),
    exitTypeLabels: labelsOrDefaults(
      row["exit_type_labels"],
      DEFAULT_OPERATIONAL_SETTINGS.exitTypeLabels,
    ),
    serviceTimeRules: validRules(row["service_time_rules"]),
  };
}

export async function loadOperationalSettings(
  client: SupabaseClient,
  companyId: string,
) {
  const { data, error } = await client
    .from("company_operational_settings")
    .select("service_labels, exit_type_labels, service_time_rules")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return normalizeOperationalSettings(data as Record<string, unknown> | null);
}

export async function saveOperationalSettings(
  client: SupabaseClient,
  companyId: string,
  userId: string,
  settings: OperationalSettings,
) {
  const { error } = await client.from("company_operational_settings").upsert(
    {
      company_id: companyId,
      service_labels: settings.serviceLabels,
      exit_type_labels: settings.exitTypeLabels,
      service_time_rules: settings.serviceTimeRules,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" },
  );
  if (error) throw error;
}
