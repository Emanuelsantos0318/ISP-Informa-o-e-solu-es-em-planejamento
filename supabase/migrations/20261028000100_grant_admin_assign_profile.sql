-- The profile assignment function was created after default PUBLIC execution
-- grants were tightened. The admin Edge Functions call it as authenticated.
BEGIN;

REVOKE ALL ON FUNCTION public.admin_assign_profile(
  uuid,
  uuid,
  uuid,
  text,
  public.profile_role,
  public.record_status
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_assign_profile(
  uuid,
  uuid,
  uuid,
  text,
  public.profile_role,
  public.record_status
) TO authenticated;

COMMIT;
