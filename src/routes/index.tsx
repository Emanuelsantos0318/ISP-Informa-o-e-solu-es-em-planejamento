import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  CalendarClock,
  History,
  Package,
  TrendingUp,
} from "lucide-react";
import { StatCard } from "@/components/common/StatCard";
import { Panel, PageIntro } from "@/components/common/Panel";
import { EmptyState } from "@/components/common/EmptyState";
import { BackendNotice } from "@/components/common/BackendNotice";
import {
  PeriodFilter,
  type PeriodValue,
} from "@/components/common/PeriodFilter";
import { MovementActions } from "@/components/movements/MovementActions";
import {
  getPeriodRange,
  formatDateTime,
  formatIsoDate,
  nowInOperationalTz,
} from "@/lib/datetime";
import {
  classifyExpiry,
  classifyStock,
  DEFAULT_STOCK_SETTINGS,
  suggestReorder,
} from "@/lib/rules/stock";
import { useInventorySnapshot } from "@/lib/supabase/useInventorySnapshot";
import { useStockSettings } from "@/lib/supabase/useStockSettings";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/supabase/operational-settings";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Início · ISP — Gestão de Estoque" },
      { name: "description", content: "Painel operacional do estoque." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [period, setPeriod] = useState<PeriodValue>({
    preset: "7d",
    from: "",
    to: "",
  });
  const range = getPeriodRange(period.preset, new Date(), period);
  const from = range
    ? new Date(`${range.from}T00:00:00-03:00`).toISOString()
    : undefined;
  const to = range
    ? new Date(`${range.to}T23:59:59-03:00`).toISOString()
    : undefined;
  const snapshotQuery = useInventorySnapshot({ from, to });
  const settingsQuery = useStockSettings();
  const operationalQuery = useOperationalSettings();
  const { units, unitId } = useOperationalScope();
  const settings = settingsQuery.data ?? DEFAULT_STOCK_SETTINGS;
  const operational = operationalQuery.data ?? DEFAULT_OPERATIONAL_SETTINGS;
  const snapshot = snapshotQuery.data;
  const products = snapshot?.products.filter((product) => product.active) ?? [];
  const movements = snapshot?.movements ?? [];
  const stats = useMemo(() => {
    const entries = movements.filter((movement) => movement.type === "entry");
    const exits = movements.filter((movement) => movement.type === "exit");
    const belowMinimum = products.filter((product) =>
      ["sem_saldo", "critico", "baixo"].includes(
        classifyStock(
          {
            balance: product.balance,
            min: product.minimum,
            max: product.target,
          },
          settings,
        ),
      ),
    ).length;
    const today = nowInOperationalTz().date;
    const expiredLots = (snapshot?.lots ?? []).filter(
      (lot) =>
        lot.expiresOn &&
        lot.quantity > 0 &&
        classifyExpiry(lot.expiresOn, today, settings) === "vencido",
    ).length;
    const nearExpiryLots = (snapshot?.lots ?? []).filter(
      (lot) =>
        lot.expiresOn &&
        lot.quantity > 0 &&
        classifyExpiry(lot.expiresOn, today, settings) === "proximo",
    ).length;
    const reorderCount = products.filter(
      (product) =>
        (suggestReorder({ balance: product.balance, target: product.target }) ??
          0) > 0,
    ).length;
    return {
      entries,
      exits,
      belowMinimum,
      expiredLots,
      nearExpiryLots,
      reorderCount,
    };
  }, [movements, products, settings, snapshot?.lots, range?.to]);
  const daily = useMemo(() => {
    const days = new Map<
      string,
      { day: string; Entradas: number; Saídas: number }
    >();
    for (const movement of movements) {
      const day = formatDateTime(movement.occurredAt).split(" ")[0] ?? "";
      const row = days.get(day) ?? { day, Entradas: 0, Saídas: 0 };
      if (movement.type === "entry") row.Entradas += movement.itemCount;
      if (movement.type === "exit") row.Saídas += movement.itemCount;
      days.set(day, row);
    }
    return [...days.values()].reverse();
  }, [movements]);
  const byService = useMemo(() => {
    const counts = new Map<string, number>();
    for (const movement of movements.filter((item) => item.type === "exit")) {
      const label = movement.service
        ? (operational.serviceLabels[
            movement.service as keyof typeof operational.serviceLabels
          ] ?? movement.service)
        : "Sem serviço";
      counts.set(
        label,
        (counts.get(label) ?? 0) +
          movement.items.reduce((sum, item) => sum + item.quantity, 0),
      );
    }
    return [...counts].map(([name, quantity]) => ({ name, quantity }));
  }, [movements, operational.serviceLabels]);
  const topProducts = useMemo(() => {
    const counts = new Map<
      string,
      { name: string; quantity: number; unit: string }
    >();
    for (const movement of movements.filter((item) => item.type === "exit")) {
      for (const item of movement.items) {
        const row = counts.get(item.productId) ?? {
          name: item.name,
          quantity: 0,
          unit: item.unit,
        };
        row.quantity += item.quantity;
        counts.set(item.productId, row);
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 8);
  }, [movements]);
  const recent = movements.slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <section className="surface bg-hero flex flex-wrap items-center justify-between gap-5 p-5 md:p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {units.find((unit) => unit.id === unitId)?.name ??
              "Unidade operacional"}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
            Painel operacional
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Indicadores da unidade selecionada, atualizados a partir do
            Supabase.
          </p>
        </div>
        <MovementActions size="lg" />
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageIntro
          title="Resumo do estoque"
          description="As entradas e saídas respeitam o período; saldos representam a posição atual."
        />
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>
      {snapshotQuery.isError && (
        <BackendNotice>
          Não foi possível carregar os indicadores desta unidade. Confira a
          conexão e as permissões.
        </BackendNotice>
      )}
      {snapshotQuery.isLoading && (
        <BackendNotice>Carregando dados reais do estoque…</BackendNotice>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Produtos ativos"
          value={snapshot ? products.length : null}
          unit="produtos"
          icon={Package}
          tone="primary"
        />
        <StatCard
          label="Entradas no período"
          value={
            snapshot
              ? stats.entries.reduce((sum, row) => sum + row.itemCount, 0)
              : null
          }
          unit="itens recebidos"
          icon={ArrowDownToLine}
          tone="success"
        />
        <StatCard
          label="Saídas no período"
          value={
            snapshot
              ? stats.exits.reduce((sum, row) => sum + row.itemCount, 0)
              : null
          }
          unit="itens consumidos"
          icon={ArrowUpFromLine}
          tone="primary"
        />
        <StatCard
          label="Abaixo do mínimo"
          value={snapshot ? stats.belowMinimum : null}
          unit="produtos"
          icon={AlertTriangle}
          tone="danger"
        />
        <StatCard
          label="Lotes próximos do vencimento"
          value={snapshot ? stats.nearExpiryLots + stats.expiredLots : null}
          unit="lotes com saldo"
          icon={CalendarClock}
          tone="warning"
        />
        <StatCard
          label="Reposição necessária"
          value={snapshot ? stats.reorderCount : null}
          unit="produtos"
          icon={TrendingUp}
          tone="primary"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel
          title="Entradas e saídas"
          description={
            range
              ? `${formatIsoDate(range.from)} a ${formatIsoDate(range.to)}`
              : "Informe um período válido"
          }
          empty={!daily.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar
                dataKey="Entradas"
                fill="hsl(var(--success))"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="Saídas"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel
          title="Consumo por serviço"
          description="Quantidade de produtos baixados no período"
          empty={!byService.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byService} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 11 }}
              />
              <Tooltip />
              <Bar
                dataKey="quantity"
                name="Quantidade"
                fill="hsl(var(--chart-2))"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel
          title="Produtos com maior saída"
          description="Mantém a unidade própria de cada produto"
          empty={!topProducts.length}
        >
          <div className="divide-y">
            {topProducts.map((row) => (
              <div
                key={row.name}
                className="flex justify-between gap-4 py-2 text-sm"
              >
                <span>{row.name}</span>
                <strong>
                  {row.quantity.toLocaleString("pt-BR")} {row.unit}
                </strong>
              </div>
            ))}
          </div>
        </ChartPanel>
        <ChartPanel
          title="Situação por categoria"
          description="Produtos ativos por categoria"
          empty={!products.length}
        >
          <div className="divide-y">
            {[...new Set(products.map((item) => item.categoryName))]
              .sort()
              .map((category) => (
                <div
                  key={category}
                  className="flex justify-between gap-4 py-2 text-sm"
                >
                  <span>{category}</span>
                  <strong>
                    {
                      products.filter((item) => item.categoryName === category)
                        .length
                    }{" "}
                    produtos
                  </strong>
                </div>
              ))}
          </div>
        </ChartPanel>
      </div>
      <Panel
        title="Movimentações recentes"
        description="Horários de Salvador (BA)"
        bodyClassName="p-0"
      >
        {!recent.length ? (
          <EmptyState
            icon={History}
            title="Nenhuma movimentação no período"
            description="Entradas e saídas confirmadas aparecerão aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Data e hora",
                    "Tipo",
                    "Itens",
                    "Quantidade",
                    "Responsável",
                    "Serviço",
                  ].map((label) => (
                    <th key={label} className="px-4 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {recent.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-4 py-3">
                      {formatDateTime(movement.occurredAt)}
                    </td>
                    <td className="px-4 py-3">
                      {movement.type === "entry"
                        ? "Entrada"
                        : movement.type === "exit"
                          ? "Saída"
                          : movement.type === "loss"
                            ? "Perda"
                            : "Ajuste"}
                    </td>
                    <td className="px-4 py-3">{movement.itemCount}</td>
                    <td className="px-4 py-3">
                      {movement.items
                        .reduce((sum, item) => sum + item.quantity, 0)
                        .toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-3">
                      {movement.userName ?? movement.userId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      {movement.service
                        ? (operational.serviceLabels[
                            movement.service as keyof typeof operational.serviceLabels
                          ] ?? movement.service)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ChartPanel({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Panel title={title} description={description}>
      <div className="h-[250px]">
        {empty ? (
          <EmptyState
            compact
            icon={BarChart3}
            title="Sem dados para o período"
            description="Os resultados aparecerão após registrar movimentos."
          />
        ) : (
          children
        )}
      </div>
    </Panel>
  );
}
