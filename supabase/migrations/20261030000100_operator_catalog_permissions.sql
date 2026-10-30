-- Permite aos operadores manter produtos ativos e cadastrar fornecedores,
-- sem conceder gerenciamento de categorias, inativação ou exclusão.
BEGIN;

DROP POLICY IF EXISTS products_update_operator_catalog ON public.products;
CREATE POLICY products_update_operator_catalog
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (
    status = 'active'
    AND private.has_active_access(
      company_id,
      NULL::uuid,
      ARRAY['operator']::public.profile_role[]
    )
  )
  WITH CHECK (
    status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.categories AS category
      WHERE category.id = category_id
        AND category.company_id = products.company_id
        AND category.status = 'active'
    )
    AND private.has_active_access(
      company_id,
      NULL::uuid,
      ARRAY['operator']::public.profile_role[]
    )
  );

DROP POLICY IF EXISTS suppliers_insert_operator_catalog ON public.suppliers;
CREATE POLICY suppliers_insert_operator_catalog
  ON public.suppliers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'active'
    AND private.has_active_access(
      company_id,
      NULL::uuid,
      ARRAY['operator']::public.profile_role[]
    )
  );

COMMIT;
