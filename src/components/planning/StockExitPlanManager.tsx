import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Pencil, Play, Plus, Save, Trash2 } from "lucide-react";
import { BackendNotice } from "@/components/common/BackendNotice";
import { Field } from "@/components/common/Field";
import { Panel } from "@/components/common/Panel";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useCatalog } from "@/lib/supabase/useCatalog";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { useStockExitPlans } from "@/lib/supabase/useStockExitPlans";
import {
  saveStockExitPlan,
  type StockExitPlan,
} from "@/lib/supabase/stock-exit-plans";
import type { ExitPlanPrefill } from "@/components/movements/MovementActions";
import { unitShort } from "@/lib/config/units";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/datetime";

type DraftItem = { productId: string; quantity: string };

export function StockExitPlanManager({
  onStart,
  compact = false,
}: {
  onStart: (plan: ExitPlanPrefill) => void;
  compact?: boolean | undefined;
}) {
  const { client, profile } = useAuth();
  const { unitId } = useOperationalScope();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const plansQuery = useStockExitPlans({ includeInactive: true });
  const canManage = Boolean(
    profile && ["super_admin", "admin", "stock_manager"].includes(profile.role),
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StockExitPlan | null>(null);
  const [name, setName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const products = useMemo(
    () =>
      (catalog.products.data ?? []).filter(
        (product) => product.status === "active",
      ),
    [catalog.products.data],
  );
  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const plans = plansQuery.data ?? [];
  const historyQuery = useQuery({
    queryKey: ["stock-exit-plan-history", profile?.company_id, unitId],
    enabled: Boolean(!compact && client && profile?.company_id && unitId),
    queryFn: async () => {
      if (!client || !profile?.company_id || !unitId) return [];
      const { data: usages, error } = await client
        .from("stock_exit_plan_usages")
        .select(
          "id, plan_name_snapshot, planned_recipient_snapshot, actual_recipient, performed_by, performed_by_name_snapshot, used_at",
        )
        .eq("company_id", profile.company_id)
        .eq("unit_id", unitId)
        .order("used_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = usages ?? [];
      if (rows.length === 0) return [];
      const usageIds = rows.map((row) => row.id);
      const { data: itemRows, error: itemError } = await client
        .from("stock_exit_plan_usage_items")
        .select(
          "usage_id, product_name_snapshot, unit_of_measure_snapshot, planned_quantity, actual_quantity",
        )
        .in("usage_id", usageIds);
      if (itemError) throw itemError;
      const byUsage = new Map<string, typeof itemRows>();
      for (const item of itemRows ?? [])
        byUsage.set(item.usage_id, [
          ...(byUsage.get(item.usage_id) ?? []),
          item,
        ]);
      return rows.map((row) => ({
        ...row,
        operatorName: row.performed_by_name_snapshot,
        items: byUsage.get(row.id) ?? [],
      }));
    },
  });

  const reset = () => {
    setEditing(null);
    setName("");
    setRecipient("");
    setNotes("");
    setActive(true);
    setDraftItems([]);
    setProductId("");
    setQuantity("1");
  };
  const beginEdit = (plan: StockExitPlan) => {
    setEditing(plan);
    setName(plan.name);
    setRecipient(plan.recipient);
    setNotes(plan.notes ?? "");
    setActive(plan.status === "active");
    setDraftItems(
      plan.items.map((item) => ({
        productId: item.product_id,
        quantity: String(item.planned_quantity),
      })),
    );
    setProductId("");
    setQuantity("1");
    setOpen(true);
  };
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!client || !unitId) throw new Error("Selecione uma unidade ativa.");
      if (draftItems.length === 0)
        throw new Error("Inclua ao menos um produto.");
      const parsedItems = draftItems.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity.replace(",", ".")),
      }));
      if (
        parsedItems.some(
          (item) =>
            !Number.isFinite(item.quantity) ||
            item.quantity <= 0 ||
            item.quantity > 99999999999.999 ||
            Number(item.quantity.toFixed(3)) !== item.quantity,
        )
      )
        throw new Error(
          "As quantidades precisam ser positivas e ter até três casas decimais.",
        );
      return saveStockExitPlan(client, {
        unitId,
        id: editing?.id ?? null,
        name: name.trim(),
        recipient: recipient.trim(),
        notes: notes.trim(),
        status: active ? "active" : "inactive",
        items: parsedItems,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stock-exit-plans"] });
      toast.success(
        editing ? "Planejamento atualizado" : "Planejamento criado",
      );
      setOpen(false);
      reset();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o planejamento.",
      ),
  });

  const addItem = () => {
    const parsed = Number(quantity.replace(",", "."));
    if (
      !productId ||
      !Number.isFinite(parsed) ||
      parsed <= 0 ||
      parsed > 99999999999.999 ||
      Number(parsed.toFixed(3)) !== parsed
    ) {
      toast.error(
        "Selecione um produto e informe uma quantidade positiva, com até três casas decimais.",
      );
      return;
    }
    if (draftItems.some((item) => item.productId === productId)) {
      toast.error("Esse produto já está no planejamento.");
      return;
    }
    setDraftItems((items) => [
      ...items,
      { productId, quantity: String(parsed) },
    ]);
    setProductId("");
    setQuantity("1");
  };

  if (catalog.products.isError || plansQuery.isError)
    return (
      <BackendNotice>
        Não foi possível carregar os planejamentos de saída. Confira a conexão e
        as migrações do banco.
      </BackendNotice>
    );

  return (
    <>
      <Panel
        title={compact ? "Saídas planejadas" : "Modelos de saída recorrente"}
        description={
          compact
            ? "Use um modelo para preencher a saída; o estoque só muda depois da conferência e confirmação."
            : "Crie modelos diários para itens recorrentes. O operador pode ajustar quantidades antes de confirmar a movimentação."
        }
        actions={
          canManage ? (
            <Button
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              <Plus /> Novo modelo
            </Button>
          ) : undefined
        }
      >
        {plansQuery.isLoading || catalog.products.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando modelos…</p>
        ) : plans.filter((plan) =>
            compact || !canManage ? plan.status === "active" : true,
          ).length === 0 ? (
          <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
            <ClipboardList className="mx-auto mb-2 size-5" />
            {canManage
              ? "Ainda não há modelos de saída. Cadastre o primeiro para agilizar a operação diária."
              : "Nenhum modelo ativo está disponível nesta unidade."}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plans
              .filter((plan) =>
                compact || !canManage ? plan.status === "active" : true,
              )
              .map((plan) => {
                const missingItems = plan.items.filter(
                  (item) => !productMap.has(item.product_id),
                );
                const staleUnits = plan.items.filter((item) => {
                  const product = productMap.get(item.product_id);
                  return (
                    product && product.unit !== item.unit_of_measure_snapshot
                  );
                });
                const outOfStock = plan.items.filter(
                  (item) =>
                    (productMap.get(item.product_id)?.balance ?? 0) <
                    item.planned_quantity,
                );
                return (
                  <article
                    key={plan.id}
                    className="rounded-lg border bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold">{plan.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Responsável: {plan.recipient}
                        </p>
                      </div>
                      <Badge
                        variant={
                          plan.status === "active" ? "default" : "secondary"
                        }
                      >
                        {plan.status === "active"
                          ? "Ativo · diário"
                          : "Inativo"}
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm">
                      {plan.items.slice(0, compact ? 4 : 8).map((item) => {
                        const product = productMap.get(item.product_id);
                        return (
                          <div
                            className="flex justify-between gap-2"
                            key={item.id}
                          >
                            <span className="truncate">
                              {product?.name ?? item.product_name_snapshot}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {item.planned_quantity}{" "}
                              {unitShort(product?.unit ?? "un")}
                            </span>
                          </div>
                        );
                      })}
                      {plan.items.length > (compact ? 4 : 8) && (
                        <p className="text-xs text-muted-foreground">
                          + {plan.items.length - (compact ? 4 : 8)} produto(s)
                        </p>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">
                        {plan.items.length} produto(s)
                      </Badge>
                      {outOfStock.length > 0 && (
                        <Badge variant="destructive">
                          Saldo insuficiente: {outOfStock.length}
                        </Badge>
                      )}
                      {missingItems.length > 0 && (
                        <Badge variant="secondary">
                          Produto inativo: {missingItems.length}
                        </Badge>
                      )}
                      {staleUnits.length > 0 && (
                        <Badge variant="destructive">
                          Unidade alterada: {staleUnits.length}
                        </Badge>
                      )}
                    </div>
                    {plan.notes && (
                      <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                        {plan.notes}
                      </p>
                    )}
                    <div className="mt-4 flex justify-end gap-2">
                      {canManage && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => beginEdit(plan)}
                        >
                          <Pencil /> Editar
                        </Button>
                      )}
                      {plan.status === "active" && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            onStart({
                              ...plan,
                              products: plan.items.flatMap((item) => {
                                const product = productMap.get(item.product_id);
                                return product
                                  ? [
                                      {
                                        product,
                                        quantity: item.planned_quantity,
                                      },
                                    ]
                                  : [];
                              }),
                            })
                          }
                          disabled={
                            missingItems.length > 0 ||
                            staleUnits.length > 0 ||
                            plan.items.length === 0
                          }
                        >
                          <Play /> Iniciar saída
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
          </div>
        )}
      </Panel>

      {!compact && (
        <Panel
          title="Histórico de saídas planejadas"
          description="Cada uso preserva o modelo vigente no momento da saída, o operador e as quantidades previstas e confirmadas; alterações posteriores não reescrevem este histórico."
          bodyClassName="p-0"
        >
          {historyQuery.isLoading ? (
            <p className="p-5 text-sm text-muted-foreground">
              Carregando histórico…
            </p>
          ) : historyQuery.isError ? (
            <BackendNotice>
              Não foi possível carregar o histórico dos modelos de saída.
            </BackendNotice>
          ) : historyQuery.data?.length ? (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                  <tr>
                    {[
                      "Data e hora",
                      "Modelo",
                      "Responsável",
                      "Operador",
                      "Produtos · previsto → confirmado",
                    ].map((label) => (
                      <th key={label} className="px-3 py-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {historyQuery.data.map((usage) => (
                    <tr key={usage.id}>
                      <td className="whitespace-nowrap px-3 py-3">
                        {formatDateTime(usage.used_at)}
                      </td>
                      <td className="px-3 py-3">{usage.plan_name_snapshot}</td>
                      <td className="px-3 py-3">
                        {usage.actual_recipient}
                        <span className="block text-xs text-muted-foreground">
                          Modelo: {usage.planned_recipient_snapshot}
                        </span>
                      </td>
                      <td className="px-3 py-3">{usage.operatorName}</td>
                      <td className="px-3 py-3">
                        {usage.items.map((item) => (
                          <div
                            key={`${usage.id}:${item.product_name_snapshot}`}
                            className="flex flex-wrap gap-x-2"
                          >
                            <span>{item.product_name_snapshot}</span>
                            <span className="text-muted-foreground">
                              {item.planned_quantity} → {item.actual_quantity}{" "}
                              {unitShort(
                                item.unit_of_measure_snapshot as Parameters<
                                  typeof unitShort
                                >[0],
                              )}
                            </span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-sm text-muted-foreground">
              Ainda não há saídas registradas a partir dos modelos.
            </p>
          )}
        </Panel>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar modelo de saída" : "Novo modelo de saída"}
            </DialogTitle>
            <DialogDescription>
              As quantidades são sugestões. Cada movimentação exige conferência
              e confirmação do operador.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do planejamento" required>
              <Input
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Produção diária"
              />
            </Field>
            <Field label="Funcionário responsável" required>
              <Input
                maxLength={120}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="Nome de quem recebe"
              />
            </Field>
          </div>
          <Field label="Observações">
            <Textarea
              maxLength={500}
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Frequência diária</p>
              <p className="text-xs text-muted-foreground">
                Este modelo pode ser usado sempre que necessário.
              </p>
            </div>
            <Button
              type="button"
              variant={active ? "default" : "outline"}
              onClick={() => setActive((value) => !value)}
            >
              {active ? "Ativo" : "Inativo"}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto] sm:items-end">
            <Field label="Produto">
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione produto" />
                </SelectTrigger>
                <SelectContent>
                  {products
                    .filter(
                      (product) =>
                        !draftItems.some(
                          (item) => item.productId === product.id,
                        ),
                    )
                    .map((product) => (
                      <SelectItem value={product.id} key={product.id}>
                        {product.name} · saldo {product.balance}{" "}
                        {unitShort(product.unit)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Quantidade prevista">
              <Input
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
            <Button type="button" variant="outline" onClick={addItem}>
              <Plus /> Adicionar
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Produto</th>
                  <th className="w-40 p-2">Quantidade prevista</th>
                  <th className="w-12 p-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {draftItems.map((item) => {
                  const product = productMap.get(item.productId);
                  return (
                    <tr key={item.productId}>
                      <td className="p-2">
                        {product?.name ?? "Produto não ativo"}
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <Input
                            inputMode="decimal"
                            value={item.quantity}
                            aria-label={`Quantidade prevista para ${product?.name ?? "produto"}`}
                            onChange={(event) =>
                              setDraftItems((current) =>
                                current.map((row) =>
                                  row.productId === item.productId
                                    ? { ...row, quantity: event.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                          <span>{unitShort(product?.unit ?? "un")}</span>
                        </div>
                      </td>
                      <td className="p-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remover ${product?.name ?? "produto"}`}
                          onClick={() =>
                            setDraftItems((current) =>
                              current.filter(
                                (row) => row.productId !== item.productId,
                              ),
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                saveMutation.isPending ||
                !client ||
                !unitId ||
                !name.trim() ||
                !recipient.trim() ||
                draftItems.length === 0
              }
              onClick={() => saveMutation.mutate()}
            >
              <Save /> {saveMutation.isPending ? "Salvando…" : "Salvar modelo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
