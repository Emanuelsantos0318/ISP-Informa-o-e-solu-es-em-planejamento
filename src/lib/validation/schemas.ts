import { z } from "zod";
import { UNITS } from "@/lib/config/units";
import { isValidCnpj } from "@/lib/validation/cnpj";

const unitCodes = UNITS.map((u) => u.code) as [string, ...string[]];

const optionalNumber = z
  .union([z.literal(""), z.coerce.number()])
  .transform((v) => (v === "" ? null : v))
  .refine(
    (v) => v === null || v >= 0,
    "Informe um valor maior ou igual a zero.",
  );

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da categoria.").max(80),
  description: z.string().trim().max(300).optional(),
  active: z.boolean(),
});

export const productSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome do produto.").max(120),
    sku: z.string().trim().min(1, "Informe o SKU.").max(40),
    barcode: z
      .string()
      .trim()
      .max(40)
      .refine(
        (v) => v === "" || /^[0-9A-Za-z-]+$/.test(v),
        "Código de barras inválido.",
      ),
    brand: z.string().trim().max(120),
    categoryId: z.string().min(1, "Selecione a categoria."),
    description: z.string().trim().max(500).optional(),
    unit: z.enum(unitCodes, {
      errorMap: () => ({ message: "Selecione a unidade de medida." }),
    }),
    minStock: z.coerce
      .number()
      .min(0, "O estoque mínimo não pode ser negativo."),
    maxStock: optionalNumber,
    unitCost: optionalNumber,
    lotControl: z.boolean(),
    expiryControl: z.boolean(),
    active: z.boolean(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((p) => p.maxStock === null || p.maxStock >= p.minStock, {
    message: "O estoque máximo deve ser maior ou igual ao mínimo.",
    path: ["maxStock"],
  });

export const supplierSchema = z.object({
  legalName: z
    .string()
    .trim()
    .min(2, "Informe o nome ou razão social.")
    .max(150),
  tradeName: z.string().trim().max(150).optional(),
  cnpj: z
    .string()
    .trim()
    .refine((v) => v === "" || isValidCnpj(v), "CNPJ inválido."),
  contactName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || z.string().email().safeParse(v).success,
      "E-mail inválido.",
    ),
  address: z.string().trim().max(250).optional(),
  notes: z.string().trim().max(500).optional(),
  active: z.boolean(),
});

export type FieldErrors<T> = Partial<Record<keyof T & string, string>>;

/** Maps zod issues to { field: message } (first message per field). */
export function fieldErrors<T>(error: z.ZodError<T>): FieldErrors<T> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!out[key]) out[key] = issue.message;
  }
  return out as FieldErrors<T>;
}
