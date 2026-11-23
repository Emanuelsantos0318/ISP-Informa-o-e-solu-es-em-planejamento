import type { SupabaseClient } from "./client";

export type StockExitPlanItem = {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_of_measure_snapshot: string;
  planned_quantity: number;
};

export type StockExitPlan = {
  id: string;
  company_id: string;
  unit_id: string;
  name: string;
  recipient: string;
  notes: string | null;
  frequency: "daily";
  status: "active" | "inactive";
  items: StockExitPlanItem[];
};

type PlanRow = Omit<StockExitPlan, "items">;

export async function listStockExitPlans(
  client: SupabaseClient,
  companyId: string,
  unitId: string,
  includeInactive = false,
): Promise<StockExitPlan[]> {
  let plansQuery = client
    .from("stock_exit_plans")
    .select(
      "id, company_id, unit_id, name, recipient, notes, frequency, status",
    )
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .order("name");
  if (!includeInactive) plansQuery = plansQuery.eq("status", "active");
  const { data: plans, error: plansError } = await plansQuery;
  if (plansError) throw plansError;
  const rows = (plans ?? []) as PlanRow[];
  if (rows.length === 0) return [];

  const { data: items, error: itemsError } = await client
    .from("stock_exit_plan_items")
    .select(
      "id, plan_id, product_id, product_name_snapshot, unit_of_measure_snapshot, planned_quantity",
    )
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .in(
      "plan_id",
      rows.map((plan) => plan.id),
    )
    .order("product_name_snapshot");
  if (itemsError) throw itemsError;
  const byPlan = new Map<string, StockExitPlanItem[]>();
  for (const value of items ?? []) {
    const item = value as StockExitPlanItem & { plan_id: string };
    const list = byPlan.get(item.plan_id) ?? [];
    list.push(item);
    byPlan.set(item.plan_id, list);
  }
  return rows.map((plan) => ({ ...plan, items: byPlan.get(plan.id) ?? [] }));
}

export async function saveStockExitPlan(
  client: SupabaseClient,
  input: {
    unitId: string;
    id: string | null;
    name: string;
    recipient: string;
    notes: string;
    status: "active" | "inactive";
    items: Array<{ productId: string; quantity: number }>;
  },
) {
  const { data, error } = await client.rpc("save_stock_exit_plan", {
    p_unit_id: input.unitId,
    p_plan_id: input.id,
    p_name: input.name,
    p_recipient: input.recipient,
    p_notes: input.notes || null,
    p_status: input.status,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
  });
  if (error) throw error;
  if (typeof data !== "string")
    throw new Error("O banco não confirmou o planejamento de saída.");
  return data;
}
