ALTER TABLE public.suppliers
  ADD COLUMN cnpj text;

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_cnpj_check
  CHECK (cnpj IS NULL OR cnpj ~ '^\d{14}$');

CREATE UNIQUE INDEX suppliers_company_cnpj_unique
  ON public.suppliers (company_id, cnpj)
  WHERE cnpj IS NOT NULL;
