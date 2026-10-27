import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const input = value("--input");
const companyId = value("--company");
const unitId = value("--unit");
if (!input || !companyId || !unitId) {
  throw new Error(
    "Uso: node scripts/prepare-legacy-backup-import.mjs --input <backup.json> --company <uuid> --unit <uuid>",
  );
}
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuidPattern.test(companyId) || !uuidPattern.test(unitId)) {
  throw new Error("Company e unit precisam ser UUIDs válidos.");
}

const backup = JSON.parse(await readFile(resolve(input), "utf8"));
if (
  backup.app !== "almox-hgrs" ||
  !Array.isArray(backup.products) ||
  !Array.isArray(backup.withdrawals)
) {
  throw new Error("O arquivo não corresponde ao backup almox-hgrs esperado.");
}
if (backup.products.length !== 402 || backup.withdrawals.length !== 220) {
  throw new Error(
    `Contagens inesperadas: ${backup.products.length} produtos e ${backup.withdrawals.length} saídas. Nenhum SQL foi gerado.`,
  );
}
const distinct = (rows, field) =>
  new Set(rows.map((row) => String(row[field]))).size;
if (
  distinct(backup.products, "id") !== backup.products.length ||
  distinct(backup.withdrawals, "id") !== backup.withdrawals.length
) {
  throw new Error(
    "Há identificadores duplicados no backup; importação cancelada.",
  );
}

