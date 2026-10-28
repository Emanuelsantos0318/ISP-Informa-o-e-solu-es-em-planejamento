import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field } from "@/components/common/Field";
import { unitShort, UNITS } from "@/lib/config/units";
import type { MovementItemDraft, Product } from "@/lib/types";

/** Quantity (and lot/expiry for entries) for the product just selected. */
export function SelectedProductRow({
  product,
  mode,
  onAdd,
  onCancel,
  initialQuantity = "",
  actionLabel = "Adicionar",
  submitting = false,
}: {
  product: Product;
  mode: "entrada" | "saida" | "ajuste" | "perda";
  onAdd: (item: Omit<MovementItemDraft, "key">) => void;
  onCancel: () => void;
  initialQuantity?: string | undefined;
  actionLabel?: string | undefined;
  submitting?: boolean | undefined;
}) {
  const [qty, setQty] = useState(initialQuantity);
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [releaseMode, setReleaseMode] = useState<"package" | "individual">(
    "package",
  );
  const [error, setError] = useState<string | null>(null);
  const unit = UNITS.find((u) => u.code === product.unit);
  const isPackagedUnit = ["pct", "cx", "ct", "mi"].includes(product.unit);
  const canReleaseIndividualUnits =
    isPackagedUnit && product.unitsPerPackage !== null;
  const calculatedPackageQuantity =
    releaseMode === "individual" && product.unitsPerPackage
      ? Number(qty.replace(",", ".")) / product.unitsPerPackage
      : null;

  const add = () => {
    const n = Number(qty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0)
      return setError("Informe uma quantidade maior que zero.");
    if (mode === "saida" && releaseMode === "individual") {
      if (!product.unitsPerPackage)
        return setError(
          "Cadastre a quantidade de unidades por pacote no produto antes de retirar unidades avulsas.",
        );
      if (!Number.isInteger(n))
        return setError("Unidades liberadas devem ser um número inteiro.");
      const rawPackageQuantity = n / product.unitsPerPackage;
      const packageQuantity = Number(rawPackageQuantity.toFixed(3));
      if (Math.abs(rawPackageQuantity - packageQuantity) > 1e-9)
        return setError(
          "Esta conversão não pode ser registrada com precisão de até três casas decimais.",
        );
      if (packageQuantity > product.balance)
        return setError(
          `Unidades acima do saldo disponível (${product.balance} ${unitShort(product.unit)}).`,
        );
      setError(null);
      onAdd({
        product,
        quantity: packageQuantity,
        releasedUnits: n,
        lot: lot || undefined,
        expiry: expiry || undefined,
      });
      return;
    }
    if (unit && unit.decimals === 0 && !Number.isInteger(n))
      return setError(
        `A unidade ${unit.label.toLowerCase()} aceita apenas números inteiros.`,
      );
    if ((mode === "saida" || mode === "perda") && n > product.balance)
      return setError(
        `Quantidade acima do saldo disponível (${product.balance} ${unitShort(product.unit)}).`,
      );
    if ((mode === "entrada" || mode === "ajuste") && expiry && !lot.trim())
      return setError("Informe o lote para registrar a validade.");
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
      {mode === "saida" && isPackagedUnit && (
        <div className="mb-3">
          <span className="mb-1.5 block text-xs font-medium text-foreground/80">
            Forma de retirada
          </span>
          <ToggleGroup
            type="single"
            value={releaseMode}
            onValueChange={(value) => {
              if (
                value === "package" ||
                (value === "individual" && canReleaseIndividualUnits)
              ) {
                setReleaseMode(value);
                setQty("");
                setError(null);
              }
            }}
            className="flex flex-wrap justify-start gap-2"
          >
            <ToggleGroupItem
              value="package"
              className="h-9 rounded-full border px-4 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              Pacote fechado
            </ToggleGroupItem>
            <ToggleGroupItem
              value="individual"
              disabled={!canReleaseIndividualUnits}
              title={
                canReleaseIndividualUnits
                  ? undefined
                  : "Cadastre unidades por pacote no produto para habilitar essa forma de saída."
              }
              className="h-9 rounded-full border px-4 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              Unidades avulsas
            </ToggleGroupItem>
          </ToggleGroup>
          {releaseMode === "individual" && product.unitsPerPackage && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              1 {unitShort(product.unit)} = {product.unitsPerPackage} unidades
            </p>
          )}
          {!canReleaseIndividualUnits && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Para retirar unidades avulsas, cadastre o conteúdo do pacote no
              produto.
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={
            mode === "saida" && releaseMode === "individual"
              ? "Unidades liberadas"
              : `Quantidade (${unitShort(product.unit)})`
          }
          className="w-36"
        >
          <Input
            inputMode="decimal"
            className="tabular"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        {mode === "saida" &&
          releaseMode === "individual" &&
          calculatedPackageQuantity !== null &&
          Number.isFinite(calculatedPackageQuantity) && (
            <p className="pb-2 text-sm text-muted-foreground">
              Baixa calculada:{" "}
              <strong className="text-foreground">
                {calculatedPackageQuantity.toLocaleString("pt-BR", {
                  maximumFractionDigits: 3,
                })}{" "}
                {unitShort(product.unit)}
              </strong>
            </p>
          )}
        {(mode === "entrada" || mode === "ajuste") && (
          <Field label="Lote" className="w-36">
            <Input value={lot} onChange={(e) => setLot(e.target.value)} />
          </Field>
        )}
        {(mode === "entrada" || mode === "ajuste") && (
          <Field label="Validade" className="w-40">
            <Input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </Field>
        )}
        <Button type="button" onClick={add} disabled={submitting}>
          <Plus /> {actionLabel}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
