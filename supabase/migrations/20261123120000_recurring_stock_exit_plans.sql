BEGIN;

CREATE TABLE public.stock_exit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  recipient text NOT NULL CHECK (length(trim(recipient)) BETWEEN 1 AND 120),
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency = 'daily'),
  status public.record_status NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_exit_plans_unit_scope_fkey
    FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT stock_exit_plans_scope_key UNIQUE (id, company_id, unit_id),
  CONSTRAINT stock_exit_plans_name_scope_key UNIQUE (company_id, unit_id, name)
);

CREATE TABLE public.stock_exit_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_name_snapshot text NOT NULL CHECK (length(trim(product_name_snapshot)) BETWEEN 1 AND 200),
  unit_of_measure_snapshot text NOT NULL CHECK (length(trim(unit_of_measure_snapshot)) BETWEEN 1 AND 30),
  planned_quantity numeric(18, 3) NOT NULL CHECK (planned_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_exit_plan_items_plan_scope_fkey
    FOREIGN KEY (plan_id, company_id, unit_id)
    REFERENCES public.stock_exit_plans(id, company_id, unit_id) ON DELETE CASCADE,
  CONSTRAINT stock_exit_plan_items_product_scope_fkey
    FOREIGN KEY (product_id, company_id) REFERENCES public.products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT stock_exit_plan_items_plan_product_key UNIQUE (plan_id, product_id)
);

CREATE INDEX stock_exit_plans_unit_status_name_idx
  ON public.stock_exit_plans (company_id, unit_id, status, name);
CREATE INDEX stock_exit_plan_items_plan_idx
  ON public.stock_exit_plan_items (plan_id, product_id);

ALTER TABLE public.stock_exit_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_exit_plan_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_exit_plans, public.stock_exit_plan_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stock_exit_plans, public.stock_exit_plan_items TO authenticated;
GRANT ALL ON public.stock_exit_plans, public.stock_exit_plan_items TO service_role;

CREATE POLICY stock_exit_plans_select_scope
  ON public.stock_exit_plans FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, unit_id, NULL::public.profile_role[]));
CREATE POLICY stock_exit_plan_items_select_scope
  ON public.stock_exit_plan_items FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, unit_id, NULL::public.profile_role[]));

-- O histórico guarda um retrato do planejamento e não muda quando o modelo é editado.
CREATE TABLE public.stock_exit_plan_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  batch_id uuid NOT NULL UNIQUE,
  plan_id uuid NOT NULL,
  plan_name_snapshot text NOT NULL CHECK (length(trim(plan_name_snapshot)) BETWEEN 1 AND 160),
  planned_recipient_snapshot text NOT NULL CHECK (length(trim(planned_recipient_snapshot)) BETWEEN 1 AND 120),
  actual_recipient text NOT NULL CHECK (length(trim(actual_recipient)) BETWEEN 1 AND 120),
  performed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  performed_by_name_snapshot text NOT NULL CHECK (length(trim(performed_by_name_snapshot)) BETWEEN 1 AND 160),
  used_at timestamptz NOT NULL,
  CONSTRAINT stock_exit_plan_usages_batch_scope_fkey
    FOREIGN KEY (batch_id, company_id, unit_id)
    REFERENCES public.stock_movement_batches(id, company_id, unit_id) ON DELETE RESTRICT,
  CONSTRAINT stock_exit_plan_usages_plan_scope_fkey
    FOREIGN KEY (plan_id, company_id, unit_id)
    REFERENCES public.stock_exit_plans(id, company_id, unit_id) ON DELETE RESTRICT
);

