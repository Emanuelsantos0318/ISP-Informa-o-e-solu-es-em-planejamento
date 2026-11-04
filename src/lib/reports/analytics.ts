import {
  averageDailyConsumption,
  classifyExpiry,
  classifyStock,
  coverageDays,
  DEFAULT_STOCK_SETTINGS,
  STOCK_STATUS_LABEL,
  suggestReorder,
  type StockSettings,
  type StockStatus,
} from "@/lib/rules/stock";
import { nowInOperationalTz } from "@/lib/datetime";
import type {
  InventoryProduct,
  InventorySnapshot,
  MovementBatch,
  MovementItem,
  StockLot,
} from "@/lib/supabase/inventory";

export type ReportFilters = {
  from: string;
  to: string;
  categoryId: string;
  productId: string;
  brand: string;
  supplierId: string;
  movementType: string;
  service: string;
  userId: string;
  status: string;
  unit: string;
};

export type ReportProductRow = {
  product: InventoryProduct;
  entries: number;
  exits: number;
  losses: number;
  averageDaily: number | null;
  coverage: number | null;
  reorder: number | null;
  status: StockStatus;
};

export type ReportMovementRow = {
  movement: MovementBatch;
  item: MovementItem;
};

export type ReportInsight = {
  priority: "urgente" | "alta" | "atenção" | "informativa";
  title: string;
  evidence: string;
  impact: string;
  recommendation: string;
  productId?: string | undefined;
};

export type ReportAnalytics = {
  products: InventoryProduct[];
  productRows: ReportProductRow[];
  movements: MovementBatch[];
  movementRows: ReportMovementRow[];
  lots: StockLot[];
  days: number;
  entries: number | null;
  exits: number | null;
  lossQuantity: number | null;
  unitCompatible: boolean;
  stockCounts: Record<StockStatus, number>;
  byDay: { date: string; entries: number; exits: number; losses: number }[];
  byCategory: {
    category: string;
    entries: number;
    exits: number;
    products: number;
  }[];
  byUnit: { unit: string; entries: number; exits: number; losses: number }[];
  topConsumption: ReportProductRow[];
  insights: ReportInsight[];
  priorComparisonAvailable: boolean;
  priorPeriodExits: number | null;
  currentPeriodExits: number | null;
  expiryWarningDays: number;
};

function dateInBahia(value: string): string {
  return nowInOperationalTz(new Date(value)).date;
}

