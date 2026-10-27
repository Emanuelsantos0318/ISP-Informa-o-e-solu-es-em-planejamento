BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_path text,
  ADD COLUMN IF NOT EXISTS theme_preference text NOT NULL DEFAULT 'light'
    CHECK (theme_preference IN ('light', 'dark'));

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS trade_name text,
  ADD COLUMN IF NOT EXISTS state_registration text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS postal_code text;

CREATE OR REPLACE FUNCTION private.valid_cnpj(p_cnpj text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE
  v_number text := regexp_replace(p_cnpj, '\D', '', 'g');
  v_sum integer := 0;
  v_digit integer;
  v_remainder integer;
  v_weights integer[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  i integer;
BEGIN
  IF length(v_number) <> 14 OR v_number = repeat(substring(v_number, 1, 1), 14) THEN RETURN false; END IF;
  FOR i IN 1..12 LOOP v_sum := v_sum + substring(v_number, i, 1)::integer * v_weights[i]; END LOOP;
  v_remainder := v_sum % 11;
  v_digit := CASE WHEN v_remainder < 2 THEN 0 ELSE 11 - v_remainder END;
  IF substring(v_number, 13, 1)::integer <> v_digit THEN RETURN false; END IF;
  v_sum := 0;
  v_weights := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
  FOR i IN 1..13 LOOP v_sum := v_sum + substring(v_number, i, 1)::integer * v_weights[i]; END LOOP;
  v_remainder := v_sum % 11;
  v_digit := CASE WHEN v_remainder < 2 THEN 0 ELSE 11 - v_remainder END;
  RETURN substring(v_number, 14, 1)::integer = v_digit;
END;
$$;

REVOKE ALL ON FUNCTION private.valid_cnpj(text) FROM PUBLIC, anon, authenticated;

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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company_id uuid;
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role public.profile_role;
  v_batch_id uuid;
  v_count integer;
  v_replayed boolean;
  v_supplier_id uuid := p_supplier_id;
  v_new_supplier jsonb := p_invoice->'new_supplier';
  v_new_supplier_name text := nullif(trim(p_invoice->'new_supplier'->>'name'), '');
  v_draft_cnpj text := nullif(regexp_replace(coalesce(p_invoice->'new_supplier'->>'cnpj', ''), '\D', '', 'g'), '');
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
  IF v_actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required.'; END IF;
  IF jsonb_typeof(p_invoice) IS DISTINCT FROM 'object' OR v_invoice_number IS NULL OR v_series IS NULL
     OR v_text IS NULL OR length(v_text) NOT BETWEEN 1 AND 300000
     OR (v_access_key IS NOT NULL AND v_access_key !~ '^\d{44}$')
     OR (v_cnpj IS NOT NULL AND NOT private.valid_cnpj(v_cnpj))
     OR (v_total IS NOT NULL AND v_total < 0)
     OR jsonb_typeof(v_parsed) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invoice data is incomplete or invalid.';
  END IF;

  SELECT unit.company_id INTO v_company_id FROM public.units AS unit
  WHERE unit.id = p_unit_id AND unit.status = 'active';
  IF NOT FOUND OR NOT private.has_active_access(v_company_id, p_unit_id,
      ARRAY['admin','stock_manager','operator']::public.profile_role[]) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized to record stock movements in this scope.';
  END IF;
  SELECT role INTO v_actor_role FROM public.profiles
  WHERE user_id = v_actor_id AND company_id = v_company_id AND status = 'active';

  IF v_supplier_id IS NULL THEN
    IF jsonb_typeof(v_new_supplier) IS DISTINCT FROM 'object'
       OR v_new_supplier_name IS NULL OR length(v_new_supplier_name) NOT BETWEEN 2 AND 180
       OR (v_cnpj IS NOT NULL AND NOT private.valid_cnpj(v_cnpj))
       OR v_draft_cnpj IS DISTINCT FROM v_cnpj
       OR length(coalesce(v_new_supplier->>'tradeName', '')) > 150
       OR length(coalesce(v_new_supplier->>'stateRegistration', '')) > 24
       OR length(coalesce(v_new_supplier->>'address', '')) > 250
       OR length(coalesce(v_new_supplier->>'city', '')) > 100
       OR (nullif(trim(v_new_supplier->>'state'), '') IS NOT NULL AND upper(trim(v_new_supplier->>'state')) !~ '^[A-Z]{2}$')
       OR (nullif(regexp_replace(coalesce(v_new_supplier->>'postalCode', ''), '\D', '', 'g'), '') IS NOT NULL
           AND length(regexp_replace(v_new_supplier->>'postalCode', '\D', '', 'g')) <> 8)
       OR length(coalesce(v_new_supplier->>'phone', '')) > 30
       OR (nullif(trim(v_new_supplier->>'email'), '') IS NOT NULL
           AND (length(trim(v_new_supplier->>'email')) > 254 OR trim(v_new_supplier->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Supplier data is incomplete or invalid.';
    END IF;
    IF v_actor_role NOT IN ('admin','stock_manager','super_admin') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only an administrator or stock manager can register a new supplier.';
    END IF;
    IF v_cnpj IS NOT NULL THEN
      SELECT id INTO v_supplier_id FROM public.suppliers
      WHERE company_id = v_company_id AND cnpj = v_cnpj AND status = 'active';
    ELSE
      SELECT id INTO v_supplier_id FROM public.suppliers
      WHERE company_id = v_company_id AND name = v_new_supplier_name AND status = 'active';
    END IF;
    IF v_supplier_id IS NULL THEN
      BEGIN
        INSERT INTO public.suppliers(
          company_id, name, cnpj, trade_name, state_registration, address, city, state,
          postal_code, phone, email, status
        ) VALUES (
          v_company_id, v_new_supplier_name, v_cnpj,
          nullif(trim(v_new_supplier->>'tradeName'), ''),
          nullif(trim(v_new_supplier->>'stateRegistration'), ''),
          nullif(trim(v_new_supplier->>'address'), ''),
          nullif(trim(v_new_supplier->>'city'), ''),
          nullif(upper(trim(v_new_supplier->>'state')), ''),
          nullif(regexp_replace(coalesce(v_new_supplier->>'postalCode', ''), '\D', '', 'g'), ''),
          nullif(trim(v_new_supplier->>'phone'), ''),
          nullif(lower(trim(v_new_supplier->>'email')), ''), 'active'
        ) RETURNING id INTO v_supplier_id;
        INSERT INTO public.audit_logs(company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
        VALUES (v_company_id, p_unit_id, v_actor_id, 'supplier_created_from_invoice', 'supplier', v_supplier_id,
          jsonb_build_object('cnpj', v_cnpj, 'invoice_number', v_invoice_number, 'series', v_series));
      EXCEPTION WHEN unique_violation THEN
        IF v_cnpj IS NOT NULL THEN
          SELECT id INTO v_supplier_id FROM public.suppliers
          WHERE company_id = v_company_id AND cnpj = v_cnpj AND status = 'active';
        ELSE
          SELECT id INTO v_supplier_id FROM public.suppliers
          WHERE company_id = v_company_id AND name = v_new_supplier_name AND status = 'active';
        END IF;
        IF v_supplier_id IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'A supplier with this name already exists with different tax details. Select the registered supplier.';
        END IF;
      END;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.suppliers
      WHERE id = v_supplier_id AND company_id = v_company_id AND status = 'active') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Select an active supplier before confirming the invoice.';
  END IF;
  IF v_cnpj IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.suppliers WHERE id = v_supplier_id AND cnpj IS NOT NULL AND cnpj <> v_cnpj
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The selected supplier CNPJ differs from the invoice issuer.';
  END IF;

  SELECT result.batch_id, result.movement_count, result.replayed INTO v_batch_id, v_count, v_replayed
  FROM public.record_stock_movement_batch(
    p_unit_id, 'entry'::public.stock_movement_type, p_operational_at,
    p_idempotency_key, p_items, NULL, NULL, v_supplier_id, p_source_reference, p_note
  ) AS result;

  IF v_replayed THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_invoice_documents AS invoice
      WHERE invoice.batch_id = v_batch_id AND invoice.supplier_id = v_supplier_id
        AND invoice.access_key IS NOT DISTINCT FROM v_access_key
        AND invoice.invoice_number = v_invoice_number AND invoice.series = v_series
        AND invoice.issue_date IS NOT DISTINCT FROM v_issue_date
        AND invoice.supplier_cnpj IS NOT DISTINCT FROM v_cnpj
        AND invoice.invoice_total IS NOT DISTINCT FROM v_total
        AND invoice.extracted_text = v_text AND invoice.parsed_data = v_parsed
    ) THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Idempotency key was already used without the same invoice.'; END IF;
  ELSE
    BEGIN
      INSERT INTO public.stock_invoice_documents(
        company_id, unit_id, batch_id, supplier_id, access_key, invoice_number, series,
        issue_date, supplier_cnpj, invoice_total, extracted_text, parsed_data, created_by
      ) VALUES (
        v_company_id, p_unit_id, v_batch_id, v_supplier_id, v_access_key, v_invoice_number,
        v_series, v_issue_date, v_cnpj, v_total, v_text, v_parsed, v_actor_id
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'This invoice has already been recorded.';
    END;
    INSERT INTO public.audit_logs(company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_company_id, p_unit_id, v_actor_id, 'stock_invoice_registered', 'stock_invoice_document', v_batch_id,
      jsonb_build_object('invoice_number', v_invoice_number, 'series', v_series, 'has_access_key', v_access_key IS NOT NULL));
  END IF;
  RETURN QUERY SELECT v_batch_id, v_count, v_replayed;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_invoice_movement_batch(uuid,timestamptz,uuid,jsonb,uuid,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_invoice_movement_batch(uuid,timestamptz,uuid,jsonb,uuid,text,text,jsonb) TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS units_company_code_ci_unique
  ON public.units (company_id, lower(code));

CREATE OR REPLACE FUNCTION private.can_manage_profile(
  p_company_id uuid,
  p_target_unit_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS manager
    JOIN public.companies AS company ON company.id = manager.company_id
    WHERE manager.user_id = (SELECT auth.uid())
      AND manager.company_id = p_company_id
      AND manager.role IN ('admin', 'super_admin')
      AND manager.status = 'active'
      AND company.status = 'active'
      AND (manager.role = 'super_admin' OR manager.unit_id IS NULL OR manager.unit_id = p_target_unit_id)
      AND (
        p_target_unit_id IS NULL OR EXISTS (
          SELECT 1 FROM public.units AS target_unit
          WHERE target_unit.id = p_target_unit_id
            AND target_unit.company_id = p_company_id
            AND target_unit.status = 'active'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.has_active_access(
  p_company_id uuid,
  p_unit_id uuid DEFAULT NULL,
  p_allowed_roles public.profile_role[] DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    JOIN public.companies AS company ON company.id = profile.company_id
    WHERE profile.user_id = (SELECT auth.uid())
      AND profile.company_id = p_company_id
      AND profile.status = 'active'
      AND company.status = 'active'
      AND (profile.role = 'super_admin' OR p_allowed_roles IS NULL OR profile.role = ANY(p_allowed_roles))
      AND (p_unit_id IS NULL OR profile.role = 'super_admin' OR profile.unit_id IS NULL OR profile.unit_id = p_unit_id)
      AND (
        profile.role = 'super_admin' OR profile.unit_id IS NULL OR EXISTS (
          SELECT 1 FROM public.units AS assigned_unit
          WHERE assigned_unit.id = profile.unit_id
            AND assigned_unit.company_id = profile.company_id
            AND assigned_unit.status = 'active'
        )
      )
      AND (
        p_unit_id IS NULL OR profile.role = 'super_admin' OR EXISTS (
          SELECT 1 FROM public.units AS requested_unit
          WHERE requested_unit.id = p_unit_id
            AND requested_unit.company_id = p_company_id
            AND requested_unit.status = 'active'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_profile(
  p_user_id uuid,
  p_company_id uuid,
  p_unit_id uuid,
  p_full_name text,
  p_role public.profile_role,
  p_status public.record_status DEFAULT 'active'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_company_id uuid;
  v_old_role public.profile_role;
  v_old_status public.record_status;
  v_actor_role public.profile_role;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles
  WHERE user_id = (SELECT auth.uid()) AND company_id = p_company_id AND status = 'active';
  IF v_actor_role NOT IN ('admin', 'super_admin') OR NOT private.can_manage_profile(p_company_id, p_unit_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized to manage profiles in this scope.';
  END IF;
  IF p_user_id = (SELECT auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Administrators cannot change their own profile.';
  END IF;
  IF p_role = 'super_admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Super administrator promotion requires the controlled bootstrap procedure.';
  END IF;
  IF p_full_name IS NULL OR length(trim(p_full_name)) NOT BETWEEN 1 AND 160
     OR p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid profile data.';
  END IF;
  IF p_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.units WHERE id = p_unit_id AND company_id = p_company_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Select an active unit in this company.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The Auth user does not exist.';
  END IF;
  SELECT company_id, role, status INTO v_old_company_id, v_old_role, v_old_status
  FROM public.profiles WHERE user_id = p_user_id FOR UPDATE;
  IF FOUND AND v_old_company_id <> p_company_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'A profile cannot be moved to another company.';
  END IF;
  IF FOUND THEN
    UPDATE public.profiles SET unit_id = p_unit_id, full_name = trim(p_full_name), role = p_role,
      status = p_status, updated_at = now() WHERE user_id = p_user_id;
  ELSE
    INSERT INTO public.profiles(user_id, company_id, unit_id, full_name, role, status)
    VALUES (p_user_id, p_company_id, p_unit_id, trim(p_full_name), p_role, p_status);
  END IF;
  INSERT INTO public.audit_logs(company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_company_id, p_unit_id, (SELECT auth.uid()),
    CASE WHEN v_old_role IS NULL THEN 'profile_assigned' ELSE 'profile_updated' END,
    'profile', p_user_id, jsonb_build_object('old_role', v_old_role, 'new_role', p_role,
      'old_status', v_old_status, 'new_status', p_status));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_operational_unit(p_name text, p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_company_id uuid; v_unit_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles
  WHERE user_id = (SELECT auth.uid()) AND role = 'super_admin' AND status = 'active' AND unit_id IS NULL;
  IF v_company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = v_company_id AND status = 'active'
  ) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Super administrator access required.'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 160
     OR p_code IS NULL OR length(trim(p_code)) NOT BETWEEN 1 AND 40
     OR trim(p_code) !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Enter a valid unit name and code.';
  END IF;
  INSERT INTO public.units(company_id, name, code)
  VALUES (v_company_id, trim(p_name), upper(trim(p_code))) RETURNING id INTO v_unit_id;
  INSERT INTO public.audit_logs(company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_company_id, v_unit_id, (SELECT auth.uid()), 'unit_created', 'unit', v_unit_id,
    jsonb_build_object('name', trim(p_name), 'code', upper(trim(p_code))));
  RETURN v_unit_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_operational_unit(
  p_unit_id uuid, p_name text, p_code text, p_status public.record_status
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_company_id uuid; v_old_status public.record_status;
BEGIN
  SELECT company_id, status INTO v_company_id, v_old_status FROM public.units
  WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = (SELECT auth.uid())
      AND company_id = v_company_id AND role = 'super_admin' AND status = 'active' AND unit_id IS NULL
  ) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Super administrator access required.'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 160
     OR p_code IS NULL OR length(trim(p_code)) NOT BETWEEN 1 AND 40
     OR trim(p_code) !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' OR p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid unit data.';
  END IF;
  UPDATE public.units SET name = trim(p_name), code = upper(trim(p_code)), status = p_status, updated_at = now()
  WHERE id = p_unit_id;
  INSERT INTO public.audit_logs(company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_company_id, p_unit_id, (SELECT auth.uid()), 'unit_updated', 'unit', p_unit_id,
    jsonb_build_object('name', trim(p_name), 'code', upper(trim(p_code)), 'old_status', v_old_status, 'new_status', p_status));
END;
$$;

CREATE OR REPLACE FUNCTION public.update_own_profile(p_full_name text, p_avatar_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL OR p_full_name IS NULL OR length(trim(p_full_name)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Enter a valid full name.';
  END IF;
  IF p_avatar_path IS NOT NULL AND (p_avatar_path !~ ('^' || v_user_id::text || '/[A-Za-z0-9._-]+$')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invalid profile photo path.';
  END IF;
  UPDATE public.profiles SET full_name = trim(p_full_name), avatar_path = p_avatar_path, updated_at = now()
  WHERE user_id = v_user_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active profile required.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_own_theme_preference(p_theme text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_theme NOT IN ('light', 'dark') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid theme.'; END IF;
  UPDATE public.profiles SET theme_preference = p_theme, updated_at = now()
  WHERE user_id = (SELECT auth.uid()) AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Active profile required.'; END IF;
END;
$$;

DROP POLICY IF EXISTS units_manage_super_admin ON public.units;
CREATE POLICY units_manage_super_admin ON public.units TO authenticated
  USING (private.has_active_access(company_id, NULL, ARRAY['super_admin']::public.profile_role[]))
  WITH CHECK (private.has_active_access(company_id, NULL, ARRAY['super_admin']::public.profile_role[]));

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('isp-profile-photos', 'isp-profile-photos', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

DROP POLICY IF EXISTS profile_photos_select_own ON storage.objects;
CREATE POLICY profile_photos_select_own ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'isp-profile-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS profile_photos_insert_own ON storage.objects;
CREATE POLICY profile_photos_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'isp-profile-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS profile_photos_update_own ON storage.objects;
CREATE POLICY profile_photos_update_own ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'isp-profile-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'isp-profile-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS profile_photos_delete_own ON storage.objects;
CREATE POLICY profile_photos_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'isp-profile-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

REVOKE ALL ON FUNCTION public.create_operational_unit(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_operational_unit(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_operational_unit(uuid, text, text, public.record_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_operational_unit(uuid, text, text, public.record_status) TO authenticated;
REVOKE ALL ON FUNCTION public.update_own_profile(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.set_own_theme_preference(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_own_theme_preference(text) TO authenticated;

COMMIT;
