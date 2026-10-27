import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const DANFE_MAX_BYTES = 10 * 1024 * 1024;
export const DANFE_MAX_PAGES = 15;

export type DanfeItem = {
  sequence: string;
  supplierCode: string;
  description: string;
  ncm: string;
  cfop: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  total: string;
  barcode: string;
};

export type DanfeExtraction = {
  text: string;
  pageCount: number;
  usedOcr: boolean;
  accessKey: string;
  invoiceNumber: string;
  series: string;
  issueDate: string;
  supplierName: string;
  supplierCnpj: string;
  supplierTradeName: string;
  supplierStateRegistration: string;
  supplierAddress: string;
  supplierCity: string;
  supplierState: string;
  supplierPostalCode: string;
  supplierPhone: string;
  supplierEmail: string;
  invoiceTotal: string;
  items: DanfeItem[];
};

const emptyFields = {
  accessKey: "",
  invoiceNumber: "",
  series: "",
  issueDate: "",
  supplierName: "",
  supplierCnpj: "",
  supplierTradeName: "",
  supplierStateRegistration: "",
  supplierAddress: "",
  supplierCity: "",
  supplierState: "",
  supplierPostalCode: "",
  supplierPhone: "",
  supplierEmail: "",
  invoiceTotal: "",
};

export function parseDanfeText(
  text: string,
  options: {
    usedOcr?: boolean | undefined;
    itemText?: string | undefined;
  } = {},
): Omit<DanfeExtraction, "pageCount" | "usedOcr"> {
  const searchable = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const keyCandidate = searchable.match(
    /CHAVE\s+DE\s+ACESSO[^\d]{0,20}((?:\d[\s.]*){44})/i,
  )?.[1];
  const accessKey =
    keyCandidate?.replace(/\D/g, "") ?? text.match(/\d{44}/)?.[0] ?? "";
  const invoiceNumberMatch = searchable.match(
    /(?:NOTA FISCAL ELETRONICA|NUMERO DA NOTA)\D{0,8}(\d{1,12})|\bN\D{0,3}(\d{1,12})/i,
  );
  const invoiceNumber =
    invoiceNumberMatch?.[1] ?? invoiceNumberMatch?.[2] ?? "";
  const series = searchable.match(/SERIE\s*[-:]?\s*(\d{1,4})/i)?.[1] ?? "";
  const dateMatch = searchable.match(
    /(?:DATA\s+DA\s+EMISSAO|EMISSAO)\D{0,24}(\d{2})[/.](\d{2})[/.](\d{4})/i,
  );
  const issueDate = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    : "";
  const issuerSection =
    searchable.split(/DESTINATARIO\s*\/\s*REMETENTE/i)[0] ?? searchable;
  const issuerHeaderBlock =
    issuerSection.match(
      /IDENTIFICACAO\s+DO\s+EMITENTE\s*:?([\s\S]{0,600})/i,
    )?.[1] ?? "";
  const supplierCnpj =
    issuerSection
      .match(
        /(?:CNPJ(?:\s*\/\s*CPF)?|CPF)\s*[-:]?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i,
      )?.[1]
      ?.replace(/\D/g, "") ?? "";
  const issuerHeaderLines = issuerHeaderBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const labeledIssuerName = issuerHeaderBlock.match(
    /(?:NOME\/RAZAO\s+SOCIAL|RAZAO\s+SOCIAL)\s*[-:]?\s*([^\n]{3,140})/i,
  )?.[1];
  const headerNameLine =
    labeledIssuerName ??
    issuerHeaderLines.find(
      (line) =>
        !/^(?:CNPJ|CPF|IE|INSCRICAO|ENDERECO|FONE|TELEFONE|NOME\s+FANTASIA|DANFE|DOCUMENTO)/i.test(
          line,
        ),
    );
  const receiptName = issuerSection.match(
    /RECEBEMOS\s+DE\s+([^\n]{3,140})/i,
  )?.[1];
  const supplierNameCandidate = headerNameLine ?? receiptName ?? "";
  const supplierName = supplierNameCandidate
    .replace(/\bOS\s+PRODUTOS\b.*$/i, "")
    .replace(
      /\b(?:CNPJ(?:\/CPF)?|CPF|DATA\s+DA\s+EMISSAO|INSCRICAO\s+ESTADUAL|ENDERECO)\b.*$/i,
      "",
    )
    .replace(/^[\s:|.-]+|[\s:|.-]+$/g, "")
    .trim();
  const supplierTradeName =
    issuerSection
      .match(/NOME\s+FANTASIA\s*[-:]?\s*([^\n]{2,100})/i)?.[1]
      ?.trim() ?? "";
  const supplierStateRegistration =
    issuerSection.match(
      /(?:INSCRICAO\s+ESTADUAL|I\.E\.)\s*[-:]?\s*([\w./-]{2,24})/i,
    )?.[1] ?? "";
  const supplierAddress =
    issuerSection
      .match(/(?:ENDERECO|LOGRADOURO)\s*[-:]?\s*([^\n]{3,180})/i)?.[1]
      ?.trim() ?? "";
  const supplierCity =
    issuerSection.match(/MUNICIPIO\s*[-:]?\s*([^\n,]{2,80})/i)?.[1]?.trim() ??
    "";
  const supplierState =
    issuerSection.match(/\bUF\s*[-:]?\s*([A-Z]{2})\b/i)?.[1] ?? "";
  const supplierPostalCode =
    issuerSection
      .match(/(?:CEP\s*[-:]?\s*)?(\d{5}-?\d{3})/i)?.[1]
      ?.replace(/\D/g, "") ?? "";
  const supplierPhone =
    issuerSection
      .match(/(?:FONE|FONE\/FAX|TELEFONE)\s*[-:]?\s*([\d ()+.-]{8,24})/i)?.[1]
      ?.trim() ?? "";
  const supplierEmail =
    issuerSection.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const totalMatch = searchable.match(
    /(?:VALOR TOTAL DA NOTA|VALOR TOTAL\s*[:-]?)\s*R?\$?\s*([\d.]+,\d{2})/i,
  );
  const invoiceTotal = totalMatch?.[1] ?? "";

  const items: DanfeItem[] = [];
  const seenOcrItems = new Set<string>();
  const itemSource = options.itemText ?? text;
  for (const line of itemSource.split(/\r?\n/)) {
    if (options.usedOcr) {
      const normalizedLine = line
        .replace(/[|]/g, " ")
        .replace(/[()[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const ocrRow = normalizedLine.match(
        /^(?:(\d{1,8})\s+)?(.+?)\s+(\d{8})\s+\d{2,4}\s+([12567]\d{3})\s+([A-Z]{1,5})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)(?=$|\s|[^\d.,A-Z])/i,
      );
      if (ocrRow) {
        const item: DanfeItem = {
          sequence: String(items.length + 1),
          supplierCode: ocrRow[1] ?? "",
          description: (ocrRow[2] ?? "").trim(),
          ncm: ocrRow[3] ?? "",
          cfop: ocrRow[4] ?? "",
          unit: (ocrRow[5] ?? "").toUpperCase(),
          quantity: ocrRow[6] ?? "",
          unitPrice: ocrRow[7] ?? "",
          total: ocrRow[8] ?? "",
          barcode: "",
        };
        const duplicateKey = [
          item.supplierCode,
          item.description,
          item.ncm,
          item.cfop,
          item.unit,
          item.quantity,
          item.unitPrice,
          item.total,
        ]
          .join("|")
          .toLocaleLowerCase("pt-BR");
        if (!seenOcrItems.has(duplicateKey)) {
          items.push(item);
          seenOcrItems.add(duplicateKey);
        }
        continue;
      }
    }

    // Conservative candidate parser for common DANFE item-table text layouts.
    const match = line
      .trim()
      .match(
        /^(\d{1,3})\s+([\w./-]{1,30})\s+(.+?)\s+(\d{4,8})\s+\d{3,4}\s+(\d{4})\s+([A-Z]{1,4})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i,
      );
    if (!match) continue;
    items.push({
      sequence: match[1] ?? "",
      supplierCode: match[2] ?? "",
      description: (match[3] ?? "").trim(),
      barcode: "",
      ncm: match[4] ?? "",
      cfop: match[5] ?? "",
      unit: (match[6] ?? "").toUpperCase(),
      quantity: match[7] ?? "",
      unitPrice: match[8] ?? "",
      total: match[9] ?? "",
    });
  }
  return {
    text,
    ...emptyFields,
    accessKey,
    invoiceNumber,
    series,
    issueDate,
    supplierName,
    supplierCnpj,
    supplierTradeName,
    supplierStateRegistration,
    supplierAddress,
    supplierCity,
    supplierState,
    supplierPostalCode,
    supplierPhone,
    supplierEmail,
    invoiceTotal,
    items,
  };
}

export async function extractDanfePdf(
  file: File,
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<DanfeExtraction> {
  if (file.size <= 0 || file.size > DANFE_MAX_BYTES) {
    throw new Error("O PDF deve ter até 10 MB.");
  }
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const header = new TextDecoder("ascii").decode(bytes);
  if (!header.includes("%PDF-"))
    throw new Error("O arquivo não é um PDF válido.");

  let pdfDocument: pdfjs.PDFDocumentProxy;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    wasmUrl:
      typeof window === "undefined"
        ? undefined
        : new URL("/pdfjs/wasm/", window.location.origin).href,
  });
  let terminateOcrWorker: (() => Promise<unknown>) | null = null;
  const abortProcessing = () => {
    void loadingTask.destroy();
    void terminateOcrWorker?.();
  };
  signal?.addEventListener("abort", abortProcessing, { once: true });
  try {
    if (signal?.aborted)
      throw new DOMException("Importação cancelada.", "AbortError");
    pdfDocument = await loadingTask.promise;
  } catch {
    signal?.removeEventListener("abort", abortProcessing);
    if (signal?.aborted)
      throw new DOMException("Importação cancelada.", "AbortError");
    throw new Error(
      "Não foi possível abrir o PDF. Verifique se está íntegro e sem senha.",
    );
  }
  if (pdfDocument.numPages > DANFE_MAX_PAGES) {
    signal?.removeEventListener("abort", abortProcessing);
    await loadingTask.destroy();
    throw new Error(`O PDF excede o limite de ${DANFE_MAX_PAGES} páginas.`);
  }

  const pages: string[] = [];
  try {
    for (let pageNo = 1; pageNo <= pdfDocument.numPages; pageNo += 1) {
      if (signal?.aborted)
        throw new DOMException("Importação cancelada.", "AbortError");
      onProgress?.(
        `Lendo texto da página ${pageNo} de ${pdfDocument.numPages}…`,
      );
      const page = await pdfDocument.getPage(pageNo);
      const content = await page.getTextContent();
      const positioned = content.items
        .filter((item) => "str" in item)
        .map((item) => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
        }))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: { y: number; parts: string[] }[] = [];
      for (const item of positioned) {
        let line = lines.find(
          (candidate) => Math.abs(candidate.y - item.y) < 2,
        );
        if (!line) {
          line = { y: item.y, parts: [] };
          lines.push(line);
        }
        line.parts.push(item.text);
      }
      pages.push(lines.map((line) => line.parts.join(" ")).join("\n"));
    }
    let text = pages.join("\n");
    const usedOcr = pages.some(
      (page) =>
        page.trim().length < 40 || parseDanfeText(page).items.length === 0,
    );
    let itemText = "";
    if (usedOcr) {
      onProgress?.(
        "O PDF parece digitalizado. Iniciando OCR local em português…",
      );
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("por", undefined, {
        langPath: new URL("/tesseract/", window.location.origin).href,
        workerPath: new URL("/tesseract/worker.min.js", window.location.origin)
          .href,
        corePath: new URL(
          "/tesseract/tesseract-core-lstm.wasm.js",
          window.location.origin,
        ).href,
        workerBlobURL: false,
        logger: (event) => {
          if (event.status === "recognizing text")
            onProgress?.(`OCR: ${Math.round(event.progress * 100)}%`);
        },
      });
      let ocrWorkerTerminated = false;
      const terminateWorker = () => {
        if (ocrWorkerTerminated) return Promise.resolve();
        ocrWorkerTerminated = true;
        return worker.terminate();
      };
      terminateOcrWorker = terminateWorker;
      try {
        const recognized: string[] = [];
        for (let pageNo = 1; pageNo <= pdfDocument.numPages; pageNo += 1) {
          if (signal?.aborted)
            throw new DOMException("Importação cancelada.", "AbortError");
          const searchableText = pages[pageNo - 1] ?? "";
          const searchableItems = parseDanfeText(searchableText).items;
          // A hidden text layer can contain only the DANFE header (or broken
          // OCR text). Keep it only when it gives us at least one product row.
          if (
            searchableText.trim().length >= 40 &&
            searchableItems.length > 0
          ) {
            recognized.push(searchableText);
            itemText += `${searchableText}\n`;
            continue;
          }
          onProgress?.(
            `Preparando OCR da página ${pageNo} de ${pdfDocument.numPages}…`,
          );
          const page = await pdfDocument.getPage(pageNo);
          // DANFE tables are often printed in very small type. Render near
          // print resolution so OCR can distinguish quantities and prices.
          // 300 dpi is a better target for the small type used in product
          // tables. Render pages one at a time so the higher resolution does
          // not multiply memory use for multi-page invoices.
          const viewport = page.getViewport({ scale: 300 / 72 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context)
            throw new Error(
              "O navegador não conseguiu preparar a página para OCR.",
            );
          await page.render({ canvasContext: context, canvas, viewport })
            .promise;
          await worker.setParameters({
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
            tessedit_pageseg_mode: PSM.AUTO,
          });
          const fullPage = await worker.recognize(canvas);
          let pageText = fullPage.data.text;
          const fullPageItems = parseDanfeText(pageText, {
            usedOcr: true,
          }).items;
          let bestItemText = pageText;
          let bestItemCount = fullPageItems.length;
          let bestScore = fullPageItems.length * 100 + fullPage.data.confidence;

          // DANFE item rows are a small, dense table. Run a second pass over
          // the lower page at the same print resolution; comparing row count
          // and Tesseract confidence avoids trusting a weak whole-page pass.
          const tableCanvas = document.createElement("canvas");
          tableCanvas.width = canvas.width;
          tableCanvas.height = Math.ceil(canvas.height * 0.68);
          const tableContext = tableCanvas.getContext("2d");
          if (tableContext) {
            tableContext.drawImage(
              canvas,
              0,
              Math.floor(canvas.height * 0.32),
              canvas.width,
              tableCanvas.height,
              0,
              0,
              tableCanvas.width,
              tableCanvas.height,
            );
            await worker.setParameters({
              preserve_interword_spaces: "1",
              user_defined_dpi: "300",
              tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
            });
            const tableResult = await worker.recognize(tableCanvas);
            const tableItems = parseDanfeText(tableResult.data.text, {
              usedOcr: true,
            }).items;
            const tableScore =
              tableItems.length * 100 + tableResult.data.confidence;
            if (tableScore > bestScore) {
              bestItemText = tableResult.data.text;
              bestItemCount = tableItems.length;
              bestScore = tableScore;
              pageText = `${pageText}\n${tableResult.data.text}`;
            }
          }
          tableCanvas.width = 0;
          tableCanvas.height = 0;
          itemText += `${bestItemText}\n`;
          onProgress?.(
            `OCR da página ${pageNo}: ${bestItemCount} item(ns) estruturados.`,
          );
          recognized.push(pageText);
          canvas.width = 0;
          canvas.height = 0;
        }
        text = recognized.join("\n");
      } finally {
        await terminateWorker();
      }
    }
    if (!text.trim())
      throw new Error("Não foi encontrado texto legível no PDF.");
    return {
      ...parseDanfeText(text, {
        usedOcr,
        itemText: usedOcr ? itemText : undefined,
      }),
      pageCount: pdfDocument.numPages,
      usedOcr,
    };
  } finally {
    signal?.removeEventListener("abort", abortProcessing);
    await loadingTask.destroy();
  }
}
