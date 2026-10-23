import type { SupabaseClient } from "./client";
import type { ExitTypeCode, ServiceCode } from "@/lib/config/services";

export type MovementBatchItem = {
  productId: string;
  quantity: number;
  lotNumber?: string | undefined;
  expiresOn?: string | undefined;
};

export type MovementBatchInput = {
  unitId: string;
  movementType: "entry" | "exit";
  operationalAt: string;
  idempotencyKey: string;
  items: MovementBatchItem[];
  serviceCode?: ServiceCode | null | undefined;
  exitTypeCode?: ExitTypeCode | null | undefined;
  supplierId?: string | null | undefined;
  sourceReference?: string | null | undefined;
  note?: string | null | undefined;
};

export async function recordMovementBatch(
  client: SupabaseClient,
  input: MovementBatchInput,
) {
  const { data, error } = await client.rpc("record_stock_movement_batch", {
    p_unit_id: input.unitId,
    p_movement_type: input.movementType,
    p_operational_at: input.operationalAt,
    p_idempotency_key: input.idempotencyKey,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      lot_number: item.lotNumber ?? null,
      expires_on: item.expiresOn ?? null,
    })),
    p_service_code: input.serviceCode ?? null,
    p_exit_type_code: input.exitTypeCode ?? null,
    p_supplier_id: input.supplierId ?? null,
    p_source_reference: input.sourceReference ?? null,
    p_note: input.note ?? null,
  });

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "A migra\u00e7\u00e3o de movimenta\u00e7\u00e3o em lote ainda n\u00e3o foi aplicada no Supabase.",
      );
    }
    if (error.code === "42501") {
      throw new Error(
        "Seu perfil n\u00e3o pode registrar movimentos nesta unidade.",
      );
    }
    const message = error.message.toLowerCase();
    if (message.includes("insufficient stock")) {
      throw new Error(
        "Um ou mais itens n\u00e3o t\u00eam saldo suficiente para a sa\u00edda.",
      );
    }
    if (message.includes("stock location")) {
      throw new Error(
        "Configure um local de estoque principal ativo para esta unidade.",
      );
    }
    if (message.includes("different expiry date")) {
      throw new Error(
        "O lote informado j\u00e1 existe com outra data de validade.",
      );
    }
    throw new Error(
      "N\u00e3o foi poss\u00edvel registrar a movimenta\u00e7\u00e3o. Revise os dados e tente novamente.",
    );
  }
  const result = data?.[0];
  if (!result)
    throw new Error("O Supabase n\u00e3o confirmou a movimenta\u00e7\u00e3o.");
  return result;
}
