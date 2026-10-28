import { PackageOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unitShort } from "@/lib/config/units";
import type { MovementItemDraft } from "@/lib/types";

export function ItemsList({
  items,
  onRemove,
  showLot,
}: {
  items: MovementItemDraft[];
  onRemove: (key: string) => void;
  showLot?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        <PackageOpen className="size-4" />
        Nenhum produto incluído ainda.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Produto</th>
            <th className="px-3 py-2 text-right font-medium">Quantidade</th>
            {showLot && (
              <th className="px-3 py-2 text-left font-medium">
                Lote / Validade
              </th>
            )}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((i) => (
            <tr key={i.key}>
              <td className="px-3 py-2">
                <p className="font-medium">{i.product.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {i.product.sku}
                </p>
              </td>
              <td className="px-3 py-2 text-right tabular">
                {i.releasedUnits != null ? (
                  <span>
                    {i.releasedUnits} unidades ({i.quantity}{" "}
                    {unitShort(i.product.unit)})
                  </span>
                ) : (
                  <span>
                    {i.quantity} {unitShort(i.product.unit)}
                  </span>
                )}
              </td>
              {showLot && (
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {[i.lot, i.expiry].filter(Boolean).join(" · ") || "—"}
                </td>
              )}
              <td className="px-2">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remover ${i.product.name}`}
                  onClick={() => onRemove(i.key)}
                >
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
