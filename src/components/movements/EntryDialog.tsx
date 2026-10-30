import { useEffect, useState } from "react";
import { ArrowDownToLine, FileUp } from "lucide-react";
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
import { createUuid } from "@/lib/uuid";
import { DanfeImportDialog, type ImportedInvoice } from "./DanfeImportDialog";
import {
  PurchaseOrderImportDialog,
  type ImportedPurchaseOrder,
} from "./PurchaseOrderImportDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { unitShort } from "@/lib/config/units";
import { toast } from "sonner";

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
  const [danfeOpen, setDanfeOpen] = useState(false);
  const [invoice, setInvoice] = useState<ImportedInvoice | null>(null);
  const [invoiceHasMappedLines, setInvoiceHasMappedLines] = useState(false);
  const [purchaseOrderOpen, setPurchaseOrderOpen] = useState(false);
  const [purchaseOrder, setPurchaseOrder] =
    useState<ImportedPurchaseOrder | null>(null);
  const [purchaseOrderReceiptConfirmed, setPurchaseOrderReceiptConfirmed] =
    useState(false);

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
    setInvoice(null);
    setInvoiceHasMappedLines(false);
    setDanfeOpen(false);
    setPurchaseOrder(null);
    setPurchaseOrderReceiptConfirmed(false);
    setPurchaseOrderOpen(false);
  }, [open, initialProduct]);

  const confirm = async () => {
    const errs: string[] = [];
    if (!date || !time)
      errs.push("Informe a data e o hor\u00e1rio da entrada.");
    if (items.length === 0) errs.push("Inclua ao menos um produto.");
    if (invoice && !supplierId && !invoice.newSupplier)
      errs.push(
        "Selecione o fornecedor da nota ou revise os dados do novo fornecedor.",
      );
    if (purchaseOrder && !purchaseOrderReceiptConfirmed)
      errs.push(
        "Confirme que os produtos e as quantidades desta entrada correspondem ao recebimento físico.",
      );
    if (!unitId) errs.push("Selecione uma unidade ativa.");
    const operationalAt = operationalDateTimeToIso(date, time);
    if (!operationalAt)
      errs.push("Informe uma data e hor\u00e1rio v\u00e1lidos.");
    setErrors(errs);
    setSubmitError(null);
    if (errs.length > 0 || !unitId || !operationalAt) return;
    const requestKey = idempotencyKey ?? createUuid();
    setIdempotencyKey(requestKey);
    try {
      await movement.mutateAsync({
        unitId,
        movementType: "entry",
        operationalAt,
        idempotencyKey: requestKey,
        supplierId: supplierId || null,
        sourceReference: origin,
        note: [
          notes.trim(),
          purchaseOrder
            ? "OC " +
              purchaseOrder.number +
              ": recebimento físico conferido; " +
              purchaseOrder.receivedLineCount +
              " item(ns) recebido(s), " +
              purchaseOrder.notReceivedLineCount +
              " não recebido(s)."
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
        invoice: invoice ?? undefined,
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          lotNumber: item.lot,
          expiresOn: item.expiry,
        })),
      });
      const productNames = items.slice(0, 3).map((item) => item.product.name);
      const remainingProducts = items.length - productNames.length;
      toast.success("Entrada de produtos registrada", {
        description: `${items.length} item(ns): ${productNames.join(", ")}${remainingProducts > 0 ? ` e mais ${remainingProducts}` : ""}. A entrada já está disponível em Movimentações.`,
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
            <Select
              value={supplierId}
              onValueChange={setSupplierId}
              disabled={catalog.suppliers.isLoading}
            >
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

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={
              Boolean(invoice) ||
              Boolean(purchaseOrder) ||
              items.length > 0 ||
              Boolean(selected)
            }
            onClick={() => setPurchaseOrderOpen(true)}
          >
            <FileUp /> Importar OC por PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              Boolean(invoice) ||
              Boolean(purchaseOrder) ||
              items.length > 0 ||
              Boolean(selected)
            }
            onClick={() => setDanfeOpen(true)}
          >
            <FileUp /> Importar DANFE por PDF
          </Button>
          {invoice && (
            <span className="text-xs text-success">
              Nota {invoice.invoiceNumber}, série {invoice.series} conferida ·{" "}
              {invoice.accessKey ? "chave identificada" : "sem chave de acesso"}
            </span>
          )}
          {purchaseOrder && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-success">
                OC {purchaseOrder.number} conferida ·{" "}
                {purchaseOrder.receivedLineCount} recebido(s) ·{" "}
                {purchaseOrder.notReceivedLineCount} não recebido(s)
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setItems([]);
                  setSupplierId("");
                  setOrigin((current) =>
                    current === "OC " + purchaseOrder.number ? "" : current,
                  );
                  setPurchaseOrder(null);
                  setPurchaseOrderReceiptConfirmed(false);
                }}
              >
                Remover OC
              </Button>
            </div>
          )}
          {!invoice && !purchaseOrder && (items.length > 0 || selected) && (
            <span className="text-xs text-muted-foreground">
              Importe a OC ou DANFE antes de adicionar ou selecionar produtos.
            </span>
          )}
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
          {purchaseOrder && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <p className="font-medium">
                Recebimento da OC {purchaseOrder.number} conferido; entrada ainda não lançada
              </p>
              <p className="text-muted-foreground">
                Os itens só serão registrados nas movimentações e somados ao estoque quando você clicar em “Registrar entrada no estoque” ao final deste formulário.
              </p>
              <p className="text-muted-foreground">
                Data prevista:{" "}
                {purchaseOrder.expectedDeliveryDate
                  ? purchaseOrder.expectedDeliveryDate
                      .split("-")
                      .reverse()
                      .join("/")
                  : "não informada"}
                {purchaseOrder.total
                  ? " · Total pedido: R$ " + purchaseOrder.total
                  : ""}
              </p>
              <ul className="max-h-36 list-inside list-disc overflow-y-auto text-xs">
                {purchaseOrder.lines.map((line, index) => {
                  return (
                    <li key={line.supplierCode + "-" + index}>
                      {line.productName}: {line.receivedQuantity}{" "}
                      {unitShort(line.productUnit)} recebido(s) (pedido:{" "}
                      {line.orderedQuantity} {line.packageDescription})
                    </li>
                  );
                })}
              </ul>
              {purchaseOrder.notReceivedLineCount > 0 && (
                <p className="text-xs">
                  {purchaseOrder.notReceivedLineCount} item(ns) marcado(s) como
                  não recebido(s); não serão lançados no estoque.
                </p>
              )}
              <label className="flex items-start gap-2 border-t border-warning/30 pt-2">
                <Checkbox
                  checked={purchaseOrderReceiptConfirmed}
                  onCheckedChange={(checked) =>
                    setPurchaseOrderReceiptConfirmed(checked === true)
                  }
                />
                Confirmei que esses produtos e quantidades chegaram fisicamente
                e estão corretos para dar entrada.
              </label>
            </div>
          )}
          {purchaseOrder || invoiceHasMappedLines ? (
            <p className="text-xs text-muted-foreground">
              Itens conferidos com o documento. Revise antes de confirmar a
              entrada.
            </p>
          ) : selected ? (
            <SelectedProductRow
              product={selected}
              mode="entrada"
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
            showLot
            onRemove={(k) => {
              setItems((cur) => cur.filter((i) => i.key !== k));
              if (purchaseOrder) setPurchaseOrderReceiptConfirmed(false);
            }}
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
            {movement.isPending
              ? "Registrando no estoque\u2026"
              : purchaseOrder
                ? "Registrar entrada no estoque"
                : "Confirmar entrada"}
          </Button>
        </DialogFooter>

        <ProductFormDialog
          open={creating}
          onOpenChange={setCreating}
          prefill={prefill}
          contextual
        />
        <DanfeImportDialog
          open={danfeOpen}
          onOpenChange={setDanfeOpen}
          onRequestCreateProduct={(query) => {
            setPrefill(prefillFromQuery(query));
            setCreating(true);
          }}
          onApply={({
            supplierId: nextSupplier,
            invoice: nextInvoice,
            items: importedItems,
          }) => {
            setSupplierId(nextSupplier);
            setInvoice(nextInvoice);
            setInvoiceHasMappedLines(importedItems.length > 0);
            setSelected(null);
            setOrigin(
              `NF ${nextInvoice.invoiceNumber} / série ${nextInvoice.series}`,
            );
            if (importedItems.length > 0) {
              setItems((current) => [
                ...current,
                ...importedItems.map((item) => ({
                  ...item,
                  key: createUuid(),
                })),
              ]);
            }
            setSubmitError(null);
          }}
        />
        <PurchaseOrderImportDialog
          open={purchaseOrderOpen}
          onOpenChange={setPurchaseOrderOpen}
          onRequestCreateProduct={(query) => {
            setPrefill(prefillFromQuery(query));
            setCreating(true);
          }}
          onApply={({
            supplierId: nextSupplier,
            purchaseOrder: nextOrder,
            items: receivedItems,
          }) => {
            setSupplierId(nextSupplier);
            setPurchaseOrder(nextOrder);
            setPurchaseOrderReceiptConfirmed(false);
            setInvoice(null);
            setInvoiceHasMappedLines(false);
            setSelected(null);
            setOrigin("OC " + nextOrder.number);
            setItems(
              receivedItems.map((item) => ({ ...item, key: createUuid() })),
            );
            setSubmitError(null);
            setErrors([]);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
