-- Restringe a troca da unidade de medida a perfis administrativos.
-- O saldo numérico atual não é convertido por esta alteração.
BEGIN;

CREATE OR REPLACE FUNCTION private.enforce_product_unit_change_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.unit_of_measure IS DISTINCT FROM NEW.unit_of_measure
     AND NOT private.has_active_access(
       OLD.company_id,
       NULL::uuid,
       ARRAY['admin', 'stock_manager']::public.profile_role[]
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Only an administrator or stock manager can change a product unit.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_product_unit_change_role() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_unit_change_role ON public.products;
CREATE TRIGGER products_unit_change_role
  BEFORE UPDATE OF unit_of_measure ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_product_unit_change_role();

COMMIT;
