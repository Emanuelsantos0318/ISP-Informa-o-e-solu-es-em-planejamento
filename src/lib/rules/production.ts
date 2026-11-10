import { subtractHoursFromIso } from "@/lib/datetime";

/** Regras puras do Planejamento de Produção; não fazem chamadas ao estoque. */
export type ProductionAudience = "patient" | "server";

export type ProductionEntryInput = {
  productId: string | null;
  productName: string;
  audience: ProductionAudience;
  meal: string;
  date: string;
  unit: string;
  perCapita: number | null;
  perCapitaUnit: string | null;
  volume: number | null;
  volumeUnit: string | null;
  manualQuantity: number | null;
  manualReason: string | null;
};

export type ProductionEntryResult = {
  calculatedQuantity: number | null;
  finalQuantity: number | null;
  pending: string[];
};

export type ProductionEntry = ProductionEntryInput & {
  calculatedQuantity: number | null;
  finalQuantity: number | null;
};

export type ProductionTotals = {
  productId: string;
  productName: string;
  unit: string;
  patients: number;
  servers: number;
  total: number;
  byDate: Map<string, number>;
  byMeal: Map<string, number>;
};

export type ProductionStockExit = {
  productId: string | null;
  productName: string;
  date: string;
  serviceCode: string | null;
  quantity: number;
  unit: string | null;
};

const PRODUCTION_MEAL_TO_STOCK_SERVICE: Record<string, string | undefined> = {
  breakfast: "desjejum",
  morning_snack: "colacao",
  lunch: "almoco",
  afternoon_snack: "lanche",
  // Jantar e ceia têm códigos distintos no estoque e ainda não há equivalência operacional confirmada.
};

export function compareProductionToStockExits(
  plannedEntries: ProductionEntry[],
  actualExits: ProductionStockExit[],
) {
  type ComparisonRow = {
    key: string;
    date: string;
    serviceCode: string;
    productId: string;
    productName: string;
    unit: string;
    planned: number;
    actual: number;
  };
  const groups = new Map<
    string,
    {
      planned: Map<string, { quantity: number; entry: ProductionEntry }>;
      actual: Map<string, { quantity: number; exit: ProductionStockExit }>;
      date: string;
      serviceCode: string;
      productId: string;
      productName: string;
    }
  >();
  const plannedUnmatched: ProductionEntry[] = [];
  const actualUnmatched: ProductionStockExit[] = [];
  const actualWithoutKnownUnit = new Set<string>();
  const comparisonKey = (
    date: string,
    serviceCode: string,
    productId: string,
  ) => [date, serviceCode, productId].join("|");
  const getGroup = (
    date: string,
    serviceCode: string,
    productId: string,
    productName: string,
  ) => {
    const key = [date, serviceCode, productId].join("|");
    const group = groups.get(key) ?? {
      planned: new Map(),
      actual: new Map(),
      date,
      serviceCode,
      productId,
      productName,
    };
    groups.set(key, group);
    return group;
  };

  for (const entry of plannedEntries) {
    const serviceCode = PRODUCTION_MEAL_TO_STOCK_SERVICE[entry.meal];
    if (
      !entry.productId ||
      !entry.date ||
      entry.finalQuantity === null ||
      !entry.unit ||
      !serviceCode
    ) {
      plannedUnmatched.push(entry);
      continue;
    }
    const group = getGroup(
      entry.date,
      serviceCode,
      entry.productId,
      entry.productName,
    );
    const current = group.planned.get(entry.unit) ?? { quantity: 0, entry };
    current.quantity += entry.finalQuantity;
    group.planned.set(entry.unit, current);
  }

  const stockServiceCodes = new Set(
    Object.values(PRODUCTION_MEAL_TO_STOCK_SERVICE),
  );
  for (const exit of actualExits) {
    if (
      exit.productId &&
      exit.date &&
      exit.serviceCode &&
      !exit.unit &&
      stockServiceCodes.has(exit.serviceCode)
    ) {
      actualWithoutKnownUnit.add(
        comparisonKey(exit.date, exit.serviceCode, exit.productId),
      );
    }
    if (
      !exit.productId ||
      !exit.date ||
      !exit.serviceCode ||
      !exit.unit ||
      !stockServiceCodes.has(exit.serviceCode)
    ) {
      actualUnmatched.push(exit);
      continue;
    }
    const group = getGroup(
      exit.date,
      exit.serviceCode,
      exit.productId,
      exit.productName,
    );
    const current = group.actual.get(exit.unit) ?? { quantity: 0, exit };
    current.quantity += exit.quantity;
    group.actual.set(exit.unit, current);
  }

  const rows: ComparisonRow[] = [];
  for (const group of groups.values()) {
    if (
      actualWithoutKnownUnit.has(
        comparisonKey(group.date, group.serviceCode, group.productId),
      )
    ) {
      plannedUnmatched.push(
        ...[...group.planned.values()].map(({ entry }) => entry),
      );
      continue;
    }
    const plannedUnits = new Set(group.planned.keys());
    const actualUnits = new Set(group.actual.keys());
    const unitsConflict =
      group.planned.size > 0 &&
      group.actual.size > 0 &&
      (plannedUnits.size !== actualUnits.size ||
        [...plannedUnits].some((unit) => !actualUnits.has(unit)));
    if (unitsConflict) {
      plannedUnmatched.push(
        ...[...group.planned.values()].map(({ entry }) => entry),
      );
      actualUnmatched.push(
        ...[...group.actual.values()].map(({ exit }) => exit),
      );
      continue;
    }
    for (const unit of new Set([...plannedUnits, ...actualUnits])) {
      const planned = group.planned.get(unit)?.quantity ?? 0;
      const actual = group.actual.get(unit)?.quantity ?? 0;
      rows.push({
        key: [group.date, group.serviceCode, group.productId, unit].join("|"),
        date: group.date,
        serviceCode: group.serviceCode,
        productId: group.productId,
        productName: group.productName,
        unit,
        planned,
        actual,
      });
    }
  }

  return {
    rows: rows
      .map((row) => ({
        ...row,
        difference: row.actual - row.planned,
      }))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.serviceCode.localeCompare(b.serviceCode) ||
          a.productName.localeCompare(b.productName, "pt-BR"),
      ),
    plannedUnmatched,
    actualUnmatched,
  };
}

