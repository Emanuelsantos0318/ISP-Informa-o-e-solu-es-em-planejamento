import { useState } from "react";
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
import { EmptyTable } from "@/components/common/EmptyTable";
import { Field } from "@/components/common/Field";
import { BackendNotice } from "@/components/common/BackendNotice";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EXIT_TYPES, SERVICE_OPTIONS } from "@/lib/config/services";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/supabase/operational-settings";
import { STOCK_STATUS_LABEL, type StockStatus } from "@/lib/rules/stock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/planejamento")({
  head: () => ({
    meta: [
      { title: "Planejamento · ISP — Gestão de Estoque" },
      {
        name: "description",
        content:
          "Quantitativos, consumo, reposição sugerida e relatórios em PDF e Excel.",
      },
      {
        property: "og:title",
        content: "Planejamento · ISP — Gestão de Estoque",
      },
      {
        property: "og:description",
        content:
          "Quantitativos, consumo, reposição sugerida e relatórios em PDF e Excel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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

const STATUS_TONE: Record<StockStatus, string> = {
  sem_saldo: "bg-destructive",
  critico: "bg-destructive",
  baixo: "bg-warning",
  adequado: "bg-success",
  acima: "bg-chart-4",
};

const REPORTS = [
  {
    key: "A",
    title: "Consumo",
    description:
      "Consumo por produto e por serviço, com comparação entre períodos.",
    icon: BarChart2,
  },
  {
    key: "B",
    title: "Analítico de movimentações",
    description: "Cada operação individual, com responsável e filtros usados.",
    icon: Table2,
  },
  {
    key: "C",
    title: "Por categoria",
    description:
      "Entradas, saídas e saldo por categoria, sem somar unidades diferentes.",
    icon: Layers,
  },
  {
    key: "D",
    title: "Geral de estoque",
    description:
      "Todos os produtos, saldos, limites e necessidade de reposição.",
    icon: ListOrdered,
  },
  {
    key: "E",
    title: "Ranking de consumo",
    description: "Produtos com maior saída, agrupados por unidade compatível.",
    icon: Trophy,
  },
  {
    key: "F",
    title: "Consolidado",
    description: "Todos os relatórios em um único arquivo, com capa e resumo.",
    icon: FileText,
  },
];

function PlanningPage() {
  const operationalQuery = useOperationalSettings();
  const operational = operationalQuery.data ?? DEFAULT_OPERATIONAL_SETTINGS;
  const [f, setF] = useState(initial);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (k: keyof typeof initial) => (v: string) =>
    setF((cur) => ({ ...cur, [k]: v }));

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Planejamento"
        description="Análise de quantitativos, consumo e reposição. As sugestões apoiam a decisão; nenhum pedido é feito automaticamente."
      />

      <Panel
        title="Filtros de análise"
        description="Todos os resultados e relatórios respeitam os filtros aplicados."
        actions={
          dirty && (
            <Button variant="ghost" size="sm" onClick={() => setF(initial)}>
              <X /> Limpar filtros
            </Button>
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <Field label="Período inicial">
            <Input
              type="date"
              value={f.from}
              onChange={(e) => set("from")(e.target.value)}
            />
          </Field>
          <Field label="Período final">
            <Input
              type="date"
              value={f.to}
              onChange={(e) => set("to")(e.target.value)}
            />
          </Field>
          <Field label="Produto">
            <Input
              placeholder="Nome ou código"
              value={f.product}
              onChange={(e) => set("product")(e.target.value)}
            />
          </Field>
          <FilterSelect
            label="Categoria"
            value={f.category}
            onChange={set("category")}
            options={[]}
            allLabel="Todas"
            allValue="todas"
          />
          <FilterSelect
            label="Serviço de destino"
            value={f.service}
            onChange={set("service")}
            options={SERVICE_OPTIONS.map((s) => ({
              value: s.code,
              label: operational.serviceLabels[s.code] ?? s.label,
            }))}
          />
          <FilterSelect
            label="Tipo de saída"
            value={f.exitType}
            onChange={set("exitType")}
            options={EXIT_TYPES.map((t) => ({
              value: t.code,
              label: operational.exitTypeLabels[t.code] ?? t.label,
            }))}
          />
          <FilterSelect
            label="Usuário responsável"
            value={f.user}
            onChange={set("user")}
            options={[]}
          />
          <FilterSelect
            label="Situação do estoque"
            value={f.status}
            onChange={set("status")}
            options={(Object.keys(STOCK_STATUS_LABEL) as StockStatus[]).map(
              (s) => ({ value: s, label: STOCK_STATUS_LABEL[s] }),
            )}
          />
          <FilterSelect
            label="Fornecedor"
            value={f.supplier}
            onChange={set("supplier")}
            options={[]}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(Object.keys(STOCK_STATUS_LABEL) as StockStatus[]).map((s) => (
          <div key={s} className="surface flex items-center gap-3 px-4 py-3">
            <span className={cn("size-2.5 rounded-full", STATUS_TONE[s])} />
            <div>
              <p className="text-xs text-muted-foreground">
                {STOCK_STATUS_LABEL[s]}
              </p>
              <p className="text-lg font-semibold tabular text-muted-foreground/60">
                —
              </p>
            </div>
          </div>
        ))}
      </div>

      <Panel
        title="Quantitativos e reposição"
        description="Reposição sugerida = máximo entre zero e (meta de estoque − saldo atual). A meta usa o estoque máximo quando definido."
        bodyClassName="p-0"
      >
        <EmptyTable
          icon={PackageSearch}
          title="Sem produtos para analisar"
          description="Cadastre produtos e registre movimentações para ver saldos, consumo médio e cobertura em dias."
          columns={[
            { label: "Produto" },
            { label: "SKU" },
            { label: "Categoria" },
            { label: "Un." },
            { label: "Saldo", align: "right" },
            { label: "Mín.", align: "right" },
            { label: "Máx.", align: "right" },
            { label: "Entradas", align: "right" },
            { label: "Saídas", align: "right" },
            { label: "Consumo médio/dia", align: "right" },
            { label: "Situação" },
            { label: "Reposição", align: "right" },
          ]}
        />
      </Panel>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Relatórios</h3>
            <p className="text-sm text-muted-foreground">
              Visualize antes de exportar em PDF (A4) ou Excel (.xlsx).
            </p>
          </div>
        </div>
        <BackendNotice className="mb-4">
          A visualização e a exportação serão habilitadas na fase de relatórios,
          usando apenas dados reais do banco.
        </BackendNotice>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {REPORTS.map((r) => (
            <div key={r.key} className="surface flex flex-col gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                  <r.icon className="size-4.5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                      {r.key}
                    </span>
                    {r.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.description}
                  </p>
                </div>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <DisabledAction icon={Eye} label="Visualizar" />
                <DisabledAction icon={FileText} label="PDF" />
                <DisabledAction icon={FileSpreadsheet} label="Excel" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
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
  onChange: (v: string) => void;
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
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function DisabledAction({
  icon: Icon,
  label,
}: {
  icon: typeof Eye;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>
          <Button size="sm" variant="outline" disabled>
            <Icon /> {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Disponível na fase de relatórios</TooltipContent>
    </Tooltip>
  );
}
