import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  BellOff,
  CalendarClock,
  CalendarX2,
  FileWarning,
  PackageMinus,
} from "lucide-react";
import { PageIntro, Panel } from "@/components/common/Panel";
import { EmptyState } from "@/components/common/EmptyState";
import { BackendNotice } from "@/components/common/BackendNotice";
import { StatCard } from "@/components/common/StatCard";
import {
  classifyExpiry,
  classifyStock,
  DEFAULT_STOCK_SETTINGS,
  STOCK_STATUS_LABEL,
} from "@/lib/rules/stock";
import { nowInOperationalTz, formatIsoDate } from "@/lib/datetime";
import { useStockSettings } from "@/lib/supabase/useStockSettings";
import { useInventorySnapshot } from "@/lib/supabase/useInventorySnapshot";

export const Route = createFileRoute("/notificacoes")({
  head: () => ({
    meta: [
      { title: "Notificações · ISP — Gestão de Estoque" },
      {
        name: "description",
        content: "Alertas reais de saldo, validade e dados cadastrais.",
      },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const snapshot = useInventorySnapshot();
  const settingsQuery = useStockSettings();
  const settings = settingsQuery.data ?? DEFAULT_STOCK_SETTINGS;
  const today = nowInOperationalTz().date;
  const data = snapshot.data;
  const lowStock = (data?.products ?? []).filter(
    (product) =>
      product.active &&
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
  );
  const expiry = (data?.lots ?? [])
    .filter((lot) => lot.quantity > 0 && lot.expiresOn)
    .map((lot) => ({
      ...lot,
      product: data?.products.find((product) => product.id === lot.productId),
      status: classifyExpiry(lot.expiresOn!, today, settings),
    }))
    .filter((lot) => lot.status !== "valido")
    .sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""));
  const incomplete = (data?.products ?? []).filter(
    (product) =>
      product.active && (!product.categoryId || !product.unit || !product.sku),
  );
  const alerts = lowStock.length + expiry.length + incomplete.length;
  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Notificações"
        description="Alertas calculados com saldo, configuração e validade dos lotes da unidade selecionada."
      />
      {snapshot.isLoading && (
        <BackendNotice>Carregando saldos e lotes…</BackendNotice>
      )}
      {snapshot.isError && (
        <BackendNotice>
          Não foi possível consultar os alertas. Nenhum alerta é exibido com
          dados incompletos.
        </BackendNotice>
      )}
      {settingsQuery.isError && (
        <BackendNotice>
          Não foi possível carregar os limites personalizados; os alertas usam
          os parâmetros padrão.
        </BackendNotice>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Abaixo do mínimo"
          value={
            data
              ? lowStock.filter((product) => product.balance > 0).length
              : null
          }
          unit="produtos"
          icon={AlertTriangle}
          tone="warning"
        />
        <StatCard
          label="Sem saldo"
          value={
            data
              ? lowStock.filter((product) => product.balance <= 0).length
              : null
          }
          unit="produtos"
          icon={PackageMinus}
          tone="danger"
        />
        <StatCard
          label="Próximos do vencimento"
          value={
            data
              ? expiry.filter((lot) => lot.status === "proximo").length
              : null
          }
          unit={`até ${settings.expiryWarningDays} dias`}
          icon={CalendarClock}
          tone="warning"
        />
        <StatCard
          label="Lotes vencidos"
          value={
            data
              ? expiry.filter((lot) => lot.status === "vencido").length
              : null
          }
          unit="com saldo disponível"
          icon={CalendarX2}
          tone="danger"
        />
      </div>
      <Panel title={`Alertas ativos (${alerts})`}>
        {data && alerts === 0 ? (
          <EmptyState
            icon={BellOff}
            title="Nenhum alerta ativo"
            description="Os produtos e lotes estão dentro dos parâmetros configurados."
          />
        ) : data ? (
          <div className="grid gap-6">
            {lowStock.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="size-4 text-warning-foreground" />{" "}
                  Estoque abaixo do mínimo
                </h3>
                <Rows
                  headers={[
                    "Produto",
                    "Situação",
                    "Saldo",
                    "Mínimo",
                    "Unidade",
                  ]}
                >
                  {lowStock.map((product) => (
                    <tr key={product.id}>
                      <td className="px-4 py-3">
                        {product.name}
                        <span className="block text-xs text-muted-foreground">
                          {product.sku}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {
                          STOCK_STATUS_LABEL[
                            classifyStock(
                              {
                                balance: product.balance,
                                min: product.minimum,
                                max: product.target,
                              },
                              settings,
                            )
                          ]
                        }
                      </td>
                      <td className="px-4 py-3">
                        {product.balance.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-3">
                        {product.minimum.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-3">{product.unit}</td>
                    </tr>
                  ))}
                </Rows>
              </section>
            )}
            {expiry.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <CalendarClock className="size-4 text-warning-foreground" />{" "}
                  Lotes com vencimento próximo ou vencidos
                </h3>
                <Rows
                  headers={["Produto", "Lote", "Validade", "Situação", "Saldo"]}
                >
                  {expiry.map((lot) => (
                    <tr key={lot.id}>
                      <td className="px-4 py-3">
                        {lot.product?.name ?? "Produto removido"}
                      </td>
                      <td className="px-4 py-3">{lot.lotNumber}</td>
                      <td className="px-4 py-3">
                        {formatIsoDate(lot.expiresOn!)}
                      </td>
                      <td className="px-4 py-3">
                        {lot.status === "vencido"
                          ? "Vencido"
                          : "Próximo do vencimento"}
                      </td>
                      <td className="px-4 py-3">
                        {lot.quantity.toLocaleString("pt-BR")}{" "}
                        {lot.product?.unit}
                      </td>
                    </tr>
                  ))}
                </Rows>
              </section>
            )}
            {incomplete.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <FileWarning className="size-4" /> Produtos com dados
                  incompletos
                </h3>
                <Rows headers={["Produto", "SKU", "Pendência"]}>
                  {incomplete.map((product) => (
                    <tr key={product.id}>
                      <td className="px-4 py-3">{product.name}</td>
                      <td className="px-4 py-3">{product.sku || "—"}</td>
                      <td className="px-4 py-3">
                        {!product.categoryId
                          ? "Sem categoria"
                          : !product.unit
                            ? "Sem unidade"
                            : "Sem SKU"}
                      </td>
                    </tr>
                  ))}
                </Rows>
              </section>
            )}
          </div>
        ) : null}
      </Panel>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertOctagon className="size-3.5" /> Lotes vencidos são exibidos
        separadamente e somente quando ainda têm saldo.
      </p>
    </div>
  );
}

function Rows({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}
