import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/common/Field";
import { BackendNotice } from "@/components/common/BackendNotice";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { UNITS } from "@/lib/config/units";
import type { MovementItemDraft, Product } from "@/lib/types";
import type { PurchaseOrderPdf } from "@/lib/danfe/purchase-order";

type OrderBinding = {
  productId: string;
  receivedQuantity: string;
  notReceived: boolean;
};

export type ImportedPurchaseOrder = {
  number: string;
  supplierName: string;
  unitName: string;
  expectedDeliveryDate: string;
  total: string;
  pageCount: number;
  orderedLineCount: number;
  receivedLineCount: number;
  notReceivedLineCount: number;
  lines: Array<{
    supplierCode: string;
    description: string;
    orderedQuantity: string;
    packageDescription: string;
    receivedQuantity: number;
    productName: string;
    productUnit: Product["unit"];
  }>;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function parseQuantity(value: string) {
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Converte apenas rótulos explícitos; embalagens sem equivalência exigem conferência manual. */
function inventoryUnitFromOrderLabel(value: string) {
  const normalized = normalize(value);
  if (/^(kg|quilograma|quilogramas)\b/.test(normalized)) return "kg";
  if (/^(pct|pacote|pacotes)\b/.test(normalized)) return "pct";
  if (/^(cx|caixa|caixas)\b/.test(normalized)) return "cx";
  if (/^(un|und|unidade|unidades)\b/.test(normalized)) return "un";
  if (/^(l|litro|litros)\b/.test(normalized)) return "l";
  if (/^(m|metro|metros)\b/.test(normalized)) return "m";
  return null;
}

function suggestedProduct(products: Product[], description: string) {
  const matches = products.filter(
    (product) => normalize(product.name) === normalize(description),
  );
  return matches.length === 1 ? matches[0] : null;
}

function suggestedSupplier(
  suppliers: NonNullable<ReturnType<typeof useCatalog>["suppliers"]["data"]>,
  name: string,
) {
  const query = normalize(name);
  if (!query) return undefined;
  const matches = suppliers.filter(
    (supplier) =>
      supplier.status === "active" &&
      (normalize(supplier.name) === query ||
        normalize(supplier.name).startsWith(query)),
  );
  return matches.length === 1 ? matches[0]?.id : undefined;
}

export function PurchaseOrderImportDialog({
  open,
  onOpenChange,
  onApply,
  onRequestCreateProduct,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (input: {
    supplierId: string;
    purchaseOrder: ImportedPurchaseOrder;
    items: Omit<MovementItemDraft, "key">[];
  }) => void;
  onRequestCreateProduct: (query: string) => void;
}) {
  const catalog = useCatalog();
  const [order, setOrder] = useState<PurchaseOrderPdf | null>(null);
  const [bindings, setBindings] = useState<Record<number, OrderBinding>>({});
  const [supplierId, setSupplierId] = useState("");
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receiptConfirmed, setReceiptConfirmed] = useState(false);
  const abortController = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    abortController.current?.abort();
    abortController.current = null;
    setOrder(null);
    setBindings({});
    setSupplierId("");
    setFileName("");
    setProgress("");
    setError(null);
    setReceiptConfirmed(false);
  };

  useEffect(() => {
    if (!open || !order || supplierId) return;
    const found = suggestedSupplier(
      catalog.suppliers.data ?? [],
      order.supplierName,
    );
    if (found) setSupplierId(found);
  }, [catalog.suppliers.data, open, order, supplierId]);

  const processFile = async (file?: File) => {
    if (!file) return;
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    setOrder(null);
    setBindings({});
    setSupplierId("");
    setReceiptConfirmed(false);
    setError(null);
    setFileName(file.name);
    if (file.type && file.type !== "application/pdf") {
      setError("Selecione um arquivo PDF.");
      return;
    }
    try {
      const { extractPurchaseOrderPdf } =
        await import("@/lib/danfe/purchase-order");
      const result = await extractPurchaseOrderPdf(
        file,
        setProgress,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const products = catalog.products.data ?? [];
      const initialBindings: Record<number, OrderBinding> = {};
      result.items.forEach((line, index) => {
        const product = suggestedProduct(products, line.description);
        const orderUnit = inventoryUnitFromOrderLabel(line.packageDescription);
        const sameUnit = product && orderUnit === product.unit;
        initialBindings[index] = {
          productId: sameUnit ? product.id : "",
          receivedQuantity: sameUnit ? line.orderedQuantity : "",
          notReceived: false,
        };
      });
      setOrder(result);
      setBindings(initialBindings);
      const matchingSupplier = suggestedSupplier(
        catalog.suppliers.data ?? [],
        result.supplierName,
      );
      if (matchingSupplier) setSupplierId(matchingSupplier);
      setProgress("OC lida. Confira cada item e informe o que chegou.");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Falha ao ler a OC.");
      setProgress("");
    }
  };

  const apply = () => {
    if (!order) return;
    if (!supplierId)
      return setError(
        "Selecione o fornecedor já cadastrado antes de continuar com o recebimento.",
      );
    if (!receiptConfirmed)
      return setError(
        "Confirme que comparou a OC com os produtos que chegaram fisicamente.",
      );

    const products = catalog.products.data ?? [];
    const receivedItems: Omit<MovementItemDraft, "key">[] = [];
    const receivedLines: ImportedPurchaseOrder["lines"] = [];
    let notReceivedLineCount = 0;

    for (const [index, source] of order.items.entries()) {
      const binding = bindings[index];
      if (binding?.notReceived) {
        notReceivedLineCount += 1;
        continue;
      }
      if (!binding?.productId)
        return setError(
          `Vincule “${source.description}” a um produto ou marque que não foi recebido.`,
        );
      const product = products.find(
        (candidate) => candidate.id === binding.productId,
      );
      if (!product)
        return setError(`Atualize o vínculo do item ${source.sequence}.`);
      const quantity = parseQuantity(binding.receivedQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0)
        return setError(
          `Informe a quantidade efetivamente recebida de ${product.name}.`,
        );
      const unit = UNITS.find((candidate) => candidate.code === product.unit);
      if (unit?.decimals === 0 && !Number.isInteger(quantity))
        return setError(
          `${unit.label} aceita apenas números inteiros para ${product.name}.`,
        );

      receivedItems.push({ product, quantity });
      receivedLines.push({
        supplierCode: source.supplierCode,
        description: source.description,
        orderedQuantity: source.orderedQuantity,
        packageDescription: source.packageDescription,
        receivedQuantity: quantity,
        productName: product.name,
        productUnit: product.unit,
      });
    }

    if (receivedItems.length === 0)
      return setError("Nenhum produto foi marcado como recebido.");

    onApply({
      supplierId,
      purchaseOrder: {
        number: order.number,
        supplierName: order.supplierName,
        unitName: order.unitName,
        expectedDeliveryDate: order.expectedDeliveryDate,
        total: order.total,
        pageCount: order.pageCount,
        orderedLineCount: order.items.length,
        receivedLineCount: receivedItems.length,
        notReceivedLineCount,
        lines: receivedLines,
      },
      items: receivedItems,
    });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) abortController.current?.abort();
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Receber produtos pela ordem de compra</DialogTitle>
          <DialogDescription>
            A OC serve para conferir o pedido. O estoque só será atualizado após
            você informar o que chegou e confirmar a entrada. O PDF é lido neste
            navegador, sem envio ao Google Vision ou ao Supabase.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Ordem de compra em PDF" htmlFor="purchase-order-pdf">
            <Input
              ref={fileInputRef}
              id="purchase-order-pdf"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={(event) => void processFile(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(progress && !order)}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp /> {fileName ? "Escolher outra OC" : "Selecionar OC"}
            </Button>
          </Field>
          {progress && (
            <p role="status" className="text-sm text-muted-foreground">
              {fileName} · {progress}
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!catalog.hasUnitScope && (
          <BackendNotice>
            Selecione uma unidade ativa para consultar fornecedores e produtos.
          </BackendNotice>
        )}
        {catalog.products.isError && (
          <BackendNotice>
            O catálogo de produtos não foi carregado.
          </BackendNotice>
        )}

        {order && (
          <>
            {order.items.some((item) => item.description.includes("�")) && (
              <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground">
                Algumas letras acentuadas não vieram corretamente do PDF.
                Confira e corrija as descrições antes de vincular os produtos.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Fornecedor identificado">
                <Input
                  readOnly
                  value={order.supplierName || "Não identificado"}
                />
              </Field>
              <Field label="Fornecedor cadastrado" required>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                >
                  <option value="">Selecione…</option>
                  {catalog.suppliers.data
                    ?.filter((supplier) => supplier.status === "active")
                    .map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Número da OC">
                <Input readOnly value={order.number} />
              </Field>
              <Field label="Entrega prevista">
                <Input
                  readOnly
                  value={
                    order.expectedDeliveryDate
                      ? order.expectedDeliveryDate
                          .split("-")
                          .reverse()
                          .join("/")
                      : "Não identificada"
                  }
                />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              Unidade da OC: {order.unitName || "não identificada"} · Total do
              pedido: {order.total ? `R$ ${order.total}` : "não identificado"} ·{" "}
              {order.items.length} itens previstos · {order.pageCount} página(s)
            </p>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[1000px] text-left text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2">Cód. fornecedor</th>
                    <th className="p-2">Produto na OC</th>
                    <th className="p-2">Pedido</th>
                    <th className="p-2">Produto ISP</th>
                    <th className="p-2">Quantidade recebida</th>
                    <th className="p-2">Recebimento</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, index) => {
                    const binding = bindings[index] ?? {
                      productId: "",
                      receivedQuantity: "",
                      notReceived: false,
                    };
                    const selectedProduct = catalog.products.data?.find(
                      (product) => product.id === binding.productId,
                    );
                    const orderUnit = inventoryUnitFromOrderLabel(
                      item.packageDescription,
                    );
                    const unitMismatch =
                      selectedProduct && orderUnit !== selectedProduct.unit;
                    return (
                      <tr
                        key={`${item.supplierCode}-${index}`}
                        className="border-t align-top"
                      >
                        <td className="p-2">{item.supplierCode}</td>
                        <td className="p-2">
                          <Input
                            aria-label={`Descrição da OC, item ${item.sequence}`}
                            value={item.description}
                            disabled={binding.notReceived}
                            onChange={(event) =>
                              setOrder((current) =>
                                current
                                  ? {
                                      ...current,
                                      items: current.items.map(
                                        (row, rowIndex) =>
                                          rowIndex === index
                                            ? {
                                                ...row,
                                                description: event.target.value,
                                              }
                                            : row,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                          <span className="mt-1 block text-muted-foreground">
                            Unitário R$ {item.unitPrice} · Total R$ {item.total}
                          </span>
                        </td>
                        <td className="p-2">
                          {item.orderedQuantity} {item.packageDescription}
                        </td>
                        <td className="p-2">
                          <select
                            className="h-9 w-full rounded-md border bg-background px-2"
                            value={binding.productId}
                            disabled={binding.notReceived}
                            onChange={(event) => {
                              const product = catalog.products.data?.find(
                                (candidate) =>
                                  candidate.id === event.target.value,
                              );
                              const matchedUnit =
                                product &&
                                inventoryUnitFromOrderLabel(
                                  item.packageDescription,
                                ) === product.unit;
                              setBindings((current) => ({
                                ...current,
                                [index]: {
                                  ...binding,
                                  productId: event.target.value,
                                  receivedQuantity: matchedUnit
                                    ? binding.receivedQuantity ||
                                      item.orderedQuantity
                                    : "",
                                },
                              }));
                            }}
                          >
                            <option value="">Vincular produto…</option>
                            {catalog.products.data?.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name} · {product.sku} · {product.unit}
                              </option>
                            ))}
                          </select>
                          {!binding.notReceived && !binding.productId && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mt-1 h-8"
                              onClick={() =>
                                onRequestCreateProduct(item.description)
                              }
                            >
                              Cadastrar produto
                            </Button>
                          )}
                        </td>
                        <td className="p-2">
                          <Input
                            inputMode="decimal"
                            aria-label={`Quantidade realmente recebida, item ${item.sequence}`}
                            placeholder={
                              unitMismatch && selectedProduct
                                ? `Em ${selectedProduct.unit}`
                                : "Qtd. recebida"
                            }
                            value={binding.receivedQuantity}
                            disabled={binding.notReceived}
                            onChange={(event) =>
                              setBindings((current) => ({
                                ...current,
                                [index]: {
                                  ...binding,
                                  receivedQuantity: event.target.value,
                                },
                              }))
                            }
                          />
                          {unitMismatch && selectedProduct && (
                            <span className="mt-1 block text-warning-foreground">
                              OC em “{item.packageDescription}”; informe
                              manualmente o recebido em {selectedProduct.unit}.
                              Não há conversão automática.
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={binding.notReceived}
                              onCheckedChange={(checked) => {
                                const isNotReceived = checked === true;
                                const product = catalog.products.data?.find(
                                  (candidate) =>
                                    candidate.id === binding.productId,
                                );
                                const sameUnit =
                                  product &&
                                  inventoryUnitFromOrderLabel(
                                    item.packageDescription,
                                  ) === product.unit;
                                setBindings((current) => ({
                                  ...current,
                                  [index]: {
                                    ...binding,
                                    notReceived: isNotReceived,
                                    receivedQuantity: isNotReceived
                                      ? ""
                                      : sameUnit
                                        ? item.orderedQuantity
                                        : "",
                                  },
                                }));
                              }}
                            />
                            Não chegou
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <label className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-3 text-sm">
              <Checkbox
                checked={receiptConfirmed}
                onCheckedChange={(checked) =>
                  setReceiptConfirmed(checked === true)
                }
              />
              <span>
                Conferi fisicamente os produtos e confirmei as quantidades
                recebidas. Itens não recebidos serão excluídos desta entrada.
              </span>
            </label>
          </>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="success"
            disabled={!order || !receiptConfirmed || catalog.products.isLoading}
            onClick={apply}
          >
            Continuar para registrar entrada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
