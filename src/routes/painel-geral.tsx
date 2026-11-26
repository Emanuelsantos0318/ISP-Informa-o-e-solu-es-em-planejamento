import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  CalendarClock,
  Package,
} from "lucide-react";
import { BackendNotice } from "@/components/common/BackendNotice";
import { PageIntro, Panel } from "@/components/common/Panel";
import {
  PeriodFilter,
  type PeriodValue,
} from "@/components/common/PeriodFilter";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { loadInventorySnapshot } from "@/lib/supabase/inventory";
import { useStockSettings } from "@/lib/supabase/useStockSettings";
import {
  classifyExpiry,
  classifyStock,
  DEFAULT_STOCK_SETTINGS,
} from "@/lib/rules/stock";
import {
  formatIsoDate,
  getPeriodRange,
  nowInOperationalTz,
} from "@/lib/datetime";

export const Route = createFileRoute("/painel-geral")({
  head: () => ({
    meta: [
      { title: "Painel geral · ISP — Gestão de Estoque" },
      {
        name: "description",
        content: "Resumo comparativo das unidades autorizadas.",
      },
    ],
  }),
  component: GeneralDashboard,
});

type UnitSummary = {
  id: string;
  name: string;
  activeProducts: number;
  belowMinimum: number;
  zeroStock: number;
  expiredLots: number;
  nearExpiryLots: number;
  entries: number;
  exits: number;
};

