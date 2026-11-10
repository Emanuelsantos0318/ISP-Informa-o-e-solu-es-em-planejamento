BEGIN;

-- Numera versões em concorrência sem sobrescrever um plano existente.
CREATE OR REPLACE FUNCTION private.assign_production_plan_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.company_id::text || ':' || NEW.unit_id::text || ':' || NEW.week_start::text, 0)
  );
  SELECT coalesce(max(plan.version), 0) + 1 INTO NEW.version
  FROM public.production_plans AS plan
  WHERE plan.company_id = NEW.company_id
    AND plan.unit_id = NEW.unit_id
    AND plan.week_start = NEW.week_start;
  RETURN NEW;
END;
$$;

CREATE TRIGGER production_plans_assign_version
  BEFORE INSERT ON public.production_plans
  FOR EACH ROW EXECUTE FUNCTION private.assign_production_plan_version();

REVOKE ALL ON FUNCTION private.assign_production_plan_version() FROM PUBLIC, anon, authenticated;

-- Evita forjar o usuário registrado nos campos de autoria das tabelas.
CREATE OR REPLACE FUNCTION private.enforce_production_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  new_data jsonb := to_jsonb(NEW);
  old_data jsonb;
  current_actor text := auth.uid()::text;
  actor_column text;
BEGIN
  IF auth.role() <> 'authenticated' THEN RETURN NEW; END IF;
  IF current_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated production writes require an actor.';
  END IF;
  old_data := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  FOREACH actor_column IN ARRAY ARRAY['created_by', 'updated_by', 'imported_by'] LOOP
    IF new_data ? actor_column THEN
      IF TG_OP = 'INSERT' AND actor_column IN ('created_by', 'imported_by')
         AND new_data ->> actor_column IS DISTINCT FROM current_actor THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Production actor does not match the authenticated user.';
      END IF;
      IF actor_column = 'updated_by' AND new_data ->> actor_column IS DISTINCT FROM current_actor THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Production updated_by must match the authenticated user.';
      END IF;
      IF TG_OP = 'UPDATE' AND actor_column IN ('created_by', 'imported_by')
         AND new_data ->> actor_column IS DISTINCT FROM old_data ->> actor_column THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Production creator fields are immutable.';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_production_actor() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.validate_production_delivery_window_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.window_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.production_delivery_windows AS window_row
    WHERE window_row.id = NEW.window_id
      AND window_row.company_id = NEW.company_id
      AND (window_row.unit_id IS NULL OR window_row.unit_id = NEW.unit_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Delivery window is outside the production scope.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER production_deliveries_window_scope_guard
  BEFORE INSERT OR UPDATE OF window_id, company_id, unit_id
  ON public.production_deliveries
  FOR EACH ROW EXECUTE FUNCTION private.validate_production_delivery_window_scope();

REVOKE ALL ON FUNCTION private.validate_production_delivery_window_scope() FROM PUBLIC, anon, authenticated;

-- Impede que planos encerrados e programações de peixe sejam alterados sem controle.
CREATE OR REPLACE FUNCTION private.guard_production_plan_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'finished'
       AND NOT private.has_active_access(OLD.company_id, OLD.unit_id, ARRAY['admin']::public.profile_role[]) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Finished production plans require administrator access to change.';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'finished' AND OLD.status <> 'finished'
       AND NOT private.has_active_access(NEW.company_id, NEW.unit_id, ARRAY['admin', 'stock_manager']::public.profile_role[]) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only an administrator or stock manager can finish a production plan.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER production_plans_state_guard
  BEFORE UPDATE ON public.production_plans
  FOR EACH ROW EXECUTE FUNCTION private.guard_production_plan_state();

CREATE OR REPLACE FUNCTION private.enforce_production_thaw_timing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_product_name text;
  v_category_id uuid;
  v_category_name text;
  v_required_hours integer;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT product.name, product.category_id, category.name
      INTO v_product_name, v_category_id, v_category_name
    FROM public.products AS product
    LEFT JOIN public.categories AS category
      ON category.id = product.category_id AND category.company_id = product.company_id
    WHERE product.id = NEW.product_id AND product.company_id = NEW.company_id;
  END IF;

  SELECT rule.lead_hours INTO v_required_hours
  FROM public.production_thaw_rules AS rule
  WHERE rule.company_id = NEW.company_id AND rule.active
    AND (rule.unit_id IS NULL OR rule.unit_id = NEW.unit_id)
    AND (rule.product_id = NEW.product_id OR (v_category_id IS NOT NULL AND rule.category_id = v_category_id))
  ORDER BY (rule.product_id = NEW.product_id) DESC, (rule.unit_id = NEW.unit_id) DESC
  LIMIT 1;

  IF v_required_hours IS NULL AND (coalesce(v_product_name, '') || ' ' || coalesce(v_category_name, '')) ILIKE '%peix%' THEN
    v_required_hours := 24;
  END IF;
  IF v_required_hours IS NOT NULL AND NEW.lead_hours IS DISTINCT FROM v_required_hours THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The configured thaw lead time for this product is ' || v_required_hours || ' hours.';
  END IF;
  IF NEW.lead_hours IS NOT NULL THEN
    IF NEW.planned_thaw_at IS NULL THEN
      NEW.planned_thaw_at := NEW.consumption_at - make_interval(hours => NEW.lead_hours);
    ELSIF NEW.planned_thaw_at <> NEW.consumption_at - make_interval(hours => NEW.lead_hours) THEN
      IF length(trim(coalesce(NEW.notes, ''))) = 0
         OR NOT private.has_active_access(NEW.company_id, NEW.unit_id, ARRAY['admin', 'stock_manager']::public.profile_role[]) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A manual thaw reschedule requires an authorized user and a reason.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER production_thaw_schedules_timing_guard
  BEFORE INSERT OR UPDATE OF product_id, consumption_at, planned_thaw_at, lead_hours, notes
  ON public.production_thaw_schedules
  FOR EACH ROW EXECUTE FUNCTION private.enforce_production_thaw_timing();

REVOKE ALL ON FUNCTION private.guard_production_plan_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.enforce_production_thaw_timing() FROM PUBLIC, anon, authenticated;

-- Gera a entrega e consolida somente produtos identificados em uma transação.
CREATE OR REPLACE FUNCTION public.create_production_delivery(
  p_plan_id uuid,
  p_label text,
  p_scheduled_for date,
  p_window_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan public.production_plans%ROWTYPE;
  v_window public.production_delivery_windows%ROWTYPE;
  v_delivery_id uuid;
BEGIN
  SELECT * INTO v_plan
  FROM public.production_plans AS plan
  WHERE plan.id = p_plan_id
    AND private.has_active_access(
      plan.company_id, plan.unit_id,
      ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[]
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'No access to the selected production plan.';
  END IF;
  IF length(trim(coalesce(p_label, ''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Delivery label must contain 1 to 100 characters.';
  END IF;
  IF p_window_id IS NOT NULL THEN
    SELECT * INTO v_window FROM public.production_delivery_windows AS window_row
    WHERE window_row.id = p_window_id
      AND window_row.company_id = v_plan.company_id
      AND (window_row.unit_id IS NULL OR window_row.unit_id = v_plan.unit_id)
      AND window_row.active;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Delivery window is inactive or outside the plan scope.';
    END IF;
  END IF;

  INSERT INTO public.production_deliveries (
    company_id, unit_id, plan_id, window_id, label, scheduled_for, status, created_by, updated_by
  ) VALUES (
    v_plan.company_id, v_plan.unit_id, v_plan.id, p_window_id, trim(p_label), p_scheduled_for,
    'planned', auth.uid(), auth.uid()
  ) RETURNING id INTO v_delivery_id;

  INSERT INTO public.production_delivery_items (
    company_id, unit_id, delivery_id, product_id, quantity_unit,
    requested_quantity, created_by, updated_by
  )
  SELECT v_plan.company_id, v_plan.unit_id, v_delivery_id,
         entry.product_id, entry.quantity_unit, sum(entry.final_quantity), auth.uid(), auth.uid()
  FROM public.production_plan_entries AS entry
  WHERE entry.plan_id = v_plan.id
    AND entry.product_id IS NOT NULL
    AND entry.final_quantity IS NOT NULL
    AND entry.quantity_unit IS NOT NULL
    AND (p_scheduled_for IS NULL OR entry.consumption_date = p_scheduled_for)
    AND (
      p_window_id IS NULL
      OR (entry.consumption_date IS NOT NULL AND CASE
        WHEN v_window.consumption_from <= v_window.consumption_to
          THEN extract(dow FROM entry.consumption_date)::integer BETWEEN v_window.consumption_from AND v_window.consumption_to
        ELSE extract(dow FROM entry.consumption_date)::integer >= v_window.consumption_from
          OR extract(dow FROM entry.consumption_date)::integer <= v_window.consumption_to
      END)
    )
  GROUP BY entry.product_id, entry.quantity_unit;

  RETURN v_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_production_delivery(uuid, text, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_production_delivery(uuid, text, date, uuid) TO authenticated;

-- Registra a conferência sem alterar o estoque; o recebimento de estoque segue o fluxo próprio.
CREATE OR REPLACE FUNCTION public.record_production_delivery_receipt(
  p_delivery_item_id uuid,
  p_received_quantity numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.production_delivery_items%ROWTYPE;
  v_delivery_id uuid;
BEGIN
  IF p_received_quantity IS NULL OR p_received_quantity < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Received quantity must be zero or greater.';
  END IF;
  SELECT item.* INTO v_item
  FROM public.production_delivery_items AS item
  WHERE item.id = p_delivery_item_id
    AND private.has_active_access(
      item.company_id, item.unit_id,
      ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[]
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'No access to the selected delivery item.';
  END IF;
  UPDATE public.production_delivery_items
  SET received_quantity = p_received_quantity, updated_by = auth.uid(), updated_at = now()
  WHERE id = v_item.id;

  v_delivery_id := v_item.delivery_id;
  UPDATE public.production_deliveries AS delivery
  SET status = CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.production_delivery_items AS item
      WHERE item.delivery_id = v_delivery_id AND item.received_quantity IS NULL
    ) THEN 'received'
    WHEN EXISTS (
      SELECT 1 FROM public.production_delivery_items AS item
      WHERE item.delivery_id = v_delivery_id AND item.received_quantity IS NOT NULL
    ) THEN 'partially_received'
    ELSE 'planned'
  END,
  updated_by = auth.uid(), updated_at = now()
  WHERE delivery.id = v_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_production_delivery_receipt(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_production_delivery_receipt(uuid, numeric) TO authenticated;

-- Confirma um candidato histórico com data escolhida pelo usuário e grava-o uma única vez.
CREATE OR REPLACE FUNCTION public.import_production_candidate(
  p_import_row_id uuid,
  p_product_id uuid,
  p_consumption_date date,
  p_confirmed_quantity numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source public.production_import_rows%ROWTYPE;
  v_import public.production_imports%ROWTYPE;
  v_record jsonb;
  v_plan_id uuid;
  v_entry_id uuid;
  v_week_start date;
  v_quantity numeric(18, 6);
  v_record_type text;
BEGIN
  SELECT source_row.* INTO v_source
  FROM public.production_import_rows AS source_row
  WHERE source_row.id = p_import_row_id
    AND source_row.recognized_type IN ('meal_candidate', 'pulp_candidate', 'protein_map_candidate')
    AND private.has_active_access(
      source_row.company_id, source_row.unit_id,
      ARRAY['admin', 'stock_manager']::public.profile_role[]
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Historical candidate is missing or access is denied.';
  END IF;
  IF v_source.linked_record_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'This historical candidate has already been imported.';
  END IF;
  v_record := v_source.normalized_value;
  v_record_type := coalesce(v_record ->> 'record_type', 'meal');
  IF v_record_type NOT IN ('meal', 'pulp', 'protein_map') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported historical record type.';
  END IF;
  IF p_consumption_date IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Confirm the actual consumption date before importing.';
  END IF;
  IF v_record_type = 'meal' AND (coalesce(v_record ->> 'preparation', '') = '' OR coalesce(v_record ->> 'meal_code', '') = '') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Candidate is missing a preparation or meal classification.';
  END IF;
  IF v_record_type = 'pulp' AND (coalesce(v_record ->> 'flavor_text', '') = '' OR coalesce(v_record ->> 'service_code', '') = '') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Pulp candidate is missing its flavor or service.';
  END IF;
  IF v_record_type = 'protein_map' AND (coalesce(v_record ->> 'preparation', '') = '' OR coalesce(v_record ->> 'product_text', '') = '' OR coalesce(v_record ->> 'meal_code', '') = '') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Protein map candidate is missing its preparation, protein or meal.';
  END IF;

  SELECT * INTO v_import FROM public.production_imports AS item
  WHERE item.id = v_source.import_id
    AND private.has_active_access(item.company_id, item.unit_id, ARRAY['admin', 'stock_manager']::public.profile_role[]);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Import scope is unavailable.'; END IF;

  v_week_start := date_trunc('week', p_consumption_date::timestamp)::date;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_import.id::text || ':' || v_week_start::text, 0));
  SELECT plan.id INTO v_plan_id FROM public.production_plans AS plan
  WHERE plan.company_id = v_source.company_id AND plan.unit_id = v_source.unit_id
    AND plan.week_start = v_week_start AND plan.status = 'finished'
    AND plan.notes = 'Importação histórica: ' || v_import.id::text
  ORDER BY plan.version DESC LIMIT 1;
  IF v_plan_id IS NULL THEN
    INSERT INTO public.production_plans (
      company_id, unit_id, week_start, week_end, title, status, notes, created_by, updated_by
    ) VALUES (
      v_source.company_id, v_source.unit_id, v_week_start, v_week_start + 6,
      'Histórico importado · ' || to_char(v_week_start, 'DD/MM/YYYY'), 'finished',
      'Importação histórica: ' || v_import.id::text, auth.uid(), auth.uid()
    ) RETURNING id INTO v_plan_id;
  END IF;

  IF v_record_type = 'pulp' THEN
    v_quantity := coalesce(p_confirmed_quantity, nullif(v_record ->> 'quantity', '')::numeric);
    IF v_quantity IS NULL OR v_quantity < 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Confirm a valid pulp quantity before importing.';
    END IF;
    INSERT INTO public.production_pulp_entries (
      company_id, unit_id, plan_id, consumption_date, audience_code,
      service_code, original_flavor_text, quantity, quantity_unit,
      notes, created_by, updated_by
    ) VALUES (
      v_source.company_id, v_source.unit_id, v_plan_id, p_consumption_date,
      v_record ->> 'audience_code', v_record ->> 'service_code',
      left(v_record ->> 'flavor_text', 120), v_quantity,
      coalesce(nullif(v_record ->> 'quantity_unit', ''), 'KG'),
      'Importação histórica; arquivo e células originais preservados.', auth.uid(), auth.uid()
    ) RETURNING id INTO v_entry_id;
  ELSE
    v_quantity := CASE WHEN v_record_type = 'protein_map'
      THEN coalesce(p_confirmed_quantity, nullif(v_record ->> 'cached_quantity', '')::numeric)
      ELSE nullif(v_record ->> 'cached_quantity', '')::numeric END;
    IF v_record_type = 'protein_map' AND (v_quantity IS NULL OR v_quantity < 0) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Confirm a valid protein map total before importing.';
    END IF;
    INSERT INTO public.production_plan_entries (
      company_id, unit_id, plan_id, consumption_date,
      audience_code, meal_code, preparation, original_product_text, product_id,
      per_capita, per_capita_unit, volume, volume_unit, quantity_unit,
      manual_quantity, manual_reason, source_import_row_id, created_by, updated_by
    ) VALUES (
      v_source.company_id, v_source.unit_id, v_plan_id, p_consumption_date,
      v_record ->> 'audience_code', v_record ->> 'meal_code',
      left(v_record ->> 'preparation', 200), nullif(v_record ->> 'product_text', ''), p_product_id,
      nullif(v_record ->> 'per_capita', '')::numeric, NULL,
      nullif(v_record ->> 'volume', '')::numeric, NULL,
      coalesce(nullif(v_record ->> 'quantity_unit', ''), 'Não informado'),
      v_quantity,
      CASE WHEN v_quantity IS NULL THEN NULL
        WHEN v_record_type = 'protein_map' THEN 'Total KG importado de mapa; valores de origem preservados.'
        ELSE 'Valor histórico importado; fórmula e células originais preservadas.' END,
      v_source.id, auth.uid(), auth.uid()
    ) RETURNING id INTO v_entry_id;
  END IF;

  UPDATE public.production_import_rows
  SET product_id = p_product_id,
      validation_status = 'imported',
      linked_record_id = v_entry_id,
      normalized_value = v_record || jsonb_build_object('confirmed_date', p_consumption_date, 'reviewed_by', auth.uid(), 'reviewed_at', now()),
      updated_at = now()
  WHERE id = v_source.id;
  UPDATE public.production_imports
  SET imported_count = imported_count + 1,
      identified_count = greatest(identified_count, 1),
      pending_count = greatest(pending_count - 1, 0),
      status = CASE WHEN pending_count <= 1 THEN 'imported' ELSE 'partial' END,
      validation_report = validation_report || jsonb_build_object(
        'structured_records_imported_count', imported_count + 1,
        'pulp_records_imported_count', CASE WHEN v_record_type = 'pulp' THEN coalesce((validation_report ->> 'pulp_records_imported_count')::integer, 0) + 1 ELSE coalesce((validation_report ->> 'pulp_records_imported_count')::integer, 0) END,
        'protein_map_records_imported_count', CASE WHEN v_record_type = 'protein_map' THEN coalesce((validation_report ->> 'protein_map_records_imported_count')::integer, 0) + 1 ELSE coalesce((validation_report ->> 'protein_map_records_imported_count')::integer, 0) END
      )
  WHERE id = v_import.id;
  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_production_candidate(uuid, uuid, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_production_candidate(uuid, uuid, date, numeric) TO authenticated;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'production_plans', 'production_plan_entries', 'production_delivery_windows',
    'production_deliveries', 'production_delivery_items', 'production_thaw_rules',
    'production_thaw_schedules', 'production_pulp_flavors', 'production_pulp_entries',
    'production_product_aliases', 'production_imports'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.enforce_production_actor()',
      table_name || '_actor_guard', table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
  access_unit text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'production_plans', 'production_plan_entries',
    'production_delivery_windows', 'production_deliveries',
    'production_delivery_items', 'production_thaw_rules',
    'production_thaw_schedules', 'production_pulp_flavors',
    'production_pulp_entries', 'production_product_aliases',
    'production_imports', 'production_import_rows',
    'production_audit_events'
  ] LOOP
    access_unit := CASE
      WHEN table_name IN ('production_pulp_flavors', 'production_product_aliases')
        THEN 'NULL::uuid'
      ELSE 'unit_id'
    END;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.has_active_access(company_id, %s, NULL::public.profile_role[]))',
      table_name || '_select_active_members', table_name, access_unit
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'production_plans', 'production_deliveries',
    'production_delivery_items', 'production_thaw_schedules',
    'production_pulp_entries'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (private.has_active_access(company_id, unit_id, ARRAY[''admin'', ''stock_manager'', ''operator'', ''purchasing_approver'']::public.profile_role[])) WITH CHECK (private.has_active_access(company_id, unit_id, ARRAY[''admin'', ''stock_manager'', ''operator'', ''purchasing_approver'']::public.profile_role[]))',
      table_name || '_manage_operations', table_name
    );
    EXECUTE format('GRANT INSERT, UPDATE ON TABLE public.%I TO authenticated', table_name);
  END LOOP;

  EXECUTE $policy$CREATE POLICY production_plan_entries_manage_operations
    ON public.production_plan_entries FOR ALL TO authenticated
    USING (private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[]))
    WITH CHECK (
      private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[])
      AND (
        EXISTS (SELECT 1 FROM public.production_plans AS plan WHERE plan.id = plan_id AND plan.status <> 'finished')
        OR private.has_active_access(company_id, unit_id, ARRAY['admin']::public.profile_role[])
      )
    )$policy$;
  EXECUTE 'GRANT INSERT, UPDATE ON TABLE public.production_plan_entries TO authenticated';

  FOREACH table_name IN ARRAY ARRAY[
    'production_delivery_windows', 'production_thaw_rules',
    'production_pulp_flavors', 'production_product_aliases',
    'production_imports', 'production_import_rows'
  ] LOOP
    access_unit := CASE
      WHEN table_name IN ('production_pulp_flavors', 'production_product_aliases')
        THEN 'NULL::uuid'
      ELSE 'unit_id'
    END;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (private.has_active_access(company_id, %s, ARRAY[''admin'', ''stock_manager'']::public.profile_role[])) WITH CHECK (private.has_active_access(company_id, %s, ARRAY[''admin'', ''stock_manager'']::public.profile_role[]))',
      table_name || '_manage_configuration', table_name, access_unit, access_unit
    );
    EXECUTE format('GRANT INSERT, UPDATE ON TABLE public.%I TO authenticated', table_name);
  END LOOP;
END;
$$;

-- Calcula somente quando as unidades declaradas são dimensionalmente compatíveis.
CREATE OR REPLACE FUNCTION private.calculate_production_entry_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  numerator text;
  denominator text;
BEGIN
  IF NEW.manual_quantity IS NOT NULL AND length(trim(coalesce(NEW.manual_reason, ''))) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A quantity override requires a reason.';
  END IF;
  NEW.calculated_quantity := NULL;
  IF NEW.per_capita IS NULL OR NEW.volume IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.per_capita_unit IS NULL OR NEW.volume_unit IS NULL OR NEW.quantity_unit IS NULL THEN
    RETURN NEW;
  END IF;
  numerator := upper(trim(split_part(NEW.per_capita_unit, '/', 1)));
  denominator := upper(trim(split_part(NEW.per_capita_unit, '/', 2)));
  IF position('/' in NEW.per_capita_unit) = 0
     OR numerator <> upper(trim(NEW.quantity_unit))
     OR denominator <> upper(trim(NEW.volume_unit)) THEN
    RETURN NEW;
  END IF;
  NEW.calculated_quantity := NEW.per_capita * NEW.volume;
  RETURN NEW;
END;
$$;

CREATE TRIGGER production_plan_entries_calculate_quantity
  BEFORE INSERT OR UPDATE OF per_capita, per_capita_unit, volume, volume_unit, quantity_unit, manual_quantity, manual_reason
  ON public.production_plan_entries
  FOR EACH ROW EXECUTE FUNCTION private.calculate_production_entry_quantity();

ALTER TABLE public.production_plan_entries
  ADD COLUMN final_quantity numeric(18, 6)
  GENERATED ALWAYS AS (coalesce(manual_quantity, calculated_quantity)) STORED;

REVOKE ALL ON FUNCTION private.calculate_production_entry_quantity() FROM PUBLIC, anon, authenticated;

-- As alterações operacionais preservam ator, horário e snapshots anterior/novo.
CREATE OR REPLACE FUNCTION private.audit_production_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_data jsonb;
  v_before jsonb;
  v_after jsonb;
  v_company_id uuid;
  v_unit_id uuid;
  v_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_data := to_jsonb(NEW);
    v_after := v_data;
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_data := to_jsonb(NEW);
    v_after := v_data;
  ELSE
    v_data := to_jsonb(OLD);
    v_before := v_data;
  END IF;

  v_company_id := (v_data ->> 'company_id')::uuid;
  v_unit_id := nullif(v_data ->> 'unit_id', '')::uuid;
  v_id := (v_data ->> 'id')::uuid;

  INSERT INTO public.production_audit_events (
    company_id, unit_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) VALUES (
    v_company_id, v_unit_id, auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_id, v_before, v_after
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.audit_production_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER production_plans_audit
  AFTER INSERT OR UPDATE ON public.production_plans
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_plan_entries_audit
  AFTER INSERT OR UPDATE ON public.production_plan_entries
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_deliveries_audit
  AFTER INSERT OR UPDATE ON public.production_deliveries
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_delivery_items_audit
  AFTER INSERT OR UPDATE ON public.production_delivery_items
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_thaw_schedules_audit
  AFTER INSERT OR UPDATE ON public.production_thaw_schedules
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_pulp_entries_audit
  AFTER INSERT OR UPDATE ON public.production_pulp_entries
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_imports_audit
  AFTER INSERT OR UPDATE ON public.production_imports
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_delivery_windows_audit
  AFTER INSERT OR UPDATE ON public.production_delivery_windows
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_thaw_rules_audit
  AFTER INSERT OR UPDATE ON public.production_thaw_rules
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_pulp_flavors_audit
  AFTER INSERT OR UPDATE ON public.production_pulp_flavors
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();
CREATE TRIGGER production_product_aliases_audit
  AFTER INSERT OR UPDATE ON public.production_product_aliases
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();

CREATE OR REPLACE FUNCTION private.prevent_production_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Production audit events are append-only.';
END;
$$;

CREATE TRIGGER production_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.production_audit_events
  FOR EACH ROW EXECUTE FUNCTION private.prevent_production_audit_mutation();

-- Os arquivos fonte ficam privados e são endereçados por empresa/unidade/hash.
CREATE POLICY production_import_files_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'production-imports'
    AND EXISTS (
      SELECT 1 FROM public.units unit
      WHERE unit.id::text = split_part(name, '/', 2)
        AND unit.company_id::text = split_part(name, '/', 1)
        AND private.has_active_access(unit.company_id, unit.id, NULL::public.profile_role[])
    )
  );

CREATE POLICY production_import_files_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'production-imports'
    AND EXISTS (
      SELECT 1 FROM public.units unit
      WHERE unit.id::text = split_part(name, '/', 2)
        AND unit.company_id::text = split_part(name, '/', 1)
        AND private.has_active_access(unit.company_id, unit.id, ARRAY['admin', 'stock_manager']::public.profile_role[])
    )
  );

CREATE POLICY production_import_files_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'production-imports'
    AND EXISTS (
      SELECT 1 FROM public.units unit
      WHERE unit.id::text = split_part(name, '/', 2)
        AND unit.company_id::text = split_part(name, '/', 1)
        AND private.has_active_access(unit.company_id, unit.id, ARRAY['admin', 'stock_manager']::public.profile_role[])
    )
  )
  WITH CHECK (
    bucket_id = 'production-imports'
    AND EXISTS (
      SELECT 1 FROM public.units unit
      WHERE unit.id::text = split_part(name, '/', 2)
        AND unit.company_id::text = split_part(name, '/', 1)
        AND private.has_active_access(unit.company_id, unit.id, ARRAY['admin', 'stock_manager']::public.profile_role[])
    )
  );

CREATE POLICY production_import_files_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'production-imports'
    AND EXISTS (
      SELECT 1 FROM public.units unit
      WHERE unit.id::text = split_part(name, '/', 2)
        AND unit.company_id::text = split_part(name, '/', 1)
        AND private.has_active_access(unit.company_id, unit.id, ARRAY['admin', 'stock_manager']::public.profile_role[])
    )
  );

COMMIT;
