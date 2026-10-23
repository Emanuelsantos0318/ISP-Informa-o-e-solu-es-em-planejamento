-- Add the pending disposable, hygiene, cleaning, beverage and office products.
BEGIN;
DO $import$
DECLARE
  v_company_id uuid;
  v_category_beverages uuid;
  v_category_disposables uuid;
  v_category_cleaning uuid;
  v_category_office uuid;
  v_category_service uuid;
  v_inserted integer;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'LBGS' AND status = 'active';
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Active LBGS company not found.';
  END IF;

  INSERT INTO public.categories (company_id, name)
  VALUES
    (v_company_id, 'Bebidas'),
    (v_company_id, 'Descartáveis e embalagens'),
    (v_company_id, 'Higiene e limpeza'),
    (v_company_id, 'Materiais de escritório e identificação'),
    (v_company_id, 'Utensílios de serviço')
  ON CONFLICT (company_id, name) DO NOTHING;

  SELECT id INTO v_category_beverages FROM public.categories
  WHERE company_id = v_company_id AND name = 'Bebidas' AND status = 'active';
  SELECT id INTO v_category_disposables FROM public.categories
  WHERE company_id = v_company_id AND name = 'Descartáveis e embalagens' AND status = 'active';
  SELECT id INTO v_category_cleaning FROM public.categories
  WHERE company_id = v_company_id AND name = 'Higiene e limpeza' AND status = 'active';
  SELECT id INTO v_category_office FROM public.categories
  WHERE company_id = v_company_id AND name = 'Materiais de escritório e identificação' AND status = 'active';
  SELECT id INTO v_category_service FROM public.categories
  WHERE company_id = v_company_id AND name = 'Utensílios de serviço' AND status = 'active';

  IF v_category_beverages IS NULL OR v_category_disposables IS NULL
    OR v_category_cleaning IS NULL OR v_category_office IS NULL
    OR v_category_service IS NULL THEN
    RAISE EXCEPTION 'One or more active catalog categories could not be found.';
  END IF;

  WITH source(sku, name, unit_of_measure, category_kind) AS (
    VALUES
      ('PEND-20261022-MAT-001', 'Água Mineral sem Gás 1,5 L', 'un', 'beverages'),
      ('PEND-20261022-MAT-002', 'Avental Descartável TNT Manga Longa', 'un', 'cleaning'),
      ('PEND-20261022-MAT-003', 'Bobina Plástica 60 cm', 'un', 'disposables'),
      ('PEND-20261022-MAT-004', 'Bobina Plástica Picotada 40 x 60 cm', 'un', 'disposables'),
      ('PEND-20261022-MAT-005', 'Copo Descartável 200 ml', 'ct', 'disposables'),
      ('PEND-20261022-MAT-006', 'Copo Descartável 200 ml PP', 'ct', 'disposables'),
      ('PEND-20261022-MAT-007', 'Embalagem de Isopor 3 Divisórias 1200 ml', 'un', 'disposables'),
      ('PEND-20261022-MAT-008', 'Embalagem de Isopor 3 Divisórias 900 ml', 'un', 'disposables'),
      ('PEND-20261022-MAT-009', 'Fita Filme 40 cm (metro)', 'm', 'disposables'),
      ('PEND-20261022-MAT-010', 'Hipoclorito de Sódio', 'kg', 'cleaning'),
      ('PEND-20261022-MAT-011', 'Máscara Descartável com Filtro', 'un', 'cleaning'),
      ('PEND-20261022-MAT-012', 'Palheta para Café', 'mi', 'disposables'),
      ('PEND-20261022-MAT-013', 'Papel Higiênico Branco', 'un', 'cleaning'),
      ('PEND-20261022-MAT-014', 'Papel Higiênico Rolo 300 m', 'un', 'cleaning'),
      ('PEND-20261022-MAT-015', 'Papel Manteiga', 'un', 'disposables'),
      ('PEND-20261022-MAT-016', 'Saco de Amostra', 'un', 'disposables'),
      ('PEND-20261022-MAT-017', 'Saco de Lixo 300 L Preto', 'un', 'cleaning'),
      ('PEND-20261022-MAT-018', 'Saco Transparente 65 x 120', 'kg', 'disposables'),
      ('PEND-20261022-MAT-019', 'Saco Transparente 75 x 100', 'kg', 'disposables'),
      ('PEND-20261022-MAT-020', 'Suporte para Litro', 'un', 'service'),
      ('PEND-20261022-MAT-021', 'Etiqueta 46,5 x 63,5 mm (caixa com 1800 unidades)', 'un', 'office'),
      ('PEND-20261022-MAT-022', 'Etiqueta Térmica 80 x 50 x 1', 'un', 'office'),
      ('PEND-20261022-MAT-023', 'Papel Sulfite A4 75 g/m² (pacote com 500 folhas)', 'un', 'office')
  )
  INSERT INTO public.products
    (company_id, category_id, sku, name, barcode, unit_of_measure, minimum_stock, status)
  SELECT
    v_company_id,
    CASE source.category_kind
      WHEN 'beverages' THEN v_category_beverages
      WHEN 'cleaning' THEN v_category_cleaning
      WHEN 'office' THEN v_category_office
      WHEN 'service' THEN v_category_service
      ELSE v_category_disposables
    END,
    source.sku,
    source.name,
    NULL,
    source.unit_of_measure,
    0,
    'active'
  FROM source
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.products existing
    WHERE existing.company_id = v_company_id
      AND lower(trim(existing.name)) = lower(trim(source.name))
      AND lower(trim(existing.unit_of_measure)) = lower(trim(source.unit_of_measure))
      AND existing.status = 'active'
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Pending supplies import complete: % of 23 new products added.', v_inserted;
END;
$import$;
COMMIT;
