BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS units_per_package integer;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_units_per_package_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_units_per_package_check
  CHECK (units_per_package IS NULL OR units_per_package > 0);

COMMENT ON COLUMN public.products.units_per_package IS
  'Number of individual units in one stock package; null means no conversion is configured.';

COMMIT;
