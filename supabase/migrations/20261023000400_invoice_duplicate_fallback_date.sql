BEGIN;

DROP INDEX public.stock_invoice_documents_supplier_number_unique;
CREATE UNIQUE INDEX stock_invoice_documents_supplier_number_unique
  ON public.stock_invoice_documents (
    company_id,
    supplier_id,
    lower(invoice_number),
    lower(series),
    coalesce(issue_date, DATE '0001-01-01')
  );

COMMENT ON INDEX public.stock_invoice_documents_supplier_number_unique
  IS 'Prevents fallback invoice duplicates per company, supplier, number, series, and issue date, including records that also have an access key.';

COMMIT;
