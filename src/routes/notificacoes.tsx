import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import {
  classifyExpiry,
  classifyStock,
  DEFAULT_STOCK_SETTINGS,
  STOCK_STATUS_LABEL,
} from "@/lib/rules/stock";
import {
  formatDateTime,
  formatIsoDate,
  nowInOperationalTz,
} from "@/lib/datetime";
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
  const { client, profile } = useAuth();
  const { unitId } = useOperationalScope();
  const queryClient = useQueryClient();
  const snapshot = useInventorySnapshot({ movementLimit: 4 });
  const settingsQuery = useStockSettings();
  const productionNotificationQuery = useQuery({
    queryKey: ["production-notifications", profile?.user_id, unitId],
    enabled: Boolean(client && profile && unitId),
    queryFn: async () => {
      if (!client || !profile || !unitId) return [];
      const { data, error } = await client
        .from("production_notifications")
        .select("id, event_code, title, message, href, read_at, created_at")
        .eq("recipient_user_id", profile.user_id)
        .eq("unit_id", unitId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        event_code: string;
        title: string;
        message: string;
        href: string;
        read_at: string | null;
        created_at: string;
      }>;
    },
  });
  const markProductionNoticeRead = useMutation({
    mutationFn: async (notificationId: string) => {
      if (!client || !profile)
        throw new Error(
          "Sua sessão expirou. Entre novamente para atualizar o aviso.",
        );
      const { error } = await client
        .from("production_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .eq("recipient_user_id", profile.user_id)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["production-notifications", profile?.user_id, unitId],
      });
    },
  });
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
  const productionNotifications = productionNotificationQuery.data ?? [];
  const unreadProductionNotifications = productionNotifications.filter(
    (notification) => !notification.read_at,
  ).length;
  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Notificações"
        description="Alertas calculados com saldo, configuração e validade dos lotes da unidade selecionada."
      />
      <Panel
        title={`Planejamento de produção · ${unreadProductionNotifications} não lidas`}
        description="Avisos de revisão e execução dos mapas da unidade selecionada. Cada aviso tem destinatário e confirmação de leitura."
      >
        {productionNotificationQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando avisos…</p>
        ) : productionNotificationQuery.isError ? (
          <BackendNotice>
            Não foi possível carregar os avisos de produção. Confirme se a
            migração de notificações já foi aplicada neste ambiente.
          </BackendNotice>
        ) : productionNotifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum aviso de planejamento para esta unidade.
          </p>
        ) : (
          <div className="space-y-3">
            {productionNotifications.map((notification) => (
              <article
                className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${notification.read_at ? "bg-background" : "border-primary/30 bg-primary/5"}`}
                key={notification.id}
              >
                <div>
                  <p className="font-medium">{notification.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {notification.message}
                  </p>
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={notification.created_at}
                  >
                    {formatDateTime(notification.created_at)}
                  </time>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
                    href={notification.href}
                  >
                    Abrir planejamento
                  </a>
                  {!notification.read_at && (
                    <Button
                      variant="outline"
                      disabled={markProductionNoticeRead.isPending}
                      onClick={() =>
                        markProductionNoticeRead.mutate(notification.id)
                      }
                    >
                      Marcar lida
                    </Button>
                  )}
                </div>
              </article>
            ))}
            {markProductionNoticeRead.error && (
              <BackendNotice>
                {markProductionNoticeRead.error.message}
              </BackendNotice>
            )}
          </div>
        )}
      </Panel>
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
