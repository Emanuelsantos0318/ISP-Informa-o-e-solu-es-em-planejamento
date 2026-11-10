/** Candidate histórico de polpa: o texto e os valores originais são preservados. */
export type PulpImportCandidate = {
  record_type: "pulp";
  source_sheet: string;
  source_cell: string;
  source_range: string;
  source_date: string | null;
  date_source: "explicit" | "formula_cache" | "inherited_from_block" | "missing";
  audience_code: "patient" | "server";
  service_code: string;
  flavor_text: string;
  quantity: number | null;
  quantity_unit: string;
};

/** Linha de mapa com colunas explícitas de preparação, proteína, volume e KG total. */
export type ProteinMapImportCandidate = {
  record_type: "protein_map";
  source_sheet: string;
  source_cell: string;
  source_range: string;
  source_date: string | null;
  date_source: "explicit" | "formula_cache" | "inherited_from_block" | "missing";
  audience_code: "patient" | "server";
  meal_code: string;
  preparation: string;
  product_text: string;
  cached_quantity: number | null;
  quantity_unit: "KG";
  date_conflict: string | null;
};

const normalizeLabel = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleUpperCase("pt-BR")
  .trim();

function valueAndFormula(value: unknown): { value: unknown; formula: boolean } {
  if (typeof value !== "object" || value === null) return { value, formula: false };
  const record = value as Record<string, unknown>;
  if ("formula" in record || "sharedFormula" in record) {
    return { value: record["result"] ?? null, formula: true };
  }
  if ("result" in record) return { value: record["result"] ?? null, formula: true };
  return { value, formula: false };
}

function asDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return value.slice(0, 10);
  return null;
}

function cellAddress(row: number, column: number) {
  let number = column;
  let letters = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    number = Math.floor((number - 1) / 26);
  }
  return `${letters}${row}`;
}

/** Reconhece apenas as tabelas diárias DATA/SABOR/KG da aba POLPA. */
export function extractPulpCandidates(
  sheetName: string,
  rowCount: number,
  readCell: (row: number, column: number) => unknown,
): PulpImportCandidate[] {
  if (!normalizeLabel(sheetName).includes("POLPA")) return [];
  const candidates: PulpImportCandidate[] = [];
  const blocks = [
    { dateColumn: 1, flavorColumn: 2, amountColumn: 3 },
    { dateColumn: 5, flavorColumn: 6, amountColumn: 7 },
  ];
  const mealCodes: Record<string, string> = {
    DESJEJUM: "breakfast",
    COLACAO: "morning_snack",
    ALMOCO: "lunch",
    LANCHE: "afternoon_snack",
    JANTAR: "dinner",
    CEIA: "supper",
  };

  for (const block of blocks) {
    let audience: "patient" | "server" | null = null;
    let service: string | null = null;
    let currentDate: string | null = null;
    let currentDateSource: PulpImportCandidate["date_source"] = "missing";

    for (let row = 1; row <= rowCount; row += 1) {
      const title = valueAndFormula(readCell(row, block.dateColumn)).value;
      const titleText = typeof title === "string" ? normalizeLabel(title) : "";
      if (titleText.includes("PLANEJAMENTO POLPA") && titleText.includes("SERVIDOR")) {
        audience = "server";
        service = null;
        currentDate = null;
        continue;
      }
      if (titleText.includes("PLANEJAMENTO POLPA") && titleText.includes("PACIENTE")) {
        audience = "patient";
        service = null;
        currentDate = null;
        continue;
      }

      const header = valueAndFormula(readCell(row, block.flavorColumn)).value;
      const headerText = typeof header === "string" ? normalizeLabel(header) : "";
      const serviceLabel = headerText.match(/^SABOR\s*[-–:]\s*(.+)$/)?.[1];
      if (serviceLabel && mealCodes[serviceLabel]) {
        service = mealCodes[serviceLabel]!;
        currentDate = null;
        currentDateSource = "missing";
        continue;
      }
      if (headerText === "SABOR" && mealCodes[normalizeLabel(String(readCell(row, block.flavorColumn + 1) ?? ""))]) {
        service = mealCodes[normalizeLabel(String(readCell(row, block.flavorColumn + 1) ?? ""))]!;
        currentDate = null;
        currentDateSource = "missing";
        continue;
      }
      const dateHeader = normalizeLabel(String(valueAndFormula(readCell(row, block.dateColumn)).value ?? ""));
      const qtyHeader = normalizeLabel(String(valueAndFormula(readCell(row, block.amountColumn)).value ?? ""));
      if (dateHeader === "DATA" && qtyHeader === "KG") {
        currentDate = null;
        currentDateSource = "missing";
        continue;
      }

      const dateCell = valueAndFormula(readCell(row, block.dateColumn));
      const rowDate = asDate(dateCell.value);
      if (rowDate) {
        currentDate = rowDate;
        currentDateSource = dateCell.formula ? "formula_cache" : "explicit";
      }

      const flavorResult = valueAndFormula(readCell(row, block.flavorColumn)).value;
      const flavor = typeof flavorResult === "string" ? flavorResult.trim() : "";
      if (!flavor || !audience || !service) continue;
      const normalizedFlavor = normalizeLabel(flavor);
      if (normalizedFlavor === "KG" || normalizedFlavor === "DATA" || normalizedFlavor.startsWith("SABOR")) continue;
      const amountCell = valueAndFormula(readCell(row, block.amountColumn));
      const quantity = typeof amountCell.value === "number" && Number.isFinite(amountCell.value) && amountCell.value >= 0
        ? amountCell.value
        : null;
      const dateSource = currentDate
        ? rowDate ? currentDateSource : "inherited_from_block"
        : "missing";
      candidates.push({
        record_type: "pulp",
        source_sheet: sheetName,
        source_cell: cellAddress(row, block.flavorColumn),
        source_range: `${cellAddress(row, block.dateColumn)}:${cellAddress(row, block.amountColumn)}`,
        source_date: currentDate,
        date_source: dateSource,
        audience_code: audience,
        service_code: service,
        flavor_text: flavor.slice(0, 120),
        quantity,
        quantity_unit: "KG",
      });
    }
  }
  return candidates;
}

