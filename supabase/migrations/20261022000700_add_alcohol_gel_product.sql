-- Add alcohol gel from the cleaning catalog, keyed by its supplied barcode.
BEGIN;
DO $import$
DECLARE
  v_company_id uuid;
  v_category_id uuid;
  v_inserted integer;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'LBGS' AND status = 'active';
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Active LBGS company not found.';
  END IF;

  INSERT INTO public.categories (company_id, name)
  VALUES (v_company_id, 'Higiene e limpeza')
  ON CONFLICT (company_id, name) DO NOTHING;
  SELECT id INTO v_category_id
  FROM public.categories
  WHERE company_id = v_company_id
    AND name = 'Higiene e limpeza'
    AND status = 'active';
  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'Active hygiene and cleaning category not found.';
  END IF;

  INSERT INTO public.products
    (company_id, category_id, sku, name, barcode, unit_of_measure, minimum_stock, status)
  VALUES
    (v_company_id, v_category_id, 'EAN-7898606570163', 'Álcool em gel', '7898606570163', 'un', 0, 'active')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Alcohol gel import complete: % new product added.', v_inserted;
END;
$import$;
COMMIT;
