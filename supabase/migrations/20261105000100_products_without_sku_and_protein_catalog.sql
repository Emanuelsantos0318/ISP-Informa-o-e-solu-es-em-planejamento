BEGIN;

-- Permite produtos sem código do fabricante; ausência de SKU não é um SKU inventado.
ALTER TABLE public.products
  ALTER COLUMN sku DROP NOT NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_sku_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_sku_check
  CHECK (sku IS NULL OR length(trim(sku)) BETWEEN 1 AND 80);

-- A comparação sem acentos só é usada para impedir duplicatas deste seed.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

DO $protein_catalog$
DECLARE
  v_company_id uuid;
  v_category_id uuid;
BEGIN
  SELECT company.id INTO v_company_id
  FROM public.companies AS company
  WHERE company.name = 'LBGS'
    AND company.status = 'active';

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Active LBGS company not found; protein catalog was not seeded.';
  END IF;

  INSERT INTO public.categories (company_id, name)
  VALUES (v_company_id, 'Proteínas')
  ON CONFLICT (company_id, name) DO NOTHING;

  SELECT category.id INTO v_category_id
  FROM public.categories AS category
  WHERE category.company_id = v_company_id
    AND extensions.unaccent(lower(trim(category.name))) = 'proteinas'
    AND category.status = 'active'
  ORDER BY category.created_at, category.id
  LIMIT 1;

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'Active protein category could not be resolved.';
  END IF;

  WITH source_products(name, unit_of_measure) AS (
    VALUES
      ('Filé de frango', 'kg'),
      ('Coxão duro', 'kg'),
      ('Patinho', 'kg'),
      ('Coxão mole', 'kg'),
      ('Merluza', 'kg'),
      ('Coxa e sobrecoxa', 'kg'),
      ('Queijo Minas', 'kg'),
      ('Presunto', 'kg'),
      ('Pernil', 'kg'),
      ('Posta', 'kg'),
      ('Charque', 'kg'),
      ('Calabresa', 'kg'),
      ('Bacon', 'kg'),
      ('Bisteca', 'kg'),
      ('Bofe', 'kg'),
      ('Linguiça toscana', 'kg'),
      ('Fígado', 'kg')
  )
  INSERT INTO public.products (
    company_id, category_id, sku, name, barcode, unit_of_measure,
    minimum_stock, status
  )
  SELECT v_company_id, v_category_id, NULL, source.name, NULL,
         source.unit_of_measure, 0, 'active'
  FROM source_products AS source
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.products AS existing
    WHERE existing.company_id = v_company_id
      AND extensions.unaccent(lower(trim(existing.name))) =
          extensions.unaccent(lower(trim(source.name)))
  );
END;
$protein_catalog$;

COMMENT ON COLUMN public.products.sku IS
  'Optional supplier/manufacturer SKU. NULL means no SKU was provided; never synthesize a vendor code.';

COMMIT;
