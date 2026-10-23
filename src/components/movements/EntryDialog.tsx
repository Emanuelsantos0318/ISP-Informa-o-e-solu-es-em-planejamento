import { useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
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
import { Field } from "@/components/common/Field";
import { BackendNotice } from "@/components/common/BackendNotice";
import { ProductFormDialog } from "@/components/cadastro/ProductFormDialog";
import { ProductPicker } from "./ProductPicker";
import { SelectedProductRow } from "./SelectedProductRow";
import { ItemsList } from "./ItemsList";
import { nowInOperationalTz, operationalDateTimeToIso } from "@/lib/datetime";
import {
  prefillFromQuery,
  type MovementItemDraft,
  type Product,
  type ProductPrefill,
} from "@/lib/types";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { useMovementBatch } from "@/lib/supabase/useMovementBatch";

export function EntryDialog({
  open,
  onOpenChange,
  initialProduct,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialProduct?: Product | undefined;
}) {
  const catalog = useCatalog();
  const { unitId } = useOperationalScope();
  const movement = useMovementBatch();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [origin, setOrigin] = useState("");
  const [items, setItems] = useState<MovementItemDraft[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState<ProductPrefill>({});

  useEffect(() => {
    if (!open) return;
    const now = nowInOperationalTz();
    setDate(now.date);
    setTime(now.time);
    setSupplierId("");
    setOrigin("");
    setItems([]);
    setSelected(initialProduct ?? null);
    setNotes("");
    setErrors([]);
    setIdempotencyKey(null);
    setSubmitError(null);
  }, [open, initialProduct]);

  const confirm = async () => {
    const errs: string[] = [];
    if (!date || !time)
      errs.push("Informe a data e o hor\u00e1rio da entrada.");
    if (items.length === 0) errs.push("Inclua ao menos um produto.");
    if (!unitId) errs.push("Selecione uma unidade ativa.");
    const operationalAt = operationalDateTimeToIso(date, time);
    if (!operationalAt)
      errs.push("Informe uma data e hor\u00e1rio v\u00e1lidos.");
    setErrors(errs);
    setSubmitError(null);
    if (errs.length > 0 || !unitId || !operationalAt) return;
    const requestKey = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(requestKey);
    try {
      await movement.mutateAsync({
        unitId,
        movementType: "entry",
        operationalAt,
        idempotencyKey: requestKey,
        supplierId: supplierId || null,
        sourceReference: origin,
        note: notes,
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          lotNumber: item.lot,
          expiresOn: item.expiry,
        })),
      });
      setIdempotencyKey(null);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "N\u00e3o foi poss\u00edvel registrar a entrada.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-success-soft text-success">
              <ArrowDownToLine className="size-4" />
            </span>
            Nova entrada
          </DialogTitle>
          <DialogDescription>
            Registre o recebimento de produtos. Horário de Salvador (BA).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Data da entrada" htmlFor="e-date" required>
            <Input
              id="e-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Horário" htmlFor="e-time" required>
            <Input
              id="e-time"
              type="time"
              className="tabular"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Fornecedor">
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    catalog.suppliers.isLoading
                      ? "Carregando…"
                      : catalog.suppliers.data?.length
                        ? "Selecione"
                        : "Nenhum cadastrado"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {catalog.suppliers.data
                  ?.filter((supplier) => supplier.status === "active")
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Origem / documento" htmlFor="e-origin">
            <Input
              id="e-origin"
              placeholder="Ex.: NF 1234"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-foreground/80">
            Produtos recebidos
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
              mode="entrada"
              onCancel={() => setSelected(null)}
              onAdd={(item) => {
                setItems((cur) => [
                  ...cur,
                  { ...item, key: crypto.randomUUID() },
                ]);
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
            showLot
            onRemove={(k) => setItems((cur) => cur.filter((i) => i.key !== k))}
          />
        </div>

        <Field label="Observação" htmlFor="e-notes">
          <Textarea
            id="e-notes"
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
            variant="success"
            disabled={
              movement.isPending || !unitId || catalog.products.isLoading
            }
            onClick={() => void confirm()}
          >
            {movement.isPending ? "Gravando\u2026" : "Confirmar entrada"}
          </Button>
        </DialogFooter>

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
