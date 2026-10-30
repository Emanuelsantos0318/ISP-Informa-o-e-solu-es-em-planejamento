import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Barcode,
  Clock3,
  History,
  Package2,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { BackendNotice } from "@/components/common/BackendNotice";
import { EmptyState } from "@/components/common/EmptyState";
import { Field } from "@/components/common/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProductPicker } from "@/components/movements/ProductPicker";
import { ProductFormDialog } from "@/components/cadastro/ProductFormDialog";
import { SelectedProductRow } from "@/components/movements/SelectedProductRow";
import { MovementActions } from "@/components/movements/MovementActions";
import type { MovementRequest } from "@/components/movements/MovementActions";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { useMovementBatch } from "@/lib/supabase/useMovementBatch";
import { useInventorySnapshot } from "@/lib/supabase/useInventorySnapshot";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/supabase/operational-settings";
import { suggestServiceForTime } from "@/lib/rules/service-suggestion";
import { createUuid } from "@/lib/uuid";
import {
  EXIT_TYPES,
  SERVICE_OPTIONS,
  type ExitTypeCode,
  type ServiceCode,
} from "@/lib/config/services";
import {
  EXIT_DESTINATIONS,
  exitDestinationLabel,
  type ExitDestinationCode,
} from "@/lib/config/exit-destinations";
import {
  formatIsoDate,
  nowInOperationalTz,
  operationalDateTimeToIso,
  OPERATIONAL_TZ,
} from "@/lib/datetime";
import {
  prefillFromQuery,
  searchProducts,
  type Product,
  type ProductPrefill,
} from "@/lib/types";
import { unitShort } from "@/lib/config/units";
import "./saida.css";

export const Route = createFileRoute("/saida")({
  head: () => ({
    meta: [
      { title: "Registrar saída · ISP" },
      {
        name: "description",
        content: "Registre saídas do estoque com leitura de código de barras.",
      },
    ],
  }),
  component: OperatorExitPage,
});

type ExitRow = {
  key: string;
  occurredAt: string;
  service: string | null;
  exitType: string | null;
  productName: string;
  productId: string;
  barcode: string;
  quantity: number;
  releasedUnits: number | null;
  unit: string;
  responsible: string;
  destination: string | null;
  recipient: string | null;
};

const EMPTY_PRODUCTS: Product[] = [];

function datePart(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: OPERATIONAL_TZ,
    dateStyle: "short",
  }).format(new Date(value));
}

function timePart(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: OPERATIONAL_TZ,
    timeStyle: "medium",
  }).format(new Date(value));
}

