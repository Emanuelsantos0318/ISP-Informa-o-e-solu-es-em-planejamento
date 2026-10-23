import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitCode } from "@/lib/config/units";
import { UNITS } from "@/lib/config/units";
import type { Product } from "@/lib/types";

export type CategoryRecord = {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
};
export type SupplierRecord = {
  id: string;
  company_id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: "active" | "inactive";
};
export type CatalogProduct = Product & {
  companyId: string;
  categoryId: string;
  status: "active" | "inactive";
  hasStock: boolean;
  minimumStock: number;
  desiredStock: number | null;
  categoryName: string | null;
};

export async function listCategories(
  client: SupabaseClient,
  companyId: string,
) {
  const { data, error } = await client
    .from("categories")
    .select("id, company_id, name, description, status")
    .eq("company_id", companyId)
    .order("name")
    .limit(500);
  if (error) throw error;
  return data as CategoryRecord[];
}

export async function listSuppliers(client: SupabaseClient, companyId: string) {
  const { data, error } = await client
    .from("suppliers")
    .select("id, company_id, name, contact_name, email, phone, notes, status")
    .eq("company_id", companyId)
    .order("name")
    .limit(500);
  if (error) throw error;
  return data as SupplierRecord[];
}

export async function listProducts(
  client: SupabaseClient,
  companyId: string,
  unitId: string,
  includeInactive = false,
) {
  let query = client
    .from("products")
    .select(
      "id, company_id, category_id, sku, name, barcode, brand, unit_of_measure, minimum_stock, desired_stock, status, categories(name), stock_balances(quantity, unit_id)",
    )
    .eq("company_id", companyId);
  if (!includeInactive) query = query.eq("status", "active");
  const { data, error } = await query.order("name").limit(500);
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
    const balances = Array.isArray(row["stock_balances"])
      ? (row["stock_balances"] as { quantity: number; unit_id: string }[])
      : [];
    const category = row["categories"] as { name: string } | null;
    const unit = String(row["unit_of_measure"] ?? "un");
    const supportedUnit = UNITS.some((entry) => entry.code === unit)
      ? (unit as UnitCode)
      : "un";
    return {
      id: String(row["id"]),
      name: String(row["name"]),
      sku: String(row["sku"]),
      barcode: typeof row["barcode"] === "string" ? row["barcode"] : null,
      brand: typeof row["brand"] === "string" ? row["brand"] : null,
      unit: supportedUnit,
      balance: balances
        .filter((balance) => balance.unit_id === unitId)
        .reduce((total, balance) => total + Number(balance.quantity), 0),
      lotControl: false,
      expiryControl: false,
      companyId: String(row["company_id"]),
      categoryId:
        typeof row["category_id"] === "string" ? row["category_id"] : "",
      categoryName: category?.name ?? null,
      status: String(row["status"]) as "active" | "inactive",
      hasStock: balances.some((balance) => Number(balance.quantity) !== 0),
      minimumStock: Number(row["minimum_stock"]),
      desiredStock:
        row["desired_stock"] === null ? null : Number(row["desired_stock"]),
    } satisfies CatalogProduct;
  });
}

export function explainBackendError(error: {
  code?: string | undefined;
  message: string;
}) {
  if (error.code === "23505")
    return "Já existe um registro com esse código ou nome.";
  if (error.code === "42501")
    return "Seu perfil não tem permissão para essa alteração.";
  if (error.code === "23503")
    return "Uma referência selecionada não existe ou não pertence a esta empresa.";
  return "Não foi possível salvar. Verifique os dados e tente novamente.";
}
