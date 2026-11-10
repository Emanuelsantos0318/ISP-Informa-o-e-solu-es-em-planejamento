BEGIN;

-- Estrutura nova e isolada: o planejamento não cria movimentos de estoque.
CREATE TABLE public.production_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'filling', 'review', 'approved', 'deliveries_scheduled', 'in_progress', 'finished', 'cancelled')),
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_plans_date_range_check CHECK (week_end >= week_start AND week_end - week_start <= 13),
  CONSTRAINT production_plans_title_check CHECK (length(trim(title)) BETWEEN 1 AND 180),
  CONSTRAINT production_plans_scope_key UNIQUE (id, company_id, unit_id),
  CONSTRAINT production_plans_version_key UNIQUE (company_id, unit_id, week_start, version),
  CONSTRAINT production_plans_unit_company_fkey
    FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE public.production_plan_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  consumption_date date,
  audience_code text NOT NULL CHECK (audience_code IN ('patient', 'server')),
  meal_code text NOT NULL CHECK (meal_code IN ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper')),
  meal_group text,
  preparation text NOT NULL,
  original_product_text text,
  product_id uuid,
  per_capita numeric(18, 8) CHECK (per_capita IS NULL OR per_capita >= 0),
  per_capita_unit text,
  volume numeric(18, 6) CHECK (volume IS NULL OR volume >= 0),
  volume_unit text,
  quantity_unit text,
  calculated_quantity numeric(18, 6),
  manual_quantity numeric(18, 6),
  manual_reason text,
  notes text,
  source_import_row_id uuid,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_plan_entries_plan_scope_fkey
    FOREIGN KEY (plan_id, company_id, unit_id)
    REFERENCES public.production_plans(id, company_id, unit_id) ON DELETE RESTRICT,
  CONSTRAINT production_plan_entries_product_scope_fkey FOREIGN KEY (product_id, company_id) REFERENCES public.products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_plan_entries_manual_reason_check CHECK (manual_quantity IS NULL OR length(trim(coalesce(manual_reason, ''))) > 0),
  CONSTRAINT production_plan_entries_preparation_check CHECK (length(trim(preparation)) BETWEEN 1 AND 200),
  CONSTRAINT production_plan_entries_unit_check CHECK (quantity_unit IS NULL OR length(trim(quantity_unit)) BETWEEN 1 AND 30),
  CONSTRAINT production_plan_entries_reason_check CHECK (manual_reason IS NULL OR length(manual_reason) <= 500),
  CONSTRAINT production_plan_entries_calculated_check CHECK (
    calculated_quantity IS NULL OR
    (per_capita IS NOT NULL AND volume IS NOT NULL AND calculated_quantity = per_capita * volume)
  )
);

CREATE TABLE public.production_delivery_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid,
  code text NOT NULL,
  label text NOT NULL,
  consumption_from smallint NOT NULL CHECK (consumption_from BETWEEN 0 AND 6),
  consumption_to smallint NOT NULL CHECK (consumption_to BETWEEN 0 AND 6),
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_delivery_windows_scope_fkey
    FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_delivery_windows_code_check CHECK (length(trim(code)) BETWEEN 1 AND 60),
  CONSTRAINT production_delivery_windows_label_check CHECK (length(trim(label)) BETWEEN 1 AND 100),
  CONSTRAINT production_delivery_windows_scope_code_key UNIQUE NULLS NOT DISTINCT (company_id, unit_id, code),
  CONSTRAINT production_delivery_windows_scope_key UNIQUE (id, company_id, unit_id),
  CONSTRAINT production_delivery_windows_company_key UNIQUE (id, company_id)
);

CREATE TABLE public.production_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  window_id uuid,
  label text NOT NULL,
  scheduled_for date,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'partially_received', 'received', 'cancelled')),
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_deliveries_plan_scope_fkey
    FOREIGN KEY (plan_id, company_id, unit_id)
    REFERENCES public.production_plans(id, company_id, unit_id) ON DELETE RESTRICT,
  CONSTRAINT production_deliveries_window_scope_fkey
    FOREIGN KEY (window_id, company_id)
    REFERENCES public.production_delivery_windows(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_deliveries_label_check CHECK (length(trim(label)) BETWEEN 1 AND 100),
  CONSTRAINT production_deliveries_scope_key UNIQUE (id, company_id, unit_id)
);