function OperatorExitPage() {
  // Carrega identidade, unidade, catálogo, regras e mutação usada pelo fluxo de saída.
  const { profile } = useAuth();
  const { units, unitId } = useOperationalScope();
  const catalog = useCatalog();
  const movement = useMovementBatch();
  const snapshotQuery = useInventorySnapshot();
  const settingsQuery = useOperationalSettings();
  const operational = settingsQuery.data ?? DEFAULT_OPERATIONAL_SETTINGS;
  const scannerRef = useRef<HTMLInputElement>(null);
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [createProductPrefill, setCreateProductPrefill] =
    useState<ProductPrefill>({});
  const [pendingCreatedProductId, setPendingCreatedProductId] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [entryRequest, setEntryRequest] = useState<MovementRequest | null>(null);
  const [activeTab, setActiveTab] = useState("registrar");
  const [destination, setDestination] = useState<ExitDestinationCode | "">("");
  const [recipient, setRecipient] = useState("");
  const [exitType, setExitType] = useState<ExitTypeCode>("programada_padrao");
  const [selectedService, setSelectedService] = useState<ServiceCode | "">("");
  const [clock, setClock] = useState(() => nowInOperationalTz());
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [historyLimit, setHistoryLimit] = useState(50);

  const products = catalog.products.data ?? EMPTY_PRODUCTS;
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const now = clock;
  // Sugere o período pela configuração ativa da empresa e pelo horário de Salvador.
  const suggestion = suggestServiceForTime(
    now.time,
    operational.serviceTimeRules,
  );
  const suggestedService =
    suggestion.kind === "single"
      ? (operational.serviceLabels[suggestion.service] ??
        SERVICE_OPTIONS.find((service) => service.code === suggestion.service)
          ?.label)
      : suggestion.kind === "choice"
        ? suggestion.services
            .map(
              (service) =>
                operational.serviceLabels[service] ??
                SERVICE_OPTIONS.find((item) => item.code === service)?.label,
            )
            .filter(Boolean)
            .join(" ou ")
        : suggestion.kind === "pending"
          ? "Seleção manual necessária"
          : "Sem sugestão para este horário";

  const exitBatches = useMemo(
    () =>
      (snapshotQuery.data?.movements ?? [])
        .filter((movement) => movement.type === "exit")
        .sort(
          (left, right) =>
            new Date(right.occurredAt).getTime() -
            new Date(left.occurredAt).getTime(),
        ),
    [snapshotQuery.data?.movements],
  );
  // Transforma lotes e itens em linhas para histórico, mantendo destino e responsável.
  const exitRows = useMemo<ExitRow[]>(
    () =>
      exitBatches.flatMap((movement) =>
        movement.items.map((item) => ({
          key: `${movement.id}:${item.id}`,
          occurredAt: movement.occurredAt,
          service: movement.service,
          exitType: movement.exitType,
          productName: item.name,
          productId: item.productId,
          barcode: productById.get(item.productId)?.barcode || item.sku || "—",
          quantity: item.quantity,
          releasedUnits: item.unitsReleased,
          unit: item.unit,
          responsible: movement.userName ?? movement.userId.slice(0, 8),
          destination: item.destination,
          recipient: item.recipient,
        })),
      ),
    [exitBatches, productById],
  );
  const latestRows = exitRows.slice(0, 12);
  const filteredHistory = exitRows.filter((row) => {
    const query = historySearch.trim().toLocaleLowerCase("pt-BR");
    return (
      !query ||
      row.productName.toLocaleLowerCase("pt-BR").includes(query) ||
      row.barcode.toLocaleLowerCase("pt-BR").includes(query) ||
      row.responsible.toLocaleLowerCase("pt-BR").includes(query) ||
      (row.destination ?? "").toLocaleLowerCase("pt-BR").includes(query) ||
      (row.recipient ?? "").toLocaleLowerCase("pt-BR").includes(query)
    );
  });
  const matchingProducts = productSearch
    ? searchProducts(products, productSearch)
    : products;

  useEffect(() => {
    const timer = window.setInterval(
      () => setClock(nowInOperationalTz()),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const suggestedServiceCode =
    suggestion.kind === "single" ? suggestion.service : "";
  const serviceCode = selectedService || suggestedServiceCode;

  const focusScanner = () => {
    if (!selectedProduct)
      window.requestAnimationFrame(() => scannerRef.current?.focus());
  };

  useEffect(() => {
    if (!selectedProduct) scannerRef.current?.focus();
  }, [selectedProduct]);

  useEffect(() => {
    if (!pendingCreatedProductId) return;
    const created = products.find(
      (product) => product.id === pendingCreatedProductId,
    );
    if (!created) return;
    setSelectedProduct(created);
    setActiveTab("registrar");
    setPendingCreatedProductId("");
  }, [pendingCreatedProductId, products]);

  // Atualiza o saldo do item selecionado após uma entrada sem perder o contexto da saída.
  useEffect(() => {
    if (!selectedProduct) return;
    const current = productById.get(selectedProduct.id);
    if (current && current.balance !== selectedProduct.balance)
      setSelectedProduct(current);
  }, [productById, selectedProduct]);

  if (profile?.role !== "operator") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <BackendNotice>
          Esta aba está disponível somente para operadores.
        </BackendNotice>
        <Button asChild variant="outline" className="self-start">
          <Link to="/">Voltar ao início</Link>
        </Button>
      </div>
    );
  }

  const selectProduct = (product: Product) => {
    setSelectedProduct(product);
    setActiveTab("registrar");
    setFormError(null);
    setSuccessMessage(null);
  };

  // Valida destino/período e envia a saída ao banco em uma única operação idempotente.
  const recordExit = async (item: {
    product: Product;
    quantity: number;
    releasedUnits?: number | undefined;
  }) => {
    if (!destination) {
      setFormError("Selecione o destino para liberar o produto.");
      document.getElementById("exit-destinations")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    const current = nowInOperationalTz();
    const currentSuggestion = suggestServiceForTime(
      current.time,
      operational.serviceTimeRules,
    );
    const effectiveService =
      selectedService ||
      (currentSuggestion.kind === "single" ? currentSuggestion.service : "");
    if (!effectiveService) {
      setFormError("Selecione o período da saída para continuar.");
      return;
    }
    if (!unitId) {
      setFormError("Sua conta não está vinculada a uma unidade ativa.");
      return;
    }
    const operationalAt = operationalDateTimeToIso(current.date, current.time);
    if (!operationalAt) {
      setFormError("Não foi possível obter a data e hora local da saída.");
      return;
    }
    setFormError(null);
    try {
      await movement.mutateAsync({
        unitId,
        movementType: "exit",
        operationalAt,
        idempotencyKey: createUuid(),
        serviceCode: effectiveService,
        exitTypeCode: exitType,
        items: [
          {
            productId: item.product.id,
            quantity: item.quantity,
            unitsReleased: item.releasedUnits,
            unitsPerPackage: item.releasedUnits
              ? item.product.unitsPerPackage
              : null,
            destination,
            recipient: recipient.trim() || null,
          },
        ],
      });
      setSuccessMessage(
        `${item.product.name}: saída registrada para ${exitDestinationLabel(destination)}.`,
      );
      setSelectedProduct(null);
      setFormError(null);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar a saída. Tente novamente.",
      );
    }
  };

  const serviceName = (code: string | null) => {
    if (!code) return "—";
    const configured = operational.serviceLabels[code];
    if (configured) return configured;
    return (
      SERVICE_OPTIONS.find((service) => service.code === code)?.label ?? code
    );
  };

  return (
    <div className="exit-page">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-1 flex-col"
      >
        <div className="exit-page__header">
          <div className="exit-page__nav-wrap">
            <TabsList className="exit-page__nav">
              <TabsTrigger value="registrar" className="exit-page__nav-trigger">
                <Barcode className="mr-2 size-4" /> Registrar saída
              </TabsTrigger>
              <TabsTrigger value="historico" className="exit-page__nav-trigger">
                <History className="mr-2 size-4" /> Histórico (
                {exitBatches.length})
              </TabsTrigger>
              <TabsTrigger value="produtos" className="exit-page__nav-trigger">
                <Package2 className="mr-2 size-4" /> Produtos
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <div className="exit-page__content">
          {(catalog.products.isError || snapshotQuery.isError) && (
            <BackendNotice>
              Não foi possível carregar os dados desta unidade. Confira a
              conexão e as permissões.
            </BackendNotice>
          )}
          {!unitId && (
            <BackendNotice>
              Sua conta não está vinculada a uma unidade ativa. Peça ao
              administrador para revisar seu acesso.
            </BackendNotice>
          )}
          <TabsContent value="registrar" className="exit-page__tab-content">
            <div className="exit-page__stack">
              <section className="exit-page__panel exit-page__panel--padded">
                {!selectedProduct && (
                  <Field
                    label="Leia o código de barras ou pesquise o produto"
                    htmlFor="exit-product-search"
                    hint="Use o leitor ou digite o nome, código ou SKU. As opções aparecem enquanto você digita."
                  >
                    <ProductPicker
                      products={products}
                      onSelect={selectProduct}
                      onRequestCreate={(query) => {
                        setCreateProductPrefill(prefillFromQuery(query));
                        setCreateProductOpen(true);
                      }}
                      liveSearch
                      inputId="exit-product-search"
                      inputRef={scannerRef}
                      inputClassName="exit-page__scanner placeholder:text-muted-foreground/80 md:text-2xl"
                      placeholder="Aguardando leitura ou digite o nome do produto…"
                      disabled={catalog.products.isLoading || !unitId}
                    />
                  </Field>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="size-4" /> Período sugerido agora:
                    <strong className="text-foreground">
                      {suggestedService}
                    </strong>
                    <span className="text-xs">
                      {formatIsoDate(now.date)} · {now.time} · Horário de
                      Salvador
                    </span>
                  </p>
                </div>
                <div className="exit-page__selection">
                  <div id="exit-destinations" className="space-y-2">
                    <p className="text-sm font-semibold">
                      Destino da liberação{" "}
                      <span className="text-destructive">*</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {EXIT_DESTINATIONS.map((option) => (
                        <Button
                          key={option.code}
                          type="button"
                          aria-pressed={destination === option.code}
                          variant={
                            destination === option.code ? "default" : "outline"
                          }
                          className="h-10 rounded-full px-4"
                          onClick={() => {
                            setDestination(option.code);
                            setFormError(null);
                            focusScanner();
                          }}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Período</p>
                      <ToggleGroup
                        type="single"
                        value={serviceCode}
                        onValueChange={(value) => {
                          if (value) {
                            setSelectedService(value as ServiceCode);
                            setFormError(null);
                            focusScanner();
                          }
                        }}
                        className="flex flex-wrap justify-start gap-1.5"
                      >
                        {SERVICE_OPTIONS.map((service) => (
                          <ToggleGroupItem
                            key={service.code}
                            value={service.code}
                            aria-label={
                              operational.serviceLabels[service.code] ??
                              service.label
                            }
                            className="h-9 rounded-full border px-3 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                          >
                            {operational.serviceLabels[service.code] ??
                              service.label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      {suggestion.kind === "single" && !selectedService && (
                        <p className="text-xs text-muted-foreground">
                          Sugestão automática pelo horário atual.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Tipo de saída</p>
                      <ToggleGroup
                        type="single"
                        value={exitType}
                        onValueChange={(value) => {
                          if (value) {
                            setExitType(value as ExitTypeCode);
                            focusScanner();
                          }
                        }}
                        className="flex flex-wrap justify-start gap-1.5"
                      >
                        {EXIT_TYPES.map((type) => (
                          <ToggleGroupItem
                            key={type.code}
                            value={type.code}
                            className="h-9 rounded-full border px-3 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                          >
                            {operational.exitTypeLabels[type.code] ??
                              type.label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  </div>
                </div>

                <div className="mt-4 max-w-md">
                  <Field
                    label="Quem está retirando (opcional)"
                    htmlFor="exit-recipient"
                  >
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="exit-recipient"
                        maxLength={120}
                        className="pl-9"
                        value={recipient}
                        onChange={(event) => setRecipient(event.target.value)}
                        placeholder="Nome do servidor ou solicitante"
                      />
                    </div>
                  </Field>
                </div>

                {selectedProduct && (
                  <div className="mt-5" aria-live="polite">
                    {selectedProduct.balance <= 0 && (
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                        <p className="text-sm">
                          Este produto está sem saldo. Registre a entrada aqui e
                          depois continue com a saída.
                        </p>
                        <Button
                          type="button"
                          variant="success"
                          onClick={() =>
                            setEntryRequest({
                              key: createUuid(),
                              product: selectedProduct,
                              type: "entry",
                            })
                          }
                        >
                          Adicionar estoque
                        </Button>
                      </div>
                    )}
                    <SelectedProductRow
                      key={selectedProduct.id}
                      product={selectedProduct}
                      mode="saida"
                      initialQuantity="1"
                      actionLabel="Confirmar saída"
                      submitting={movement.isPending}
                      onCancel={() => setSelectedProduct(null)}
                      onAdd={(item) => void recordExit(item)}
                    />
                  </div>
                )}

                {formError && (
                  <p
                    role="alert"
                    className="exit-page__notice exit-page__notice--error"
                  >
                    {formError}
                  </p>
                )}
                {successMessage && (
                  <p
                    role="status"
                    className="exit-page__notice exit-page__notice--success"
                  >
                    {successMessage} Pronto para a próxima leitura.
                  </p>
                )}
              </section>

              <section className="exit-page__panel">
                <div className="exit-page__panel-heading">
                  <div>
                    <h3 className="exit-page__panel-title">Últimas saídas</h3>
                    <p className="exit-page__panel-copy">
                      Horário local de Salvador
                    </p>
                  </div>
                  <span className="exit-page__panel-meta">
                    {latestRows.length} itens recentes
                  </span>
                </div>
                {snapshotQuery.isLoading ? (
                  <div className="p-6">
                    <BackendNotice>
                      Carregando histórico de saídas…
                    </BackendNotice>
                  </div>
                ) : latestRows.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      compact
                      icon={History}
                      title="Ainda não há saídas nesta unidade"
                      description="As retiradas registradas aparecerão aqui."
                    />
                  </div>
                ) : (
                  <ExitTable rows={latestRows} serviceName={serviceName} />
                )}
              </section>
              <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  O saldo baixa somente após confirmar a saída. O destino e as
                  unidades liberadas ficam registrados no histórico.
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="historico" className="exit-page__tab-content">
            <section className="exit-page__panel">
              <div className="exit-page__panel-heading exit-page__panel-heading--bordered">
                <div>
                  <h3 className="exit-page__panel-title">
                    Histórico de saídas
                  </h3>
                  <p className="exit-page__panel-copy exit-page__panel-copy--regular">
                    {exitBatches.length} registros · {exitRows.length} itens
                  </p>
                </div>
                <div className="w-full sm:max-w-sm">
                  <Input
                    aria-label="Filtrar histórico"
                    placeholder="Filtrar produto, código, destino ou responsável"
                    value={historySearch}
                    onChange={(event) => setHistorySearch(event.target.value)}
                  />
                </div>
              </div>
              {snapshotQuery.isLoading ? (
                <div className="p-6">
                  <BackendNotice>Carregando histórico…</BackendNotice>
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    compact
                    icon={History}
                    title="Nenhuma saída encontrada"
                    description="Tente outro filtro ou registre uma nova saída."
                  />
                </div>
              ) : (
                <>
                  <ExitTable
                    rows={filteredHistory.slice(0, historyLimit)}
                    serviceName={serviceName}
                  />
                  {filteredHistory.length > historyLimit && (
                    <div className="border-t p-4 text-center">
                      <Button
                        variant="outline"
                        onClick={() => setHistoryLimit((limit) => limit + 50)}
                      >
                        Carregar mais saídas
                      </Button>
                    </div>
                  )}
                </>
              )}
            </section>
          </TabsContent>

          <TabsContent value="produtos" className="exit-page__tab-content">
            <section className="exit-page__panel">
              <div className="exit-page__panel-heading exit-page__panel-heading--bordered">
                <div>
                  <h3 className="exit-page__panel-title">
                    Produtos da unidade
                  </h3>
                  <p className="exit-page__panel-copy exit-page__panel-copy--regular">
                    Consulta de saldo e código para facilitar as retiradas.
                  </p>
                </div>
                <div className="w-full sm:max-w-sm">
                  <Input
                    aria-label="Buscar produto"
                    placeholder="Buscar por nome ou código"
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                  />
                </div>
              </div>
              {catalog.products.isLoading ? (
                <div className="p-6">
                  <BackendNotice>Carregando produtos…</BackendNotice>
                </div>
              ) : matchingProducts.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    compact
                    icon={Package2}
                    title="Nenhum produto encontrado"
                    description="Confira o filtro digitado."
                  />
                </div>
              ) : (
                <div className="exit-page__table-scroll">
                  <table className="exit-page__table exit-page__product-table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Código</th>
                        <th>Unidade</th>
                        <th className="text-right">Saldo</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchingProducts.map((product) => (
                        <tr key={product.id}>
                          <td className="font-medium">{product.name}</td>
                          <td className="font-mono text-xs">
                            {product.barcode ?? product.sku}
                          </td>
                          <td>{unitShort(product.unit) || product.unit}</td>
                          <td className="text-right tabular-nums">
                            {product.balance.toLocaleString("pt-BR")}
                          </td>
                          <td className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => selectProduct(product)}
                              disabled={product.balance <= 0}
                            >
                              Registrar saída
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </TabsContent>
        </div>
      </Tabs>
      <ProductFormDialog
        open={createProductOpen}
        onOpenChange={setCreateProductOpen}
        prefill={createProductPrefill}
        onCreated={setPendingCreatedProductId}
      />
      <MovementActions hideButtons request={entryRequest} />
    </div>
  );
}

function ExitTable({
  rows,
  serviceName,
}: {
  rows: ExitRow[];
  serviceName: (code: string | null) => string;
}) {
  return (
    <div className="exit-page__table-scroll">
      <table className="exit-page__table exit-page__history-table">
        <thead>
          <tr>
            {[
              "Data",
              "Hora",
              "Período",
              "Produto",
              "Qtd.",
              "Responsável",
              "Destino",
              "Código",
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="whitespace-nowrap tabular-nums">
                {datePart(row.occurredAt)}
              </td>
              <td className="whitespace-nowrap font-mono text-xs tabular-nums">
                {timePart(row.occurredAt)}
              </td>
              <td>
                <span className="font-medium">{serviceName(row.service)}</span>
                {row.exitType && (
                  <span className="block text-xs text-muted-foreground">
                    {row.exitType}
                  </span>
                )}
              </td>
              <td className="min-w-52 font-medium">{row.productName}</td>
              <td className="whitespace-nowrap text-right tabular-nums">
                {row.releasedUnits !== null
                  ? `${row.releasedUnits.toLocaleString("pt-BR")} un. (${row.quantity.toLocaleString("pt-BR")} ${unitShort(row.unit) || row.unit})`
                  : `${row.quantity.toLocaleString("pt-BR")} ${unitShort(row.unit) || row.unit}`}
              </td>
              <td>{row.responsible}</td>
              <td>
                {exitDestinationLabel(row.destination)}
                {row.recipient && (
                  <span className="block text-xs text-muted-foreground">
                    {row.recipient}
                  </span>
                )}
              </td>
              <td className="font-mono text-xs">{row.barcode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
