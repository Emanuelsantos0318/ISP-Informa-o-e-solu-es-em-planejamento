import { useState, type FormEvent } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
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
  Pencil,
  KeyRound,
  History,
  Mail,
  RefreshCw,
  Send,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/datetime";

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

async function functionErrorMessage(
  error: Error,
  data: unknown,
): Promise<string> {
  const responseBody = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const message = (value as Record<string, unknown>)["error"];
    return typeof message === "string" && message.trim() ? message : null;
  };
  const responseMessage = responseBody(data);
  if (responseMessage) return responseMessage;
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.clone().json();
      const message = responseBody(body);
      if (message) return message;
    } catch {
      // Keep the Supabase error message when the response is not JSON.
    }
  }
  return error.message;
}

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
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<ProfileRole>("operator");
  const [editUnitIds, setEditUnitIds] = useState<string[]>([]);
  const [editAllUnits, setEditAllUnits] = useState(false);
  const [editStatus, setEditStatus] = useState<"active" | "inactive">("active");
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [historyUserId, setHistoryUserId] = useState<string | null>(null);
  const [adminActionResult, setAdminActionResult] = useState<{
    message: string;
    inviteUrl?: string;
    currentEmailLink?: string;
    newEmailLink?: string;
    currentEmail?: string;
    newEmail?: string;
  } | null>(null);
  const canAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const userDetailsQuery = useQuery({
    queryKey: ["admin-user-details", editingUserId],
    queryFn: async () => {
      if (!client || !editingUserId)
        throw new Error("Usuário não selecionado.");
      const { data, error } = await client.functions.invoke(
        "admin-manage-user",
        {
          body: { action: "details", userId: editingUserId },
        },
      );
      if (error) throw new Error(await functionErrorMessage(error, data));
      if (data?.error) throw new Error(data.error);
      return data as {
        email: string | null;
        emailConfirmed: boolean;
        invitedAt: string | null;
        lastSignInAt: string | null;
        accountType: "email" | "username";
      };
    },
    enabled: Boolean(client && editingUserId && canAdmin),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (userDetailsQuery.data) setEditEmail(userDetailsQuery.data.email ?? "");
  }, [userDetailsQuery.data]);

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
      const { data: accessRows, error: accessError } = await client
        .from("profile_unit_access")
        .select("user_id, unit_id")
        .eq("company_id", profile.company_id)
        .limit(5000);
      if (accessError) throw accessError;
      const accessByUser = new Map<string, string[]>();
      for (const access of accessRows) {
        const current = accessByUser.get(access.user_id) ?? [];
        current.push(access.unit_id);
        accessByUser.set(access.user_id, current);
      }
      return data.map((row) => ({
        ...row,
        units: Array.isArray(row.units) ? (row.units[0] ?? null) : row.units,
        unit_ids:
          row.unit_id === null
            ? null
            : [
                ...new Set([
                  row.unit_id,
                  ...(accessByUser.get(row.user_id) ?? []),
                ]),
              ],
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
      if (error) throw new Error(await functionErrorMessage(error, data));
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
      if (error) throw new Error(await functionErrorMessage(error, data));
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
      unitIds: nextUnits,
      status,
    }: {
      userId: string;
      fullName: string;
      role: ProfileRole;
      unitIds: string[] | null;
      status: "active" | "inactive";
    }) => {
      if (!client || !profile) throw new Error("Sessão não disponível.");
      const { error } = await client.rpc("admin_set_user_access", {
        p_user_id: userId,
        p_company_id: profile.company_id,
        p_unit_ids: nextUnits,
        p_full_name: name,
        p_role: nextRole,
        p_status: status,
      });
      if (error)
        throw new Error(
          error.code === "42501"
            ? "A alteração não está autorizada para este escopo."
            : error.message || "Não foi possível atualizar o perfil.",
        );
    },
    onSuccess: async () => {
      setMessage("Perfil atualizado.");
      setErrorMessage(null);
      setEditingUserId(null);
      await queryClient.invalidateQueries({
        queryKey: ["profiles", profile?.company_id],
      });
      await queryClient.invalidateQueries({
        queryKey: [
          "profile-unit-access",
          profile?.user_id,
          profile?.company_id,
        ],
      });
    },
    onError: (error) =>
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o perfil.",
      ),
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (!client || !passwordUserId)
        throw new Error("Selecione um usuário para alterar a senha.");
      const { data, error } = await client.functions.invoke(
        "admin-reset-user-password",
        { body: { userId: passwordUserId, password: newPassword } },
      );
      if (error) throw new Error(await functionErrorMessage(error, data));
      if (data?.error) throw new Error(data.error);
      return data as { message: string };
    },
    onSuccess: (data) => {
      setMessage(data.message);
      setNewPassword("");
      setPasswordUserId(null);
      setErrorMessage(null);
    },
    onError: (error) =>
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível redefinir a senha.",
      ),
  });

  const adminActionMutation = useMutation({
    mutationFn: async (input: {
      action: "resend_invite" | "send_recovery" | "change_email";
      userId: string;
      newEmail?: string;
    }) => {
      if (!client) throw new Error("Supabase não está configurado.");
      const { data, error } = await client.functions.invoke(
        "admin-manage-user",
        {
          body: input,
        },
      );
      if (error) throw new Error(await functionErrorMessage(error, data));
      if (data?.error) throw new Error(data.error);
      return data as NonNullable<typeof adminActionResult>;
    },
    onSuccess: (data) => {
      setAdminActionResult(data);
      setMessage(null);
      setErrorMessage(null);
    },
    onError: (error) => {
      setAdminActionResult(null);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir a ação.",
      );
    },
  });

  const historyQuery = useQuery({
    queryKey: ["user-access-history", profile?.company_id, historyUserId],
    queryFn: async () => {
      if (!client || !profile || !historyUserId) return [];
      const { data, error } = await client
        .from("user_access_history")
        .select("id, occurred_at, user_agent")
        .eq("company_id", profile.company_id)
        .eq("user_id", historyUserId)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: Boolean(client && profile && historyUserId),
  });

  const beginEdit = (user: NonNullable<typeof profilesQuery.data>[number]) => {
    setAdminActionResult(null);
    setErrorMessage(null);
    setEditingUserId(user.user_id);
    setEditEmail("");
    setEditFullName(user.full_name);
    setEditRole(user.role as ProfileRole);
    setEditStatus(user.status as "active" | "inactive");
    setEditAllUnits(user.unit_ids === null);
    setEditUnitIds(user.unit_ids ?? []);
  };

  const saveUser = () => {
    if (!editingUserId) return;
    updateMutation.mutate({
      userId: editingUserId,
      fullName: editFullName.trim(),
      role: editRole,
      unitIds: editAllUnits ? null : editUnitIds,
      status: editStatus,
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
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Nome / usuário",
                    "Papel",
                    "Unidade",
                    "Status",
                    "Ações",
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
                    <td className="px-4 py-3">{roleLabel(user.role)}</td>
                    <td className="px-4 py-3">
                      {user.unit_ids === null
                        ? "Todas as unidades"
                        : user.unit_ids
                            .map(
                              (id) =>
                                units.find((unit) => unit.id === id)?.name ??
                                (id === user.unit_id
                                  ? user.units?.name
                                  : null) ??
                                "Unidade vinculada",
                            )
                            .join(", ")}
                    </td>
                    <td className="px-4 py-3">
                      {user.status === "active" ? "Ativo" : "Inativo"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canAdmin ? (
                          <>
                            {user.user_id !== profile?.user_id && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => beginEdit(user)}
                              >
                                <Pencil className="size-4" /> Editar
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPasswordUserId(user.user_id)}
                            >
                              <KeyRound className="size-4" /> Senha
                            </Button>
                          </>
                        ) : null}
                        {canAdmin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setHistoryUserId(user.user_id)}
                          >
                            <History className="size-4" /> Histórico
                          </Button>
                        )}
                      </div>
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
      <Dialog
        open={Boolean(editingUserId)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingUserId(null);
            setAdminActionResult(null);
            setErrorMessage(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
            <DialogDescription>
              Administre perfil, e-mail, convites e recuperação de acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <Field label="Nome completo" required>
              <Input
                maxLength={160}
                value={editFullName}
                onChange={(event) => setEditFullName(event.target.value)}
              />
            </Field>
            <Field label="E-mail de acesso">
              <Input
                type="email"
                autoComplete="email"
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
                disabled={
                  userDetailsQuery.isLoading ||
                  userDetailsQuery.data?.accountType === "username"
                }
                placeholder={
                  userDetailsQuery.isLoading
                    ? "Carregando…"
                    : "Conta sem e-mail"
                }
              />
              <span className="text-xs text-muted-foreground">
                A conta só muda após confirmar o endereço atual e o novo.
              </span>
            </Field>
            {userDetailsQuery.data && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>
                  Situação do e-mail:{" "}
                  {userDetailsQuery.data.accountType === "username"
                    ? "conta sem e-mail"
                    : userDetailsQuery.data.emailConfirmed
                      ? "confirmado"
                      : "aguardando confirmação"}
                </p>
                {userDetailsQuery.data.invitedAt && (
                  <p className="mt-1">
                    Convite criado:{" "}
                    {formatDateTime(userDetailsQuery.data.invitedAt)}
                  </p>
                )}
                {userDetailsQuery.data.lastSignInAt && (
                  <p className="mt-1">
                    Último acesso:{" "}
                    {formatDateTime(userDetailsQuery.data.lastSignInAt)}
                  </p>
                )}
                {!userDetailsQuery.data.lastSignInAt && (
                  <p className="mt-1">
                    Ainda não há acesso registrado para esta conta.
                  </p>
                )}
              </div>
            )}
            {userDetailsQuery.isError && (
              <p role="alert" className="text-sm text-destructive">
                {userDetailsQuery.error.message}
              </p>
            )}
            <Field label="Perfil">
              <Select
                value={editRole}
                onValueChange={(value) => setEditRole(value as ProfileRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((item) => item.value !== "super_admin").map(
                    (item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
            {(profile?.unit_id === null || profile?.role === "super_admin") && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editAllUnits}
                  onChange={(event) => setEditAllUnits(event.target.checked)}
                />
                Acesso a todas as unidades da empresa
              </label>
            )}
            {!editAllUnits && (
              <fieldset className="grid gap-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">
                  Unidades liberadas
                </legend>
                {units.map((unit) => (
                  <label
                    key={unit.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={editUnitIds.includes(unit.id)}
                      onChange={(event) =>
                        setEditUnitIds((current) =>
                          event.target.checked
                            ? [...current, unit.id]
                            : current.filter((id) => id !== unit.id),
                        )
                      }
                    />
                    {unit.name}
                  </label>
                ))}
              </fieldset>
            )}
            <Field label="Situação">
              <Select
                value={editStatus}
                onValueChange={(value) =>
                  setEditStatus(value as "active" | "inactive")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {updateMutation.isError && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage ?? updateMutation.error.message}
              </p>
            )}
            {adminActionMutation.isError && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage ?? adminActionMutation.error.message}
              </p>
            )}
            {adminActionResult && (
              <div
                role="status"
                className="grid gap-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm"
              >
                <p>{adminActionResult.message}</p>
                {adminActionResult.inviteUrl && (
                  <CopyableLink
                    label="Novo link de convite"
                    value={adminActionResult.inviteUrl}
                  />
                )}
                {adminActionResult.currentEmailLink && (
                  <CopyableLink
                    label={`Confirmação no e-mail atual (${adminActionResult.currentEmail ?? ""})`}
                    value={adminActionResult.currentEmailLink}
                  />
                )}
                {adminActionResult.newEmailLink && (
                  <CopyableLink
                    label={`Confirmação no novo e-mail (${adminActionResult.newEmail ?? ""})`}
                    value={adminActionResult.newEmailLink}
                  />
                )}
              </div>
            )}
            {errorMessage &&
              !updateMutation.isError &&
              !adminActionMutation.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage}
                </p>
              )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUserId(null)}>
              Cancelar
            </Button>
            <Button
              disabled={
                updateMutation.isPending ||
                (!editAllUnits && editUnitIds.length === 0) ||
                !editFullName.trim()
              }
              onClick={saveUser}
            >
              {updateMutation.isPending ? "Salvando…" : "Salvar alterações"}
            </Button>
          </DialogFooter>
          <div className="grid gap-2 border-t pt-4 sm:grid-cols-2">
            {userDetailsQuery.data?.accountType === "email" &&
              !userDetailsQuery.data.emailConfirmed && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={adminActionMutation.isPending}
                  onClick={() =>
                    editingUserId &&
                    adminActionMutation.mutate({
                      action: "resend_invite",
                      userId: editingUserId,
                    })
                  }
                >
                  <RefreshCw className="size-4" /> Reenviar convite
                </Button>
              )}
            {userDetailsQuery.data?.accountType === "email" && (
              <Button
                type="button"
                variant="outline"
                disabled={adminActionMutation.isPending}
                onClick={() =>
                  editingUserId &&
                  adminActionMutation.mutate({
                    action: "send_recovery",
                    userId: editingUserId,
                  })
                }
              >
                <Send className="size-4" /> Enviar link de senha
              </Button>
            )}
            {userDetailsQuery.data?.accountType === "email" &&
              editEmail.trim().toLowerCase() !==
                userDetailsQuery.data.email && (
                <Button
                  type="button"
                  variant="outline"
                  className="sm:col-span-2"
                  disabled={adminActionMutation.isPending || !editEmail.trim()}
                  onClick={() =>
                    editingUserId &&
                    adminActionMutation.mutate({
                      action: "change_email",
                      userId: editingUserId,
                      newEmail: editEmail,
                    })
                  }
                >
                  <Mail className="size-4" /> Gerar confirmação de novo e-mail
                </Button>
              )}
            {adminActionMutation.isPending && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Processando solicitação…
              </p>
            )}
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Os links gerados são de uso único. A alteração de e-mail requer
              confirmação nos dois endereços; encaminhe cada link ao respectivo
              titular.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(passwordUserId)}
        onOpenChange={(open) => {
          if (!open) {
            setPasswordUserId(null);
            setNewPassword("");
            passwordMutation.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              A nova senha substitui a atual. Entregue-a diretamente ao usuário
              por um canal seguro.
            </DialogDescription>
          </DialogHeader>
          <Field label="Nova senha" required>
            <Input
              type="password"
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          {passwordMutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage ?? passwordMutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordUserId(null)}>
              Cancelar
            </Button>
            <Button
              disabled={passwordMutation.isPending || newPassword.length < 8}
              onClick={() => passwordMutation.mutate()}
            >
              {passwordMutation.isPending ? "Atualizando…" : "Alterar senha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(historyUserId)}
        onOpenChange={(open) => !open && setHistoryUserId(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Histórico de acesso</DialogTitle>
            <DialogDescription>
              {profilesQuery.data?.find(
                (user) => user.user_id === historyUserId,
              )?.full_name ?? "Usuário"}{" "}
              · últimos 100 logins registrados após a ativação do histórico.
            </DialogDescription>
          </DialogHeader>
          {historyQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">
              Carregando histórico…
            </p>
          ) : historyQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar o histórico para seu escopo.
            </p>
          ) : (historyQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum login registrado desde a ativação do histórico.
            </p>
          ) : (
            <ol className="grid gap-3">
              {historyQuery.data?.map((entry) => (
                <li key={entry.id} className="rounded-md border p-3">
                  <p className="font-medium">
                    {formatDateTime(entry.occurred_at)}
                  </p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {entry.user_agent || "Navegador não informado"}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CopyableLink({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
      <label className="grid gap-1 text-xs font-medium">
        {label}
        <Input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        className="self-end"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => setCopied(true))
        }
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}
