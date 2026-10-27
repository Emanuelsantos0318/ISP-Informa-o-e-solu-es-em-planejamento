import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { useOperationalScope } from "./OperationalScopeProvider";

export type StockInvoiceRecord = {
  id: string;
  batch_id: string;
  supplier_id: string;
  access_key: string | null;
  invoice_number: string;
  series: string;
  issue_date: string | null;
  supplier_cnpj: string | null;
  invoice_total: number | null;
  created_at: string;
};

export function useInvoiceHistory() {
  const { client } = useAuth();
  const { unitId } = useOperationalScope();
  return useQuery({
    queryKey: ["stock-invoices", unitId],
    enabled: Boolean(client && unitId),
    queryFn: async (): Promise<StockInvoiceRecord[]> => {
      if (!client || !unitId) return [];
      const { data, error } = await client
        .from("stock_invoice_documents")
        .select(
          "id, batch_id, supplier_id, access_key, invoice_number, series, issue_date, supplier_cnpj, invoice_total, created_at",
        )
        .eq("unit_id", unitId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as StockInvoiceRecord[];
    },
  });
}

export function useInvoiceText(invoiceId: string | null) {
  const { client } = useAuth();
  return useQuery({
    queryKey: ["stock-invoice-text", invoiceId],
    enabled: Boolean(client && invoiceId),
    queryFn: async () => {
      if (!client || !invoiceId) return "";
      const { data, error } = await client
        .from("stock_invoice_documents")
        .select("extracted_text")
        .eq("id", invoiceId)
        .single();
      if (error) throw error;
      return String(data.extracted_text ?? "");
    },
  });
}