function GeneralDashboard() {
  const { client, profile } = useAuth();
  const scope = useOperationalScope();
  const stockSettingsQuery = useStockSettings();
  const navigate = useNavigate();
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
  const authorized =
    profile?.role === "admin" || profile?.role === "super_admin";
  const summaryQuery = useQuery({
    queryKey: [
      "multi-unit-dashboard",
      profile?.company_id,
      scope.units.map((unit) => unit.id).join(","),
      from,
      to,
      stockSettingsQuery.data?.criticalRatio,
      stockSettingsQuery.data?.expiryWarningDays,
      stockSettingsQuery.data?.minHistoryDays,
    ],
    queryFn: async () => {
      if (!client || !profile || !authorized)
        throw new Error("Acesso restrito a administradores.");
      return Promise.all(
        scope.units.map(async (unit): Promise<UnitSummary> => {
          const snapshot = await loadInventorySnapshot(
            client,
            profile.company_id,
            unit.id,
            from,
            to,
          );
          const products = snapshot.products.filter(
            (product) => product.active,
          );
          const belowMinimum = products.filter((product) =>
            ["sem_saldo", "critico", "baixo"].includes(
              classifyStock(
                {
                  balance: product.balance,
                  min: product.minimum,
                  max: product.target,
                },
                stockSettingsQuery.data ?? DEFAULT_STOCK_SETTINGS,
              ),
            ),
          ).length;
          const zeroStock = products.filter(
            (product) => product.balance <= 0,
          ).length;
          const today = nowInOperationalTz().date;
          const expiredLots = snapshot.lots.filter(
            (lot) =>
              lot.expiresOn &&
              lot.quantity > 0 &&
              classifyExpiry(
                lot.expiresOn,
                today,
                stockSettingsQuery.data ?? DEFAULT_STOCK_SETTINGS,
              ) === "vencido",
          ).length;
          const nearExpiryLots = snapshot.lots.filter(
            (lot) =>
              lot.expiresOn &&
              lot.quantity > 0 &&
              classifyExpiry(
                lot.expiresOn,
                today,
                stockSettingsQuery.data ?? DEFAULT_STOCK_SETTINGS,
              ) === "proximo",
          ).length;
          return {
            id: unit.id,
            name: unit.name,
            activeProducts: products.length,
            belowMinimum,
            zeroStock,
            expiredLots,
            nearExpiryLots,
            entries: snapshot.movements
              .filter((movement) => movement.type === "entry")
              .reduce((sum, movement) => sum + movement.itemCount, 0),
            exits: snapshot.movements
              .filter((movement) => movement.type === "exit")
              .reduce((sum, movement) => sum + movement.itemCount, 0),
          };
        }),
      );
    },
    enabled: Boolean(client && profile && authorized && scope.units.length > 0),
    staleTime: 30_000,
  });
  const summaries = useMemo(() => summaryQuery.data ?? [], [summaryQuery.data]);
  const totals = useMemo(
    () =>
      summaries.reduce(
        (result, unit) => ({
          activeProducts: result.activeProducts + unit.activeProducts,
          belowMinimum: result.belowMinimum + unit.belowMinimum,
          zeroStock: result.zeroStock + unit.zeroStock,
          expiredLots: result.expiredLots + unit.expiredLots,
          nearExpiryLots: result.nearExpiryLots + unit.nearExpiryLots,
          entries: result.entries + unit.entries,
          exits: result.exits + unit.exits,
        }),
        {
          activeProducts: 0,
          belowMinimum: 0,
          zeroStock: 0,
          expiredLots: 0,
          nearExpiryLots: 0,
          entries: 0,
          exits: 0,
        },
      ),
    [summaries],
  );

  if (!authorized)
    return (
      <BackendNotice>
        O painel geral de unidades está disponível apenas para administradores.
      </BackendNotice>
    );

  const openUnit = (unitId: string) => {
    scope.setUnitId(unitId);
    void navigate({ to: "/" });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="surface bg-hero flex flex-wrap items-center justify-between gap-4 p-5 md:p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {scope.units.length} unidade(s) no seu acesso
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
            Painel geral das unidades
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Resumo consolidado para consulta. Quantidades de produtos não são
            somadas entre unidades.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => openUnit(scope.unitId ?? scope.units[0]?.id ?? "")}
          disabled={!scope.unitId && !scope.units[0]}
        >
          <Building2 className="size-4" /> Voltar à unidade
        </Button>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageIntro
          title="Indicadores consolidados"
          description="Alertas refletem o estoque atual; entradas e saídas respeitam o período selecionado."
        />
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {summaryQuery.isLoading && (
        <BackendNotice>Consultando as unidades autorizadas…</BackendNotice>
      )}
      {summaryQuery.isError && (
        <BackendNotice>
          Não foi possível consultar todas as unidades liberadas. Confira a
          conexão e as permissões de acesso.
        </BackendNotice>
      )}
      {scope.units.length === 0 && !scope.loading && (
        <BackendNotice>
          Sua conta não possui unidades ativas disponíveis.
        </BackendNotice>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <StatCard
          label="Unidades no painel"
          value={summaryQuery.data ? summaries.length : null}
          unit="unidades autorizadas"
          icon={Building2}
          tone="primary"
        />
        <StatCard
          label="Produtos abaixo do mínimo"
          value={summaryQuery.data ? totals.belowMinimum : null}
          unit="ocorrências por unidade"
          icon={AlertTriangle}
          tone="danger"
        />
        <StatCard
          label="Produtos zerados"
          value={summaryQuery.data ? totals.zeroStock : null}
          unit="ocorrências por unidade"
          icon={Package}
          tone="warning"
        />
        <StatCard
          label="Lotes vencidos ou próximos"
          value={
            summaryQuery.data
              ? totals.expiredLots + totals.nearExpiryLots
              : null
          }
          unit="lotes com saldo"
          icon={CalendarClock}
          tone="warning"
        />
        <StatCard
          label="Movimentações no período"
          value={summaryQuery.data ? totals.entries + totals.exits : null}
          unit="itens registrados"
          icon={ArrowUpFromLine}
          tone="primary"
          hint={`${totals.entries} entradas · ${totals.exits} saídas`}
        />
      </div>

      <Panel
        title="Comparativo por unidade"
        description={
          range
            ? `${formatIsoDate(range.from)} a ${formatIsoDate(range.to)} · alertas atuais e movimentos no período`
            : "Selecione um período válido"
        }
        bodyClassName="p-0"
      >
        {summaries.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Os indicadores aparecerão após carregar os dados das unidades.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Unidade",
                    "Produtos ativos",
                    "Abaixo do mínimo",
                    "Zerados",
                    "Lotes vencidos / próximos",
                    "Entradas",
                    "Saídas",
                    "Ação",
                  ].map((label) => (
                    <th key={label} className="px-4 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {summaries.map((unit) => (
                  <tr key={unit.id}>
                    <td className="px-4 py-3 font-medium">{unit.name}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {unit.activeProducts}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {unit.belowMinimum}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{unit.zeroStock}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {unit.expiredLots} / {unit.nearExpiryLots}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <ArrowDownToLine className="size-3.5 text-success" />
                        {unit.entries}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <ArrowUpFromLine className="size-3.5 text-primary" />
                        {unit.exits}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openUnit(unit.id)}
                      >
                        Abrir unidade
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">
        Os indicadores de estoque são contagens de produtos ou lotes por
        unidade. Unidades e quantidades de produtos diferentes não são somadas
        entre si.
      </p>
    </div>
  );
}
