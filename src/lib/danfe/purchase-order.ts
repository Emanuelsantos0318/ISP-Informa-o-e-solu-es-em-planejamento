import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 15;

export type PurchaseOrderLine = {
  sequence: number;
  orderNumber?: string | undefined;
  supplierName?: string | undefined;
  supplierCode: string;
  description: string;
  orderedQuantity: string;
  packageDescription: string;
  unitPrice: string;
  total: string;
};

export type PurchaseOrderPdf = {
  number: string;
  supplierName: string;
  isDailyReport?: boolean | undefined;
  supplierCount?: number | undefined;
  orderCount?: number | undefined;
  unitName: string;
  expectedDeliveryDate: string;
  total: string;
  pageCount: number;
  extractedText: string;
  items: PurchaseOrderLine[];
};

type PositionedText = { text: string; x: number; y: number };
type TextLine = { y: number; width: number; parts: PositionedText[] };

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

function normalizePdfNumber(value: string) {
  return value.replace(/\s/g, "").replace(/[^\d.,-]/g, "");
}

function parseDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!match) return "";
  const day = match[1] ?? "";
  const month = match[2] ?? "";
  const rawYear = match[3] ?? "";
  if (!day || !month || !rawYear) return "";
  const year = rawYear.length === 2 ? "20" + rawYear : rawYear;
  return year + "-" + month + "-" + day;
}

