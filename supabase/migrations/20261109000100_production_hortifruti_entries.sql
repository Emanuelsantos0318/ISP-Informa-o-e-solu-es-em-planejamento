BEGIN;

-- Lançamentos de Hortifruti ficam separados de proteínas e polpas.
-- Quantidade e unidade são informadas explicitamente; não há conversão presumida.
CREATE TABLE public.production_hortifruti_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  consumption_date date NOT NULL,
  audience_code text NOT NULL CHECK (audience_code IN ('patient', 'server')),
  service_code text NOT NULL CHECK (service_code IN ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper')),
  product_id uuid,
  original_product_text text,
  quantity numeric(18, 6) NOT NULL CHECK (quantity >= 0),
  quantity_unit text NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_hortifruti_entries_plan_scope_fkey
    FOREIGN KEY (plan_id, company_id, unit_id)
    REFERENCES public.production_plans(id, company_id, unit_id) ON DELETE RESTRICT,
  CONSTRAINT production_hortifruti_entries_product_scope_fkey
    FOREIGN KEY (product_id, company_id)
    REFERENCES public.products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_hortifruti_entries_product_check
    CHECK (product_id IS NOT NULL OR length(trim(coalesce(original_product_text, ''))) BETWEEN 1 AND 200),
  CONSTRAINT production_hortifruti_entries_unit_check
    CHECK (length(trim(quantity_unit)) BETWEEN 1 AND 30),
  CONSTRAINT production_hortifruti_entries_notes_check
    CHECK (notes IS NULL OR length(notes) <= 500)
);

CREATE INDEX production_hortifruti_entries_plan_date_idx
  ON public.production_hortifruti_entries (company_id, unit_id, plan_id, consumption_date, created_at);
CREATE INDEX production_hortifruti_entries_product_idx
  ON public.production_hortifruti_entries (company_id, unit_id, product_id, consumption_date);

ALTER TABLE public.production_hortifruti_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.production_hortifruti_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.production_hortifruti_entries TO authenticated;
GRANT ALL ON TABLE public.production_hortifruti_entries TO service_role;

CREATE POLICY production_hortifruti_entries_select_active_members
  ON public.production_hortifruti_entries FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, unit_id, NULL::public.profile_role[]));

CREATE POLICY production_hortifruti_entries_manage_operations
  ON public.production_hortifruti_entries FOR ALL TO authenticated
  USING (
    private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[])
    AND (
      EXISTS (SELECT 1 FROM public.production_plans AS plan WHERE plan.id = plan_id AND plan.status <> 'finished')
      OR private.has_active_access(company_id, unit_id, ARRAY['admin']::public.profile_role[])
    )
  )
  WITH CHECK (
    private.has_active_access(company_id, unit_id, ARRAY['admin', 'stock_manager', 'operator', 'purchasing_approver']::public.profile_role[])
    AND (
      EXISTS (SELECT 1 FROM public.production_plans AS plan WHERE plan.id = plan_id AND plan.status <> 'finished')
      OR private.has_active_access(company_id, unit_id, ARRAY['admin']::public.profile_role[])
    )
  );

CREATE TRIGGER production_hortifruti_entries_actor_guard
  BEFORE INSERT OR UPDATE ON public.production_hortifruti_entries
  FOR EACH ROW EXECUTE FUNCTION private.enforce_production_actor();
CREATE TRIGGER production_hortifruti_entries_audit
  AFTER INSERT OR UPDATE ON public.production_hortifruti_entries
  FOR EACH ROW EXECUTE FUNCTION private.audit_production_change();

COMMENT ON TABLE public.production_hortifruti_entries IS
  'Planejamento de Hortifruti por data, público, serviço, produto e unidade explícita. Não movimenta estoque.';

COMMIT;
