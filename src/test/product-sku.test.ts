import { describe, expect, it } from "vitest";
import { productSchema } from "@/lib/validation/schemas";

describe("SKU opcional no cadastro de produtos", () => {
  const validProduct = {
    name: "Filé de frango",
    sku: "",
    barcode: "",
    brand: "",
    categoryId: "category-1",
    description: "",
    unit: "kg",
    unitsPerPackage: "",
    minStock: 0,
    maxStock: "",
    unitCost: "",
    lotControl: false,
    expiryControl: false,
    active: true,
    notes: "",
  };

  it("converte SKU vazio em null sem inventar código", () => {
    const result = productSchema.parse(validProduct);
    expect(result.sku).toBeNull();
  });

  it("preserva o SKU informado", () => {
    const result = productSchema.parse({ ...validProduct, sku: "FORN-123" });
    expect(result.sku).toBe("FORN-123");
  });
});
