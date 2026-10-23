-- Run once in Supabase SQL Editor after confirming this Auth user belongs to ISP.
-- Replace ADMIN_FULL_NAME_HERE with the user's real full name before execution.
DO $bootstrap$
DECLARE
  v_user_id uuid := 'a37f4d3f-6e71-4953-9a54-7c86a75e1bc0';
  v_full_name text := trim('ADMIN_FULL_NAME_HERE');
  v_company_id uuid;
  v_unit_id uuid;
BEGIN
  IF v_full_name IN ('', 'admin_full_name_here') THEN
    RAISE EXCEPTION 'Replace ADMIN_FULL_NAME_HERE with the administrator full name.';
  END IF;

  PERFORM 1 FROM auth.users WHERE id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The supplied Auth user ID was not found.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'This Auth user already has a profile; inspect it before bootstrapping.';
  END IF;

  SELECT id INTO v_company_id FROM public.companies WHERE name = 'LBGS';
  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (name) VALUES ('LBGS') RETURNING id INTO v_company_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = v_company_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'The existing LBGS company is inactive; resolve it before bootstrap.';
  END IF;

  SELECT id INTO v_unit_id
  FROM public.units
  WHERE company_id = v_company_id AND code = 'HGRS';
  IF v_unit_id IS NULL THEN
    INSERT INTO public.units (company_id, name, code)
    VALUES (v_company_id, 'Hospital Geral Roberto Santos', 'HGRS')
    RETURNING id INTO v_unit_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.units WHERE id = v_unit_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'The existing HGRS unit is inactive; resolve it before bootstrap.';
  END IF;

  INSERT INTO public.profiles (user_id, company_id, unit_id, full_name, role, status)
  VALUES (v_user_id, v_company_id, v_unit_id, v_full_name, 'admin', 'active');
END;
$bootstrap$;
