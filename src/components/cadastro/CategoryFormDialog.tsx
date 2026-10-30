import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Field } from "@/components/common/Field";
import {
  categorySchema,
  fieldErrors,
  type FieldErrors,
} from "@/lib/validation/schemas";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { explainBackendError } from "@/lib/supabase/catalog";
import type { CategoryRecord } from "@/lib/supabase/catalog";

const empty = { name: "", description: "", active: true };

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: CategoryRecord | null | undefined;
}) {
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors<typeof empty>>({});
  const [saving, setSaving] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const { client, profile } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setForm(
        category
          ? {
              name: category.name,
              description: category.description ?? "",
              active: category.status === "active",
            }
          : empty,
      );
      setErrors({});
      setBackendError(null);
    }
  }, [open, category]);

  const submit = async () => {
    const parsed = categorySchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    if (!client || !profile)
      return setBackendError("Conecte uma sessão autorizada antes de salvar.");
    setSaving(true);
    try {
      const values = {
        name: parsed.data.name,
        description: parsed.data.description || null,
        status: parsed.data.active ? "active" : "inactive",
      };
      const result = category
        ? await client
            .from("categories")
            .update(values)
            .eq("id", category.id)
            .eq("company_id", profile.company_id)
        : await client.from("categories").insert({
            company_id: profile.company_id,
            ...values,
          });
      const { error } = result;
      if (error) return setBackendError(explainBackendError(error));
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
        queryKey: ["categories", profile.company_id],
      }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-snapshot"] }),
    ]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {category ? "Editar categoria" : "Nova categoria"}
          </DialogTitle>
          <DialogDescription>
            Categorias usadas em registros não são excluídas, apenas inativadas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field
            label="Nome da categoria"
            htmlFor="c-name"
            required
            error={errors.name}
          >
            <Input
              id="c-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Descrição" htmlFor="c-desc">
            <Textarea
              id="c-desc"
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
          <label className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm">
            Categoria ativa
            <Switch
              checked={form.active}
              onCheckedChange={(v) => setForm({ ...form, active: v })}
            />
          </label>
        </div>
        {backendError && (
          <p role="alert" className="text-sm text-destructive">
            {backendError}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving
              ? "Salvando…"
              : category
                ? "Salvar alterações"
                : "Salvar categoria"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
