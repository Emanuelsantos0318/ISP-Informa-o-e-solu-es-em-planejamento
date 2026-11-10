import { describe, expect, it } from "vitest";
import {
  allocateProductionDeliveries,
  calculateProductionEntry,
  calculateThawAt,
  compareProductionToStockExits,
  consolidateProductionEntries,
  consolidatePulpEntries,
  allocatePulpByWeekday,
  DEFAULT_FISH_THAW_HOURS,
  type ProductionEntry,
} from "@/lib/rules/production";
import {
  extractProteinMapCandidates,
  extractPulpCandidates,
} from "@/lib/production-workbook";

function calc(perCapita: number, volume: number) {
  return calculateProductionEntry({
    productId: "product-1",
    productName: "Proteína",
    audience: "patient",
    meal: "almoco",
    date: "2026-10-15",
    unit: "KG",
    perCapita,
    perCapitaUnit: "KG/PESSOA",
    volume,
    volumeUnit: "PESSOA",
    manualQuantity: null,
    manualReason: null,
  });
}

const entry = (
  productId: string | null,
  audience: ProductionEntry["audience"],
  quantity: number | null,
  unit = "KG",
  date = "2026-10-15",
): ProductionEntry => ({
  productId,
  productName: productId ? "Proteína" : "Nome histórico sem vínculo",
  audience,
  meal: "almoco",
  date,
  unit,
  perCapita: null,
  perCapitaUnit: null,
  volume: null,
  volumeUnit: null,
  manualQuantity: null,
  manualReason: null,
  calculatedQuantity: quantity,
  finalQuantity: quantity,
});

