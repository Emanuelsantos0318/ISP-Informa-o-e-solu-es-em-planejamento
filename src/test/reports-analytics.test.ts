import { describe, expect, it } from "vitest";
import {
  calculateReportAnalytics,
  type ReportFilters,
} from "@/lib/reports/analytics";
import type { InventorySnapshot } from "@/lib/supabase/inventory";

const filters: ReportFilters = {
  from: "2026-11-01",
  to: "2026-11-07",
  categoryId: "todos",
  productId: "todos",
  brand: "todos",
  supplierId: "todos",
  movementType: "todos",
  service: "todos",
  userId: "todos",
  status: "todos",
  unit: "todos",
};

const snapshot: InventorySnapshot = {
  products: [
    {
      id: "p-kg",
      companyId: "c",
      categoryId: "cat",
      categoryName: "Alimentos",
      supplierId: null,
      name: "Arroz",
      sku: "1",
      barcode: null,
      brand: null,
      unit: "kg",
      minimum: 3,
      target: 10,
      active: true,
      balance: 8,
    },
    {
      id: "p-un",
      companyId: "c",
      categoryId: "cat",
      categoryName: "Alimentos",
      supplierId: null,
      name: "Copo",
      sku: "2",
      barcode: null,
      brand: null,
      unit: "un",
      minimum: 5,
      target: 20,
      active: true,
      balance: 12,
    },
  ],
  lots: [],
  movements: [
    {
      id: "m1",
      unitId: "u",
      type: "exit",
      occurredAt: "2026-11-05T12:00:00.000Z",
      service: "almoco",
      exitType: null,
      supplierId: null,
      sourceReference: null,
      note: null,
      userId: "user",
      itemCount: 1,
      items: [
        {
          id: "i1",
          productId: "p-kg",
          name: "Arroz",
          sku: "1",
          unit: "kg",
          quantity: 14,
          lotNumber: null,
          expiresOn: null,
          adjustmentDirection: null,
          unitsReleased: null,
          unitsPerPackage: null,
          destination: null,
          recipient: null,
        },
      ],
      userName: "Operador",
    },
    {
      id: "m2",
      unitId: "u",
      type: "exit",
      occurredAt: "2026-11-06T12:00:00.000Z",
      service: "almoco",
      exitType: null,
      supplierId: null,
      sourceReference: null,
      note: null,
      userId: "user",
      itemCount: 1,
      items: [
        {
          id: "i2",
          productId: "p-un",
          name: "Copo",
          sku: "2",
          unit: "un",
          quantity: 100,
          lotNumber: null,
          expiresOn: null,
          adjustmentDirection: null,
          unitsReleased: null,
          unitsPerPackage: null,
          destination: null,
          recipient: null,
        },
      ],
      userName: "Operador",
    },
  ],
};

describe("cálculos da Central de Relatórios", () => {
  it("não soma quantidades de unidades diferentes", () => {
    const result = calculateReportAnalytics(snapshot, filters);
    expect(result.unitCompatible).toBe(false);
    expect(result.exits).toBeNull();
    expect(result.currentPeriodExits).toBeNull();
    expect(result.productRows.map((row) => row.exits)).toEqual([14, 100]);
    expect(result.byUnit).toEqual([
      { unit: "kg", entries: 0, exits: 14, losses: 0 },
      { unit: "un", entries: 0, exits: 100, losses: 0 },
    ]);
  });

  it("calcula consumo e média quando a unidade está definida", () => {
    const result = calculateReportAnalytics(snapshot, {
      ...filters,
      unit: "kg",
    });
    expect(result.unitCompatible).toBe(true);
    expect(result.exits).toBe(14);
    expect(result.productRows).toHaveLength(1);
    expect(result.productRows[0]?.averageDaily).toBe(2);
    expect(result.productRows[0]?.coverage).toBe(4);
  });

  it("aplica categoria e serviço sem incluir outros itens", () => {
    const result = calculateReportAnalytics(snapshot, {
      ...filters,
      categoryId: "cat",
      unit: "un",
      service: "almoco",
    });
    expect(result.movementRows).toHaveLength(1);
    expect(result.movementRows[0]?.item.productId).toBe("p-un");
    expect(result.exits).toBe(100);
  });

  it("mantém históricos sem saída sem inventar consumo", () => {
    const noMovement = { ...snapshot, movements: [] };
    const result = calculateReportAnalytics(noMovement, {
      ...filters,
      unit: "kg",
    });
    expect(result.productRows[0]?.averageDaily).toBeNull();
    expect(result.productRows[0]?.coverage).toBeNull();
    expect(result.priorPeriodExits).toBeNull();
  });
});