/** Consolida a quantidade de Hortifruti sem misturar produto, unidade, público, serviço ou data. */
export type HortifrutiEntry = {
  productId: string | null;
  productName: string;
  audience: ProductionAudience;
  service: string;
  date: string;
  quantity: number | null;
  unit: string | null;
};

export function consolidateHortifrutiEntries(entries: HortifrutiEntry[]) {
  const groups = new Map<
    string,
    HortifrutiEntry & { total: number; patients: number; servers: number }
  >();
  const pending = entries.filter(
    (entry) => !entry.productId || entry.quantity === null || !entry.unit,
  );

  for (const entry of entries) {
    if (!entry.productId || entry.quantity === null || !entry.unit) continue;
    const key = [
      entry.productId,
      entry.unit,
      entry.date,
      entry.audience,
      entry.service,
    ].join("|");
    const row = groups.get(key) ?? {
      ...entry,
      total: 0,
      patients: 0,
      servers: 0,
    };
    row.total += entry.quantity;
    if (entry.audience === "patient") row.patients += entry.quantity;
    else row.servers += entry.quantity;
    groups.set(key, row);
  }

  return { rows: [...groups.values()], pending };
}

const isValidQuantity = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value >= 0;

/** Calcula per capita × volume sem arredondar nem converter unidades. */
export function calculateProductionEntry(
  input: ProductionEntryInput,
): ProductionEntryResult {
  const pending: string[] = [];
  const unit = input.unit.trim();
  if (!input.productId)
    pending.push("Vincule a preparação a um produto oficial.");
  if (!input.productName.trim())
    pending.push("Informe a preparação ou o nome histórico.");
  if (!input.date) pending.push("Informe a data do consumo.");
  if (!unit) pending.push("Informe a unidade da quantidade final.");
  if (input.perCapita !== null && !isValidQuantity(input.perCapita))
    pending.push("Per capita precisa ser um número não negativo.");
  if (input.volume !== null && !isValidQuantity(input.volume))
    pending.push("Volume precisa ser um número não negativo.");

  let calculatedQuantity: number | null = null;
  if (input.perCapita !== null && input.volume !== null) {
    const [numerator, denominator] = (input.perCapitaUnit ?? "")
      .split("/")
      .map((part) => part.trim().toLocaleUpperCase("pt-BR"));
    const unitsCompatible =
      numerator === unit.toLocaleUpperCase("pt-BR") &&
      denominator === input.volumeUnit?.trim().toLocaleUpperCase("pt-BR");
    if (!input.perCapitaUnit?.includes("/") || !input.volumeUnit) {
      pending.push(
        "Informe unidade de per capita no formato quantidade/pessoa e unidade do volume.",
      );
    } else if (!unitsCompatible) {
      pending.push("Unidades incompatíveis; nenhuma conversão foi aplicada.");
    }
    if (
      isValidQuantity(input.perCapita) &&
      isValidQuantity(input.volume) &&
      unitsCompatible
    )
      calculatedQuantity = input.perCapita * input.volume;
  } else {
    pending.push("Preencha per capita e volume para calcular a necessidade.");
  }

  if (input.manualQuantity !== null && !isValidQuantity(input.manualQuantity))
    pending.push("Quantidade manual precisa ser um número não negativo.");
  if (
    input.manualQuantity !== null &&
    isValidQuantity(input.manualQuantity) &&
    !input.manualReason?.trim()
  )
    pending.push("Informe o motivo da quantidade manual.");

  return {
    calculatedQuantity,
    finalQuantity:
      input.manualQuantity !== null && isValidQuantity(input.manualQuantity)
        ? input.manualQuantity
        : calculatedQuantity,
    pending,
  };
}