describe("regras de planejamento de produção", () => {
  it("não compara saídas históricas sem unidade registrada como zero", () => {
    const result = compareProductionToStockExits(
      [entry("product-1", "patient", 12)],
      [
        {
          productId: "product-1",
          productName: "Proteína",
          date: "2026-10-15",
          serviceCode: "almoco",
          quantity: 8,
          unit: null,
        },
      ],
    );

    expect(result.rows).toHaveLength(0);
    expect(result.plannedUnmatched).toHaveLength(1);
    expect(result.actualUnmatched).toHaveLength(1);
  });

  it.each([
    [0.08, 195, 15.6],
    [0.15, 265, 39.75],
    [0.2, 50, 10],
    [0.45, 500, 225],
    [0.014, 850, 11.9],
    [0.25, 600, 150],
  ])("calcula %s × %s sem arredondamento", (perCapita, volume, expected) => {
    expect(calc(perCapita, volume).calculatedQuantity).toBeCloseTo(expected, 8);
  });

  it("preserva zero como quantidade válida e sinaliza dados ausentes", () => {
    expect(calc(0, 0).calculatedQuantity).toBe(0);
    const result = calculateProductionEntry({
      productId: null,
      productName: "Carne histórica",
      audience: "patient",
      meal: "almoco",
      date: "",
      unit: "",
      perCapita: null,
      perCapitaUnit: null,
      volume: null,
      volumeUnit: null,
      manualQuantity: null,
      manualReason: null,
    });
    expect(result.finalQuantity).toBeNull();
    expect(result.pending.length).toBeGreaterThan(0);
  });

  it("exige motivo e preserva cálculo quando há ajuste manual", () => {
    const input = {
      productId: "product-1",
      productName: "Proteína",
      audience: "patient" as const,
      meal: "almoco",
      date: "2026-10-15",
      unit: "KG",
      perCapita: 0.25,
      perCapitaUnit: "KG/PESSOA",
      volume: 10,
      volumeUnit: "PESSOA",
      manualQuantity: 4,
      manualReason: "Ajuste conferido",
    };
    expect(calculateProductionEntry(input)).toEqual({
      calculatedQuantity: 2.5,
      finalQuantity: 4,
      pending: [],
    });
    expect(
      calculateProductionEntry({ ...input, manualReason: " " }).pending,
    ).toContain("Informe o motivo da quantidade manual.");
  });

  it("consolida por UUID e unidade sem misturar pacientes e servidores", () => {
    const result = consolidateProductionEntries([
      entry("product-1", "patient", 10),
      entry("product-1", "server", 3),
      entry("product-1", "patient", 2, "UN"),
      entry(null, "server", 99),
    ]);
    expect(result.totals).toHaveLength(2);
    expect(result.totals.find((row) => row.unit === "KG")).toMatchObject({
      patients: 10,
      servers: 3,
      total: 13,
    });
    expect(result.pendingEntries).toHaveLength(1);
  });

  it("aloca somente em janelas cadastradas e reporta não alocado", () => {
    const result = allocateProductionDeliveries(
      [
        entry("product-1", "patient", 4),
        entry("product-1", "patient", 2, "KG", "2026-10-20"),
      ],
      [
        {
          id: "delivery-1",
          label: "Primeira",
          fromDate: "2026-10-14",
          toDate: "2026-10-17",
        },
      ],
    );
    expect(result.allocation.get("delivery-1:product-1:KG")).toBe(4);
    expect(result.unallocated).toHaveLength(1);
  });

  it("calcula antecedência de degelo em horas; peixe inicia com 24 horas", () => {
    expect(DEFAULT_FISH_THAW_HOURS).toBe(24);
    expect(calculateThawAt("2026-10-16T12:00:00Z", 24)).toBe(
      "2026-10-15T12:00:00.000Z",
    );
    expect(calculateThawAt("inválida", 24)).toBeNull();
  });

  it("consolida polpas por sabor, público, serviço, dia e unidade", () => {
    const result = consolidatePulpEntries([
      {
        flavorId: "manga",
        originalFlavorText: null,
        audience: "patient",
        service: "lunch",
        date: "2026-10-15",
        quantity: 4,
        unit: "KG",
      },
      {
        flavorId: "manga",
        originalFlavorText: null,
        audience: "patient",
        service: "lunch",
        date: "2026-10-15",
        quantity: 2,
        unit: "KG",
      },
      {
        flavorId: "manga",
        originalFlavorText: null,
        audience: "server",
        service: "lunch",
        date: "2026-10-15",
        quantity: 3,
        unit: "KG",
      },
      {
        flavorId: null,
        originalFlavorText: "Cajá",
        audience: "patient",
        service: "snack",
        date: "2026-10-15",
        quantity: 0,
        unit: "KG",
      },
      {
        flavorId: null,
        originalFlavorText: null,
        audience: "patient",
        service: null,
        date: "2026-10-15",
        quantity: null,
        unit: null,
      },
    ]);
    expect(result.rows).toHaveLength(3);
    expect(
      result.rows.find(
        (row) => row.flavorId === "manga" && row.audience === "patient",
      )?.total,
    ).toBe(6);
    expect(
      result.rows.find(
        (row) => row.flavorId === "manga" && row.audience === "server",
      )?.total,
    ).toBe(3);
    expect(result.rows.some((row) => row.total === 0)).toBe(true);
    expect(result.pending).toHaveLength(1);
  });

  it("distribui polpas em três janelas e mantém dias sem faixa como pendência", () => {
    const entries = [
      {
        flavorId: "manga",
        originalFlavorText: null,
        audience: "patient" as const,
        service: "lunch",
        date: "2026-10-15",
        quantity: 5,
        unit: "KG",
      },
      {
        flavorId: "manga",
        originalFlavorText: null,
        audience: "patient" as const,
        service: "lunch",
        date: "2026-10-17",
        quantity: 7,
        unit: "KG",
      },
      {
        flavorId: "manga",
        originalFlavorText: null,
        audience: "patient" as const,
        service: "lunch",
        date: "2026-10-20",
        quantity: 9,
        unit: "KG",
      },
      {
        flavorId: "manga",
        originalFlavorText: null,
        audience: "patient" as const,
        service: "lunch",
        date: null,
        quantity: 2,
        unit: "KG",
      },
    ];
    const result = allocatePulpByWeekday(entries, [
      { id: "thursday-friday", fromDay: 4, toDay: 5 },
      { id: "weekend-monday", fromDay: 6, toDay: 1 },
      { id: "tuesday-wednesday", fromDay: 2, toDay: 3 },
    ]);
    expect(
      result.allocation.get("thursday-friday:manga:KG:patient:lunch"),
    ).toBe(5);
    expect(result.allocation.get("weekend-monday:manga:KG:patient:lunch")).toBe(
      7,
    );
    expect(
      result.allocation.get("tuesday-wednesday:manga:KG:patient:lunch"),
    ).toBe(9);
    expect(result.unallocated).toHaveLength(1);
  });

  it("não mistura públicos/serviços e deixa datas com janelas sobrepostas pendentes", () => {
    const entries = [
      {
        flavorId: "manga",
        originalFlavorText: null,
        audience: "patient",
        service: "lunch",
        date: "2026-10-15",
        quantity: 5,
        unit: "KG",
      },
      {
        flavorId: "manga",
        originalFlavorText: null,
        audience: "server",
        service: "lunch",
        date: "2026-10-15",
        quantity: 2,
        unit: "KG",
      },
    ] as const;
    const separated = allocatePulpByWeekday(
      [...entries],
      [{ id: "thursday-friday", fromDay: 4, toDay: 5 }],
    );
    expect(separated.allocations).toHaveLength(2);
    expect(separated.allocations.map((row) => row.audience).sort()).toEqual([
      "patient",
      "server",
    ]);

    const result = allocatePulpByWeekday(
      [...entries],
      [
        { id: "overlap-a", fromDay: 4, toDay: 5 },
        { id: "overlap-b", fromDay: 4, toDay: 6 },
      ],
    );
    expect(result.allocations).toHaveLength(0);
    expect(result.unallocated).toHaveLength(2);
  });
});

