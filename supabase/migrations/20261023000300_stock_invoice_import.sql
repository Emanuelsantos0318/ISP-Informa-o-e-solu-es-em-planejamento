BEGIN;

CREATE TABLE public.stock_invoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  access_key text,
  invoice_number text NOT NULL,
  series text NOT NULL,
  issue_date date,
  supplier_cnpj text,
  invoice_total numeric(14,2),
  extracted_text text NOT NULL,
  parsed_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_invoice_documents_batch_unique UNIQUE (batch_id),
  CONSTRAINT stock_invoice_documents_access_key_check CHECK (access_key IS NULL OR access_key ~ '^\d{44}$'),
  CONSTRAINT stock_invoice_documents_number_check CHECK (length(trim(invoice_number)) BETWEEN 1 AND 40),
  CONSTRAINT stock_invoice_documents_series_check CHECK (length(trim(series)) BETWEEN 1 AND 20),
  CONSTRAINT stock_invoice_documents_cnpj_check CHECK (supplier_cnpj IS NULL OR supplier_cnpj ~ '^\d{14}$'),
  CONSTRAINT stock_invoice_documents_total_check CHECK (invoice_total IS NULL OR invoice_total >= 0),
  CONSTRAINT stock_invoice_documents_text_check CHECK (length(extracted_text) BETWEEN 1 AND 300000),
  CONSTRAINT stock_invoice_documents_parsed_check CHECK (jsonb_typeof(parsed_data) = 'object'),
  CONSTRAINT stock_invoice_documents_scope_unit_fkey
    FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT stock_invoice_documents_batch_scope_fkey
    FOREIGN KEY (batch_id, company_id, unit_id)
    REFERENCES public.stock_movement_batches(id, company_id, unit_id) ON DELETE RESTRICT,
  CONSTRAINT stock_invoice_documents_supplier_company_fkey
    FOREIGN KEY (supplier_id, company_id) REFERENCES public.suppliers(id, company_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX stock_invoice_documents_access_key_unique
  ON public.stock_invoice_documents (company_id, access_key)
  WHERE access_key IS NOT NULL;
CREATE UNIQUE INDEX stock_invoice_documents_supplier_number_unique
  ON public.stock_invoice_documents (company_id, supplier_id, lower(invoice_number), lower(series))
  WHERE access_key IS NULL;
CREATE INDEX stock_invoice_documents_scope_date_idx
  ON public.stock_invoice_documents (company_id, unit_id, created_at DESC);

ALTER TABLE public.stock_invoice_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_invoice_documents_select_active_members
  ON public.stock_invoice_documents FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, unit_id, NULL::public.profile_role[]));
CREATE TRIGGER stock_invoice_documents_append_only
  BEFORE UPDATE OR DELETE ON public.stock_invoice_documents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_row_mutation();
REVOKE ALL ON public.stock_invoice_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stock_invoice_documents TO authenticated;
GRANT ALL ON public.stock_invoice_documents TO service_role;

