-- Import only the 86 food catalog rows with a barcode from the supplied workbook.
-- Existing products that conflict on any unique key are left untouched.
BEGIN;
DO $import$
DECLARE
  v_company_id uuid;
  v_category_id uuid;
  v_inserted integer;
BEGIN
  SELECT id INTO v_company_id FROM public.companies WHERE name = 'LBGS' AND status = 'active';
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Active LBGS company not found.'; END IF;
  INSERT INTO public.categories (company_id, name) VALUES (v_company_id, 'Alimentos e mercearia') ON CONFLICT (company_id, name) DO NOTHING;
  SELECT id INTO v_category_id FROM public.categories WHERE company_id = v_company_id AND name = 'Alimentos e mercearia' AND status = 'active';
  IF v_category_id IS NULL THEN RAISE EXCEPTION 'Active food catalog category not found.'; END IF;
  WITH source(name, unit_of_measure, barcode, brand) AS (
    VALUES
    (U&'Arroz Parboilizado', U&'kg', U&'7897051900532', NULL),
    (U&'Arroz branco', U&'kg', U&'7897051900525', NULL),
    (U&'Abacaxi em calda', U&'un', U&'7896434920174', NULL),
    (U&'Ameixa em calda', U&'un', U&'7891032016809', NULL),
    (U&'Feij\00E3o Carioca', U&'kg', U&'7897051900501', NULL),
    (U&'Feij\00E3o Preto', U&'kg', U&'7897051900518', NULL),
    (U&'A\00E7\00FAcar Cristal', U&'kg', U&'7897261800011', NULL),
    (U&'A\00E7ucar refinado', U&'un', U&'7891910000197', NULL),
    (U&'Amendoim', U&'kg', U&'7896752400877', NULL),
    (U&'Arrozina', U&'un', U&'7891150068285', NULL),
    (U&'Azeite de Dend\00EA', U&'l', U&'7898903301156', NULL),
    (U&'Batata Palha', U&'kg', U&'7896245704543', NULL),
    (U&'Caf\00E9 Em P\00F3', U&'kg', U&'7897206200227', NULL),
    (U&'Canela Em Casca', U&'kg', U&'7898466015637', NULL),
    (U&'Canela Em P\00F3', U&'un', U&'7896706300079', U&'NEILAR'),
    (U&'Canela Em P\00F3', U&'un', U&'7898466012124', NULL),
    (U&'Ch\00E1 de Erva Doce', U&'un', U&'7896722501344', NULL),
    (U&'Coco Ralado', U&'kg', U&'7898975650114', U&'brascoco'),
    (U&'Coco Ralado', U&'kg', U&'7898648022118', NULL),
    (U&'Cravo', U&'kg', U&'0630941228890', NULL),
    (U&'Doce de Banana - Nego Bom', U&'un', U&'7898354607005', NULL),
    (U&'Ervilha Em Conserva', U&'kg', U&'7899659901119', U&'bonare 170g'),
    (U&'Ervilha Seca', U&'kg', U&'7896752401447', NULL),
    (U&'Baunilha essencia', U&'un', U&'7895770023297', U&'AROMAX 900ml'),
    (U&'Baunilha essencia', U&'un', U&'7896025805798', U&'400 ml'),
    (U&'Extrato de Tomate', U&'kg', U&'7899659901041', U&'300g'),
    (U&'Extrato de Tomate', U&'kg', U&'7896041174144', U&'oderich 1kg'),
    (U&'Farinha de Mandioca Crua', U&'kg', U&'7898031690092', NULL),
    (U&'Farinha de Milho', U&'kg', U&'7898366931839', NULL),
    (U&'Farinha de Rosca', U&'kg', U&'7896752401300', NULL),
    (U&'Feij\00E3o Fradinho', U&'kg', U&'7898347951276', NULL),
    (U&'Fub\00E1 de milho', U&'un', U&'7896752420189', NULL),
    (U&'Goiabada Cremosa', U&'kg', U&'7908235000501', NULL),
    (U&'Leite de coco', U&'l', U&'7898994479185', U&'terra coco'),
    (U&'Leite de Coco', U&'l', U&'7898903301026', NULL),
    (U&'milho branco / canjica branca', U&'un', U&'7896752400495', NULL),
    (U&'Milho Verde Em Conserva', U&'un', U&'7899659901126', U&'bonare 170g'),
    (U&'Milho Verde Em Conserva', U&'kg', U&'7896041156034', U&'oderich 2kg'),
    (U&'Molho Ingl\00EAs (Frasco 900 Ml)', U&'un', U&'7898380260779', NULL),
    (U&'Or\00E9gano', U&'kg', U&'7898555470521', NULL),
    (U&'Soja Em Gr\00E3o', U&'kg', U&'7897051900839', NULL),
    (U&'Vinagre', U&'un', U&'7898286190491', U&'GOTA 750ml'),
    (U&'Vinagre', U&'un', U&'7897518200052', U&'sadio 500ml'),
    (U&'Xer\00E9m', U&'kg', U&'7892300017290', NULL),
    (U&'Ado\00E7ante L\00EDquido 100 Ml', U&'un', U&'7896292000537', NULL),
    (U&'Ado\00E7ante L\00EDquido 100 Ml', U&'un', U&'7898617582261', U&'MARATA'),
    (U&'Amido de Milho', U&'kg', U&'7896706300512', NULL),
    (U&'Arroz Integral', U&'kg', U&'7893500038931', NULL),
    (U&'Aveia Em Flocos Regulares', U&'kg', U&'7891095100958', NULL),
    (U&'Azeitona Verde', U&'kg', U&'7898075641166', U&'campos belo 500g'),
    (U&'Azeitona Verde', U&'kg', U&'07428332363440', U&'Rili alimentos 3KG'),
    (U&'Canjica', U&'kg', U&'7896481130441', NULL),
    (U&'Catchup', U&'kg', U&'7896025801172', U&'Cepera 1Kg'),
    (U&'Catchup', U&'un', U&'7898901903352', U&'Lancheiro 3KG'),
    (U&'Cremogema', U&'kg', U&'7891150085879', NULL),
    (U&'Farinha de Trigo Comum', U&'kg', U&'7896005276723', U&'Brandini'),
    (U&'Farinha de Trigo Comum', U&'kg', U&'7896090082063', NULL),
    (U&'Farinha L\00E1ctea Lata', U&'un', U&'7891000358764', NULL),
    (U&'Feij\00E3o Branco', U&'kg', U&'7898229830118', NULL),
    (U&'Gelatina de Abacaxi', U&'kg', U&'7898708161221', NULL),
    (U&'Gelatina de Cereja', U&'kg', U&'7898286809140', NULL),
    (U&'Gelatina de Lim\00E3o', U&'kg', U&'7898708161252', NULL),
    (U&'Gelatina de Morango', U&'kg', U&'7898286800352', NULL),
    (U&'Gelatina de Uva', U&'kg', U&'7898708161276', NULL),
    (U&'Gr\00E3o de Bico', U&'kg', U&'7896752401256', NULL),
    (U&'Leite Em P\00F3 Desnatado', U&'kg', U&'7908494801321', NULL),
    (U&'Leite Em P\00F3 Integral', U&'kg', U&'7908494800294', NULL),
    (U&'Lentilha', U&'kg', U&'7896752401782', U&'Poligr\00E3os 500g'),
    (U&'Lentilha', U&'kg', U&'7898466011110', U&'1KG'),
    (U&'Macarr\00E3o Parafuso Com Ovos', U&'kg', U&'7896022200206', NULL),
    (U&'Molho Shoyo (Frasco 900 Ml)', U&'un', U&'7898380260502', NULL),
    (U&'Mostarda Condimento', U&'kg', U&'7898901903840', NULL),
    (U&'Mucilagem de Arroz', U&'kg', U&'7891000357170', NULL),
    (U&'\00D3leo de Soja', U&'un', U&'7891107101621', U&'soya'),
    (U&'\00D3leo de Soja', U&'l', U&'7898247780297', NULL),
    (U&'Pa\00E7oca 20 G', U&'cx', U&'17898956846151', NULL),
    (U&'P\00E9 de Moleque 20 G', U&'un', U&'7898958830014', U&'O sabor da bahia'),
    (U&'P\00E9 de Moleque 20 G', U&'un', U&'7898956846055', NULL),
    (U&'Pudim de Baunilha Com Leite', U&'kg', U&'7896706301298', NULL),
    (U&'Pudim de Chocolate Com Leite', U&'kg', U&'7896706301335', NULL),
    (U&'Pudim de Coco Com Leite', U&'kg', U&'7896706301281', NULL),
    (U&'Pudim de Morango Com Leite', U&'kg', U&'7896706301311', NULL),
    (U&'Sal Refinado', U&'kg', U&'7898124620067', NULL),
    (U&'Tapioca Granulada', U&'kg', U&'7895098761048', NULL),
    (U&'Trigo Para Quibe', U&'kg', U&'7896752400914', U&'Poligr\00E3os'),
    (U&'Trigo Para Quibe', U&'un', U&'7898708160699', NULL)
  )
  INSERT INTO public.products (company_id, category_id, sku, name, barcode, brand, unit_of_measure, minimum_stock, status)
  SELECT v_company_id, v_category_id, 'EAN-' || source.barcode, source.name, source.barcode, source.brand, source.unit_of_measure, 0, 'active' FROM source
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Import complete: % new products; % of 86 already existed or conflicted.', v_inserted, 86 - v_inserted;
END;
$import$;
COMMIT;