function joinParts(parts: PositionedText[]) {
  return parts
    .sort((a, b) => a.x - b.x)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function readColumn(line: TextLine, width: number, from: number, to: number) {
  return joinParts(
    line.parts.filter((part) => {
      const ratio = part.x / width;
      return ratio >= from && ratio < to;
    }),
  );
}

function parseDailyPurchaseOrderReport(
  lines: TextLine[],
  textPages: string[],
  pageCount: number,
): PurchaseOrderPdf {
  const items: PurchaseOrderLine[] = [];
  const groupKeys = new Set<string>();
  const supplierNames = new Set<string>();
  const reportDates = new Set<string>();
  let currentSupplier = "";
  let previousItem: PurchaseOrderLine | null = null;
  let previousItemY = 0;

  for (const line of lines) {
    const width = line.width;
    const text = joinParts([...line.parts]);
    const normalizedText = normalize(text);
    const dateText = readColumn(line, width, 0, 0.072);
    const orderNumber = readColumn(line, width, 0.072, 0.125).replace(
      /\s/g,
      "",
    );
    const isItemRow =
      /^\d{2}\/\d{2}\/\d{4}$/.test(dateText) &&
      /^\d{1,3}(?:\.\d{3})+$/.test(orderNumber);

    if (isItemRow) {
      const description = readColumn(line, width, 0.125, 0.385);
      const quantityAndPackage = readColumn(line, width, 0.55, 0.715);
      const quantityMatch = quantityAndPackage.match(/^([\d.,]+)\s*(.*)$/);
      const unitPrice = readColumn(line, width, 0.715, 0.777);
      const total = readColumn(line, width, 0.777, 0.825);
      if (!description) continue;
      const supplierName = currentSupplier || "Fornecedor não identificado";

      const groupKey = `${normalize(supplierName)}|${orderNumber}`;
      groupKeys.add(groupKey);
      supplierNames.add(supplierName);
      reportDates.add(dateText);
      const item: PurchaseOrderLine = {
        sequence: items.length + 1,
        orderNumber,
        supplierName,
        supplierCode: "",
        description,
        orderedQuantity: normalizePdfNumber(quantityMatch?.[1] ?? ""),
        packageDescription: (quantityMatch?.[2] ?? "").trim(),
        unitPrice: normalizePdfNumber(unitPrice),
        total: normalizePdfNumber(total),
      };
      items.push(item);
      previousItem = item;
      previousItemY = line.y;
      continue;
    }

    // O cabeçalho do fornecedor aparece uma vez por grupo; em quebras de
    // página, o fornecedor anterior continua valendo até o próximo título.
    const firstPart = [...line.parts].sort((a, b) => a.x - b.x)[0];
    const firstPartRatio = firstPart ? firstPart.x / width : 1;
    const isReportHeading =
      normalizedText.includes("relatorio de ordens de compra") ||
      normalizedText.includes("lbgs cd salvador") ||
      normalizedText.includes("resumo por data de entrega") ||
      normalizedText.includes("hospital geral") ||
      normalizedText.includes("periodo") ||
      normalizedText.includes("dt ent") ||
      normalizedText.includes("n oc") ||
      normalizedText.includes("contato") ||
      normalizedText.includes("analise critica") ||
      normalizedText.startsWith("data:") ||
      normalizedText === "total:";
    if (
      firstPartRatio < 0.075 &&
      !isReportHeading &&
      !/\d/.test(text) &&
      text.length >= 2 &&
      text.length <= 100
    ) {
      currentSupplier = text;
      previousItem = null;
      continue;
    }

    // Alguns nomes longos quebram para a próxima linha do PDF sem repetir a
    // data e o número da OC; anexa-se somente texto isolado na coluna Item.
    const continuation = line.parts.every((part) => {
      const ratio = part.x / width;
      return ratio >= 0.12 && ratio < 0.385;
    });
    const continuationText = readColumn(line, width, 0.12, 0.385);
    if (
      previousItem &&
      continuation &&
      continuationText &&
      Math.abs(previousItemY - line.y) <= 12
    ) {
      previousItem.description = `${previousItem.description} ${continuationText}`;
      previousItemY = line.y;
    } else if (normalizedText.includes("dt ent")) {
      previousItem = null;
    }
  }

  if (!items.length)
    throw new Error(
      "O relatório diário foi reconhecido, mas não encontrei linhas com data, número da OC e produto. Confira se o PDF segue o modelo de resumo por data de entrega.",
    );

  const extractedText = textPages.join("\n");
  const uniqueReportDates = [...reportDates];
  const dateMatch = extractedText.match(
    /(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/i,
  );
  const expectedDeliveryDate =
    dateMatch?.[1] && dateMatch[2] && dateMatch[1] === dateMatch[2]
      ? parseDate(dateMatch[1])
      : uniqueReportDates.length === 1
        ? parseDate(uniqueReportDates[0] ?? "")
        : "";
  const unitName =
    textPages
      .flatMap((page) => page.split(/\r?\n/))
      .find((line) => normalize(line).startsWith("hospital geral"))
      ?.trim() ?? "";
  const total =
    extractedText.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*total\s*:/i)?.[1] ?? "";
  const reportDate = expectedDeliveryDate
    ? expectedDeliveryDate.split("-").reverse().join("/")
    : "data não identificada";

  return {
    number: `Diária ${reportDate}`,
    supplierName: `${supplierNames.size} fornecedores no relatório`,
    isDailyReport: true,
    supplierCount: supplierNames.size,
    orderCount: groupKeys.size,
    unitName,
    expectedDeliveryDate,
    total,
    pageCount,
    extractedText,
    items,
  };
}

/** Extracts selectable text and table rows from the digital OC template. */
export async function extractPurchaseOrderPdf(
  file: File,
  onProgress?: ((message: string) => void) | undefined,
  signal?: AbortSignal | undefined,
): Promise<PurchaseOrderPdf> {
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new Error("O PDF da ordem de compra deve ter até 10 MB.");

  const header = new TextDecoder("ascii").decode(
    new Uint8Array(await file.slice(0, 1024).arrayBuffer()),
  );
  if (!header.includes("%PDF-"))
    throw new Error("O arquivo selecionado não é um PDF válido.");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    wasmUrl:
      typeof window === "undefined"
        ? undefined
        : new URL("/pdfjs/wasm/", window.location.origin).href,
  });
  const abortProcessing = () => void loadingTask.destroy();
  signal?.addEventListener("abort", abortProcessing, { once: true });

  try {
    if (signal?.aborted)
      throw new DOMException("Importação cancelada.", "AbortError");
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PAGES)
      throw new Error(`O PDF excede o limite de ${MAX_PAGES} páginas.`);

    const allLines: TextLine[] = [];
    const textPages: string[] = [];

    for (let pageNo = 1; pageNo <= document.numPages; pageNo += 1) {
      if (signal?.aborted)
        throw new DOMException("Importação cancelada.", "AbortError");
      onProgress?.(
        `Lendo texto da ordem de compra (${pageNo}/${document.numPages})…`,
      );
      const page = await document.getPage(pageNo);
      const pageLeft = page.view[0] ?? 0;
      const width = (page.view[2] ?? 0) - pageLeft;
      const content = await page.getTextContent();
      const positioned: PositionedText[] = content.items
        .filter((item) => "str" in item && item.str.trim())
        .map((item) => ({
          text: "str" in item ? item.str : "",
          x: "transform" in item ? (item.transform[4] ?? 0) - pageLeft : 0,
          y: "transform" in item ? (item.transform[5] ?? 0) : 0,
        }))
        .sort((a, b) => b.y - a.y || a.x - b.x);

      const lines: TextLine[] = [];
      for (const part of positioned) {
        let line = lines.find(
          (candidate) => Math.abs(candidate.y - part.y) < 2,
        );
        if (!line) {
          line = { y: part.y, width, parts: [] };
          lines.push(line);
        }
        line.parts.push(part);
      }
      lines.sort((a, b) => b.y - a.y);
      textPages.push(
        lines.map((line) => joinParts([...line.parts])).join("\n"),
      );

      for (const line of lines) {
        const hasRowMarker = line.parts.some(
          (part) =>
            part.x / width < 0.095 && normalize(part.text).trim() === "op",
        );
        if (hasRowMarker) allLines.push({ ...line, parts: [...line.parts] });
        else allLines.push(line);
      }
    }

    const extractedText = textPages.join("\n");
    const normalizedExtractedText = normalize(extractedText);
    if (
      normalizedExtractedText.includes("resumo por data de entrega") &&
      normalizedExtractedText.includes("ordens de compra")
    ) {
      return parseDailyPurchaseOrderReport(
        allLines,
        textPages,
        document.numPages,
      );
    }
    if (!normalize(extractedText).includes("ordem de compra"))
      throw new Error(
        "Este PDF não parece ser uma ordem de compra digital compatível. Selecione uma OC pesquisável ou use a entrada manual.",
      );

    const items: PurchaseOrderLine[] = [];
    let orderNumber = "";
    let expectedDeliveryDate = "";
    let previousItem: PurchaseOrderLine | null = null;
    let previousItemY = 0;

    for (const line of allLines) {
      const width = line.width;
      const origin = readColumn(line, width, 0, 0.095);
      if (normalize(origin).split(/\s+/).includes("op")) {
        const dateText = readColumn(line, width, 0.095, 0.17);
        const orderText = readColumn(line, width, 0.17, 0.245);
        const supplierCode = readColumn(line, width, 0.245, 0.295);
        const description = readColumn(line, width, 0.295, 0.61);
        const orderedQuantity = normalizePdfNumber(
          readColumn(line, width, 0.61, 0.69),
        );
        const packageDescription = readColumn(line, width, 0.69, 0.79);
        const prices = [
          readColumn(line, width, 0.79, 0.89),
          readColumn(line, width, 0.89, 1.1),
        ].map(normalizePdfNumber);

        if (
          !/^\d+$/.test(supplierCode.replace(/\s/g, "")) ||
          !description ||
          !orderedQuantity ||
          !packageDescription ||
          !prices[0] ||
          !prices[1]
        ) {
          previousItem = null;
          continue;
        }

        if (!orderNumber) orderNumber = orderText;
        if (!expectedDeliveryDate) expectedDeliveryDate = parseDate(dateText);
        const item: PurchaseOrderLine = {
          sequence: items.length + 1,
          supplierCode: supplierCode.replace(/\s/g, ""),
          description,
          orderedQuantity,
          packageDescription,
          unitPrice: prices[0],
          total: prices[1],
        };
        items.push(item);
        previousItem = item;
        previousItemY = line.y;
        continue;
      }

      // Nome de produto pode continuar na linha abaixo no relatório da OC.
      const continuation = readColumn(line, width, 0.295, 0.61);
      const hasOnlyDescriptionColumn = line.parts.every((part) => {
        const ratio = part.x / width;
        return ratio >= 0.295 && ratio < 0.61;
      });
      if (
        previousItem &&
        hasOnlyDescriptionColumn &&
        continuation &&
        Math.abs(previousItemY - line.y) <= 12
      ) {
        previousItem.description = `${previousItem.description} ${continuation}`;
        previousItemY = line.y;
      } else if (line.parts.some((part) => part.x / width < 0.1)) {
        previousItem = null;
      }
    }

    if (!items.length)
      throw new Error(
        "A OC foi identificada, mas nenhuma linha de produto pôde ser estruturada. Confira se o PDF segue o modelo digital da Viena.",
      );

    const firstHeaderLine = textPages
      .join("\n")
      .split(/\r?\n/)
      .find((line) => /fornecedor\s*:/i.test(line));
    const supplierName =
      firstHeaderLine
        ?.match(/fornecedor\s*:\s*(.+?)(?:\s+email\s*:|$)/i)?.[1]
        ?.trim() ?? "";
    const unitName =
      textPages
        .join("\n")
        .match(/unidade\s*:\s*(.+?)(?:\s+endere.{0,2}o\s*:|$)/i)?.[1]
        ?.trim() ?? "";
    const totalLine = textPages
      .join("\n")
      .split(/\r?\n/)
      .find((line) => normalize(line).includes("observacoes o.c."));
    const total = totalLine?.match(/(\d[\d.]*,\d{2})\s*$/)?.[1] ?? "";

    if (!orderNumber)
      throw new Error("Não encontrei o número da OC nas linhas de produtos.");

    return {
      number: orderNumber,
      supplierName,
      isDailyReport: false,
      unitName,
      expectedDeliveryDate,
      total,
      pageCount: document.numPages,
      extractedText,
      items: items.map((item) => ({
        ...item,
        orderNumber,
        supplierName,
      })),
    };
  } finally {
    signal?.removeEventListener("abort", abortProcessing);
    await loadingTask.destroy();
  }
}
