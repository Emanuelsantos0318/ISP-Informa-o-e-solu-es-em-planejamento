import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpFromLine, Info, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field } from "@/components/common/Field";
import { BackendNotice } from "@/components/common/BackendNotice";
import { ProductFormDialog } from "@/components/cadastro/ProductFormDialog";
import { ProductPicker } from "./ProductPicker";
import { SelectedProductRow } from "./SelectedProductRow";
import { ItemsList } from "./ItemsList";
import {
  EXIT_TYPES,
  SERVICE_OPTIONS,
  serviceLabel,
  type ExitTypeCode,
  type ServiceCode,
} from "@/lib/config/services";
import {
  applySuggestion,
  selectServiceManually,
  suggestServiceForTime,
  validateServiceSelection,
  type ServiceSelection,
} from "@/lib/rules/service-suggestion";
import {
  formatIsoDate,
  nowInOperationalTz,
  operationalDateTimeToIso,
} from "@/lib/datetime";
import {
  prefillFromQuery,
  type MovementItemDraft,
  type Product,
  type ProductPrefill,
} from "@/lib/types";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { useMovementBatch } from "@/lib/supabase/useMovementBatch";
import { createUuid } from "@/lib/uuid";
import { toast } from "sonner";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/supabase/operational-settings";

export function ExitDialog({
  open,
  onOpenChange,
  initialProduct,
  simplified = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialProduct?: Product | undefined;
  simplified?: boolean | undefined;
}) {
  const catalog = useCatalog();
  const { unitId } = useOperationalScope();
  const movement = useMovementBatch();
  const operationalQuery = useOperationalSettings();
  const operational = operationalQuery.data ?? DEFAULT_OPERATIONAL_SETTINGS;
  const operationalRulesRef = useRef(operational.serviceTimeRules);
  operationalRulesRef.current = operational.serviceTimeRules;
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [exitType, setExitType] = useState<ExitTypeCode | "">(
    "programada_padrao",
  );
  const [selection, setSelection] = useState<ServiceSelection>({
    value: null,
    manual: false,
  });
  const [items, setItems] = useState<MovementItemDraft[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [notes, setNotes] = useState("");
  const [destination, setDestination] = useState("");
  const [recipient, setRecipient] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState<ProductPrefill>({});

  // Fresh form each time the modal is opened.
  useEffect(() => {
    if (!open) return;
    const now = nowInOperationalTz();
    setDate(now.date);
    setTime(now.time);
    setExitType("programada_padrao");
    setSelection(
      applySuggestion(
        { value: null, manual: false },
        suggestServiceForTime(now.time, operationalRulesRef.current),
      ).selection,
    );
    setItems([]);
    setSelected(initialProduct ?? null);
    setNotes("");
    setDestination("");
    setRecipient("");
    setErrors([]);
    setIdempotencyKey(null);
    setSubmitError(null);
  }, [open, initialProduct]);

  useEffect(() => {
    if (!open || !time) return;
    setSelection((current) =>
      current.manual
        ? current
        : applySuggestion(
            current,
            suggestServiceForTime(time, operational.serviceTimeRules),
          ).selection,
    );
  }, [open, time, operational.serviceTimeRules]);

  const suggestion = useMemo(
    () => suggestServiceForTime(time, operational.serviceTimeRules),
    [time, operational.serviceTimeRules],
  );
  const { alternatives } = useMemo(
    () => applySuggestion(selection, suggestion),
    [selection, suggestion],
  );

  const onTimeChange = (value: string) => {
    setTime(value);
    setSelection(
      (cur) =>
        applySuggestion(
          cur,
          suggestServiceForTime(value, operational.serviceTimeRules),
        ).selection,
    );
  };

  const pickService = (code: ServiceCode) =>
    setSelection(selectServiceManually(code));

  const confirm = async () => {
    const errs: string[] = [];
    if (!date || !time)
      errs.push("Informe a data e hor\u00e1rio da sa\u00edda.");
    if (!exitType) errs.push("Selecione o tipo de sa\u00edda.");
    const serviceError = validateServiceSelection(selection.value);
    if (serviceError) errs.push(serviceError);
    if (items.length === 0) errs.push("Inclua ao menos um produto.");
    if (!unitId) errs.push("Selecione uma unidade ativa.");
    const operationalAt = operationalDateTimeToIso(date, time);
    if (!operationalAt)
      errs.push("Informe uma data e hor\u00e1rio v\u00e1lidos.");
    setErrors(errs);
    setSubmitError(null);
    if (
      errs.length > 0 ||
      !unitId ||
      !operationalAt ||
      !selection.value ||
      !exitType
    )
      return;
    const requestKey = idempotencyKey ?? createUuid();
    setIdempotencyKey(requestKey);
    try {
      await movement.mutateAsync({
        unitId,
        movementType: "exit",
        operationalAt,
        idempotencyKey: requestKey,
        serviceCode: selection.value,
        exitTypeCode: exitType,
        note: notes,
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          unitsReleased: item.releasedUnits,
          unitsPerPackage: item.releasedUnits
            ? item.product.unitsPerPackage
            : null,
          destination: destination.trim() || null,
          recipient: recipient.trim() || null,
          lotNumber: item.lot,
          expiresOn: item.expiry,
        })),
      });
      toast.success("Saída registrada", {
        description: `${items.length} item(ns) foram baixados do estoque e adicionados a Movimentações.`,
      });
      setIdempotencyKey(null);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "N\u00e3o foi poss\u00edvel registrar a sa\u00edda.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-warning-soft text-warning-foreground">
              <ArrowUpFromLine className="size-4" />
            </span>
            Nova saída
          </DialogTitle>
          <DialogDescription>
            Registre a retirada de produtos do estoque. Horário de Salvador
            (BA).
          </DialogDescription>
          {(operationalQuery.isLoading || operationalQuery.isError) && (
            <BackendNotice>
              {operationalQuery.isLoading
                ? "Carregando regras operacionais da empresa."
                : "Não foi possível carregar regras operacionais; as sugestões padrão são apenas auxiliares. Confirme o serviço manualmente."}
            </BackendNotice>
          )}
        </DialogHeader>

        {simplified && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Saída em {date ? formatIsoDate(date) : "—"} às {time || "—"}{" "}
            (horário de Salvador).
          </p>
        )}
        <details
          open={!simplified}
          className={simplified ? "rounded-md border px-3 py-2" : "contents"}
        >
          {simplified && (
            <summary className="cursor-pointer text-sm font-medium">
              Alterar data ou horário
            </summary>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Data da saída" htmlFor="x-date" required>
              <Input
                id="x-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Horário" htmlFor="x-time" required>
              <Input
                id="x-time"
                type="time"
                className="tabular"
                value={time}
                onChange={(e) => onTimeChange(e.target.value)}
              />
            </Field>
            {!simplified && (
              <Field label="Tipo de saída" required>
                <Select
                  value={exitType}
                  onValueChange={(v) => setExitType(v as ExitTypeCode)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXIT_TYPES.map((t) => (
                      <SelectItem key={t.code} value={t.code}>
                        {operational.exitTypeLabels[t.code] ?? t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
        </details>

        {simplified ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de saída">
              <ToggleGroup
                type="single"
                value={exitType}
                onValueChange={(value) =>
                  value && setExitType(value as ExitTypeCode)
                }
                className="grid grid-cols-2 gap-2"
              >
                {EXIT_TYPES.map((type) => (
                  <ToggleGroupItem
                    key={type.code}
                    value={type.code}
                    className="h-10 rounded-md border text-sm data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {operational.exitTypeLabels[type.code] ?? type.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field label="Serviço de destino">
              <Select
                value={selection.value ?? ""}
                onValueChange={(value) => pickService(value as ServiceCode)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o serviço" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_OPTIONS.map((service) => (
                    <SelectItem key={service.code} value={service.code}>
                      {operational.serviceLabels[service.code] ?? service.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!selection.manual && suggestion.kind === "single" && (
                <span className="text-xs text-muted-foreground">
                  Sugerido pelo horário
                </span>
              )}
            </Field>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground/80">
              Serviço de destino
              <span className="ml-0.5 text-destructive">*</span>
            </span>
            <ToggleGroup
              type="single"
              value={selection.value ?? ""}
              onValueChange={(v) => v && pickService(v as ServiceCode)}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {SERVICE_OPTIONS.map((s) => (
                <ToggleGroupItem
                  key={s.code}
                  value={s.code}
                  className="h-9 rounded-md border text-sm data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {operational.serviceLabels[s.code] ?? s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <SuggestionHint
              suggestion={suggestion}
              manual={selection.manual}
              alternatives={alternatives}
              serviceLabels={operational.serviceLabels}
              onPick={pickService}
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-foreground/80">
            Produtos
          </span>
          {!catalog.hasUnitScope && (
            <BackendNotice>
              Selecione uma unidade ativa no cabeçalho para carregar o catálogo.
            </BackendNotice>
          )}
          {catalog.products.isError && (
            <BackendNotice>
              O catálogo não pôde ser carregado para esta sessão.
            </BackendNotice>
          )}
          {selected ? (
            <SelectedProductRow
              product={selected}
              mode="saida"
              onCancel={() => setSelected(null)}
              onAdd={(item) => {
                setItems((cur) => [...cur, { ...item, key: createUuid() }]);
                setSelected(null);
              }}
            />
          ) : (
            <ProductPicker
              products={catalog.products.data ?? []}
              onSelect={setSelected}
              onRequestCreate={(q) => {
                setPrefill(prefillFromQuery(q));
                setCreating(true);
              }}
            />
          )}
          <ItemsList
            items={items}
            onRemove={(k) => setItems((cur) => cur.filter((i) => i.key !== k))}
          />
        </div>

        <section className="grid gap-3 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">
              Retirado por / destino (opcional)
            </p>
            <p className="text-xs text-muted-foreground">
              Identifique quem está retirando e para onde o material será
              enviado.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Servidor", "Paciente", "Patiscaria", "Lactário", "Geral"].map(
              (value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={destination === value ? "default" : "outline"}
                  onClick={() =>
                    setDestination(destination === value ? "" : value)
                  }
                >
                  {value}
                </Button>
              ),
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Destino" htmlFor="x-destination">
              <Input
                id="x-destination"
                maxLength={120}
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="Ex.: Paciente, Lactário, setor..."
              />
            </Field>
            <Field label="Quem está retirando" htmlFor="x-recipient">
              <Input
                id="x-recipient"
                maxLength={120}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="Nome do solicitante"
              />
            </Field>
          </div>
        </section>

        <Field label="Observação" htmlFor="x-notes">
          <Textarea
            id="x-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {errors.length > 0 && (
          <ul className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-xs text-destructive">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
        {submitError && (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={movement.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            disabled={
              movement.isPending || !unitId || catalog.products.isLoading
            }
            onClick={() => void confirm()}
          >
            {movement.isPending ? "Gravando\u2026" : "Confirmar sa\u00edda"}
          </Button>
        </DialogFooter>

        {/* Nested inside this dialog so the movement form stays mounted and preserved. */}
        <ProductFormDialog
          open={creating}
          onOpenChange={setCreating}
          prefill={prefill}
          contextual
        />
      </DialogContent>
    </Dialog>
  );
}

function SuggestionHint({
  suggestion,
  manual,
  alternatives,
  onPick,
  serviceLabels,
}: {
  suggestion: ReturnType<typeof suggestServiceForTime>;
  manual: boolean;
  alternatives: ServiceCode[];
  onPick: (s: ServiceCode) => void;
  serviceLabels: Record<string, string>;
}) {
  if (manual && alternatives.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-xs text-accent-foreground">
        <Lightbulb className="size-3.5" />
        Pelo horário, a sugestão seria:
        {alternatives.map((a) => (
          <Button
            key={a}
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => onPick(a)}
          >
            Usar {serviceLabels[a] ?? serviceLabel(a)}
          </Button>
        ))}
      </div>
    );
  }
  if (manual) return null;
  const base = "flex items-center gap-2 rounded-md px-3 py-2 text-xs";
  switch (suggestion.kind) {
    case "single":
      return (
        <p className={`${base} bg-success-soft text-success`}>
          <Lightbulb className="size-3.5" /> Sugerido pelo horário:{" "}
          {serviceLabels[suggestion.service] ??
            serviceLabel(suggestion.service)}
          . Você pode alterar.
        </p>
      );
    case "choice":
      return (
        <p className={`${base} bg-primary-soft text-accent-foreground`}>
          <Info className="size-3.5" /> Horário de ceia: escolha entre Ceia
          completa e Ceia leve.
        </p>
      );
    case "pending":
      return (
        <p className={`${base} bg-warning-soft text-warning-foreground`}>
          <Info className="size-3.5" /> Faixa de jantar sem classificação
          definida. Selecione o serviço manualmente.
        </p>
      );
    default:
      return (
        <p className={`${base} bg-muted text-muted-foreground`}>
          <Info className="size-3.5" /> Nenhuma sugestão para este horário.
          Selecione o serviço manualmente.
        </p>
      );
  }
}
