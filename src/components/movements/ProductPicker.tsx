import { useRef, useState } from "react";
import { Plus, ScanBarcode, Search, PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unitShort } from "@/lib/config/units";
import { searchProducts, type Product } from "@/lib/types";

/**
 * Search by barcode, SKU, full or partial name.
 * Keyboard-wedge barcode readers type the code and press Enter — handled natively.
 */
export function ProductPicker({
  products,
  onSelect,
  onRequestCreate,
  allowCreate = true,
}: {
  products: Product[];
  onSelect: (p: Product) => void;
  onRequestCreate: (query: string) => void;
  allowCreate?: boolean | undefined;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = () => {
    if (!query.trim()) return;
    const found = searchProducts(products, query);
    const first = found[0];
    if (
      found.length === 1 &&
      first &&
      (first.barcode === query.trim() || first.sku === query.trim())
    ) {
      onSelect(first);
      setQuery("");
      setResults(null);
      return;
    }
    setResults(found);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            aria-label="Pesquisar produto"
            placeholder="Código de barras, SKU ou nome do produto"
            className="pl-8"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setResults(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                run();
              }
            }}
          />
        </div>
        <Button type="button" variant="secondary" onClick={run}>
          <Search /> Buscar
        </Button>
      </div>

      {results !== null && results.length === 0 && allowCreate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <PackageX className="size-4 text-muted-foreground" />
            Produto não encontrado. Deseja cadastrar este produto?
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onRequestCreate(query)}
          >
            <Plus /> Cadastrar produto
          </Button>
        </div>
      )}

      {results !== null && results.length > 0 && (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onSelect(p);
                  setQuery("");
                  setResults(null);
                  inputRef.current?.focus();
                }}
              >
                <span>
                  <span className="font-medium">{p.name}</span>
                  {p.brand && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {p.brand}
                    </span>
                  )}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {p.sku}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular">
                  Saldo: {p.balance} {unitShort(p.unit)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
