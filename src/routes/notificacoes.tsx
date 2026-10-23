import { createFileRoute } from "@tanstack/react-router";
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
import { DEFAULT_STOCK_SETTINGS } from "@/lib/rules/stock";
import { useStockSettings } from "@/lib/supabase/useStockSettings";

export const Route = createFileRoute("/notificacoes")({
  head: () => ({
    meta: [
      { title: "Notificações · ISP — Gestão de Estoque" },
      {
        name: "description",
        content:
          "Alertas de estoque mínimo, falta de saldo e vencimento de lotes.",
      },
      {
        property: "og:title",
        content: "Notificações · ISP — Gestão de Estoque",
      },
      {
        property: "og:description",
        content:
          "Alertas de estoque mínimo, falta de saldo e vencimento de lotes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const settingsQuery = useStockSettings();
  const settings = settingsQuery.data ?? DEFAULT_STOCK_SETTINGS;
  const alertTypes = [
    {
      icon: AlertTriangle,
      title: "Abaixo do mínimo",
      tone: "text-warning-foreground bg-warning-soft",
    },
    {
      icon: PackageMinus,
      title: "Sem saldo",
      tone: "text-destructive bg-destructive-soft",
    },
    {
      icon: CalendarClock,
      title: `Vencem em até ${settings.expiryWarningDays} dias`,
      tone: "text-warning-foreground bg-warning-soft",
    },
    {
      icon: CalendarX2,
      title: "Vencidos",
      tone: "text-destructive bg-destructive-soft",
    },
    {
      icon: FileWarning,
      title: "Dados incompletos",
      tone: "text-primary bg-primary-soft",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Notificações"
        description="Alertas gerados pelas regras de estoque e validade."
      />
      {settingsQuery.isError && (
        <p role="status" className="text-xs text-muted-foreground">
          Exibindo o prazo padrão do sistema; não foi possível consultar o
          parâmetro personalizado no Supabase.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {alertTypes.map((alert) => (
          <div key={alert.title} className="surface flex flex-col gap-2 p-4">
            <span
              className={`flex size-8 items-center justify-center rounded-md ${alert.tone}`}
            >
              <alert.icon className="size-4" />
            </span>
            <p className="text-xs text-muted-foreground">{alert.title}</p>
            <p className="text-lg font-semibold tabular text-muted-foreground/60">
              —
            </p>
          </div>
        ))}
      </div>
      <Panel title="Alertas ativos">
        <EmptyState
          icon={BellOff}
          title="Nenhum alerta no momento"
          description="Os alertas aparecem automaticamente quando produtos ficam abaixo do mínimo, sem saldo ou perto do vencimento."
        />
      </Panel>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertOctagon className="size-3.5" /> Lotes vencidos e válidos são
        sempre exibidos separadamente.
      </p>
    </div>
  );
}
