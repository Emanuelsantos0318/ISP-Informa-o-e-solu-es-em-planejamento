BEGIN;

ALTER TABLE public.production_hortifruti_entries
  ADD COLUMN per_capita numeric(18, 8),
  ADD COLUMN per_capita_unit text,
  ADD COLUMN volume numeric(18, 6),
  ADD COLUMN volume_unit text,
  ADD COLUMN calculated_quantity numeric(18, 6),
  ADD COLUMN manual_quantity numeric(18, 6),
  ADD COLUMN manual_reason text;

ALTER TABLE public.production_hortifruti_entries
  ADD CONSTRAINT production_hortifruti_per_capita_nonnegative
    CHECK (per_capita IS NULL OR per_capita >= 0),
  ADD CONSTRAINT production_hortifruti_volume_nonnegative
    CHECK (volume IS NULL OR volume >= 0),
  ADD CONSTRAINT production_hortifruti_calculated_quantity_nonnegative
    CHECK (calculated_quantity IS NULL OR calculated_quantity >= 0),
  ADD CONSTRAINT production_hortifruti_manual_quantity_nonnegative
    CHECK (manual_quantity IS NULL OR manual_quantity >= 0),
  ADD CONSTRAINT production_hortifruti_manual_reason_check
    CHECK (manual_quantity IS NULL OR length(trim(coalesce(manual_reason, ''))) BETWEEN 1 AND 500),
  ADD CONSTRAINT production_hortifruti_per_capita_pair_check
    CHECK ((per_capita IS NULL) = (volume IS NULL));

CREATE OR REPLACE FUNCTION private.calculate_hortifruti_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  numerator text;
  denominator text;
BEGIN
  IF NEW.per_capita IS NOT NULL THEN
    IF length(trim(coalesce(NEW.per_capita_unit, ''))) = 0
       OR length(trim(coalesce(NEW.volume_unit, ''))) = 0 THEN
      RAISE EXCEPTION 'Informe as unidades de per capita e volume.' USING ERRCODE = '23514';
    END IF;

    IF position('/' IN NEW.per_capita_unit) = 0 THEN
      RAISE EXCEPTION 'A unidade do per capita deve usar o formato quantidade/pessoa.' USING ERRCODE = '23514';
    END IF;

    numerator := upper(trim(split_part(NEW.per_capita_unit, '/', 1)));
    denominator := upper(trim(split_part(NEW.per_capita_unit, '/', 2)));
    IF numerator <> upper(trim(NEW.quantity_unit))
       OR denominator <> upper(trim(NEW.volume_unit)) THEN
      RAISE EXCEPTION 'Unidades incompatíveis; nenhuma conversão automática foi aplicada.' USING ERRCODE = '23514';
    END IF;

    NEW.calculated_quantity := NEW.per_capita * NEW.volume;
  ELSE
    NEW.calculated_quantity := NULL;
  END IF;

  IF NEW.manual_quantity IS NOT NULL THEN
    IF length(trim(coalesce(NEW.manual_reason, ''))) = 0 THEN
      RAISE EXCEPTION 'Informe o motivo do ajuste manual.' USING ERRCODE = '23514';
    END IF;
    NEW.quantity := NEW.manual_quantity;
  ELSIF NEW.calculated_quantity IS NOT NULL THEN
    NEW.quantity := NEW.calculated_quantity;
  ELSIF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Informe per capita e volume ou um total manual justificado.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.calculate_hortifruti_quantity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER production_hortifruti_entries_calculate_quantity
  BEFORE INSERT OR UPDATE OF per_capita, per_capita_unit, volume, volume_unit,
    quantity_unit, manual_quantity, manual_reason
  ON public.production_hortifruti_entries
  FOR EACH ROW EXECUTE FUNCTION private.calculate_hortifruti_quantity();

COMMENT ON COLUMN public.production_hortifruti_entries.per_capita IS
  'Quantidade de hortifruti prevista por unidade de volume, sem conversão automática.';
COMMENT ON COLUMN public.production_hortifruti_entries.volume IS
  'Número de pessoas ou outra unidade definida para calcular a necessidade de hortifruti.';
COMMENT ON COLUMN public.production_hortifruti_entries.calculated_quantity IS
  'Resultado de per_capita × volume, separado de eventual ajuste manual.';

COMMIT;
