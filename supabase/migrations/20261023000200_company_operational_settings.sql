BEGIN;

CREATE TABLE IF NOT EXISTS public.company_operational_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE RESTRICT,
  service_labels jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(service_labels) = 'object'),
  exit_type_labels jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(exit_type_labels) = 'object'),
  service_time_rules jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(service_time_rules) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.company_operational_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_operational_settings_select ON public.company_operational_settings;
CREATE POLICY company_operational_settings_select ON public.company_operational_settings
  FOR SELECT TO authenticated USING (private.has_active_access(company_id, NULL, NULL));
DROP POLICY IF EXISTS company_operational_settings_insert ON public.company_operational_settings;
CREATE POLICY company_operational_settings_insert ON public.company_operational_settings
  FOR INSERT TO authenticated WITH CHECK (
    private.has_active_access(company_id, NULL, ARRAY['admin']::public.profile_role[])
    AND updated_by = (SELECT auth.uid())
  );
DROP POLICY IF EXISTS company_operational_settings_update ON public.company_operational_settings;
CREATE POLICY company_operational_settings_update ON public.company_operational_settings
  FOR UPDATE TO authenticated USING (
    private.has_active_access(company_id, NULL, ARRAY['admin']::public.profile_role[])
  ) WITH CHECK (
    private.has_active_access(company_id, NULL, ARRAY['admin']::public.profile_role[])
    AND updated_by = (SELECT auth.uid())
  );
GRANT SELECT, INSERT, UPDATE ON public.company_operational_settings TO authenticated;
GRANT ALL ON public.company_operational_settings TO service_role;
COMMENT ON TABLE public.company_operational_settings IS
  'Admin-managed labels and service time suggestion rules; stored operational codes remain fixed.';
COMMIT;