/** Agrupa somente produtos vinculados, mantendo unidades diferentes separadas. */
export function consolidateProductionEntries(entries: ProductionEntry[]) {
  const totals = new Map<string, ProductionTotals>();
  const pendingEntries = entries.filter(
    (entry) => !entry.productId || entry.finalQuantity === null || !entry.unit,
  );
  for (const entry of entries) {
    if (!entry.productId || entry.finalQuantity === null || !entry.unit)
      continue;
    const key = entry.productId + ":" + entry.unit;
    const row = totals.get(key) ?? {
      productId: entry.productId,
      productName: entry.productName,
      unit: entry.unit,
      patients: 0,
      servers: 0,
      total: 0,
      byDate: new Map<string, number>(),
      byMeal: new Map<string, number>(),
    };
    row.total += entry.finalQuantity;
    if (entry.audience === "patient") row.patients += entry.finalQuantity;
    else row.servers += entry.finalQuantity;
    row.byDate.set(
      entry.date,
      (row.byDate.get(entry.date) ?? 0) + entry.finalQuantity,
    );
    row.byMeal.set(
      entry.meal,
      (row.byMeal.get(entry.meal) ?? 0) + entry.finalQuantity,
    );
    totals.set(key, row);
  }
  return { totals: [...totals.values()], pendingEntries };
}

export type ProductionDeliveryWindow = {
  id: string;
  label: string;
  fromDate: string;
  toDate: string;
};

export type ProductionPulpEntry = {
  flavorId: string | null;
  originalFlavorText: string | null;
  audience: ProductionAudience;
  service: string | null;
  date: string | null;
  quantity: number | null;
  unit: string | null;
};

