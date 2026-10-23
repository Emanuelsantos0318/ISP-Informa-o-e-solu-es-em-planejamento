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
  fieldErrors,
  supplierSchema,
  type FieldErrors,
} from "@/lib/validation/schemas";
import { formatCnpj } from "@/lib/validation/cnpj";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { explainBackendError } from "@/lib/supabase/catalog";

const empty = {
  legalName: "",
  tradeName: "",
  cnpj: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  active: true,
};

export function SupplierFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors<typeof empty>>({});
  const [saving, setSaving] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const { client, profile } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setForm(empty);
      setErrors({});
      setBackendError(null);
    }
  }, [open]);

  const set = (key: keyof typeof empty, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const parsed = supplierSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    if (!client || !profile)
      return setBackendError("Conecte uma sessão autorizada antes de salvar.");
    if (parsed.data.tradeName || parsed.data.cnpj || parsed.data.address) {
      return setBackendError(
        "O banco atual não possui campos para nome fantasia, CNPJ e endereço. Remova esses valores ou aguarde a migração desses campos.",
      );
    }
    setSaving(true);
    try {
      const { error } = await client.from("suppliers").insert({
        company_id: profile.company_id,
        name: parsed.data.legalName,
        contact_name: parsed.data.contactName || null,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        notes: parsed.data.notes || null,
        status: parsed.data.active ? "active" : "inactive",
      });
      if (error) return setBackendError(explainBackendError(error));
    } catch {
      return setBackendError(
        "Falha de conexão. Confira a rede e tente novamente.",
      );
    } finally {
      setSaving(false);
    }
    setBackendError(null);
    await queryClient.invalidateQueries({
      queryKey: ["suppliers", profile.company_id],
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo fornecedor</DialogTitle>
          <DialogDescription>
            Apenas o nome é obrigatório no cadastro inicial.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nome ou razão social"
            htmlFor="s-legal"
            required
            error={errors.legalName}
            className="sm:col-span-2"
          >
            <Input
              id="s-legal"
              value={form.legalName}
              onChange={(e) => set("legalName", e.target.value)}
            />
          </Field>
          <Field label="Nome fantasia" htmlFor="s-trade">
            <Input
              id="s-trade"
              value={form.tradeName}
              onChange={(e) => set("tradeName", e.target.value)}
            />
          </Field>
          <Field label="CNPJ" htmlFor="s-cnpj" error={errors.cnpj}>
            <Input
              id="s-cnpj"
              inputMode="numeric"
              className="font-mono"
              placeholder="00.000.000/0000-00"
              value={form.cnpj}
              onChange={(e) => set("cnpj", formatCnpj(e.target.value))}
            />
          </Field>
          <Field label="Nome do contato" htmlFor="s-contact">
            <Input
              id="s-contact"
              value={form.contactName}
              onChange={(e) => set("contactName", e.target.value)}
            />
          </Field>
          <Field label="Telefone" htmlFor="s-phone">
            <Input
              id="s-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
          <Field
            label="E-mail"
            htmlFor="s-email"
            error={errors.email}
            className="sm:col-span-2"
          >
            <Input
              id="s-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Endereço" htmlFor="s-address" className="sm:col-span-2">
            <Input
              id="s-address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
          <Field
            label="Observações"
            htmlFor="s-notes"
            className="sm:col-span-2"
          >
            <Textarea
              id="s-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          <label className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm sm:col-span-2">
            Fornecedor ativo
            <Switch
              checked={form.active}
              onCheckedChange={(v) => set("active", v)}
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
            {saving ? "Salvando…" : "Salvar fornecedor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
