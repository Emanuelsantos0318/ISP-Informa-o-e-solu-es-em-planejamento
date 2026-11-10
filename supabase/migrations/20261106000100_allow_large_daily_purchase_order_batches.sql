-- Relatórios diários podem conter mais de 100 linhas em uma única entrada.
-- Mantém a RPC existente e eleva somente o limite validado do lote para 500.
DO $migration$
DECLARE
  v_definition text;
  v_updated_definition text;
  v_function regprocedure := 'public.record_stock_movement_batch(uuid,public.stock_movement_type,timestamp with time zone,uuid,jsonb,text,text,uuid,text,text)'::regprocedure;
BEGIN
  SELECT pg_get_functiondef(v_function) INTO v_definition;

  v_updated_definition := replace(
    v_definition,
    'jsonb_array_length(p_items) > 100 THEN',
    'jsonb_array_length(p_items) > 500 THEN'
  );
  v_updated_definition := replace(
    v_updated_definition,
    'between 1 and 100 items.',
    'between 1 and 500 items.'
  );

  IF v_updated_definition = v_definition
     OR position('jsonb_array_length(p_items) > 500 THEN' IN v_updated_definition) = 0 THEN
    RAISE EXCEPTION 'Could not safely update movement batch size limit.';
  END IF;

  EXECUTE v_updated_definition;
END;
$migration$;
