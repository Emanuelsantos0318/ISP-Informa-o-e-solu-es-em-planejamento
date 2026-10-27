import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitCode } from "@/lib/config/units";

export type InventoryProduct = {
  id: string;
  companyId: string;
  categoryId: string | null;
  categoryName: string;
  supplierId: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  unit: UnitCode | string;
  minimum: number;
  target: number | null;
  active: boolean;
  balance: number;
};

export type MovementBatch = {
  id: string;
  unitId: string;
  type: "entry" | "exit" | "adjustment" | "loss";
  occurredAt: string;
  service: string | null;
  exitType: string | null;
  supplierId: string | null;
  sourceReference: string | null;
  note: string | null;
  userId: string;
  itemCount: number;
  items: MovementItem[];
  userName: string | null;
};

export type MovementItem = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  lotNumber: string | null;
  expiresOn: string | null;
  adjustmentDirection: "increase" | "decrease" | null;
};

export type StockLot = {
  id: string;
  productId: string;
  lotNumber: string;
  expiresOn: string | null;
  quantity: number;
};

export type InventorySnapshot = {
  products: InventoryProduct[];
  lots: StockLot[];
  movements: MovementBatch[];
};

type Raw = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function number(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function record(value: unknown): Raw {
  return value && typeof value === "object" ? (value as Raw) : {};
}

export async function loadInventorySnapshot(
  client: SupabaseClient,
  companyId: string,
  unitId: string,
  from?: string | undefined,
  to?: string | undefined,
): Promise<InventorySnapshot> {
  const productQuery = client
    .from("products")
    .select(
      "id, company_id, category_id, preferred_supplier_id, name, sku, barcode, unit_of_measure, minimum_stock, desired_stock, status, categories(name)",
    )
    .eq("company_id", companyId)
    .order("name")
    .limit(1000);
  const balanceQuery = client
    .from("stock_balances")
    .select("id, product_id, product_lot_id, quantity")
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .limit(1000);
  const lotQuery = client
    .from("product_lots")
    .select("id, product_id, lot_number, expires_on")
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .limit(1000);
  let batchQuery = client
    .from("stock_movement_batches")
    .select(
      "id, unit_id, movement_type, occurred_at, service_code, exit_type_code, supplier_id, source_reference, note, performed_by, request_payload",
    )
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .order("occurred_at", { ascending: false })
    .limit(1000);
  if (from) batchQuery = batchQuery.gte("occurred_at", from);
  if (to) batchQuery = batchQuery.lte("occurred_at", to);

  const [productResult, balanceResult, lotResult, batchResult] =
    await Promise.all([productQuery, balanceQuery, lotQuery, batchQuery]);
  for (const result of [productResult, balanceResult, lotResult, batchResult]) {
    if (result.error) throw result.error;
  }

  const productsRaw = (productResult.data ?? []) as Raw[];
  const balancesRaw = (balanceResult.data ?? []) as Raw[];
  const lotsRaw = (lotResult.data ?? []) as Raw[];
  const batchesRaw = (batchResult.data ?? []) as Raw[];

  const batchIds = batchesRaw.map((row) => text(row["id"])).filter(Boolean);
  const itemResult = batchIds.length
    ? await client
        .from("stock_movement_batch_items")
        .select("batch_id, item_index, movement_id")
        .eq("company_id", companyId)
        .eq("unit_id", unitId)
        .in("batch_id", batchIds)
        .order("item_index")
        .limit(1000)
    : { data: [], error: null };
  if (itemResult.error) throw itemResult.error;

  const itemsRaw = (itemResult.data ?? []) as Raw[];
  const movementIds = [
    ...new Set(itemsRaw.map((row) => text(row["movement_id"]))),
  ];
  const [detailsResult, profileResult] = await Promise.all([
    movementIds.length
      ? client
          .from("stock_movements")
          .select(
            "id, product_id, product_lot_id, adjustment_direction, quantity",
          )
          .in("id", movementIds)
          .limit(5000)
      : Promise.resolve({ data: [], error: null }),
    batchesRaw.length
      ? client
          .from("profiles")
          .select("user_id, full_name")
          .eq("company_id", companyId)
          .in(
            "user_id",
            batchesRaw.map((row) => text(row["performed_by"])),
          )
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (detailsResult.error) throw detailsResult.error;
  if (profileResult.error) throw profileResult.error;

  const productById = new Map(productsRaw.map((row) => [text(row["id"]), row]));
  const lotById = new Map(lotsRaw.map((row) => [text(row["id"]), row]));
  const balancesByProduct = new Map<string, number>();
  const balancesByLot = new Map<string, number>();
  for (const balance of balancesRaw) {
    const productId = text(balance["product_id"]);
    const quantity = number(balance["quantity"]);
    balancesByProduct.set(
      productId,
      (balancesByProduct.get(productId) ?? 0) + quantity,
    );
    const lotId = nullableText(balance["product_lot_id"]);
    if (lotId)
      balancesByLot.set(lotId, (balancesByLot.get(lotId) ?? 0) + quantity);
  }
  const products: InventoryProduct[] = productsRaw.map((row) => {
    const category = record(row["categories"]);
    return {
      id: text(row["id"]),
      companyId: text(row["company_id"]),
      categoryId: nullableText(row["category_id"]),
      categoryName: text(category["name"]) || "Sem categoria",
      supplierId: nullableText(row["preferred_supplier_id"]),
      name: text(row["name"]),
      sku: text(row["sku"]),
      barcode: nullableText(row["barcode"]),
      unit: text(row["unit_of_measure"]),
      minimum: number(row["minimum_stock"]),
      target:
        row["desired_stock"] == null ? null : number(row["desired_stock"]),
      active: row["status"] === "active",
      balance: balancesByProduct.get(text(row["id"])) ?? 0,
    };
  });
  const lots: StockLot[] = lotsRaw.map((row) => ({
    id: text(row["id"]),
    productId: text(row["product_id"]),
    lotNumber: text(row["lot_number"]),
    expiresOn: nullableText(row["expires_on"]),
    quantity: balancesByLot.get(text(row["id"])) ?? 0,
  }));
  const movementById = new Map<string, Raw>();
  for (const row of (detailsResult.data ?? []) as Raw[])
    movementById.set(text(row["id"]), row);
  const itemsByBatch = new Map<string, MovementItem[]>();
  for (const link of itemsRaw) {
    const movement = movementById.get(text(link["movement_id"]));
    if (!movement) continue;
    const product = productById.get(text(movement["product_id"]));
    if (!product) continue;
    const lot = lotById.get(text(movement["product_lot_id"]));
    const batchId = text(link["batch_id"]);
    const batchItems = itemsByBatch.get(batchId) ?? [];
    batchItems.push({
      id: text(movement["id"]),
      productId: text(product["id"]),
      name: text(product["name"]),
      sku: text(product["sku"]),
      unit: text(product["unit_of_measure"]),
      quantity: number(movement["quantity"]),
      lotNumber: lot ? text(lot["lot_number"]) : null,
      expiresOn: lot ? nullableText(lot["expires_on"]) : null,
      adjustmentDirection:
        movement["adjustment_direction"] === "increase" ||
        movement["adjustment_direction"] === "decrease"
          ? movement["adjustment_direction"]
          : null,
    });
    itemsByBatch.set(batchId, batchItems);
  }
  const userNames = new Map(
    ((profileResult.data ?? []) as Raw[]).map((row) => [
      text(row["user_id"]),
      text(row["full_name"]),
    ]),
  );
  const movementCountByBatch = new Map<string, number>();
  for (const link of itemsRaw) {
    const id = text(link["batch_id"]);
    movementCountByBatch.set(id, (movementCountByBatch.get(id) ?? 0) + 1);
  }
  const movements: MovementBatch[] = batchesRaw.map((row) => {
    const id = text(row["id"]);
    const userId = text(row["performed_by"]);
    const request = record(row["request_payload"]);
    const requestedItems = Array.isArray(request["items"])
      ? request["items"].length
      : (movementCountByBatch.get(id) ?? 0);
    return {
      id,
      unitId: text(row["unit_id"]),
      type: text(row["movement_type"]) as MovementBatch["type"],
      occurredAt: text(row["occurred_at"]),
      service: nullableText(row["service_code"]),
      exitType: nullableText(row["exit_type_code"]),
      supplierId: nullableText(row["supplier_id"]),
      sourceReference: nullableText(row["source_reference"]),
      note: nullableText(row["note"]),
      userId,
      itemCount: requestedItems,
      items: itemsByBatch.get(id) ?? [],
      userName: userNames.get(userId) ?? null,
    };
  });
  return { products, lots, movements };
}
