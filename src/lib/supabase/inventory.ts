import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitCode } from "@/lib/config/units";
import { readAllInChunks, readAllPages } from "./pagination";

export type InventoryProduct = {
  id: string;
  companyId: string;
  categoryId: string | null;
  categoryName: string;
  supplierId: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  brand: string | null;
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
  legacy?: boolean | undefined;
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
  unitsReleased: number | null;
  unitsPerPackage: number | null;
  destination: string | null;
  recipient: string | null;
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

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
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
  // Cada conjunto usa ordenação estável e é paginado para evitar truncamento em 1.000 linhas.
  const productQuery = client
    .from("products")
    .select(
      "id, company_id, category_id, preferred_supplier_id, name, sku, barcode, brand, unit_of_measure, minimum_stock, desired_stock, status, categories(name)",
    )
    .eq("company_id", companyId)
    .order("name")
    .order("id");
  const balanceQuery = client
    .from("stock_balances")
    .select("id, product_id, product_lot_id, quantity")
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .order("id");
  const lotQuery = client
    .from("product_lots")
    .select("id, product_id, lot_number, expires_on")
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .order("id");
  let batchQuery = client
    .from("stock_movement_batches")
    .select(
      "id, unit_id, movement_type, occurred_at, service_code, exit_type_code, supplier_id, source_reference, note, performed_by, request_payload",
    )
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false });
  if (from) batchQuery = batchQuery.gte("occurred_at", from);
  if (to) batchQuery = batchQuery.lte("occurred_at", to);

  let legacyQuery = client
    .from("legacy_stock_withdrawals")
    .select(
      "id, source_withdrawal_id, source_product_id, product_id, occurred_at, source_payload",
    )
    .eq("company_id", companyId)
    .eq("unit_id", unitId)
    .eq("source_app", "almox-hgrs")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false });
  if (from) legacyQuery = legacyQuery.gte("occurred_at", from);
  if (to) legacyQuery = legacyQuery.lte("occurred_at", to);

  // As consultas independentes rodam juntas para compor uma fotografia consistente da tela.
  const [productsRaw, balancesRaw, lotsRaw, batchesRaw, legacyRaw] =
    await Promise.all([
      readAllPages(productQuery),
      readAllPages(balanceQuery),
      readAllPages(lotQuery),
      readAllPages(batchQuery),
      readAllPages(legacyQuery),
    ]);
  // A partir daqui os registros brutos são normalizados para os modelos usados pela UI.
  const productsRows = productsRaw as Raw[];
  const balancesRows = balancesRaw as Raw[];
  const lotsRows = lotsRaw as Raw[];
  const batchesRows = batchesRaw as Raw[];

  // O lote agrupa movimentos; os vínculos seguintes recuperam produto e usuário de cada item.
  const batchIds = batchesRows.map((row) => text(row["id"])).filter(Boolean);
  const itemsRaw = batchIds.length
    ? ((await readAllInChunks(batchIds, (ids) =>
        client
          .from("stock_movement_batch_items")
          .select("batch_id, item_index, movement_id")
          .eq("company_id", companyId)
          .eq("unit_id", unitId)
          .in("batch_id", ids)
          .order("batch_id")
          .order("item_index"),
      )) as Raw[])
    : [];
  const movementIds = [
    ...new Set(itemsRaw.map((row) => text(row["movement_id"]))),
  ];
  const profileIds = [
    ...new Set(
      batchesRows
        .map((row) => text(row["performed_by"]).trim())
        .filter(Boolean),
    ),
  ];
  const [detailsRaw, profilesRaw] = await Promise.all([
    movementIds.length
      ? readAllInChunks(movementIds, (ids) =>
          client
            .from("stock_movements")
            .select(
              "id, product_id, product_lot_id, adjustment_direction, quantity",
            )
            .in("id", ids)
            .order("id"),
        )
      : Promise.resolve([]),
    profileIds.length
      ? readAllInChunks(profileIds, (ids) =>
          client
            .from("profiles")
            .select("user_id, full_name")
            .eq("company_id", companyId)
            .in("user_id", ids)
            .order("user_id"),
        )
      : Promise.resolve([]),
  ]);

  const productById = new Map(
    productsRows.map((row) => [text(row["id"]), row]),
  );
  const lotById = new Map(lotsRows.map((row) => [text(row["id"]), row]));
  // Soma os saldos por produto e por lote antes de montar os objetos finais.
  const balancesByProduct = new Map<string, number>();
  const balancesByLot = new Map<string, number>();
  for (const balance of balancesRows) {
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
  const products: InventoryProduct[] = productsRows.map((row) => {
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
      brand: nullableText(row["brand"]),
      unit: text(row["unit_of_measure"]),
      minimum: number(row["minimum_stock"]),
      target:
        row["desired_stock"] == null ? null : number(row["desired_stock"]),
      active: row["status"] === "active",
      balance: balancesByProduct.get(text(row["id"])) ?? 0,
    };
  });
  const lots: StockLot[] = lotsRows.map((row) => ({
    id: text(row["id"]),
    productId: text(row["product_id"]),
    lotNumber: text(row["lot_number"]),
    expiresOn: nullableText(row["expires_on"]),
    quantity: balancesByLot.get(text(row["id"])) ?? 0,
  }));
  const movementById = new Map<string, Raw>();
  for (const row of detailsRaw as Raw[]) movementById.set(text(row["id"]), row);
  const itemsByBatch = new Map<string, MovementItem[]>();
  const batchById = new Map(batchesRows.map((row) => [text(row["id"]), row]));
  for (const link of itemsRaw) {
    const movement = movementById.get(text(link["movement_id"]));
    if (!movement) continue;
    const product = productById.get(text(movement["product_id"]));
    if (!product) continue;
    const lot = lotById.get(text(movement["product_lot_id"]));
    const batchId = text(link["batch_id"]);
    const batch = batchById.get(batchId);
    const payload = record(batch?.["request_payload"]);
    const requestedItems = Array.isArray(payload["items"])
      ? payload["items"]
      : [];
    const itemIndex = Math.max(0, number(link["item_index"]) - 1);
    const requestItem = record(requestedItems[itemIndex]);
    const batchItems = itemsByBatch.get(batchId) ?? [];
    batchItems.push({
      id: text(movement["id"]),
      productId: text(product["id"]),
      name: text(product["name"]),
      sku: text(product["sku"]),
      unit:
        text(requestItem["unit"]) ||
        text(requestItem["unit_of_measure"]) ||
        text(product["unit_of_measure"]),
      quantity: number(movement["quantity"]),
      lotNumber: lot ? text(lot["lot_number"]) : null,
      expiresOn: lot ? nullableText(lot["expires_on"]) : null,
      adjustmentDirection:
        movement["adjustment_direction"] === "increase" ||
        movement["adjustment_direction"] === "decrease"
          ? movement["adjustment_direction"]
          : null,
      unitsReleased: nullableNumber(requestItem["units_released"]),
      unitsPerPackage: nullableNumber(requestItem["units_per_package"]),
      destination: nullableText(requestItem["destination"]),
      recipient: nullableText(requestItem["recipient"]),
    });
    itemsByBatch.set(batchId, batchItems);
  }
  const userNames = new Map(
    (profilesRaw as Raw[]).map((row) => [
      text(row["user_id"]),
      text(row["full_name"]),
    ]),
  );
  const movementCountByBatch = new Map<string, number>();
  for (const link of itemsRaw) {
    const id = text(link["batch_id"]);
    movementCountByBatch.set(id, (movementCountByBatch.get(id) ?? 0) + 1);
  }
  const movements: MovementBatch[] = batchesRows.map((row) => {
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
      legacy: false,
    };
  });
  // Mantém as saídas do backup antigo consultáveis sem misturá-las aos lotes novos.
  const legacyMovements: MovementBatch[] = (legacyRaw as Raw[])
    .map((row): MovementBatch | null => {
      const payload = record(row["source_payload"]);
      const occurredAt = nullableText(row["occurred_at"]);
      const sourceId = text(row["source_withdrawal_id"]);
      if (!occurredAt) return null;
      const sourceProductId = nullableText(row["source_product_id"]);
      const productId = nullableText(row["product_id"]);
      const item: MovementItem = {
        id: text(row["id"]),
        productId: productId ?? sourceProductId ?? "",
        name: text(payload["productName"]) || "Produto sem descrição no backup",
        sku: text(payload["barcode"]),
        unit: text(payload["unit"]),
        quantity: number(payload["quantity"]),
        lotNumber: null,
        expiresOn: null,
        adjustmentDirection: null,
        unitsReleased: null,
        unitsPerPackage: null,
        destination: null,
        recipient: null,
      };
      return {
        id: `legacy:${sourceId}`,
        unitId,
        type: "exit" as const,
        occurredAt,
        service: nullableText(payload["period"]),
        exitType: nullableText(payload["exitType"]),
        supplierId: null,
        sourceReference: sourceId,
        note: nullableText(payload["operatorRole"]),
        userId: text(payload["withdrawnBy"]),
        itemCount: 1,
        items: [item],
        userName: nullableText(payload["operatorName"]),
        legacy: true,
      };
    })
    .filter((row): row is MovementBatch => row !== null);
  return { products, lots, movements: [...legacyMovements, ...movements] };
}
