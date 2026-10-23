-- Persist company-wide stock and expiry thresholds with role-based access.
BEGIN;

CREATE TABLE IF NOT EXISTS public.company_stock_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE RESTRICT,
  critical_stock_ratio numeric(5,4) NOT NULL DEFAULT 0.5000
    CHECK (critical_stock_ratio >= 0 AND critical_stock_ratio <= 1),
  expiry_warning_days smallint NOT NULL DEFAULT 30
    CHECK (expiry_warning_days >= 0 AND expiry_warning_days <= 365),
  min_history_days smallint NOT NULL DEFAULT 7
    CHECK (min_history_days >= 1 AND min_history_days <= 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.company_stock_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_stock_settings_select ON public.company_stock_settings;
CREATE POLICY company_stock_settings_select
  ON public.company_stock_settings
  FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, NULL, NULL));

DROP POLICY IF EXISTS company_stock_settings_insert ON public.company_stock_settings;
CREATE POLICY company_stock_settings_insert
  ON public.company_stock_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_active_access(
      company_id,
      NULL,
      ARRAY['admin', 'stock_manager']::public.profile_role[]
    )
    AND updated_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS company_stock_settings_update ON public.company_stock_settings;
CREATE POLICY company_stock_settings_update
  ON public.company_stock_settings
  FOR UPDATE TO authenticated
  USING (
    private.has_active_access(
      company_id,
      NULL,
      ARRAY['admin', 'stock_manager']::public.profile_role[]
    )
  )
  WITH CHECK (
    private.has_active_access(
      company_id,
      NULL,
      ARRAY['admin', 'stock_manager']::public.profile_role[]
    )
    AND updated_by = (SELECT auth.uid())
  );

GRANT SELECT, INSERT, UPDATE ON public.company_stock_settings TO authenticated;
GRANT ALL ON public.company_stock_settings TO service_role;

COMMENT ON TABLE public.company_stock_settings IS
  'Company-level thresholds used by stock, expiry, and consumption rules.';

COMMIT;
