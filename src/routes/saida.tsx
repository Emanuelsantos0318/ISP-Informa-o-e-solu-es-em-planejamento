import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Barcode,
  Clock3,
  History,
  Package2,
  Search,
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
import { SelectedProductRow } from "@/components/movements/SelectedProductRow";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { useMovementBatch } from "@/lib/supabase/useMovementBatch";
import { useInventorySnapshot } from "@/lib/supabase/useInventorySnapshot";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/supabase/operational-settings";
import { suggestServiceForTime } from "@/lib/rules/service-suggestion";
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
import { searchProducts, type Product } from "@/lib/types";
import { unitShort } from "@/lib/config/units";

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
  const { profile } = useAuth();
  const { units, unitId } = useOperationalScope();
  const catalog = useCatalog();
  const movement = useMovementBatch();
  const snapshotQuery = useInventorySnapshot();
  const settingsQuery = useOperationalSettings();
  const operational = settingsQuery.data ?? DEFAULT_OPERATIONAL_SETTINGS;
  const scannerRef = useRef<HTMLInputElement>(null);
  const [barcode, setBarcode] = useState("");
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanMatches, setScanMatches] = useState<Product[] | null>(null);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
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

  const unitName = units.find((unit) => unit.id === unitId)?.name;
  const products = catalog.products.data ?? EMPTY_PRODUCTS;
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const now = clock;
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
    setScanMatches(null);
    setScanMessage(null);
    setBarcode("");
    setShowProductSearch(false);
    setFormError(null);
    setSuccessMessage(null);
  };

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
        idempotencyKey: crypto.randomUUID(),
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
      setBarcode("");
      setScanMessage(null);
      setFormError(null);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar a saída. Tente novamente.",
      );
    }
  };

  const scan = () => {
    const value = barcode.trim();
    if (!value) return;
    const exact = products.filter(
      (product) =>
        product.barcode?.trim() === value ||
        product.sku.trim().toLocaleLowerCase("pt-BR") ===
          value.toLocaleLowerCase("pt-BR"),
    );
    if (exact.length === 1 && exact[0]) {
      selectProduct(exact[0]);
      return;
    }
    setScanMatches(exact.length > 1 ? exact : null);
    setScanMessage(
      exact.length > 1
        ? "Há mais de um produto com esse código. Selecione o correto."
        : "Código não encontrado no catálogo ativo desta unidade.",
    );
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
    <div className="-mx-4 -mt-6 flex min-h-[calc(100vh-4rem)] flex-col bg-[#f1f7f7] md:-mx-6 lg:-mx-8">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-1 flex-col"
      >
        <div className="bg-[#0d3d43] px-4 pb-3 pt-4 text-white md:px-8">
          <div className="mx-auto flex w-full max-w-[1220px] flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-lg font-semibold">
                {unitName?.slice(0, 2).toLocaleUpperCase("pt-BR") ?? "IS"}
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/65">
                  {unitName ?? "Unidade operacional"}
                </p>
                <h2 className="text-lg font-semibold md:text-xl">
                  Saídas do Almoxarifado
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-semibold">{profile.full_name}</p>
                <p className="text-xs text-white/65">Operador</p>
              </div>
              <span className="rounded-full border border-white/25 px-3 py-1.5 text-xs text-white/80">
                {unitId ? "Unidade vinculada" : "Unidade indisponível"}
              </span>
            </div>
          </div>
          <div className="mx-auto mt-4 w-full max-w-[1220px]">
            <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-xl bg-white/10 p-1 text-white/75">
              <TabsTrigger
                value="registrar"
                className="h-10 rounded-lg px-4 text-white/85 data-[state=active]:bg-white data-[state=active]:text-[#0d6264]"
              >
                <Barcode className="mr-2 size-4" /> Registrar saída
              </TabsTrigger>
              <TabsTrigger
                value="historico"
                className="h-10 rounded-lg px-4 text-white/85 data-[state=active]:bg-white data-[state=active]:text-[#0d6264]"
              >
                <History className="mr-2 size-4" /> Histórico (
                {exitBatches.length})
              </TabsTrigger>
              <TabsTrigger
                value="produtos"
                className="h-10 rounded-lg px-4 text-white/85 data-[state=active]:bg-white data-[state=active]:text-[#0d6264]"
              >
                <Package2 className="mr-2 size-4" /> Produtos
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1220px] flex-1 px-4 py-6 md:px-0 md:py-7">
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
          <TabsContent value="registrar" className="mt-0 flex flex-col gap-5">
            <section className="rounded-2xl border border-[#d7e5e5] bg-white p-5 shadow-sm md:p-6">
              <Field label="Escaneie o código de barras" htmlFor="exit-scanner">
                <div className="relative">
                  <Barcode className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#197c7e]" />
                  <Input
                    id="exit-scanner"
                    ref={scannerRef}
                    autoFocus
                    className="h-[68px] border-[#168584] pl-12 font-mono text-xl shadow-[0_0_0_4px_rgba(16,124,124,0.13)] placeholder:font-sans placeholder:text-muted-foreground/80 md:text-2xl"
                    placeholder="Aguardando leitura…"
                    value={barcode}
                    disabled={catalog.products.isLoading || !unitId}
                    onChange={(event) => {
                      setBarcode(event.target.value);
                      setScanMessage(null);
                      setScanMatches(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        scan();
                      }
                    }}
                  />
                </div>
              </Field>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock3 className="size-4" /> Período sugerido agora:
                  <strong className="text-foreground">
                    {suggestedService}
                  </strong>
                  <span className="text-xs">
                    {formatIsoDate(now.date)} · {now.time} · Horário de Salvador
                  </span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-[#d4e2e2] px-4"
                  onClick={() => setShowProductSearch((open) => !open)}
                  disabled={catalog.products.isLoading || !unitId}
                >
                  <Search />{" "}
                  {showProductSearch
                    ? "Fechar busca"
                    : "Pesquisar produto pelo nome"}
                </Button>
              </div>
              {scanMessage && (
                <div
                  className="mt-3 space-y-2"
                  role="status"
                  aria-live="polite"
                >
                  <p className="text-sm text-destructive">{scanMessage}</p>
                  {scanMatches?.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => selectProduct(product)}
                    >
                      <span>{product.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {product.barcode ?? product.sku}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-6 grid gap-5 border-t border-[#e4eded] pt-5 lg:grid-cols-2">
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
                          className="h-9 rounded-full border px-3 text-xs data-[state=on]:border-[#08736f] data-[state=on]:bg-[#08736f] data-[state=on]:text-white"
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
                          className="h-9 rounded-full border px-3 text-xs data-[state=on]:border-[#08736f] data-[state=on]:bg-[#08736f] data-[state=on]:text-white"
                        >
                          {operational.exitTypeLabels[type.code] ?? type.label}
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

              {showProductSearch && (
                <div className="mt-5 rounded-xl border border-[#d7e5e5] bg-[#f8fbfb] p-4">
                  <ProductPicker
                    products={products}
                    onSelect={selectProduct}
                    onRequestCreate={() => undefined}
                    allowCreate={false}
                  />
                </div>
              )}

              {selectedProduct && (
                <div className="mt-5" aria-live="polite">
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
                  className="mt-4 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
                >
                  {formError}
                </p>
              )}
              {successMessage && (
                <p
                  role="status"
                  className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"
                >
                  {successMessage} Pronto para a próxima leitura.
                </p>
              )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-[#d7e5e5] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2 pt-5 md:px-6">
                <div>
                  <h3 className="text-lg font-semibold">Últimas saídas</h3>
                  <p className="text-xs text-muted-foreground">
                    Horário local de Salvador
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {latestRows.length} itens recentes
                </span>
              </div>
              {snapshotQuery.isLoading ? (
                <div className="p-6">
                  <BackendNotice>Carregando histórico de saídas…</BackendNotice>
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
          </TabsContent>

          <TabsContent value="historico" className="mt-0">
            <section className="overflow-hidden rounded-2xl border border-[#d7e5e5] bg-white shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b px-5 py-5 md:px-6">
                <div>
                  <h3 className="text-lg font-semibold">Histórico de saídas</h3>
                  <p className="text-sm text-muted-foreground">
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

          <TabsContent value="produtos" className="mt-0">
            <section className="overflow-hidden rounded-2xl border border-[#d7e5e5] bg-white shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b px-5 py-5 md:px-6">
                <div>
                  <h3 className="text-lg font-semibold">Produtos da unidade</h3>
                  <p className="text-sm text-muted-foreground">
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
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3">Produto</th>
                        <th className="px-5 py-3">Código</th>
                        <th className="px-5 py-3">Unidade</th>
                        <th className="px-5 py-3 text-right">Saldo</th>
                        <th className="px-5 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {matchingProducts.map((product) => (
                        <tr key={product.id}>
                          <td className="px-5 py-3 font-medium">
                            {product.name}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs">
                            {product.barcode ?? product.sku}
                          </td>
                          <td className="px-5 py-3">
                            {unitShort(product.unit) || product.unit}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">
                            {product.balance.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-5 py-3 text-right">
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-[#f7fafa] text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
              <th key={label} className="px-4 py-3">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e0eaea]">
          {rows.map((row) => (
            <tr key={row.key} className="hover:bg-[#f8fbfb]">
              <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                {datePart(row.occurredAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums">
                {timePart(row.occurredAt)}
              </td>
              <td className="px-4 py-3">
                <span className="font-medium">{serviceName(row.service)}</span>
                {row.exitType && (
                  <span className="block text-xs text-muted-foreground">
                    {row.exitType}
                  </span>
                )}
              </td>
              <td className="min-w-52 px-4 py-3 font-medium">
                {row.productName}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                {row.releasedUnits !== null
                  ? `${row.releasedUnits.toLocaleString("pt-BR")} un. (${row.quantity.toLocaleString("pt-BR")} ${unitShort(row.unit) || row.unit})`
                  : `${row.quantity.toLocaleString("pt-BR")} ${unitShort(row.unit) || row.unit}`}
              </td>
              <td className="px-4 py-3">{row.responsible}</td>
              <td className="px-4 py-3">
                {exitDestinationLabel(row.destination)}
                {row.recipient && (
                  <span className="block text-xs text-muted-foreground">
                    {row.recipient}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-xs">{row.barcode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
