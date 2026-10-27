import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, History, Search, X } from "lucide-react";
import { PageIntro, Panel } from "@/components/common/Panel";
import { EmptyTable } from "@/components/common/EmptyTable";
import { Field } from "@/components/common/Field";
import { BackendNotice } from "@/components/common/BackendNotice";
import { MovementActions } from "@/components/movements/MovementActions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EXIT_TYPES, SERVICE_OPTIONS } from "@/lib/config/services";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/supabase/operational-settings";
import {
  useInvoiceHistory,
  useInvoiceText,
  type StockInvoiceRecord,
} from "@/lib/supabase/useInvoiceHistory";
import { formatDateTime, formatIsoDate } from "@/lib/datetime";
import { nowInOperationalTz } from "@/lib/datetime";
import { useInventorySnapshot } from "@/lib/supabase/useInventorySnapshot";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/movimentacoes")({
  head: () => ({
    meta: [
      { title: "Movimentações · ISP — Gestão de Estoque" },
      {
        name: "description",
        content: "Histórico de entradas e saídas com filtros e detalhamento.",
      },
      {
        property: "og:title",
        content: "Movimentações · ISP — Gestão de Estoque",
      },
      {
        property: "og:description",
        content: "Histórico de entradas e saídas com filtros e detalhamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MovementsPage,
});

const initial = {
  search: "",
  type: "todos",
  service: "todos",
  exitType: "todos",
  from: "",
  to: "",
};

function MovementsPage() {
  const operationalQuery = useOperationalSettings();
  const operational = operationalQuery.data ?? DEFAULT_OPERATIONAL_SETTINGS;
  const [f, setF] = useState(initial);
  const invoices = useInvoiceHistory();
  const { unitId } = useOperationalScope();
  const snapshot = useInventorySnapshot();
  const [selectedInvoice, setSelectedInvoice] =
    useState<StockInvoiceRecord | null>(null);
  const invoiceText = useInvoiceText(selectedInvoice?.id ?? null);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const serviceOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const service of SERVICE_OPTIONS)
      options.set(
        service.code,
        operational.serviceLabels[service.code] ?? service.label,
      );
    for (const movement of snapshot.data?.movements ?? [])
      if (movement.service && !options.has(movement.service))
        options.set(movement.service, movement.service);
    return [...options.entries()];
  }, [snapshot.data?.movements, operational.serviceLabels]);
  const exitTypeOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const exitType of EXIT_TYPES)
      options.set(
        exitType.code,
        operational.exitTypeLabels[exitType.code] ?? exitType.label,
      );
    for (const movement of snapshot.data?.movements ?? [])
      if (movement.exitType && !options.has(movement.exitType))
        options.set(movement.exitType, movement.exitType);
    return [...options.entries()];
  }, [snapshot.data?.movements, operational.exitTypeLabels]);
  const rows = useMemo(
    () =>
      (snapshot.data?.movements ?? []).filter((movement) => {
        const typeFilter: Record<string, string> = {
          entrada: "entry",
          saida: "exit",
          ajuste: "adjustment",
          perda: "loss",
        };
        if (f.type !== "todos" && movement.type !== typeFilter[f.type])
          return false;
        if (f.service !== "todos" && movement.service !== f.service)
          return false;
        if (f.exitType !== "todos" && movement.exitType !== f.exitType)
          return false;
        const date = nowInOperationalTz(new Date(movement.occurredAt)).date;
        if (f.from && date < f.from) return false;
        if (f.to && date > f.to) return false;
        const query = f.search.trim().toLocaleLowerCase("pt-BR");
        if (
          query &&
          ![
            movement.id,
            movement.userName ?? "",
            movement.userId,
            movement.note ?? "",
            movement.sourceReference ?? "",
            ...movement.items.flatMap((item) => [
              item.name,
              item.sku,
              item.lotNumber ?? "",
            ]),
          ].some((value) => value.toLocaleLowerCase("pt-BR").includes(query))
        )
          return false;
        return true;
      }),
    [snapshot.data?.movements, f],
  );
  const historicalRows = rows.filter((movement) => movement.legacy).length;
  const currentRows = rows.length - historicalRows;

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Movimentações"
        description="Entradas e saídas registradas, com rastreio de responsável e horário."
        actions={<MovementActions />}
      />

      <Panel
        title="Filtros"
        actions={
          dirty && (
            <Button variant="ghost" size="sm" onClick={() => setF(initial)}>
              <X /> Limpar filtros
            </Button>
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Pesquisa" className="lg:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Produto, código ou ID"
                value={f.search}
                onChange={(e) => setF({ ...f, search: e.target.value })}
              />
            </div>
          </Field>
          <Field label="Tipo">
            <Select
              value={f.type}
              onValueChange={(v) => setF({ ...f, type: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="entrada">Entrada</SelectItem>
                <SelectItem value="saida">Saída</SelectItem>
                <SelectItem value="ajuste">Ajuste</SelectItem>
                <SelectItem value="perda">Perda</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Serviço">
            <Select
              value={f.service}
              onValueChange={(v) => setF({ ...f, service: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {serviceOptions.map(([code, label]) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tipo de saída">
            <Select
              value={f.exitType}
              onValueChange={(v) => setF({ ...f, exitType: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {exitTypeOptions.map(([code, label]) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="De">
              <Input
                type="date"
                value={f.from}
                onChange={(e) => setF({ ...f, from: e.target.value })}
              />
            </Field>
            <Field label="Até">
              <Input
                type="date"
                value={f.to}
                onChange={(e) => setF({ ...f, to: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Panel>

      {!unitId && (
        <BackendNotice>
          Selecione uma unidade no cabeçalho para consultar o histórico.
        </BackendNotice>
      )}
      {snapshot.isLoading && (
        <BackendNotice>Carregando movimentações da unidade…</BackendNotice>
      )}
      {snapshot.isError && (
        <BackendNotice>
          Não foi possível consultar o histórico. Confira as permissões, a
          conexão e se a migração do histórico legado foi aplicada.
        </BackendNotice>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel title="Registros no filtro">
          <p className="text-2xl font-semibold tabular-nums">{rows.length}</p>
          <p className="text-xs text-muted-foreground">
            Lançamentos que correspondem aos filtros atuais.
          </p>
        </Panel>
        <Panel title="Histórico importado">
          <p className="text-2xl font-semibold tabular-nums">
            {historicalRows}
          </p>
          <p className="text-xs text-muted-foreground">
            Saídas antigas preservadas sem alterar o saldo atual.
          </p>
        </Panel>
        <Panel title="Movimentações do ISP">
          <p className="text-2xl font-semibold tabular-nums">{currentRows}</p>
          <p className="text-xs text-muted-foreground">
            Registros operacionais feitos no sistema atual.
          </p>
        </Panel>
      </div>

      <Panel title="Histórico" bodyClassName="p-0">
        {snapshot.data && rows.length === 0 ? (
          <EmptyTable
            icon={History}
            title="Nenhuma movimentação encontrada"
            description="Ajuste os filtros ou registre uma nova movimentação."
            columns={[
              { label: "Data e hora" },
              { label: "Tipo" },
              { label: "Produto / lote" },
              { label: "Quantidade", align: "right" },
              { label: "Responsável" },
              { label: "Serviço" },
              { label: "Classificação" },
              { label: "Observações" },
            ]}
          />
        ) : rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Data e hora",
                    "Tipo",
                    "Produto / lote",
                    "Quantidade",
                    "Responsável",
                    "Serviço",
                    "Classificação",
                    "Documento / observação",
                  ].map((label) => (
                    <th key={label} className="px-4 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.flatMap((movement) =>
                  movement.items.length
                    ? movement.items.map((item) => (
                        <tr key={item.id}>
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
                          <td className="px-4 py-3">
                            {item.name}
                            {movement.legacy && (
                              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                Histórico importado
                              </span>
                            )}
                            <span className="block text-xs text-muted-foreground">
                              {movement.legacy
                                ? `ID de origem ${movement.sourceReference ?? "—"}${item.sku ? ` · Código ${item.sku}` : ""}`
                                : item.sku}
                              {item.lotNumber
                                ? ` · Lote ${item.lotNumber}`
                                : ""}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {item.quantity.toLocaleString("pt-BR")} {item.unit}
                          </td>
                          <td className="px-4 py-3">
                            {movement.userName ??
                              (movement.userId
                                ? movement.userId.slice(0, 8)
                                : "—")}
                          </td>
                          <td className="px-4 py-3">
                            {movement.service
                              ? (operational.serviceLabels[
                                  movement.service as keyof typeof operational.serviceLabels
                                ] ?? movement.service)
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {movement.exitType
                              ? (operational.exitTypeLabels[
                                  movement.exitType as keyof typeof operational.exitTypeLabels
                                ] ?? movement.exitType)
                              : item.adjustmentDirection === "increase"
                                ? "Ajuste positivo"
                                : item.adjustmentDirection === "decrease"
                                  ? "Ajuste negativo"
                                  : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {movement.sourceReference ?? movement.note ?? "—"}
                          </td>
                        </tr>
                      ))
                    : [
                        <tr key={movement.id}>
                          <td className="px-4 py-3">
                            {formatDateTime(movement.occurredAt)}
                          </td>
                          <td colSpan={7} className="px-4 py-3">
                            Movimento sem itens visíveis
                          </td>
                        </tr>,
                      ],
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <Panel title="Notas fiscais importadas" bodyClassName="p-0">
        {invoices.isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">
            Carregando notas fiscais…
          </p>
        ) : invoices.isError ? (
          <BackendNotice>
            Não foi possível carregar o histórico fiscal. Confirme se a migração
            de importação foi aplicada.
          </BackendNotice>
        ) : (invoices.data?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <FileText className="size-5" />
            Nenhuma DANFE foi registrada para esta unidade.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Nota / série</th>
                  <th className="p-3">Data de emissão</th>
                  <th className="p-3">Total</th>
                  <th className="p-3">Chave de acesso</th>
                  <th className="p-3">Registrada em</th>
                  <th className="p-3">Documento</th>
                </tr>
              </thead>
              <tbody>
                {invoices.data?.map((invoice) => (
                  <tr key={invoice.id} className="border-t">
                    <td className="p-3 font-medium">
                      {invoice.invoice_number} / {invoice.series}
                    </td>
                    <td className="p-3">
                      {invoice.issue_date
                        ? formatIsoDate(invoice.issue_date)
                        : "—"}
                    </td>
                    <td className="p-3 tabular-nums">
                      {invoice.invoice_total === null
                        ? "—"
                        : Number(invoice.invoice_total).toLocaleString(
                            "pt-BR",
                            { style: "currency", currency: "BRL" },
                          )}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {invoice.access_key ?? "—"}
                    </td>
                    <td className="p-3">
                      {formatDateTime(invoice.created_at)}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedInvoice(invoice)}
                      >
                        <FileText /> Texto extraído
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Dialog
        open={Boolean(selectedInvoice)}
        onOpenChange={(open) => {
          if (!open) setSelectedInvoice(null);
        }}
      >
        <DialogContent className="max-h-[90vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Nota {selectedInvoice?.invoice_number} / série{" "}
              {selectedInvoice?.series}
            </DialogTitle>
            <DialogDescription>
              Texto extraído preservado para consulta. O PDF original não é
              armazenado.
            </DialogDescription>
          </DialogHeader>
          {invoiceText.isError ? (
            <BackendNotice>
              O texto da nota não pôde ser carregado.
            </BackendNotice>
          ) : (
            <Textarea
              readOnly
              className="max-h-[65vh] font-mono text-xs"
              value={invoiceText.data ?? "Carregando texto extraído…"}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
