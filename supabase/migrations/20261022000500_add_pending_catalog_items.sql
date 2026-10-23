-- Add the named pending products from the user's catalog list.
-- The unnamed spreadsheet row is intentionally excluded.
BEGIN;
DO $import$
DECLARE
  v_company_id uuid;
  v_food_category_id uuid;
  v_infant_category_id uuid;
  v_inserted integer;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'LBGS' AND status = 'active';
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Active LBGS company not found.';
  END IF;

  INSERT INTO public.categories (company_id, name)
  VALUES (v_company_id, 'Alimentos e mercearia')
  ON CONFLICT (company_id, name) DO NOTHING;
  SELECT id INTO v_food_category_id
  FROM public.categories
  WHERE company_id = v_company_id
    AND name = 'Alimentos e mercearia'
    AND status = 'active';
  IF v_food_category_id IS NULL THEN
    RAISE EXCEPTION 'Active food category not found.';
  END IF;

  INSERT INTO public.categories (company_id, name)
  VALUES (v_company_id, 'Acessórios para alimentação infantil')
  ON CONFLICT (company_id, name) DO NOTHING;
  SELECT id INTO v_infant_category_id
  FROM public.categories
  WHERE company_id = v_company_id
    AND name = 'Acessórios para alimentação infantil'
    AND status = 'active';
  IF v_infant_category_id IS NULL THEN
    RAISE EXCEPTION 'Active infant feeding accessories category not found.';
  END IF;

  WITH source(sku, name, unit_of_measure, category_kind) AS (
    VALUES
      ('PEND-20261022-001', 'Arroz Agulinha Tipo 1', 'kg', 'food'),
      ('PEND-20261022-002', 'Açúcar Sachê', 'un', 'food'),
      ('PEND-20261022-003', 'Catchup Sachê', 'un', 'food'),
      ('PEND-20261022-004', 'Chá de Boldo Sachê', 'un', 'food'),
      ('PEND-20261022-005', 'Chantilly Amélia - Litro', 'l', 'food'),
      ('PEND-20261022-006', 'Chocolate em Pó', 'kg', 'food'),
      ('PEND-20261022-007', 'Doce de Banana - Mariola', 'un', 'food'),
      ('PEND-20261022-008', 'Ervilha em Conserva (Lata 2 kg)', 'kg', 'food'),
      ('PEND-20261022-009', 'Flocão de Milho', 'kg', 'food'),
      ('PEND-20261022-010', 'Fubá', 'kg', 'food'),
      ('PEND-20261022-011', 'Goiabada em Bloco', 'kg', 'food'),
      ('PEND-20261022-012', 'Maionese Sachê (8 g)', 'un', 'food'),
      ('PEND-20261022-013', 'Manteiga Sachê com Sal', 'un', 'food'),
      ('PEND-20261022-014', 'Manteiga Sachê sem Sal', 'un', 'food'),
      ('PEND-20261022-015', 'Margarina com Sal', 'kg', 'food'),
      ('PEND-20261022-016', 'Melaço', 'l', 'food'),
      ('PEND-20261022-017', 'Queijo Ralado', 'kg', 'food'),
      ('PEND-20261022-018', 'Vinho Tinto', 'l', 'food'),
      ('PEND-20261022-019', 'Adoçante Sachê Sucralose', 'un', 'food'),
      ('PEND-20261022-020', 'Aveia em Flocos Finos', 'kg', 'food'),
      ('PEND-20261022-021', 'Azeite de Oliva Extra Virgem', 'l', 'food'),
      ('PEND-20261022-022', 'Azeite Sachê', 'un', 'food'),
      ('PEND-20261022-023', 'Biscoito Cream Cracker Integral Sachê (2 unidades)', 'un', 'food'),
      ('PEND-20261022-024', 'Chá de Camomila', 'kg', 'food'),
      ('PEND-20261022-025', 'Chá de Camomila Sachê (Caixa com 10 saquinhos)', 'un', 'food'),
      ('PEND-20261022-026', 'Chá de Erva-Cidreira Sachê (Caixa com 10 saquinhos)', 'un', 'food'),
      ('PEND-20261022-027', 'Doce de Leite Tablete 20 g', 'un', 'food'),
      ('PEND-20261022-028', 'Farinha Láctea Sachê 230 g', 'un', 'food'),
      ('PEND-20261022-029', 'Farinha Láctea Sachê 600 g', 'un', 'food'),
      ('PEND-20261022-030', 'Geleia Sachê', 'un', 'food'),
      ('PEND-20261022-031', 'Geleia Sachê Diet', 'un', 'food'),
      ('PEND-20261022-032', 'Leite de Soja em Pó', 'kg', 'food'),
      ('PEND-20261022-033', 'Leite Longa Vida Integral', 'l', 'food'),
      ('PEND-20261022-034', 'Macarrão Parafuso com Sêmola', 'kg', 'food'),
      ('PEND-20261022-035', 'Maionese', 'kg', 'food'),
      ('PEND-20261022-036', 'Molho Italiano Sachê', 'un', 'food'),
      ('PEND-20261022-037', 'Neston 3 Cereais', 'kg', 'food'),
      ('PEND-20261022-038', 'Pudim Diet 200 g', 'un', 'food'),
      ('PEND-20261022-039', 'Sal Sachê', 'un', 'food'),
      ('PEND-20261022-040', 'Sal Sachê Light', 'un', 'food'),
      ('PEND-20261022-041', 'Suco Néctar Tetra Pak 200 ml', 'un', 'food'),
      ('PEND-20261022-042', 'Tapioca', 'kg', 'food'),
      ('PEND-20261022-043', 'Torrada Integral Sachê', 'un', 'food'),
      ('PEND-20261022-044', 'Torrada Sachê', 'un', 'food'),
      ('PEND-20261022-045', 'Iogurte Garrafinha', 'un', 'food'),
      ('PEND-20261022-046', 'Iogurte Garrafinha Ameixa Light', 'un', 'food'),
      ('PEND-20261022-047', 'Iogurte Garrafinha Light', 'un', 'food'),
      ('PEND-20261022-048', 'Iogurte Litro Light Ameixa', 'un', 'food'),
      ('PEND-20261022-049', 'Iogurte Litro Light Morango', 'un', 'food'),
      ('PEND-20261022-050', 'Iogurte Litro Morango', 'l', 'food'),
      ('PEND-20261022-051', 'Iogurte Natural Desnatado', 'un', 'food'),
      ('PEND-20261022-052', 'Iogurte Natural Integral', 'un', 'food'),
      ('PEND-20261022-053', 'Queijo Muçarela', 'kg', 'food'),
      ('PEND-20261022-054', 'Ricota', 'kg', 'food'),
      ('PEND-20261022-055', 'Bico em Silicone Mini Ortodôntico', 'un', 'infant'),
      ('PEND-20261022-056', 'Bico em Silicone Ortodôntico', 'un', 'infant'),
      ('PEND-20261022-057', 'Chuca 50 ml', 'un', 'infant'),
      ('PEND-20261022-058', 'Chuca 80 ml', 'un', 'infant'),
      ('PEND-20261022-059', 'Copo Coletor 80 ml para Leite Materno', 'un', 'infant'),
      ('PEND-20261022-060', 'Mamadeira 150 ml com Bico de Silicone Convencional', 'un', 'infant')
  )
  INSERT INTO public.products
    (company_id, category_id, sku, name, barcode, unit_of_measure, minimum_stock, status)
  SELECT
    v_company_id,
    CASE WHEN source.category_kind = 'infant' THEN v_infant_category_id ELSE v_food_category_id END,
    source.sku,
    source.name,
    NULL,
    source.unit_of_measure,
    0,
    'active'
  FROM source
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Pending catalog import complete: % of 60 new products added.', v_inserted;
END;
$import$;
COMMIT;
