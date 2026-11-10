BEGIN;

-- Guarda a unidade vigente no momento da movimentação. Registros antigos ficam
-- nulos porque não é possível reconstruir a unidade histórica com segurança.
ALTER TABLE public.stock_movements
  ADD COLUMN unit_of_measure_at_movement text;

COMMENT ON COLUMN public.stock_movements.unit_of_measure_at_movement IS
  'Unidade do produto no momento da movimentação. NULL em registros históricos anteriores à captura.';

CREATE OR REPLACE FUNCTION private.capture_stock_movement_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  SELECT product.unit_of_measure
    INTO NEW.unit_of_measure_at_movement
  FROM public.products AS product
  WHERE product.id = NEW.product_id
    AND product.company_id = NEW.company_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'The stock movement product does not exist in the selected company.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_stock_movement_unit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER stock_movements_capture_unit
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION private.capture_stock_movement_unit();

-- Sem conversão validada, não permite reinterpretar saldo existente em outra unidade.
CREATE OR REPLACE FUNCTION private.enforce_product_unit_change_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.unit_of_measure IS DISTINCT FROM NEW.unit_of_measure THEN
    IF NOT private.has_active_access(
      OLD.company_id,
      NULL::uuid,
      ARRAY['admin', 'stock_manager']::public.profile_role[]
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Only an administrator or stock manager can change a product unit.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.stock_balances AS balance
      WHERE balance.company_id = OLD.company_id
        AND balance.product_id = OLD.id
        AND balance.quantity <> 0
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'The product unit cannot change while stock remains. Settle the balance first; no automatic unit conversion is performed.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_product_unit_change_role() FROM PUBLIC, anon, authenticated;

COMMIT;