/**
 * Extrai somente linhas dos mapas que têm preparação, proteína e KG total
 * explícitos. Datas ambíguas entre título e nome da aba ficam sem sugestão.
 */
export function extractProteinMapCandidates(
  sheetName: string,
  rowCount: number,
  readCell: (row: number, column: number) => unknown,
): ProteinMapImportCandidate[] {
  if (!normalizeLabel(sheetName).startsWith("MAPA")) return [];
  const title = Array.from({ length: 11 }, (_, index) => valueAndFormula(readCell(1, index + 1)).value)
    .find((value): value is string => typeof value === "string" && normalizeLabel(value).includes("MAPA")) ?? "";
  const fullDate = title.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  const shortTitleDate = title.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  const tabDate = sheetName.match(/\b(\d{1,2})-(\d{1,2})\b/);
  const titleDatePair = fullDate
    ? `${Number(fullDate[1])}-${Number(fullDate[2])}`
    : shortTitleDate ? `${Number(shortTitleDate[1])}-${Number(shortTitleDate[2])}` : null;
  const tabDatePair = tabDate ? `${Number(tabDate[1])}-${Number(tabDate[2])}` : null;
  const dateConflict = titleDatePair && tabDatePair && titleDatePair !== tabDatePair
    ? `Aba indica ${tabDatePair}; título indica ${titleDatePair}. Confirme a data real.`
    : null;
  const sourceDate = !dateConflict && fullDate
    ? `${fullDate[3]}-${String(fullDate[2]).padStart(2, "0")}-${String(fullDate[1]).padStart(2, "0")}`
    : null;
  const result: ProteinMapImportCandidate[] = [];
  const sections = [
    { firstColumn: 1, columns: [2, 3, 4, 5] },
    { firstColumn: 7, columns: [8, 9, 10, 11] },
  ];
  const mealPatterns: Array<[RegExp, string]> = [
    [/DESJEJUM/, "breakfast"], [/COLACAO/, "morning_snack"], [/ALMOCO/, "lunch"],
    [/LANCHE/, "afternoon_snack"], [/JANTAR/, "dinner"], [/CEIA/, "supper"],
  ];

  for (const section of sections) {
    let mealCode: string | null = null;
    let audienceCode: "patient" | "server" | null = null;
    let hasTableHeaders = false;
    for (let row = 1; row <= rowCount; row += 1) {
      const groupValue = valueAndFormula(readCell(row, section.firstColumn)).value;
      const group = typeof groupValue === "string" ? normalizeLabel(groupValue) : "";
      const mealMatch = mealPatterns.find(([pattern]) => pattern.test(group));
      if (mealMatch && (group.includes("PACIENTE") || group.includes("SERVIDOR"))) {
        const nextAudience = group.includes("PACIENTE") ? "patient" : "server";
        const isNewSection = mealCode !== mealMatch[1] || audienceCode !== nextAudience;
        if (isNewSection) {
          mealCode = mealMatch[1];
          audienceCode = nextAudience;
          hasTableHeaders = false;
          continue;
        }
      }
      const [preparationColumn, productColumn, , totalColumn] = section.columns;
      const preparationHeader = normalizeLabel(String(valueAndFormula(readCell(row, preparationColumn!)).value ?? ""));
      const productHeader = normalizeLabel(String(valueAndFormula(readCell(row, productColumn!)).value ?? ""));
      const totalHeader = normalizeLabel(String(valueAndFormula(readCell(row, totalColumn!)).value ?? ""));
      if (preparationHeader === "PREPARACAO" && productHeader.includes("PTN") && totalHeader.includes("KG")) {
        hasTableHeaders = true;
        continue;
      }
      if (!mealCode || !audienceCode || !hasTableHeaders) continue;
      const preparationValue = valueAndFormula(readCell(row, preparationColumn!)).value;
      const productValue = valueAndFormula(readCell(row, productColumn!)).value;
      const totalValue = valueAndFormula(readCell(row, totalColumn!)).value;
      const preparation = typeof preparationValue === "string" ? preparationValue.trim() : "";
      const product = typeof productValue === "string" ? productValue.trim() : "";
      if (!preparation || !product || preparation === "[object Object]" || product === "[object Object]" || normalizeLabel(preparation) === "NAO INFORMADO" || normalizeLabel(product) === "NAO INFORMADO") continue;
      const cachedQuantity = typeof totalValue === "number" && Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : null;
      result.push({
        record_type: "protein_map",
        source_sheet: sheetName,
        source_cell: cellAddress(row, preparationColumn!),
        source_range: `${cellAddress(row, section.firstColumn)}:${cellAddress(row, totalColumn!)}`,
        source_date: sourceDate,
        date_source: sourceDate ? "explicit" : "missing",
        audience_code: audienceCode,
        meal_code: mealCode,
        preparation: preparation.slice(0, 200),
        product_text: product.slice(0, 200),
        cached_quantity: cachedQuantity,
        quantity_unit: "KG",
        date_conflict: dateConflict,
      });
    }
  }
  return result;
}
