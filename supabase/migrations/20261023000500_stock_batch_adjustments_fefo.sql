BEGIN;

ALTER TABLE public.stock_movement_batches
  ADD COLUMN IF NOT EXISTS adjustment_direction public.adjustment_direction;
ALTER TABLE public.stock_movement_batches
  DROP CONSTRAINT IF EXISTS stock_movement_batches_exit_fields_check;
ALTER TABLE public.stock_movement_batches
  ADD CONSTRAINT stock_movement_batches_classification_check CHECK (
    (movement_type = 'entry' AND service_code IS NULL AND exit_type_code IS NULL AND adjustment_direction IS NULL)
    OR (movement_type = 'exit' AND service_code IN ('desjejum', 'colacao', 'almoco', 'lanche', 'ceia_completa', 'ceia_leve')
      AND exit_type_code IN ('programada_padrao', 'extra') AND adjustment_direction IS NULL)
    OR (movement_type = 'adjustment' AND service_code IS NULL AND exit_type_code IS NULL AND adjustment_direction IS NOT NULL)
    OR (movement_type = 'loss' AND service_code IS NULL AND exit_type_code IS NULL AND adjustment_direction IS NULL)
  );

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
  v_location_id uuid;
  v_batch_id uuid;
  v_existing public.stock_movement_batches%ROWTYPE;
  v_request jsonb;
  v_item jsonb;
  v_item_index bigint;
  v_batch_item_index integer := 0;
  v_product_id uuid;
  v_quantity numeric;
  v_remaining numeric;
  v_take numeric;
  v_lot_number text;
  v_expires_on date;
  v_lot_id uuid;
  v_candidate record;
  v_movement_id uuid;
  v_balance numeric;
  v_count integer := 0;
  v_adjustment_direction public.adjustment_direction;
  v_item_direction public.adjustment_direction;
  v_actor_role public.profile_role;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.';
  END IF;
  IF p_movement_type IS NULL OR p_movement_type NOT IN ('entry', 'exit', 'adjustment', 'loss') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported stock movement type.';
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
  IF p_movement_type = 'exit' AND (
    p_service_code IS NULL OR p_service_code NOT IN ('desjejum', 'colacao', 'almoco', 'lanche', 'ceia_completa', 'ceia_leve')
    OR p_exit_type_code IS NULL OR p_exit_type_code NOT IN ('programada_padrao', 'extra')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Valid service and exit type are required.';
  END IF;
  IF p_movement_type <> 'exit' AND (p_service_code IS NOT NULL OR p_exit_type_code IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only exits may have service classification.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Each movement item must be an object.';
    END IF;
    v_item_direction := nullif(v_item->>'adjustment_direction', '')::public.adjustment_direction;
    IF p_movement_type = 'adjustment' THEN
      IF v_item_direction IS NULL OR (v_adjustment_direction IS NOT NULL AND v_adjustment_direction <> v_item_direction) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'All adjustment items must use the same increase/decrease direction.';
      END IF;
      v_adjustment_direction := v_item_direction;
    ELSIF v_item_direction IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Adjustment direction is valid only for adjustments.';
    END IF;
  END LOOP;
  IF p_movement_type <> 'adjustment' AND v_adjustment_direction IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Adjustment direction is required only for adjustments.';
  END IF;

  SELECT unit.company_id INTO v_company_id
  FROM public.units AS unit
  JOIN public.companies AS company ON company.id = unit.company_id
  WHERE unit.id = p_unit_id AND unit.status = 'active' AND company.status = 'active';
  IF NOT FOUND OR NOT private.has_active_access(
    v_company_id, p_unit_id, ARRAY['admin', 'stock_manager', 'operator']::public.profile_role[]
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized to record stock movements in this scope.';
  END IF;
  SELECT profile.role INTO v_actor_role FROM public.profiles AS profile
  WHERE profile.user_id = v_actor_id AND profile.company_id = v_company_id AND profile.status = 'active';
  IF p_movement_type IN ('adjustment', 'loss') AND v_actor_role NOT IN ('admin', 'stock_manager') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only administrators and stock managers may adjust stock or record losses.';
  END IF;

  SELECT location.id INTO v_location_id
  FROM public.stock_locations AS location
  WHERE location.company_id = v_company_id AND location.unit_id = p_unit_id
    AND location.status = 'active' AND location.code = 'PRINCIPAL';
  IF v_location_id IS NULL THEN
    SELECT min(location.id) INTO v_location_id FROM public.stock_locations AS location
    WHERE location.company_id = v_company_id AND location.unit_id = p_unit_id AND location.status = 'active'
    HAVING count(*) = 1;
  END IF;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Set one active PRINCIPAL stock location for this unit.';
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
    'adjustment_direction', v_adjustment_direction, 'supplier_id', p_supplier_id,
    'source_reference', nullif(trim(p_source_reference), ''), 'note', nullif(trim(p_note), ''), 'items', p_items
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':' || p_idempotency_key::text, 3));
  SELECT batch.* INTO v_existing FROM public.stock_movement_batches AS batch
  WHERE batch.company_id = v_company_id AND batch.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.performed_by <> v_actor_id OR v_existing.request_payload <> v_request THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Idempotency key was already used for a different batch.';
    END IF;
    SELECT count(*)::integer INTO v_count FROM public.stock_movement_batch_items AS item WHERE item.batch_id = v_existing.id;
    RETURN QUERY SELECT v_existing.id, v_count, true;
    RETURN;
  END IF;

  INSERT INTO public.stock_movement_batches (
    company_id, unit_id, movement_type, occurred_at, service_code, exit_type_code, adjustment_direction,
    supplier_id, source_reference, note, performed_by, idempotency_key, request_payload
  ) VALUES (
    v_company_id, p_unit_id, p_movement_type, p_operational_at, p_service_code, p_exit_type_code,
    v_adjustment_direction, p_supplier_id, nullif(trim(p_source_reference), ''), nullif(trim(p_note), ''),
    v_actor_id, p_idempotency_key, v_request
  ) RETURNING id INTO v_batch_id;

  FOR v_item, v_item_index IN
    SELECT element.value, element.ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY AS element(value, ordinality)
  LOOP
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_remaining := v_quantity;
    v_lot_number := nullif(trim(v_item->>'lot_number'), '');
    v_expires_on := nullif(v_item->>'expires_on', '')::date;
    v_item_direction := nullif(v_item->>'adjustment_direction', '')::public.adjustment_direction;
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_quantity <> trunc(v_quantity, 3)
       OR v_quantity > 99999999999.999 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Every item needs a product and a positive quantity with at most three decimals.';
    END IF;
    IF v_lot_number IS NULL AND v_expires_on IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Expiry date requires a lot number.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products AS product WHERE product.id = v_product_id AND product.company_id = v_company_id AND product.status = 'active') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Every item product must be active and belong to the company.';
    END IF;

    IF p_movement_type = 'entry' THEN
      v_lot_id := NULL;
      IF v_lot_number IS NOT NULL THEN
        INSERT INTO public.product_lots (company_id, unit_id, product_id, lot_number, expires_on, received_at)
        VALUES (v_company_id, p_unit_id, v_product_id, v_lot_number, v_expires_on, p_operational_at)
        ON CONFLICT (company_id, unit_id, product_id, lot_number) DO NOTHING;
        SELECT lot.id INTO v_lot_id FROM public.product_lots AS lot
        WHERE lot.company_id = v_company_id AND lot.unit_id = p_unit_id AND lot.product_id = v_product_id AND lot.lot_number = v_lot_number;
        IF EXISTS (SELECT 1 FROM public.product_lots AS lot WHERE lot.id = v_lot_id AND lot.expires_on IS NOT NULL AND v_expires_on IS NOT NULL AND lot.expires_on <> v_expires_on) THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The lot already exists with a different expiry date.';
        END IF;
        UPDATE public.product_lots SET expires_on = coalesce(expires_on, v_expires_on) WHERE id = v_lot_id AND expires_on IS NULL AND v_expires_on IS NOT NULL;
      END IF;
      v_batch_item_index := v_batch_item_index + 1;
      SELECT result.movement_id, result.balance_quantity INTO v_movement_id, v_balance
      FROM public.record_stock_movement(v_product_id, v_location_id, 'entry', v_quantity,
        md5(v_batch_id::text || ':' || v_item_index::text || ':entry')::uuid, v_lot_id, NULL, nullif(trim(p_note), '')) AS result;
      INSERT INTO public.stock_movement_batch_items (company_id, unit_id, batch_id, movement_id, item_index)
      VALUES (v_company_id, p_unit_id, v_batch_id, v_movement_id, v_batch_item_index);
      v_count := v_count + 1;
    ELSIF p_movement_type = 'adjustment' AND v_item_direction = 'increase' THEN
      v_lot_id := NULL;
      IF v_lot_number IS NOT NULL THEN
        INSERT INTO public.product_lots (company_id, unit_id, product_id, lot_number, expires_on, received_at)
        VALUES (v_company_id, p_unit_id, v_product_id, v_lot_number, v_expires_on, p_operational_at)
        ON CONFLICT (company_id, unit_id, product_id, lot_number) DO NOTHING;
        SELECT lot.id INTO v_lot_id FROM public.product_lots AS lot WHERE lot.company_id = v_company_id AND lot.unit_id = p_unit_id AND lot.product_id = v_product_id AND lot.lot_number = v_lot_number;
      END IF;
      v_batch_item_index := v_batch_item_index + 1;
      SELECT result.movement_id, result.balance_quantity INTO v_movement_id, v_balance
      FROM public.record_stock_movement(v_product_id, v_location_id, 'adjustment', v_quantity,
        md5(v_batch_id::text || ':' || v_item_index::text || ':increase')::uuid, v_lot_id, 'increase', nullif(trim(p_note), '')) AS result;
      INSERT INTO public.stock_movement_batch_items (company_id, unit_id, batch_id, movement_id, item_index)
      VALUES (v_company_id, p_unit_id, v_batch_id, v_movement_id, v_batch_item_index);
      v_count := v_count + 1;
    ELSE
      IF v_lot_number IS NOT NULL THEN
        SELECT lot.id, balance.quantity INTO v_candidate
        FROM public.product_lots AS lot JOIN public.stock_balances AS balance ON balance.product_lot_id = lot.id
        WHERE lot.company_id = v_company_id AND lot.unit_id = p_unit_id AND lot.product_id = v_product_id
          AND lot.lot_number = v_lot_number AND balance.stock_location_id = v_location_id AND balance.quantity > 0
          AND (p_movement_type <> 'exit' OR lot.expires_on IS NULL OR lot.expires_on >= (p_operational_at AT TIME ZONE 'America/Bahia')::date);
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The selected lot has insufficient stock.'; END IF;
        v_take := v_remaining;
        IF v_candidate.quantity < v_take THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The selected lot has insufficient stock.'; END IF;
        v_batch_item_index := v_batch_item_index + 1;
        SELECT result.movement_id, result.balance_quantity INTO v_movement_id, v_balance
        FROM public.record_stock_movement(v_product_id, v_location_id, p_movement_type, v_take,
          md5(v_batch_id::text || ':' || v_item_index::text || ':' || v_candidate.id::text)::uuid,
          v_candidate.id, v_item_direction, nullif(trim(p_note), '')) AS result;
        INSERT INTO public.stock_movement_batch_items (company_id, unit_id, batch_id, movement_id, item_index)
        VALUES (v_company_id, p_unit_id, v_batch_id, v_movement_id, v_batch_item_index);
        v_count := v_count + 1;
        v_remaining := 0;
      ELSE
        FOR v_candidate IN
          SELECT balance.product_lot_id, balance.quantity, lot.expires_on, lot.received_at, lot.lot_number
          FROM public.stock_balances AS balance
          LEFT JOIN public.product_lots AS lot ON lot.id = balance.product_lot_id
          WHERE balance.company_id = v_company_id AND balance.unit_id = p_unit_id
            AND balance.product_id = v_product_id AND balance.stock_location_id = v_location_id AND balance.quantity > 0
            AND (p_movement_type <> 'exit' OR lot.expires_on IS NULL OR lot.expires_on >= (p_operational_at AT TIME ZONE 'America/Bahia')::date)
          ORDER BY CASE WHEN balance.product_lot_id IS NULL THEN 1 ELSE 0 END,
            lot.expires_on ASC NULLS LAST, lot.received_at ASC NULLS LAST, lot.lot_number ASC NULLS LAST
        LOOP
          EXIT WHEN v_remaining <= 0;
          v_take := least(v_remaining, v_candidate.quantity);
          v_batch_item_index := v_batch_item_index + 1;
          SELECT result.movement_id, result.balance_quantity INTO v_movement_id, v_balance
          FROM public.record_stock_movement(v_product_id, v_location_id, p_movement_type, v_take,
            md5(v_batch_id::text || ':' || v_item_index::text || ':' || coalesce(v_candidate.product_lot_id::text, 'no-lot'))::uuid,
            v_candidate.product_lot_id, v_item_direction, nullif(trim(p_note), '')) AS result;
          INSERT INTO public.stock_movement_batch_items (company_id, unit_id, batch_id, movement_id, item_index)
          VALUES (v_company_id, p_unit_id, v_batch_id, v_movement_id, v_batch_item_index);
          v_count := v_count + 1;
          v_remaining := v_remaining - v_take;
        END LOOP;
        IF v_remaining > 0 THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Insufficient stock for this movement.'; END IF;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_company_id, p_unit_id, v_actor_id, 'stock_movement_batch_created', 'stock_movement_batch', v_batch_id,
    jsonb_build_object('movement_type', p_movement_type, 'adjustment_direction', v_adjustment_direction,
      'item_count', v_count, 'occurred_at', p_operational_at, 'service_code', p_service_code,
      'exit_type_code', p_exit_type_code, 'supplier_id', p_supplier_id));
  RETURN QUERY SELECT v_batch_id, v_count, false;
END;
$$;

COMMENT ON FUNCTION public.record_stock_movement_batch(uuid, public.stock_movement_type, timestamptz, uuid, jsonb, text, text, uuid, text, text)
  IS 'Atomically records stock batches; exits/losses/decreases allocate FEFO by lot and adjustments are restricted to stock managers/admins.';

COMMIT;
