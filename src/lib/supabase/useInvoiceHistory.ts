import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { useOperationalScope } from "./OperationalScopeProvider";
import { operationalDateTimeToIso } from "@/lib/datetime";
import { readAllPages } from "./pagination";

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

export function useInvoiceHistory(period?: { from: string; to: string }) {
  const { client } = useAuth();
  const { unitId } = useOperationalScope();
  return useQuery({
    queryKey: ["stock-invoices", unitId, period?.from, period?.to],
    enabled: Boolean(client && unitId),
    queryFn: async (): Promise<StockInvoiceRecord[]> => {
      if (!client || !unitId) return [];
      const baseQuery = () =>
        client
          .from("stock_invoice_documents")
          .select(
            "id, batch_id, supplier_id, access_key, invoice_number, series, issue_date, supplier_cnpj, invoice_total, created_at",
          )
          .eq("unit_id", unitId);
      if (period?.from && period.to && period.from <= period.to) {
        const createdFrom = operationalDateTimeToIso(period.from, "00:00");
        const dayAfter = new Date(`${period.to}T00:00:00Z`);
        dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
        const createdTo = operationalDateTimeToIso(
          dayAfter.toISOString().slice(0, 10),
          "00:00",
        );
        if (!createdFrom || !createdTo) return [];
        const [dated, undated] = await Promise.all([
          readAllPages(
            baseQuery()
              .gte("issue_date", period.from)
              .lte("issue_date", period.to)
              .order("created_at", { ascending: false })
              .order("id"),
          ),
          readAllPages(
            baseQuery()
              .is("issue_date", null)
              .gte("created_at", createdFrom)
              .lt("created_at", createdTo)
              .order("created_at", { ascending: false })
              .order("id"),
          ),
        ]);
        return [...dated, ...undated] as StockInvoiceRecord[];
      }
      const { data, error } = await baseQuery()
        .order("created_at", { ascending: false })
        .order("id")
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
