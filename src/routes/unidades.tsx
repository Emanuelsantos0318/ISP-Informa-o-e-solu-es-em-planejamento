import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Save, X } from "lucide-react";
import { BackendNotice } from "@/components/common/BackendNotice";
import { Field } from "@/components/common/Field";
import { PageIntro, Panel } from "@/components/common/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/supabase/AuthProvider";

export const Route = createFileRoute("/unidades")({
  head: () => ({ meta: [{ title: "Unidades · ISP — Gestão de Estoque" }] }),
  component: UnitsPage,
});

type UnitRow = {
  id: string;
  company_id: string;
  name: string;
  code: string;
  status: "active" | "inactive";
};

function UnitsPage() {
  const { client, profile } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canManage = profile?.role === "super_admin";

  const units = useQuery({
    queryKey: ["managed-units", profile?.company_id],
    enabled: Boolean(client && profile && canManage),
    queryFn: async () => {
      if (!client || !profile) return [];
      const { data, error: queryError } = await client
        .from("units")
        .select("id, company_id, name, code, status")
        .eq("company_id", profile.company_id)
        .order("name")
        .limit(500);
      if (queryError) throw queryError;
      return (data ?? []) as UnitRow[];
    },
  });

  const invalidateUnits = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["managed-units"] }),
      queryClient.invalidateQueries({ queryKey: ["operational-units"] }),
      queryClient.invalidateQueries({ queryKey: ["profiles"] }),
    ]);
  };

  const createUnit = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Supabase não está conectado.");
      const { error: rpcError } = await client.rpc("create_operational_unit", {
        p_name: name.trim(),
        p_code: code.trim().toUpperCase(),
      });
      if (rpcError) throw new Error(unitError(rpcError.message));
    },
    onSuccess: async () => {
      setName("");
      setCode("");
      setError(null);
      setMessage("Unidade criada.");
      await invalidateUnits();
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível criar a unidade.",
      ),
  });

  const saveUnit = useMutation({
    mutationFn: async (unit: UnitRow) => {
      if (!client) throw new Error("Supabase não está conectado.");
      const { error: rpcError } = await client.rpc("update_operational_unit", {
        p_unit_id: unit.id,
        p_name: editName.trim(),
        p_code: editCode.trim().toUpperCase(),
        p_status: unit.status,
      });
      if (rpcError) throw new Error(unitError(rpcError.message));
    },
    onSuccess: async () => {
      setEditing(null);
      setError(null);
      setMessage("Unidade atualizada.");
      await invalidateUnits();
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar a unidade.",
      ),
  });

  const changeStatus = (unit: UnitRow) =>
    saveUnit.mutate({
      ...unit,
      status: unit.status === "active" ? "inactive" : "active",
    });

  if (!canManage) {
    return (
      <BackendNotice>
        Esta área é exclusiva do Superadministrador.
      </BackendNotice>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Unidades de trabalho"
        description="Cadastre e administre as unidades da sua empresa. Unidades desativadas e seus dados permanecem preservados."
      />
      <Panel
        title="Nova unidade"
        description="O código deve ser único dentro da empresa."
      >
        <form
          className="grid gap-4 sm:grid-cols-[1fr_180px_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            createUnit.mutate();
          }}
        >
          <Field label="Nome da unidade" htmlFor="unit-name" required>
            <Input
              id="unit-name"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field label="Código" htmlFor="unit-code" required>
            <Input
              id="unit-code"
              value={code}
              maxLength={40}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              required
            />
          </Field>
          <Button
            disabled={createUnit.isPending || !name.trim() || !code.trim()}
          >
            <Plus /> {createUnit.isPending ? "Criando…" : "Criar unidade"}
          </Button>
        </form>
      </Panel>
      {message && (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Panel
        title="Unidades cadastradas"
        description="Desativar uma unidade bloqueia novas operações nela, sem apagar o histórico."
        bodyClassName="p-0"
      >
        {units.isLoading ? (
          <BackendNotice>Carregando unidades…</BackendNotice>
        ) : units.isError ? (
          <BackendNotice>
            Não foi possível carregar as unidades autorizadas.
          </BackendNotice>
        ) : !units.data?.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Building2 className="mx-auto mb-2 size-5" />
            Nenhuma unidade cadastrada.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Unidade</th>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {units.data.map((unit) => (
                  <tr key={unit.id}>
                    <td className="px-4 py-3">
                      {editing === unit.id ? (
                        <Input
                          aria-label="Nome da unidade"
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      ) : (
                        unit.name
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editing === unit.id ? (
                        <Input
                          aria-label="Código da unidade"
                          value={editCode}
                          onChange={(event) =>
                            setEditCode(event.target.value.toUpperCase())
                          }
                        />
                      ) : (
                        unit.code
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {unit.status === "active" ? "Ativa" : "Inativa"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {editing === unit.id ? (
                          <>
                            <Button
                              size="sm"
                              disabled={
                                saveUnit.isPending ||
                                !editName.trim() ||
                                !editCode.trim()
                              }
                              onClick={() => saveUnit.mutate(unit)}
                            >
                              <Save /> Salvar
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              aria-label="Cancelar edição"
                              onClick={() => setEditing(null)}
                            >
                              <X />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditing(unit.id);
                                setEditName(unit.name);
                                setEditCode(unit.code);
                              }}
                            >
                              <Pencil /> Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={saveUnit.isPending}
                              onClick={() => changeStatus(unit)}
                            >
                              {unit.status === "active"
                                ? "Desativar"
                                : "Reativar"}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function unitError(message: string) {
  if (message.includes("42501"))
    return "Somente o Superadministrador pode administrar unidades.";
  if (message.includes("23505"))
    return "Já existe uma unidade com esse código.";
  if (message.includes("22023")) return "Confira o nome e o código informados.";
  return "Não foi possível salvar a unidade. Confira a migração e tente novamente.";
}