CREATE TABLE public.stock_exit_plan_usage_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_id uuid NOT NULL REFERENCES public.stock_exit_plan_usages(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL CHECK (length(trim(product_name_snapshot)) BETWEEN 1 AND 200),
  unit_of_measure_snapshot text NOT NULL CHECK (length(trim(unit_of_measure_snapshot)) BETWEEN 1 AND 30),
  planned_quantity numeric(18, 3) NOT NULL CHECK (planned_quantity >= 0),
  actual_quantity numeric(18, 3) NOT NULL CHECK (actual_quantity >= 0),
  CHECK (planned_quantity > 0 OR actual_quantity > 0),
  UNIQUE (usage_id, product_id)
);

CREATE INDEX stock_exit_plan_usages_scope_date_idx
  ON public.stock_exit_plan_usages (company_id, unit_id, used_at DESC);
CREATE INDEX stock_exit_plan_usage_items_usage_idx
  ON public.stock_exit_plan_usage_items (usage_id, product_id);

ALTER TABLE public.stock_exit_plan_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_exit_plan_usage_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_exit_plan_usages, public.stock_exit_plan_usage_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stock_exit_plan_usages, public.stock_exit_plan_usage_items TO authenticated;
GRANT ALL ON public.stock_exit_plan_usages, public.stock_exit_plan_usage_items TO service_role;

CREATE POLICY stock_exit_plan_usages_select_scope
  ON public.stock_exit_plan_usages FOR SELECT TO authenticated
  USING (private.has_active_access(company_id, unit_id, NULL::public.profile_role[]));
CREATE POLICY stock_exit_plan_usage_items_select_scope
  ON public.stock_exit_plan_usage_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stock_exit_plan_usages AS usage
    WHERE usage.id = usage_id
      AND private.has_active_access(usage.company_id, usage.unit_id, NULL::public.profile_role[])
  ));

CREATE TRIGGER stock_exit_plan_usages_append_only
  BEFORE UPDATE OR DELETE ON public.stock_exit_plan_usages
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_row_mutation();
CREATE TRIGGER stock_exit_plan_usage_items_append_only
  BEFORE UPDATE OR DELETE ON public.stock_exit_plan_usage_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_row_mutation();

