-- Operators may register new products from the exit workflow.
-- Existing catalog rows remain editable only by administrators and stock managers.
CREATE POLICY products_insert_operator_catalog
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.categories AS category
      WHERE category.id = category_id
        AND category.company_id = products.company_id
        AND category.status = 'active'
    )
    AND
    private.has_active_access(
      company_id,
      NULL::uuid,
      ARRAY['operator']::public.profile_role[]
    )
  );
