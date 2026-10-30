import { useRef, useState, type RefObject } from "react";
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
  liveSearch = false,
  placeholder = "Digite o nome, código de barras ou SKU",
  disabled = false,
  inputId,
  inputClassName,
  inputRef,
}: {
  products: Product[];
  onSelect: (p: Product) => void;
  onRequestCreate: (query: string) => void;
  allowCreate?: boolean | undefined;
  liveSearch?: boolean | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  inputId?: string | undefined;
  inputClassName?: string | undefined;
  inputRef?: RefObject<HTMLInputElement | null> | undefined;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[] | null>(null);
  const [searched, setSearched] = useState(false);
  const internalInputRef = useRef<HTMLInputElement>(null);

  // A busca exata pode confirmar o código de barras; na busca ao vivo, o operador escolhe uma sugestão.
  const run = () => {
    if (!query.trim()) return;
    const found = searchProducts(products, query);
    setSearched(true);
    const first = found[0];
    const exactCode =
      found.length === 1 &&
      first &&
      (first.barcode === query.trim() ||
        first.sku.toLocaleLowerCase("pt-BR") ===
          query.trim().toLocaleLowerCase("pt-BR"));
    if (exactCode && first) {
      onSelect(first);
      setQuery("");
      setResults(null);
      return;
    }
    setResults(found);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={inputId}
            ref={inputRef ?? internalInputRef}
            aria-label="Pesquisar produto"
            placeholder={placeholder}
            className={["pl-8", inputClassName].filter(Boolean).join(" ")}
            value={query}
            disabled={disabled}
            // Atualiza sugestões a cada tecla, sem exigir botão de pesquisa.
            onChange={(e) => {
              const value = e.target.value;
              setQuery(value);
              setSearched(false);
              setResults(value.trim() ? searchProducts(products, value) : null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                run();
              }
            }}
          />
        </div>
        {!liveSearch && (
          <Button
            type="button"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={run}
            disabled={disabled}
          >
            <Search /> Buscar
          </Button>
        )}
      </div>

      {!liveSearch && (
        <p className="text-xs text-muted-foreground">
          A busca atualiza enquanto você digita. Leia o código de barras ou
          pesquise pelo nome.
        </p>
      )}

      {/* Quando não há correspondência, oferece o cadastro contextual do item digitado. */}
      {results !== null &&
        results.length === 0 &&
        allowCreate &&
        (searched || (liveSearch && query.trim().length >= 3)) && (
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
        <ul
          className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card"
          role="listbox"
          aria-label="Produtos encontrados"
        >
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm transition-colors hover:bg-accent"
                onClick={() => {
                  onSelect(p);
                  setQuery("");
                  setResults(null);
                  (inputRef ?? internalInputRef).current?.focus();
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
                  {p.barcode && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      · {p.barcode}
                    </span>
                  )}
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
