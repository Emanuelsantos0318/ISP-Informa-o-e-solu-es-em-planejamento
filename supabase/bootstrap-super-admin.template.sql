-- Execute manually in Supabase SQL Editor after reviewing the target account.
-- Replace the UUID with the Auth user ID of an existing active ISP administrator.
DO $bootstrap$
DECLARE
  v_user_id uuid := '00000000-0000-0000-0000-000000000000'; -- replace
  v_company_id uuid;
  v_old_role public.profile_role;
BEGIN
  SELECT company_id, role INTO STRICT v_company_id, v_old_role
  FROM public.profiles
  WHERE user_id = v_user_id AND status = 'active';

  IF v_old_role <> 'admin' THEN
    RAISE EXCEPTION 'The selected account must be an active admin before promotion.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'The selected Auth user does not exist.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
    RAISE EXCEPTION 'This account is already a super administrator.';
  END IF;

  UPDATE public.profiles SET role = 'super_admin', unit_id = NULL, updated_at = now()
  WHERE user_id = v_user_id AND company_id = v_company_id;

  INSERT INTO public.audit_logs(company_id, unit_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_company_id, NULL, NULL, 'super_admin_bootstrapped', 'profile', v_user_id,
    jsonb_build_object('target_user_id', v_user_id, 'previous_role', v_old_role, 'new_role', 'super_admin'));
END;
$bootstrap$;
