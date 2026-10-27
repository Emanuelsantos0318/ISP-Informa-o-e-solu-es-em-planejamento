import { describe, expect, it } from "vitest";
import {
  DANFE_MAX_BYTES,
  DANFE_MAX_PAGES,
  parseDanfeText,
} from "@/lib/danfe/extract";

describe("DANFE parser", () => {
  it("extracts invoice metadata only when present and keeps source text", () => {
    const accessKey = "35261012345678000123550010000012341000012345";
    const text = `CHAVE DE ACESSO ${accessKey}\nNOTA FISCAL ELETRÔNICA Nº 1234\nSÉRIE 1\nDATA DA EMISSÃO 23/10/2026\nCNPJ: 12.345.678/0001-23\nVALOR TOTAL DA NOTA R$ 1.234,56`;
    const result = parseDanfeText(text);

    expect(result.accessKey).toBe(accessKey);
    expect(result.invoiceNumber).toBe("1234");
    expect(result.series).toBe("1");
    expect(result.issueDate).toBe("2026-10-23");
    expect(result.supplierCnpj).toBe("12345678000123");
    expect(result.invoiceTotal).toBe("1.234,56");
    expect(result.text).toBe(text);
  });

  it("leaves missing fields empty instead of inventing values", () => {
    const result = parseDanfeText("Documento parcial sem dados reconhecíveis");
    expect(result.accessKey).toBe("");
    expect(result.invoiceNumber).toBe("");
    expect(result.items).toEqual([]);
  });

  it("parses a recognizable item row while keeping decimal text for review", () => {
    const result = parseDanfeText(
      "1 ABC001 Arroz tipo 1 10063021 000 5102 KG 2,000 5,50 11,00",
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sequence: "1",
      supplierCode: "ABC001",
      description: "Arroz tipo 1",
      unit: "KG",
      quantity: "2,000",
      unitPrice: "5,50",
      total: "11,00",
    });
  });

  it("parses scanned DANFE rows with OCR separators and a single product code", () => {
    const result = parseDanfeText(
      "112 DIBEN 1.5 KCAL HP 500ML 21069080 [220 [5102 | UN 15 48,67 730,05 429,44",
      { usedOcr: true },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sequence: "1",
      supplierCode: "112",
      description: "DIBEN 1.5 KCAL HP 500ML",
      ncm: "21069080",
      cfop: "5102",
      unit: "UN",
      quantity: "15",
      unitPrice: "48,67",
      total: "730,05",
    });
  });

  it("keeps an OCR row when the leading product code is unreadable", () => {
    const result = parseDanfeText(
      "“Tes DIBEN 7.5 KCAL HP 1000ML 21069080 (220 [5102 | UN 10 73,27 782,70 431,00",
      { usedOcr: true },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      supplierCode: "",
      description: "“Tes DIBEN 7.5 KCAL HP 1000ML",
      quantity: "10",
      unitPrice: "73,27",
      total: "782,70",
    });
  });

  it("sets conservative processing limits", () => {
    expect(DANFE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(DANFE_MAX_PAGES).toBe(15);
  });
});
