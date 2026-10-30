import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart2,
  Eye,
  FileSpreadsheet,
  FileText,
  Layers,
  ListOrdered,
  PackageSearch,
  Table2,
  Trophy,
  X,
} from "lucide-react";
import { PageIntro, Panel } from "@/components/common/Panel";
import { BackendNotice } from "@/components/common/BackendNotice";
import { Field } from "@/components/common/Field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useInventorySnapshot } from "@/lib/supabase/useInventorySnapshot";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useStockSettings } from "@/lib/supabase/useStockSettings";
import {
  classifyStock,
  averageDailyConsumption,
  coverageDays,
  suggestReorder,
  STOCK_STATUS_LABEL,
  DEFAULT_STOCK_SETTINGS,
  type StockStatus,
} from "@/lib/rules/stock";
import {
  nowInOperationalTz,
  formatDateTime,
  getPeriodRange,
} from "@/lib/datetime";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/supabase/operational-settings";
import { EXIT_TYPES, SERVICE_OPTIONS } from "@/lib/config/services";
import type { MovementBatch, InventoryProduct } from "@/lib/supabase/inventory";

export const Route = createFileRoute("/planejamento")({
  head: () => ({
    meta: [
      { title: "Planejamento · ISP — Gestão de Estoque" },
      {
        name: "description",
        content: "Consumo, reposição e relatórios baseados no estoque real.",
      },
    ],
  }),
  component: PlanningPage,
});

const initial = {
  from: "",
  to: "",
  category: "todas",
  product: "",
  service: "todos",
  exitType: "todos",
  user: "todos",
  status: "todos",
  supplier: "todos",
};
const REPORTS = [
  {
    key: "A",
    title: "Consumo",
    description: "Saídas por produto, serviço e período.",
    icon: BarChart2,
  },
  {
    key: "B",
    title: "Analítico de movimentações",
    description: "Itens, responsáveis, horários e classificação.",
    icon: Table2,
  },
  {
    key: "C",
    title: "Por categoria",
    description: "Estoque agrupado por categoria e unidade.",
    icon: Layers,
  },
  {
    key: "D",
    title: "Geral de estoque",
    description: "Saldos, limites e reposição sugerida.",
    icon: ListOrdered,
  },
  {
    key: "E",
    title: "Ranking de consumo",
    description: "Produtos mais consumidos por unidade.",
    icon: Trophy,
  },
  {
    key: "F",
    title: "Consolidado",
    description: "Inclui posição de estoque e movimentos filtrados.",
    icon: FileText,
  },
] as const;
type ReportKey = (typeof REPORTS)[number]["key"];
type ReportRow = Record<string, string | number>;

