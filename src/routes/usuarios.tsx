import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, UserCog, Users, Wrench } from "lucide-react";
import { PageIntro, Panel } from "@/components/common/Panel";
import { EmptyTable } from "@/components/common/EmptyTable";
import { BackendNotice } from "@/components/common/BackendNotice";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/supabase/AuthProvider";

export const Route = createFileRoute("/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários · ISP — Gestão de Estoque" },
      {
        name: "description",
        content:
          "Usuários e perfis de acesso: administrador, gestor de estoque e operador.",
      },
      { property: "og:title", content: "Usuários · ISP — Gestão de Estoque" },
      {
        property: "og:description",
        content:
          "Usuários e perfis de acesso: administrador, gestor de estoque e operador.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UsersPage,
});

const ROLES = [
  {
    icon: ShieldCheck,
    name: "Administrador",
    text: "Gerencia usuários, permissões e configurações do sistema.",
  },
  {
    icon: UserCog,
    name: "Gestor de estoque",
    text: "Cadastros, planejamento, relatórios e estornos auditáveis.",
  },
  {
    icon: Wrench,
    name: "Operador",
    text: "Registra entradas e saídas e consulta o estoque.",
  },
];

function UsersPage() {
  const { client, profile } = useAuth();
  const profilesQuery = useQuery({
    queryKey: ["profiles", profile?.company_id],
    queryFn: async () => {
      if (!client || !profile) return [];
      const { data, error } = await client
        .from("profiles")
        .select("user_id, full_name, role, status, unit_id, units(name)")
        .eq("company_id", profile.company_id)
        .order("full_name")
        .limit(500);
      if (error) throw error;
      return data.map((row) => ({ ...row, units: row.units[0] ?? null }));
    },
    enabled: Boolean(client && profile),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Usuários"
        description="Contas de acesso e perfis de permissão."
      />
      <BackendNotice>
        O login é autenticado pelo Supabase e esta lista mostra somente perfis
        que a política RLS permite consultar. Convites Auth e atribuição de
        papéis ainda dependem do fluxo administrativo de provisionamento.
      </BackendNotice>
      <div className="grid gap-4 md:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.name} className="surface flex gap-3 p-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <r.icon className="size-4.5" />
            </span>
            <div>
              <p className="text-sm font-semibold">{r.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{r.text}</p>
            </div>
          </div>
        ))}
      </div>
      <Panel title="Usuários cadastrados" bodyClassName="p-0">
        {profilesQuery.isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">
            Carregando perfis…
          </p>
        ) : profilesQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            Não foi possível consultar os perfis permitidos.
          </p>
        ) : (profilesQuery.data?.length ?? 0) === 0 ? (
          <EmptyTable
            icon={Users}
            title="Nenhum perfil visível"
            description="A política RLS não retornou perfis para esta conta."
            columns={[
              { label: "Nome" },
              { label: "Perfil" },
              { label: "Unidade" },
              { label: "Status" },
            ]}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  {["Nome", "Perfil", "Unidade", "Status"].map((column) => (
                    <th key={column} className="px-4 py-3 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {profilesQuery.data?.map((user) => (
                  <tr key={user.user_id}>
                    <td className="px-4 py-3">{user.full_name}</td>
                    <td className="px-4 py-3">{user.role}</td>
                    <td className="px-4 py-3">
                      {user.units?.name ?? "Toda empresa"}
                    </td>
                    <td className="px-4 py-3">
                      {user.status === "active" ? "Ativo" : "Inativo"}
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
