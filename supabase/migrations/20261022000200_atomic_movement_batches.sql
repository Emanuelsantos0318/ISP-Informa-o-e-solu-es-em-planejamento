BEGIN;

CREATE TABLE public.stock_movement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  movement_type public.stock_movement_type NOT NULL,
  occurred_at timestamptz NOT NULL,
  service_code text,
  exit_type_code text,
  supplier_id uuid,
  source_reference text,
  note text,
  performed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movement_batches_scope_key UNIQUE (id, company_id, unit_id),
  CONSTRAINT stock_movement_batches_idempotency_key UNIQUE (company_id, idempotency_key),
  CONSTRAINT stock_movement_batches_unit_company_fkey
    FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT stock_movement_batches_supplier_company_fkey
    FOREIGN KEY (supplier_id, company_id) REFERENCES public.suppliers(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT stock_movement_batches_request_object_check CHECK (jsonb_typeof(request_payload) = 'object'),
  CONSTRAINT stock_movement_batches_note_check CHECK (note IS NULL OR length(note) <= 500),
  CONSTRAINT stock_movement_batches_source_reference_check CHECK (source_reference IS NULL OR length(source_reference) <= 160),
  CONSTRAINT stock_movement_batches_exit_fields_check CHECK (
    (movement_type = 'exit' AND service_code IN ('desjejum', 'colacao', 'almoco', 'lanche', 'ceia_completa', 'ceia_leve')
      AND exit_type_code IN ('programada_padrao', 'extra'))
    OR (movement_type = 'entry' AND service_code IS NULL AND exit_type_code IS NULL)
  )
);

CREATE TABLE public.stock_movement_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  movement_id uuid NOT NULL UNIQUE REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  item_index integer NOT NULL CHECK (item_index > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movement_batch_items_batch_index_key UNIQUE (batch_id, item_index),
  CONSTRAINT stock_movement_batch_items_batch_scope_fkey
    FOREIGN KEY (batch_id, company_id, unit_id)
    REFERENCES public.stock_movement_batches(id, company_id, unit_id) ON DELETE RESTRICT
);

CREATE INDEX stock_movement_batches_scope_date_idx
  ON public.stock_movement_batches (company_id, unit_id, occurred_at DESC);
CREATE INDEX stock_movement_batch_items_scope_idx
  ON public.stock_movement_batch_items (company_id, unit_id, batch_id);

INSERT INTO public.stock_locations (company_id, unit_id, name, code)
SELECT unit.company_id, unit.id, 'Estoque principal', 'PRINCIPAL'
FROM public.units AS unit
JOIN public.companies AS company ON company.id = unit.company_id
WHERE unit.status = 'active' AND company.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_locations AS location
    WHERE location.company_id = unit.company_id
      AND location.unit_id = unit.id AND location.code = 'PRINCIPAL'
  )
ON CONFLICT (company_id, unit_id, code) DO NOTHING;

ALTER TABLE public.stock_movement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movement_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_movement_batches_select_active_members
  ON public.stock_movement_batches FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, unit_id, NULL::public.profile_role[]));
CREATE POLICY stock_movement_batch_items_select_active_members
  ON public.stock_movement_batch_items FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, unit_id, NULL::public.profile_role[]));

CREATE TRIGGER stock_movement_batches_append_only
  BEFORE UPDATE OR DELETE ON public.stock_movement_batches
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_row_mutation();
CREATE TRIGGER stock_movement_batch_items_append_only
  BEFORE UPDATE OR DELETE ON public.stock_movement_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_row_mutation();

REVOKE ALL ON public.stock_movement_batches, public.stock_movement_batch_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stock_movement_batches, public.stock_movement_batch_items TO authenticated;
GRANT ALL ON public.stock_movement_batches, public.stock_movement_batch_items TO service_role;