function daysBetween(from: string, to: string): number {
  if (!from || !to || from > to) return 0;
  return Math.max(
    1,
    Math.floor(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 1,
  );
}

function labelType(type: MovementBatch["type"]): string {
  return type === "entry"
    ? "Entrada"
    : type === "exit"
      ? "Saída"
      : type === "loss"
        ? "Perda registrada"
        : "Ajuste";
}

export function calculateReportAnalytics(
  snapshot: InventorySnapshot,
  filters: ReportFilters,
  settings: StockSettings = DEFAULT_STOCK_SETTINGS,
  comparison?: { from: string; to: string } | undefined,
): ReportAnalytics {
  const days = daysBetween(filters.from, filters.to);
  const products = snapshot.products.filter((product) => {
    if (!product.active) return false;
    if (filters.unit !== "todos" && product.unit !== filters.unit) return false;
    if (
      filters.categoryId !== "todos" &&
      product.categoryId !== filters.categoryId
    )
      return false;
    if (filters.productId !== "todos" && product.id !== filters.productId)
      return false;
    if (filters.brand !== "todos" && product.brand !== filters.brand)
      return false;
    if (
      filters.supplierId !== "todos" &&
      product.supplierId !== filters.supplierId
    )
      return false;
    if (
      filters.status !== "todos" &&
      classifyStock(
        { balance: product.balance, min: product.minimum, max: product.target },
        settings,
      ) !== filters.status
    )
      return false;
    return true;
  });
  const productIds = new Set(products.map((product) => product.id));
  const movementRows = snapshot.movements.flatMap((movement) => {
    const date = dateInBahia(movement.occurredAt);
    if (date < filters.from || date > filters.to) return [];
    if (
      filters.movementType !== "todos" &&
      movement.type !== filters.movementType
    )
      return [];
    if (filters.service !== "todos" && movement.service !== filters.service)
      return [];
    if (filters.userId !== "todos" && movement.userId !== filters.userId)
      return [];
    return movement.items
      .filter((item) => productIds.has(item.productId))
      .map((item) => ({ movement, item }));
  });
  const movements = [
    ...new Map(
      movementRows.map(({ movement }) => [movement.id, movement]),
    ).values(),
  ];
  const rowsByProduct = new Map<
    string,
    { entries: number; exits: number; losses: number }
  >();
  for (const { movement, item } of movementRows) {
    const row = rowsByProduct.get(item.productId) ?? {
      entries: 0,
      exits: 0,
      losses: 0,
    };
    if (movement.type === "entry") row.entries += item.quantity;
    if (movement.type === "exit") row.exits += item.quantity;
    if (movement.type === "loss") row.losses += item.quantity;
    rowsByProduct.set(item.productId, row);
  }
  const productRows = products.map((product): ReportProductRow => {
    const quantities = rowsByProduct.get(product.id) ?? {
      entries: 0,
      exits: 0,
      losses: 0,
    };
    const averageDaily = averageDailyConsumption(
      quantities.exits,
      days,
      settings,
    );
    return {
      product,
      ...quantities,
      averageDaily,
      coverage: coverageDays(product.balance, averageDaily),
      reorder: suggestReorder({
        balance: product.balance,
        target: product.target,
      }),
      status: classifyStock(
        { balance: product.balance, min: product.minimum, max: product.target },
        settings,
      ),
    };
  });
  const stockCounts = Object.fromEntries(
    (Object.keys(STOCK_STATUS_LABEL) as StockStatus[]).map((status) => [
      status,
      productRows.filter((row) => row.status === status).length,
    ]),
  ) as Record<StockStatus, number>;
  const lots = snapshot.lots.filter((lot) => productIds.has(lot.productId));
  const dailyMap = new Map<
    string,
    { entries: number; exits: number; losses: number }
  >();
  const categoryMap = new Map<
    string,
    { entries: number; exits: number; products: Set<string> }
  >();
  const unitMap = new Map<
    string,
    { entries: number; exits: number; losses: number }
  >();
  for (const { movement, item } of movementRows) {
    const day = dateInBahia(movement.occurredAt);
    const dayData = dailyMap.get(day) ?? { entries: 0, exits: 0, losses: 0 };
    if (movement.type === "entry") dayData.entries += item.quantity;
    if (movement.type === "exit") dayData.exits += item.quantity;
    if (movement.type === "loss") dayData.losses += item.quantity;
    dailyMap.set(day, dayData);
    const product = products.find((row) => row.id === item.productId);
    const category = product?.categoryName ?? "Sem categoria";
    const categoryData = categoryMap.get(category) ?? {
      entries: 0,
      exits: 0,
      products: new Set<string>(),
    };
    if (movement.type === "entry") categoryData.entries += item.quantity;
    if (movement.type === "exit") categoryData.exits += item.quantity;
    categoryData.products.add(item.productId);
    categoryMap.set(category, categoryData);
    const unitData = unitMap.get(item.unit) ?? {
      entries: 0,
      exits: 0,
      losses: 0,
    };
    if (movement.type === "entry") unitData.entries += item.quantity;
    if (movement.type === "exit") unitData.exits += item.quantity;
    if (movement.type === "loss") unitData.losses += item.quantity;
    unitMap.set(item.unit, unitData);
  }
  const unitCodes = new Set([
    ...products.map((product) => product.unit),
    ...movementRows.map(({ item }) => item.unit),
  ]);
  const unitCompatible =
    filters.unit === "todos"
      ? unitCodes.size <= 1
      : unitCodes.size <= 1 && unitCodes.has(filters.unit);
  const currentPeriodExits = unitCompatible
    ? productRows.reduce((sum, row) => sum + row.exits, 0)
    : null;
  const priorPeriodRows = comparison
    ? snapshot.movements
        .filter((movement) => {
          const date = dateInBahia(movement.occurredAt);
          return (
            date >= comparison.from &&
            date <= comparison.to &&
            (filters.service === "todos" ||
              movement.service === filters.service) &&
            (filters.userId === "todos" || movement.userId === filters.userId)
          );
        })
        .flatMap((movement) =>
          movement.type === "exit" &&
          (filters.movementType === "todos" || filters.movementType === "exit")
            ? movement.items.filter((item) => productIds.has(item.productId))
            : [],
        )
    : [];
  const priorComparisonAvailable =
    Boolean(comparison) &&
    unitCompatible &&
    (filters.movementType === "todos" || filters.movementType === "exit");
  const priorPeriodExits = priorComparisonAvailable
    ? priorPeriodRows.reduce((sum, item) => sum + item.quantity, 0)
    : null;
  const today = nowInOperationalTz().date;
  const insights: ReportInsight[] = [];
  for (const row of productRows) {
    if (row.status === "sem_saldo")
      insights.push({
        priority: "urgente",
        title: `Produto sem saldo: ${row.product.name}`,
        evidence: `Saldo atual ${row.product.balance} ${row.product.unit}; mínimo cadastrado ${row.product.minimum} ${row.product.unit}.`,
        impact: "Risco de indisponibilidade para a operação.",
        recommendation:
          "Conferir necessidade de reposição e previsão de entrada.",
        productId: row.product.id,
      });
    else if (row.status === "critico" || row.status === "baixo")
      insights.push({
        priority: row.status === "critico" ? "alta" : "atenção",
        title: `${STOCK_STATUS_LABEL[row.status]}: ${row.product.name}`,
        evidence: `Saldo ${row.product.balance} ${row.product.unit}; mínimo ${row.product.minimum} ${row.product.unit}.`,
        impact: "O saldo está abaixo do nível mínimo definido no cadastro.",
        recommendation: "Avaliar reposição com a equipe de compras.",
        productId: row.product.id,
      });
    if (row.coverage !== null && row.coverage <= 3)
      insights.push({
        priority: row.coverage <= 1 ? "urgente" : "alta",
        title: `Cobertura curta: ${row.product.name}`,
        evidence: `${row.coverage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dia(s), com média calculada de ${row.averageDaily?.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${row.product.unit}/dia.`,
        impact: "O saldo pode não cobrir o consumo observado por muito tempo.",
        recommendation:
          "Validar o consumo recente e a programação de reposição.",
        productId: row.product.id,
      });
  }
  for (const lot of lots) {
    if (!lot.expiresOn || lot.quantity <= 0) continue;
    const expiry = classifyExpiry(lot.expiresOn, today, settings);
    if (expiry !== "valido") {
      const product = products.find((row) => row.id === lot.productId);
      const remainingDays = Math.round(
        (Date.parse(`${lot.expiresOn}T00:00:00Z`) -
          Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      );
      insights.push({
        priority: expiry === "vencido" ? "urgente" : "atenção",
        title: `${expiry === "vencido" ? "Lote vencido" : "Validade próxima"}: ${product?.name ?? "Produto"}`,
        evidence: `Lote ${lot.lotNumber}, saldo ${lot.quantity} ${product?.unit ?? "un"}, validade ${lot.expiresOn}${expiry === "proximo" ? ` (${remainingDays} dia(s))` : ""}.`,
        impact:
          expiry === "vencido"
            ? "O lote vencido deve ser segregado e não considerado disponível para consumo."
            : "Há saldo em lote dentro da janela de alerta de validade.",
        recommendation:
          expiry === "vencido"
            ? "Conferir e registrar a tratativa do lote conforme procedimento local."
            : "Aplicar PVPS e priorizar a conferência/uso do lote dentro das regras locais.",
        productId: lot.productId,
      });
    }
  }
  if (
    priorComparisonAvailable &&
    priorPeriodExits !== null &&
    currentPeriodExits !== null &&
    priorPeriodExits > 0
  ) {
    const variation =
      (currentPeriodExits - priorPeriodExits) / priorPeriodExits;
    if (Math.abs(variation) >= 0.2)
      insights.push({
        priority: variation > 0 ? "atenção" : "informativa",
        title:
          variation > 0 ? "Consumo total aumentou" : "Consumo total diminuiu",
        evidence: `Saídas no período: ${currentPeriodExits.toLocaleString("pt-BR")} versus ${priorPeriodExits.toLocaleString("pt-BR")} no período anterior (${variation > 0 ? "+" : ""}${(variation * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%).`,
        impact: "A variação pode alterar a necessidade de abastecimento.",
        recommendation:
          "Compare produtos, serviços e programação antes de ajustar compras.",
      });
  }
  const byDay = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, ...values }));
  const byCategory = [...categoryMap.entries()]
    .map(([category, values]) => ({
      category,
      entries: values.entries,
      exits: values.exits,
      products: values.products.size,
    }))
    .sort((a, b) => b.exits - a.exits);
  const byUnit = [...unitMap.entries()]
    .map(([unit, values]) => ({ unit, ...values }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
  const topConsumption = [...productRows]
    .filter((row) => row.exits > 0)
    .sort((a, b) => b.exits - a.exits)
    .slice(0, 10);
  const entries = unitCompatible
    ? movementRows
        .filter(({ movement }) => movement.type === "entry")
        .reduce((sum, { item }) => sum + item.quantity, 0)
    : null;
  const exits = unitCompatible
    ? movementRows
        .filter(({ movement }) => movement.type === "exit")
        .reduce((sum, { item }) => sum + item.quantity, 0)
    : null;
  const lossQuantity = unitCompatible
    ? movementRows
        .filter(({ movement }) => movement.type === "loss")
        .reduce((sum, { item }) => sum + item.quantity, 0)
    : null;
  return {
    products,
    productRows,
    movements,
    movementRows,
    lots,
    days,
    entries,
    exits,
    lossQuantity,
    unitCompatible,
    stockCounts,
    byDay,
    byCategory,
    byUnit,
    topConsumption,
    insights: insights.sort(
      (a, b) => priorityOrder(a.priority) - priorityOrder(b.priority),
    ),
    priorComparisonAvailable,
    priorPeriodExits,
    currentPeriodExits,
    expiryWarningDays: settings.expiryWarningDays,
  };
}

function priorityOrder(priority: ReportInsight["priority"]): number {
  return { urgente: 0, alta: 1, atenção: 2, informativa: 3 }[priority];
}

export function movementTypeLabel(type: MovementBatch["type"]): string {
  return labelType(type);
}

export function reportDayCount(from: string, to: string): number {
  return daysBetween(from, to);
}
