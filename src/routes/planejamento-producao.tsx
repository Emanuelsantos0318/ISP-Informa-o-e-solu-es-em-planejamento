import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  FileUp,
  LoaderCircle,
  Plus,
  Printer,
  RefreshCw,
} from "lucide-react";
import { BackendNotice } from "@/components/common/BackendNotice";
import { Field } from "@/components/common/Field";
import { PageIntro, Panel } from "@/components/common/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  allocatePulpByWeekday,
  calculateProductionEntry,
  compareProductionToStockExits,
  consolidateHortifrutiEntries,
  consolidateProductionEntries,
  consolidatePulpEntries,
  type ProductionEntry,
} from "@/lib/rules/production";
import {
  extractProteinMapCandidates,
  extractPulpCandidates,
  type ProteinMapImportCandidate,
  type PulpImportCandidate,
} from "@/lib/production-workbook";
import { calculateThawAt } from "@/lib/rules/production";
import {
  addOperationalDays,
  formatDateTime,
  formatOperationalDateLabel,
  nowInOperationalTz,
  operationalDateOfIso,
  operationalDateTimeToIso,
} from "@/lib/datetime";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useInventorySnapshot } from "@/lib/supabase/useInventorySnapshot";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";

export const Route = createFileRoute("/planejamento-producao")({
  head: () => ({
    meta: [
      { title: "Planejamento de Produção · ISP" },
      {
        name: "description",
        content:
          "Planejamento semanal de refeições, proteínas, Hortifruti, entregas, degelo e polpas.",
      },
    ],
  }),
  component: ProductionPlanningPage,
});

type PlanRow = {
  id: string;
  week_start: string;
  week_end: string;
  title: string;
  status: string;
  version: number;
};
type EntryRow = {
  id: string;
  plan_id: string;
  consumption_date: string | null;
  audience_code: "patient" | "server";
  meal_code: string;
  meal_group: string | null;
  preparation: string;
  original_product_text: string | null;
  product_id: string | null;
  per_capita: number | null;
  per_capita_unit: string | null;
  volume: number | null;
  volume_unit: string | null;
  quantity_unit: string | null;
  calculated_quantity: number | null;
  manual_quantity: number | null;
  manual_reason: string | null;
  final_quantity: number | null;
};
type RealizedExitBatchRow = {
  id: string;
  occurred_at: string;
  service_code: string | null;
};
type RealizedExitBatchItemRow = { batch_id: string; movement_id: string };
type RealizedStockMovementRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_of_measure_at_movement: string | null;
};
type DeliveryRow = {
  id: string;
  plan_id: string;
  window_id: string | null;
  label: string;
  scheduled_for: string | null;
  status: string;
  created_at: string;
};
type DeliveryWindowRow = {
  id: string;
  code: string;
  label: string;
  consumption_from: number;
  consumption_to: number;
  sequence_number: number;
};
type DeliveryItemRow = {
  id: string;
  delivery_id: string;
  product_id: string | null;
  original_product_text: string | null;
  quantity_unit: string;
  requested_quantity: number;
  received_quantity: number | null;
};
type ThawRow = {
  id: string;
  product_id: string | null;
  original_product_text: string | null;
  consumption_at: string;
  planned_thaw_at: string | null;
  lead_hours: number | null;
  quantity: number | null;
  quantity_unit: string | null;
  status: string;
};
type ThawRuleRow = {
  id: string;
  unit_id: string | null;
  product_id: string | null;
  category_id: string | null;
  label: string;
  lead_hours: number;
};
type PulpRow = {
  id: string;
  consumption_date: string | null;
  audience_code: "patient" | "server";
  service_code: string | null;
  flavor_id: string | null;
  original_flavor_text: string | null;
  quantity: number | null;
  quantity_unit: string | null;
};
type HortifrutiRow = {
  id: string;
  consumption_date: string;
  audience_code: "patient" | "server";
  service_code: string;
  product_id: string | null;
  original_product_text: string | null;
  quantity: number;
  quantity_unit: string;
  per_capita: number | null;
  per_capita_unit: string | null;
  volume: number | null;
  volume_unit: string | null;
  calculated_quantity: number | null;
  manual_quantity: number | null;
  manual_reason: string | null;
  notes: string | null;
};
type CandidateReviewRow = {
  id: string;
  source_sheet: string;
  source_cell: string;
  normalized_value: ImportCandidate;
  validation_status: string;
  issue: string | null;
  linked_record_id: string | null;
};
type RawCell = {
  source_sheet: string;
  source_cell: string;
  cell_kind: "blank" | "zero" | "value" | "formula";
  original_value: unknown;
  original_formula: string | null;
  cached_result: unknown;
  style_snapshot: unknown;
  recognized_type: string | null;
  normalized_value: unknown;
  product_id: string | null;
  issue: string | null;
  validation_status: "pending" | "needs_review";
};
type MealImportCandidate = {
  record_type: "meal";
  source_sheet: string;
  source_cell: string;
  source_range: string;
  source_date: string | null;
  date_source:
    "explicit" | "formula_cache" | "inherited_from_block" | "missing";
  audience_code: "patient" | "server";
  meal_code: string;
  preparation: string;
  product_text: string;
  per_capita: number;
  volume: number;
  cached_quantity: number | null;
  quantity_formula: string | null;
  quantity_unit: string;
};
type ImportCandidate =
  MealImportCandidate | PulpImportCandidate | ProteinMapImportCandidate;
type WeeklyReportData = {
  pulps: PulpRow[];
  hortifruti: HortifrutiRow[];
  hortifrutiTotals: ReturnType<typeof consolidateHortifrutiEntries>;
  pulpTotals: ReturnType<typeof consolidatePulpEntries>;
  pulpDeliveryTotals: ReturnType<typeof allocatePulpByWeekday>;
  deliveries: DeliveryRow[];
  deliveryItems: DeliveryItemRow[];
  thawSchedules: ThawRow[];
  proteinConsolidation: ReturnType<typeof consolidateProductionEntries>;
};
type WorkbookPreview = {
  file: File;
  hash: string;
  sheetNames: string[];
  cells: RawCell[];
  nonempty: number;
  formulaCount: number;
  formulaCacheMissing: number;
  zeros: number;
  dateSamples: string[];
  candidates: ImportCandidate[];
};

const MEALS = [
  ["breakfast", "Desjejum"],
  ["morning_snack", "Colação"],
  ["lunch", "Almoço"],
  ["afternoon_snack", "Lanche"],
  ["dinner", "Jantar"],
  ["supper", "Ceia"],
] as const;
const STOCK_SERVICE_LABEL: Record<string, string> = {
  desjejum: "Desjejum",
  colacao: "Colação",
  almoco: "Almoço",
  lanche: "Lanche",
};
const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

function localDate() {
  return nowInOperationalTz().date;
}

function addDays(date: string, amount: number) {
  return addOperationalDays(date, amount) ?? date;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date)
    return { type: "date", value: value.toISOString() };
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    value === null
  )
    return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    if ("text" in record && typeof record["text"] === "string")
      return { type: "text", value: record["text"] };
    if ("richText" in record)
      return { type: "richText", value: serializeValue(record["richText"]) };
    if ("hyperlink" in record)
      return {
        type: "hyperlink",
        value: String(record["text"] ?? record["hyperlink"]),
      };
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
  return String(value);
}

async function readWorkbook(file: File): Promise<WorkbookPreview> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const { default: ExcelJS } = await import("exceljs/dist/exceljs.min.js");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const cells: RawCell[] = [];
  let nonempty = 0;
  let formulaCount = 0;
  let formulaCacheMissing = 0;
  let zeros = 0;
  const dateSamples = new Set<string>();
  const candidates: ImportCandidate[] = [];

  for (const sheet of workbook.worksheets) {
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      for (let column = 1; column <= sheet.columnCount; column += 1) {
        const cell = sheet.getCell(row, column);
        const raw = cell.value as unknown;
        const isFormula =
          typeof raw === "object" &&
          raw !== null &&
          ("formula" in raw || "sharedFormula" in raw);
        const formulaValue = isFormula
          ? (raw as Record<string, unknown>)
          : null;
        const formula = formulaValue
          ? String(
              formulaValue["formula"] ?? formulaValue["sharedFormula"] ?? "",
            )
          : null;
        const cached = formulaValue ? formulaValue["result"] : null;
        if (raw !== null && raw !== undefined) nonempty += 1;
        if (isFormula) {
          formulaCount += 1;
          if (cached === null || cached === undefined) formulaCacheMissing += 1;
        }
        const valueToInspect = formulaValue ? cached : raw;
        if (valueToInspect === 0) zeros += 1;
        if (valueToInspect instanceof Date)
          dateSamples.add(valueToInspect.toISOString().slice(0, 10));
        if (
          typeof valueToInspect === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(valueToInspect)
        )
          dateSamples.add(valueToInspect);
        const kind: RawCell["cell_kind"] = isFormula
          ? "formula"
          : raw === null || raw === undefined
            ? "blank"
            : raw === 0
              ? "zero"
              : "value";
        cells.push({
          source_sheet: sheet.name,
          source_cell: cell.address,
          cell_kind: kind,
          original_value: isFormula ? null : serializeValue(raw),
          original_formula: formula,
          cached_result: isFormula ? serializeValue(cached) : null,
          style_snapshot: serializeValue(cell.model.style),
          recognized_type: null,
          normalized_value: null,
          product_id: null,
          issue: null,
          validation_status: "pending",
        });
      }
    }

    // Reconhece somente linhas com preparação, produto e dois valores numéricos nos blocos per capita.
    // A data pode ser herdada do bloco, mas a interface sempre exige confirmação antes da importação.
    const audience = /PACIENTE/i.test(sheet.name)
      ? "patient"
      : /SERVIDOR/i.test(sheet.name)
        ? "server"
        : null;
    if (audience) {
      const blocks = audience === "patient" ? [1] : [1, 7];
      for (const startColumn of blocks) {
        let currentDate: string | null = null;
        let currentDateSource: ImportCandidate["date_source"] = "missing";
        let currentMeal = "";
        const mealLabels: Record<string, string> = {
          DESJEJUM: "breakfast",
          COLACAO: "morning_snack",
          ALMOCO: "lunch",
          LANCHE: "afternoon_snack",
          JANTAR: "dinner",
          CEIA: "supper",
        };
        for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
          const dateCell = sheet.getCell(rowNumber, startColumn);
          const dateValue = dateCell.value as unknown;
          const dateResult =
            dateValue && typeof dateValue === "object" && "result" in dateValue
              ? (dateValue as Record<string, unknown>)["result"]
              : dateValue;
          let dateOnRow: string | null = null;
          if (
            dateResult instanceof Date &&
            Number.isFinite(dateResult.getTime())
          )
            dateOnRow = dateResult.toISOString().slice(0, 10);
          else if (
            typeof dateResult === "string" &&
            /^\d{4}-\d{2}-\d{2}/.test(dateResult)
          )
            dateOnRow = dateResult.slice(0, 10);
          if (dateOnRow) {
            currentDate = dateOnRow;
            currentDateSource =
              dateValue &&
              typeof dateValue === "object" &&
              ("formula" in dateValue || "sharedFormula" in dateValue)
                ? "formula_cache"
                : "explicit";
          }

          const preparationCell = sheet.getCell(rowNumber, startColumn + 1);
          const preparationValue = preparationCell.value as unknown;
          const preparationResult =
            preparationValue &&
            typeof preparationValue === "object" &&
            "result" in preparationValue
              ? (preparationValue as Record<string, unknown>)["result"]
              : preparationValue;
          const preparationText =
            typeof preparationResult === "string"
              ? preparationResult.trim()
              : "";
          const mealKey = preparationText
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleUpperCase("pt-BR")
            .trim();
          if (mealLabels[mealKey]) {
            currentMeal = mealLabels[mealKey];
            continue;
          }

          const productCell = sheet.getCell(rowNumber, startColumn + 2);
          const productValue = productCell.value as unknown;
          const productResult =
            productValue &&
            typeof productValue === "object" &&
            "result" in productValue
              ? (productValue as Record<string, unknown>)["result"]
              : productValue;
          const perCapitaCell = sheet.getCell(rowNumber, startColumn + 3);
          const volumeCell = sheet.getCell(rowNumber, startColumn + 4);
          const quantityCell = sheet.getCell(rowNumber, startColumn + 5);
          const perCapitaValue = perCapitaCell.value as unknown;
          const volumeValue = volumeCell.value as unknown;
          const perCapitaResult =
            perCapitaValue &&
            typeof perCapitaValue === "object" &&
            "result" in perCapitaValue
              ? (perCapitaValue as Record<string, unknown>)["result"]
              : perCapitaValue;
          const volumeResult =
            volumeValue &&
            typeof volumeValue === "object" &&
            "result" in volumeValue
              ? (volumeValue as Record<string, unknown>)["result"]
              : volumeValue;
          if (
            !preparationText ||
            typeof productResult !== "string" ||
            !productResult.trim() ||
            typeof perCapitaResult !== "number" ||
            typeof volumeResult !== "number" ||
            !currentMeal
          )
            continue;
          const quantityValue = quantityCell.value as unknown;
          const quantityRecord =
            quantityValue && typeof quantityValue === "object"
              ? (quantityValue as Record<string, unknown>)
              : null;
          const quantityResult =
            quantityRecord && "result" in quantityRecord
              ? quantityRecord["result"]
              : quantityValue;
          const quantityHeader = sheet.getCell(3, startColumn + 5).text.trim();
          const candidate: ImportCandidate = {
            record_type: "meal",
            source_sheet: sheet.name,
            source_cell: productCell.address,
            source_range: `${dateCell.address}:${quantityCell.address}`,
            source_date: currentDate,
            date_source: currentDate
              ? dateOnRow
                ? currentDateSource
                : "inherited_from_block"
              : "missing",
            audience_code: audience,
            meal_code: currentMeal,
            preparation: preparationText.slice(0, 200),
            product_text: productResult.trim().slice(0, 200),
            per_capita: perCapitaResult,
            volume: volumeResult,
            cached_quantity:
              typeof quantityResult === "number" &&
              Number.isFinite(quantityResult)
                ? quantityResult
                : null,
            quantity_formula: quantityRecord
              ? String(
                  quantityRecord["formula"] ??
                    quantityRecord["sharedFormula"] ??
                    "",
                ) || null
              : null,
            quantity_unit: quantityHeader || "",
          };
          candidates.push(candidate);
        }
      }
    }

    // Polpas têm estrutura própria de data/sabor/quantidade; só essa aba recebe
    // classificação automática e os itens continuam aguardando confirmação.
    const pulpCandidates = extractPulpCandidates(
      sheet.name,
      sheet.rowCount,
      (row, column) => sheet.getCell(row, column).value as unknown,
    );
    candidates.push(...pulpCandidates);
    const mapCandidates = extractProteinMapCandidates(
      sheet.name,
      sheet.rowCount,
      (row, column) => sheet.getCell(row, column).value as unknown,
    );
    candidates.push(...mapCandidates);
  }

  const candidateByCell = new Map(
    candidates.map((candidate) => [
      candidate.source_sheet + "!" + candidate.source_cell,
      candidate,
    ]),
  );
  for (const cell of cells) {
    const candidate = candidateByCell.get(
      cell.source_sheet + "!" + cell.source_cell,
    );
    if (candidate) {
      cell.recognized_type =
        candidate.record_type === "pulp"
          ? "pulp_candidate"
          : candidate.record_type === "protein_map"
            ? "protein_map_candidate"
            : "meal_candidate";
      cell.normalized_value = candidate;
      cell.validation_status = "needs_review";
      cell.issue = candidate.source_date
        ? "Confirme a data e os dados reconhecidos."
        : "Data não identificada; informe a data correta antes de importar.";
    }
  }
  return {
    file,
    hash,
    sheetNames: workbook.worksheets.map((sheet) => sheet.name),
    cells,
    nonempty,
    formulaCount,
    formulaCacheMissing,
    zeros,
    dateSamples: [...dateSamples].sort(),
    candidates,
  };
}

