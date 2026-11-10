import { describe, expect, it } from "vitest";
import { mapMovementPartsToRequestItems } from "@/lib/supabase/inventory";

describe("vínculo das partes de movimentação com os itens solicitados", () => {
  it("mantém a linha original quando uma saída divide o produto entre lotes", () => {
    const requested = [
      { product_id: "product-a", quantity: 10 },
      { product_id: "product-b", quantity: 2 },
    ];
    const movements = [
      { productId: "product-a", quantity: 6 },
      { productId: "product-a", quantity: 4 },
      { productId: "product-b", quantity: 2 },
    ];

    expect(mapMovementPartsToRequestItems(requested, movements)).toEqual([
      0, 0, 1,
    ]);
  });

  it("distingue duas linhas consecutivas do mesmo produto", () => {
    const requested = [
      { product_id: "product-a", quantity: 2 },
      { product_id: "product-a", quantity: 3 },
    ];
    const movements = [
      { productId: "product-a", quantity: 2 },
      { productId: "product-a", quantity: 3 },
    ];

    expect(mapMovementPartsToRequestItems(requested, movements)).toEqual([
      0, 1,
    ]);
  });

  it("marca movimento sem correspondência para usar o fallback histórico", () => {
    expect(
      mapMovementPartsToRequestItems(
        [{ product_id: "product-a", quantity: 1 }],
        [{ productId: "product-b", quantity: 1 }],
      ),
    ).toEqual([-1]);
  });
});
