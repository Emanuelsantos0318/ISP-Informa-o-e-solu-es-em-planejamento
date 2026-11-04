import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Scale } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/common/Field";
import { Input } from "@/components/ui/input";
import { BackendNotice } from "@/components/common/BackendNotice";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { useMovementBatch } from "@/lib/supabase/useMovementBatch";
import { createUuid } from "@/lib/uuid";
import { nowInOperationalTz, operationalDateTimeToIso } from "@/lib/datetime";
import type { MovementItemDraft, Product } from "@/lib/types";
import { ProductPicker } from "./ProductPicker";
import { SelectedProductRow } from "./SelectedProductRow";
import { ItemsList } from "./ItemsList";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "@/lib/session-draft";

type CorrectionType = "adjustment" | "loss";
export function StockCorrectionDialog({
  open,
  onOpenChange,
  draftKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftKey?: string | undefined;
}) {
  const { profile } = useAuth();
  const { unitId } = useOperationalScope();
  const catalog = useCatalog();
  const movement = useMovementBatch();
  const canManage =
    profile?.role === "operator" ||
    profile?.role === "admin" ||
    profile?.role === "stock_manager" ||
    profile?.role === "super_admin";
  const [type, setType] = useState<CorrectionType>("adjustment");
  const [direction, setDirection] = useState<"increase" | "decrease">(
    "increase",
  );
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<MovementItemDraft[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);

  useEffect(() => {
    if (!open) return;
    const now = nowInOperationalTz();
    setType("adjustment");
    setDirection("increase");
    setDate(now.date);
    setTime(now.time);
    setNote("");
    setItems([]);
    setSelected(null);
    setError(null);
    setIdempotencyKey(null);
    const saved = draftKey
      ? readSessionDraft<{
          type?: CorrectionType;
          direction?: "increase" | "decrease";
          date?: string;
          time?: string;
          note?: string;
          items?: MovementItemDraft[];
          selected?: Product | null;
          idempotencyKey?: string | null;
        }>(draftKey)
      : null;
    if (saved) {
      if (saved.type !== undefined) setType(saved.type);
      if (saved.direction !== undefined) setDirection(saved.direction);
      if (saved.date !== undefined) setDate(saved.date);
      if (saved.time !== undefined) setTime(saved.time);
      if (saved.note !== undefined) setNote(saved.note);
      if (saved.items !== undefined) setItems(saved.items);
      if (saved.selected !== undefined) setSelected(saved.selected);
      if (saved.idempotencyKey !== undefined)
        setIdempotencyKey(saved.idempotencyKey);
    }
    setDraftHydrated(true);
  }, [open, draftKey]);

  useEffect(() => {
    if (!open || !draftHydrated || !draftKey) return;
    writeSessionDraft(draftKey, {
      type,
      direction,
      date,
      time,
      note,
      items,
      selected,
      idempotencyKey,
    });
  }, [date, direction, draftHydrated, draftKey, idempotencyKey, items, note, open, selected, time, type]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setDraftHydrated(false);
      if (draftKey) clearSessionDraft(draftKey);
    }
    onOpenChange(next);
  };

  const confirm = async () => {
    if (!canManage) {
      setError(
        "Seu perfil não tem permissão para esta operação.",
      );
      return;
    }
    const operationalAt = operationalDateTimeToIso(date, time);
    if (!unitId || !operationalAt || items.length === 0 || !note.trim()) {
      setError("Informe data, horário, unidade, motivo e ao menos um produto.");
      return;
    }
    setError(null);
    try {
      const requestKey = idempotencyKey ?? createUuid();
      setIdempotencyKey(requestKey);
      await movement.mutateAsync({
        unitId,
        movementType: type,
        operationalAt,
        idempotencyKey: requestKey,
        note,
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          lotNumber:
            type === "adjustment" && direction === "increase"
              ? item.lot
              : undefined,
          expiresOn:
            type === "adjustment" && direction === "increase"
              ? item.expiry
              : undefined,
          adjustmentDirection: type === "adjustment" ? direction : null,
        })),
      });
      setIdempotencyKey(null);
      handleOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível registrar a correção.",
      );
    }
  };
  const entryLike = type === "adjustment" && direction === "increase";
  const selectedMode =
    type === "loss" ? "perda" : entryLike ? "ajuste" : "saida";
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-5" /> Ajuste de estoque ou perda
          </DialogTitle>
          <DialogDescription>
            Ajustes ficam registrados no histórico. Perdas e descartes são
            restritos à administração. Saídas por lote seguem a validade mais próxima.
          </DialogDescription>
        </DialogHeader>
        {!canManage && (
          <BackendNotice>
            Seu perfil não tem permissão para registrar ajustes ou perdas.
          </BackendNotice>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Operação">
            <Select
              value={type}
              onValueChange={(value) => setType(value as CorrectionType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="adjustment">Ajuste de inventário</SelectItem>
                {profile?.role !== "operator" && (
                  <SelectItem value="loss">Perda / descarte</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          {type === "adjustment" && (
            <Field label="Direção">
              <Select
                value={direction}
                onValueChange={(value) =>
                  setDirection(value as "increase" | "decrease")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="increase">Aumentar saldo</SelectItem>
                  <SelectItem value="decrease">Reduzir saldo</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Data" required>
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field label="Horário" required>
            <Input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Motivo da correção" required>
          <Textarea
            value={note}
            maxLength={500}
            rows={2}
            placeholder={
              type === "loss"
                ? "Ex.: produto vencido, avaria ou descarte"
                : "Ex.: contagem física de inventário"
            }
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">Produtos</span>
          {selected ? (
            <SelectedProductRow
              product={selected}
              mode={selectedMode}
              onCancel={() => setSelected(null)}
              onAdd={(item) => {
                setItems((current) => [
                  ...current,
                  { ...item, key: createUuid() },
                ]);
                setSelected(null);
              }}
            />
          ) : (
            <ProductPicker
              products={catalog.products.data ?? []}
              allowCreate={false}
              onSelect={setSelected}
              onRequestCreate={() => undefined}
            />
          )}
          <ItemsList
            items={items}
            showLot={entryLike}
            onRemove={(key) =>
              setItems((current) => current.filter((item) => item.key !== key))
            }
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
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
            disabled={!canManage || movement.isPending || !unitId}
            onClick={() => void confirm()}
          >
            {movement.isPending ? (
              "Gravando…"
            ) : type === "loss" ? (
              <>
                <ArrowDownToLine /> Registrar perda
              </>
            ) : (
              <>
                <ArrowUpFromLine /> Registrar ajuste
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