function PlanningPage() {
  const { profile, client } = useAuth();
  const catalog = useCatalog();
  const defaultRange = getPeriodRange("30d");
  const defaultFilters = {
    ...initial,
    from: defaultRange?.from ?? "",
    to: defaultRange?.to ?? "",
  };
  const [filters, setFilters] = useState(defaultFilters);
  const snapshot = useInventorySnapshot({
    from: filtersToBoundary(filters.from, false),
    to: filtersToBoundary(filters.to, true),
  });
  const settingsQuery = useStockSettings();
  const operationalQuery = useOperationalSettings();
  const settings = settingsQuery.data ?? DEFAULT_STOCK_SETTINGS;
  const operational = operationalQuery.data ?? DEFAULT_OPERATIONAL_SETTINGS;
  const [report, setReport] = useState<ReportKey>("D");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const dirty = JSON.stringify(filters) !== JSON.stringify(defaultFilters);
  const set = (key: keyof typeof initial) => (value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const products =
    snapshot.data?.products.filter((product) => product.active) ?? [];
  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const q = filters.product.trim().toLocaleLowerCase("pt-BR");
        if (
          q &&
          !`${product.name} ${product.sku} ${product.barcode ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(q)
        )
          return false;
        if (
          filters.category !== "todas" &&
          product.categoryId !== filters.category
        )
          return false;
        if (
          filters.supplier !== "todos" &&
          product.supplierId !== filters.supplier
        )
          return false;
        if (
          filters.status !== "todos" &&
          classifyStock(
            {
              balance: product.balance,
              min: product.minimum,
              max: product.target,
            },
            settings,
          ) !== filters.status
        )
          return false;
        return true;
      }),
    [
      products,
      filters.product,
      filters.category,
      filters.supplier,
      filters.status,
      settings,
    ],
  );
  const allowedProductIds = new Set(
    filteredProducts.map((product) => product.id),
  );
  const movements = useMemo(
    () =>
      (snapshot.data?.movements ?? []).filter((movement) => {
        const date = nowInOperationalTz(new Date(movement.occurredAt)).date;
        if (filters.from && date < filters.from) return false;
        if (filters.to && date > filters.to) return false;
        if (filters.service !== "todos" && movement.service !== filters.service)
          return false;
        if (
          filters.exitType !== "todos" &&
          movement.exitType !== filters.exitType
        )
          return false;
        if (filters.user !== "todos" && movement.userId !== filters.user)
          return false;
        if (
          (filters.category !== "todas" ||
            filters.status !== "todos" ||
            filters.supplier !== "todos") &&
          !movement.items.some((item) => allowedProductIds.has(item.productId))
        )
          return false;
        const q = filters.product.trim().toLocaleLowerCase("pt-BR");
        if (
          q &&
          !movement.items.some((item) =>
            `${item.name} ${item.sku}`.toLocaleLowerCase("pt-BR").includes(q),
          )
        )
          return false;
        return true;
      }),
    [snapshot.data?.movements, filters, allowedProductIds],
  );
  const reorderRows = useMemo(
    () =>
      filteredProducts.map((product) => {
        const movementItems = movements.flatMap((movement) =>
          movement.items
            .filter((item) => item.productId === product.id)
            .map((item) => ({ item, movement })),
        );
        const entries = movementItems
          .filter(({ movement }) => movement.type === "entry")
          .reduce((sum, row) => sum + row.item.quantity, 0);
        const exits = movementItems
          .filter(({ movement }) => movement.type === "exit")
          .reduce((sum, row) => sum + row.item.quantity, 0);
        const days =
          filters.from && filters.to
            ? Math.max(
                1,
                Math.ceil(
                  (Date.parse(`${filters.to}T00:00:00Z`) -
                    Date.parse(`${filters.from}T00:00:00Z`)) /
                    86400000,
                ) + 1,
              )
            : settings.minHistoryDays;
        const average = averageDailyConsumption(exits, days, settings);
        return {
          product,
          entries,
          exits,
          average,
          coverage: coverageDays(product.balance, average),
          status: classifyStock(
            {
              balance: product.balance,
              min: product.minimum,
              max: product.target,
            },
            settings,
          ),
          reorder: suggestReorder({
            balance: product.balance,
            target: product.target,
          }),
        };
      }),
    [filteredProducts, movements, filters.from, filters.to, settings],
  );
  const categories = [
    ...new Map(
      products.map((product) => [
        product.categoryId ?? "",
        product.categoryName,
      ]),
    ).entries(),
  ]
    .filter(([id]) => id)
    .map(([id, label]) => ({ id, label }));
  const suppliers =
    catalog.suppliers.data?.map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
    })) ?? [];
  const users = [
    ...new Map(
      movements.map((movement) => [
        movement.userId,
        movement.userName ?? movement.userId.slice(0, 8),
      ]),
    ).entries(),
  ];
  const reportRows = buildReportRows(
    report,
    reorderRows,
    movements,
    operational.serviceLabels,
  );
  const entryItemCount = movements
    .filter((movement) => movement.type === "entry")
    .reduce((sum, movement) => sum + movement.itemCount, 0);
  const exitItemCount = movements
    .filter((movement) => movement.type === "exit")
    .reduce((sum, movement) => sum + movement.itemCount, 0);
  const attentionProductCount = reorderRows.filter(({ status }) =>
    ["sem_saldo", "critico", "baixo"].includes(status),
  ).length;
  const statusCounts = (Object.keys(STOCK_STATUS_LABEL) as StockStatus[]).map(
    (status) => ({
      status,
      count: filteredProducts.filter(
        (product) =>
          classifyStock(
            {
              balance: product.balance,
              min: product.minimum,
              max: product.target,
            },
            settings,
          ) === status,
      ).length,
    }),
  );

  const exportExcel = async () => {
    setExporting(true);
    setExportError(null);
    setExportMessage(null);
    try {
      const { default: ExcelJS } = await import("exceljs/dist/exceljs.min.js");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(
        REPORTS.find((item) => item.key === report)?.title ?? "Relatório",
      );
      worksheet.addRow([
        `ISP — ${REPORTS.find((item) => item.key === report)?.title ?? "Relatório"}`,
      ]);
      worksheet.addRow([
        `Unidade: ${profile?.unit_id ?? "Selecionada"}`,
        `Gerado em: ${formatDateTime(new Date())}`,
      ]);
      worksheet.addRow([]);
      if (reportRows.length) {
        worksheet.addRow(Object.keys(reportRows[0] ?? {}));
        for (const row of reportRows) worksheet.addRow(Object.values(row));
      }
      worksheet.getRow(1).font = { bold: true, size: 16 };
      worksheet.getRow(2).font = { color: { argb: "FF526176" }, size: 10 };
      const headerRow = worksheet.getRow(4);
      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF173A6B" },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = {
          bottom: { style: "medium", color: { argb: "FF0E7490" } },
        };
      });
      worksheet.views = [{ state: "frozen", ySplit: 4 }];
      if (reportRows.length) {
        worksheet.autoFilter = {
          from: { row: 4, column: 1 },
          to: { row: 4, column: Object.keys(reportRows[0] ?? {}).length },
        };
        for (let rowNumber = 5; rowNumber <= worksheet.rowCount; rowNumber++) {
          const row = worksheet.getRow(rowNumber);
          row.alignment = { vertical: "middle", wrapText: true };
          if (rowNumber % 2 === 0)
            row.eachCell((cell) => {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFF3F6FA" },
              };
            });
        }
      }
      worksheet.columns.forEach((column, index) => {
        let width = 14;
        for (const value of worksheet.getColumn(index + 1).values ?? [])
          width = Math.max(width, String(value ?? "").length);
        column.width = Math.min(42, width);
      });
      const bytes = await workbook.xlsx.writeBuffer();
      download(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `isp-relatorio-${report.toLowerCase()}.xlsx`,
      );
      setExportMessage("Planilha Excel gerada com os filtros aplicados.");
    } catch {
      setExportError("Não foi possível gerar a planilha. Tente novamente.");
    } finally {
      setExporting(false);
    }
  };
  const exportPdf = () => {
    setExportError(null);
    setExportMessage("Use a opção ‘Salvar como PDF’ na janela de impressão.");
    window.print();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Planejamento"
        description="Consumo, cobertura e reposição sugerida a partir das movimentações reais. Sugestões apoiam a decisão; nenhum pedido é enviado automaticamente."
      />
      {snapshot.isLoading && (
        <BackendNotice>Carregando dados de estoque e movimentos…</BackendNotice>
      )}
      {snapshot.isError && (
        <BackendNotice>
          Não foi possível carregar os dados da unidade. A análise não será
          calculada com valores fictícios.
        </BackendNotice>
      )}
      <Panel
        title="Filtros de análise"
        description="Período aplica-se ao consumo e aos movimentos; categoria, status e fornecedor filtram a posição do estoque."
        actions={
          dirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters(defaultFilters)}
            >
              <X /> Limpar filtros
            </Button>
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <Field label="Período inicial">
            <Input
              type="date"
              value={filters.from}
              onChange={(event) => set("from")(event.target.value)}
            />
          </Field>
          <Field label="Período final">
            <Input
              type="date"
              value={filters.to}
              onChange={(event) => set("to")(event.target.value)}
            />
          </Field>
          <Field label="Produto">
            <Input
              placeholder="Nome, SKU ou código de barras"
              value={filters.product}
              onChange={(event) => set("product")(event.target.value)}
            />
          </Field>
          <FilterSelect
            label="Categoria"
            value={filters.category}
            onChange={set("category")}
            options={categories.map(({ id, label }) => ({ value: id, label }))}
            allLabel="Todas"
            allValue="todas"
          />
          <FilterSelect
            label="Serviço"
            value={filters.service}
            onChange={set("service")}
            options={SERVICE_OPTIONS.map((item) => ({
              value: item.code,
              label: operational.serviceLabels[item.code] ?? item.label,
            }))}
          />
          <FilterSelect
            label="Tipo de saída"
            value={filters.exitType}
            onChange={set("exitType")}
            options={EXIT_TYPES.map((item) => ({
              value: item.code,
              label: operational.exitTypeLabels[item.code] ?? item.label,
            }))}
          />
          <FilterSelect
            label="Responsável"
            value={filters.user}
            onChange={set("user")}
            options={users.map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            label="Situação"
            value={filters.status}
            onChange={set("status")}
            options={(Object.keys(STOCK_STATUS_LABEL) as StockStatus[]).map(
              (value) => ({ value, label: STOCK_STATUS_LABEL[value] }),
            )}
          />
          <FilterSelect
            label="Fornecedor preferencial"
            value={filters.supplier}
            onChange={set("supplier")}
            options={suppliers.map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
          />
        </div>
      </Panel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {statusCounts.map(({ status, count }) => (
          <div
            key={status}
            className="surface flex items-center justify-between gap-3 px-4 py-3"
          >
            <span className="text-xs text-muted-foreground">
              {STOCK_STATUS_LABEL[status]}
            </span>
            <strong className="text-lg tabular">
              {snapshot.data ? count : "—"}
            </strong>
          </div>
        ))}
      </div>
      <Panel
        title="Quantitativos e reposição"
        description="Consumo médio calculado sobre o período escolhido; quando não há datas, usa a janela mínima de histórico configurada."
        bodyClassName="p-0"
      >
        {!reorderRows.length && snapshot.data ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <PackageSearch className="mx-auto mb-2 size-5" />
            Nenhum produto corresponde aos filtros.
          </div>
        ) : (
          <div
            aria-label="Lista de produtos do planejamento"
            tabIndex={0}
            className="max-h-[min(58vh,580px)] overflow-auto overscroll-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table className="w-full min-w-[1250px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                <tr>
                  {[
                    "Produto",
                    "Categoria",
                    "Un.",
                    "Saldo",
                    "Mínimo",
                    "Meta",
                    "Entradas",
                    "Saídas",
                    "Consumo/dia",
                    "Cobertura",
                    "Situação",
                    "Reposição",
                  ].map((label) => (
                    <th key={label} className="px-3 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {reorderRows.map(
                  ({
                    product,
                    entries,
                    exits,
                    average,
                    coverage,
                    status,
                    reorder,
                  }) => (
                    <tr key={product.id}>
                      <td className="px-3 py-3">
                        {product.name}
                        <span className="block text-xs text-muted-foreground">
                          {product.sku}
                        </span>
                      </td>
                      <td className="px-3 py-3">{product.categoryName}</td>
                      <td className="px-3 py-3">{product.unit}</td>
                      <td className="px-3 py-3">{fmt(product.balance)}</td>
                      <td className="px-3 py-3">{fmt(product.minimum)}</td>
                      <td className="px-3 py-3">
                        {product.target === null ? "—" : fmt(product.target)}
                      </td>
                      <td className="px-3 py-3">{fmt(entries)}</td>
                      <td className="px-3 py-3">{fmt(exits)}</td>
                      <td className="px-3 py-3">
                        {average === null
                          ? "Histórico insuficiente"
                          : fmt(average)}
                      </td>
                      <td className="px-3 py-3">
                        {coverage === null ? "—" : `${fmt(coverage)} dias`}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant="outline">
                          {STOCK_STATUS_LABEL[status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        {reorder === null ? "Defina meta" : fmt(reorder)}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <section>
        <div className="mb-3">
          <h3 className="text-base font-semibold">Relatórios</h3>
          <p className="text-sm text-muted-foreground">
            Selecione um relatório para visualizar e exportar os mesmos
            resultados filtrados.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {REPORTS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={report === item.key}
              onClick={() => setReport(item.key)}
              className={`surface flex items-start gap-3 p-4 text-left transition ${report === item.key ? "border-primary bg-primary-soft/40 ring-2 ring-primary/30 shadow-raised" : "hover:border-primary/50 hover:bg-muted/30"}`}
            >
              <span className="flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary">
                <item.icon className="size-4.5" />
              </span>
              <span>
                <strong className="block text-sm">
                  {item.key}. {item.title}
                </strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </button>
          ))}
        </div>
        <Panel
          title={`Prévia: ${REPORTS.find((item) => item.key === report)?.title ?? "Relatório"}`}
          description={`${reportRows.length} registros · filtros aplicados`}
          actions={
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  document
                    .getElementById("report-preview")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                <Eye /> Visualizar
              </Button>
              <Button size="sm" variant="outline" onClick={exportPdf}>
                <FileText /> PDF
              </Button>
              <Button
                size="sm"
                onClick={() => void exportExcel()}
                disabled={exporting}
              >
                <FileSpreadsheet /> {exporting ? "Gerando…" : "Excel .xlsx"}
              </Button>
            </>
          }
        >
          {exportMessage && (
            <p role="status" className="mb-3 text-sm text-success">
              {exportMessage}
            </p>
          )}
          {exportError && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {exportError}
            </p>
          )}
          <div
            id="report-preview"
            className="overflow-x-auto print:overflow-visible"
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
              <ReportMetric
                label="Linhas no relatório"
                value={reportRows.length}
                detail="Registros incluídos nos filtros"
                tone="primary"
              />
              <ReportMetric
                label="Itens de entrada"
                value={entryItemCount}
                detail="Linhas recebidas no período"
                tone="success"
              />
              <ReportMetric
                label="Itens de saída"
                value={exitItemCount}
                detail="Linhas baixadas no período"
                tone="warning"
              />
              <ReportMetric
                label="Produtos para atenção"
                value={attentionProductCount}
                detail="Sem saldo, crítico ou abaixo do mínimo"
                tone="danger"
              />
            </div>
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="sticky top-0 bg-primary text-xs text-primary-foreground">
                <tr>
                  {Object.keys(reportRows[0] ?? { Resultado: "" }).map(
                    (key) => (
                      <th key={key} className="px-3 py-2 font-medium">
                        {key}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {reportRows.slice(0, 100).map((row, index) => (
                  <tr key={index} className="transition-colors odd:bg-muted/20 hover:bg-primary-soft/30">
                    {Object.values(row).map((value, column) => (
                      <td key={column} className="px-3 py-2">
                        {String(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {reportRows.length > 100 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Prévia limitada a 100 linhas; a exportação inclui todos os
                resultados.
              </p>
            )}
            {!reportRows.length && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhum registro encontrado para os filtros atuais.
              </p>
            )}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function ReportMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "primary" | "success" | "warning" | "danger";
}) {
  const tones = {
    primary: "border-primary/25 bg-primary-soft/50 text-primary",
    success: "border-success/25 bg-success-soft/60 text-success",
    warning: "border-warning/35 bg-warning-soft/70 text-warning-foreground",
    danger: "border-destructive/25 bg-destructive-soft/60 text-destructive",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-medium opacity-90">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {value.toLocaleString("pt-BR")}
      </p>
      <p className="mt-1 text-[11px] text-foreground/70">{detail}</p>
    </div>
  );
}

function buildReportRows(
  report: ReportKey,
  stock: ReturnType<typeof makeStockRows>,
  movements: MovementBatch[],
  serviceLabels: Record<string, string>,
): ReportRow[] {
  if (report === "A" || report === "E") {
    const totals = new Map<
      string,
      {
        name: string;
        sku: string;
        unit: string;
        service: string;
        quantity: number;
      }
    >();
    for (const movement of movements.filter((row) => row.type === "exit"))
      for (const item of movement.items) {
        const service = movement.service
          ? (serviceLabels[movement.service] ?? movement.service)
          : "—";
        const key = `${item.productId}:${report === "A" ? service : "ranking"}`;
        const row = totals.get(key) ?? {
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          service,
          quantity: 0,
        };
        row.quantity += item.quantity;
        totals.set(key, row);
      }
    return [...totals.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .map((row) =>
        report === "A"
          ? {
              Produto: row.name,
              SKU: row.sku,
              Serviço: row.service,
              Quantidade: fmt(row.quantity),
              Unidade: row.unit,
            }
          : {
              Produto: row.name,
              SKU: row.sku,
              Consumo: fmt(row.quantity),
              Unidade: row.unit,
            },
      );
  }
  if (report === "B")
    return movements.flatMap((movement) =>
      movement.items.map((item) => ({
        Data: formatDateTime(movement.occurredAt),
        Tipo: typeLabel(movement.type),
        Produto: item.name,
        SKU: item.sku,
        Quantidade: fmt(item.quantity),
        Unidade: item.unit,
        Lote: item.lotNumber ?? "—",
        Responsável: movement.userName ?? movement.userId.slice(0, 8),
        Serviço: movement.service
          ? (serviceLabels[movement.service] ?? movement.service)
          : "—",
        Classificação:
          movement.exitType ??
          (item.adjustmentDirection === "increase"
            ? "Ajuste positivo"
            : item.adjustmentDirection === "decrease"
              ? "Ajuste negativo"
              : movement.type === "loss"
                ? "Perda"
                : "—"),
        Observação: movement.note ?? "—",
      })),
    );
  if (report === "C") {
    const groups = new Map<
      string,
      {
        category: string;
        unit: string;
        products: number;
        balance: number;
        minimum: number;
      }
    >();
    for (const row of stock) {
      const key = `${row.product.categoryName}:${row.product.unit}`;
      const current = groups.get(key) ?? {
        category: row.product.categoryName,
        unit: row.product.unit,
        products: 0,
        balance: 0,
        minimum: 0,
      };
      current.products += 1;
      current.balance += row.product.balance;
      current.minimum += row.product.minimum;
      groups.set(key, current);
    }
    return [...groups.values()].map((row) => ({
      Categoria: row.category,
      Unidade: row.unit,
      Produtos: row.products,
      Saldo: fmt(row.balance),
      Mínimo: fmt(row.minimum),
    }));
  }
  const inventory = stock.map(
    ({ product, entries, exits, average, coverage, status, reorder }) => ({
      Produto: product.name,
      SKU: product.sku,
      Categoria: product.categoryName,
      Unidade: product.unit,
      Saldo: fmt(product.balance),
      Mínimo: fmt(product.minimum),
      Meta: product.target === null ? "—" : fmt(product.target),
      Entradas: fmt(entries),
      Saídas: fmt(exits),
      "Consumo/dia": average === null ? "—" : fmt(average),
      "Cobertura (dias)": coverage === null ? "—" : fmt(coverage),
      Situação: STOCK_STATUS_LABEL[status],
      Reposição: reorder === null ? "Defina meta" : fmt(reorder),
    }),
  );
  if (report === "F")
    return [
      ...inventory.map((row) => ({
        Seção: "Estoque",
        Data: "—",
        Tipo: "—",
        Produto: row.Produto,
        SKU: row.SKU,
        Unidade: row.Unidade,
        Quantidade: row.Saldo,
        Categoria: row.Categoria,
        Serviço: "—",
        Responsável: "—",
        Situação: row.Situação,
        Reposição: row["Reposição"],
      })),
      ...movements.flatMap((movement) =>
        movement.items.map((item) => ({
          Seção: "Movimentação",
          Data: formatDateTime(movement.occurredAt),
          Tipo: typeLabel(movement.type),
          Produto: item.name,
          SKU: item.sku,
          Unidade: item.unit,
          Quantidade: fmt(item.quantity),
          Categoria: "—",
          Serviço: movement.service
            ? (serviceLabels[movement.service] ?? movement.service)
            : "—",
          Responsável: movement.userName ?? movement.userId.slice(0, 8),
          Situação: movement.exitType ?? "—",
          Reposição: "—",
        })),
      ),
    ];
  return inventory;
}

type StockRow = {
  product: InventoryProduct;
  entries: number;
  exits: number;
  average: number | null;
  coverage: number | null;
  status: StockStatus;
  reorder: number | null;
};
function makeStockRows(rows: StockRow[]) {
  return rows;
}
function fmt(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
function typeLabel(type: string) {
  return type === "entry"
    ? "Entrada"
    : type === "exit"
      ? "Saída"
      : type === "loss"
        ? "Perda"
        : "Ajuste";
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function filtersToBoundary(date: string, end: boolean) {
  return date
    ? new Date(`${date}T${end ? "23:59:59" : "00:00:00"}-03:00`).toISOString()
    : undefined;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "Todos",
  allValue = "todos",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
  allValue?: string;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={allValue}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
