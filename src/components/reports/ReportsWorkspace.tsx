import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Boxes,
  FileSpreadsheet,
  PackageSearch,
  Printer,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  ListOrdered,
  Layers,
  Trophy,
  Table2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BackendNotice } from "@/components/common/BackendNotice";
import { PageIntro, Panel } from "@/components/common/Panel";
import { StatCard } from "@/components/common/StatCard";
import { Field } from "@/components/common/Field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { useInventorySnapshot } from "@/lib/supabase/useInventorySnapshot";
import { useInvoiceHistory } from "@/lib/supabase/useInvoiceHistory";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/supabase/operational-settings";
import { useStockSettings } from "@/lib/supabase/useStockSettings";
import {
  DEFAULT_STOCK_SETTINGS,
  STOCK_STATUS_LABEL,
  type StockStatus,
} from "@/lib/rules/stock";
import {
  calculateReportAnalytics,
  movementTypeLabel,
  reportDayCount,
  type ReportFilters,
  type ReportInsight,
  type ReportMovementRow,
  type ReportProductRow,
} from "@/lib/reports/analytics";
import {
  formatDateTime,
  getPeriodRange,
  nowInOperationalTz,
  PERIOD_PRESETS,
  type PeriodPreset,
} from "@/lib/datetime";
import { EXIT_TYPES, SERVICE_OPTIONS } from "@/lib/config/services";
import type { Workbook } from "exceljs";

const REPORTS = [
  {
    id: "estoque",
    title: "Controle de estoque",
    description: "Posição atual, níveis, lotes e movimentações.",
    icon: Boxes,
  },
  {
    id: "consumo",
    title: "Consumo e planejamento",
    description: "Consumo observado, médias, cobertura e comparação.",
    icon: TrendingUp,
  },
  {
    id: "perdas",
    title: "Perdas e validade",
    description: "Perdas registradas e lotes que exigem atenção.",
    icon: TriangleAlert,
  },
  {
    id: "compras",
    title: "Compras e fornecedores",
    description: "Entradas, documentos fiscais e fornecedores vinculados.",
    icon: ShoppingCart,
  },
  {
    id: "estrategia",
    title: "Análises estratégicas",
    description: "Cobertura, reposição e concentração de consumo.",
    icon: PackageSearch,
  },
  {
    id: "indicadores",
    title: "Indicadores gerenciais",
    description: "Visão executiva de estoque e movimentos do período.",
    icon: BarChart3,
  },
  {
    id: "inteligencia",
    title: "Relatórios inteligentes",
    description: "Alertas explicáveis derivados dos registros reais.",
    icon: Sparkles,
  },
  {
    id: "mov-produto",
    title: "Movimentações por produto",
    description: "Entradas e saídas por produto, serviço e destino.",
    icon: ArrowUpFromLine,
  },
  {
    id: "analitico-mov",
    title: "Analítico de movimentações",
    description: "Itens, responsáveis, horários, lotes e classificação.",
    icon: Table2,
  },
  {
    id: "estoque-categoria",
    title: "Estoque por categoria",
    description: "Posição agrupada por categoria e unidade de medida.",
    icon: Layers,
  },
  {
    id: "geral-estoque",
    title: "Geral de estoque",
    description: "Saldos, consumo, níveis e reposição sugerida.",
    icon: ListOrdered,
  },
  {
    id: "ranking-mov",
    title: "Ranking de movimentações",
    description: "Produtos com maior volume por tipo de movimento.",
    icon: Trophy,
  },
  {
    id: "consolidado",
    title: "Consolidado de estoque e movimentos",
    description: "Posição atual e movimentações detalhadas no mesmo arquivo.",
    icon: FileSpreadsheet,
  },
] as const;
const EMPTY_SUPPLIERS: { id: string; name: string }[] = [];
type ReportId = (typeof REPORTS)[number]["id"];
type ActiveFilters = ReportFilters & {
  preset: PeriodPreset;
  productSearch: string;
  exitType: string;
};
const today = nowInOperationalTz().date;
const range = getPeriodRange("30d") ?? { from: today, to: today };
const INITIAL: ActiveFilters = {
  preset: "30d",
  ...range,
  categoryId: "todos",
  productId: "todos",
  brand: "todos",
  supplierId: "todos",
  movementType: "todos",
  service: "todos",
  userId: "todos",
  status: "todos",
  unit: "todos",
  productSearch: "",
  exitType: "todos",
};
const STORAGE_KEY = "isp.central-relatorios.filters";
const COLORS = ["#173a6b", "#0e7490", "#16a34a", "#e9a23b", "#dc5050"];

