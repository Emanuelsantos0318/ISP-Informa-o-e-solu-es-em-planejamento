import type { UnitCode } from "@/lib/config/units";

export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  brand?: string | null | undefined;
  unit: UnitCode;
  balance: number;
  lotControl: boolean;
  expiryControl: boolean;
};

export type MovementItemDraft = {
  key: string;
  product: Product;
  quantity: number;
  lot?: string | undefined;
  expiry?: string | undefined;
};

export type ProductPrefill = {
  name?: string | undefined;
  sku?: string | undefined;
  barcode?: string | undefined;
};

/** Interprets a search term to prefill the right field of a new product. */
export function prefillFromQuery(query: string): ProductPrefill {
  const q = query.trim();
  if (!q) return {};
  if (/^\d{8,14}$/.test(q)) return { barcode: q };
  if (!/\s/.test(q) && /\d/.test(q) && /^[A-Za-z0-9-_.]+$/.test(q))
    return { sku: q.toUpperCase() };
  return { name: q };
}

/** Finds products by barcode, SKU, full or partial name (case/accent-insensitive). */
export function searchProducts(products: Product[], query: string): Product[] {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  const q = norm(query);
  if (!q) return [];
  const exact = products.filter(
    (p) => p.barcode === query.trim() || norm(p.sku) === q,
  );
  if (exact.length) return exact;
  return products.filter((p) => norm(p.name).includes(q));
}
