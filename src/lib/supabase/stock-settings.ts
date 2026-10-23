import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockSettings } from "@/lib/rules/stock";

export type CompanyStockSettings = StockSettings & {
  companyId: string;
  updatedAt: string;
  updatedBy: string | null;
};

export async function loadCompanyStockSettings(
  client: SupabaseClient,
  companyId: string,
): Promise<CompanyStockSettings | null> {
  const { data, error } = await client
    .from("company_stock_settings")
    .select(
      "company_id, critical_stock_ratio, expiry_warning_days, min_history_days, updated_at, updated_by",
    )
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    companyId: String(data["company_id"]),
    criticalRatio: Number(data["critical_stock_ratio"]),
    expiryWarningDays: Number(data["expiry_warning_days"]),
    minHistoryDays: Number(data["min_history_days"]),
    updatedAt: String(data["updated_at"]),
    updatedBy:
      typeof data["updated_by"] === "string" ? data["updated_by"] : null,
  };
}

export async function saveCompanyStockSettings(
  client: SupabaseClient,
  settings: StockSettings & { companyId: string; userId: string },
) {
  const { error } = await client.from("company_stock_settings").upsert(
    {
      company_id: settings.companyId,
      critical_stock_ratio: settings.criticalRatio,
      expiry_warning_days: settings.expiryWarningDays,
      min_history_days: settings.minHistoryDays,
      updated_at: new Date().toISOString(),
      updated_by: settings.userId,
    },
    { onConflict: "company_id" },
  );
  if (error) throw error;
}
