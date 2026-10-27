import type { SupabaseClient } from "./client";
import type { ExitTypeCode, ServiceCode } from "@/lib/config/services";

export type MovementBatchItem = {
  productId: string;
  quantity: number;
  lotNumber?: string | undefined;
  expiresOn?: string | undefined;
  adjustmentDirection?: "increase" | "decrease" | null | undefined;
};

export type MovementBatchInput = {
  unitId: string;
  movementType: "entry" | "exit" | "adjustment" | "loss";
  operationalAt: string;
  idempotencyKey: string;
  items: MovementBatchItem[];
  serviceCode?: ServiceCode | null | undefined;
  exitTypeCode?: ExitTypeCode | null | undefined;
  supplierId?: string | null | undefined;
  sourceReference?: string | null | undefined;
  note?: string | null | undefined;
  invoice?:
    | {
        accessKey: string | null;
        invoiceNumber: string;
        series: string;
        issueDate: string | null;
        supplierCnpj: string | null;
        invoiceTotal: string | null;
        extractedText: string;
        parsedData: Record<string, unknown>;
        newSupplier: {
          name: string;
          cnpj: string | null;
          tradeName: string | null;
          stateRegistration: string | null;
          address: string | null;
          city: string | null;
          state: string | null;
          postalCode: string | null;
          phone: string | null;
          email: string | null;
        } | null;
      }
    | undefined;
};

export async function recordMovementBatch(
  client: SupabaseClient,
  input: MovementBatchInput,
) {
  const procedure = input.invoice
    ? "record_stock_invoice_movement_batch"
    : "record_stock_movement_batch";
  const params = {
    p_unit_id: input.unitId,
    p_operational_at: input.operationalAt,
    p_idempotency_key: input.idempotencyKey,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      lot_number: item.lotNumber ?? null,
      expires_on: item.expiresOn ?? null,
      adjustment_direction: item.adjustmentDirection ?? null,
    })),
    p_supplier_id: input.supplierId ?? null,
    p_source_reference: input.sourceReference ?? null,
    p_note: input.note ?? null,
    ...(input.invoice
      ? {
          p_invoice: {
            access_key: input.invoice.accessKey,
            invoice_number: input.invoice.invoiceNumber,
            series: input.invoice.series,
            issue_date: input.invoice.issueDate,
            supplier_cnpj: input.invoice.supplierCnpj,
            invoice_total: input.invoice.invoiceTotal,
            extracted_text: input.invoice.extractedText,
            parsed_data: input.invoice.parsedData,
            new_supplier: input.invoice.newSupplier,
          },
        }
      : {
          p_movement_type: input.movementType,
          p_service_code: input.serviceCode ?? null,
          p_exit_type_code: input.exitTypeCode ?? null,
        }),
  };
  const { data, error } = await client.rpc(procedure, params);

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
    if (
      error.code === "23505" ||
      error.message.toLowerCase().includes("already been recorded")
    ) {
      throw new Error("Esta nota fiscal já foi registrada no estoque.");
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
