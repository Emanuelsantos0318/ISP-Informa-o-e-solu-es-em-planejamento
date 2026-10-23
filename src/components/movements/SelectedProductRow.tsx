import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Field";
import { unitShort, UNITS } from "@/lib/config/units";
import type { MovementItemDraft, Product } from "@/lib/types";

/** Quantity (and lot/expiry for entries) for the product just selected. */
export function SelectedProductRow({
  product,
  mode,
  onAdd,
  onCancel,
}: {
  product: Product;
  mode: "entrada" | "saida";
  onAdd: (item: Omit<MovementItemDraft, "key">) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState("");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const unit = UNITS.find((u) => u.code === product.unit);

  const add = () => {
    const n = Number(qty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0)
      return setError("Informe uma quantidade maior que zero.");
    if (unit && unit.decimals === 0 && !Number.isInteger(n))
      return setError(
        `A unidade ${unit.label.toLowerCase()} aceita apenas números inteiros.`,
      );
    if (mode === "saida" && n > product.balance)
      return setError(
        `Quantidade acima do saldo disponível (${product.balance} ${unitShort(product.unit)}).`,
      );
    if (mode === "entrada" && product.lotControl && !lot.trim())
      return setError("Informe o lote.");
    if (mode === "entrada" && product.expiryControl && !expiry)
      return setError("Informe a validade.");
    setError(null);
    onAdd({
      product,
      quantity: n,
      lot: lot || undefined,
      expiry: expiry || undefined,
    });
  };

  return (
    <div className="rounded-md border bg-primary-soft/50 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{product.name}</p>
          {product.brand && (
            <p className="text-xs text-muted-foreground">{product.brand}</p>
          )}
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{product.barcode ?? product.sku}</span>{" "}
            · {unit?.label} · Saldo{" "}
            <span className="tabular">
              {product.balance} {unitShort(product.unit)}
            </span>
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Cancelar seleção"
          onClick={onCancel}
        >
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={`Quantidade (${unitShort(product.unit)})`}
          className="w-36"
        >
          <Input
            inputMode="decimal"
            className="tabular"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        {mode === "entrada" && product.lotControl && (
          <Field label="Lote" className="w-36">
            <Input value={lot} onChange={(e) => setLot(e.target.value)} />
          </Field>
        )}
        {mode === "entrada" && product.expiryControl && (
          <Field label="Validade" className="w-40">
            <Input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </Field>
        )}
        <Button type="button" onClick={add}>
          <Plus /> Adicionar
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
