import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  UserCog,
  Users,
  Wrench,
  UserPlus,
  Copy,
  Check,
} from "lucide-react";
import { PageIntro, Panel } from "@/components/common/Panel";
import { BackendNotice } from "@/components/common/BackendNotice";
import { Field } from "@/components/common/Field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import type { ProfileRole } from "@/lib/supabase/types";

export const Route = createFileRoute("/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários · ISP — Gestão de Estoque" },
      { name: "description", content: "Convites e perfis de acesso." },
    ],
  }),
  component: UsersPage,
});

const ROLES: {
  value: ProfileRole;
  label: string;
  description: string;
  icon: typeof ShieldCheck;
}[] = [
  {
    value: "admin",
    label: "Administrador",
    description: "Gerencia usuários e configurações.",
    icon: ShieldCheck,
  },
  {
    value: "stock_manager",
    label: "Gestor de estoque",
    description: "Cadastros, movimentos e análises.",
    icon: UserCog,
  },
  {
    value: "operator",
    label: "Operador",
    description: "Registra entradas e saídas.",
    icon: Wrench,
  },
  {
    value: "purchasing_approver",
    label: "Aprovador de compras",
    description: "Consulta compras e planejamento.",
    icon: UserCog,
  },
  {
    value: "viewer",
    label: "Consulta",
    description: "Somente leitura nos dados autorizados.",
    icon: Users,
  },
];
const roleLabel = (role: string) =>
  ROLES.find((item) => item.value === role)?.label ?? role;

