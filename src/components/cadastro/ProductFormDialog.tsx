import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/common/Field";
import { UNITS } from "@/lib/config/units";
import {
  fieldErrors,
  productSchema,
  type FieldErrors,
} from "@/lib/validation/schemas";
import type { ProductPrefill } from "@/lib/types";
import { useAuth } from "@/lib/supabase/AuthProvider";
import {
  explainBackendError,
  listCategories,
  type CatalogProduct,
} from "@/lib/supabase/catalog";

type FormState = {
  name: string;
  sku: string;
  barcode: string;
  brand: string;
  categoryId: string;
  description: string;
  unit: string;
  minStock: string;
  maxStock: string;
  unitCost: string;
  lotControl: boolean;
  expiryControl: boolean;
  active: boolean;
  notes: string;
};

const empty: FormState = {
  name: "",
  sku: "",
  barcode: "",
  brand: "",
  categoryId: "",
  description: "",
  unit: "",
  minStock: "0",
  maxStock: "",
  unitCost: "",
  lotControl: false,
  expiryControl: false,
  active: true,
  notes: "",
};

export function ProductFormDialog({
  open,
  onOpenChange,
  prefill,
  contextual,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: ProductPrefill | undefined;
  /** opened from inside a movement modal */
  contextual?: boolean | undefined;
  product?: CatalogProduct | undefined;
}) {
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<FieldErrors<FormState>>({});
  const [saving, setSaving] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const { client, profile } = useAuth();
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({
    queryKey: ["categories", profile?.company_id],
    queryFn: () =>
      client && profile
        ? listCategories(client, profile.company_id)
        : Promise.resolve([]),
    enabled: Boolean(client && profile),
  });
  const categories =
    categoriesQuery.data?.filter((category) => category.status === "active") ??
    [];

  useEffect(() => {
    if (open) {
      setForm({
        ...empty,
        name: product?.name ?? prefill?.name ?? "",
        sku: product?.sku ?? prefill?.sku ?? "",
        barcode: product?.barcode ?? prefill?.barcode ?? "",
        brand: product?.brand ?? "",
        categoryId: product?.categoryId ?? "",
        unit: product?.unit ?? "",
        minStock: product ? String(product.minimumStock) : empty.minStock,
        maxStock:
          product?.desiredStock === null || product?.desiredStock === undefined
            ? ""
            : String(product.desiredStock),
        active: product ? product.status === "active" : empty.active,
      });
      setErrors({});
      setBackendError(null);
    }
  }, [open, prefill, product]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const parsed = productSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    if (!client || !profile)
      return setBackendError("Conecte uma sessão autorizada antes de salvar.");
    if (product?.hasStock && !parsed.data.active)
      return setBackendError(
        "Registre a saída do saldo antes de inativar este produto.",
      );
    if (
      parsed.data.unitCost !== null ||
      parsed.data.lotControl ||
      parsed.data.expiryControl ||
      parsed.data.description ||
      parsed.data.notes
    ) {
      return setBackendError(
        "O banco atual não possui campos para custo, descrição, observações e controle de lote/validade. Remova esses valores ou aguarde a migração desses campos.",
      );
    }
    setSaving(true);
    try {
      const values = {
        category_id: parsed.data.categoryId,
        sku: parsed.data.sku,
        name: parsed.data.name,
        barcode: parsed.data.barcode || null,
        brand: parsed.data.brand || null,
        unit_of_measure: parsed.data.unit,
        minimum_stock: parsed.data.minStock,
        desired_stock: parsed.data.maxStock,
        status: parsed.data.active ? "active" : "inactive",
      };
      const { data, error } = product
        ? await client
            .from("products")
            .update(values)
            .eq("id", product.id)
            .eq("company_id", profile.company_id)
            .select("id")
            .maybeSingle()
        : await client
            .from("products")
            .insert({ ...values, company_id: profile.company_id })
            .select("id")
            .maybeSingle();
      if (error) return setBackendError(explainBackendError(error));
      if (!data)
        return setBackendError(
          "O produto não foi atualizado. Confira seu acesso e tente novamente.",
        );
    } catch {
      return setBackendError(
        "Falha de conexão. Confira a rede e tente novamente.",
      );
    } finally {
      setSaving(false);
    }
    setBackendError(null);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["products", profile.company_id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["categories", profile.company_id],
      }),
    ]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {product ? "Editar produto" : "Cadastrar produto"}
          </DialogTitle>
          <DialogDescription>
            {product &&
              "Altere o saldo pelas movimentações de entrada ou saída. "}
            {contextual
              ? "A movimentação em andamento fica preservada enquanto você cadastra."
              : "Campos com * são obrigatórios."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nome do produto"
            htmlFor="p-name"
            required
            error={errors.name}
            className="sm:col-span-2"
          >
            <Input
              id="p-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field
            label="SKU"
            htmlFor="p-sku"
            required
            error={errors.sku}
            hint="Único no sistema"
          >
            <Input
              id="p-sku"
              className="font-mono"
              value={form.sku}
              onChange={(e) => set("sku", e.target.value)}
            />
          </Field>
          <Field
            label="Código de barras"
            htmlFor="p-barcode"
            error={errors.barcode}
            hint="Único quando preenchido"
          >
            <Input
              id="p-barcode"
              className="font-mono"
              value={form.barcode}
              onChange={(e) => set("barcode", e.target.value)}
            />
          </Field>
          <Field label="Marca" htmlFor="p-brand" error={errors.brand}>
            <Input
              id="p-brand"
              value={form.brand}
              onChange={(e) => set("brand", e.target.value)}
            />
          </Field>
          <Field label="Categoria" required error={errors.categoryId}>
            <Select
              value={form.categoryId}
              onValueChange={(v) => set("categoryId", v)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    categoriesQuery.isLoading
                      ? "Carregando…"
                      : categories.length
                        ? "Selecione"
                        : "Nenhuma categoria cadastrada"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Unidade de medida"
            required
            error={errors.unit}
            hint={
              product?.hasStock
                ? "Registre o saldo antes de alterar a unidade."
                : undefined
            }
          >
            <Select
              value={form.unit}
              onValueChange={(v) => set("unit", v)}
              disabled={Boolean(product?.hasStock)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => (
                  <SelectItem key={u.code} value={u.code}>
                    {u.label} ({u.short})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Estoque mínimo"
            htmlFor="p-min"
            required
            error={errors.minStock}
          >
            <Input
              id="p-min"
              type="number"
              min={0}
              className="tabular"
              value={form.minStock}
              onChange={(e) => set("minStock", e.target.value)}
            />
          </Field>
          <Field
            label="Estoque máximo"
            htmlFor="p-max"
            error={errors.maxStock}
            hint="Usado como meta de reposição"
          >
            <Input
              id="p-max"
              type="number"
              min={0}
              className="tabular"
              value={form.maxStock}
              onChange={(e) => set("maxStock", e.target.value)}
            />
          </Field>
          <Field
            label="Custo unitário (R$)"
            htmlFor="p-cost"
            error={errors.unitCost}
            className={product ? "hidden" : undefined}
          >
            <Input
              id="p-cost"
              type="number"
              min={0}
              step="0.01"
              className="tabular"
              value={form.unitCost}
              onChange={(e) => set("unitCost", e.target.value)}
            />
          </Field>
          <div className="flex flex-col justify-end gap-3 rounded-md border bg-muted/40 p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              Controle de lote
              <Switch
                disabled={Boolean(product)}
                checked={form.lotControl}
                onCheckedChange={(v) => set("lotControl", v)}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              Controle de validade
              <Switch
                disabled={Boolean(product)}
                checked={form.expiryControl}
                onCheckedChange={(v) => set("expiryControl", v)}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              Produto ativo
              <Switch
                checked={form.active}
                onCheckedChange={(v) => set("active", v)}
              />
            </label>
          </div>
          <Field
            label="Descrição"
            htmlFor="p-desc"
            className={product ? "hidden" : "sm:col-span-2"}
          >
            <Textarea
              id="p-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <Field
            label="Observações"
            htmlFor="p-notes"
            className={product ? "hidden" : "sm:col-span-2"}
          >
            <Textarea
              id="p-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>

        {categoriesQuery.error && (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar as categorias autorizadas.
          </p>
        )}
        {backendError && (
          <p role="alert" className="text-sm text-destructive">
            {backendError}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={saving || categoriesQuery.isLoading}
            onClick={() => void submit()}
          >
            {saving
              ? "Salvando…"
              : product
                ? "Salvar alterações"
                : "Salvar produto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
