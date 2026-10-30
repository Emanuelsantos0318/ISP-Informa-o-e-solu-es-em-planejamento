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
  ocrProvider: "text" | "tesseract" | "google-vision";
  visionAttempted: boolean;
  visionWarning: string | null;
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

type OcrWordPosition = {
  text: string;
  bbox: { x0: number; x1: number; y0: number; y1: number };
};

export type DanfeVisionPage = {
  text: string;
  width: number;
  height: number;
  words: OcrWordPosition[];
};

export type DanfeVisionRecognizer = (
  imageBase64: string,
  signal: AbortSignal,
) => Promise<DanfeVisionPage>;

function reconstructPositionedWords(
  words: OcrWordPosition[],
  imageHeight: number,
): string {
  const positioned = words
    .filter((word) => word.text.trim())
    .map((word) => ({
      text: word.text.trim(),
      x: word.bbox.x0,
      y: (word.bbox.y0 + word.bbox.y1) / 2,
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const tolerance = Math.max(5, Math.min(16, imageHeight * 0.004));
  const rows: { y: number; words: typeof positioned }[] = [];
  for (const word of positioned) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - word.y) <= tolerance) {
      row.words.push(word);
      row.y =
        row.words.reduce((sum, part) => sum + part.y, 0) / row.words.length;
    } else {
      rows.push({ y: word.y, words: [word] });
    }
  }

  return rows
    .map((row) =>
      row.words
        .sort((a, b) => a.x - b.x)
        .map((word) => word.text)
        .join(" "),
    )
    .join("\n");
}

/** Junta palavras pela posição vertical quando OCR lê cada coluna como bloco separado. */
function reconstructOcrRows(
  data: {
    blocks: Array<{
      paragraphs: Array<{ lines: Array<{ words: OcrWordPosition[] }> }>;
    }> | null;
  },
  imageHeight: number,
): string {
  const words = (data.blocks ?? [])
    .flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.flatMap((line) => line.words),
      ),
    )
    .filter((word) => word.text.trim())
    .map((word) => ({
      text: word.text,
      bbox: word.bbox,
    }));
  return reconstructPositionedWords(words, imageHeight);
}

export function parseDanfeText(
  text: string,
  options: {
    usedOcr?: boolean | undefined;
    itemText?: string | undefined;
  } = {},
): Omit<
  DanfeExtraction,
  "pageCount" | "usedOcr" | "ocrProvider" | "visionAttempted" | "visionWarning"
> {
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
        /^(?:(\d{1,8}(?:[.,]\d{1,3})?)\s+)?(.+?)\s+(\d{8})\s+\d{2,4}\s+([1-7]\d{3})\s+([A-Z]{1,5})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)(?=$|\s|[^\d.,A-Z])/i,
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
  recognizeWithVision?: DanfeVisionRecognizer | undefined,
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
        page.trim().length < 40 || parseDanfeText(page).items.length < 4,
    );
    let itemText = "";
    let usedVision = false;
    let visionAttempted = false;
    let visionWarning: string | null = null;
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
          // OCR text). Keep it only when it gives us a useful set of product
          // rows; a couple of accidental matches must not suppress image OCR.
          if (
            searchableText.trim().length >= 40 &&
            searchableItems.length >= 4
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
          const fullPage = await worker.recognize(canvas, {}, { blocks: true });
          const fullPositionedText = reconstructOcrRows(
            fullPage.data,
            canvas.height,
          );
          let pageText = `${fullPage.data.text}\n${fullPositionedText}`;
          const fullPageItems = parseDanfeText(pageText, {
            usedOcr: true,
          }).items;
          let bestItemText = pageText;
          let bestItemCount = fullPageItems.length;
          let bestConfidence = fullPage.data.confidence;
          let bestScore = fullPageItems.length * 100 + fullPage.data.confidence;

          // DANFE item rows are a small, dense table. Run a second pass over
          // the broad content area at print resolution; comparing row count
          // and Tesseract confidence avoids trusting a weak whole-page pass.
          // DANFEs vary in where the item table starts. This broad crop
          // includes the first product rows on continuation pages.
          const tableCanvas = document.createElement("canvas");
          const tableStartY = Math.floor(canvas.height * 0.12);
          tableCanvas.width = canvas.width;
          tableCanvas.height = Math.ceil(canvas.height * 0.8);
          const tableContext = tableCanvas.getContext("2d");
          if (tableContext) {
            tableContext.drawImage(
              canvas,
              0,
              tableStartY,
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
            const tableResult = await worker.recognize(
              tableCanvas,
              {},
              { blocks: true },
            );
            const tablePositionedText = reconstructOcrRows(
              tableResult.data,
              tableCanvas.height,
            );
            const tableText = `${tableResult.data.text}\n${tablePositionedText}`;
            const tableItems = parseDanfeText(tableText, {
              usedOcr: true,
            }).items;
            const tableScore =
              tableItems.length * 100 + tableResult.data.confidence;
            if (tableScore > bestScore) {
              bestItemText = tableText;
              bestItemCount = tableItems.length;
              bestConfidence = tableResult.data.confidence;
              bestScore = tableScore;
              pageText = `${pageText}\n${tableText}`;
            }
          }
          tableCanvas.width = 0;
          tableCanvas.height = 0;

          // Usa OCR externo apenas quando o OCR local não estruturou a tabela.
          if (
            recognizeWithVision &&
            (bestItemCount < 4 || bestConfidence < 40)
          ) {
            visionAttempted = true;
            onProgress?.(
              `A leitura local reconheceu poucos itens. Enviando a página ${pageNo} ao Google Cloud Vision…`,
            );
            try {
              if (signal?.aborted)
                throw new DOMException("Importação cancelada.", "AbortError");
              const imageData = canvas.toDataURL("image/jpeg", 0.82);
              const imageBase64 = imageData.slice(imageData.indexOf(",") + 1);
              const visionPage = await recognizeWithVision(
                imageBase64,
                signal ?? new AbortController().signal,
              );
              const visionText = `${visionPage.text}\n${reconstructPositionedWords(visionPage.words, visionPage.height)}`;
              const visionItemCount = parseDanfeText(visionText, {
                usedOcr: true,
              }).items.length;
              if (
                visionItemCount > bestItemCount ||
                (bestItemCount < 4 && visionText.trim().length > 80)
              ) {
                bestItemText = visionText;
                bestItemCount = visionItemCount;
                pageText = `${pageText}\n${visionPage.text}`;
                usedVision = true;
              }
            } catch (error) {
              if (signal?.aborted)
                throw new DOMException("Importação cancelada.", "AbortError");
              onProgress?.(
                `O OCR externo não ficou disponível nesta página; mantive a leitura local. ${error instanceof Error ? error.message : ""}`,
              );
              visionWarning =
                error instanceof Error
                  ? error.message
                  : "O OCR externo não ficou disponível; confira a leitura local manualmente.";
            }
          }
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
      ocrProvider: usedVision
        ? "google-vision"
        : usedOcr
          ? "tesseract"
          : "text",
      visionAttempted,
      visionWarning,
    };
  } finally {
    signal?.removeEventListener("abort", abortProcessing);
    await loadingTask.destroy();
  }
}