CREATE TABLE public.production_delivery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  product_id uuid,
  original_product_text text,
  quantity_unit text NOT NULL,
  requested_quantity numeric(18, 6) NOT NULL CHECK (requested_quantity >= 0),
  received_quantity numeric(18, 6) CHECK (received_quantity IS NULL OR received_quantity >= 0),
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_delivery_items_delivery_scope_fkey
    FOREIGN KEY (delivery_id, company_id, unit_id)
    REFERENCES public.production_deliveries(id, company_id, unit_id) ON DELETE RESTRICT,
  CONSTRAINT production_delivery_items_product_scope_fkey FOREIGN KEY (product_id, company_id) REFERENCES public.products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_delivery_items_unit_check CHECK (length(trim(quantity_unit)) BETWEEN 1 AND 30),
  CONSTRAINT production_delivery_items_product_check CHECK (product_id IS NOT NULL OR length(trim(coalesce(original_product_text, ''))) > 0)
);

CREATE TABLE public.production_thaw_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid,
  product_id uuid,
  category_id uuid,
  label text NOT NULL,
  lead_hours integer NOT NULL CHECK (lead_hours BETWEEN 0 AND 720),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_thaw_rules_scope_fkey
    FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_thaw_rules_product_scope_fkey FOREIGN KEY (product_id, company_id) REFERENCES public.products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_thaw_rules_category_scope_fkey FOREIGN KEY (category_id, company_id) REFERENCES public.categories(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_thaw_rules_target_check CHECK ((product_id IS NOT NULL) <> (category_id IS NOT NULL)),
  CONSTRAINT production_thaw_rules_label_check CHECK (length(trim(label)) BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX production_thaw_rules_product_scope_key
  ON public.production_thaw_rules (company_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), product_id)
  WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX production_thaw_rules_category_scope_key
  ON public.production_thaw_rules (company_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), category_id)
  WHERE category_id IS NOT NULL;

CREATE TABLE public.production_thaw_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  product_id uuid,
  original_product_text text,
  consumption_at timestamptz NOT NULL,
  planned_thaw_at timestamptz,
  lead_hours integer CHECK (lead_hours IS NULL OR lead_hours BETWEEN 0 AND 720),
  quantity numeric(18, 6) CHECK (quantity IS NULL OR quantity >= 0),
  quantity_unit text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'removed', 'completed', 'cancelled')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_thaw_schedules_plan_scope_fkey
    FOREIGN KEY (plan_id, company_id, unit_id)
    REFERENCES public.production_plans(id, company_id, unit_id) ON DELETE RESTRICT,
  CONSTRAINT production_thaw_schedules_product_scope_fkey FOREIGN KEY (product_id, company_id) REFERENCES public.products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_thaw_schedules_product_check CHECK (product_id IS NOT NULL OR length(trim(coalesce(original_product_text, ''))) > 0),
  CONSTRAINT production_thaw_schedules_unit_check CHECK (quantity_unit IS NULL OR length(trim(quantity_unit)) BETWEEN 1 AND 30)
);

CREATE TABLE public.production_pulp_flavors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  flavor_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_pulp_flavors_name_check CHECK (length(trim(flavor_name)) BETWEEN 1 AND 120),
  CONSTRAINT production_pulp_flavors_company_name_key UNIQUE (company_id, flavor_name),
  CONSTRAINT production_pulp_flavors_scope_key UNIQUE (id, company_id)
);

CREATE TABLE public.production_pulp_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  consumption_date date,
  audience_code text NOT NULL CHECK (audience_code IN ('patient', 'server')),
  service_code text,
  flavor_id uuid REFERENCES public.production_pulp_flavors(id) ON DELETE RESTRICT,
  original_flavor_text text,
  quantity numeric(18, 6),
  quantity_unit text,
  delivery_id uuid,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_pulp_entries_plan_scope_fkey
    FOREIGN KEY (plan_id, company_id, unit_id)
    REFERENCES public.production_plans(id, company_id, unit_id) ON DELETE RESTRICT,
  CONSTRAINT production_pulp_entries_quantity_check CHECK (quantity IS NULL OR quantity >= 0),
  CONSTRAINT production_pulp_entries_flavor_check CHECK (flavor_id IS NOT NULL OR length(trim(coalesce(original_flavor_text, ''))) > 0),
  CONSTRAINT production_pulp_entries_unit_check CHECK (quantity_unit IS NULL OR length(trim(quantity_unit)) BETWEEN 1 AND 30),
  CONSTRAINT production_pulp_entries_flavor_scope_fkey FOREIGN KEY (flavor_id, company_id) REFERENCES public.production_pulp_flavors(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_pulp_entries_delivery_scope_fkey FOREIGN KEY (delivery_id, company_id, unit_id) REFERENCES public.production_deliveries(id, company_id, unit_id) ON DELETE RESTRICT
);