function ProductionPlanningPage() {
  const { client, profile, session } = useAuth();
  const { unitId, units } = useOperationalScope();
  const queryClient = useQueryClient();
  const inventoryQuery = useInventorySnapshot();
  const [selectedPlanId, setSelectedPlanId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("planId") ?? ""),
  );
  const [weekStart, setWeekStart] = useState(localDate());
  const [entryDate, setEntryDate] = useState(localDate());
  const [audience, setAudience] = useState<"patient" | "server">("patient");
  const [meal, setMeal] = useState<string>("lunch");
  const [mealGroup, setMealGroup] = useState("");
  const [preparation, setPreparation] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [productSearchText, setProductSearchText] = useState("");
  const [copySourcePlanId, setCopySourcePlanId] = useState("");
  const [entryFilterDate, setEntryFilterDate] = useState("all");
  const [entryFilterAudience, setEntryFilterAudience] = useState("all");
  const [entryFilterMeal, setEntryFilterMeal] = useState("all");
  const [entrySearchText, setEntrySearchText] = useState("");
  const [productId, setProductId] = useState("");
  const [originalProductText, setOriginalProductText] = useState("");
  const [perCapitaText, setPerCapitaText] = useState("");
  const [perCapitaUnit, setPerCapitaUnit] = useState("KG/PESSOA");
  const [volumeText, setVolumeText] = useState("");
  const [volumeUnit, setVolumeUnit] = useState("PESSOA");
  const [quantityUnit, setQuantityUnit] = useState("KG");
  const [manualText, setManualText] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [workbookPreview, setWorkbookPreview] =
    useState<WorkbookPreview | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedImportId, setSelectedImportId] = useState("");
  const [candidateDateDrafts, setCandidateDateDrafts] = useState<
    Record<string, string>
  >({});
  const [candidateProductDrafts, setCandidateProductDrafts] = useState<
    Record<string, string>
  >({});
  const [candidatePulpQuantityDrafts, setCandidatePulpQuantityDrafts] =
    useState<Record<string, string>>({});
  const [operationalMessage, setOperationalMessage] = useState<string | null>(
    null,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [deliveryLabel, setDeliveryLabel] = useState("Entrega de proteínas");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryWindowId, setDeliveryWindowId] = useState("");
  const [windowCode, setWindowCode] = useState("");
  const [windowLabel, setWindowLabel] = useState("");
  const [windowFrom, setWindowFrom] = useState("5");
  const [windowTo, setWindowTo] = useState("1");
  const [windowSequence, setWindowSequence] = useState("1");
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, string>>(
    {},
  );
  const [thawProductId, setThawProductId] = useState("");
  const [thawConsumptionDate, setThawConsumptionDate] = useState(localDate());
  const [thawConsumptionTime, setThawConsumptionTime] = useState("12:00");
  const [thawLeadHours, setThawLeadHours] = useState("24");
  const [thawQuantity, setThawQuantity] = useState("");
  const [thawUnit, setThawUnit] = useState("KG");
  const [thawRuleLabel, setThawRuleLabel] = useState("");
  const [thawRuleHours, setThawRuleHours] = useState("24");
  const [pulpDate, setPulpDate] = useState(localDate());
  const [pulpAudience, setPulpAudience] = useState<"patient" | "server">(
    "patient",
  );
  const [pulpService, setPulpService] = useState("colacao");
  const [pulpFlavorId, setPulpFlavorId] = useState("");
  const [pulpFlavorText, setPulpFlavorText] = useState("");
  const [pulpQuantity, setPulpQuantity] = useState("");
  const [hortifrutiDate, setHortifrutiDate] = useState(localDate());
  const [hortifrutiAudience, setHortifrutiAudience] = useState<
    "patient" | "server"
  >("patient");
  const [hortifrutiService, setHortifrutiService] = useState("lunch");
  const [hortifrutiProductId, setHortifrutiProductId] = useState("");
  const [hortifrutiOriginalName, setHortifrutiOriginalName] = useState("");
  const [hortifrutiQuantity, setHortifrutiQuantity] = useState("");
  const [hortifrutiUnit, setHortifrutiUnit] = useState("KG");
  const [hortifrutiPerCapita, setHortifrutiPerCapita] = useState("");
  const [hortifrutiPerCapitaUnit, setHortifrutiPerCapitaUnit] =
    useState("KG/PESSOA");
  const [hortifrutiVolume, setHortifrutiVolume] = useState("");
  const [hortifrutiVolumeUnit, setHortifrutiVolumeUnit] = useState("PESSOA");
  const [hortifrutiManualReason, setHortifrutiManualReason] = useState("");
  const [hortifrutiNotes, setHortifrutiNotes] = useState("");
  const [mapDate, setMapDate] = useState(localDate());
  const [mapAudienceFilter, setMapAudienceFilter] = useState("all");
  const [mapMealFilter, setMapMealFilter] = useState("all");
  const [mapProductFilter, setMapProductFilter] = useState("all");

  const plansQuery = useQuery({
    queryKey: ["production-plans", profile?.company_id, unitId],
    enabled: Boolean(client && profile && unitId),
    queryFn: async () => {
      if (!client || !profile || !unitId) return [];
      const { data, error } = await client
        .from("production_plans")
        .select("id, week_start, week_end, title, status, version")
        .eq("company_id", profile.company_id)
        .eq("unit_id", unitId)
        .order("week_start", { ascending: false })
        .order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PlanRow[];
    },
  });
  useEffect(() => {
    const first = plansQuery.data?.[0]?.id;
    if (!selectedPlanId && first) setSelectedPlanId(first);
    if (
      selectedPlanId &&
      !plansQuery.data?.some((plan) => plan.id === selectedPlanId)
    )
      setSelectedPlanId(first ?? "");
  }, [plansQuery.data, selectedPlanId]);
  const selectedPlan =
    plansQuery.data?.find((plan) => plan.id === selectedPlanId) ?? null;
  const canEditPlan = Boolean(
    selectedPlan && ["draft", "filling"].includes(selectedPlan.status),
  );
  const canReviewPlans = Boolean(
    profile && ["admin", "stock_manager", "super_admin"].includes(profile.role),
  );

  const entriesQuery = useQuery({
    queryKey: ["production-plan-entries", selectedPlanId],
    enabled: Boolean(client && selectedPlanId),
    queryFn: async () => {
      if (!client || !selectedPlanId) return [];
      const { data, error } = await client
        .from("production_plan_entries")
        .select(
          "id, plan_id, consumption_date, audience_code, meal_code, meal_group, preparation, original_product_text, product_id, per_capita, per_capita_unit, volume, volume_unit, quantity_unit, calculated_quantity, manual_quantity, manual_reason, final_quantity",
        )
        .eq("plan_id", selectedPlanId)
        .order("consumption_date")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as EntryRow[];
    },
  });
  const realizedExitBatchesQuery = useQuery({
    queryKey: [
      "production-realized-exit-batches",
      profile?.company_id,
      unitId,
      selectedPlan?.id,
    ],
    enabled: Boolean(client && profile && unitId && selectedPlan),
    queryFn: async () => {
      if (!client || !profile || !unitId || !selectedPlan) return [];
      const { data, error } = await client
        .from("stock_movement_batches")
        .select("id, occurred_at, service_code")
        .eq("company_id", profile.company_id)
        .eq("unit_id", unitId)
        .eq("movement_type", "exit")
        .gte("occurred_at", `${selectedPlan.week_start}T00:00:00-03:00`)
        .lt(
          "occurred_at",
          `${addDays(selectedPlan.week_end, 1)}T00:00:00-03:00`,
        )
        .order("occurred_at");
      if (error) throw error;
      return (data ?? []) as RealizedExitBatchRow[];
    },
  });
  const realizedBatchIds = (realizedExitBatchesQuery.data ?? []).map(
    (row) => row.id,
  );
  const realizedExitBatchItemsQuery = useQuery({
    queryKey: ["production-realized-exit-items", realizedBatchIds],
    enabled: Boolean(client && realizedBatchIds.length),
    queryFn: async () => {
      if (!client || !realizedBatchIds.length) return [];
      const { data, error } = await client
        .from("stock_movement_batch_items")
        .select("batch_id, movement_id")
        .in("batch_id", realizedBatchIds);
      if (error) throw error;
      return (data ?? []) as RealizedExitBatchItemRow[];
    },
  });
  const realizedMovementIds = (realizedExitBatchItemsQuery.data ?? []).map(
    (row) => row.movement_id,
  );
  const realizedStockMovementsQuery = useQuery({
    queryKey: ["production-realized-stock-movements", realizedMovementIds],
    enabled: Boolean(client && realizedMovementIds.length),
    queryFn: async () => {
      if (!client || !realizedMovementIds.length) return [];
      const { data, error } = await client
        .from("stock_movements")
        .select("id, product_id, quantity, unit_of_measure_at_movement")
        .in("id", realizedMovementIds)
        .eq("movement_type", "exit");
      if (error) throw error;
      return (data ?? []) as RealizedStockMovementRow[];
    },
  });
  const allProducts = useMemo(
    () => inventoryQuery.data?.products ?? [],
    [inventoryQuery.data?.products],
  );
  const products = useMemo(
    () => allProducts.filter((product) => product.active),
    [allProducts],
  );
  const hortifrutiProduct =
    products.find((product) => product.id === hortifrutiProductId) ?? null;
  const parsedHortifrutiPerCapita =
    hortifrutiPerCapita.trim() === ""
      ? null
      : Number(hortifrutiPerCapita.replace(",", "."));
  const parsedHortifrutiVolume =
    hortifrutiVolume.trim() === ""
      ? null
      : Number(hortifrutiVolume.replace(",", "."));
  const parsedHortifrutiManual =
    hortifrutiQuantity.trim() === ""
      ? null
      : Number(hortifrutiQuantity.replace(",", "."));
  const hortifrutiCalculation = calculateProductionEntry({
    productId:
      hortifrutiProduct?.id ??
      (hortifrutiOriginalName.trim() ? "manual-hortifruti" : null),
    productName: hortifrutiProduct?.name ?? hortifrutiOriginalName,
    audience: hortifrutiAudience,
    meal: hortifrutiService,
    date: hortifrutiDate,
    unit: hortifrutiUnit,
    perCapita: parsedHortifrutiPerCapita,
    perCapitaUnit: hortifrutiPerCapita.trim() ? hortifrutiPerCapitaUnit : null,
    volume: parsedHortifrutiVolume,
    volumeUnit: hortifrutiVolume.trim() ? hortifrutiVolumeUnit : null,
    manualQuantity: parsedHortifrutiManual,
    manualReason: hortifrutiQuantity.trim() ? hortifrutiManualReason : null,
  });
  const hortifrutiFormulaComplete =
    (parsedHortifrutiPerCapita === null && parsedHortifrutiVolume === null) ||
    (parsedHortifrutiPerCapita !== null && parsedHortifrutiVolume !== null);
  const hortifrutiCalculationIssues = hortifrutiCalculation.pending.filter(
    (issue) =>
      !(
        parsedHortifrutiPerCapita === null &&
        parsedHortifrutiVolume === null &&
        issue === "Preencha per capita e volume para calcular a necessidade."
      ),
  );
  const hortifrutiCanSave =
    hortifrutiFormulaComplete &&
    hortifrutiCalculation.finalQuantity !== null &&
    hortifrutiCalculationIssues.length === 0 &&
    (parsedHortifrutiPerCapita === null ||
      hortifrutiCalculation.calculatedQuantity !== null) &&
    (parsedHortifrutiManual === null || Boolean(hortifrutiManualReason.trim()));
  const selectedProduct =
    products.find((product) => product.id === productId) ?? null;
  const productSearchResults = useMemo(() => {
    const search = productSearchText.trim().toLocaleLowerCase("pt-BR");
    const matches = search
      ? products.filter((product) =>
          `${product.name} ${product.sku ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(search),
        )
      : products.slice(0, 50);
    return matches.slice(0, 50);
  }, [productSearchText, products]);
  const parsedPerCapita =
    perCapitaText.trim() === ""
      ? null
      : Number(perCapitaText.replace(",", "."));
  const parsedVolume =
    volumeText.trim() === "" ? null : Number(volumeText.replace(",", "."));
  const parsedManual =
    manualText.trim() === "" ? null : Number(manualText.replace(",", "."));
  const draftCalculation = calculateProductionEntry({
    productId: productId || null,
    productName: selectedProduct?.name ?? originalProductText,
    audience,
    meal,
    date: entryDate,
    unit: quantityUnit,
    perCapita: parsedPerCapita,
    perCapitaUnit: perCapitaText ? perCapitaUnit : null,
    volume: parsedVolume,
    volumeUnit: volumeText ? volumeUnit : null,
    manualQuantity: parsedManual,
    manualReason: manualText ? manualReason : null,
  });
  const productionEntries = useMemo<ProductionEntry[]>(
    () =>
      (entriesQuery.data ?? []).map((row) => ({
        productId: row.product_id,
        productName:
          products.find((product) => product.id === row.product_id)?.name ??
          row.original_product_text ??
          row.preparation,
        audience: row.audience_code,
        meal: row.meal_code,
        date: row.consumption_date ?? "",
        unit: row.quantity_unit ?? "",
        perCapita: row.per_capita,
        perCapitaUnit: row.per_capita_unit,
        volume: row.volume,
        volumeUnit: row.volume_unit,
        manualQuantity: row.manual_quantity,
        manualReason: row.manual_reason,
        calculatedQuantity: row.calculated_quantity,
        finalQuantity: row.final_quantity,
      })),
    [entriesQuery.data, products],
  );
  const consolidation = useMemo(
    () => consolidateProductionEntries(productionEntries),
    [productionEntries],
  );

  const createPlan = useMutation({
    mutationFn: async () => {
      if (!client || !profile || !unitId)
        throw new Error("Selecione uma unidade ativa.");
      const end = addDays(weekStart, 6);
      const { data, error } = await client
        .from("production_plans")
        .insert({
          company_id: profile.company_id,
          unit_id: unitId,
          week_start: weekStart,
          week_end: end,
          title: "Planejamento de produção " + weekStart + " a " + end,
          status: "filling",
          created_by: profile.user_id,
          updated_by: profile.user_id,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async (id) => {
      setSelectedPlanId(id);
      await queryClient.invalidateQueries({ queryKey: ["production-plans"] });
    },
  });

  const transitionPlan = useMutation({
    mutationFn: async (input: { action: string; feedback?: string }) => {
      if (!client || !selectedPlan)
        throw new Error("Selecione um planejamento semanal.");
      const { error } = await client.rpc("transition_production_plan", {
        p_plan_id: selectedPlan.id,
        p_action: input.action,
        p_feedback: input.feedback ?? null,
      });
      if (error) throw error;
      return input.action;
    },
    onSuccess: async (action) => {
      setReviewFeedback("");
      setOperationalMessage(
        action === "submit_for_review"
          ? "Planejamento enviado para revisão. Os lançamentos agora estão bloqueados até aprovação ou devolução para ajuste."
          : action === "approve"
            ? "Planejamento aprovado. A equipe responsável já pode iniciar a execução."
            : action === "request_changes"
              ? "Planejamento devolvido para ajuste. O comentário foi enviado ao autor."
              : action === "start"
                ? "Execução do planejamento iniciada."
                : "Planejamento concluído.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["production-plans"] }),
        queryClient.invalidateQueries({
          queryKey: ["production-plan-entries"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["production-notifications"],
        }),
      ]);
    },
  });

  const saveEntry = useMutation({
    mutationFn: async () => {
      if (!client || !profile || !unitId || !selectedPlan)
        throw new Error("Crie ou selecione um planejamento semanal primeiro.");
      if (!canEditPlan)
        throw new Error(
          "Este planejamento está bloqueado para edição neste estágio.",
        );
      if (!preparation.trim()) throw new Error("Informe a preparação.");
      if (!mealGroup.trim())
        throw new Error(
          "Informe o grupo ou setor da preparação para identificar a coluna UNIDADE no mapa.",
        );
      if (draftCalculation.finalQuantity === null)
        throw new Error(draftCalculation.pending.join(" "));
      const entry = {
        company_id: profile.company_id,
        unit_id: unitId,
        plan_id: selectedPlan.id,
        consumption_date: entryDate || null,
        audience_code: audience,
        meal_code: meal,
        meal_group: mealGroup.trim() || null,
        preparation: preparation.trim(),
        original_product_text: selectedProduct
          ? null
          : originalProductText.trim() || null,
        product_id: selectedProduct?.id ?? null,
        per_capita: parsedPerCapita,
        per_capita_unit: perCapitaText ? perCapitaUnit.trim() : null,
        volume: parsedVolume,
        volume_unit: volumeText ? volumeUnit.trim() : null,
        quantity_unit: quantityUnit.trim() || null,
        calculated_quantity: draftCalculation.calculatedQuantity,
        manual_quantity: parsedManual,
        manual_reason: parsedManual === null ? null : manualReason.trim(),
        updated_by: profile.user_id,
      };
      const { error } = editingEntryId
        ? await client
            .from("production_plan_entries")
            .update(entry)
            .eq("id", editingEntryId)
        : await client.from("production_plan_entries").insert({
            ...entry,
            created_by: profile.user_id,
          });
      if (error) throw error;
    },
    onSuccess: async () => {
      setPreparation("");
      setOriginalProductText("");
      setMealGroup("");
      setPerCapitaText("");
      setVolumeText("");
      setManualText("");
      setManualReason("");
      setEditingEntryId(null);
      setOperationalMessage(
        "Lançamento salvo no planejamento. O estoque não foi movimentado.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["production-plan-entries", selectedPlanId],
      });
    },
  });

  // Duplica uma semana de referência apenas para um plano vazio e remapeia as datas.
  const copyPlanEntries = useMutation({
    mutationFn: async () => {
      if (!client || !profile || !unitId || !selectedPlan)
        throw new Error("Selecione o planejamento que receberá a cópia.");
      if (!canEditPlan)
        throw new Error(
          "A cópia só pode ser feita enquanto o plano estiver em preenchimento.",
        );
      if (entriesQuery.isLoading || (entriesQuery.data?.length ?? 0) > 0)
        throw new Error(
          "A cópia só é permitida quando o plano de destino está vazio.",
        );
      const sourcePlan = plansQuery.data?.find(
        (plan) => plan.id === copySourcePlanId,
      );
      if (!sourcePlan || sourcePlan.id === selectedPlan.id)
        throw new Error("Selecione outro planejamento como referência.");
      const { data, error } = await client
        .from("production_plan_entries")
        .select(
          "consumption_date, audience_code, meal_code, meal_group, preparation, original_product_text, product_id, per_capita, per_capita_unit, volume, volume_unit, quantity_unit, manual_quantity, manual_reason, notes",
        )
        .eq("plan_id", sourcePlan.id)
        .order("consumption_date");
      if (error) throw error;
      if (!data?.length)
        throw new Error("O planejamento de referência não possui lançamentos.");
      const dayOffset = Math.round(
        (Date.parse(`${selectedPlan.week_start}T00:00:00Z`) -
          Date.parse(`${sourcePlan.week_start}T00:00:00Z`)) /
          86_400_000,
      );
      const rows = data.flatMap((row) => {
        const sourceDate = row.consumption_date as string | null;
        const shiftedDate = sourceDate
          ? new Date(
              Date.parse(`${sourceDate}T00:00:00Z`) + dayOffset * 86_400_000,
            )
              .toISOString()
              .slice(0, 10)
          : null;
        if (
          shiftedDate &&
          (shiftedDate < selectedPlan.week_start ||
            shiftedDate > selectedPlan.week_end)
        )
          return [];
        return [
          {
            ...row,
            company_id: profile.company_id,
            unit_id: unitId,
            plan_id: selectedPlan.id,
            consumption_date: shiftedDate,
            created_by: profile.user_id,
            updated_by: profile.user_id,
          },
        ];
      });
      if (!rows.length)
        throw new Error(
          "Nenhum lançamento da semana de origem corresponde ao período do plano de destino.",
        );
      const { error: insertError } = await client
        .from("production_plan_entries")
        .insert(rows);
      if (insertError) throw insertError;
      return { copied: rows.length, skipped: data.length - rows.length };
    },
    onSuccess: async ({ copied, skipped }) => {
      setOperationalMessage(
        `${copied} lançamentos copiados para revisão.${skipped ? ` ${skipped} registros com data fora da semana não entraram na cópia.` : ""} Confira volumes e quantidades antes de liberar o mapa.`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["production-plan-entries", selectedPlanId],
      });
    },
  });

  async function previewFile(file: File) {
    setImportMessage(null);
    setImportError(null);
    setWorkbookPreview(null);
    if (file.size > 10 * 1024 * 1024) {
      setImportError("O arquivo excede o limite de 10 MB.");
      return;
    }
    if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx")) {
      setImportError("Selecione uma planilha no formato .xlsx.");
      return;
    }
    try {
      setWorkbookPreview(await readWorkbook(file));
    } catch (error) {
      setWorkbookPreview(null);
      setImportError(
        error instanceof Error
          ? error.message
          : "Não foi possível ler o arquivo XLSX.",
      );
    }
  }

  async function exportWeeklyMaps(report: WeeklyReportData) {
    setExportError(null);
    if (!selectedPlan) {
      setExportError(
        "Selecione um planejamento semanal antes de exportar os mapas.",
      );
      return;
    }
    try {
      const { default: ExcelJS } = await import("exceljs/dist/exceljs.min.js");
      const workbook = new ExcelJS.Workbook();
      const unitName =
        units.find((unit) => unit.id === unitId)?.name ??
        "Unidade não identificada";
      const logoResponse = await fetch("/isp-logo.png");
      if (!logoResponse.ok)
        throw new Error("Não foi possível carregar a logo do ISP.");
      const logoReader = new FileReader();
      const logoDataUrl = await new Promise<string>((resolve, reject) => {
        logoReader.onload = () =>
          typeof logoReader.result === "string"
            ? resolve(logoReader.result)
            : reject(new Error("Não foi possível preparar a logo do ISP."));
        logoReader.onerror = () =>
          reject(new Error("Não foi possível preparar a logo do ISP."));
        void logoResponse.blob().then((blob) => logoReader.readAsDataURL(blob));
      });
      const logoImageId = workbook.addImage({
        base64: logoDataUrl,
        extension: "png",
      });
      for (let offset = 0; offset < 7; offset += 1) {
        const date = addDays(selectedPlan.week_start, offset);
        const sheet = workbook.addWorksheet(date);
        sheet.columns = [
          { width: 32 },
          { width: 30 },
          { width: 26 },
          { width: 18 },
          { width: 18 },
        ];
        sheet.mergeCells("B1:E1");
        sheet.mergeCells("B2:E2");
        sheet.mergeCells("B3:E3");
        sheet.getCell("B1").value = "MAPA DE PROTEÍNA";
        sheet.getCell("B2").value = unitName;
        sheet.getCell("B3").value = formatOperationalDateLabel(date);
        sheet.getRow(1).height = 30;
        sheet.getRow(2).height = 24;
        sheet.getRow(3).height = 22;
        sheet.getRow(1).font = {
          bold: true,
          size: 16,
          color: { argb: "FF103A56" },
        };
        sheet.getRow(2).font = {
          bold: true,
          size: 12,
          color: { argb: "FF0A7C84" },
        };
        sheet.getRow(3).font = { size: 11, color: { argb: "FF506477" } };
        sheet.addImage(logoImageId, "A1:B4");
        let currentRow = 5;
        for (const [mealCode, mealLabel] of MEALS) {
          for (const audience of ["server", "patient"] as const) {
            const audienceLabel =
              audience === "server" ? "SERVIDOR" : "PACIENTE";
            const rows = entryRows.filter(
              (entry) =>
                entry.consumption_date === date &&
                entry.meal_code === mealCode &&
                entry.audience_code === audience,
            );
            if (!rows.length) continue;

            sheet.mergeCells(currentRow, 1, currentRow, 5);
            const section = sheet.getCell(currentRow, 1);
            section.value = `${mealLabel} ${audienceLabel}`.toLocaleUpperCase(
              "pt-BR",
            );
            section.font = {
              bold: true,
              size: 11,
              color: { argb: "FF103A56" },
            };
            section.alignment = { horizontal: "center", vertical: "middle" };
            section.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFD8E7F7" },
            };
            sheet.getRow(currentRow).height = 24;
            currentRow += 1;

            const headers = [
              "UNIDADE",
              "PREPARAÇÃO",
              "TIPO DE PTN",
              "VOLUME",
              "KG TOTAL",
            ];
            sheet.addRow(headers);
            const header = sheet.getRow(currentRow);
            header.font = { bold: true, size: 9, color: { argb: "FF103A56" } };
            header.alignment = { horizontal: "center", vertical: "middle" };
            header.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFEAF1F8" },
            };
            header.height = 21;
            currentRow += 1;

            for (const entry of rows) {
              const proteinName =
                products.find((product) => product.id === entry.product_id)
                  ?.name ??
                entry.original_product_text ??
                "Produto sem identificação";
              const volume =
                entry.volume === null
                  ? "Não informado"
                  : `${entry.volume.toLocaleString("pt-BR")} ${entry.volume_unit ?? ""}`.trim();
              const total =
                entry.final_quantity === null
                  ? "Pendente de conferência"
                  : `${entry.final_quantity.toLocaleString("pt-BR")} ${entry.quantity_unit ?? ""}`.trim();
              sheet.addRow([
                entry.meal_group?.trim() || "Grupo não informado",
                entry.preparation || "Não informado",
                proteinName,
                volume,
                total,
              ]);
              const detail = sheet.getRow(currentRow);
              detail.alignment = { vertical: "middle", wrapText: true };
              detail.height = 27;
              for (let column = 1; column <= 5; column += 1) {
                detail.getCell(column).border = {
                  top: { style: "thin", color: { argb: "FFD2DAE3" } },
                  bottom: { style: "thin", color: { argb: "FFD2DAE3" } },
                  left: { style: "thin", color: { argb: "FFD2DAE3" } },
                  right: { style: "thin", color: { argb: "FFD2DAE3" } },
                };
              }
              currentRow += 1;
            }
            currentRow += 2;
          }
        }
        if (currentRow === 5) {
          sheet.mergeCells("A5:E5");
          sheet.getCell("A5").value =
            "Nenhum lançamento de proteína para esta data.";
          sheet.getCell("A5").font = {
            italic: true,
            color: { argb: "FF64748B" },
          };
        }
        sheet.views = [{ state: "frozen", ySplit: 4 }];
        sheet.pageSetup = {
          paperSize: 9,
          orientation: "portrait",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: {
            left: 0.3,
            right: 0.3,
            top: 0.4,
            bottom: 0.4,
            header: 0.15,
            footer: 0.15,
          },
          printTitlesRow: "1:3",
        };
      }
      const summary = workbook.addWorksheet("Resumo");
      summary.addRows([
        ["LBGS · ISP · RELATÓRIO SEMANAL DE PRODUÇÃO"],
        [unitName],
        [
          "Planejamento",
          selectedPlan.title,
          "Período",
          `${selectedPlan.week_start} a ${selectedPlan.week_end}`,
        ],
        [
          "Emitido por",
          profile?.full_name ?? "Usuário autenticado",
          "Emissão",
          formatDateTime(new Date()),
        ],
        ["Indicador", "Quantidade"],
        ["Lançamentos de proteína", entryRows.length],
        [
          "Proteínas sem vínculo ou quantidade",
          report.proteinConsolidation.pendingEntries.length,
        ],
        ["Lançamentos de Hortifruti", report.hortifruti.length],
        [
          "Hortifruti sem vínculo de produto",
          report.hortifrutiTotals.pending.length,
        ],
        ["Lançamentos de polpa", report.pulps.length],
        ["Polpas pendentes de consolidação", report.pulpTotals.pending.length],
        [
          "Polpas distribuídas em faixas",
          report.pulpDeliveryTotals.allocations.length,
        ],
        [
          "Polpas sem faixa/dados suficientes",
          report.pulpDeliveryTotals.unallocated.length,
        ],
        ["Entregas geradas", report.deliveries.length],
        [
          "Itens de entrega sem conferência",
          report.deliveryItems.filter((item) => item.received_quantity === null)
            .length,
        ],
        ["Programações de degelo", report.thawSchedules.length],
        [
          "Degelos sem horário calculado",
          report.thawSchedules.filter((item) => item.planned_thaw_at === null)
            .length,
        ],
        [
          "Nota",
          "Quantidades em unidades diferentes não são somadas entre si. Necessidades e conferências não alteram o estoque.",
        ],
      ]);
      summary.columns = [
        { width: 38 },
        { width: 28 },
        { width: 20 },
        { width: 38 },
      ];
      summary.getRow(5).font = { bold: true, color: { argb: "FFFFFFFF" } };
      summary.getRow(5).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF17365D" },
      };
      summary.getRow(18).alignment = { wrapText: true, vertical: "top" };
      summary.views = [{ state: "frozen", ySplit: 5 }];

      const proteinSheet = workbook.addWorksheet("Consolidado PTN");
      proteinSheet.addRows([
        ["Consolidação de proteínas"],
        [
          "Produto",
          "Unidade",
          "Pacientes",
          "Servidores",
          "Total",
          "Dias",
          "Refeições",
        ],
        ...report.proteinConsolidation.totals.map((row) => [
          row.productName,
          row.unit,
          row.patients,
          row.servers,
          row.total,
          [...row.byDate.keys()].sort().join(", "),
          [...row.byMeal.keys()].join(", "),
        ]),
      ]);
      proteinSheet.columns = [
        { width: 36 },
        { width: 14 },
        { width: 16 },
        { width: 16 },
        { width: 16 },
        { width: 32 },
        { width: 32 },
      ];
      proteinSheet.getRow(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
      proteinSheet.getRow(2).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF17365D" },
      };
      proteinSheet.views = [{ state: "frozen", ySplit: 2 }];
      if (report.proteinConsolidation.pendingEntries.length) {
        const pendingSheet = workbook.addWorksheet("Pendências PTN");
        pendingSheet.addRow([
          "Origem",
          "Preparação",
          "Produto",
          "Público",
          "Data",
          "Quantidade",
          "Unidade",
        ]);
        for (const entry of report.proteinConsolidation.pendingEntries)
          pendingSheet.addRow([
            "Lançamento manual",
            entry.productName,
            entry.productId ?? "Sem vínculo",
            entry.audience === "patient" ? "Paciente" : "Servidor",
            entry.date || "Sem data",
            entry.finalQuantity ?? "Pendente",
            entry.unit || "Sem unidade",
          ]);
        pendingSheet.columns = [
          { width: 22 },
          { width: 34 },
          { width: 34 },
          { width: 16 },
          { width: 16 },
          { width: 18 },
          { width: 16 },
        ];
        pendingSheet.getRow(1).font = {
          bold: true,
          color: { argb: "FFFFFFFF" },
        };
        pendingSheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF9A3412" },
        };
        pendingSheet.views = [{ state: "frozen", ySplit: 1 }];
      }

      const pulpSheet = workbook.addWorksheet("Polpas");
      pulpSheet.addRow([
        "Data",
        "Sabor",
        "Público",
        "Serviço",
        "Quantidade",
        "Unidade",
      ]);
      for (const row of report.pulpTotals.rows)
        pulpSheet.addRow([
          row.date ?? "Data pendente",
          row.flavorId
            ? ((pulpFlavorsQuery.data ?? []).find(
                (flavor) => flavor.id === row.flavorId,
              )?.flavor_name ?? "Sabor cadastrado")
            : (row.originalFlavorText ?? "Sabor pendente"),
          row.audience === "patient" ? "Paciente" : "Servidor",
          row.service ?? "Não informado",
          row.total,
          row.unit,
        ]);
      pulpSheet.columns = [
        { width: 18 },
        { width: 24 },
        { width: 16 },
        { width: 22 },
        { width: 18 },
        { width: 14 },
      ];
      pulpSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      pulpSheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF17365D" },
      };
      pulpSheet.views = [{ state: "frozen", ySplit: 1 }];
      const hortifrutiSheet = workbook.addWorksheet("Hortifruti");
      hortifrutiSheet.addRow([
        "Data",
        "Produto / texto original",
        "Público",
        "Serviço",
        "Per capita",
        "Volume",
        "Total calculado",
        "Quantidade final",
        "Unidade",
        "Observações",
      ]);
      for (const row of report.hortifruti)
        hortifrutiSheet.addRow([
          row.consumption_date,
          products.find((product) => product.id === row.product_id)?.name ??
            row.original_product_text ??
            "Produto sem identificação",
          row.audience_code === "patient" ? "Paciente" : "Servidor",
          MEALS.find(([code]) => code === row.service_code)?.[1] ??
            row.service_code,
          row.per_capita === null
            ? ""
            : `${row.per_capita} ${row.per_capita_unit ?? ""}`,
          row.volume === null ? "" : `${row.volume} ${row.volume_unit ?? ""}`,
          row.calculated_quantity ?? "",
          Number(row.quantity),
          row.quantity_unit,
          [
            row.manual_reason ? `Ajuste: ${row.manual_reason}` : "",
            row.notes ?? "",
          ]
            .filter(Boolean)
            .join(" · "),
        ]);
      hortifrutiSheet.columns = [
        { width: 18 },
        { width: 34 },
        { width: 16 },
        { width: 22 },
        { width: 20 },
        { width: 20 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 14 },
        { width: 40 },
      ];
      hortifrutiSheet.getRow(1).font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      hortifrutiSheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF17365D" },
      };
      hortifrutiSheet.views = [{ state: "frozen", ySplit: 1 }];
      const pulpWindowsSheet = workbook.addWorksheet("Polpas por entrega");
      pulpWindowsSheet.addRow([
        "Faixa",
        "Sabor",
        "Público",
        "Serviço",
        "Quantidade",
        "Unidade",
      ]);
      for (const row of report.pulpDeliveryTotals.allocations)
        pulpWindowsSheet.addRow([
          (deliveryWindowsQuery.data ?? []).find(
            (window) => window.id === row.windowId,
          )?.label ?? row.windowId,
          row.flavorId
            ? ((pulpFlavorsQuery.data ?? []).find(
                (flavor) => flavor.id === row.flavorId,
              )?.flavor_name ?? "Sabor cadastrado")
            : (row.originalFlavorText ?? "Sabor pendente"),
          row.audience === "patient" ? "Paciente" : "Servidor",
          row.service ?? "Não informado",
          row.quantity,
          row.unit,
        ]);
      pulpWindowsSheet.columns = [
        { width: 24 },
        { width: 24 },
        { width: 16 },
        { width: 22 },
        { width: 18 },
        { width: 14 },
      ];
      pulpWindowsSheet.getRow(1).font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      pulpWindowsSheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF17365D" },
      };
      const deliveriesSheet = workbook.addWorksheet("Entregas");
      deliveriesSheet.addRow([
        "Entrega",
        "Janela/data",
        "Produto",
        "Quantidade solicitada",
        "Recebida",
        "Diferença",
        "Unidade",
        "Status",
      ]);
      for (const delivery of report.deliveries) {
        const items = report.deliveryItems.filter(
          (item) => item.delivery_id === delivery.id,
        );
        if (!items.length)
          deliveriesSheet.addRow([
            delivery.label,
            delivery.scheduled_for ?? "Janela semanal",
            "Sem itens",
            null,
            null,
            null,
            null,
            delivery.status,
          ]);
        for (const item of items)
          deliveriesSheet.addRow([
            delivery.label,
            delivery.scheduled_for ??
              (delivery.window_id
                ? ((deliveryWindowsQuery.data ?? []).find(
                    (window) => window.id === delivery.window_id,
                  )?.label ?? "Janela arquivada")
                : "Semana inteira"),
            products.find((product) => product.id === item.product_id)?.name ??
              item.original_product_text ??
              "Produto pendente",
            item.requested_quantity,
            item.received_quantity ?? "Não conferida",
            item.received_quantity === null
              ? "Pendente"
              : Number(item.requested_quantity) -
                Number(item.received_quantity),
            item.quantity_unit,
            delivery.status,
          ]);
      }
      deliveriesSheet.columns = [
        { width: 28 },
        { width: 24 },
        { width: 34 },
        { width: 22 },
        { width: 18 },
        { width: 18 },
        { width: 14 },
        { width: 20 },
      ];
      deliveriesSheet.getRow(1).font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      deliveriesSheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF17365D" },
      };
      deliveriesSheet.views = [{ state: "frozen", ySplit: 1 }];
      const thawSheet = workbook.addWorksheet("Degelo");
      thawSheet.addRow([
        "Produto",
        "Consumo previsto",
        "Retirada prevista",
        "Antecedência (h)",
        "Quantidade",
        "Unidade",
        "Status",
      ]);
      for (const thaw of report.thawSchedules)
        thawSheet.addRow([
          products.find((product) => product.id === thaw.product_id)?.name ??
            thaw.original_product_text ??
            "Produto pendente",
          formatDateTime(thaw.consumption_at),
          thaw.planned_thaw_at
            ? formatDateTime(thaw.planned_thaw_at)
            : "Não calculada",
          thaw.lead_hours ?? "Pendente",
          thaw.quantity ?? "Não informada",
          thaw.quantity_unit ?? "Não informada",
          thaw.status,
        ]);
      thawSheet.columns = [
        { width: 32 },
        { width: 24 },
        { width: 24 },
        { width: 20 },
        { width: 18 },
        { width: 16 },
        { width: 18 },
      ];
      thawSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      thawSheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF17365D" },
      };
      thawSheet.views = [{ state: "frozen", ySplit: 1 }];
      const bytes = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([bytes as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `relatorio-producao-${selectedPlan.week_start}-a-${selectedPlan.week_end}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Não foi possível exportar os mapas.",
      );
    }
  }

  const saveImport = useMutation({
    mutationFn: async () => {
      if (!client || !profile || !unitId || !workbookPreview)
        throw new Error("Selecione a unidade e faça a prévia do arquivo.");
      const preview = workbookPreview;
      const { data: duplicate, error: lookupError } = await client
        .from("production_imports")
        .select("id, file_name, status")
        .eq("company_id", profile.company_id)
        .eq("unit_id", unitId)
        .eq("file_sha256", preview.hash)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (duplicate)
        throw new Error(
          "Este arquivo já está arquivado nesta unidade (importação " +
            duplicate.id +
            ").",
        );
      const storagePath =
        profile.company_id + "/" + unitId + "/" + preview.hash + ".xlsx";
      const { error: uploadError } = await client.storage
        .from("production-imports")
        .upload(storagePath, preview.file, {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: false,
        });
      if (uploadError) throw uploadError;
      const { data: manifest, error: manifestError } = await client
        .from("production_imports")
        .insert({
          company_id: profile.company_id,
          unit_id: unitId,
          file_name: preview.file.name,
          file_sha256: preview.hash,
          storage_path: storagePath,
          status: "uploaded",
          sheet_names: preview.sheetNames,
          cell_count: preview.cells.length,
          identified_count: preview.candidates.length,
          imported_count: 0,
          pending_count: preview.candidates.length,
          issue_count:
            preview.formulaCacheMissing +
            preview.candidates.filter(
              (candidate) =>
                !candidate.source_date ||
                candidate.date_source === "inherited_from_block" ||
                (candidate.record_type === "pulp" &&
                  candidate.quantity === null) ||
                (candidate.record_type === "protein_map" &&
                  candidate.cached_quantity === null),
            ).length,
          validation_report: {
            nonempty_cells: preview.nonempty,
            formulas: preview.formulaCount,
            formulas_without_cached_result: preview.formulaCacheMissing,
            zero_cells: preview.zeros,
            date_samples: preview.dateSamples,
            meal_candidates_detected: preview.candidates.length,
            pulp_candidates_detected: preview.candidates.filter(
              (candidate) => candidate.record_type === "pulp",
            ).length,
            protein_map_candidates_detected: preview.candidates.filter(
              (candidate) => candidate.record_type === "protein_map",
            ).length,
            candidates_require_date_review: preview.candidates.filter(
              (candidate) =>
                !candidate.source_date ||
                candidate.date_source === "inherited_from_block",
            ).length,
            structured_records_imported: false,
          },
          imported_by: profile.user_id,
        })
        .select("id")
        .single();
      if (manifestError || !manifest) {
        await client.storage.from("production-imports").remove([storagePath]);
        throw (
          manifestError ??
          new Error("Não foi possível criar o histórico da importação.")
        );
      }

      let persisted = 0;
      for (let offset = 0; offset < preview.cells.length; offset += 250) {
        const chunk = preview.cells.slice(offset, offset + 250).map((cell) => ({
          ...cell,
          company_id: profile.company_id,
          unit_id: unitId,
          import_id: manifest.id,
        }));
        const { error } = await client
          .from("production_import_rows")
          .upsert(chunk, {
            onConflict: "import_id,source_sheet,source_cell",
          });
        if (error) {
          await client
            .from("production_imports")
            .update({
              status: "partial",
              pending_count: preview.candidates.length,
              imported_count: 0,
            })
            .eq("id", manifest.id)
            .eq("company_id", profile.company_id)
            .eq("unit_id", unitId);
          throw new Error(
            "Arquivo preservado. A gravação das células parou após " +
              persisted +
              " de " +
              preview.cells.length +
              ": " +
              error.message,
          );
        }
        persisted += chunk.length;
      }
      const { error: finishError } = await client
        .from("production_imports")
        .update({
          status: "previewed",
          identified_count: preview.candidates.length,
          imported_count: 0,
          pending_count: preview.candidates.length,
        })
        .eq("id", manifest.id)
        .eq("company_id", profile.company_id)
        .eq("unit_id", unitId);
      if (finishError) throw finishError;
      return { id: manifest.id as string, count: persisted };
    },
    onSuccess: async ({ id, count }) => {
      setImportMessage(
        "Arquivo original e " +
          count +
          " células arquivados. " +
          workbookPreview?.candidates.length +
          " candidatos a refeição foram separados para revisão. Nenhum lançamento entra no estoque.",
      );
      setSelectedImportId(id);
      await queryClient.invalidateQueries({ queryKey: ["production-imports"] });
    },
    onError: (error) =>
      setImportError(
        error instanceof Error
          ? error.message
          : "Falha ao arquivar a importação.",
      ),
  });

  const importsQuery = useQuery({
    queryKey: ["production-imports", profile?.company_id, unitId],
    enabled: Boolean(client && profile && unitId),
    queryFn: async () => {
      if (!client || !profile || !unitId) return [];
      const { data, error } = await client
        .from("production_imports")
        .select(
          "id, file_name, status, cell_count, identified_count, imported_count, pending_count, issue_count, imported_at",
        )
        .eq("company_id", profile.company_id)
        .eq("unit_id", unitId)
        .order("imported_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const importCandidatesQuery = useQuery({
    queryKey: ["production-import-candidates", selectedImportId],
    enabled: Boolean(client && selectedImportId),
    queryFn: async () => {
      if (!client || !selectedImportId) return [];
      const { data, error } = await client
        .from("production_import_rows")
        .select(
          "id, source_sheet, source_cell, normalized_value, validation_status, issue, linked_record_id",
        )
        .eq("import_id", selectedImportId)
        .in("recognized_type", [
          "meal_candidate",
          "pulp_candidate",
          "protein_map_candidate",
        ])
        .order("source_sheet")
        .order("source_cell");
      if (error) throw error;
      return (data ?? []) as CandidateReviewRow[];
    },
  });
  const importCandidate = useMutation({
    mutationFn: async ({
      rowId,
      productId,
      date,
      confirmedQuantity,
    }: {
      rowId: string;
      productId: string;
      date: string;
      confirmedQuantity: number | null;
    }) => {
      if (!client || !date)
        throw new Error("Confirme a data real antes de importar o registro.");
      const { data, error } = await client.rpc("import_production_candidate", {
        p_import_row_id: rowId,
        p_product_id: productId || null,
        p_consumption_date: date,
        p_confirmed_quantity: confirmedQuantity,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async () => {
      setOperationalMessage(
        "Registro histórico importado com vínculo à célula original. Estoque e movimentações não foram alterados.",
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["production-import-candidates", selectedImportId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["production-imports", profile?.company_id, unitId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["production-plans", profile?.company_id, unitId],
        }),
      ]);
    },
  });

  const deliveryQuery = useQuery({
    queryKey: ["production-deliveries", selectedPlanId],
    enabled: Boolean(client && selectedPlanId),
    queryFn: async () => {
      if (!client || !selectedPlanId) return [];
      const { data, error } = await client
        .from("production_deliveries")
        .select(
          "id, plan_id, window_id, label, scheduled_for, status, created_at",
        )
        .eq("plan_id", selectedPlanId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DeliveryRow[];
    },
  });
  const deliveryIds = (deliveryQuery.data ?? []).map((delivery) => delivery.id);
  const deliveryItemsQuery = useQuery({
    queryKey: ["production-delivery-items", deliveryIds],
    enabled: Boolean(client && deliveryIds.length),
    queryFn: async () => {
      if (!client || !deliveryIds.length) return [];
      const { data, error } = await client
        .from("production_delivery_items")
        .select(
          "id, delivery_id, product_id, original_product_text, quantity_unit, requested_quantity, received_quantity",
        )
        .in("delivery_id", deliveryIds)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as DeliveryItemRow[];
    },
  });
  const thawQuery = useQuery({
    queryKey: ["production-thaw-schedules", selectedPlanId],
    enabled: Boolean(client && selectedPlanId),
    queryFn: async () => {
      if (!client || !selectedPlanId) return [];
      const { data, error } = await client
        .from("production_thaw_schedules")
        .select(
          "id, product_id, original_product_text, consumption_at, planned_thaw_at, lead_hours, quantity, quantity_unit, status",
        )
        .eq("plan_id", selectedPlanId)
        .order("planned_thaw_at");
      if (error) throw error;
      return (data ?? []) as ThawRow[];
    },
  });
  const pulpQuery = useQuery({
    queryKey: ["production-pulp-entries", selectedPlanId],
    enabled: Boolean(client && selectedPlanId),
    queryFn: async () => {
      if (!client || !selectedPlanId) return [];
      const { data, error } = await client
        .from("production_pulp_entries")
        .select(
          "id, consumption_date, audience_code, service_code, flavor_id, original_flavor_text, quantity, quantity_unit",
        )
        .eq("plan_id", selectedPlanId)
        .order("consumption_date")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as PulpRow[];
    },
  });
  const hortifrutiQuery = useQuery({
    queryKey: ["production-hortifruti-entries", selectedPlanId],
    enabled: Boolean(client && selectedPlanId),
    queryFn: async () => {
      if (!client || !selectedPlanId) return [];
      const { data, error } = await client
        .from("production_hortifruti_entries")
        .select(
          "id, consumption_date, audience_code, service_code, product_id, original_product_text, per_capita, per_capita_unit, volume, volume_unit, calculated_quantity, manual_quantity, manual_reason, quantity, quantity_unit, notes",
        )
        .eq("plan_id", selectedPlanId)
        .order("consumption_date")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as HortifrutiRow[];
    },
  });
  const pulpFlavorsQuery = useQuery({
    queryKey: ["production-pulp-flavors", profile?.company_id],
    enabled: Boolean(client && profile),
    queryFn: async () => {
      if (!client || !profile) return [];
      const { data, error } = await client
        .from("production_pulp_flavors")
        .select("id, flavor_name")
        .eq("company_id", profile.company_id)
        .eq("active", true)
        .order("flavor_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const deliveryWindowsQuery = useQuery({
    queryKey: ["production-delivery-windows", profile?.company_id, unitId],
    enabled: Boolean(client && profile && unitId),
    queryFn: async () => {
      if (!client || !profile || !unitId) return [];
      const { data, error } = await client
        .from("production_delivery_windows")
        .select(
          "id, code, label, consumption_from, consumption_to, sequence_number",
        )
        .eq("company_id", profile.company_id)
        .eq("active", true)
        .or(`unit_id.is.null,unit_id.eq.${unitId}`)
        .order("sequence_number");
      if (error) throw error;
      return (data ?? []) as DeliveryWindowRow[];
    },
  });
  const thawRulesQuery = useQuery({
    queryKey: ["production-thaw-rules", profile?.company_id, unitId],
    enabled: Boolean(client && profile && unitId),
    queryFn: async () => {
      if (!client || !profile || !unitId) return [];
      const { data, error } = await client
        .from("production_thaw_rules")
        .select("id, unit_id, product_id, category_id, label, lead_hours")
        .eq("company_id", profile.company_id)
        .eq("active", true)
        .or(`unit_id.is.null,unit_id.eq.${unitId}`)
        .order("label");
      if (error) throw error;
      return (data ?? []) as ThawRuleRow[];
    },
  });

  const createDelivery = useMutation({
    mutationFn: async () => {
      if (!client || !selectedPlan)
        throw new Error("Selecione um planejamento semanal.");
      const { data, error } = await client.rpc("create_production_delivery", {
        p_plan_id: selectedPlan.id,
        p_label: deliveryLabel.trim(),
        p_scheduled_for: deliveryDate || null,
        p_window_id: deliveryWindowId || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (id) => {
      setDeliveryLabel("Entrega de proteínas");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["production-deliveries", selectedPlanId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["production-delivery-items"],
        }),
      ]);
      setOperationalMessage(
        "Entrega " +
          id +
          " gerada a partir das necessidades vinculadas. Isso não gera entrada nem altera o estoque.",
      );
    },
  });
  const saveDeliveryWindow = useMutation({
    mutationFn: async () => {
      if (!client || !profile || !unitId)
        throw new Error("Selecione uma unidade.");
      if (profile.role !== "admin" && profile.role !== "stock_manager")
        throw new Error(
          "Somente administradores ou gestores podem configurar janelas.",
        );
      const from = Number(windowFrom),
        to = Number(windowTo),
        sequence = Number(windowSequence);
      if (
        !windowCode.trim() ||
        !windowLabel.trim() ||
        !Number.isInteger(from) ||
        from < 0 ||
        from > 6 ||
        !Number.isInteger(to) ||
        to < 0 ||
        to > 6 ||
        !Number.isInteger(sequence) ||
        sequence < 1
      )
        throw new Error("Preencha código, descrição, dias e ordem da janela.");
      const { error } = await client
        .from("production_delivery_windows")
        .insert({
          company_id: profile.company_id,
          unit_id: unitId,
          code: windowCode.trim(),
          label: windowLabel.trim(),
          consumption_from: from,
          consumption_to: to,
          sequence_number: sequence,
          active: true,
          created_by: profile.user_id,
        });
      if (error) throw error;
    },
    onSuccess: async () => {
      setWindowCode("");
      setWindowLabel("");
      await queryClient.invalidateQueries({
        queryKey: ["production-delivery-windows", profile?.company_id, unitId],
      });
    },
  });
  const confirmReceipt = useMutation({
    mutationFn: async ({
      itemId,
      quantity,
    }: {
      itemId: string;
      quantity: number;
    }) => {
      if (!client) throw new Error("Conexão com o banco indisponível.");
      const { error } = await client.rpc("record_production_delivery_receipt", {
        p_delivery_item_id: itemId,
        p_received_quantity: quantity,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["production-deliveries", selectedPlanId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["production-delivery-items"],
        }),
      ]);
    },
  });
  const saveThaw = useMutation({
    mutationFn: async () => {
      if (!client || !profile || !unitId || !selectedPlan)
        throw new Error("Selecione uma semana e unidade.");
      const product = products.find((item) => item.id === thawProductId);
      if (!product) throw new Error("Selecione um produto cadastrado.");
      const consumptionAt = operationalDateTimeToIso(
        thawConsumptionDate,
        thawConsumptionTime,
      );
      const leadHours = Number(thawLeadHours);
      if (
        !consumptionAt ||
        !Number.isInteger(leadHours) ||
        leadHours < 0 ||
        leadHours > 720
      )
        throw new Error(
          "Confira data, horário e antecedência do degelo (0 a 720 horas).",
        );
      const plannedThawAt = calculateThawAt(consumptionAt, leadHours);
      if (!plannedThawAt)
        throw new Error(
          "Não foi possível calcular a retirada do congelamento.",
        );
      const quantity = thawQuantity.trim()
        ? Number(thawQuantity.replace(",", "."))
        : null;
      if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0))
        throw new Error("Quantidade precisa ser maior ou igual a zero.");
      const applicableRule =
        (thawRulesQuery.data ?? []).find(
          (rule) => rule.product_id === product.id && rule.unit_id === unitId,
        ) ??
        (thawRulesQuery.data ?? []).find(
          (rule) => rule.product_id === product.id && rule.unit_id === null,
        );
      if (applicableRule && applicableRule.lead_hours !== leadHours)
        throw new Error(
          "A programação precisa seguir a regra de degelo cadastrada. Altere primeiro a configuração autorizada.",
        );
      const { error } = await client.from("production_thaw_schedules").insert({
        company_id: profile.company_id,
        unit_id: unitId,
        plan_id: selectedPlan.id,
        product_id: product.id,
        consumption_at: consumptionAt,
        planned_thaw_at: plannedThawAt,
        lead_hours: leadHours,
        quantity,
        quantity_unit: thawUnit.trim() || product.unit,
        status: "scheduled",
        created_by: profile.user_id,
        updated_by: profile.user_id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setOperationalMessage(
        "Degelo programado. O estoque não foi movimentado.",
      );
      setThawQuantity("");
      await queryClient.invalidateQueries({
        queryKey: ["production-thaw-schedules", selectedPlanId],
      });
    },
  });
  const saveThawRule = useMutation({
    mutationFn: async () => {
      if (
        !client ||
        !profile ||
        !unitId ||
        (profile.role !== "admin" && profile.role !== "stock_manager")
      )
        throw new Error(
          "Somente administrador ou gestor pode configurar o prazo de degelo.",
        );
      const product = products.find((item) => item.id === thawProductId);
      const hours = Number(thawRuleHours);
      if (
        !product ||
        !thawRuleLabel.trim() ||
        !Number.isInteger(hours) ||
        hours < 0 ||
        hours > 720
      )
        throw new Error(
          "Selecione o produto e informe descrição e prazo entre 0 e 720 horas.",
        );
      const existing = (thawRulesQuery.data ?? []).find(
        (rule) => rule.product_id === product.id && rule.unit_id === unitId,
      );
      if (existing) {
        const { error } = await client
          .from("production_thaw_rules")
          .update({
            label: thawRuleLabel.trim(),
            lead_hours: hours,
            updated_by: profile.user_id,
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await client.from("production_thaw_rules").insert({
          company_id: profile.company_id,
          unit_id: unitId,
          product_id: product.id,
          category_id: null,
          label: thawRuleLabel.trim(),
          lead_hours: hours,
          active: true,
          created_by: profile.user_id,
          updated_by: profile.user_id,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      setOperationalMessage(
        "Prazo padrão de degelo atualizado. Agendamentos já registrados permanecem com seu histórico.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["production-thaw-rules", profile?.company_id, unitId],
      });
    },
  });
  const savePulp = useMutation({
    mutationFn: async () => {
      if (!client || !profile || !unitId || !selectedPlan)
        throw new Error("Selecione uma semana e unidade.");
      const quantity = Number(pulpQuantity.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity < 0)
        throw new Error("Informe uma quantidade válida em KG.");
      if (!pulpFlavorId && !pulpFlavorText.trim())
        throw new Error("Selecione ou informe o sabor da polpa.");
      const { error } = await client.from("production_pulp_entries").insert({
        company_id: profile.company_id,
        unit_id: unitId,
        plan_id: selectedPlan.id,
        consumption_date: pulpDate || null,
        audience_code: pulpAudience,
        service_code: pulpService.trim() || null,
        flavor_id: pulpFlavorId || null,
        original_flavor_text: pulpFlavorId ? null : pulpFlavorText.trim(),
        quantity,
        quantity_unit: "KG",
        created_by: profile.user_id,
        updated_by: profile.user_id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setOperationalMessage("Lançamento de polpa registrado no planejamento.");
      setPulpQuantity("");
      setPulpFlavorText("");
      await queryClient.invalidateQueries({
        queryKey: ["production-pulp-entries", selectedPlanId],
      });
    },
  });
  const saveHortifruti = useMutation({
    mutationFn: async () => {
      if (!client || !profile || !unitId || !selectedPlan)
        throw new Error("Selecione uma semana e unidade.");
      const selectedProduct = products.find(
        (item) => item.id === hortifrutiProductId,
      );
      const originalName =
        hortifrutiOriginalName.trim() || selectedProduct?.name || "";
      if (
        !hortifrutiDate ||
        hortifrutiDate < selectedPlan.week_start ||
        hortifrutiDate > selectedPlan.week_end
      )
        throw new Error("A data deve estar dentro da semana selecionada.");
      if (
        (parsedHortifrutiPerCapita === null) !==
        (parsedHortifrutiVolume === null)
      )
        throw new Error("Preencha per capita e volume juntos para calcular.");
      if (parsedHortifrutiPerCapita === null && parsedHortifrutiManual === null)
        throw new Error("Informe per capita e volume ou um total manual.");
      if (hortifrutiCalculationIssues.length)
        throw new Error(hortifrutiCalculationIssues.join(" "));
      if (hortifrutiCalculation.finalQuantity === null)
        throw new Error("Não foi possível calcular o total de Hortifruti.");
      if (!selectedProduct && !originalName)
        throw new Error("Selecione um produto ou informe o nome original.");
      if (!hortifrutiUnit.trim())
        throw new Error("Informe a unidade da quantidade.");
      const { error } = await client
        .from("production_hortifruti_entries")
        .insert({
          company_id: profile.company_id,
          unit_id: unitId,
          plan_id: selectedPlan.id,
          consumption_date: hortifrutiDate,
          audience_code: hortifrutiAudience,
          service_code: hortifrutiService,
          product_id: selectedProduct?.id ?? null,
          original_product_text: selectedProduct ? null : originalName,
          per_capita: parsedHortifrutiPerCapita,
          per_capita_unit:
            parsedHortifrutiPerCapita === null
              ? null
              : hortifrutiPerCapitaUnit.trim(),
          volume: parsedHortifrutiVolume,
          volume_unit:
            parsedHortifrutiVolume === null
              ? null
              : hortifrutiVolumeUnit.trim(),
          calculated_quantity: hortifrutiCalculation.calculatedQuantity,
          manual_quantity: parsedHortifrutiManual,
          manual_reason: hortifrutiManualReason.trim() || null,
          quantity: hortifrutiCalculation.finalQuantity,
          quantity_unit: hortifrutiUnit.trim(),
          notes: hortifrutiNotes.trim() || null,
          created_by: profile.user_id,
          updated_by: profile.user_id,
        });
      if (error) throw error;
    },
    onSuccess: async () => {
      setOperationalMessage(
        "Lançamento de Hortifruti registrado no planejamento. O estoque não foi movimentado.",
      );
      setHortifrutiOriginalName("");
      setHortifrutiQuantity("");
      setHortifrutiPerCapita("");
      setHortifrutiVolume("");
      setHortifrutiManualReason("");
      setHortifrutiNotes("");
      await queryClient.invalidateQueries({
        queryKey: ["production-hortifruti-entries", selectedPlanId],
      });
    },
  });

  const activeUnit = units.find((unit) => unit.id === unitId);
  const entryRows = entriesQuery.data ?? [];
  const filteredEntryRows = entryRows.filter((row) => {
    const productName =
      products.find((product) => product.id === row.product_id)?.name ??
      row.original_product_text ??
      "";
    const search = entrySearchText.trim().toLocaleLowerCase("pt-BR");
    return (
      (entryFilterDate === "all" || row.consumption_date === entryFilterDate) &&
      (entryFilterAudience === "all" ||
        row.audience_code === entryFilterAudience) &&
      (entryFilterMeal === "all" || row.meal_code === entryFilterMeal) &&
      (!search ||
        `${row.preparation} ${productName} ${row.meal_group ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(search))
    );
  });
  const mapDayEntries = entryRows.filter(
    (entry) =>
      entry.consumption_date === mapDate &&
      (mapAudienceFilter === "all" ||
        entry.audience_code === mapAudienceFilter) &&
      (mapMealFilter === "all" || entry.meal_code === mapMealFilter) &&
      (mapProductFilter === "all" || entry.product_id === mapProductFilter),
  );
  const proteinMapSections = MEALS.flatMap(([mealCode, mealLabel]) =>
    (["server", "patient"] as const)
      .map((audienceCode) => ({
        title: `${mealLabel} ${audienceCode === "server" ? "Servidor" : "Paciente"}`,
        rows: mapDayEntries.filter(
          (entry) =>
            entry.meal_code === mealCode &&
            entry.audience_code === audienceCode,
        ),
      }))
      .filter((section) => section.rows.length > 0),
  );
  const mapReviewSummary = {
    rows: mapDayEntries.length,
    withoutGroup: mapDayEntries.filter((entry) => !entry.meal_group?.trim())
      .length,
    manual: mapDayEntries.filter((entry) => entry.manual_quantity !== null)
      .length,
    pending: mapDayEntries.filter((entry) => entry.final_quantity === null)
      .length,
  };
  const pulpEntries = useMemo(() => pulpQuery.data ?? [], [pulpQuery.data]);
  const hortifrutiEntries = useMemo(
    () => hortifrutiQuery.data ?? [],
    [hortifrutiQuery.data],
  );
  const realizedStockExits = useMemo(() => {
    const batches = new Map(
      (realizedExitBatchesQuery.data ?? []).map((batch) => [batch.id, batch]),
    );
    const movements = new Map(
      (realizedStockMovementsQuery.data ?? []).map((movement) => [
        movement.id,
        movement,
      ]),
    );
    return (realizedExitBatchItemsQuery.data ?? []).flatMap((item) => {
      const batch = batches.get(item.batch_id);
      const movement = movements.get(item.movement_id);
      const product = allProducts.find(
        (candidate) => candidate.id === movement?.product_id,
      );
      const date = batch ? operationalDateOfIso(batch.occurred_at) : null;
      if (!batch || !movement || !date) return [];
      return [
        {
          productId: movement.product_id,
          productName: product?.name ?? "Produto fora do catálogo ativo",
          date,
          serviceCode: batch.service_code,
          quantity: Number(movement.quantity),
          unit: movement.unit_of_measure_at_movement,
        },
      ];
    });
  }, [
    allProducts,
    realizedExitBatchesQuery.data,
    realizedExitBatchItemsQuery.data,
    realizedStockMovementsQuery.data,
  ]);
  const plannedVsStockExits = useMemo(() => {
    const hortifrutiPlanned: ProductionEntry[] = hortifrutiEntries.map(
      (row) => ({
        productId: row.product_id,
        productName:
          allProducts.find((product) => product.id === row.product_id)?.name ??
          row.original_product_text ??
          "Produto sem identificação",
        audience: row.audience_code,
        meal: row.service_code,
        date: row.consumption_date,
        unit: row.quantity_unit,
        perCapita: null,
        perCapitaUnit: null,
        volume: null,
        volumeUnit: null,
        manualQuantity: null,
        manualReason: null,
        calculatedQuantity: Number(row.quantity),
        finalQuantity: Number(row.quantity),
      }),
    );
    return compareProductionToStockExits(
      [...productionEntries, ...hortifrutiPlanned],
      realizedStockExits,
    );
  }, [allProducts, hortifrutiEntries, productionEntries, realizedStockExits]);
  const hortifrutiAnalysis = useMemo(
    () =>
      consolidateHortifrutiEntries(
        hortifrutiEntries.map((row) => ({
          productId: row.product_id,
          productName:
            products.find((product) => product.id === row.product_id)?.name ??
            row.original_product_text ??
            "Produto sem identificação",
          audience: row.audience_code,
          service: row.service_code,
          date: row.consumption_date,
          quantity: Number(row.quantity),
          unit: row.quantity_unit,
        })),
      ),
    [hortifrutiEntries, products],
  );
  const pulpAnalysis = useMemo(() => {
    const flavors = new Map(
      (pulpFlavorsQuery.data ?? []).map((flavor) => [
        flavor.id,
        flavor.flavor_name,
      ]),
    );
    const entries = pulpEntries.map((row) => ({
      flavorId: row.flavor_id,
      originalFlavorText: row.original_flavor_text,
      audience: row.audience_code,
      service: row.service_code,
      date: row.consumption_date,
      quantity: row.quantity === null ? null : Number(row.quantity),
      unit: row.quantity_unit,
    }));
    const windows = (deliveryWindowsQuery.data ?? []).map((window) => ({
      id: window.id,
      label: window.label,
      fromDay: window.consumption_from,
      toDay: window.consumption_to,
    }));
    return {
      consolidated: consolidatePulpEntries(entries),
      allocation: allocatePulpByWeekday(entries, windows),
      flavorName: (id: string | null, original: string | null) =>
        id
          ? (flavors.get(id) ?? "Sabor cadastrado")
          : original?.trim() || "Sabor pendente",
      windowName: (id: string) =>
        windows.find((window) => window.id === id)?.label ?? "Faixa sem nome",
    };
  }, [deliveryWindowsQuery.data, pulpEntries, pulpFlavorsQuery.data]);

  return (
    <div className="page-shell space-y-5">
      <PageIntro
        title="Planejamento de Produção"
        description="Organize refeições por semana e público, consolide necessidades por produto e preserve os planejamentos históricos com rastreabilidade."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void queryClient.invalidateQueries({
                queryKey: ["production-plans"],
              });
              void queryClient.invalidateQueries({
                queryKey: ["production-plan-entries"],
              });
              void queryClient.invalidateQueries({
                queryKey: ["production-hortifruti-entries"],
              });
              void queryClient.invalidateQueries({
                queryKey: ["production-imports"],
              });
            }}
          >
            <RefreshCw /> Atualizar
          </Button>
        }
      />

      {profile && activeUnit && (
        <p className="text-sm text-muted-foreground">
          Unidade: <strong>{activeUnit.name}</strong> · Os lançamentos
          planejados não alteram o saldo nem geram movimentações.
        </p>
      )}
      {plansQuery.isError && (
        <BackendNotice>
          Não foi possível consultar planejamentos. Confirme se as migrations
          desta branch foram aplicadas ao ambiente local.
        </BackendNotice>
      )}
      {inventoryQuery.isError && (
        <BackendNotice>
          Não foi possível consultar o catálogo/estoque desta unidade. A
          inclusão de produtos depende do cadastro existente.
        </BackendNotice>
      )}
      {createPlan.error && (
        <BackendNotice>{createPlan.error.message}</BackendNotice>
      )}
      {saveEntry.error && (
        <BackendNotice>{saveEntry.error.message}</BackendNotice>
      )}

      <Tabs defaultValue="weekly">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="weekly">Semana e refeições</TabsTrigger>
          <TabsTrigger value="consolidation">Consolidação</TabsTrigger>
          <TabsTrigger value="realized">Planejado × saídas</TabsTrigger>
          <TabsTrigger value="deliveries">Entregas</TabsTrigger>
          <TabsTrigger value="thaw">Degelo</TabsTrigger>
          <TabsTrigger value="pulp">Polpas</TabsTrigger>
          <TabsTrigger value="hortifruti">Hortifruti</TabsTrigger>
          <TabsTrigger value="maps">Mapas diários</TabsTrigger>
          <TabsTrigger value="imports">Histórico de planilhas</TabsTrigger>
        </TabsList>

        {operationalMessage && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950"
          >
            {operationalMessage}
          </p>
        )}
        {createDelivery.error && (
          <BackendNotice>{createDelivery.error.message}</BackendNotice>
        )}
        {saveDeliveryWindow.error && (
          <BackendNotice>{saveDeliveryWindow.error.message}</BackendNotice>
        )}
        {confirmReceipt.error && (
          <BackendNotice>{confirmReceipt.error.message}</BackendNotice>
        )}
        {saveThaw.error && (
          <BackendNotice>{saveThaw.error.message}</BackendNotice>
        )}
        {saveThawRule.error && (
          <BackendNotice>{saveThawRule.error.message}</BackendNotice>
        )}
        {savePulp.error && (
          <BackendNotice>{savePulp.error.message}</BackendNotice>
        )}
        {saveHortifruti.error && (
          <BackendNotice>{saveHortifruti.error.message}</BackendNotice>
        )}
        {exportError && <BackendNotice>{exportError}</BackendNotice>}

        <TabsContent value="weekly" className="space-y-5">
          <Panel
            title="Semana de produção"
            description="Crie uma versão de planejamento. Os registros antigos não são sobrescritos."
          >
            <div className="grid gap-4 sm:grid-cols-[minmax(180px,260px)_auto] sm:items-end">
              <Field label="Primeiro dia da semana">
                <Input
                  type="date"
                  value={weekStart}
                  onChange={(event) => setWeekStart(event.target.value)}
                />
              </Field>
              <Button
                disabled={!unitId || createPlan.isPending}
                onClick={() => createPlan.mutate()}
              >
                {createPlan.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}
                Criar versão semanal
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Período: {weekStart} a {addDays(weekStart, 6)}. A criação não
              copia quantidades automaticamente.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(220px,1fr)_2fr]">
              <Field label="Planejamento">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedPlanId}
                  onChange={(event) => setSelectedPlanId(event.target.value)}
                >
                  <option value="">Selecione uma semana</option>
                  {(plansQuery.data ?? []).map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.title} · v{plan.version} · {plan.status}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedPlan && (
                <div className="surface flex items-center gap-3 p-3 text-sm">
                  <CalendarDays className="size-5 text-primary" />
                  <span>
                    <strong>{selectedPlan.week_start}</strong> a{" "}
                    <strong>{selectedPlan.week_end}</strong>
                    <br />
                    <span className="text-muted-foreground">
                      Versão {selectedPlan.version} · {selectedPlan.status}
                    </span>
                  </span>
                </div>
              )}
            </div>
            {selectedPlan && (
              <div className="mt-4 grid gap-3 rounded-lg border border-dashed p-4 sm:grid-cols-[minmax(240px,1fr)_auto] sm:items-end">
                <Field label="Copiar lançamentos de outro planejamento semanal">
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={copySourcePlanId}
                    onChange={(event) =>
                      setCopySourcePlanId(event.target.value)
                    }
                  >
                    <option value="">Selecione uma semana de referência</option>
                    {(plansQuery.data ?? [])
                      .filter((plan) => plan.id !== selectedPlan.id)
                      .map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.title} · v{plan.version} · {plan.status}
                        </option>
                      ))}
                  </select>
                </Field>
                <Button
                  variant="outline"
                  disabled={
                    !copySourcePlanId ||
                    entriesQuery.isLoading ||
                    entryRows.length > 0 ||
                    !canEditPlan ||
                    copyPlanEntries.isPending
                  }
                  onClick={() => copyPlanEntries.mutate()}
                >
                  {copyPlanEntries.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <FileUp />
                  )}
                  Copiar para semana vazia
                </Button>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  A cópia desloca as datas para a semana selecionada e preserva
                  os dados de origem. Só é permitida em um plano vazio; confira
                  os volumes antes da revisão.
                </p>
                {copyPlanEntries.error && (
                  <p
                    role="alert"
                    className="text-sm text-destructive sm:col-span-2"
                  >
                    {copyPlanEntries.error.message}
                  </p>
                )}
              </div>
            )}
            {selectedPlan && (
              <div className="mt-4 rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">Fluxo de revisão</p>
                    <p className="text-sm text-muted-foreground">
                      Status atual:{" "}
                      <strong>
                        {(
                          {
                            draft: "Rascunho",
                            filling: "Em preenchimento",
                            review: "Aguardando revisão",
                            approved: "Aprovado",
                            deliveries_scheduled: "Entregas programadas",
                            in_progress: "Em execução",
                            finished: "Concluído",
                            cancelled: "Cancelado",
                          } as Record<string, string>
                        )[selectedPlan.status] ?? selectedPlan.status}
                      </strong>
                      {canEditPlan && " · editar até enviar para revisão"}
                    </p>
                  </div>
                  {canEditPlan &&
                    profile &&
                    [
                      "admin",
                      "stock_manager",
                      "operator",
                      "purchasing_approver",
                      "super_admin",
                    ].includes(profile.role) && (
                      <Button
                        disabled={transitionPlan.isPending}
                        onClick={() =>
                          transitionPlan.mutate({ action: "submit_for_review" })
                        }
                      >
                        {transitionPlan.isPending ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Check />
                        )}
                        Enviar para revisão
                      </Button>
                    )}
                  {selectedPlan.status === "review" && canReviewPlans && (
                    <div className="grid w-full gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                      <Field label="Comentário ao devolver para ajuste">
                        <Input
                          maxLength={1000}
                          value={reviewFeedback}
                          onChange={(event) =>
                            setReviewFeedback(event.target.value)
                          }
                          placeholder="Explique o que precisa ser corrigido"
                        />
                      </Field>
                      <Button
                        variant="outline"
                        disabled={
                          transitionPlan.isPending || !reviewFeedback.trim()
                        }
                        onClick={() =>
                          transitionPlan.mutate({
                            action: "request_changes",
                            feedback: reviewFeedback,
                          })
                        }
                      >
                        Solicitar ajustes
                      </Button>
                      <Button
                        disabled={transitionPlan.isPending}
                        onClick={() =>
                          transitionPlan.mutate({ action: "approve" })
                        }
                      >
                        Aprovar planejamento
                      </Button>
                    </div>
                  )}
                  {selectedPlan.status === "approved" &&
                    profile &&
                    [
                      "admin",
                      "stock_manager",
                      "operator",
                      "purchasing_approver",
                      "super_admin",
                    ].includes(profile.role) && (
                      <Button
                        disabled={transitionPlan.isPending}
                        onClick={() =>
                          transitionPlan.mutate({ action: "start" })
                        }
                      >
                        Iniciar execução
                      </Button>
                    )}
                  {selectedPlan.status === "in_progress" && canReviewPlans && (
                    <Button
                      disabled={transitionPlan.isPending}
                      onClick={() =>
                        transitionPlan.mutate({ action: "finish" })
                      }
                    >
                      Concluir planejamento
                    </Button>
                  )}
                </div>
                {!canEditPlan && selectedPlan.status !== "review" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Os lançamentos ficam somente para consulta após o envio para
                    revisão. Uma devolução formal reabre a edição e mantém o
                    motivo registrado.
                  </p>
                )}
                {transitionPlan.error && (
                  <BackendNotice>{transitionPlan.error.message}</BackendNotice>
                )}
              </div>
            )}
          </Panel>

          <Panel
            title="Lançar refeição"
            description="Informe as unidades explicitamente. A necessidade só é calculada quando KG/PESSOA × PESSOA resulta na unidade do produto; nenhuma conversão é presumida."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Data de consumo">
                <Input
                  type="date"
                  min={selectedPlan?.week_start}
                  max={selectedPlan?.week_end}
                  value={entryDate}
                  onChange={(event) => setEntryDate(event.target.value)}
                />
              </Field>
              <Field label="Público">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={audience}
                  onChange={(event) =>
                    setAudience(event.target.value as "patient" | "server")
                  }
                >
                  <option value="patient">Paciente</option>
                  <option value="server">Servidor</option>
                </select>
              </Field>
              <Field label="Refeição">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={meal}
                  onChange={(event) => setMeal(event.target.value)}
                >
                  {MEALS.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Grupo / setor da preparação *">
                <Input
                  maxLength={120}
                  value={mealGroup}
                  onChange={(event) => setMealGroup(event.target.value)}
                  placeholder="Ex.: prato principal, opção, guarnição"
                />
              </Field>
              <Field label="Preparação">
                <Input
                  maxLength={200}
                  value={preparation}
                  onChange={(event) => setPreparation(event.target.value)}
                  placeholder="Nome da preparação"
                />
              </Field>
              <Field label="Produto ISP (opcional)">
                <Input
                  className="mb-2"
                  value={productSearchText}
                  onChange={(event) => setProductSearchText(event.target.value)}
                  placeholder="Buscar por nome ou SKU"
                  aria-label="Buscar produto por nome ou SKU"
                />
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={productId}
                  onChange={(event) => {
                    const next = products.find(
                      (item) => item.id === event.target.value,
                    );
                    setProductId(event.target.value);
                    if (next) {
                      setOriginalProductText(next.name);
                      setQuantityUnit(next.unit);
                    }
                  }}
                >
                  <option value="">Sem vínculo — revisar depois</option>
                  {selectedProduct &&
                    !productSearchResults.some(
                      (item) => item.id === selectedProduct.id,
                    ) && (
                      <option value={selectedProduct.id}>
                        {selectedProduct.name} ·{" "}
                        {selectedProduct.sku || selectedProduct.unit}
                      </option>
                    )}
                  {productSearchResults.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.sku || item.unit}
                    </option>
                  ))}
                </select>
              </Field>
              {!selectedProduct && (
                <Field label="Nome original do produto">
                  <Input
                    value={originalProductText}
                    onChange={(event) =>
                      setOriginalProductText(event.target.value)
                    }
                    placeholder="Preserve a descrição histórica"
                  />
                </Field>
              )}
              <Field label="Per capita">
                <Input
                  inputMode="decimal"
                  value={perCapitaText}
                  onChange={(event) => setPerCapitaText(event.target.value)}
                  placeholder="Ex.: 0,08"
                />
              </Field>
              <Field label="Unidade do per capita">
                <Input
                  value={perCapitaUnit}
                  onChange={(event) => setPerCapitaUnit(event.target.value)}
                  placeholder="KG/PESSOA"
                />
              </Field>
              <Field label="Volume">
                <Input
                  inputMode="decimal"
                  value={volumeText}
                  onChange={(event) => setVolumeText(event.target.value)}
                  placeholder="Ex.: 195"
                />
              </Field>
              <Field label="Unidade do volume">
                <Input
                  value={volumeUnit}
                  onChange={(event) => setVolumeUnit(event.target.value)}
                  placeholder="PESSOA"
                />
              </Field>
              <Field label="Unidade final">
                <Input
                  value={quantityUnit}
                  onChange={(event) => setQuantityUnit(event.target.value)}
                  placeholder="KG, UN, L..."
                />
              </Field>
              <Field label="Quantidade manual (opcional)">
                <Input
                  inputMode="decimal"
                  value={manualText}
                  onChange={(event) => setManualText(event.target.value)}
                  placeholder="Preencha apenas com justificativa"
                />
              </Field>
              {manualText && (
                <Field label="Motivo do ajuste manual">
                  <Input
                    value={manualReason}
                    onChange={(event) => setManualReason(event.target.value)}
                    placeholder="Por que o cálculo foi ajustado?"
                  />
                </Field>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
              <div>
                <p className="text-xs text-muted-foreground">
                  Necessidade calculada
                </p>
                <p className="text-lg font-semibold tabular">
                  {draftCalculation.calculatedQuantity === null
                    ? "Pendente de unidades/dados"
                    : draftCalculation.calculatedQuantity.toLocaleString(
                        "pt-BR",
                        { maximumFractionDigits: 6 },
                      ) +
                      " " +
                      quantityUnit}
                </p>
                {draftCalculation.pending.length > 0 && (
                  <p className="mt-1 text-xs text-amber-700">
                    {draftCalculation.pending.join(" ")}
                  </p>
                )}
              </div>
              {selectedProduct && (
                <p className="text-sm text-muted-foreground">
                  Saldo atual:{" "}
                  <strong>
                    {selectedProduct.balance.toLocaleString("pt-BR", {
                      maximumFractionDigits: 3,
                    })}{" "}
                    {selectedProduct.unit}
                  </strong>
                </p>
              )}
              <Button
                disabled={
                  !selectedPlan ||
                  !canEditPlan ||
                  !preparation.trim() ||
                  draftCalculation.finalQuantity === null ||
                  saveEntry.isPending
                }
                onClick={() => saveEntry.mutate()}
              >
                {saveEntry.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}{" "}
                {editingEntryId ? "Salvar alterações" : "Adicionar lançamento"}
              </Button>
              {editingEntryId && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingEntryId(null);
                    setPreparation("");
                    setOriginalProductText("");
                    setMealGroup("");
                    setPerCapitaText("");
                    setVolumeText("");
                    setManualText("");
                    setManualReason("");
                  }}
                >
                  Cancelar edição
                </Button>
              )}
            </div>
          </Panel>

          {selectedPlan && entryRows.length > 0 && (
            <Panel
              title="Conferência do mapa"
              description="Pendências para revisar antes de imprimir ou liberar esta versão. Os registros históricos sem grupo continuam identificados como pendentes."
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    label: "Sem grupo / setor",
                    count: entryRows.filter((row) => !row.meal_group?.trim())
                      .length,
                    detail: "Completar a coluna UNIDADE do mapa",
                  },
                  {
                    label: "Sem produto vinculado",
                    count: entryRows.filter((row) => !row.product_id).length,
                    detail: "Vincular ao catálogo ou revisar descrição",
                  },
                  {
                    label: "Sem quantidade final",
                    count: entryRows.filter(
                      (row) => row.final_quantity === null,
                    ).length,
                    detail: "Completar cálculo ou ajuste justificado",
                  },
                  {
                    label: "Ajustes manuais",
                    count: entryRows.filter(
                      (row) => row.manual_quantity !== null,
                    ).length,
                    detail: "Conferir quantidade e justificativa",
                  },
                ].map((item) => (
                  <div
                    className={`rounded-lg border p-3 ${item.count > 0 ? "border-amber-300 bg-amber-50/70" : "bg-muted/20"}`}
                    key={item.label}
                  >
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular">
                      {item.count}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title="Lançamentos da semana"
            description={`${filteredEntryRows.length} de ${entryRows.length} lançamentos · os produtos sem vínculo ficam pendentes e não entram na consolidação por produto.`}
          >
            {entriesQuery.isError && (
              <BackendNotice>
                Não foi possível carregar os lançamentos deste planejamento.
              </BackendNotice>
            )}
            {entriesQuery.isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Carregando...</p>
            ) : entryRows.length ? (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Field label="Buscar preparação ou produto">
                    <Input
                      value={entrySearchText}
                      onChange={(event) =>
                        setEntrySearchText(event.target.value)
                      }
                      placeholder="Digite para filtrar"
                    />
                  </Field>
                  <Field label="Data">
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={entryFilterDate}
                      onChange={(event) =>
                        setEntryFilterDate(event.target.value)
                      }
                    >
                      <option value="all">Toda a semana</option>
                      {[
                        ...new Set(
                          entryRows
                            .map((row) => row.consumption_date)
                            .filter((date): date is string => Boolean(date)),
                        ),
                      ]
                        .sort()
                        .map((date) => (
                          <option key={date} value={date}>
                            {formatOperationalDateLabel(date)}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Público">
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={entryFilterAudience}
                      onChange={(event) =>
                        setEntryFilterAudience(event.target.value)
                      }
                    >
                      <option value="all">Todos</option>
                      <option value="patient">Paciente</option>
                      <option value="server">Servidor</option>
                    </select>
                  </Field>
                  <Field label="Refeição">
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={entryFilterMeal}
                      onChange={(event) =>
                        setEntryFilterMeal(event.target.value)
                      }
                    >
                      <option value="all">Todas</option>
                      {MEALS.map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1050px] text-left text-sm">
                    <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                      <tr>
                        {[
                          "Data",
                          "Público",
                          "Refeição",
                          "Preparação",
                          "Grupo / setor",
                          "Produto",
                          "Calculado",
                          "Final",
                          "Ações",
                        ].map((label) => (
                          <th className="px-3 py-2" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredEntryRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2">
                            {row.consumption_date ?? "Data pendente"}
                          </td>
                          <td className="px-3 py-2">
                            {row.audience_code === "patient"
                              ? "Paciente"
                              : "Servidor"}
                          </td>
                          <td className="px-3 py-2">
                            {MEALS.find(
                              ([code]) => code === row.meal_code,
                            )?.[1] ?? row.meal_code}
                          </td>
                          <td className="px-3 py-2">{row.preparation}</td>
                          <td className="px-3 py-2">
                            {row.meal_group || "Pendente"}
                          </td>
                          <td className="px-3 py-2">
                            {products.find((item) => item.id === row.product_id)
                              ?.name ??
                              row.original_product_text ??
                              "Sem vínculo"}
                          </td>
                          <td className="px-3 py-2 tabular">
                            {row.calculated_quantity === null
                              ? "Pendente"
                              : Number(row.calculated_quantity).toLocaleString(
                                  "pt-BR",
                                ) +
                                " " +
                                (row.quantity_unit ?? "")}
                          </td>
                          <td className="px-3 py-2 tabular">
                            {row.final_quantity === null
                              ? "Pendente"
                              : Number(row.final_quantity).toLocaleString(
                                  "pt-BR",
                                ) +
                                " " +
                                (row.quantity_unit ?? "")}
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!canEditPlan}
                              onClick={() => {
                                setEditingEntryId(row.id);
                                setEntryDate(
                                  row.consumption_date ?? localDate(),
                                );
                                setAudience(row.audience_code);
                                setMeal(row.meal_code);
                                setMealGroup(row.meal_group ?? "");
                                setPreparation(row.preparation);
                                setProductId(row.product_id ?? "");
                                setProductSearchText(
                                  products.find(
                                    (product) => product.id === row.product_id,
                                  )?.name ?? "",
                                );
                                setOriginalProductText(
                                  row.original_product_text ?? "",
                                );
                                setPerCapitaText(
                                  row.per_capita === null
                                    ? ""
                                    : String(row.per_capita),
                                );
                                setPerCapitaUnit(
                                  row.per_capita_unit ?? "KG/PESSOA",
                                );
                                setVolumeText(
                                  row.volume === null ? "" : String(row.volume),
                                );
                                setVolumeUnit(row.volume_unit ?? "PESSOA");
                                setQuantityUnit(row.quantity_unit ?? "KG");
                                setManualText(
                                  row.manual_quantity === null
                                    ? ""
                                    : String(row.manual_quantity),
                                );
                                setManualReason(row.manual_reason ?? "");
                              }}
                            >
                              Revisar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredEntryRows.length === 0 && (
                  <p className="p-5 text-center text-sm text-muted-foreground">
                    Nenhum lançamento corresponde aos filtros.
                  </p>
                )}
              </>
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma refeição lançada nesta semana.
              </p>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="consolidation" className="space-y-5">
          <Panel
            title="Consolidação por produto"
            description="Agrupamento por UUID e unidade. Estoque é somente consultado; quantidade planejada não reserva nem baixa saldo."
          >
            {!selectedPlan && (
              <p className="p-6 text-sm text-muted-foreground">
                Selecione um plano semanal.
              </p>
            )}
            {selectedPlan && consolidation.totals.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                    <tr>
                      {[
                        "Produto",
                        "Unidade",
                        "Pacientes",
                        "Servidores",
                        "Total",
                        "Saldo atual",
                        "Diferença",
                      ].map((label) => (
                        <th className="px-3 py-2" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {consolidation.totals.map((row) => {
                      const product = products.find(
                        (item) => item.id === row.productId,
                      );
                      const remaining = product
                        ? product.balance - row.total
                        : null;
                      return (
                        <tr key={row.productId + row.unit}>
                          <td className="px-3 py-2 font-medium">
                            {product?.name ?? row.productName}
                          </td>
                          <td className="px-3 py-2">{row.unit}</td>
                          <td className="px-3 py-2 tabular">
                            {row.patients.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-3 py-2 tabular">
                            {row.servers.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-3 py-2 tabular font-semibold">
                            {row.total.toLocaleString("pt-BR")} {row.unit}
                          </td>
                          <td className="px-3 py-2 tabular">
                            {product
                              ? product.balance.toLocaleString("pt-BR") +
                                " " +
                                product.unit
                              : "Sem saldo vinculado"}
                          </td>
                          <td className="px-3 py-2 tabular">
                            {remaining === null
                              ? "—"
                              : remaining.toLocaleString("pt-BR") +
                                " " +
                                row.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Ainda não há quantidades consolidadas por produto.
              </p>
            )}
            {consolidation.pendingEntries.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <strong>
                  <AlertTriangle className="mr-1 inline size-4" />
                  {consolidation.pendingEntries.length} lançamento(s)
                  pendente(s)
                </strong>
                <p>
                  Há produto sem UUID, quantidade incompleta ou unidade ausente.
                  Revise antes de usar a consolidação em pedido.
                </p>
              </div>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="realized" className="space-y-5">
          <Panel
            title="Planejado × saídas de estoque"
            description="Compara as quantidades planejadas com as baixas de estoque registradas no mesmo dia e serviço. A baixa representa retirada do almoxarifado, não confirmação de refeição servida."
          >
            {!selectedPlan ? (
              <p className="p-6 text-sm text-muted-foreground">
                Selecione um plano semanal.
              </p>
            ) : realizedExitBatchesQuery.isError ||
              realizedExitBatchItemsQuery.isError ||
              realizedStockMovementsQuery.isError ? (
              <BackendNotice>
                Não foi possível consultar todas as saídas de estoque deste
                período. A comparação foi ocultada para não apresentar dados
                parciais.
              </BackendNotice>
            ) : (
              <>
                <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                  Comparação disponível para desjejum, colação, almoço e lanche,
                  quando produto e unidade coincidem. Jantar e ceia precisam de
                  equivalência de serviço confirmada; polpas não têm vínculo com
                  produto de estoque. Registros anteriores à captura da unidade
                  também ficam fora da comparação. Esses itens aparecem como não
                  comparáveis.
                </div>
                {realizedExitBatchesQuery.isLoading ||
                realizedExitBatchItemsQuery.isLoading ||
                realizedStockMovementsQuery.isLoading ? (
                  <p className="p-5 text-sm text-muted-foreground">
                    Consultando saídas registradas…
                  </p>
                ) : plannedVsStockExits.rows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-sm">
                      <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                        <tr>
                          {[
                            "Data",
                            "Serviço",
                            "Produto",
                            "Unidade",
                            "Planejado",
                            "Saída registrada",
                            "Diferença",
                          ].map((label) => (
                            <th className="px-3 py-2" key={label}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {plannedVsStockExits.rows.map((row) => (
                          <tr key={row.key}>
                            <td className="px-3 py-2">
                              {formatOperationalDateLabel(row.date)}
                            </td>
                            <td className="px-3 py-2">
                              {STOCK_SERVICE_LABEL[row.serviceCode] ??
                                row.serviceCode}
                            </td>
                            <td className="px-3 py-2 font-medium">
                              {row.productName}
                            </td>
                            <td className="px-3 py-2">{row.unit}</td>
                            <td className="px-3 py-2 tabular">
                              {row.planned.toLocaleString("pt-BR")}
                            </td>
                            <td className="px-3 py-2 tabular">
                              {row.actual.toLocaleString("pt-BR")}
                            </td>
                            <td
                              className={`px-3 py-2 tabular font-semibold ${row.difference > 0 ? "text-rose-700" : row.difference < 0 ? "text-amber-700" : "text-emerald-700"}`}
                            >
                              {row.difference > 0 ? "+" : ""}
                              {row.difference.toLocaleString("pt-BR")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="p-5 text-center text-sm text-muted-foreground">
                    Ainda não há itens comparáveis no plano nem saídas
                    registradas para os quatro serviços mapeados.
                  </p>
                )}
                {(plannedVsStockExits.plannedUnmatched.length > 0 ||
                  plannedVsStockExits.actualUnmatched.length > 0) && (
                  <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <strong>Itens fora da comparação</strong>
                    <p className="mt-1">
                      {plannedVsStockExits.plannedUnmatched.length} item(ns)
                      planejado(s) e{" "}
                      {plannedVsStockExits.actualUnmatched.length}
                      saída(s) sem serviço, produto, unidade compatível ou
                      código confirmado. Confira os vínculos antes de tirar
                      conclusões.
                    </p>
                  </div>
                )}
                {pulpEntries.length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {pulpEntries.length} lançamento(s) de polpa não
                    comparado(s): o cadastro de sabor ainda não identifica o
                    produto de estoque.
                  </p>
                )}
              </>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="deliveries" className="space-y-5">
          <Panel
            title="Gerar entrega planejada"
            description="A entrega reúne somente produtos vinculados e quantidades consolidadas. A conferência registra o recebido, mas não movimenta o estoque."
          >
            <div className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
              <Field label="Identificação da entrega">
                <Input
                  maxLength={100}
                  value={deliveryLabel}
                  onChange={(event) => setDeliveryLabel(event.target.value)}
                  placeholder="Ex.: 1ª entrega de proteínas"
                />
              </Field>
              <Field label="Data específica (opcional)">
                <Input
                  type="date"
                  min={selectedPlan?.week_start}
                  max={selectedPlan?.week_end}
                  value={deliveryDate}
                  onChange={(event) => setDeliveryDate(event.target.value)}
                />
              </Field>
              <Field label="Janela configurada">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={deliveryWindowId}
                  onChange={(event) => setDeliveryWindowId(event.target.value)}
                >
                  <option value="">Semana inteira</option>
                  {(deliveryWindowsQuery.data ?? []).map((window) => (
                    <option key={window.id} value={window.id}>
                      {window.sequence_number}. {window.label} ·{" "}
                      {WEEKDAYS[window.consumption_from]}–
                      {WEEKDAYS[window.consumption_to]}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                disabled={
                  !selectedPlan ||
                  consolidation.totals.length === 0 ||
                  createDelivery.isPending
                }
                onClick={() => createDelivery.mutate()}
              >
                {createDelivery.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}{" "}
                Gerar entrega
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Uma janela usa os dias configurados (domingo = 0 a sábado = 6).
              Datas sem registro ficam fora da consolidação; lançamentos sem
              data continuam pendentes para alocação manual.
            </p>
          </Panel>
          {(profile?.role === "admin" || profile?.role === "stock_manager") && (
            <Panel
              title="Configurar janelas de entrega"
              description="As faixas refletem os dias de consumo atendidos por cada entrega e podem ser ajustadas sem alterar os lançamentos históricos."
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Field label="Código">
                  <Input
                    maxLength={60}
                    value={windowCode}
                    onChange={(event) => setWindowCode(event.target.value)}
                    placeholder="entrega_1"
                  />
                </Field>
                <Field label="Nome da entrega">
                  <Input
                    maxLength={100}
                    value={windowLabel}
                    onChange={(event) => setWindowLabel(event.target.value)}
                    placeholder="1ª entrega"
                  />
                </Field>
                <Field label="Dia inicial">
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={windowFrom}
                    onChange={(event) => setWindowFrom(event.target.value)}
                  >
                    {WEEKDAYS.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Dia final">
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={windowTo}
                    onChange={(event) => setWindowTo(event.target.value)}
                  >
                    {WEEKDAYS.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Ordem">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={windowSequence}
                    onChange={(event) => setWindowSequence(event.target.value)}
                  />
                </Field>
              </div>
              <Button
                className="mt-3"
                disabled={saveDeliveryWindow.isPending}
                onClick={() => saveDeliveryWindow.mutate()}
              >
                {saveDeliveryWindow.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}{" "}
                Salvar janela
              </Button>
              <div className="mt-3 flex flex-wrap gap-2">
                {(deliveryWindowsQuery.data ?? []).map((window) => (
                  <span
                    key={window.id}
                    className="rounded-full bg-muted px-3 py-1 text-xs"
                  >
                    {window.sequence_number}. {window.label}:{" "}
                    {WEEKDAYS[window.consumption_from]}–
                    {WEEKDAYS[window.consumption_to]}
                  </span>
                ))}
              </div>
            </Panel>
          )}
          <Panel
            title="Entregas e conferência"
            description="Diferenças entre solicitado e recebido ficam registradas para revisão."
          >
            {deliveryQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Carregando entregas…
              </p>
            ) : (deliveryQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma entrega gerada para este planejamento.
              </p>
            ) : (
              <div className="space-y-5">
                {(deliveryQuery.data ?? []).map((delivery) => {
                  const items = (deliveryItemsQuery.data ?? []).filter(
                    (item) => item.delivery_id === delivery.id,
                  );
                  return (
                    <section
                      key={delivery.id}
                      className="rounded-lg border p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-semibold">{delivery.label}</h3>
                          <p className="text-xs text-muted-foreground">
                            {delivery.scheduled_for ??
                              (delivery.window_id
                                ? ((deliveryWindowsQuery.data ?? []).find(
                                    (window) =>
                                      window.id === delivery.window_id,
                                  )?.label ?? "Janela arquivada")
                                : "Total semanal")}{" "}
                            · {delivery.status}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {items.length} item(ns) vinculados
                        </span>
                      </div>
                      {items.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[650px] text-left text-sm">
                            <thead className="bg-muted/50 text-xs uppercase">
                              <tr>
                                {[
                                  "Produto",
                                  "Solicitado",
                                  "Recebido",
                                  "Diferença",
                                  "Conferir recebimento",
                                ].map((label) => (
                                  <th key={label} className="px-3 py-2">
                                    {label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {items.map((item) => {
                                const received =
                                  item.received_quantity === null
                                    ? null
                                    : Number(item.received_quantity);
                                const requested = Number(
                                  item.requested_quantity,
                                );
                                const draft =
                                  receiptDrafts[item.id] ??
                                  (received === null
                                    ? String(requested)
                                    : String(received));
                                const parsed = Number(draft.replace(",", "."));
                                return (
                                  <tr key={item.id}>
                                    <td className="px-3 py-2">
                                      {products.find(
                                        (product) =>
                                          product.id === item.product_id,
                                      )?.name ??
                                        item.original_product_text ??
                                        "Produto não identificado"}
                                    </td>
                                    <td className="px-3 py-2">
                                      {requested.toLocaleString("pt-BR")}{" "}
                                      {item.quantity_unit}
                                    </td>
                                    <td className="px-3 py-2">
                                      {received === null
                                        ? "Pendente"
                                        : received.toLocaleString("pt-BR") +
                                          " " +
                                          item.quantity_unit}
                                    </td>
                                    <td className="px-3 py-2">
                                      {received === null
                                        ? "—"
                                        : (received - requested).toLocaleString(
                                            "pt-BR",
                                          ) +
                                          " " +
                                          item.quantity_unit}
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="flex gap-2">
                                        <Input
                                          className="w-28"
                                          inputMode="decimal"
                                          aria-label="Quantidade recebida"
                                          value={draft}
                                          onChange={(event) =>
                                            setReceiptDrafts((current) => ({
                                              ...current,
                                              [item.id]: event.target.value,
                                            }))
                                          }
                                        />
                                        <Button
                                          size="sm"
                                          disabled={
                                            !Number.isFinite(parsed) ||
                                            parsed < 0 ||
                                            confirmReceipt.isPending
                                          }
                                          onClick={() =>
                                            confirmReceipt.mutate({
                                              itemId: item.id,
                                              quantity: parsed,
                                            })
                                          }
                                        >
                                          Confirmar
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm text-amber-800">
                          Sem itens vinculados. Revise os lançamentos pendentes
                          antes de usar esta entrega.
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="thaw" className="space-y-5">
          <Panel
            title="Programar degelo"
            description="O horário de retirada é calculado a partir do horário de consumo e da antecedência informada. O agendamento não modifica o saldo do estoque."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Produto">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={thawProductId}
                  onChange={(event) => {
                    const product = products.find(
                      (item) => item.id === event.target.value,
                    );
                    setThawProductId(event.target.value);
                    if (product) {
                      setThawUnit(product.unit);
                      const rule =
                        (thawRulesQuery.data ?? []).find(
                          (item) =>
                            item.product_id === product.id &&
                            item.unit_id === unitId,
                        ) ??
                        (thawRulesQuery.data ?? []).find(
                          (item) =>
                            item.product_id === product.id &&
                            item.unit_id === null,
                        );
                      const fish = /peix/i.test(
                        product.name + " " + product.categoryName,
                      );
                      setThawLeadHours(
                        String(rule?.lead_hours ?? (fish ? 24 : "")),
                      );
                      setThawRuleHours(
                        String(rule?.lead_hours ?? (fish ? 24 : 24)),
                      );
                      setThawRuleLabel(
                        rule?.label ??
                          (fish
                            ? "Degelo de peixe"
                            : "Prazo de degelo · " + product.name),
                      );
                    }
                  }}
                >
                  <option value="">Selecione o produto</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.unit}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Data de consumo">
                <Input
                  type="date"
                  min={selectedPlan?.week_start}
                  max={selectedPlan?.week_end}
                  value={thawConsumptionDate}
                  onChange={(event) =>
                    setThawConsumptionDate(event.target.value)
                  }
                />
              </Field>
              <Field label="Horário de consumo">
                <Input
                  type="time"
                  value={thawConsumptionTime}
                  onChange={(event) =>
                    setThawConsumptionTime(event.target.value)
                  }
                />
              </Field>
              <Field label="Antecedência (horas)">
                <Input
                  type="number"
                  min="0"
                  max="720"
                  step="1"
                  value={thawLeadHours}
                  onChange={(event) => setThawLeadHours(event.target.value)}
                  placeholder="Informe em horas"
                />
              </Field>
              <Field label="Quantidade (opcional)">
                <Input
                  inputMode="decimal"
                  value={thawQuantity}
                  onChange={(event) => setThawQuantity(event.target.value)}
                  placeholder="Quantidade a retirar"
                />
              </Field>
              <Field label="Unidade">
                <Input
                  value={thawUnit}
                  onChange={(event) => setThawUnit(event.target.value)}
                />
              </Field>
            </div>
            {/peix/i.test(
              (products.find((product) => product.id === thawProductId)?.name ??
                "") +
                " " +
                (products.find((product) => product.id === thawProductId)
                  ?.categoryName ?? ""),
            ) &&
              Number(thawLeadHours) !== 24 && (
                <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  A referência operacional define 24 horas para peixe. Confirme
                  qualquer prazo diferente antes de salvar.
                </p>
              )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                disabled={
                  !selectedPlan ||
                  !thawProductId ||
                  !thawLeadHours ||
                  saveThaw.isPending
                }
                onClick={() => saveThaw.mutate()}
              >
                {saveThaw.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}{" "}
                Programar degelo
              </Button>
              <span className="text-sm text-muted-foreground">
                Retirada prevista:{" "}
                {(() => {
                  const consumption = operationalDateTimeToIso(
                    thawConsumptionDate,
                    thawConsumptionTime,
                  );
                  const calculated = consumption
                    ? calculateThawAt(consumption, Number(thawLeadHours))
                    : null;
                  return calculated ? formatDateTime(calculated) : "—";
                })()}
              </span>
            </div>
          </Panel>
          {(profile?.role === "admin" || profile?.role === "stock_manager") && (
            <Panel
              title="Prazo padrão do produto"
              description="Uma regra cadastrada prevalece sobre o prazo digitado no agendamento. O padrão de 24 horas para peixe também é validado no banco."
            >
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end">
                <Field label="Produto selecionado">
                  <Input
                    readOnly
                    value={
                      products.find((item) => item.id === thawProductId)
                        ?.name ?? "Selecione acima"
                    }
                  />
                </Field>
                <Field label="Descrição da regra">
                  <Input
                    maxLength={100}
                    value={thawRuleLabel}
                    onChange={(event) => setThawRuleLabel(event.target.value)}
                    placeholder="Ex.: Degelo de peixe"
                  />
                </Field>
                <Field label="Antecedência (horas)">
                  <Input
                    type="number"
                    min="0"
                    max="720"
                    value={thawRuleHours}
                    onChange={(event) => {
                      setThawRuleHours(event.target.value);
                      setThawLeadHours(event.target.value);
                    }}
                  />
                </Field>
                <Button
                  disabled={!thawProductId || saveThawRule.isPending}
                  onClick={() => saveThawRule.mutate()}
                >
                  {saveThawRule.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Plus />
                  )}{" "}
                  Salvar regra
                </Button>
              </div>
              {(thawRulesQuery.data ?? []).length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {(thawRulesQuery.data ?? []).map((rule) => (
                    <li
                      key={rule.id}
                      className="rounded-full bg-muted px-3 py-1 text-xs"
                    >
                      {rule.label}: {rule.lead_hours} h{" "}
                      {rule.unit_id === null
                        ? "· todas as unidades"
                        : "· unidade ativa"}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          <Panel
            title="Programações de degelo"
            description="Os agendamentos são preservados independentemente das quantidades das refeições."
          >
            {(thawQuery.data ?? []).length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[750px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase">
                    <tr>
                      {[
                        "Produto",
                        "Consumo",
                        "Retirada",
                        "Antecedência",
                        "Quantidade",
                        "Situação",
                      ].map((label) => (
                        <th key={label} className="px-3 py-2">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(thawQuery.data ?? []).map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2">
                          {products.find(
                            (product) => product.id === row.product_id,
                          )?.name ??
                            row.original_product_text ??
                            "Produto pendente"}
                        </td>
                        <td className="px-3 py-2">
                          {formatDateTime(row.consumption_at)}
                        </td>
                        <td className="px-3 py-2">
                          {row.planned_thaw_at
                            ? formatDateTime(row.planned_thaw_at)
                            : "Não calculada"}
                        </td>
                        <td className="px-3 py-2">
                          {row.lead_hours ?? "Pendente"} h
                        </td>
                        <td className="px-3 py-2">
                          {row.quantity === null
                            ? "Não informada"
                            : Number(row.quantity).toLocaleString("pt-BR") +
                              " " +
                              (row.quantity_unit ?? "")}
                        </td>
                        <td className="px-3 py-2">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum degelo programado.
              </p>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="pulp" className="space-y-5">
          <Panel
            title="Lançar polpa"
            description="Polpas ficam separadas das proteínas e não são convertidas nem somadas ao estoque."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Field label="Data">
                <Input
                  type="date"
                  min={selectedPlan?.week_start}
                  max={selectedPlan?.week_end}
                  value={pulpDate}
                  onChange={(event) => setPulpDate(event.target.value)}
                />
              </Field>
              <Field label="Público">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={pulpAudience}
                  onChange={(event) => {
                    setPulpAudience(event.target.value as "patient" | "server");
                    setPulpService(
                      event.target.value === "patient"
                        ? "colacao"
                        : "breakfast",
                    );
                  }}
                >
                  <option value="patient">Paciente</option>
                  <option value="server">Servidor</option>
                </select>
              </Field>
              <Field label="Serviço">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={pulpService}
                  onChange={(event) => setPulpService(event.target.value)}
                >
                  {(pulpAudience === "patient"
                    ? [
                        ["morning_snack", "Colação"],
                        ["lunch", "Almoço"],
                        ["afternoon_snack", "Lanche"],
                      ]
                    : [
                        ["breakfast", "Desjejum"],
                        ["lunch", "Almoço"],
                        ["dinner", "Jantar"],
                        ["supper", "Ceia"],
                      ]
                  ).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sabor cadastrado">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={pulpFlavorId}
                  onChange={(event) => setPulpFlavorId(event.target.value)}
                >
                  <option value="">Outro / histórico</option>
                  {(pulpFlavorsQuery.data ?? []).map((flavor) => (
                    <option key={flavor.id} value={flavor.id}>
                      {flavor.flavor_name}
                    </option>
                  ))}
                </select>
              </Field>
              {!pulpFlavorId && (
                <Field label="Sabor original">
                  <Input
                    value={pulpFlavorText}
                    onChange={(event) => setPulpFlavorText(event.target.value)}
                    placeholder="Preserve o nome informado"
                  />
                </Field>
              )}
              <Field label="Quantidade (KG)">
                <Input
                  inputMode="decimal"
                  value={pulpQuantity}
                  onChange={(event) => setPulpQuantity(event.target.value)}
                  placeholder="Ex.: 12,5"
                />
              </Field>
            </div>
            <Button
              className="mt-4"
              disabled={!selectedPlan || !pulpQuantity || savePulp.isPending}
              onClick={() => savePulp.mutate()}
            >
              {savePulp.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Plus />
              )}{" "}
              Adicionar polpa
            </Button>
          </Panel>
          <Panel
            title="Consolidação de polpas"
            description="Totais por sabor, público, serviço, data e unidade. As faixas usam as janelas de entrega configuradas; não convertem unidades nem afetam o estoque."
          >
            {pulpEntries.length ? (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Lançamentos consolidados
                    </span>
                    <p className="font-semibold">
                      {pulpAnalysis.consolidated.rows.length}
                    </p>
                  </div>
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Distribuídos em faixas
                    </span>
                    <p className="font-semibold">
                      {pulpAnalysis.allocation.allocations.length}
                    </p>
                  </div>
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Pendentes de consolidação
                    </span>
                    <p className="font-semibold">
                      {pulpAnalysis.consolidated.pending.length}
                    </p>
                  </div>
                </div>
                {pulpAnalysis.allocation.allocations.length > 0 && (
                  <div className="mb-5 overflow-x-auto">
                    <h3 className="mb-2 font-semibold">
                      Totais por faixa de entrega
                    </h3>
                    <table className="w-full min-w-[700px] text-left text-sm">
                      <thead className="bg-muted/50 text-xs uppercase">
                        <tr>
                          {[
                            "Faixa",
                            "Data de consumo",
                            "Sabor",
                            "Público",
                            "Serviço",
                            "Total",
                          ].map((label) => (
                            <th key={label} className="px-3 py-2">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {pulpAnalysis.allocation.allocations.map(
                          (row, index) => (
                            <tr
                              key={`${row.windowId}-${row.flavorId ?? row.originalFlavorText}-${row.audience}-${row.service}-${index}`}
                            >
                              <td className="px-3 py-2">
                                {pulpAnalysis.windowName(row.windowId)}
                              </td>
                              <td className="px-3 py-2">Por faixa semanal</td>
                              <td className="px-3 py-2">
                                {pulpAnalysis.flavorName(
                                  row.flavorId,
                                  row.originalFlavorText,
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {row.audience === "patient"
                                  ? "Paciente"
                                  : "Servidor"}
                              </td>
                              <td className="px-3 py-2">
                                {row.service ?? "Não informado"}
                              </td>
                              <td className="px-3 py-2">
                                {row.quantity.toLocaleString("pt-BR")}{" "}
                                {row.unit}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <h3 className="mb-2 font-semibold">
                    Totais por dia e público
                  </h3>
                  <table className="w-full min-w-[700px] text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase">
                      <tr>
                        {[
                          "Data",
                          "Sabor",
                          "Público",
                          "Serviço",
                          "Quantidade",
                        ].map((label) => (
                          <th key={label} className="px-3 py-2">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pulpAnalysis.consolidated.rows.map((row, index) => (
                        <tr
                          key={`${row.flavorId ?? row.originalFlavorText}-${row.date}-${row.audience}-${row.service}-${index}`}
                        >
                          <td className="px-3 py-2">
                            {row.date ?? "Data pendente"}
                          </td>
                          <td className="px-3 py-2">
                            {pulpAnalysis.flavorName(
                              row.flavorId,
                              row.originalFlavorText,
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {row.audience === "patient"
                              ? "Paciente"
                              : "Servidor"}
                          </td>
                          <td className="px-3 py-2">
                            {row.service ?? "Não informado"}
                          </td>
                          <td className="px-3 py-2">
                            {row.total.toLocaleString("pt-BR")} {row.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pulpAnalysis.allocation.unallocated.length > 0 && (
                  <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    {pulpAnalysis.allocation.unallocated.length} lançamento(s)
                    ainda não podem ser distribuídos: falta data, quantidade,
                    unidade ou faixa configurada.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma polpa lançada para este planejamento.
              </p>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="hortifruti" className="space-y-5">
          {hortifrutiQuery.isError && (
            <BackendNotice>
              Não foi possível consultar Hortifruti. Confira se a migration
              local desta funcionalidade foi aplicada.
            </BackendNotice>
          )}
          <Panel
            title="Planejar Hortifruti"
            description="Registre a quantidade prevista para cada data, público e serviço. Escolha um produto do ISP ou preserve a descrição original; quantidade e unidade são explícitas e não afetam o estoque."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Data de consumo">
                <Input
                  type="date"
                  min={selectedPlan?.week_start}
                  max={selectedPlan?.week_end}
                  value={hortifrutiDate}
                  onChange={(event) => setHortifrutiDate(event.target.value)}
                />
              </Field>
              <Field label="Público">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={hortifrutiAudience}
                  onChange={(event) =>
                    setHortifrutiAudience(
                      event.target.value as "patient" | "server",
                    )
                  }
                >
                  <option value="patient">Paciente</option>
                  <option value="server">Servidor</option>
                </select>
              </Field>
              <Field label="Serviço">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={hortifrutiService}
                  onChange={(event) => setHortifrutiService(event.target.value)}
                >
                  {MEALS.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Produto cadastrado (opcional)">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={hortifrutiProductId}
                  onChange={(event) => {
                    const product = products.find(
                      (item) => item.id === event.target.value,
                    );
                    setHortifrutiProductId(event.target.value);
                    if (product) {
                      setHortifrutiOriginalName(product.name);
                      setHortifrutiUnit(product.unit);
                    }
                  }}
                >
                  <option value="">Sem vínculo — informar nome</option>
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.unit}
                    </option>
                  ))}
                </select>
              </Field>
              {!hortifrutiProductId && (
                <Field label="Nome original do item">
                  <Input
                    maxLength={200}
                    value={hortifrutiOriginalName}
                    onChange={(event) =>
                      setHortifrutiOriginalName(event.target.value)
                    }
                    placeholder="Ex.: tomate, alface, banana"
                  />
                </Field>
              )}
              <Field label="Unidade">
                <Input
                  maxLength={30}
                  value={hortifrutiUnit}
                  onChange={(event) => setHortifrutiUnit(event.target.value)}
                  placeholder="KG, UN, maço..."
                />
              </Field>
              <Field label="Per capita (opcional)">
                <Input
                  inputMode="decimal"
                  value={hortifrutiPerCapita}
                  onChange={(event) =>
                    setHortifrutiPerCapita(event.target.value)
                  }
                  placeholder="Ex.: 0,08"
                />
              </Field>
              <Field label="Unidade do per capita">
                <Input
                  maxLength={40}
                  value={hortifrutiPerCapitaUnit}
                  onChange={(event) =>
                    setHortifrutiPerCapitaUnit(event.target.value)
                  }
                  placeholder="KG/PESSOA"
                />
              </Field>
              <Field label="Volume (opcional)">
                <Input
                  inputMode="decimal"
                  value={hortifrutiVolume}
                  onChange={(event) => setHortifrutiVolume(event.target.value)}
                  placeholder="Ex.: 250"
                />
              </Field>
              <Field label="Unidade do volume">
                <Input
                  maxLength={30}
                  value={hortifrutiVolumeUnit}
                  onChange={(event) =>
                    setHortifrutiVolumeUnit(event.target.value)
                  }
                  placeholder="PESSOA"
                />
              </Field>
              <Field label="Ajuste manual do total (opcional)">
                <Input
                  inputMode="decimal"
                  value={hortifrutiQuantity}
                  onChange={(event) =>
                    setHortifrutiQuantity(event.target.value)
                  }
                  placeholder="Use se precisar substituir o cálculo"
                />
              </Field>
              {hortifrutiQuantity.trim() && (
                <Field label="Motivo do ajuste manual">
                  <Input
                    maxLength={500}
                    value={hortifrutiManualReason}
                    onChange={(event) =>
                      setHortifrutiManualReason(event.target.value)
                    }
                    placeholder="Explique por que o total foi ajustado"
                  />
                </Field>
              )}
              <Field label="Observação (opcional)">
                <Input
                  maxLength={500}
                  value={hortifrutiNotes}
                  onChange={(event) => setHortifrutiNotes(event.target.value)}
                  placeholder="Detalhe do preparo ou entrega"
                />
              </Field>
            </div>
            <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">Conferência do quantitativo</p>
              {hortifrutiCalculation.calculatedQuantity !== null ? (
                <p className="mt-1 text-muted-foreground">
                  {hortifrutiPerCapita} {hortifrutiPerCapitaUnit} ×{" "}
                  {hortifrutiVolume} {hortifrutiVolumeUnit} ={" "}
                  <strong className="text-foreground">
                    {hortifrutiCalculation.calculatedQuantity.toLocaleString(
                      "pt-BR",
                    )}{" "}
                    {hortifrutiUnit}
                  </strong>
                  {parsedHortifrutiManual !== null &&
                    hortifrutiCalculation.finalQuantity !== null && (
                      <>
                        {" "}
                        · total ajustado:{" "}
                        <strong className="text-foreground">
                          {hortifrutiCalculation.finalQuantity.toLocaleString(
                            "pt-BR",
                          )}{" "}
                          {hortifrutiUnit}
                        </strong>
                      </>
                    )}
                </p>
              ) : parsedHortifrutiManual !== null ? (
                <p className="mt-1 text-muted-foreground">
                  Total manual: {parsedHortifrutiManual.toLocaleString("pt-BR")}{" "}
                  {hortifrutiUnit}. Informe o motivo do ajuste.
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  Informe per capita e volume para calcular automaticamente. As
                  unidades devem corresponder exatamente; não há conversão
                  automática.
                </p>
              )}
              {!hortifrutiFormulaComplete && (
                <p className="mt-1 text-destructive">
                  Preencha per capita e volume juntos.
                </p>
              )}
              {parsedHortifrutiPerCapita !== null &&
                parsedHortifrutiVolume !== null &&
                hortifrutiCalculation.calculatedQuantity === null &&
                hortifrutiCalculationIssues.length > 0 && (
                  <p className="mt-1 text-destructive">
                    {hortifrutiCalculationIssues.join(" ")}
                  </p>
                )}
            </div>
            <Button
              className="mt-4"
              disabled={
                !selectedPlan || !hortifrutiCanSave || saveHortifruti.isPending
              }
              onClick={() => saveHortifruti.mutate()}
            >
              {saveHortifruti.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Plus />
              )}{" "}
              Adicionar Hortifruti
            </Button>
          </Panel>
          <Panel
            title="Consolidação de Hortifruti"
            description="Agrupa apenas itens vinculados ao catálogo e mantém separados data, público, serviço e unidade. Itens sem vínculo continuam visíveis na lista para revisão."
          >
            {hortifrutiEntries.length ? (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Lançamentos
                    </span>
                    <p className="font-semibold">{hortifrutiEntries.length}</p>
                  </div>
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Linhas consolidadas
                    </span>
                    <p className="font-semibold">
                      {hortifrutiAnalysis.rows.length}
                    </p>
                  </div>
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Pendentes de vínculo
                    </span>
                    <p className="font-semibold">
                      {hortifrutiAnalysis.pending.length}
                    </p>
                  </div>
                </div>
                {hortifrutiAnalysis.rows.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-muted/50 text-xs uppercase">
                        <tr>
                          {[
                            "Data",
                            "Produto",
                            "Serviço",
                            "Unidade",
                            "Pacientes",
                            "Servidores",
                            "Total",
                          ].map((label) => (
                            <th key={label} className="px-3 py-2">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {hortifrutiAnalysis.rows.map((row, index) => (
                          <tr
                            key={`${row.productId}-${row.unit}-${row.date}-${row.audience}-${row.service}-${index}`}
                          >
                            <td className="px-3 py-2">{row.date}</td>
                            <td className="px-3 py-2 font-medium">
                              {row.productName}
                            </td>
                            <td className="px-3 py-2">
                              {MEALS.find(
                                ([code]) => code === row.service,
                              )?.[1] ?? row.service}
                            </td>
                            <td className="px-3 py-2">{row.unit}</td>
                            <td className="px-3 py-2 tabular">
                              {row.patients.toLocaleString("pt-BR")}
                            </td>
                            <td className="px-3 py-2 tabular">
                              {row.servers.toLocaleString("pt-BR")}
                            </td>
                            <td className="px-3 py-2 tabular font-semibold">
                              {row.total.toLocaleString("pt-BR")} {row.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-5 overflow-x-auto">
                  <h3 className="mb-2 font-semibold">
                    Lançamentos registrados
                  </h3>
                  <table className="w-full min-w-[1120px] text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase">
                      <tr>
                        {[
                          "Data",
                          "Público",
                          "Serviço",
                          "Item",
                          "Per capita",
                          "Volume",
                          "Total calculado",
                          "Quantidade final",
                          "Observação",
                        ].map((label) => (
                          <th key={label} className="px-3 py-2">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {hortifrutiEntries.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2">{row.consumption_date}</td>
                          <td className="px-3 py-2">
                            {row.audience_code === "patient"
                              ? "Paciente"
                              : "Servidor"}
                          </td>
                          <td className="px-3 py-2">
                            {MEALS.find(
                              ([code]) => code === row.service_code,
                            )?.[1] ?? row.service_code}
                          </td>
                          <td className="px-3 py-2">
                            {products.find(
                              (product) => product.id === row.product_id,
                            )?.name ??
                              row.original_product_text ??
                              "Item sem identificação"}
                            {!row.product_id && (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                                Sem vínculo
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 tabular">
                            {row.per_capita === null
                              ? "—"
                              : `${row.per_capita} ${row.per_capita_unit ?? ""}`}
                          </td>
                          <td className="px-3 py-2 tabular">
                            {row.volume === null
                              ? "—"
                              : `${row.volume} ${row.volume_unit ?? ""}`}
                          </td>
                          <td className="px-3 py-2 tabular">
                            {row.calculated_quantity === null
                              ? "—"
                              : `${row.calculated_quantity} ${row.quantity_unit}`}
                          </td>{" "}
                          <td className="px-3 py-2 tabular">
                            {Number(row.quantity).toLocaleString("pt-BR")}{" "}
                            {row.quantity_unit}
                          </td>
                          <td className="px-3 py-2">
                            {[
                              row.manual_reason
                                ? `Ajuste: ${row.manual_reason}`
                                : "",
                              row.notes ?? "",
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum item de Hortifruti lançado nesta semana.
              </p>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="maps" className="space-y-5">
          {(inventoryQuery.isError ||
            pulpQuery.isError ||
            hortifrutiQuery.isError ||
            pulpFlavorsQuery.isError ||
            deliveryQuery.isError ||
            deliveryItemsQuery.isError ||
            deliveryWindowsQuery.isError ||
            thawQuery.isError) && (
            <BackendNotice>
              Há uma ou mais consultas do relatório sem dados. Corrija a conexão
              antes de exportar para evitar um arquivo incompleto.
            </BackendNotice>
          )}
          <div id="report-preview">
            <Panel
              title="Mapa diário de produção"
              description="Prévia gerada dos lançamentos do dia selecionado. Campos ausentes aparecem como pendência; valores zero são mantidos."
              className="protein-map-panel"
            >
              <div className="reports-print-hide mb-4 flex flex-wrap items-end justify-between gap-3">
                <Field label="Data do mapa">
                  <Input
                    type="date"
                    min={selectedPlan?.week_start}
                    max={selectedPlan?.week_end}
                    value={mapDate}
                    onChange={(event) => setMapDate(event.target.value)}
                  />
                </Field>
                <Field label="Público">
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={mapAudienceFilter}
                    onChange={(event) =>
                      setMapAudienceFilter(event.target.value)
                    }
                  >
                    <option value="all">Todos</option>
                    <option value="patient">Paciente</option>
                    <option value="server">Servidor</option>
                  </select>
                </Field>
                <Field label="Refeição">
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={mapMealFilter}
                    onChange={(event) => setMapMealFilter(event.target.value)}
                  >
                    <option value="all">Todas</option>
                    {MEALS.map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Produto">
                  <select
                    className="h-10 min-w-52 rounded-md border border-input bg-background px-3 text-sm"
                    value={mapProductFilter}
                    onChange={(event) =>
                      setMapProductFilter(event.target.value)
                    }
                  >
                    <option value="all">Todos</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => window.print()}>
                    <Printer /> Imprimir dia
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      !selectedPlan ||
                      inventoryQuery.isLoading ||
                      entriesQuery.isLoading ||
                      pulpQuery.isLoading ||
                      hortifrutiQuery.isLoading ||
                      pulpFlavorsQuery.isLoading ||
                      deliveryQuery.isLoading ||
                      deliveryItemsQuery.isLoading ||
                      deliveryWindowsQuery.isLoading ||
                      thawQuery.isLoading ||
                      inventoryQuery.isError ||
                      entriesQuery.isError ||
                      pulpQuery.isError ||
                      hortifrutiQuery.isError ||
                      pulpFlavorsQuery.isError ||
                      deliveryQuery.isError ||
                      deliveryItemsQuery.isError ||
                      deliveryWindowsQuery.isError ||
                      thawQuery.isError
                    }
                    onClick={() =>
                      void exportWeeklyMaps({
                        pulps: pulpEntries,
                        hortifruti: hortifrutiEntries,
                        hortifrutiTotals: hortifrutiAnalysis,
                        pulpTotals: pulpAnalysis.consolidated,
                        pulpDeliveryTotals: pulpAnalysis.allocation,
                        deliveries: deliveryQuery.data ?? [],
                        deliveryItems: deliveryItemsQuery.data ?? [],
                        thawSchedules: thawQuery.data ?? [],
                        proteinConsolidation: consolidation,
                      })
                    }
                  >
                    <FileUp /> Exportar relatório semanal
                  </Button>
                </div>
              </div>
              <div className="reports-print-hide mb-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-muted px-3 py-1">
                  {mapReviewSummary.rows} lançamentos
                </span>
                {mapReviewSummary.withoutGroup > 0 && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-950">
                    {mapReviewSummary.withoutGroup} sem grupo/setor
                  </span>
                )}
                {mapReviewSummary.pending > 0 && (
                  <span className="rounded-full bg-red-100 px-3 py-1 text-red-950">
                    {mapReviewSummary.pending} sem quantidade final
                  </span>
                )}
                {mapReviewSummary.manual > 0 && (
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-950">
                    {mapReviewSummary.manual} com ajuste manual
                  </span>
                )}
              </div>
              {mapDayEntries.length ? (
                <div className="protein-map-screen overflow-x-auto">
                  <table className="w-full min-w-[750px] text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase">
                      <tr>
                        {[
                          "Público",
                          "Refeição",
                          "Preparação",
                          "Grupo / setor",
                          "Produto",
                          "Per capita",
                          "Volume",
                          "Quantidade final",
                        ].map((label) => (
                          <th key={label} className="px-3 py-2">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {mapDayEntries.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2">
                            {row.audience_code === "patient"
                              ? "Paciente"
                              : "Servidor"}
                          </td>
                          <td className="px-3 py-2">
                            {MEALS.find(
                              ([code]) => code === row.meal_code,
                            )?.[1] ?? row.meal_code}
                          </td>
                          <td className="px-3 py-2">
                            {row.preparation || "Não informado"}
                          </td>
                          <td className="px-3 py-2">
                            {row.meal_group || "Grupo não informado"}
                          </td>
                          <td className="px-3 py-2">
                            {products.find(
                              (product) => product.id === row.product_id,
                            )?.name ??
                              row.original_product_text ??
                              "Produto sem identificação"}
                          </td>
                          <td className="px-3 py-2">
                            {row.per_capita === null
                              ? "Não informado"
                              : Number(row.per_capita).toLocaleString("pt-BR") +
                                " " +
                                (row.per_capita_unit ?? "")}
                          </td>
                          <td className="px-3 py-2">
                            {row.volume === null
                              ? "Não informado"
                              : Number(row.volume).toLocaleString("pt-BR") +
                                " " +
                                (row.volume_unit ?? "")}
                          </td>
                          <td className="px-3 py-2">
                            {row.final_quantity === null
                              ? "Pendente"
                              : Number(row.final_quantity).toLocaleString(
                                  "pt-BR",
                                ) +
                                " " +
                                (row.quantity_unit ?? "")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="protein-map-screen text-sm text-muted-foreground">
                  Sem lançamentos de produção em {mapDate}.
                </p>
              )}
              <div className="protein-map-print">
                <header className="protein-map-print__header">
                  <img src="/isp-logo.png" alt="Logo ISP" />
                  <div>
                    <h1>MAPA DE PROTEÍNA</h1>
                    <p>{activeUnit?.name ?? "Unidade não identificada"}</p>
                    <p>{formatOperationalDateLabel(mapDate)}</p>
                  </div>
                </header>
                {proteinMapSections.length ? (
                  proteinMapSections.map((section) => (
                    <section
                      className="protein-map-section"
                      key={section.title}
                    >
                      <h2>{section.title}</h2>
                      <table>
                        <thead>
                          <tr>
                            <th>UNIDADE</th>
                            <th>PREPARAÇÃO</th>
                            <th>TIPO DE PTN</th>
                            <th>VOLUME</th>
                            <th>KG TOTAL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row) => (
                            <tr key={row.id}>
                              <td>
                                {row.meal_group?.trim() ||
                                  "Grupo não informado"}
                              </td>
                              <td>{row.preparation || "Não informado"}</td>
                              <td>
                                {products.find(
                                  (product) => product.id === row.product_id,
                                )?.name ??
                                  row.original_product_text ??
                                  "Produto sem identificação"}
                              </td>
                              <td>
                                {row.volume === null
                                  ? "Não informado"
                                  : `${Number(row.volume).toLocaleString("pt-BR")} ${row.volume_unit ?? ""}`.trim()}
                              </td>
                              <td>
                                {row.final_quantity === null
                                  ? "Pendente de conferência"
                                  : `${Number(row.final_quantity).toLocaleString("pt-BR")} ${row.quantity_unit ?? ""}`.trim()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ))
                ) : (
                  <p>Nenhum lançamento de proteína para esta data.</p>
                )}
              </div>
              {(() => {
                const rows = hortifrutiEntries.filter(
                  (entry) =>
                    entry.consumption_date === mapDate &&
                    (mapAudienceFilter === "all" ||
                      entry.audience_code === mapAudienceFilter) &&
                    (mapMealFilter === "all" ||
                      entry.service_code === mapMealFilter) &&
                    (mapProductFilter === "all" ||
                      entry.product_id === mapProductFilter),
                );
                return rows.length ? (
                  <div className="hortifruti-map-section mt-6 overflow-x-auto">
                    <h3 className="mb-2 font-semibold">Hortifruti do dia</h3>
                    <table className="w-full min-w-[700px] text-left text-sm">
                      <thead className="bg-muted/50 text-xs uppercase">
                        <tr>
                          {[
                            "Público",
                            "Serviço",
                            "Produto",
                            "Per capita",
                            "Volume",
                            "Total calculado",
                            "Quantidade final",
                            "Observações",
                          ].map((label) => (
                            <th key={label} className="px-3 py-2">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {rows.map((row) => (
                          <tr key={row.id}>
                            <td className="px-3 py-2">
                              {row.audience_code === "patient"
                                ? "Paciente"
                                : "Servidor"}
                            </td>
                            <td className="px-3 py-2">
                              {MEALS.find(
                                ([code]) => code === row.service_code,
                              )?.[1] ?? row.service_code}
                            </td>
                            <td className="px-3 py-2">
                              {products.find(
                                (product) => product.id === row.product_id,
                              )?.name ??
                                row.original_product_text ??
                                "Item sem identificação"}
                            </td>
                            <td className="px-3 py-2 tabular">
                              {row.per_capita === null
                                ? "—"
                                : `${row.per_capita} ${row.per_capita_unit ?? ""}`}
                            </td>
                            <td className="px-3 py-2 tabular">
                              {row.volume === null
                                ? "—"
                                : `${row.volume} ${row.volume_unit ?? ""}`}
                            </td>
                            <td className="px-3 py-2 tabular">
                              {row.calculated_quantity === null
                                ? "—"
                                : `${row.calculated_quantity} ${row.quantity_unit}`}
                            </td>
                            <td className="px-3 py-2 tabular">
                              {Number(row.quantity).toLocaleString("pt-BR")}{" "}
                              {row.quantity_unit}
                            </td>
                            <td className="px-3 py-2">
                              {[
                                row.manual_reason
                                  ? `Ajuste: ${row.manual_reason}`
                                  : "",
                                row.notes ?? "",
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null;
              })()}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="imports" className="space-y-5">
          <Panel
            title="Importar planejamento histórico"
            description="O sistema conserva o arquivo e todas as células. Linhas com estrutura de refeição são apenas sugeridas para revisão; um usuário autorizado confirma cada data e importação histórica."
          >
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-5 text-sm hover:bg-muted/30">
              <FileUp className="size-5 text-primary" />
              <span>
                <strong>Selecionar planilha .xlsx</strong>
                <br />
                <span className="text-muted-foreground">
                  Máximo 10 MB. O arquivo será guardado de forma privada após
                  confirmação.
                </span>
              </span>
              <input
                className="sr-only"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void previewFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {importError && <BackendNotice>{importError}</BackendNotice>}
            {importMessage && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
                {importMessage}
              </div>
            )}
            {workbookPreview && (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">Abas</span>
                    <p className="font-semibold">
                      {workbookPreview.sheetNames.length}
                    </p>
                  </div>
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Células no intervalo
                    </span>
                    <p className="font-semibold">
                      {workbookPreview.cells.length.toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Fórmulas
                    </span>
                    <p className="font-semibold">
                      {workbookPreview.formulaCount} ·{" "}
                      {workbookPreview.formulaCacheMissing} sem resultado em
                      cache
                    </p>
                  </div>
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Células preenchidas / zero
                    </span>
                    <p className="font-semibold">
                      {workbookPreview.nonempty.toLocaleString("pt-BR")} /{" "}
                      {workbookPreview.zeros}
                    </p>
                  </div>
                  <div className="surface p-3">
                    <span className="text-xs text-muted-foreground">
                      Candidatos reconhecidos
                    </span>
                    <p className="font-semibold">
                      {workbookPreview.candidates.length} ·{" "}
                      {
                        workbookPreview.candidates.filter(
                          (candidate) => candidate.record_type === "pulp",
                        ).length
                      }{" "}
                      polpas ·{" "}
                      {
                        workbookPreview.candidates.filter(
                          (candidate) =>
                            candidate.record_type === "protein_map",
                        ).length
                      }{" "}
                      mapas
                    </p>
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 text-sm">
                  <strong>{workbookPreview.file.name}</strong>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    SHA-256: {workbookPreview.hash}
                  </p>
                  <p className="mt-2">
                    Datas identificadas:{" "}
                    {workbookPreview.dateSamples.slice(0, 16).join(", ") ||
                      "nenhuma data reconhecida no valor da célula"}
                    {workbookPreview.dateSamples.length > 16 ? " …" : ""}
                  </p>
                  <p className="mt-2">
                    Abas: {workbookPreview.sheetNames.join(" · ")}
                  </p>
                </div>
                {workbookPreview.formulaCacheMissing > 0 && (
                  <p className="text-sm text-amber-800">
                    Fórmulas sem resultado em cache são mantidas como
                    pendências; não serão convertidas em zero.
                  </p>
                )}
                {workbookPreview.candidates.length > 0 && (
                  <div className="max-h-72 overflow-auto rounded-lg border">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="sticky top-0 bg-muted text-xs uppercase">
                        <tr>
                          {[
                            "Tipo / aba e célula",
                            "Data sugerida",
                            "Público",
                            "Serviço",
                            "Preparação / sabor",
                            "Produto original",
                            "Quantidade",
                          ].map((label) => (
                            <th key={label} className="px-3 py-2">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {workbookPreview.candidates
                          .slice(0, 50)
                          .map((candidate) => (
                            <tr
                              key={
                                candidate.source_sheet + candidate.source_cell
                              }
                            >
                              <td className="px-3 py-2">
                                {candidate.record_type === "pulp"
                                  ? "Polpa"
                                  : candidate.record_type === "protein_map"
                                    ? "Mapa de proteína"
                                    : "Planejamento"}{" "}
                                · {candidate.source_sheet}!
                                {candidate.source_cell}
                                <br />
                                <span className="text-xs text-muted-foreground">
                                  {candidate.source_range}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {candidate.source_date ?? "Data pendente"}
                                <br />
                                <span className="text-xs text-amber-800">
                                  {candidate.date_source ===
                                  "inherited_from_block"
                                    ? "Herdada do bloco — revisar"
                                    : candidate.date_source === "formula_cache"
                                      ? "Resultado em cache — revisar"
                                      : candidate.date_source === "explicit"
                                        ? "Valor explícito"
                                        : "Não identificada"}
                                </span>
                                {candidate.record_type === "protein_map" &&
                                  candidate.date_conflict && (
                                    <p className="text-xs text-red-700">
                                      {candidate.date_conflict}
                                    </p>
                                  )}
                              </td>
                              <td className="px-3 py-2">
                                {candidate.audience_code === "patient"
                                  ? "Paciente"
                                  : "Servidor"}
                              </td>
                              <td className="px-3 py-2">
                                {candidate.record_type === "pulp"
                                  ? (MEALS.find(
                                      ([code]) =>
                                        code === candidate.service_code,
                                    )?.[1] ?? candidate.service_code)
                                  : (MEALS.find(
                                      ([code]) => code === candidate.meal_code,
                                    )?.[1] ?? candidate.meal_code)}
                              </td>
                              <td className="px-3 py-2">
                                {candidate.record_type === "pulp"
                                  ? candidate.flavor_text
                                  : candidate.preparation}
                              </td>
                              <td className="px-3 py-2">
                                {candidate.record_type === "pulp"
                                  ? "—"
                                  : candidate.product_text}
                              </td>
                              <td className="px-3 py-2">
                                {candidate.record_type === "pulp"
                                  ? candidate.quantity === null
                                    ? "Não reconhecida"
                                    : candidate.quantity.toLocaleString(
                                        "pt-BR",
                                      ) +
                                      " " +
                                      candidate.quantity_unit
                                  : candidate.cached_quantity === null
                                    ? "Sem resultado armazenado"
                                    : candidate.cached_quantity.toLocaleString(
                                        "pt-BR",
                                      ) +
                                      (candidate.quantity_unit
                                        ? " " + candidate.quantity_unit
                                        : "")}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {workbookPreview.candidates.length > 50 && (
                      <p className="p-2 text-xs text-muted-foreground">
                        Prévia limitada aos 50 primeiros; o total identificado
                        está acima.
                      </p>
                    )}
                  </div>
                )}
                {workbookPreview.candidates.length === 0 && (
                  <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                    Nenhuma linha de refeição foi identificada com segurança. As
                    abas e células ainda serão arquivadas integralmente para
                    análise.
                  </p>
                )}
                <Button
                  disabled={
                    saveImport.isPending ||
                    workbookPreview.file.size > 10 * 1024 * 1024 ||
                    !unitId
                  }
                  onClick={() => saveImport.mutate()}
                >
                  {saveImport.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <FileUp />
                  )}{" "}
                  Arquivar original e todas as células
                </Button>
                <p className="text-xs text-muted-foreground">
                  O original é privado e hash repetido será bloqueado. A
                  pré-classificação não cria movimentos de estoque; somente a
                  confirmação individual dos candidatos autorizada abaixo cria
                  registros históricos.
                </p>
              </div>
            )}
          </Panel>
          <Panel title="Arquivos de origem arquivados">
            {importsQuery.isError && (
              <BackendNotice>
                Não foi possível consultar o histórico de importações. Confira
                se as migrations do módulo estão aplicadas.
              </BackendNotice>
            )}
            {(importsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ainda não há importações nesta unidade.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                    <tr>
                      {[
                        "Arquivo",
                        "Estado",
                        "Células",
                        "Registros importados",
                        "Pendências",
                        "Inconsistências",
                        "Importado em",
                        "Revisar",
                      ].map((label) => (
                        <th className="px-3 py-2" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(importsQuery.data ?? []).map((item) => (
                      <tr
                        key={item.id}
                        className={
                          selectedImportId === item.id
                            ? "bg-muted/40"
                            : undefined
                        }
                      >
                        <td className="px-3 py-2">{item.file_name}</td>
                        <td className="px-3 py-2">{item.status}</td>
                        <td className="px-3 py-2 tabular">{item.cell_count}</td>
                        <td className="px-3 py-2 tabular">
                          {item.imported_count}
                        </td>
                        <td className="px-3 py-2 tabular">
                          {item.pending_count}
                        </td>
                        <td className="px-3 py-2 tabular">
                          {item.issue_count}
                        </td>
                        <td className="px-3 py-2">
                          {new Date(item.imported_at).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedImportId(item.id)}
                          >
                            Abrir revisão
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {selectedImportId && (
            <Panel
              title="Revisar candidatos históricos"
              description="Confirme a data e os campos reconhecidos. Polpas e proteínas são importadas em registros próprios, vinculados à célula original, sem movimentar estoque."
            >
              {importCandidate.error && (
                <BackendNotice>{importCandidate.error.message}</BackendNotice>
              )}
              {importCandidatesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  Carregando candidatos…
                </p>
              ) : importCandidatesQuery.isError ? (
                <BackendNotice>
                  Não foi possível ler candidatos desta importação.
                </BackendNotice>
              ) : (importCandidatesQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma refeição candidata nesta importação.
                </p>
              ) : (
                <div className="space-y-3">
                  {(importCandidatesQuery.data ?? []).map((row) => {
                    const candidate = row.normalized_value;
                    const confirmedDate =
                      candidateDateDrafts[row.id] ??
                      candidate.source_date ??
                      "";
                    const productIdDraft = candidateProductDrafts[row.id] ?? "";
                    const isPulp = candidate.record_type === "pulp";
                    const isMap = candidate.record_type === "protein_map";
                    const needsQuantityConfirmation = isPulp || isMap;
                    const sourceQuantity = isPulp
                      ? candidate.quantity
                      : isMap
                        ? candidate.cached_quantity
                        : null;
                    const quantityDraft =
                      candidatePulpQuantityDrafts[row.id] ??
                      (needsQuantityConfirmation && sourceQuantity !== null
                        ? String(sourceQuantity)
                        : "");
                    const parsedQuantity = quantityDraft.trim()
                      ? Number(quantityDraft.replace(",", "."))
                      : null;
                    const title = isPulp
                      ? candidate.flavor_text
                      : candidate.preparation;
                    const details = isPulp
                      ? `${candidate.audience_code === "patient" ? "Paciente" : "Servidor"} · ${MEALS.find(([code]) => code === candidate.service_code)?.[1] ?? candidate.service_code} · ${candidate.quantity === null ? "quantidade não reconhecida" : `${candidate.quantity.toLocaleString("pt-BR")} ${candidate.quantity_unit}`}`
                      : `${candidate.product_text} · ${candidate.audience_code === "patient" ? "Paciente" : "Servidor"} · ${MEALS.find(([code]) => code === candidate.meal_code)?.[1] ?? candidate.meal_code}${isMap ? " · mapa diário" : ""}`;
                    return (
                      <article key={row.id} className="rounded-lg border p-4">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="font-semibold">{title}</h3>
                            <p className="text-sm text-muted-foreground">
                              {details}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Origem: {row.source_sheet}!{row.source_cell} ·{" "}
                              {candidate.source_range}
                            </p>
                          </div>
                          <span className="rounded-full bg-muted px-3 py-1 text-xs">
                            {row.validation_status === "imported"
                              ? "Importado"
                              : candidate.date_source === "inherited_from_block"
                                ? "Data herdada · confirmar"
                                : candidate.date_source === "missing"
                                  ? "Data pendente"
                                  : "Aguardando revisão"}
                          </span>
                        </div>
                        <div className="grid gap-3 md:grid-cols-[180px_1fr_220px_auto] md:items-end">
                          <Field label="Data confirmada">
                            <Input
                              type="date"
                              value={confirmedDate}
                              onChange={(event) =>
                                setCandidateDateDrafts((current) => ({
                                  ...current,
                                  [row.id]: event.target.value,
                                }))
                              }
                            />
                          </Field>
                          {needsQuantityConfirmation ? (
                            <Field label="Quantidade confirmada (KG)">
                              <Input
                                inputMode="decimal"
                                value={quantityDraft}
                                onChange={(event) =>
                                  setCandidatePulpQuantityDrafts((current) => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))
                                }
                                placeholder="Informe se não foi reconhecida"
                              />
                            </Field>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              Per capita:{" "}
                              {candidate.per_capita.toLocaleString("pt-BR")} ·
                              volume: {candidate.volume.toLocaleString("pt-BR")}{" "}
                              · quantidade original:{" "}
                              {candidate.cached_quantity === null
                                ? "sem resultado em cache"
                                : candidate.cached_quantity.toLocaleString(
                                    "pt-BR",
                                  ) +
                                  " " +
                                  candidate.quantity_unit}
                            </div>
                          )}
                          {isPulp ? (
                            <div className="text-sm text-muted-foreground">
                              Sabor: {candidate.flavor_text} ·{" "}
                              {sourceQuantity === null
                                ? "Quantidade informada pelo revisor"
                                : "Valor de origem: " +
                                  sourceQuantity.toLocaleString("pt-BR")}{" "}
                              KG
                            </div>
                          ) : (
                            <Field label="Vincular produto ISP (opcional)">
                              <select
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                value={productIdDraft}
                                onChange={(event) =>
                                  setCandidateProductDrafts((current) => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))
                                }
                              >
                                <option value="">
                                  Manter descrição original
                                </option>
                                {products.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.name} · {item.sku || item.unit}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          )}
                          <Button
                            disabled={
                              row.validation_status === "imported" ||
                              !confirmedDate ||
                              (needsQuantityConfirmation &&
                                (parsedQuantity === null ||
                                  !Number.isFinite(parsedQuantity) ||
                                  parsedQuantity < 0)) ||
                              importCandidate.isPending ||
                              (profile?.role !== "admin" &&
                                profile?.role !== "stock_manager")
                            }
                            onClick={() =>
                              importCandidate.mutate({
                                rowId: row.id,
                                productId: isPulp ? "" : productIdDraft,
                                date: confirmedDate,
                                confirmedQuantity: needsQuantityConfirmation
                                  ? parsedQuantity
                                  : null,
                              })
                            }
                          >
                            {importCandidate.isPending ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              <Plus />
                            )}{" "}
                            Confirmar histórico
                          </Button>
                        </div>
                        {row.issue && row.validation_status !== "imported" && (
                          <p className="mt-2 text-xs text-amber-800">
                            {row.issue}
                          </p>
                        )}
                        {row.linked_record_id && (
                          <p className="mt-2 text-xs text-emerald-800">
                            Registro histórico ISP: {row.linked_record_id}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
