import { useEffect, useRef, useState } from "react";
import { FileUp, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/common/Field";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { useInvoiceHistory } from "@/lib/supabase/useInvoiceHistory";
import { useAuth } from "@/lib/supabase/AuthProvider";
import type { MovementBatchInput } from "@/lib/supabase/movements";
import type { DanfeExtraction } from "@/lib/danfe/extract";
import type { MovementItemDraft, Product } from "@/lib/types";
import { formatCnpj, isValidCnpj } from "@/lib/validation/cnpj";

export type ImportedInvoice = {
  accessKey: string | null;
  invoiceNumber: string;
  series: string;
  issueDate: string | null;
  supplierCnpj: string | null;
  invoiceTotal: string | null;
  extractedText: string;
  parsedData: Record<string, unknown>;
  newSupplier: NonNullable<MovementBatchInput["invoice"]>["newSupplier"];
};

function parseDecimal(value: string) {
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function decimalText(value: string) {
  const parsed = parseDecimal(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

function sourceUnitCode(value: string) {
  const unit = value.trim().toLowerCase().replace(/[.\s]/g, "");
  const map: Record<string, string> = {
    un: "un",
    und: "un",
    unidade: "un",
    pct: "pct",
    pacote: "pct",
    cx: "cx",
    caixa: "cx",
    ct: "ct",
    cento: "ct",
    mi: "mi",
    milheiro: "mi",
    m: "m",
    mt: "m",
    metro: "m",
    kg: "kg",
    quilograma: "kg",
    l: "l",
    lt: "l",
    litro: "l",
  };
  return map[unit] ?? null;
}

function normalizeSupplierName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export function DanfeImportDialog({
  open,
  onOpenChange,
  onApply,
  onRequestCreateProduct,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (input: {
    supplierId: string;
    invoice: ImportedInvoice;
    items: Omit<MovementItemDraft, "key">[];
  }) => void;
  onRequestCreateProduct: (query: string) => void;
}) {
  const catalog = useCatalog();
  const invoices = useInvoiceHistory();
  const { profile } = useAuth();
  const [extraction, setExtraction] = useState<DanfeExtraction | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierNotice, setSupplierNotice] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [series, setSeries] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [supplierCnpj, setSupplierCnpj] = useState("");
  const [supplierTradeName, setSupplierTradeName] = useState("");
  const [supplierStateRegistration, setSupplierStateRegistration] =
    useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierCity, setSupplierCity] = useState("");
  const [supplierState, setSupplierState] = useState("");
  const [supplierPostalCode, setSupplierPostalCode] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [rawText, setRawText] = useState("");
  const [bindings, setBindings] = useState<
    Record<number, { productId: string; quantity: string; exclude: boolean }>
  >({});
  const [fileName, setFileName] = useState("");
  const [totalsAcknowledged, setTotalsAcknowledged] = useState(false);
  const [ocrReviewed, setOcrReviewed] = useState(false);
  const abortController = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    abortController.current?.abort();
    abortController.current = null;
    setExtraction(null);
    setProgress("");
    setError(null);
    setSupplierId("");
    setSupplierName("");
    setSupplierNotice("");
    setInvoiceNumber("");
    setSeries("");
    setAccessKey("");
    setIssueDate("");
    setSupplierCnpj("");
    setSupplierTradeName("");
    setSupplierStateRegistration("");
    setSupplierAddress("");
    setSupplierCity("");
    setSupplierState("");
    setSupplierPostalCode("");
    setSupplierPhone("");
    setSupplierEmail("");
    setInvoiceTotal("");
    setRawText("");
    setBindings({});
    setFileName("");
    setTotalsAcknowledged(false);
    setOcrReviewed(false);
  };

  const parsedItemsTotal = extraction?.items.reduce((total, item) => {
    const amount = parseDecimal(item.total);
    return Number.isFinite(amount) ? total + amount : total;
  }, 0);
  const invoiceAmount = parseDecimal(invoiceTotal);
  const hasTotalsDivergence =
    extraction !== null &&
    extraction.items.length > 0 &&
    Number.isFinite(invoiceAmount) &&
    Number.isFinite(parsedItemsTotal) &&
    Math.abs((parsedItemsTotal ?? 0) - invoiceAmount) > 0.02;
  const duplicateInvoice = invoices.data?.find(
    (invoice) =>
      (accessKey && invoice.access_key === accessKey) ||
      (!accessKey &&
        supplierId &&
        invoice.supplier_id === supplierId &&
        invoice.invoice_number.toLowerCase() ===
          invoiceNumber.trim().toLowerCase() &&
        invoice.series.toLowerCase() === series.trim().toLowerCase() &&
        invoice.issue_date === (issueDate || null)),
  );
  const matchedSupplier = catalog.suppliers.data?.find((supplier) => {
    if (supplier.status !== "active") return false;
    const cnpj = supplierCnpj.replace(/\D/g, "");
    if (cnpj) return isValidCnpj(cnpj) && supplier.cnpj === cnpj;
    return (
      Boolean(supplierName.trim()) &&
      normalizeSupplierName(supplier.name) ===
        normalizeSupplierName(supplierName)
    );
  });
  const selectedExistingSupplier = catalog.suppliers.data?.find(
    (supplier) => supplier.id === (supplierId || matchedSupplier?.id),
  );

  useEffect(() => {
    if (!extraction || !matchedSupplier) return;
    setSupplierId(matchedSupplier.id);
    setSupplierNotice("Fornecedor existente localizado.");
  }, [extraction, matchedSupplier]);
  const processFile = async (file?: File) => {
    if (!file) return;
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    setError(null);
    setExtraction(null);
    setFileName(file.name);
    if (file.type && file.type !== "application/pdf") {
      setError("Selecione um arquivo PDF.");
      return;
    }
    try {
      const { extractDanfePdf } = await import("@/lib/danfe/extract");
      const result = await extractDanfePdf(
        file,
        setProgress,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      abortController.current = null;
      setExtraction(result);
      setSupplierName(result.supplierName);
      setInvoiceNumber(result.invoiceNumber);
      setSeries(result.series);
      setAccessKey(result.accessKey);
      setIssueDate(result.issueDate);
      setSupplierCnpj(result.supplierCnpj);
      setSupplierTradeName(result.supplierTradeName);
      setSupplierStateRegistration(result.supplierStateRegistration);
      setSupplierAddress(result.supplierAddress);
      setSupplierCity(result.supplierCity);
      setSupplierState(result.supplierState);
      setSupplierPostalCode(result.supplierPostalCode);
      setSupplierPhone(result.supplierPhone);
      setSupplierEmail(result.supplierEmail);
      setInvoiceTotal(result.invoiceTotal);
      setTotalsAcknowledged(false);
      setOcrReviewed(false);
      setRawText(result.text);
      const next: typeof bindings = {};
      for (const [index, item] of result.items.entries()) {
        next[index] = {
          productId: "",
          quantity: item.quantity,
          exclude: false,
        };
      }
      setBindings(next);
      setProgress("Leitura concluída. Confira todos os campos antes de usar.");
    } catch (cause) {
      if (controller.signal.aborted) {
        setProgress("");
        setError(null);
        return;
      }
      abortController.current = null;
      setError(
        cause instanceof Error ? cause.message : "Falha ao processar o PDF.",
      );
      setProgress("");
    }
  };

  const apply = () => {
    if (!extraction) return;
    const selectedSupplierId = supplierId || matchedSupplier?.id || "";
    const cleanCnpj = supplierCnpj.replace(/\D/g, "");
    const name = supplierName.trim();
    const canCreateSupplier =
      (profile?.role === "admin" ||
        profile?.role === "stock_manager" ||
        profile?.role === "super_admin") &&
      name.length >= 2 &&
      !/^(cnpj|cpf|data|emissao|inscricao|endereco)\b/i.test(name) &&
      (!cleanCnpj || isValidCnpj(cleanCnpj));
    if (!selectedSupplierId && !canCreateSupplier)
      return setError(
        "Selecione um fornecedor existente ou revise os dados do emitente para preparar o cadastro.",
      );
    if (duplicateInvoice)
      return setError("Esta nota já consta no histórico desta unidade.");
    if (!invoiceNumber.trim() || !series.trim())
      return setError("Confira e informe o número e a série da nota.");
    if (rawText.length > 300000)
      return setError(
        "O texto extraído excede o limite seguro. Use um PDF menor.",
      );
    if (hasTotalsDivergence && !totalsAcknowledged)
      return setError(
        "Confirme que revisou a divergência entre os itens e o total da nota.",
      );
    if (extraction.usedOcr && !ocrReviewed)
      return setError(
        "Revise as descrições e quantidades reconhecidas antes de continuar.",
      );
    if (accessKey && !/^\d{44}$/.test(accessKey))
      return setError(
        "A chave de acesso deve ter 44 dígitos ou ficar vazia para conferência manual.",
      );
    if (cleanCnpj && !isValidCnpj(cleanCnpj))
      return setError("O CNPJ deve conter 14 dígitos ou ficar vazio.");
    if (
      supplierEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierEmail.trim())
    )
      return setError("Confira o e-mail do fornecedor antes de continuar.");
    const items: Omit<MovementItemDraft, "key">[] = [];
    for (const [index, source] of extraction.items.entries()) {
      const binding = bindings[index];
      if (binding?.exclude) continue;
      if (!binding?.productId)
        return setError(
          `Vincule o item ${source.sequence} a um produto ou marque-o para não importar.`,
        );
      const product = catalog.products.data?.find(
        (candidate) => candidate.id === binding.productId,
      );
      if (!product)
        return setError(
          `O produto vinculado ao item ${source.sequence} não está disponível.`,
        );
      if (sourceUnitCode(source.unit) !== product.unit)
        return setError(
          `A unidade do item ${source.sequence} (${source.unit}) difere da unidade de ${product.name}. Não é feita conversão automática.`,
        );
      const quantity = parseDecimal(binding.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0)
        return setError(`Confira a quantidade do item ${source.sequence}.`);
      items.push({ product, quantity });
    }
    if (extraction.items.length > 0 && items.length === 0)
      return setError("A nota precisa ter ao menos um item vinculado.");
    const amount = decimalText(invoiceTotal);
    const newSupplier: NonNullable<
      MovementBatchInput["invoice"]
    >["newSupplier"] = selectedSupplierId
      ? null
      : {
          name,
          cnpj: cleanCnpj || null,
          tradeName: supplierTradeName.trim() || null,
          stateRegistration: supplierStateRegistration.trim() || null,
          address: supplierAddress.trim() || null,
          city: supplierCity.trim() || null,
          state: supplierState.trim().toUpperCase() || null,
          postalCode: supplierPostalCode.replace(/\D/g, "") || null,
          phone: supplierPhone.trim() || null,
          email: supplierEmail.trim() || null,
        };
    onApply({
      supplierId: selectedSupplierId,
      invoice: {
        accessKey: accessKey || null,
        invoiceNumber: invoiceNumber.trim(),
        series: series.trim(),
        issueDate: issueDate || null,
        supplierCnpj: cleanCnpj || null,
        invoiceTotal: amount || null,
        extractedText: rawText,
        parsedData: {
          items: extraction.items,
          pageCount: extraction.pageCount,
          usedOcr: extraction.usedOcr,
          supplierName: extraction.supplierName,
        },
        newSupplier,
      },
      items,
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
          <DialogTitle>Importar DANFE por PDF</DialogTitle>
          <DialogDescription>
            O arquivo é lido neste navegador e não é enviado ao Supabase. A
            leitura não altera o estoque.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field
            label="Arquivo PDF (até 10 MB e 15 páginas)"
            htmlFor="danfe-pdf-input"
          >
            <Input
              ref={fileInputRef}
              id="danfe-pdf-input"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              disabled={Boolean(
                progress &&
                progress !==
                  "Leitura concluída. Confira todos os campos antes de usar.",
              )}
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={(event) => void processFile(event.target.files?.[0])}
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(progress && !extraction)}
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <FileUp />{" "}
            {fileName ? "Escolher outro arquivo" : "Selecionar arquivo"}
          </Button>
        </div>
        {(fileName || progress) && (
          <p role="status" className="text-sm text-muted-foreground">
            {fileName}
            {progress ? ` · ${progress}` : ""}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {extraction && (
          <>
            {extraction.usedOcr && (
              <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground">
                <p>
                  Esta nota foi lida por OCR. Confira com o PDF cada descrição
                  e, principalmente, cada quantidade antes de importar.
                </p>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ocrReviewed}
                    onChange={(event) => setOcrReviewed(event.target.checked)}
                  />
                  Revisei as descrições e quantidades dos itens.
                </label>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Fornecedor" required>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={supplierId}
                  onChange={(event) => {
                    setSupplierId(event.target.value);
                    setSupplierNotice(
                      event.target.value
                        ? "Fornecedor existente selecionado."
                        : "",
                    );
                  }}
                >
                  <option value="">Selecione…</option>
                  {catalog.suppliers.data
                    ?.filter((supplier) => supplier.status === "active")
                    .map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                        {supplier.cnpj ? ` · ${formatCnpj(supplier.cnpj)}` : ""}
                      </option>
                    ))}
                </select>
              </Field>
              {!(supplierId || matchedSupplier?.id) && (
                <div className="rounded-md border bg-muted/20 p-3 sm:col-span-2">
                  <p className="mb-2 text-sm font-medium">
                    Confira os dados do emitente. Um fornecedor novo será criado
                    junto com a entrada após sua confirmação.
                  </p>
                  {profile?.role === "admin" ||
                  profile?.role === "stock_manager" ||
                  profile?.role === "super_admin" ? (
                    <>
                      <Field
                        label="Nome ou razão social reconhecida"
                        htmlFor="danfe-supplier-name"
                        required
                      >
                        <Input
                          id="danfe-supplier-name"
                          value={supplierName}
                          onChange={(event) => {
                            setSupplierName(event.target.value);
                            setSupplierId("");
                          }}
                          maxLength={180}
                        />
                      </Field>
                      <p className="mt-2 text-xs text-muted-foreground">
                        CNPJ da nota:{" "}
                        {supplierCnpj
                          ? formatCnpj(supplierCnpj)
                          : "não identificado"}
                        . Revise e corrija os dados. Nada é gravado até
                        confirmar a entrada.
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field label="Nome fantasia">
                          <Input
                            value={supplierTradeName}
                            onChange={(event) =>
                              setSupplierTradeName(event.target.value)
                            }
                          />
                        </Field>
                        <Field label="Inscrição estadual">
                          <Input
                            value={supplierStateRegistration}
                            onChange={(event) =>
                              setSupplierStateRegistration(event.target.value)
                            }
                          />
                        </Field>
                        <Field label="Endereço">
                          <Input
                            value={supplierAddress}
                            onChange={(event) =>
                              setSupplierAddress(event.target.value)
                            }
                          />
                        </Field>
                        <Field label="Município">
                          <Input
                            value={supplierCity}
                            onChange={(event) =>
                              setSupplierCity(event.target.value)
                            }
                          />
                        </Field>
                        <Field label="UF">
                          <Input
                            maxLength={2}
                            value={supplierState}
                            onChange={(event) =>
                              setSupplierState(event.target.value)
                            }
                          />
                        </Field>
                        <Field label="CEP">
                          <Input
                            value={supplierPostalCode}
                            onChange={(event) =>
                              setSupplierPostalCode(event.target.value)
                            }
                          />
                        </Field>
                        <Field label="Telefone">
                          <Input
                            value={supplierPhone}
                            onChange={(event) =>
                              setSupplierPhone(event.target.value)
                            }
                          />
                        </Field>
                        <Field label="E-mail">
                          <Input
                            type="email"
                            value={supplierEmail}
                            onChange={(event) =>
                              setSupplierEmail(event.target.value)
                            }
                          />
                        </Field>
                      </div>
                      {supplierNotice && (
                        <p
                          role="status"
                          className="mt-2 text-sm text-muted-foreground"
                        >
                          {supplierNotice}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Peça a um administrador ou gestor de estoque para
                      cadastrar este fornecedor.
                    </p>
                  )}
                </div>
              )}
              {selectedExistingSupplier && (
                <p
                  role="status"
                  className="text-sm text-muted-foreground sm:col-span-2"
                >
                  {supplierNotice || "Fornecedor existente selecionado."}
                </p>
              )}
              <Field label="Número da nota" required>
                <Input
                  value={invoiceNumber}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                />
              </Field>
              <Field label="Série" required>
                <Input
                  value={series}
                  onChange={(event) => setSeries(event.target.value)}
                />
              </Field>
              <Field label="Data de emissão">
                <Input
                  type="date"
                  value={issueDate}
                  onChange={(event) => setIssueDate(event.target.value)}
                />
              </Field>
              <Field label="Chave de acesso (44 dígitos)">
                <Input
                  inputMode="numeric"
                  maxLength={44}
                  value={accessKey}
                  onChange={(event) =>
                    setAccessKey(event.target.value.replace(/\D/g, ""))
                  }
                />
              </Field>
              <Field label="CNPJ do fornecedor">
                <Input
                  inputMode="numeric"
                  maxLength={18}
                  value={supplierCnpj}
                  onChange={(event) => {
                    setSupplierCnpj(event.target.value);
                    setSupplierId("");
                  }}
                />
              </Field>
              <Field label="Total da nota">
                <Input
                  inputMode="decimal"
                  value={invoiceTotal}
                  onChange={(event) => setInvoiceTotal(event.target.value)}
                />
              </Field>
              <p className="self-end text-xs text-muted-foreground">
                {extraction.pageCount} página(s) ·{" "}
                {extraction.usedOcr ? "OCR português" : "texto pesquisável"}
              </p>
            </div>
            <div className="rounded-md border">
              <div className="border-b px-3 py-2 text-sm font-medium">
                Itens extraídos ({extraction.items.length})
              </div>
              {extraction.items.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Nenhuma linha pôde ser estruturada automaticamente. Revise o
                  texto abaixo e adicione os produtos pela busca da entrada.
                </p>
              ) : (
                <div className="max-h-72 overflow-auto">
                  <table className="w-full min-w-[850px] text-left text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="p-2"># / código</th>
                        <th className="p-2">Descrição</th>
                        <th className="p-2">Unidade / qtd.</th>
                        <th className="p-2">Produto ISP</th>
                        <th className="p-2">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extraction.items.map((item, index) => {
                        const binding = bindings[index] ?? {
                          productId: "",
                          quantity: item.quantity,
                          exclude: false,
                        };
                        return (
                          <tr
                            key={`${item.sequence}-${index}`}
                            className="border-t align-top"
                          >
                            <td className="p-2">
                              {item.sequence}
                              <br />
                              {item.supplierCode}
                            </td>
                            <td className="p-2">
                              <Input
                                aria-label={`Descrição item ${item.sequence}`}
                                value={item.description}
                                onChange={(event) =>
                                  setExtraction((current) =>
                                    current
                                      ? {
                                          ...current,
                                          items: current.items.map(
                                            (row, rowIndex) =>
                                              rowIndex === index
                                                ? {
                                                    ...row,
                                                    description:
                                                      event.target.value,
                                                  }
                                                : row,
                                          ),
                                        }
                                      : current,
                                  )
                                }
                              />
                              <span className="mt-1 block text-muted-foreground">
                                NCM {item.ncm || "—"} · CFOP {item.cfop || "—"}{" "}
                                · Vlr unit. {item.unitPrice} · total{" "}
                                {item.total}
                              </span>
                            </td>
                            <td className="p-2">
                              <div>{item.unit || "?"}</div>
                              <Input
                                className="mt-1 w-24"
                                aria-label={`Quantidade item ${item.sequence}`}
                                value={binding.quantity}
                                onChange={(event) =>
                                  setBindings((current) => ({
                                    ...current,
                                    [index]: {
                                      ...binding,
                                      quantity: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </td>
                            <td className="p-2">
                              <select
                                className="h-9 w-full rounded-md border bg-background px-2"
                                value={binding.productId}
                                disabled={binding.exclude}
                                onChange={(event) =>
                                  setBindings((current) => ({
                                    ...current,
                                    [index]: {
                                      ...binding,
                                      productId: event.target.value,
                                    },
                                  }))
                                }
                              >
                                <option value="">Vincular produto…</option>
                                {catalog.products.data?.map((product) => (
                                  <option key={product.id} value={product.id}>
                                    {product.name} · {product.sku} ·{" "}
                                    {product.unit}
                                  </option>
                                ))}
                              </select>
                              {!binding.exclude && !binding.productId && (
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
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={binding.exclude}
                                  onChange={(event) =>
                                    setBindings((current) => ({
                                      ...current,
                                      [index]: {
                                        ...binding,
                                        exclude: event.target.checked,
                                      },
                                    }))
                                  }
                                />
                                Não importar
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {hasTotalsDivergence && (
              <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground">
                <p role="alert">
                  Os itens extraídos somam{" "}
                  {Number(parsedItemsTotal).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                  , diferente do total informado (
                  {Number(invoiceAmount).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                  ). Confira o documento antes de confirmar.
                </p>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={totalsAcknowledged}
                    onChange={(event) =>
                      setTotalsAcknowledged(event.target.checked)
                    }
                  />
                  Conferi a divergência no documento fiscal.
                </label>
              </div>
            )}
            {duplicateInvoice && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
              >
                Possível duplicidade: esta nota já foi registrada nesta unidade.
                A confirmação será bloqueada.
              </p>
            )}
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Texto extraído para conferência
              </summary>
              <Textarea
                className="mt-2 max-h-48 font-mono text-xs"
                readOnly
                value={rawText}
              />
            </details>
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
            disabled={
              !extraction ||
              (extraction.usedOcr && !ocrReviewed) ||
              Boolean(
                progress &&
                progress !==
                  "Leitura concluída. Confira todos os campos antes de usar.",
              )
            }
            onClick={apply}
          >
            {progress && !extraction ? (
              <>
                <LoaderCircle className="animate-spin" /> Processando…
              </>
            ) : (
              "Usar dados conferidos"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
