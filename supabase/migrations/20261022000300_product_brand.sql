BEGIN;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand text;

DO $brand_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_brand_length_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_brand_length_check
      CHECK (brand IS NULL OR length(trim(brand)) <= 120);
  END IF;
END;
$brand_check$;

COMMENT ON COLUMN public.products.brand IS 'Optional product brand from the operational catalog.';
COMMIT;