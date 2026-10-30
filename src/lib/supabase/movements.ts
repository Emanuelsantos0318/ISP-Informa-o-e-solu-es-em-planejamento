import type { SupabaseClient } from "./client";
import type { ExitTypeCode, ServiceCode } from "@/lib/config/services";

export type MovementBatchItem = {
  productId: string;
  quantity: number;
  unitsReleased?: number | undefined;
  unitsPerPackage?: number | null | undefined;
  destination?: string | null | undefined;
  recipient?: string | null | undefined;
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
  // Importação de DANFE usa RPC própria para gravar nota, fornecedor e itens juntos.
  const procedure = input.invoice
    ? "record_stock_invoice_movement_batch"
    : "record_stock_movement_batch";
  // Converte nomes do TypeScript para os campos esperados pela função PostgreSQL.
  const params = {
    p_unit_id: input.unitId,
    p_operational_at: input.operationalAt,
    p_idempotency_key: input.idempotencyKey,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      units_released: item.unitsReleased ?? null,
      units_per_package: item.unitsPerPackage ?? null,
      destination: item.destination ?? null,
      recipient: item.recipient ?? null,
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
  // A RPC aplica estoque, lotes, idempotência e auditoria em uma transação no banco.
  const { data, error } = await client.rpc(procedure, params);

  // Traduz erros conhecidos do banco em mensagens compreensíveis para a operação.
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
    if (
      message.includes("already been recorded") ||
      (message.includes("invoice") && error.code === "23505")
    ) {
      throw new Error("Esta nota fiscal já foi registrada no estoque.");
    }
    if (
      message.includes("insufficient stock") ||
      message.includes("selected lot has insufficient stock")
    ) {
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
    if (
      message.includes("valid service and exit type") ||
      message.includes("only exits may have service classification")
    ) {
      throw new Error("Selecione um período e tipo de saída válidos.");
    }
    if (message.includes("every item product must be active")) {
      throw new Error(
        "O produto selecionado está inativo ou não pertence a esta empresa. Atualize o catálogo e tente novamente.",
      );
    }
    if (message.includes("every item needs a product")) {
      throw new Error("Confira a quantidade informada para este produto.");
    }
    if (error.code === "23505") {
      throw new Error(
        "A movimentação entrou em conflito com um registro existente. Atualize os dados e tente novamente.",
      );
    }
    throw new Error(
      `Não foi possível registrar a movimentação. Revise os dados e tente novamente. Código de suporte: ${error.code || "indisponível"}.`,
    );
  }
  // Só confirma para a tela quando o banco retorna o identificador do lote gravado.
  const result = data?.[0];
  if (!result)
    throw new Error("O Supabase n\u00e3o confirmou a movimenta\u00e7\u00e3o.");
  return result;
}