CREATE OR REPLACE FUNCTION public.record_stock_invoice_movement_batch(
  p_unit_id uuid,
  p_operational_at timestamptz,
  p_idempotency_key uuid,
  p_items jsonb,
  p_supplier_id uuid,
  p_source_reference text,
  p_note text,
  p_invoice jsonb
)
RETURNS TABLE (batch_id uuid, movement_count integer, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_actor_id uuid := (SELECT auth.uid());
  v_batch_id uuid;
  v_count integer;
  v_replayed boolean;
  v_access_key text := nullif(trim(p_invoice->>'access_key'), '');
  v_invoice_number text := nullif(trim(p_invoice->>'invoice_number'), '');
  v_series text := nullif(trim(p_invoice->>'series'), '');
  v_issue_date date := nullif(p_invoice->>'issue_date', '')::date;
  v_cnpj text := nullif(regexp_replace(coalesce(p_invoice->>'supplier_cnpj', ''), '\D', '', 'g'), '');
  v_total numeric := CASE
    WHEN nullif(p_invoice->>'invoice_total', '') IS NULL THEN NULL
    WHEN position(',' IN p_invoice->>'invoice_total') > 0
      THEN replace(replace(p_invoice->>'invoice_total', '.', ''), ',', '.')::numeric
    ELSE (p_invoice->>'invoice_total')::numeric
  END;
  v_text text := p_invoice->>'extracted_text';
  v_parsed jsonb := coalesce(p_invoice->'parsed_data', '{}'::jsonb);
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
  END IF;
  IF jsonb_typeof(p_invoice) IS DISTINCT FROM 'object'
     OR v_invoice_number IS NULL OR v_series IS NULL
     OR p_supplier_id IS NULL OR v_text IS NULL OR length(v_text) NOT BETWEEN 1 AND 300000
     OR (v_access_key IS NOT NULL AND v_access_key !~ '^\d{44}$')
     OR (v_cnpj IS NOT NULL AND v_cnpj !~ '^\d{14}$')
     OR (v_total IS NOT NULL AND v_total < 0)
     OR jsonb_typeof(v_parsed) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invoice data is incomplete or invalid.';
  END IF;

  SELECT unit.company_id INTO v_company_id
  FROM public.units AS unit
  WHERE unit.id = p_unit_id AND unit.status = 'active';
  IF NOT FOUND OR NOT private.has_active_access(
    v_company_id, p_unit_id,
    ARRAY['admin', 'stock_manager', 'operator']::public.profile_role[]
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized to record stock movements in this scope.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers AS supplier
    WHERE supplier.id = p_supplier_id AND supplier.company_id = v_company_id AND supplier.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Select an active supplier before confirming the invoice.';
  END IF;

  SELECT result.batch_id, result.movement_count, result.replayed
    INTO v_batch_id, v_count, v_replayed
  FROM public.record_stock_movement_batch(
    p_unit_id, 'entry'::public.stock_movement_type, p_operational_at,
    p_idempotency_key, p_items, NULL, NULL, p_supplier_id,
    p_source_reference, p_note
  ) AS result;

  IF v_replayed THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_invoice_documents AS invoice
      WHERE invoice.batch_id = v_batch_id
        AND invoice.supplier_id = p_supplier_id
        AND invoice.access_key IS NOT DISTINCT FROM v_access_key
        AND invoice.invoice_number = v_invoice_number AND invoice.series = v_series
        AND invoice.issue_date IS NOT DISTINCT FROM v_issue_date
        AND invoice.supplier_cnpj IS NOT DISTINCT FROM v_cnpj
        AND invoice.invoice_total IS NOT DISTINCT FROM v_total
        AND invoice.extracted_text = v_text
        AND invoice.parsed_data = v_parsed
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Idempotency key was already used without the same invoice.';
    END IF;
  ELSE
    BEGIN
      INSERT INTO public.stock_invoice_documents (
        company_id, unit_id, batch_id, supplier_id, access_key, invoice_number, series,
        issue_date, supplier_cnpj, invoice_total, extracted_text, parsed_data, created_by
      ) VALUES (
        v_company_id, p_unit_id, v_batch_id, p_supplier_id, v_access_key,
        v_invoice_number, v_series, v_issue_date, v_cnpj, v_total,
        v_text, v_parsed, v_actor_id
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'This invoice has already been recorded.';
    END;
    INSERT INTO public.audit_logs (company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_company_id, p_unit_id, v_actor_id, 'stock_invoice_registered', 'stock_invoice_document', v_batch_id,
      jsonb_build_object('invoice_number', v_invoice_number, 'series', v_series, 'has_access_key', v_access_key IS NOT NULL));
  END IF;
  RETURN QUERY SELECT v_batch_id, v_count, v_replayed;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_invoice_movement_batch(uuid, timestamptz, uuid, jsonb, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_stock_invoice_movement_batch(uuid, timestamptz, uuid, jsonb, uuid, text, text, jsonb)
  TO authenticated;
COMMENT ON FUNCTION public.record_stock_invoice_movement_batch(uuid, timestamptz, uuid, jsonb, uuid, text, text, jsonb)
  IS 'Atomically registers a DANFE invoice, deduplicates it, and records its stock entry using the existing batch RPC.';

COMMIT;