CREATE OR REPLACE FUNCTION public.save_stock_exit_plan(
  p_unit_id uuid,
  p_plan_id uuid,
  p_name text,
  p_recipient text,
  p_notes text,
  p_status public.record_status,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_company uuid;
  v_plan uuid := coalesce(p_plan_id, gen_random_uuid());
  v_item jsonb;
  v_product public.products%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_status NOT IN ('active', 'inactive')
     OR length(trim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 160
     OR length(trim(coalesce(p_recipient, ''))) NOT BETWEEN 1 AND 120
     OR length(coalesce(p_notes, '')) > 500
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Confira nome, responsável, observação e itens do planejamento.';
  END IF;

  SELECT unit.company_id INTO v_company
  FROM public.units AS unit
  WHERE unit.id = p_unit_id AND unit.status = 'active';
  IF NOT FOUND OR NOT private.has_active_access(
    v_company, p_unit_id, ARRAY['admin', 'stock_manager']::public.profile_role[]
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administradores e gestores podem manter planejamentos de saída.';
  END IF;

  IF p_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.stock_exit_plans AS plan
    WHERE plan.id = p_plan_id AND plan.company_id = v_company AND plan.unit_id = p_unit_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Planejamento fora da unidade selecionada.';
  END IF;

  INSERT INTO public.stock_exit_plans (
    id, company_id, unit_id, name, recipient, notes, frequency, status, created_by, updated_by
  ) VALUES (
    v_plan, v_company, p_unit_id, trim(p_name), trim(p_recipient), nullif(trim(coalesce(p_notes, '')), ''),
    'daily', p_status, v_actor, v_actor
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    recipient = EXCLUDED.recipient,
    notes = EXCLUDED.notes,
    status = EXCLUDED.status,
    updated_by = v_actor,
    updated_at = now();

  DELETE FROM public.stock_exit_plan_items AS item WHERE item.plan_id = v_plan;

  FOR v_item IN SELECT element.value FROM jsonb_array_elements(p_items) AS element(value)
  LOOP
    IF nullif(v_item->>'product_id', '') IS NULL
       OR nullif(v_item->>'quantity', '') IS NULL
       OR (v_item->>'quantity')::numeric <= 0
       OR (v_item->>'quantity')::numeric <> trunc((v_item->>'quantity')::numeric, 3) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Cada produto precisa de quantidade maior que zero, com até três casas decimais.';
    END IF;
    SELECT product.* INTO v_product
    FROM public.products AS product
    WHERE product.id = (v_item->>'product_id')::uuid
      AND product.company_id = v_company AND product.status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Todos os produtos do modelo precisam estar ativos na empresa.';
    END IF;
    INSERT INTO public.stock_exit_plan_items (
      company_id, unit_id, plan_id, product_id, product_name_snapshot,
      unit_of_measure_snapshot, planned_quantity
    ) VALUES (
      v_company, p_unit_id, v_plan, v_product.id, v_product.name,
      v_product.unit_of_measure, (v_item->>'quantity')::numeric
    );
  END LOOP;

  RETURN v_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.save_stock_exit_plan(uuid, uuid, text, text, text, public.record_status, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_stock_exit_plan(uuid, uuid, text, text, text, public.record_status, jsonb) TO authenticated;

-- Apaga fisicamente somente quando nenhum movimento/histórico referencia o produto.
-- Qualquer referência impede DELETE e resulta em inativação com rastreabilidade.
CREATE OR REPLACE FUNCTION public.delete_or_archive_product(p_product_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_actor uuid := auth.uid();
  v_has_movements boolean;
BEGIN
  SELECT product.* INTO v_product
  FROM public.products AS product
  WHERE product.id = p_product_id
  FOR UPDATE;
  IF NOT FOUND OR v_actor IS NULL OR NOT private.has_active_access(
    v_product.company_id, NULL::uuid, ARRAY['admin', 'stock_manager']::public.profile_role[]
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Produto não encontrado ou usuário sem permissão para excluir.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stock_movements AS movement
    WHERE movement.product_id = v_product.id AND movement.company_id = v_product.company_id
  ) INTO v_has_movements;
  IF v_has_movements THEN
    UPDATE public.products SET status = 'inactive', updated_at = now()
    WHERE id = v_product.id;
    RETURN 'archived';
  END IF;

  BEGIN
    DELETE FROM public.products WHERE id = v_product.id;
    RETURN 'deleted';
  EXCEPTION WHEN foreign_key_violation THEN
    UPDATE public.products SET status = 'inactive', updated_at = now()
    WHERE id = v_product.id;
    RETURN 'archived';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_or_archive_product(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_or_archive_product(uuid) TO authenticated;

-- O trigger é disparado dentro da transação que grava a saída e captura o modelo usado,
-- as quantidades originais e as efetivamente confirmadas pelo operador.
CREATE OR REPLACE FUNCTION private.capture_stock_exit_plan_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_items jsonb;
  v_plan_id uuid;
  v_plan public.stock_exit_plans%ROWTYPE;
  v_recipient text;
  v_performer_name text;
  v_usage_id uuid;
  v_plan_item record;
  v_actual_quantity numeric;
  v_actual_unit text;
BEGIN
  IF NEW.movement_type <> 'exit' THEN RETURN NEW; END IF;
  v_items := NEW.request_payload->'items';
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_items) = 0
     OR nullif(v_items->0->>'exit_plan_id', '') IS NULL THEN
    RETURN NEW;
  END IF;

  v_plan_id := (v_items->0->>'exit_plan_id')::uuid;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS element(value)
    WHERE nullif(element.value->>'exit_plan_id', '')::uuid IS DISTINCT FROM v_plan_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Todos os itens precisam pertencer ao mesmo planejamento.';
  END IF;
  SELECT plan.* INTO v_plan
  FROM public.stock_exit_plans AS plan
  WHERE plan.id = v_plan_id AND plan.company_id = NEW.company_id
    AND plan.unit_id = NEW.unit_id AND plan.status = 'active'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'O planejamento foi desativado ou não pertence a esta unidade.';
  END IF;

  v_recipient := nullif(trim(v_items->0->>'recipient'), '');
  IF v_recipient IS NULL OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS element(value)
    WHERE nullif(trim(element.value->>'recipient'), '') IS DISTINCT FROM v_recipient
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Informe um único responsável para todos os itens da saída.';
  END IF;
  SELECT profile.full_name INTO v_performer_name
  FROM public.profiles AS profile
  WHERE profile.user_id = NEW.performed_by AND profile.company_id = NEW.company_id;
  v_performer_name := coalesce(nullif(trim(v_performer_name), ''), 'Usuário sem nome');

  INSERT INTO public.stock_exit_plan_usages (
    company_id, unit_id, batch_id, plan_id, plan_name_snapshot,
    planned_recipient_snapshot, actual_recipient, performed_by, performed_by_name_snapshot, used_at
  ) VALUES (
    NEW.company_id, NEW.unit_id, NEW.id, v_plan.id, v_plan.name,
    v_plan.recipient, v_recipient, NEW.performed_by, v_performer_name, NEW.occurred_at
  ) RETURNING id INTO v_usage_id;

  FOR v_plan_item IN
    SELECT item.product_id, item.product_name_snapshot,
      item.unit_of_measure_snapshot, item.planned_quantity
    FROM public.stock_exit_plan_items AS item
    WHERE item.plan_id = v_plan.id
  LOOP
    SELECT coalesce(sum((element.value->>'quantity')::numeric), 0), max(product.unit_of_measure)
      INTO v_actual_quantity, v_actual_unit
    FROM jsonb_array_elements(v_items) AS element(value)
    JOIN public.products AS product ON product.id = (element.value->>'product_id')::uuid
    WHERE product.id = v_plan_item.product_id;
    IF v_actual_quantity > 0 AND v_actual_unit IS DISTINCT FROM v_plan_item.unit_of_measure_snapshot THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A unidade de um produto do modelo mudou. Atualize o planejamento antes de registrar a saída.';
    END IF;
    INSERT INTO public.stock_exit_plan_usage_items (
      usage_id, product_id, product_name_snapshot, unit_of_measure_snapshot,
      planned_quantity, actual_quantity
    ) VALUES (
      v_usage_id, v_plan_item.product_id, v_plan_item.product_name_snapshot,
      v_plan_item.unit_of_measure_snapshot, v_plan_item.planned_quantity, v_actual_quantity
    );
  END LOOP;

  FOR v_plan_item IN
    SELECT product.id, product.name, product.unit_of_measure,
      sum((element.value->>'quantity')::numeric) AS actual_quantity
    FROM jsonb_array_elements(v_items) AS element(value)
    JOIN public.products AS product ON product.id = (element.value->>'product_id')::uuid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.stock_exit_plan_items AS item
      WHERE item.plan_id = v_plan.id AND item.product_id = product.id
    )
    GROUP BY product.id, product.name, product.unit_of_measure
  LOOP
    INSERT INTO public.stock_exit_plan_usage_items (
      usage_id, product_id, product_name_snapshot, unit_of_measure_snapshot,
      planned_quantity, actual_quantity
    ) VALUES (
      v_usage_id, v_plan_item.id, v_plan_item.name, v_plan_item.unit_of_measure,
      0, v_plan_item.actual_quantity
    );
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_stock_exit_plan_usage() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER stock_movement_batches_capture_exit_plan
  AFTER INSERT ON public.stock_movement_batches
  FOR EACH ROW EXECUTE FUNCTION private.capture_stock_exit_plan_usage();

COMMENT ON TABLE public.stock_exit_plan_usages IS
  'Snapshot imutável do modelo de saída utilizado, responsável e operador; criado na mesma transação da movimentação.';

COMMIT;