export function ReportsWorkspace({
  category,
}: {
  category?: string | undefined;
}) {
  // Usa o slug da rota quando a página for aberta diretamente, inclusive na impressão.
  const routeCategory =
    category ??
    (typeof window === "undefined"
      ? undefined
      : window.location.pathname.split("/").filter(Boolean).slice(-1)[0]);
  const normalizedCategory = routeCategory?.trim().toLocaleLowerCase("pt-BR");
  const currentReport = REPORTS.find((item) => item.id === normalizedCategory);
  const id: ReportId | null = currentReport?.id ?? null;
  const [filters, setFilters] = useState<ActiveFilters>(INITIAL);
  const [preferencesReady, setPreferencesReady] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw)
        setFilters((current) => ({
          ...current,
          ...(JSON.parse(raw) as Partial<ActiveFilters>),
        }));
    } catch {
      /* A tela segue funcional se o armazenamento local estiver bloqueado. */
    }
    setPreferencesReady(true);
  }, []);
  useEffect(() => {
    if (!preferencesReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      /* Os filtros continuam ativos nesta sessão. */
    }
  }, [filters, preferencesReady]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const duration = Math.max(1, reportDayCount(filters.from, filters.to));
  const comparison = useMemo(() => {
    if (!filters.from || !filters.to || filters.from > filters.to) return null;
    const end = new Date(filters.from + "T00:00:00Z");
    end.setUTCDate(end.getUTCDate() - 1);
    const priorTo = end.toISOString().slice(0, 10);
    const start = new Date(priorTo + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - duration + 1);
    return { from: start.toISOString().slice(0, 10), to: priorTo };
  }, [filters.from, filters.to, duration]);
  const snapshotQuery = useInventorySnapshot({
    from: boundary(comparison?.from ?? filters.from, false),
    to: filters.to ? boundary(filters.to, true) : undefined,
  });
  const catalog = useCatalog();
  const invoicesQuery = useInvoiceHistory({
    from: filters.from,
    to: filters.to,
  });
  const settingsQuery = useStockSettings();
  const operationalQuery = useOperationalSettings();
  const scope = useOperationalScope();
  const settings = settingsQuery.data ?? DEFAULT_STOCK_SETTINGS;
  const operational = operationalQuery.data ?? DEFAULT_OPERATIONAL_SETTINGS;
  const snapshot = snapshotQuery.data;
  const analytics = useMemo(
    () =>
      snapshot
        ? calculateReportAnalytics(
            snapshot,
            filters,
            settings,
            comparison ?? undefined,
          )
        : null,
    [snapshot, filters, settings, comparison],
  );
  const categories = catalog.categories.data ?? [];
  const suppliers = catalog.suppliers.data ?? EMPTY_SUPPLIERS;
  const products = snapshot?.products.filter((product) => product.active) ?? [];
  const users = [
    ...new Map(
      (snapshot?.movements ?? []).map((item) => [
        item.userId,
        item.userName ?? item.userId.slice(0, 8),
      ]),
    ).entries(),
  ];
  const filteredInvoices = useMemo(() => {
    const batchIds = new Set(
      analytics?.movements
        .filter((movement) => movement.type === "entry")
        .map((movement) => movement.id) ?? [],
    );
    return (invoicesQuery.data ?? []).filter((invoice) => {
      const date = invoice.issue_date ?? invoice.created_at.slice(0, 10);
      if (date < filters.from || date > filters.to) return false;
      if (
        filters.supplierId !== "todos" &&
        invoice.supplier_id !== filters.supplierId
      )
        return false;
      if (
        analytics &&
        (filters.categoryId !== "todos" ||
          filters.productId !== "todos" ||
          filters.brand !== "todos" ||
          filters.unit !== "todos") &&
        !batchIds.has(invoice.batch_id)
      )
        return false;
      return (
        filters.movementType === "todos" || filters.movementType === "entry"
      );
    });
  }, [analytics, invoicesQuery.data, filters]);
  const rows = useMemo(
    () =>
      analytics
        ? getExportRows(
            id,
            analytics,
            filteredInvoices,
            operational.serviceLabels,
            suppliers,
          )
        : [],
    [analytics, id, filteredInvoices, operational.serviceLabels, suppliers],
  );

  const update = (key: keyof ActiveFilters, value: string) =>
    setFilters((current) => {
      let next = { ...current, [key]: value };
      if (key === "preset" && value !== "personalizado")
        next = { ...next, ...getPeriodRange(value as PeriodPreset) };
      if (key === "from" || key === "to") next.preset = "personalizado";
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* Preferências locais são opcionais. */
      }
      return next;
    });
  const clear = () => {
    setFilters(INITIAL);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL));
    } catch {
      /* Restaura durante esta sessão. */
    }
  };
  const createExcel = async () => {
    if (!rows.length) return;
    setExporting(true);
    setExportError(null);
    try {
      const { default: ExcelJS } = await import("exceljs/dist/exceljs.min.js");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(
        currentReport?.title ?? "Resumo gerencial",
      );
      sheet.addRow([
        "LBGS · " +
          (currentReport?.title ?? "Central de Relatórios Gerenciais"),
      ]);
      sheet.addRow([
        "Unidade: " +
          (scope.units.find((unit) => unit.id === scope.unitId)?.name ??
            "Selecionada"),
        "Emitido em: " + formatDateTime(new Date()),
      ]);
      sheet.addRow([
        "Período: " + filters.from + " a " + filters.to,
        "Movimentação: " + movementFilter(filters.movementType),
      ]);
      sheet.addRow([
        "Categoria: " +
          selectLabel(
            filters.categoryId,
            categories.map((item) => ({ id: item.id, name: item.name })),
            "Todas",
          ),
        "Produto: " +
          selectLabel(
            filters.productId,
            products.map((item) => ({ id: item.id, name: item.name })),
            "Todos",
          ),
      ]);
      sheet.addRow([
        "Marca: " + (filters.brand === "todos" ? "Todas" : filters.brand),
        "Fornecedor: " +
          selectLabel(
            filters.supplierId,
            suppliers.map((item) => ({ id: item.id, name: item.name })),
            "Todos",
          ),
      ]);
      sheet.addRow([
        "Serviço: " +
          (filters.service === "todos"
            ? "Todos"
            : (operational.serviceLabels[filters.service] ?? filters.service)),
        "Responsável: " +
          (filters.userId === "todos"
            ? "Todos"
            : (users.find(([value]) => value === filters.userId)?.[1] ??
              "Selecionado")),
      ]);
      sheet.addRow([
        "Unidade: " + (filters.unit === "todos" ? "Todas" : filters.unit),
        "Situação: " +
          (filters.status === "todos"
            ? "Todas"
            : STOCK_STATUS_LABEL[filters.status as StockStatus]),
      ]);
      sheet.addRow([]);
      sheet.addRow(Object.keys(rows[0] ?? {}));
      rows.forEach((item) => sheet.addRow(Object.values(item)));
      sheet.getRow(1).font = {
        bold: true,
        size: 16,
        color: { argb: "FF173A6B" },
      };
      sheet.getRow(9).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(9).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF173A6B" },
      };
      sheet.views = [{ state: "frozen", ySplit: 9 }];
      sheet.autoFilter = {
        from: { row: 9, column: 1 },
        to: { row: 9, column: Object.keys(rows[0] ?? {}).length },
      };
      // Não definir `header` aqui: no ExcelJS isso escreve novamente na linha 1
      // e apagaria o título e os filtros já registrados no início do relatório.
      sheet.columns = Object.keys(rows[0] ?? {}).map((key) => ({
        width: Math.min(36, Math.max(14, key.length + 4)),
      }));
      if (analytics && id === "estoque") {
        addWorkbookSheet(workbook, "Lotes", lotExportRows(analytics));
        addWorkbookSheet(
          workbook,
          "Movimentações",
          movementExportRows(analytics.movementRows, operational.serviceLabels),
        );
      }
      if (analytics && id === "perdas")
        addWorkbookSheet(
          workbook,
          "Lotes e validade",
          lotExportRows(analytics),
        );
      if (analytics && id === "compras")
        addWorkbookSheet(
          workbook,
          "Entradas",
          movementExportRows(
            analytics.movementRows.filter(
              (row) => row.movement.type === "entry",
            ),
            operational.serviceLabels,
          ),
        );
      const bytes = await workbook.xlsx.writeBuffer();
      download(
        new Blob([bytes]),
        "relatorio-isp-" +
          (id ?? "gerencial") +
          "-" +
          filters.from +
          "-" +
          filters.to +
          ".xlsx",
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar a planilha.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      id="report-preview"
      className={`reports-page grid gap-5 ${id ? "reports-page--detail" : "reports-page--overview"}`}
    >
      <div className="hidden items-center gap-3 border-b pb-4 print:flex">
        <img
          src="/isp-logo.png"
          alt="Logo LBGS"
          className="size-12 object-contain"
        />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider">
            LBGS · Gestão de Estoque
          </p>
          <h1 className="text-lg font-semibold">
            {currentReport?.title ?? "Central de Relatórios Gerenciais"}
          </h1>
          <p className="text-xs">
            Unidade:{" "}
            {scope.units.find((unit) => unit.id === scope.unitId)?.name ??
              "Selecionada"}{" "}
            · Período: {filters.from} a {filters.to} · Emitido:{" "}
            {formatDateTime(new Date())}
          </p>
          <p className="text-xs">
            Filtros: tipo {movementFilter(filters.movementType)} · categoria{" "}
            {selectLabel(
              filters.categoryId,
              categories.map((item) => ({ id: item.id, name: item.name })),
              "todas",
            )}{" "}
            · produto{" "}
            {selectLabel(
              filters.productId,
              products.map((item) => ({ id: item.id, name: item.name })),
              "todos",
            )}{" "}
            · marca {filters.brand} · fornecedor{" "}
            {selectLabel(
              filters.supplierId,
              suppliers.map((item) => ({ id: item.id, name: item.name })),
              "todos",
            )}{" "}
            · serviço {filters.service} · tipo de saída {filters.exitType} ·
            busca {filters.productSearch || "sem filtro"} · responsável{" "}
            {filters.userId} · unidade {filters.unit} · situação{" "}
            {filters.status}
          </p>
        </div>
      </div>
      <PageIntro
        title={currentReport?.title ?? "Central de Relatórios Gerenciais"}
        description={
          currentReport?.description ??
          "Indicadores sobre os registros reais de estoque, consumo, validade e compras da unidade."
        }
        actions={
          <div className="print:hidden flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Imprimir / PDF
            </Button>
            <Button
              onClick={() => void createExcel()}
              disabled={exporting || !rows.length}
            >
              <FileSpreadsheet /> {exporting ? "Gerando…" : "Exportar Excel"}
            </Button>
          </div>
        }
      />
      <Panel
        className="print:hidden"
        title="Filtros do relatório"
        description="Os critérios selecionados atualizam indicadores, gráficos, tabelas e exportações."
        actions={
          <Button variant="ghost" size="sm" onClick={clear}>
            Limpar filtros
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <Field label="Período rápido">
            <Select
              value={filters.preset}
              onValueChange={(value) => update("preset", value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_PRESETS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Data inicial">
            <Input
              type="date"
              value={filters.from}
              onChange={(event) => update("from", event.target.value)}
            />
          </Field>
          <Field label="Data final">
            <Input
              type="date"
              value={filters.to}
              onChange={(event) => update("to", event.target.value)}
            />
          </Field>
          <FilterSelect
            label="Movimentação"
            value={filters.movementType}
            onChange={(v) => update("movementType", v)}
            options={[
              { value: "entry", label: "Entradas" },
              { value: "exit", label: "Saídas" },
              { value: "adjustment", label: "Ajustes" },
              { value: "loss", label: "Perdas registradas" },
            ]}
          />
          <FilterSelect
            label="Categoria"
            value={filters.categoryId}
            onChange={(v) => update("categoryId", v)}
            allLabel="Todas as categorias"
            options={categories.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <FilterSelect
            label="Produto"
            value={filters.productId}
            onChange={(v) => update("productId", v)}
            allLabel="Todos os produtos"
            options={products.map((item) => ({
              value: item.id,
              label: item.name + " · " + item.sku,
            }))}
          />
          <Field label="Buscar produto por nome ou código">
            <Input
              value={filters.productSearch}
              placeholder="Nome, SKU ou código de barras"
              onChange={(event) => update("productSearch", event.target.value)}
            />
          </Field>
          <FilterSelect
            label="Marca"
            value={filters.brand}
            onChange={(v) => update("brand", v)}
            options={[
              ...new Set(
                products
                  .map((item) => item.brand)
                  .filter((brand): brand is string => Boolean(brand)),
              ),
            ]
              .sort()
              .map((value) => ({ value, label: value }))}
          />
          <FilterSelect
            label="Fornecedor"
            value={filters.supplierId}
            onChange={(v) => update("supplierId", v)}
            options={suppliers.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <FilterSelect
            label="Serviço"
            value={filters.service}
            onChange={(v) => update("service", v)}
            options={SERVICE_OPTIONS.map((item) => ({
              value: item.code,
              label: operational.serviceLabels[item.code] ?? item.label,
            }))}
          />
          <FilterSelect
            label="Tipo de saída"
            value={filters.exitType}
            onChange={(v) => update("exitType", v)}
            options={EXIT_TYPES.map((item) => ({
              value: item.code,
              label: operational.exitTypeLabels[item.code] ?? item.label,
            }))}
          />
          <FilterSelect
            label="Responsável"
            value={filters.userId}
            onChange={(v) => update("userId", v)}
            options={users.map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            label="Situação do estoque"
            value={filters.status}
            onChange={(v) => update("status", v)}
            options={(
              Object.entries(STOCK_STATUS_LABEL) as [StockStatus, string][]
            ).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            label="Unidade de medida"
            value={filters.unit}
            onChange={(v) => update("unit", v)}
            options={[...new Set(products.map((item) => item.unit))]
              .sort()
              .map((unit) => ({ value: unit, label: unit }))}
          />
        </div>
      </Panel>
      {snapshotQuery.isLoading && (
        <BackendNotice>Carregando dados gerenciais da unidade…</BackendNotice>
      )}
      {snapshotQuery.isError && (
        <BackendNotice>
          Não foi possível consultar os dados. Nenhum valor de exemplo será
          exibido.
        </BackendNotice>
      )}
      {exportError && <BackendNotice>{exportError}</BackendNotice>}
      {snapshotQuery.isSuccess && analytics && (
        <>
          <div className={id ? "reports-print-hide" : undefined}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Produtos no recorte"
                value={analytics.products.length}
                unit="produtos ativos"
                icon={Boxes}
              />
              <StatCard
                label="Abaixo do mínimo"
                value={
                  analytics.stockCounts.sem_saldo +
                  analytics.stockCounts.critico +
                  analytics.stockCounts.baixo
                }
                unit="inclui estoque zerado, crítico e baixo"
                icon={AlertTriangle}
                tone="warning"
              />
              <StatCard
                label="Entradas do período"
                value={
                  analytics.entries === null ? null : fmt(analytics.entries)
                }
                unit={
                  analytics.unitCompatible
                    ? "quantidade na unidade filtrada"
                    : "selecione uma unidade para totalizar"
                }
                icon={ArrowDownToLine}
                tone="success"
              />
              <StatCard
                label="Saídas do período"
                value={analytics.exits === null ? null : fmt(analytics.exits)}
                unit={
                  analytics.unitCompatible
                    ? "quantidade na unidade filtrada"
                    : "selecione uma unidade para totalizar"
                }
                icon={ArrowUpFromLine}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A posição é atual; movimentações respeitam o período. Consultas
              são paginadas para incluir todos os registros retornados pelo
              banco. Unidades diferentes não são convertidas nem combinadas com
              fator presumido. Unidades salvas no movimento são preservadas; nos
              registros antigos sem essa informação, usamos a unidade atual do
              produto.
            </p>
          </div>
          {filters.from > filters.to && (
            <BackendNotice>
              A data inicial precisa ser anterior ou igual à data final.
            </BackendNotice>
          )}
          {id ? (
            <Detail
              id={id}
              analytics={analytics}
              invoices={filteredInvoices}
              invoiceLoading={invoicesQuery.isLoading}
              serviceLabels={operational.serviceLabels}
            />
          ) : (
            <Overview analytics={analytics} />
          )}
          <section className="reports-print-hide">
            {[
              { title: "Relatórios gerenciais", items: REPORTS.slice(0, 7) },
              { title: "Relatórios de Planejamento", items: REPORTS.slice(7) },
            ].map((group) => (
              <div key={group.title} className="mb-5 last:mb-0">
                <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                  {group.title}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {group.items.map((item) => (
                    <Link
                      key={item.id}
                      to="/relatorios/$categoria"
                      params={{ categoria: item.id }}
                      className="surface group p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                    >
                      <div className="flex items-start gap-3">
                        <span className="rounded-lg bg-primary-soft p-2 text-primary">
                          <item.icon className="size-5" />
                        </span>
                        <span>
                          <span className="block font-medium group-hover:text-primary">
                            {item.title}
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                            {item.description}
                          </span>
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </section>
          <Methodology />
        </>
      )}
    </div>
  );
}

function Overview({
  analytics,
}: {
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel
        title={
          analytics.unitCompatible
            ? "Entradas e saídas por dia"
            : "Movimentações agrupadas por unidade"
        }
        description={
          analytics.unitCompatible
            ? "Soma de quantidades na unidade compatível selecionada."
            : "Quantidades separadas por unidade, sem somar unidades diferentes."
        }
      >
        {analytics.unitCompatible ? (
          <MovementChart analytics={analytics} />
        ) : (
          <UnitTable analytics={analytics} />
        )}
      </Panel>
      <Panel title="Saídas por categoria">
        <CategoryChart analytics={analytics} />
      </Panel>
      <Panel
        title="Produtos com maior saída"
        description="Ordenados dentro de cada unidade de medida."
      >
        <ProductTable
          rows={analytics.topConsumption}
          empty="Não há saídas para os filtros escolhidos."
        />
      </Panel>
      <Panel title="Sinais que merecem revisão">
        <InsightList items={analytics.insights.slice(0, 6)} />
      </Panel>
    </div>
  );
}

function Detail({
  id,
  analytics,
  invoices,
  invoiceLoading,
  serviceLabels,
}: {
  id: ReportId;
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>;
  invoices: {
    id: string;
    supplier_id: string;
    invoice_number: string;
    series: string;
    issue_date: string | null;
    invoice_total: number | null;
    created_at: string;
  }[];
  invoiceLoading: boolean;
  serviceLabels: Record<string, string>;
}) {
  if (
    id === "mov-produto" ||
    id === "analitico-mov" ||
    id === "estoque-categoria" ||
    id === "geral-estoque" ||
    id === "ranking-mov" ||
    id === "consolidado"
  ) {
    const rows = getPlanningReportRows(id, analytics, serviceLabels);
    return (
      <Panel
        title={REPORTS.find((report) => report.id === id)?.title ?? "Relatório"}
        description={`${rows.length} registros · período, filtros e exportações aplicados`}
      >
        <RecordTable rows={rows} />
      </Panel>
    );
  }
  if (id === "estoque")
    return (
      <div className="grid gap-5">
        <Panel
          title="Posição atual do estoque"
          description="Saldo, limites e situação. Reservas, compromissos e custo unitário não existem no cadastro atual."
        >
          <ProductTable rows={analytics.productRows} detailed />
        </Panel>
        <Panel title="Lotes com validade">
          <LotTable analytics={analytics} />
        </Panel>
        <Panel title="Histórico de movimentações">
          <MovementTable
            rows={analytics.movementRows}
            serviceLabels={serviceLabels}
          />
        </Panel>
      </div>
    );
  if (id === "consumo")
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Consumo observado por produto"
          description={
            "Média diária = saídas do período ÷ " + analytics.days + " dia(s)."
          }
        >
          <ProductTable
            rows={analytics.productRows.filter((row) => row.exits > 0)}
            consumption
          />
        </Panel>
        <Panel title="Evolução diária">
          <MovementChart analytics={analytics} />
        </Panel>
        <Panel title="Comparação com período anterior">
          <Comparison analytics={analytics} />
        </Panel>
        <Panel title="Saídas por categoria">
          <CategoryChart analytics={analytics} />
        </Panel>
      </div>
    );
  if (id === "perdas")
    return (
      <div className="grid gap-5">
        <Panel
          title="Perdas registradas"
          description="Somente movimentos explicitamente registrados como perda. Ajustes negativos não são reclassificados."
        >
          <MovementTable
            rows={analytics.movementRows.filter(
              (row) => row.movement.type === "loss",
            )}
            serviceLabels={serviceLabels}
          />
        </Panel>
        <Panel title="Validade e lotes">
          <LotTable analytics={analytics} />
        </Panel>
        <Info
          title="Rendimento e reaproveitamento indisponíveis"
          text="Não há dados estruturados de peso bruto/líquido, material reaproveitado, destino de resíduos ou quantidade descartada por preparação. Não é seguro calcular rendimento nem percentual de perdas."
        />
      </div>
    );
  if (id === "compras")
    return (
      <div className="grid gap-5">
        <Panel
          title="Notas fiscais importadas"
          description="O total é do documento e não representa custo unitário por produto."
        >
          {invoiceLoading ? (
            <BackendNotice>Carregando documentos fiscais…</BackendNotice>
          ) : (
            <InvoiceTable invoices={invoices} />
          )}
        </Panel>
        <Panel title="Entradas de estoque">
          <MovementTable
            rows={analytics.movementRows.filter(
              (row) => row.movement.type === "entry",
            )}
            serviceLabels={serviceLabels}
          />
        </Panel>
        <Info
          title="Desempenho de fornecedor indisponível"
          text="Não existem pedidos persistidos com entrega prevista, quantidade solicitada/aceita, atraso, divergência ou ocorrência de qualidade. Não calculamos pontualidade ou atendimento sem esses dados."
        />
      </div>
    );
  if (id === "estrategia")
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Cobertura e reposição"
          description="Cobertura = saldo atual ÷ média diária; sugestão considera a meta cadastrada."
        >
          <ProductTable rows={analytics.productRows} strategy />
        </Panel>
        <Panel title="Produtos de maior consumo">
          <ProductTable rows={analytics.topConsumption} consumption />
        </Panel>
        <Info
          title="Curva ABC financeira indisponível"
          text="Não há custo unitário confiável por produto nem método de custeio. O total da nota não pode ser rateado nos itens. Por isso, curva ABC e valores de consumo não serão simulados."
        />
        <Info
          title="Necessidade de compra parcial"
          text="Não há pedidos pendentes, entradas previstas, prazo de reposição nem estoque de segurança por produto. A sugestão não desconta compromissos e não gera pedido."
        />
      </div>
    );
  if (id === "indicadores")
    return (
      <div className="grid gap-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Movimentos por dia">
            <MovementChart analytics={analytics} />
          </Panel>
          <Panel title="Saídas por categoria">
            <CategoryChart analytics={analytics} />
          </Panel>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Níveis de estoque">
            <StockChart counts={analytics.stockCounts} />
          </Panel>
          <Info
            title="Indicadores financeiros indisponíveis"
            text="O sistema não guarda custo unitário nem método de custeio por produto. Não exibimos valor do estoque, custo de consumo, perdas em dinheiro nem evolução financeira."
          />
        </div>
      </div>
    );
  return (
    <div className="grid gap-5">
      <Panel
        title="Alertas explicáveis"
        description="Regras determinísticas com evidência e ação sugerida; sem conclusões geradas por IA."
      >
        <InsightList items={analytics.insights} />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Mudança de consumo">
          <Comparison analytics={analytics} />
        </Panel>
        <Panel title="Risco de abastecimento">
          <ProductTable
            rows={analytics.productRows.filter(
              (row) =>
                row.status !== "adequado" ||
                (row.coverage !== null && row.coverage <= 7),
            )}
            strategy
          />
        </Panel>
      </div>
    </div>
  );
}

function ProductTable({
  rows,
  detailed = false,
  consumption = false,
  strategy = false,
  empty = "Nenhum produto corresponde aos filtros.",
}: {
  rows: ReportProductRow[];
  detailed?: boolean;
  consumption?: boolean;
  strategy?: boolean;
  empty?: string;
}) {
  const ordered = [...rows].sort((a, b) =>
    strategy
      ? (a.coverage ?? Infinity) - (b.coverage ?? Infinity)
      : consumption
        ? a.product.unit.localeCompare(b.product.unit) || b.exits - a.exits
        : a.product.name.localeCompare(b.product.name, "pt-BR"),
  );
  const columns = [
    "Código",
    "Produto",
    "Categoria",
    "Marca",
    "Un.",
    "Saldo",
    "Mínimo",
    "Meta",
  ];
  if (detailed) columns.push("Situação");
  if (consumption) columns.push("Saídas", "Média diária");
  if (strategy) columns.push("Cobertura", "Reposição sugerida");
  return (
    <DataTable
      columns={columns}
      empty={empty}
      rows={ordered.map((row) => [
        row.product.sku || "—",
        row.product.name,
        row.product.categoryName,
        row.product.brand ?? "—",
        row.product.unit,
        fmt(row.product.balance),
        fmt(row.product.minimum),
        row.product.target === null ? "—" : fmt(row.product.target),
        ...(detailed
          ? [
              <Badge
                key="s"
                variant={
                  row.status === "sem_saldo" || row.status === "critico"
                    ? "destructive"
                    : row.status === "baixo" || row.status === "acima"
                      ? "secondary"
                      : "outline"
                }
              >
                {STOCK_STATUS_LABEL[row.status]}
              </Badge>,
            ]
          : []),
        ...(consumption
          ? [
              fmt(row.exits),
              row.averageDaily === null
                ? "Histórico insuficiente"
                : fmt(row.averageDaily) + " " + row.product.unit + "/dia",
            ]
          : []),
        ...(strategy
          ? [
              row.coverage === null
                ? "Sem estimativa"
                : fmt(row.coverage) + " dias",
              row.reorder === null
                ? "Meta não cadastrada"
                : fmt(row.reorder) + " " + row.product.unit,
            ]
          : []),
      ])}
    />
  );
}

function MovementTable({
  rows,
  serviceLabels,
}: {
  rows: ReportMovementRow[];
  serviceLabels: Record<string, string>;
}) {
  const ordered = [...rows].sort((a, b) =>
    b.movement.occurredAt.localeCompare(a.movement.occurredAt),
  );
  return (
    <DataTable
      columns={[
        "Data/hora",
        "Tipo",
        "Produto",
        "Código",
        "Quantidade",
        "Lote",
        "Serviço",
        "Destino",
        "Retirado por",
        "Responsável",
        "Documento",
        "Observação",
      ]}
      empty="Não há movimentações neste recorte."
      rows={ordered.map(({ movement, item }) => [
        formatDateTime(movement.occurredAt),
        movementTypeLabel(movement.type),
        item.name,
        item.sku || "—",
        fmt(item.quantity) + " " + item.unit,
        item.lotNumber ?? "—",
        movement.service
          ? (serviceLabels[movement.service] ?? movement.service)
          : "—",
        item.destination ?? "—",
        item.recipient ?? "—",
        movement.userName ?? movement.userId.slice(0, 8),
        movement.sourceReference ?? "—",
        movement.note ?? "—",
      ])}
    />
  );
}

function LotTable({
  analytics,
}: {
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>;
}) {
  const todayDate = nowInOperationalTz().date;
  const rows = analytics.lots
    .filter((lot) => lot.expiresOn && lot.quantity > 0)
    .map((lot) => {
      const product = analytics.products.find(
        (item) => item.id === lot.productId,
      );
      const remaining = Math.round(
        (Date.parse((lot.expiresOn ?? "") + "T00:00:00Z") -
          Date.parse(todayDate + "T00:00:00Z")) /
          86400000,
      );
      return [
        product?.name ?? "Produto",
        product?.brand ?? "—",
        lot.lotNumber,
        fmt(lot.quantity) + " " + (product?.unit ?? "un"),
        "Não disponível",
        lot.expiresOn ?? "—",
        remaining,
        remaining < 0
          ? "Vencido"
          : remaining <= analytics.expiryWarningDays
            ? "Atenção"
            : "Normal",
      ];
    })
    .sort((a, b) => Number(a[6]) - Number(b[6]));
  return (
    <DataTable
      columns={[
        "Produto",
        "Marca",
        "Lote",
        "Saldo",
        "Data de entrada",
        "Validade",
        "Dias restantes",
        "Situação",
      ]}
      empty="Não há lotes com validade cadastrada para os produtos filtrados."
      rows={rows}
    />
  );
}

function InvoiceTable({
  invoices,
}: {
  invoices: {
    id: string;
    supplier_id: string;
    invoice_number: string;
    series: string;
    issue_date: string | null;
    invoice_total: number | null;
    created_at: string;
  }[];
}) {
  const suppliers = useCatalog().suppliers.data ?? [];
  return (
    <DataTable
      columns={[
        "Nota",
        "Série",
        "Fornecedor",
        "Emissão",
        "Total documento",
        "Registrada em",
      ]}
      empty="Não há documentos fiscais armazenados nesta unidade."
      rows={invoices.map((item) => [
        item.invoice_number,
        item.series,
        suppliers.find((supplier) => supplier.id === item.supplier_id)?.name ??
          "Fornecedor",
        item.issue_date ?? "—",
        item.invoice_total === null
          ? "Não informado"
          : item.invoice_total.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            }),
        formatDateTime(item.created_at),
      ])}
    />
  );
}

function MovementChart({
  analytics,
}: {
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>;
}) {
  if (!analytics.unitCompatible)
    return (
      <EmptyChart text="Selecione uma unidade de medida para comparar quantidades sem misturar unidades incompatíveis." />
    );
  if (!analytics.byDay.length)
    return <EmptyChart text="Sem movimentações no período." />;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={analytics.byDay}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(date: string) => date.slice(5)}
          />
          <YAxis />
          <Tooltip labelFormatter={(value) => "Data: " + value} />
          <Legend />
          <Bar
            dataKey="entries"
            name="Entradas"
            fill="#16a34a"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="exits"
            name="Saídas"
            fill="#173a6b"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="losses"
            name="Perdas"
            fill="#dc5050"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryChart({
  analytics,
}: {
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>;
}) {
  if (!analytics.unitCompatible)
    return (
      <EmptyChart text="Selecione uma unidade de medida para comparar categorias sem misturar unidades." />
    );
  if (!analytics.byCategory.some((item) => item.exits > 0))
    return <EmptyChart text="Sem saídas no período." />;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={analytics.byCategory.slice(0, 10)}
          layout="vertical"
          margin={{ left: 16 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" />
          <YAxis
            type="category"
            dataKey="category"
            width={115}
            tick={{ fontSize: 11 }}
          />
          <Tooltip />
          <Bar
            dataKey="exits"
            name="Saídas"
            fill="#0e7490"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StockChart({ counts }: { counts: Record<StockStatus, number> }) {
  const data = (Object.entries(STOCK_STATUS_LABEL) as [StockStatus, string][])
    .map(([status, name]) => ({ name, value: counts[status] }))
    .filter((item) => item.value);
  if (!data.length) return <EmptyChart text="Sem produtos classificados." />;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={52}
            outerRadius={88}
            paddingAngle={2}
            label
          >
            {data.map((item, index) => (
              <Cell key={item.name} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function Comparison({
  analytics,
}: {
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>;
}) {
  if (
    analytics.priorPeriodExits === null ||
    analytics.currentPeriodExits === null
  )
    return (
      <p className="text-sm text-muted-foreground">
        Selecione uma unidade de medida compatível e use saídas ou todos os
        movimentos para comparar consumo. Não misturamos unidades diferentes.
      </p>
    );
  const difference = analytics.currentPeriodExits - analytics.priorPeriodExits;
  const percent =
    analytics.priorPeriodExits === 0
      ? null
      : (difference / analytics.priorPeriodExits) * 100;
  const variation =
    percent === null
      ? "Base anterior zero"
      : (difference > 0 ? "+" : "") +
        fmt(difference) +
        " (" +
        (percent > 0 ? "+" : "") +
        fmt(percent) +
        "%)";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Período atual" value={fmt(analytics.currentPeriodExits)} />
      <Metric
        label="Período anterior"
        value={fmt(analytics.priorPeriodExits)}
      />
      <Metric label="Variação" value={variation} />
    </div>
  );
}

function UnitTable({
  analytics,
}: {
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>;
}) {
  return (
    <DataTable
      columns={["Unidade", "Entradas", "Saídas", "Perdas registradas"]}
      empty="Sem movimentações no período."
      rows={analytics.byUnit.map((row) => [
        row.unit,
        fmt(row.entries),
        fmt(row.exits),
        fmt(row.losses),
      ])}
    />
  );
}

function InsightList({ items }: { items: ReportInsight[] }) {
  if (!items.length)
    return (
      <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
        Nenhum alerta foi disparado pelos critérios atuais; isso não significa
        ausência de riscos ainda não registrados.
      </div>
    );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item, index) => (
        <article key={item.title + index} className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium">{item.title}</h3>
            <Badge
              variant={
                item.priority === "urgente" || item.priority === "alta"
                  ? "destructive"
                  : "secondary"
              }
            >
              {item.priority}
            </Badge>
          </div>
          <p className="mt-2 text-sm">
            <strong>Evidência:</strong> {item.evidence}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <strong>Impacto possível:</strong> {item.impact}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <strong>Ação sugerida:</strong> {item.recommendation}
          </p>
        </article>
      ))}
    </div>
  );
}

function Info({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft/30 p-4">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function Methodology() {
  return (
    <details className="print:hidden rounded-lg border bg-muted/20 p-4 text-sm">
      <summary className="cursor-pointer font-medium">
        Metodologia e limites dos dados
      </summary>
      <ul className="mt-3 grid list-disc gap-2 pl-5 text-muted-foreground">
        <li>
          Consumo considera movimentos de saída; ajustes e perdas ficam
          separados.
        </li>
        <li>
          Média diária = saídas ÷ dias corridos. Cobertura = saldo atual ÷ média
          diária. Sem histórico mínimo, média e cobertura ficam indisponíveis.
        </li>
        <li>
          Reposição sugerida = máximo entre zero e meta cadastrada menos saldo
          atual. Não considera reservas, pedidos pendentes, entregas previstas,
          prazo de fornecedor ou estoque de segurança.
        </li>
        <li>
          O catálogo não guarda custo unitário nem método de custeio; relatórios
          financeiros não serão estimados.
        </li>
        <li>
          Não há registros estruturados para inventário físico, devoluções,
          estornos, transferências, fabricação ou aproveitamento de resíduos.
        </li>
        <li>
          O relatório pagina as consultas e traz todos os registros do período.
        </li>
      </ul>
    </details>
  );
}

function DataTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: (string | number | React.ReactNode)[][];
  empty: string;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows.length]);
  const size = 25;
  const count = Math.max(1, Math.ceil(rows.length / size));
  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded-md border">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  className="whitespace-nowrap px-3 py-2.5 font-semibold"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, index) => (
              <tr
                key={index}
                className={`hover:bg-muted/30 ${index < page * size || index >= (page + 1) * size ? "reports-print-extra-row hidden" : ""}`}
              >
                {row.map((cell, column) => (
                  <td key={column} className="max-w-64 px-3 py-2.5 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {empty}
          </p>
        )}
      </div>
      {rows.length > size && (
        <div className="reports-table-pagination flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {rows.length} registros · página {page + 1} de {count}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= count - 1}
              onClick={() => setPage((value) => value + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordTable({ rows }: { rows: Record<string, string | number>[] }) {
  const columns = rows.length
    ? [...new Set(rows.flatMap((row) => Object.keys(row)))]
    : ["Resultado"];
  return (
    <DataTable
      columns={columns}
      empty="Nenhum registro corresponde aos filtros selecionados."
      rows={rows.map((row) => columns.map((column) => row[column] ?? "—"))}
    />
  );
}

/** Converte os relatórios A-F da antiga tela Planejamento em formatos da Central. */
function getPlanningReportRows(
  id: ReportId,
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>,
  serviceLabels: Record<string, string>,
): Record<string, string | number>[] {
  const inventory = analytics.productRows.map((row) => ({
    Produto: row.product.name,
    SKU: row.product.sku,
    Categoria: row.product.categoryName,
    Unidade: row.product.unit,
    Saldo: row.product.balance,
    Mínimo: row.product.minimum,
    Meta: row.product.target ?? "Não cadastrada",
    Entradas: row.entries,
    Saídas: row.exits,
    PerdasRegistradas: row.losses,
    ConsumoDiário: row.averageDaily ?? "Histórico insuficiente",
    CoberturaDias: row.coverage ?? "Sem estimativa",
    Situação: STOCK_STATUS_LABEL[row.status],
    ReposiçãoSugerida: row.reorder ?? "Meta não cadastrada",
  }));
  if (id === "geral-estoque") return inventory;
  if (id === "analitico-mov")
    return movementExportRows(analytics.movementRows, serviceLabels);
  if (id === "estoque-categoria") {
    const groups = new Map<
      string,
      {
        category: string;
        unit: string;
        count: number;
        balance: number;
        minimum: number;
      }
    >();
    for (const row of analytics.productRows) {
      const key = `${row.product.categoryId ?? ""}:${row.product.unit}`;
      const group = groups.get(key) ?? {
        category: row.product.categoryName,
        unit: row.product.unit,
        count: 0,
        balance: 0,
        minimum: 0,
      };
      group.count += 1;
      group.balance += row.product.balance;
      group.minimum += row.product.minimum;
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => ({
      Categoria: group.category,
      Unidade: group.unit,
      Produtos: group.count,
      Saldo: group.balance,
      EstoqueMínimo: group.minimum,
    }));
  }
  if (id === "consolidado") {
    const stockRows = inventory.map((row) => ({
      Seção: "Estoque",
      DataHora: "—",
      Tipo: "—",
      Produto: row.Produto,
      SKU: row.SKU,
      Unidade: row.Unidade,
      Quantidade: row.Saldo,
      Categoria: row.Categoria,
      Serviço: "—",
      Destino: "—",
      Responsável: "—",
      Situação: row.Situação,
      Reposição: row.ReposiçãoSugerida,
    }));
    const movementRows = analytics.movementRows.map(({ movement, item }) => ({
      Seção: "Movimentação",
      DataHora: formatDateTime(movement.occurredAt),
      Tipo: movementTypeLabel(movement.type),
      Produto: item.name,
      SKU: item.sku,
      Unidade: item.unit,
      Quantidade: item.quantity,
      Categoria:
        analytics.products.find((product) => product.id === item.productId)
          ?.categoryName ?? "—",
      Serviço: movement.service
        ? (serviceLabels[movement.service] ?? movement.service)
        : "—",
      Destino: item.destination ?? "—",
      Responsável: movement.userName ?? movement.userId.slice(0, 8),
      Situação: movement.exitType ?? "—",
      Reposição: "—",
    }));
    return [...stockRows, ...movementRows];
  }

  const totals = new Map<
    string,
    {
      type: string;
      product: string;
      sku: string;
      unit: string;
      service: string;
      destination: string;
      quantity: number;
    }
  >();
  for (const { movement, item } of analytics.movementRows) {
    const type = movementTypeLabel(movement.type);
    const service = movement.service
      ? (serviceLabels[movement.service] ?? movement.service)
      : (movement.sourceReference ?? "—");
    const destination = item.destination ?? "—";
    const grouping =
      id === "mov-produto" ? `${service}:${destination}` : "ranking";
    // Inclui a unidade no agrupamento para nunca somar medidas incompatíveis.
    const key = `${item.productId}:${item.unit}:${type}:${grouping}`;
    const row = totals.get(key) ?? {
      type,
      product: item.name,
      sku: item.sku,
      unit: item.unit,
      service,
      destination,
      quantity: 0,
    };
    row.quantity += item.quantity;
    totals.set(key, row);
  }
  return [...totals.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .map((row) =>
      id === "mov-produto"
        ? {
            Tipo: row.type,
            Produto: row.product,
            SKU: row.sku,
            "Serviço / origem": row.service,
            Destino: row.destination,
            Quantidade: row.quantity,
            Unidade: row.unit,
          }
        : {
            Tipo: row.type,
            Produto: row.product,
            SKU: row.sku,
            Movimentado: row.quantity,
            Unidade: row.unit,
          },
    );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "Todos",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">{allLabel}</SelectItem>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular">{value}</p>
    </div>
  );
}
function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function getExportRows(
  id: ReportId | null,
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>,
  invoices: {
    supplier_id: string;
    invoice_number: string;
    series: string;
    issue_date: string | null;
    invoice_total: number | null;
  }[],
  serviceLabels: Record<string, string>,
  suppliers: { id: string; name: string }[],
): Record<string, string | number>[] {
  if (
    id === "mov-produto" ||
    id === "analitico-mov" ||
    id === "estoque-categoria" ||
    id === "geral-estoque" ||
    id === "ranking-mov" ||
    id === "consolidado"
  )
    return getPlanningReportRows(id, analytics, serviceLabels);
  const products = (items: ReportProductRow[]) =>
    items.map((row) => ({
      Código: row.product.sku,
      Produto: row.product.name,
      Categoria: row.product.categoryName,
      Marca: row.product.brand ?? "—",
      Unidade: row.product.unit,
      Saldo: row.product.balance,
      Mínimo: row.product.minimum,
      Meta: row.product.target ?? "Não cadastrada",
      Situação: STOCK_STATUS_LABEL[row.status],
      Entradas: row.entries,
      Saídas: row.exits,
      PerdasRegistradas: row.losses,
      MédiaDiária: row.averageDaily ?? "Histórico insuficiente",
      CoberturaDias: row.coverage ?? "Sem estimativa",
      ReposiçãoSugerida: row.reorder ?? "Meta não cadastrada",
    }));
  const movements = (items: ReportMovementRow[]) =>
    movementExportRows(items, serviceLabels);
  if (id === "perdas")
    return movements(
      analytics.movementRows.filter((row) => row.movement.type === "loss"),
    );
  if (id === "compras")
    return [
      ...invoices.map((item) => ({
        Tipo: "Documento fiscal",
        Documento: item.invoice_number,
        Série: item.series,
        Produto: "—",
        Código: "—",
        Fornecedor:
          suppliers.find((supplier) => supplier.id === item.supplier_id)
            ?.name ?? "Fornecedor não localizado",
        Data: item.issue_date ?? "—",
        Quantidade: "—",
        Unidade: "—",
        ValorDocumento: item.invoice_total ?? "Não informado",
        Responsável: "—",
        ServiçoDestino: "—",
      })),
      ...analytics.movementRows
        .filter((row) => row.movement.type === "entry")
        .map(({ movement, item }) => ({
          Tipo: "Entrada de estoque",
          Documento: movement.sourceReference ?? "—",
          Série: "—",
          Produto: item.name,
          Código: item.sku,
          Fornecedor: "—",
          Data: movement.occurredAt,
          Quantidade: item.quantity,
          Unidade: item.unit,
          ValorDocumento: "Não informado",
          Responsável: movement.userName ?? movement.userId,
          ServiçoDestino: item.destination ?? "—",
        })),
    ];
  if (id === "indicadores") {
    if (analytics.unitCompatible)
      return analytics.byDay.map((row) => ({
        Data: row.date,
        Entradas: row.entries,
        Saídas: row.exits,
        PerdasRegistradas: row.losses,
      }));
    const counts = new Map<
      string,
      { entries: number; exits: number; losses: number }
    >();
    for (const { movement } of analytics.movementRows) {
      const date = nowInOperationalTz(new Date(movement.occurredAt)).date;
      const current = counts.get(date) ?? { entries: 0, exits: 0, losses: 0 };
      if (movement.type === "entry") current.entries += 1;
      if (movement.type === "exit") current.exits += 1;
      if (movement.type === "loss") current.losses += 1;
      counts.set(date, current);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, row]) => ({
        Data: date,
        LinhasDeEntrada: row.entries,
        LinhasDeSaída: row.exits,
        LinhasDePerda: row.losses,
      }));
  }
  if (id === "inteligencia")
    return analytics.insights.map((row) => ({
      Prioridade: row.priority,
      Indicador: row.title,
      Evidência: row.evidence,
      ImpactoPossível: row.impact,
      Recomendação: row.recommendation,
    }));
  if (id === "consumo")
    return products(analytics.productRows.filter((row) => row.exits > 0));
  return products(analytics.productRows);
}

function movementExportRows(
  items: ReportMovementRow[],
  serviceLabels: Record<string, string>,
) {
  return items.map(({ movement, item }) => ({
    DataHora: formatDateTime(movement.occurredAt),
    Tipo: movementTypeLabel(movement.type),
    Produto: item.name,
    Código: item.sku,
    Quantidade: item.quantity,
    Unidade: item.unit,
    Lote: item.lotNumber ?? "—",
    Validade: item.expiresOn ?? "—",
    Serviço: movement.service
      ? (serviceLabels[movement.service] ?? movement.service)
      : "—",
    Destino: item.destination ?? "—",
    RetiradoPor: item.recipient ?? "—",
    Responsável: movement.userName ?? movement.userId,
    Documento: movement.sourceReference ?? "—",
    Observação: movement.note ?? "—",
  }));
}

function lotExportRows(
  analytics: NonNullable<ReturnType<typeof calculateReportAnalytics>>,
) {
  return analytics.lots.map((lot) => ({
    Produto:
      analytics.products.find((item) => item.id === lot.productId)?.name ??
      "Produto",
    Lote: lot.lotNumber,
    Saldo: lot.quantity,
    Unidade:
      analytics.products.find((item) => item.id === lot.productId)?.unit ?? "—",
    Validade: lot.expiresOn ?? "Não cadastrada",
  }));
}

function addWorkbookSheet(
  workbook: Workbook,
  name: string,
  rows: Record<string, string | number>[],
) {
  const sheet = workbook.addWorksheet(name);
  if (!rows.length) {
    sheet.addRow(["Nenhum registro para os filtros selecionados."]);
    return;
  }
  sheet.addRow(Object.keys(rows[0] ?? {}));
  rows.forEach((row) => sheet.addRow(Object.values(row)));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF173A6B" },
  };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Object.keys(rows[0] ?? {}).length },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  // Os cabeçalhos já estão na linha 1; `header` sobrescreveria essa linha.
  sheet.columns = Object.keys(rows[0] ?? {}).map((key) => ({
    width: Math.min(36, Math.max(14, key.length + 4)),
  }));
}

function selectLabel(
  id: string,
  rows: { id: string; name: string }[],
  fallback: string,
) {
  return id === "todos"
    ? fallback
    : (rows.find((row) => row.id === id)?.name ?? "Selecionado");
}
function movementFilter(type: string) {
  return type === "todos"
    ? "Todos"
    : type === "entry"
      ? "Entradas"
      : type === "exit"
        ? "Saídas"
        : type === "loss"
          ? "Perdas"
          : "Ajustes";
}
function fmt(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
function boundary(date: string, end: boolean) {
  return date
    ? new Date(
        date + "T" + (end ? "23:59:59" : "00:00:00") + "-03:00",
      ).toISOString()
    : undefined;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