function UsersPage() {
  const { client, profile } = useAuth();
  const { units } = useOperationalScope();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [accountMode, setAccountMode] = useState<"invite" | "username">(
    "invite",
  );
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<ProfileRole>("operator");
  const [unitId, setUnitId] = useState("empresa");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const canAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const profilesQuery = useQuery({
    queryKey: ["profiles", profile?.company_id],
    queryFn: async () => {
      if (!client || !profile) return [];
      const { data, error } = await client
        .from("profiles")
        .select(
          "user_id, username, full_name, role, status, unit_id, units(name)",
        )
        .eq("company_id", profile.company_id)
        .order("full_name")
        .limit(500);
      if (error) throw error;
      return data.map((row) => ({
        ...row,
        units: Array.isArray(row.units) ? (row.units[0] ?? null) : row.units,
      }));
    },
    enabled: Boolean(client && profile),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Supabase não está configurado.");
      const { data, error } = await client.functions.invoke(
        "admin-invite-user",
        {
          body: {
            email: email.trim(),
            fullName: fullName.trim(),
            role,
            unitId: unitId === "empresa" ? null : unitId,
          },
        },
      );
      if (error) throw new Error(data?.error ?? error.message);
      if (data?.error) throw new Error(data.error);
      return data as { inviteUrl: string };
    },
    onSuccess: async (data) => {
      setMessage(
        "Convite gerado. Copie o link e envie ao usuário pelo canal que preferir.",
      );
      setInviteUrl(data.inviteUrl);
      setInviteCopied(false);
      setEmail("");
      setFullName("");
      setErrorMessage(null);
      await queryClient.invalidateQueries({
        queryKey: ["profiles", profile?.company_id],
      });
    },
    onError: (error) =>
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o convite.",
      ),
  });

  const createUserMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Supabase não está configurado.");
      const { data, error } = await client.functions.invoke(
        "admin-create-user",
        {
          body: {
            username: username.trim().toLowerCase(),
            fullName: fullName.trim(),
            password: initialPassword,
            role,
            unitId: unitId === "empresa" ? null : unitId,
          },
        },
      );
      if (error) throw new Error(data?.error ?? error.message);
      if (data?.error) throw new Error(data.error);
      return data as { username: string };
    },
    onSuccess: async (data) => {
      setMessage(
        `Conta ${data.username} criada. Passe ao usuário a senha inicial informada por um canal seguro.`,
      );
      setUsername("");
      setInitialPassword("");
      setFullName("");
      setErrorMessage(null);
      await queryClient.invalidateQueries({
        queryKey: ["profiles", profile?.company_id],
      });
    },
    onError: (error) =>
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível criar a conta.",
      ),
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      userId,
      fullName: name,
      role: nextRole,
      unitId: nextUnit,
      status,
    }: {
      userId: string;
      fullName: string;
      role: ProfileRole;
      unitId: string | null;
      status: "active" | "inactive";
    }) => {
      if (!client || !profile) throw new Error("Sessão não disponível.");
      const { error } = await client.rpc("admin_assign_profile", {
        p_user_id: userId,
        p_company_id: profile.company_id,
        p_unit_id: nextUnit,
        p_full_name: name,
        p_role: nextRole,
        p_status: status,
      });
      if (error)
        throw new Error(
          error.code === "42501"
            ? "A alteração não está autorizada para este escopo."
            : "Não foi possível atualizar o perfil.",
        );
    },
    onSuccess: async () => {
      setMessage("Perfil atualizado.");
      setErrorMessage(null);
      await queryClient.invalidateQueries({
        queryKey: ["profiles", profile?.company_id],
      });
    },
    onError: (error) =>
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o perfil.",
      ),
  });

  const edit = (
    user: NonNullable<typeof profilesQuery.data>[number],
    field: "role" | "unit_id",
    value: string,
  ) => {
    updateMutation.mutate({
      userId: user.user_id,
      fullName: user.full_name,
      role:
        field === "role" ? (value as ProfileRole) : (user.role as ProfileRole),
      unitId:
        field === "unit_id"
          ? value === "empresa"
            ? null
            : value
          : user.unit_id,
      status: user.status as "active" | "inactive",
    });
  };

  const changeMode = (mode: "invite" | "username") => {
    setAccountMode(mode);
    if (mode === "username" && role !== "operator" && role !== "stock_manager")
      setRole("operator");
    setMessage(null);
    setErrorMessage(null);
    setInviteUrl(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setErrorMessage(null);
    setInviteUrl(null);
    setInviteCopied(false);
    if (accountMode === "invite") inviteMutation.mutate();
    else createUserMutation.mutate();
  };

  const busy = inviteMutation.isPending || createUserMutation.isPending;
  const visibleRoles =
    accountMode === "username"
      ? ROLES.filter(
          (item) => item.value === "operator" || item.value === "stock_manager",
        )
      : ROLES;

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Usuários"
        description="Crie contas e administre papéis, unidades e acessos."
      />
      {!canAdmin && (
        <BackendNotice>
          Seu perfil pode consultar somente os usuários que as políticas de
          acesso autorizam. A administração está disponível para
          administradores.
        </BackendNotice>
      )}
      {canAdmin && (
        <Panel
          title={
            accountMode === "invite"
              ? "Convidar por e-mail"
              : "Criar usuário sem e-mail"
          }
          description="Contas sem e-mail usam nome de usuário e senha definidos pelo administrador. A senha não fica armazenada no perfil."
          actions={<UserPlus className="size-4 text-primary" />}
        >
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={accountMode === "invite" ? "default" : "outline"}
              onClick={() => changeMode("invite")}
            >
              Convidar por e-mail
            </Button>
            <Button
              type="button"
              variant={accountMode === "username" ? "default" : "outline"}
              onClick={() => changeMode("username")}
            >
              Criar sem e-mail
            </Button>
          </div>
          <form
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"
            onSubmit={submit}
          >
            <Field label="Nome completo" required>
              <Input
                required
                maxLength={160}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </Field>
            {accountMode === "invite" ? (
              <Field label="E-mail" required>
                <Input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field label="Nome de usuário" required>
                  <Input
                    required
                    minLength={3}
                    maxLength={32}
                    pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}"
                    autoCapitalize="none"
                    autoComplete="off"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    3 a 32 caracteres: letras sem acento, números, ponto, hífen
                    ou sublinhado.
                  </span>
                </Field>
                <Field label="Senha inicial" required>
                  <Input
                    required
                    type="password"
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                    value={initialPassword}
                    onChange={(event) => setInitialPassword(event.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    Entregue a senha ao usuário por um canal seguro.
                  </span>
                </Field>
              </>
            )}
            <Field label="Perfil">
              <Select
                value={role}
                onValueChange={(value) => setRole(value as ProfileRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {visibleRoles.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Unidade">
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="empresa">Toda a empresa</SelectItem>
                  {units.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button className="w-full" disabled={busy}>
                {busy
                  ? "Salvando…"
                  : accountMode === "invite"
                    ? "Gerar link de convite"
                    : "Criar conta"}
              </Button>
            </div>
          </form>
          {message && (
            <p role="status" className="mt-3 text-sm text-success">
              {message}
            </p>
          )}
          {inviteUrl && (
            <div className="mt-3 grid gap-2 rounded-md border bg-muted/40 p-3 sm:grid-cols-[1fr_auto]">
              <Input
                aria-label="Link de convite"
                readOnly
                value={inviteUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(inviteUrl)
                    .then(() => setInviteCopied(true))
                }
              >
                {inviteCopied ? <Check /> : <Copy />}
                {inviteCopied ? "Copiado" : "Copiar link"}
              </Button>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Link individual de uso único. Envie diretamente à pessoa
                convidada.
              </p>
            </div>
          )}
          {errorMessage && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {errorMessage}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Sem e-mail ou telefone não há recuperação automática de senha; o
            administrador precisará redefini-la. Administradores limitados a uma
            unidade só podem administrar essa unidade.
          </p>
        </Panel>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {ROLES.slice(0, 3).map((item) => (
          <div key={item.value} className="surface flex gap-3 p-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <item.icon className="size-4.5" />
            </span>
            <div>
              <p className="text-sm font-semibold">{item.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.description}
              </p>
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
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nenhum perfil visível para esta conta.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Nome / usuário",
                    "Papel",
                    "Unidade",
                    "Status",
                    "Acesso",
                  ].map((label) => (
                    <th key={label} className="px-4 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {profilesQuery.data?.map((user) => (
                  <tr key={user.user_id}>
                    <td className="px-4 py-3">
                      {user.full_name}
                      <span className="block text-xs text-muted-foreground">
                        {user.username
                          ? `@${user.username}`
                          : user.user_id.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {canAdmin && user.user_id !== profile?.user_id ? (
                        <Select
                          value={user.role}
                          onValueChange={(value) => edit(user, "role", value)}
                        >
                          <SelectTrigger className="w-[190px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        roleLabel(user.role)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canAdmin && user.user_id !== profile?.user_id ? (
                        <Select
                          value={user.unit_id ?? "empresa"}
                          onValueChange={(value) =>
                            edit(user, "unit_id", value)
                          }
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="empresa">
                              Toda a empresa
                            </SelectItem>
                            {units.map((unit) => (
                              <SelectItem key={unit.id} value={unit.id}>
                                {unit.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        (user.units?.name ?? "Toda a empresa")
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.status === "active" ? "Ativo" : "Inativo"}
                    </td>
                    <td className="px-4 py-3">
                      {canAdmin && user.user_id !== profile?.user_id ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateMutation.isPending}
                          onClick={() =>
                            updateMutation.mutate({
                              userId: user.user_id,
                              fullName: user.full_name,
                              role: user.role as ProfileRole,
                              unitId: user.unit_id,
                              status:
                                user.status === "active"
                                  ? "inactive"
                                  : "active",
                            })
                          }
                        >
                          {user.status === "active" ? "Desativar" : "Reativar"}
                        </Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {updateMutation.isError && (
          <p
            role="alert"
            className="border-t px-4 py-3 text-sm text-destructive"
          >
            {errorMessage ?? updateMutation.error.message}
          </p>
        )}
      </Panel>
    </div>
  );
}