/** Consolida polpas sem mesclar sabor, público, serviço ou unidade diferentes. */
export function consolidatePulpEntries(entries: ProductionPulpEntry[]) {
  const groups = new Map<
    string,
    ProductionPulpEntry & { patients: number; servers: number; total: number }
  >();
  const pending = entries.filter(
    (entry) =>
      entry.quantity === null ||
      !entry.unit ||
      (!entry.flavorId && !entry.originalFlavorText?.trim()),
  );
  for (const entry of entries) {
    if (
      entry.quantity === null ||
      !entry.unit ||
      (!entry.flavorId && !entry.originalFlavorText?.trim())
    )
      continue;
    const flavorKey =
      entry.flavorId ?? `original:${entry.originalFlavorText!.trim()}`;
    const key = [
      flavorKey,
      entry.unit,
      entry.audience,
      entry.service ?? "",
      entry.date ?? "",
    ].join("|");
    const group = groups.get(key) ?? {
      ...entry,
      patients: 0,
      servers: 0,
      total: 0,
    };
    group.total += entry.quantity;
    if (entry.audience === "patient") group.patients += entry.quantity;
    else group.servers += entry.quantity;
    groups.set(key, group);
  }
  return { rows: [...groups.values()], pending };
}

/** Distribui polpas apenas pelas faixas semanais cadastradas. */
export function allocatePulpByWeekday(
  entries: ProductionPulpEntry[],
  windows: Array<{ id: string; fromDay: number; toDay: number }>,
) {
  const allocation = new Map<string, number>();
  const unallocated: ProductionPulpEntry[] = [];
  const allocations = new Map<
    string,
    {
      windowId: string;
      flavorId: string | null;
      originalFlavorText: string | null;
      unit: string;
      audience: ProductionAudience;
      service: string | null;
      quantity: number;
    }
  >();
  for (const entry of entries) {
    if (
      !entry.date ||
      entry.quantity === null ||
      !entry.unit ||
      !Number.isFinite(entry.quantity) ||
      entry.quantity < 0
    ) {
      unallocated.push(entry);
      continue;
    }
    const day = new Date(`${entry.date}T00:00:00Z`).getUTCDay();
    const matchingWindows = Number.isNaN(day)
      ? []
      : windows.filter(
          (item) =>
            item.fromDay >= 0 &&
            item.fromDay <= 6 &&
            item.toDay >= 0 &&
            item.toDay <= 6 &&
            (item.fromDay <= item.toDay
              ? day >= item.fromDay && day <= item.toDay
              : day >= item.fromDay || day <= item.toDay),
        );
    if (matchingWindows.length !== 1) {
      unallocated.push(entry);
      continue;
    }
    const window = matchingWindows[0]!;
    const flavor =
      entry.flavorId ?? `original:${entry.originalFlavorText ?? ""}`;
    const key = `${window.id}:${flavor}:${entry.unit}:${entry.audience}:${entry.service ?? ""}`;
    allocation.set(key, (allocation.get(key) ?? 0) + entry.quantity);
    const row = allocations.get(key) ?? {
      windowId: window.id,
      flavorId: entry.flavorId,
      originalFlavorText: entry.originalFlavorText,
      unit: entry.unit,
      audience: entry.audience,
      service: entry.service,
      quantity: 0,
    };
    row.quantity += entry.quantity;
    allocations.set(key, row);
  }
  return { allocation, allocations: [...allocations.values()], unallocated };
}

/** Associa datas somente a janelas explicitamente configuradas. */
export function allocateProductionDeliveries(
  entries: ProductionEntry[],
  windows: ProductionDeliveryWindow[],
) {
  const allocation = new Map<string, number>();
  const unallocated: ProductionEntry[] = [];
  for (const entry of entries) {
    if (!entry.productId || entry.finalQuantity === null) {
      unallocated.push(entry);
      continue;
    }
    const window = windows.find(
      (item) => entry.date >= item.fromDate && entry.date <= item.toDate,
    );
    if (!window) {
      unallocated.push(entry);
      continue;
    }
    const key = window.id + ":" + entry.productId + ":" + entry.unit;
    allocation.set(key, (allocation.get(key) ?? 0) + entry.finalQuantity);
  }
  return { allocation, unallocated };
}

/** A antecedência do peixe é configurada em horas, sem antecipar datas automaticamente. */
export const DEFAULT_FISH_THAW_HOURS = 24;

export function calculateThawAt(
  consumptionAt: string,
  leadHours: number,
): string | null {
  return subtractHoursFromIso(consumptionAt, leadHours);
}