CREATE TABLE public.production_product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  original_text text NOT NULL,
  normalized_text text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_product_aliases_text_check CHECK (length(trim(original_text)) BETWEEN 1 AND 200 AND length(trim(normalized_text)) BETWEEN 1 AND 200),
  CONSTRAINT production_product_aliases_company_text_key UNIQUE (company_id, normalized_text),
  CONSTRAINT production_product_aliases_product_scope_fkey FOREIGN KEY (product_id, company_id) REFERENCES public.products(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE public.production_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'previewed', 'imported', 'partial', 'rejected')),
  sheet_names jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sheet_names) = 'array'),
  cell_count integer NOT NULL DEFAULT 0 CHECK (cell_count >= 0),
  identified_count integer NOT NULL DEFAULT 0 CHECK (identified_count >= 0),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  issue_count integer NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_report) = 'object'),
  imported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_imports_scope_fkey
    FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_imports_filename_check CHECK (length(trim(file_name)) BETWEEN 1 AND 240),
  CONSTRAINT production_imports_sha256_check CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT production_imports_scope_hash_key UNIQUE (company_id, unit_id, file_sha256),
  CONSTRAINT production_imports_scope_key UNIQUE (id, company_id, unit_id)
);

CREATE TABLE public.production_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  import_id uuid NOT NULL,
  source_sheet text NOT NULL,
  source_cell text NOT NULL,
  cell_kind text NOT NULL CHECK (cell_kind IN ('blank', 'zero', 'value', 'formula')),
  original_value jsonb,
  original_formula text,
  cached_result jsonb,
  style_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(style_snapshot) = 'object'),
  recognized_type text,
  normalized_value jsonb,
  product_id uuid,
  validation_status text NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'recognized', 'matched', 'imported', 'needs_review', 'rejected')),
  issue text,
  linked_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_import_rows_import_scope_fkey
    FOREIGN KEY (import_id, company_id, unit_id)
    REFERENCES public.production_imports(id, company_id, unit_id) ON DELETE RESTRICT,
  CONSTRAINT production_import_rows_product_scope_fkey FOREIGN KEY (product_id, company_id) REFERENCES public.products(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_import_rows_origin_key UNIQUE (import_id, source_sheet, source_cell),
  CONSTRAINT production_import_rows_scope_key UNIQUE (id, company_id, unit_id)
);

ALTER TABLE public.production_plan_entries
  ADD CONSTRAINT production_plan_entries_import_row_fkey
  FOREIGN KEY (source_import_row_id, company_id, unit_id) REFERENCES public.production_import_rows(id, company_id, unit_id) ON DELETE RESTRICT;

CREATE TABLE public.production_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  unit_id uuid,
  actor_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_audit_events_scope_fkey
    FOREIGN KEY (unit_id, company_id) REFERENCES public.units(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT production_audit_events_json_check CHECK (
    (before_data IS NULL OR jsonb_typeof(before_data) = 'object') AND
    (after_data IS NULL OR jsonb_typeof(after_data) = 'object')
  )
);

-- Arquivos de origem do módulo ficam privados e isolados no Storage.
-- A interface limita uploads a 10 MiB; repetimos o limite no bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'production-imports',
  'production-imports',
  false,
  10485760,
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE INDEX production_plans_scope_date_idx ON public.production_plans (company_id, unit_id, week_start DESC, status);
CREATE INDEX production_plan_entries_plan_date_idx ON public.production_plan_entries (company_id, unit_id, plan_id, consumption_date);
CREATE INDEX production_plan_entries_product_idx ON public.production_plan_entries (company_id, unit_id, product_id);
CREATE INDEX production_deliveries_plan_idx ON public.production_deliveries (company_id, unit_id, plan_id, scheduled_for);
CREATE INDEX production_thaw_schedules_date_idx ON public.production_thaw_schedules (company_id, unit_id, planned_thaw_at, status);
CREATE INDEX production_pulp_entries_plan_date_idx ON public.production_pulp_entries (company_id, unit_id, plan_id, consumption_date);
CREATE INDEX production_import_rows_review_idx ON public.production_import_rows (company_id, unit_id, import_id, validation_status);
CREATE INDEX production_audit_events_entity_idx ON public.production_audit_events (company_id, unit_id, entity_type, entity_id, occurred_at DESC);
CREATE UNIQUE INDEX production_plan_entries_import_row_unique_idx
  ON public.production_plan_entries (source_import_row_id)
  WHERE source_import_row_id IS NOT NULL;

COMMIT;