describe("reconhecimento conservador da aba POLPA", () => {
  it("reconhece sabor, público, serviço e quantidade sem trocar vazio por zero", () => {
    const cells: Record<string, unknown> = {
      "2:1": "PLANEJAMENTO POLPA - PEDIDO SEMANAL - SERVIDOR",
      "3:1": "DATA",
      "3:2": "SABOR - DESJEJUM",
      "3:3": "KG",
      "4:1": new Date("2026-10-02T00:00:00.000Z"),
      "4:2": "Acerola",
      "4:3": 10,
      "5:1": { formula: "A4+1", result: new Date("2026-10-03T00:00:00.000Z") },
      "5:2": "Umbu",
      "5:3": 0,
      "6:2": "Manga",
      "6:3": 5,
      "13:1": "PLANEJAMENTO POLPA - PEDIDO SEMANAL - PACIENTE",
      "14:1": "DATA",
      "14:2": "SABOR - ALMOÇO",
      "14:3": "KG",
      "15:1": new Date("2026-10-02T00:00:00.000Z"),
      "15:2": "Cajá",
      "15:3": 40,
      "16:1": new Date("2026-10-03T00:00:00.000Z"),
      "16:2": "Graviola",
    };
    const candidates = extractPulpCandidates(
      "POLPA",
      16,
      (row, column) => cells[`${row}:${column}`],
    );
    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toMatchObject({
      audience_code: "server",
      service_code: "breakfast",
      flavor_text: "Acerola",
      source_date: "2026-10-02",
      date_source: "explicit",
      quantity: 10,
      quantity_unit: "KG",
    });
    expect(candidates[1]).toMatchObject({
      source_date: "2026-10-03",
      date_source: "formula_cache",
      quantity: 0,
    });
    expect(candidates[2]).toMatchObject({
      source_date: "2026-10-03",
      date_source: "inherited_from_block",
      quantity: 5,
    });
    expect(candidates[3]).toMatchObject({
      audience_code: "patient",
      service_code: "lunch",
      flavor_text: "Cajá",
      quantity: 40,
    });
    expect(candidates[4]).toMatchObject({
      flavor_text: "Graviola",
      quantity: null,
    });
  });

  it("não tenta interpretar mapas de proteína ou outras abas como polpa", () => {
    expect(extractPulpCandidates("MAPA 15-10", 1, () => null)).toEqual([]);
  });

  it("reconhece linhas dos mapas e deixa divergência entre aba e título sem data sugerida", () => {
    const cells: Record<string, unknown> = {
      "1:1": "MAPA DE PROTEINA QUINTA FEIRA 05-11",
      "2:1": "DESJEJUM SERVIDOR",
      "3:1": "UNIDADE",
      "3:2": "PREPARAÇÃO",
      "3:3": "TIPO DE PTN",
      "3:4": "VOLUME",
      "3:5": "KG TOTAL",
      "4:1": "DESJEJUM SERVIDOR",
      "4:2": "QUEIJO",
      "4:3": "MUSSARELA",
      "4:4": 330,
      "4:5": 9.9,
      "5:1": "DESJEJUM SERVIDOR",
      "5:2": "[object Object]",
      "5:3": "Não informado",
      "5:4": "Não informado",
      "5:5": "Não informado",
    };
    const rows = extractProteinMapCandidates(
      "MAPA 15-10",
      5,
      (row, column) => cells[`${row}:${column}`],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      record_type: "protein_map",
      preparation: "QUEIJO",
      product_text: "MUSSARELA",
      audience_code: "server",
      meal_code: "breakfast",
      cached_quantity: 9.9,
      source_date: null,
      date_conflict:
        "Aba indica 15-10; título indica 5-11. Confirme a data real.",
    });
    const datedCells: Record<string, unknown> = {
      "1:1": "MAPA DE PROTEÍNA – QUINTA 15/10/2026",
      "2:1": "ALMOÇO PACIENTE",
      "3:1": "UNIDADE",
      "3:2": "PREPARAÇÃO",
      "3:3": "TIPO DE PTN",
      "3:4": "VOLUME",
      "3:5": "KG TOTAL",
      "4:1": "PACIENTE",
      "4:2": "Frango grelhado",
      "4:3": "Peito de frango",
      "4:4": 35,
      "4:5": 8.75,
    };
    const dated = extractProteinMapCandidates(
      "MAPA 15-10",
      4,
      (row, column) => datedCells[`${row}:${column}`],
    );
    expect(dated).toHaveLength(1);
    expect(dated[0]).toMatchObject({
      preparation: "Frango grelhado",
      audience_code: "patient",
      meal_code: "lunch",
      cached_quantity: 8.75,
      source_date: "2026-10-15",
      date_source: "explicit",
    });
  });
});
