-- Manual first-admin bootstrap. Run only in the Supabase SQL Editor after
-- inviting/creating the administrator in Authentication > Users.
-- Replace both placeholder strings before execution. This script creates or
-- reuses the LBGS / HGRS organization scope and aborts if a profile already
-- exists for that Auth user.
DO $bootstrap$
DECLARE
  v_email text := lower(trim('ADMIN_EMAIL_HERE'));
  v_full_name text := trim('ADMIN_FULL_NAME_HERE');
  v_user_id uuid;
  v_company_id uuid;
  v_unit_id uuid;
BEGIN
  IF v_email IN ('', 'admin_email_here') OR v_full_name IN ('', 'admin_full_name_here') THEN
    RAISE EXCEPTION 'Replace the administrator email and full name placeholders first.';
  END IF;

  SELECT id INTO STRICT v_user_id
  FROM auth.users
  WHERE lower(email) = v_email;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'This Auth user already has a profile; inspect it before bootstrapping.';
  END IF;

  SELECT id INTO v_company_id FROM public.companies WHERE name = 'LBGS';
  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (name) VALUES ('LBGS') RETURNING id INTO v_company_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_company_id AND status = 'active') THEN
    RAISE EXCEPTION 'The existing LBGS company is inactive; resolve it before bootstrap.';
  END IF;

  SELECT id INTO v_unit_id FROM public.units WHERE company_id = v_company_id AND code = 'HGRS';
  IF v_unit_id IS NULL THEN
    INSERT INTO public.units (company_id, name, code)
    VALUES (v_company_id, 'Hospital Geral Roberto Santos', 'HGRS')
    RETURNING id INTO v_unit_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.units WHERE id = v_unit_id AND status = 'active') THEN
    RAISE EXCEPTION 'The existing HGRS unit is inactive; resolve it before bootstrap.';
  END IF;

  INSERT INTO public.profiles (user_id, company_id, unit_id, full_name, role, status)
  VALUES (v_user_id, v_company_id, v_unit_id, v_full_name, 'admin', 'active');
END;
$bootstrap$;