CREATE OR REPLACE FUNCTION public.record_stock_movement_batch(
  p_unit_id uuid,
  p_movement_type public.stock_movement_type,
  p_operational_at timestamptz,
  p_idempotency_key uuid,
  p_items jsonb,
  p_service_code text DEFAULT NULL,
  p_exit_type_code text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_source_reference text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS TABLE (batch_id uuid, movement_count integer, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_company_id uuid;
  v_location_ids uuid[];
  v_location_id uuid;
  v_batch_id uuid;
  v_existing public.stock_movement_batches%ROWTYPE;
  v_request jsonb;
  v_item jsonb;
  v_item_index bigint;
  v_product_id uuid;
  v_quantity numeric;
  v_lot_number text;
  v_expires_on date;
  v_lot_id uuid;
  v_existing_expiry date;
  v_item_key uuid;
  v_movement_id uuid;
  v_balance numeric;
  v_count integer := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
  END IF;
  IF p_movement_type IS NULL OR p_movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only entry and exit batches are supported.';
  END IF;
  IF p_operational_at IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operational time and idempotency key are required.';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A batch must contain between 1 and 100 items.';
  END IF;
  IF p_note IS NOT NULL AND length(trim(p_note)) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Note cannot exceed 500 characters.';
  END IF;
  IF p_source_reference IS NOT NULL AND length(trim(p_source_reference)) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Source reference cannot exceed 160 characters.';
  END IF;
  IF p_movement_type = 'entry' AND (p_service_code IS NOT NULL OR p_exit_type_code IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Entry batches cannot have exit classification.';
  END IF;
  IF p_movement_type = 'exit' AND (
    p_service_code IS NULL
    OR p_service_code NOT IN ('desjejum', 'colacao', 'almoco', 'lanche', 'ceia_completa', 'ceia_leve')
    OR p_exit_type_code IS NULL
    OR p_exit_type_code NOT IN ('programada_padrao', 'extra')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Valid service and exit type are required.';
  END IF;

  SELECT unit.company_id INTO v_company_id
  FROM public.units AS unit
  JOIN public.companies AS company ON company.id = unit.company_id
  WHERE unit.id = p_unit_id AND unit.status = 'active' AND company.status = 'active';
  IF NOT FOUND OR NOT private.has_active_access(
    v_company_id, p_unit_id,
    ARRAY['admin', 'stock_manager', 'operator']::public.profile_role[]
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized to record stock movements in this scope.';
  END IF;

  SELECT array_agg(location.id ORDER BY location.code) INTO v_location_ids
  FROM public.stock_locations AS location
  WHERE location.company_id = v_company_id AND location.unit_id = p_unit_id AND location.status = 'active';
  SELECT location.id INTO v_location_id
  FROM public.stock_locations AS location
  WHERE location.company_id = v_company_id AND location.unit_id = p_unit_id
    AND location.status = 'active' AND location.code = 'PRINCIPAL';
  IF v_location_id IS NULL THEN
    IF coalesce(array_length(v_location_ids, 1), 0) <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Set an active PRINCIPAL stock location for this unit.';
    END IF;
    v_location_id := v_location_ids[1];
  END IF;

  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers AS supplier
    WHERE supplier.id = p_supplier_id AND supplier.company_id = v_company_id AND supplier.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Supplier must be active and belong to the company.';
  END IF;

  v_request := jsonb_build_object(
    'unit_id', p_unit_id, 'movement_type', p_movement_type, 'operational_at', p_operational_at,
    'service_code', p_service_code, 'exit_type_code', p_exit_type_code,
    'supplier_id', p_supplier_id, 'source_reference', nullif(trim(p_source_reference), ''),
    'note', nullif(trim(p_note), ''), 'items', p_items
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || p_idempotency_key::text, 3));
  SELECT batch.* INTO v_existing
  FROM public.stock_movement_batches AS batch
  WHERE batch.company_id = v_company_id AND batch.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.performed_by <> v_actor_id OR v_existing.request_payload <> v_request THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Idempotency key was already used for a different batch.';
    END IF;
    SELECT count(*)::integer INTO v_count
    FROM public.stock_movement_batch_items AS item WHERE item.batch_id = v_existing.id;
    RETURN QUERY SELECT v_existing.id, v_count, true;
    RETURN;
  END IF;

  INSERT INTO public.stock_movement_batches (
    company_id, unit_id, movement_type, occurred_at, service_code, exit_type_code,
    supplier_id, source_reference, note, performed_by, idempotency_key, request_payload
  ) VALUES (
    v_company_id, p_unit_id, p_movement_type, p_operational_at, p_service_code, p_exit_type_code,
    p_supplier_id, nullif(trim(p_source_reference), ''), nullif(trim(p_note), ''),
    v_actor_id, p_idempotency_key, v_request
  ) RETURNING id INTO v_batch_id;

  FOR v_item, v_item_index IN
    SELECT element.value, element.ordinality
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS element(value, ordinality)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Each movement item must be an object.';
    END IF;
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_lot_number := nullif(trim(v_item->>'lot_number'), '');
    v_expires_on := nullif(v_item->>'expires_on', '')::date;
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0
       OR v_quantity <> trunc(v_quantity, 3) OR v_quantity > 99999999999.999 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Every item needs a product and a positive quantity with at most three decimals.';
    END IF;
    IF v_lot_number IS NULL AND v_expires_on IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Expiry date requires a lot number.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products AS product
      WHERE product.id = v_product_id AND product.company_id = v_company_id AND product.status = 'active'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Every item product must be active and belong to the company.';
    END IF;

    v_lot_id := NULL;
    IF v_lot_number IS NOT NULL THEN
      INSERT INTO public.product_lots (company_id, unit_id, product_id, lot_number, expires_on, received_at)
      VALUES (v_company_id, p_unit_id, v_product_id, v_lot_number, v_expires_on, p_operational_at)
      ON CONFLICT (company_id, unit_id, product_id, lot_number) DO NOTHING;
      SELECT lot.id, lot.expires_on INTO v_lot_id, v_existing_expiry
      FROM public.product_lots AS lot
      WHERE lot.company_id = v_company_id AND lot.unit_id = p_unit_id
        AND lot.product_id = v_product_id AND lot.lot_number = v_lot_number;
      IF v_existing_expiry IS NOT NULL AND v_expires_on IS NOT NULL AND v_existing_expiry <> v_expires_on THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The lot already exists with a different expiry date.';
      END IF;
      IF v_existing_expiry IS NULL AND v_expires_on IS NOT NULL THEN
        UPDATE public.product_lots SET expires_on = v_expires_on WHERE id = v_lot_id;
      END IF;
    END IF;

    v_item_key := md5(v_batch_id::text || ':' || v_item_index::text)::uuid;
    SELECT result.movement_id, result.balance_quantity INTO v_movement_id, v_balance
    FROM public.record_stock_movement(
      v_product_id, v_location_id, p_movement_type, v_quantity, v_item_key,
      v_lot_id, NULL, nullif(trim(p_note), '')
    ) AS result;
    INSERT INTO public.stock_movement_batch_items (company_id, unit_id, batch_id, movement_id, item_index)
    VALUES (v_company_id, p_unit_id, v_batch_id, v_movement_id, v_item_index::integer);
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.audit_logs (company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_company_id, p_unit_id, v_actor_id, 'stock_movement_batch_created', 'stock_movement_batch', v_batch_id,
    jsonb_build_object('movement_type', p_movement_type, 'item_count', v_count,
      'occurred_at', p_operational_at, 'service_code', p_service_code,
      'exit_type_code', p_exit_type_code, 'supplier_id', p_supplier_id)
  );
  RETURN QUERY SELECT v_batch_id, v_count, false;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_movement_batch(
  uuid, public.stock_movement_type, timestamptz, uuid, jsonb, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_stock_movement_batch(
  uuid, public.stock_movement_type, timestamptz, uuid, jsonb, text, text, uuid, text, text
) TO authenticated;

COMMENT ON FUNCTION public.record_stock_movement_batch(
  uuid, public.stock_movement_type, timestamptz, uuid, jsonb, text, text, uuid, text, text
) IS 'Atomically records a complete entry/exit batch, stock balance changes, batch items, and audit events.';

COMMIT;
