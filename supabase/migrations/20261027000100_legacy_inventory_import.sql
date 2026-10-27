BEGIN;

CREATE TABLE public.legacy_inventory_products (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  source_app text NOT NULL,
  source_product_id text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  source_payload jsonb NOT NULL CHECK (jsonb_typeof(source_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, unit_id, source_app, source_product_id),
  FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE public.legacy_stock_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  source_app text NOT NULL,
  source_withdrawal_id text NOT NULL,
  source_product_id text,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  occurred_at timestamptz,
  source_payload jsonb NOT NULL CHECK (jsonb_typeof(source_payload) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT,
  UNIQUE (company_id, unit_id, source_app, source_withdrawal_id)
);

CREATE INDEX legacy_stock_withdrawals_scope_date_idx
  ON public.legacy_stock_withdrawals (company_id, unit_id, occurred_at DESC);
CREATE INDEX legacy_stock_withdrawals_product_idx
  ON public.legacy_stock_withdrawals (company_id, unit_id, product_id);

ALTER TABLE public.legacy_inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_stock_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY legacy_inventory_products_select_active_members
  ON public.legacy_inventory_products FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, unit_id, NULL::public.profile_role[]));
CREATE POLICY legacy_stock_withdrawals_select_active_members
  ON public.legacy_stock_withdrawals FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, unit_id, NULL::public.profile_role[]));

REVOKE ALL ON public.legacy_inventory_products, public.legacy_stock_withdrawals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.legacy_inventory_products, public.legacy_stock_withdrawals TO authenticated;
GRANT ALL ON public.legacy_inventory_products, public.legacy_stock_withdrawals TO service_role;

COMMENT ON TABLE public.legacy_inventory_products IS
  'Immutable source snapshots and non-destructive product links imported from the almox-hgrs export. No stock quantities are implied.';
COMMENT ON TABLE public.legacy_stock_withdrawals IS
  'Historical withdrawal snapshots imported from almox-hgrs. These rows are informational and do not affect stock balances.';

COMMIT;