let delimiter = "$isp_backup$";
while (JSON.stringify(backup).includes(delimiter)) delimiter += "x";
const serialized = JSON.stringify(backup);
const sql = `-- Generated locally from the user-provided almox-hgrs JSON backup.
-- Do not commit this file: it contains historical operator and movement data.
BEGIN;
DO $scope$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.units WHERE id = '${unitId}' AND company_id = '${companyId}' AND status = 'active') THEN
    RAISE EXCEPTION 'The requested active company/unit scope does not exist.';
  END IF;
END;
$scope$;

CREATE TEMP TABLE isp_backup_payload ON COMMIT DROP AS
SELECT '${companyId}'::uuid AS company_id, '${unitId}'::uuid AS unit_id, ${delimiter}${serialized}${delimiter}::jsonb AS data;

INSERT INTO public.legacy_inventory_products (company_id, unit_id, source_app, source_product_id, source_payload)
SELECT company_id, unit_id, 'almox-hgrs', item->>'id', item
FROM isp_backup_payload, LATERAL jsonb_array_elements(data->'products') item
ON CONFLICT (company_id, unit_id, source_app, source_product_id) DO NOTHING;

INSERT INTO public.categories (company_id, name)
SELECT DISTINCT payload.company_id, product->>'category'
FROM isp_backup_payload payload
CROSS JOIN LATERAL jsonb_array_elements(payload.data->'products') product
WHERE nullif(product->>'category', '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.categories existing
    WHERE existing.company_id = payload.company_id AND existing.name = product->>'category'
  );

DO $import_products$
DECLARE
  source_row record;
  payload jsonb;
  units text[] := ARRAY['un','pct','cx','ct','mi','m','kg','l'];
  product_unit text;
  target_category_id uuid;
  candidate_count integer;
  candidate_product_id uuid;
  source_barcodes text[];
  selected_barcode text;
  new_product_id uuid;
BEGIN
  FOR source_row IN
    SELECT * FROM public.legacy_inventory_products
    WHERE company_id = '${companyId}'::uuid AND unit_id = '${unitId}'::uuid AND source_app = 'almox-hgrs'
    ORDER BY source_product_id
  LOOP
    IF source_row.product_id IS NOT NULL THEN CONTINUE; END IF;
    payload := source_row.source_payload;
    product_unit := lower(trim(coalesce(payload->>'sourceUnit', '')));
    IF product_unit = '' OR NOT (product_unit = ANY(units)) THEN CONTINUE; END IF;

    SELECT id INTO target_category_id FROM public.categories
    WHERE company_id = source_row.company_id AND name = payload->>'category'
    ORDER BY created_at, id LIMIT 1;
    source_barcodes := ARRAY(
      SELECT barcode.value
      FROM jsonb_array_elements_text(coalesce(payload->'barcodes', '[]'::jsonb)) AS barcode(value)
      WHERE length(barcode.value) > 0
    );
    candidate_product_id := NULL;
    candidate_count := 0;
    IF coalesce(array_length(source_barcodes, 1), 0) > 0 THEN
      SELECT count(DISTINCT product.id), min(product.id::text)::uuid
      INTO candidate_count, candidate_product_id
      FROM public.products product
      WHERE product.company_id = source_row.company_id AND product.barcode = ANY(source_barcodes);
    ELSE
      SELECT count(*), min(product.id::text)::uuid
      INTO candidate_count, candidate_product_id
      FROM public.products product
      WHERE product.company_id = source_row.company_id
        AND product.name = payload->>'name'
        AND product.unit_of_measure = product_unit
        AND coalesce(product.brand, '') = coalesce(payload->>'brand', '')
        AND product.category_id IS NOT DISTINCT FROM target_category_id;
    END IF;

    IF candidate_count = 1 THEN
      UPDATE public.legacy_inventory_products SET product_id = candidate_product_id
      WHERE company_id = source_row.company_id AND unit_id = source_row.unit_id
        AND source_app = source_row.source_app AND source_product_id = source_row.source_product_id;
      CONTINUE;
    ELSIF candidate_count > 1 THEN
      CONTINUE;
    END IF;

    selected_barcode := CASE WHEN coalesce(array_length(source_barcodes, 1), 0) = 1 THEN source_barcodes[1] ELSE NULL END;
    IF selected_barcode IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.products WHERE company_id = source_row.company_id AND barcode = selected_barcode
    ) THEN CONTINUE; END IF;
    IF length(payload->>'name') NOT BETWEEN 1 AND 200 THEN CONTINUE; END IF;

    INSERT INTO public.products (company_id, category_id, sku, name, barcode, brand, unit_of_measure, minimum_stock, status)
    VALUES (
      source_row.company_id, target_category_id,
      'LEGACY-' || substr(md5(source_row.source_app || ':' || source_row.source_product_id), 1, 32),
      payload->>'name', selected_barcode, nullif(payload->>'brand', ''), product_unit, 0, 'active'
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO new_product_id;
    IF new_product_id IS NOT NULL THEN
      UPDATE public.legacy_inventory_products SET product_id = new_product_id
      WHERE company_id = source_row.company_id AND unit_id = source_row.unit_id
        AND source_app = source_row.source_app AND source_product_id = source_row.source_product_id;
    END IF;
  END LOOP;
END;
$import_products$;

INSERT INTO public.legacy_stock_withdrawals (
  company_id, unit_id, source_app, source_withdrawal_id, source_product_id,
  product_id, occurred_at, source_payload
)
SELECT payload.company_id, payload.unit_id, 'almox-hgrs', event->>'id', event->>'productId',
       source_product.product_id, nullif(event->>'timestamp', '')::timestamptz, event
FROM isp_backup_payload payload
CROSS JOIN LATERAL jsonb_array_elements(payload.data->'withdrawals') event
LEFT JOIN public.legacy_inventory_products source_product
  ON source_product.company_id = payload.company_id AND source_product.unit_id = payload.unit_id
 AND source_product.source_app = 'almox-hgrs' AND source_product.source_product_id = event->>'productId'
ON CONFLICT (company_id, unit_id, source_app, source_withdrawal_id) DO NOTHING;

SELECT jsonb_build_object(
  'source_products', count(*),
  'products_linked', count(product_id),
  'products_pending_validation', count(*) FILTER (WHERE product_id IS NULL),
  'source_withdrawals', (SELECT count(*) FROM public.legacy_stock_withdrawals WHERE company_id = '${companyId}'::uuid AND unit_id = '${unitId}'::uuid AND source_app = 'almox-hgrs'),
  'withdrawals_linked_to_catalog', (SELECT count(*) FROM public.legacy_stock_withdrawals WHERE company_id = '${companyId}'::uuid AND unit_id = '${unitId}'::uuid AND source_app = 'almox-hgrs' AND product_id IS NOT NULL),
  'withdrawals_without_product_link', (SELECT count(*) FROM public.legacy_stock_withdrawals WHERE company_id = '${companyId}'::uuid AND unit_id = '${unitId}'::uuid AND source_app = 'almox-hgrs' AND product_id IS NULL)
)
FROM public.legacy_inventory_products
WHERE company_id = '${companyId}'::uuid AND unit_id = '${unitId}'::uuid AND source_app = 'almox-hgrs';
COMMIT;
`;
const output = resolve("tmp/legacy-backup-import.sql");
await mkdir(resolve("tmp"), { recursive: true });
await writeFile(output, sql, "utf8");
console.log(
  `Generated ${output} from ${backup.products.length} products and ${backup.withdrawals.length} withdrawals.`,
);
