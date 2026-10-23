import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  CalendarClock,
  History,
  Package,
  PieChart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { StatCard } from "@/components/common/StatCard";
import { Panel } from "@/components/common/Panel";
import { EmptyState } from "@/components/common/EmptyState";
import { EmptyTable } from "@/components/common/EmptyTable";
import {
  PeriodFilter,
  type PeriodValue,
} from "@/components/common/PeriodFilter";
import { BackendNotice } from "@/components/common/BackendNotice";
import { MovementActions } from "@/components/movements/MovementActions";
import { OPERATING_UNIT } from "@/lib/navigation";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Início · ISP — Gestão de Estoque" },
      {
        name: "description",
        content:
          "Painel operacional do estoque: indicadores, gráficos e movimentações recentes.",
      },
      { property: "og:title", content: "Início · ISP — Gestão de Estoque" },
      {
        property: "og:description",
        content:
          "Painel operacional do estoque: indicadores, gráficos e movimentações recentes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const CHARTS = [
  {
    title: "Entradas × saídas",
    description: "Quantidade de movimentações ao longo do período",
    icon: TrendingUp,
  },
  {
    title: "Consumo por serviço",
    description: "Saídas agrupadas por serviço de destino",
    icon: BarChart3,
  },
  {
    title: "Produtos com maior saída",
    description: "Por produto, na unidade de medida de cada um",
    icon: BarChart3,
  },
  {
    title: "Estoque por categoria",
    description: "Quantidade de produtos ativos por categoria",
    icon: PieChart,
  },
];

function Dashboard() {
  const [period, setPeriod] = useState<PeriodValue>({
    preset: "7d",
    from: "",
    to: "",
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="surface bg-hero flex flex-wrap items-center justify-between gap-5 p-5 md:p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {OPERATING_UNIT}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
            Painel operacional
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Registre movimentações e acompanhe o estoque em tempo real.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MovementActions size="lg" />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      <BackendNotice>
        Os cartões e gráficos permanecem sem consulta até concluir a camada
        analítica; nenhum valor fictício é exibido.
      </BackendNotice>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Produtos ativos"
          value={null}
          unit="produtos cadastrados"
          icon={Package}
          tone="primary"
          hint="Total atual, independe do período"
        />
        <StatCard
          label="Entradas no período"
          value={null}
          unit="movimentações de entrada"
          icon={ArrowDownToLine}
          tone="success"
          hint="Conta registros, não quantidade física"
        />
        <StatCard
          label="Saídas no período"
          value={null}
          unit="movimentações de saída"
          icon={ArrowUpFromLine}
          tone="primary"
          hint="Conta registros, não quantidade física"
        />
        <StatCard
          label="Abaixo do mínimo"
          value={null}
          unit="produtos"
          icon={AlertTriangle}
          tone="danger"
          hint="Saldo atual menor que o mínimo"
        />
        <StatCard
          label="Próximos do vencimento"
          value={null}
          unit="lotes"
          icon={CalendarClock}
          tone="warning"
          hint="Somente produtos com validade"
        />
        <StatCard
          label="Valor estimado"
          value={null}
          unit="R$ · custo unitário × saldo"
          icon={Wallet}
          tone="primary"
          hint="Apenas produtos com custo cadastrado"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {CHARTS.map((c) => (
          <Panel key={c.title} title={c.title} description={c.description}>
            <EmptyState
              compact
              icon={c.icon}
              title="Sem dados para o período"
              description="O gráfico será exibido assim que houver movimentações registradas."
              className="min-h-[220px]"
            />
          </Panel>
        ))}
      </div>

      <Panel
        title="Movimentações recentes"
        description="Horários de Salvador (BA)"
        bodyClassName="p-0"
      >
        <EmptyTable
          icon={History}
          title="Nenhuma movimentação registrada"
          description="Entradas e saídas confirmadas aparecerão aqui com data, horário e responsável."
          columns={[
            { label: "ID" },
            { label: "Tipo" },
            { label: "Produto" },
            { label: "Quantidade", align: "right" },
            { label: "Data e horário" },
            { label: "Responsável" },
            { label: "Serviço" },
            { label: "Tipo de saída" },
          ]}
        />
      </Panel>
    </div>
  );
}
