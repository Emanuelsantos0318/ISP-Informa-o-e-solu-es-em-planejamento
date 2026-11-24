import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://isp-informa-o-e-solu-es-em-planejamento.emanuelltest.workers.dev",
  "https://infosolutionsplannig.netlify.app",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:8081",
  "http://localhost:3000",
]);

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  const corsHeaders = {
    ...(origin && allowedOrigins.has(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return respond({ error: "Método não permitido." }, 405);
  if (origin && !allowedOrigins.has(origin))
    return respond({ error: "Origem não autorizada." }, 403);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    return respond({ error: "Sessão inválida." }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey)
    return respond({ error: "Função não configurada." }, 500);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authResult, error: authError } = await caller.auth.getUser();
  if (authError || !authResult.user)
    return respond({ error: "Sessão inválida ou expirada." }, 401);

  const { data: actor, error: actorError } = await admin
    .from("profiles")
    .select("company_id, role, status, unit_id")
    .eq("user_id", authResult.user.id)
    .maybeSingle();
  if (actorError || !actor)
    return respond({ error: "Não foi possível validar seu perfil." }, 500);
  if (
    actor.status !== "active" ||
    !["admin", "super_admin"].includes(actor.role)
  )
    return respond(
      { error: "Somente um administrador ativo pode gerenciar contas." },
      403,
    );

  let input: { action?: unknown; userId?: unknown; newEmail?: unknown };
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Dados inválidos." }, 400);
  }
  const userId = typeof input.userId === "string" ? input.userId : "";
  const action = input.action;
  if (
    !userId ||
    !["details", "resend_invite", "send_recovery", "change_email"].includes(
      String(action),
    )
  )
    return respond({ error: "Ação ou usuário inválido." }, 400);

  const { data: targetProfile, error: targetError } = await admin
    .from("profiles")
    .select("company_id, unit_id, role, full_name, username")
    .eq("user_id", userId)
    .maybeSingle();
  if (
    targetError ||
    !targetProfile ||
    targetProfile.company_id !== actor.company_id
  )
    return respond({ error: "Usuário não encontrado nesta empresa." }, 404);
  if (targetProfile.role === "super_admin" && userId !== authResult.user.id)
    return respond(
      { error: "Esta conta está fora do escopo de gerenciamento." },
      403,
    );

  if (
    userId !== authResult.user.id &&
    actor.role !== "super_admin" &&
    actor.unit_id !== null
  ) {
    const [{ data: actorUnits }, { data: targetUnits }] = await Promise.all([
      admin
        .from("profile_unit_access")
        .select("unit_id")
        .eq("user_id", authResult.user.id)
        .eq("company_id", actor.company_id),
      admin
        .from("profile_unit_access")
        .select("unit_id")
        .eq("user_id", userId)
        .eq("company_id", actor.company_id),
    ]);
    const manageable = new Set([
      actor.unit_id,
      ...(actorUnits ?? []).map((row) => row.unit_id),
    ]);
    const assigned = [
      targetProfile.unit_id,
      ...(targetUnits ?? []).map((row) => row.unit_id),
    ].filter((unitId): unitId is string => typeof unitId === "string");
    if (
      assigned.length === 0 ||
      assigned.some((unitId) => !manageable.has(unitId))
    )
      return respond(
        {
          error:
            "Este usuário possui unidades fora do seu escopo administrativo.",
        },
        403,
      );
  }

  const { data: targetAuth, error: authUserError } =
    await admin.auth.admin.getUserById(userId);
  if (authUserError || !targetAuth.user)
    return respond(
      { error: "Não foi possível consultar a conta de acesso." },
      404,
    );
  const accountEmail = targetAuth.user.email?.trim().toLowerCase() ?? "";
  const isUsernameOnly =
    !accountEmail || accountEmail.endsWith("@users.isp.invalid");
  // Links para usuários sempre apontam para a versão pública, mesmo quando o
  // administrador estiver usando uma cópia local de desenvolvimento.
  const siteOrigin =
    "https://isp-informa-o-e-solu-es-em-planejamento.emanuelltest.workers.dev";

  if (action === "details") {
    return respond({
      userId,
      email: isUsernameOnly ? null : accountEmail,
      username: targetProfile.username,
      fullName: targetProfile.full_name,
      emailConfirmed: Boolean(targetAuth.user.email_confirmed_at),
      invitedAt: targetAuth.user.invited_at ?? null,
      lastSignInAt: targetAuth.user.last_sign_in_at ?? null,
      accountType: isUsernameOnly ? "username" : "email",
    });
  }
  if (isUsernameOnly)
    return respond(
      {
        error:
          "Esta conta não possui e-mail. Use a redefinição manual de senha.",
      },
      400,
    );

  if (action === "send_recovery") {
    const { error } = await caller.auth.resetPasswordForEmail(accountEmail, {
      redirectTo: `${siteOrigin}/redefinir-senha`,
    });
    if (error) {
      console.error("admin-manage-user recovery email failed", error);
      return respond(
        {
          error:
            "Não foi possível enviar o link. Confira o serviço de e-mail do Supabase.",
        },
        400,
      );
    }
    return respond({
      message: `Link de alteração enviado para ${accountEmail}.`,
    });
  }

  if (action === "resend_invite") {
    if (targetAuth.user.email_confirmed_at)
      return respond(
        {
          error:
            "Este e-mail já foi confirmado. Use o link de alteração de senha.",
        },
        400,
      );
    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email: accountEmail,
      options: {
        redirectTo: `${siteOrigin}/aceitar-convite`,
        data: { full_name: targetProfile.full_name },
      },
    });
    if (!error && data.properties?.action_link)
      return respond({
        inviteUrl: data.properties.action_link,
        email: accountEmail,
        message: "Novo link de convite gerado. Copie e encaminhe ao usuário.",
      });

    // Para contas pendentes já existentes, a API de convite pode recusar a
    // criação duplicada. O reenvio de confirmação reativa o link da conta.
    const { error: resendError } = await caller.auth.resend({
      type: "signup",
      email: accountEmail,
      options: { emailRedirectTo: `${siteOrigin}/aceitar-convite` },
    });
    if (resendError) {
      console.error(
        "admin-manage-user invite resend failed",
        error,
        resendError,
      );
      return respond(
        {
          error:
            "Não foi possível reenviar. Confira a configuração de e-mail do Supabase.",
        },
        400,
      );
    }
    return respond({
      email: accountEmail,
      message: `Uma nova confirmação foi enviada para ${accountEmail}.`,
    });
  }

  const newEmail =
    typeof input.newEmail === "string"
      ? input.newEmail.trim().toLowerCase()
      : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail === accountEmail)
    return respond(
      { error: "Informe um e-mail válido e diferente do atual." },
      400,
    );
  const [currentConfirmation, newConfirmation] = await Promise.all([
    admin.auth.admin.generateLink({
      type: "email_change_current",
      email: accountEmail,
      newEmail,
      options: { redirectTo: siteOrigin },
    }),
    admin.auth.admin.generateLink({
      type: "email_change_new",
      email: accountEmail,
      newEmail,
      options: { redirectTo: siteOrigin },
    }),
  ]);
  if (
    currentConfirmation.error ||
    newConfirmation.error ||
    !currentConfirmation.data.properties?.action_link ||
    !newConfirmation.data.properties?.action_link
  ) {
    const error = currentConfirmation.error ?? newConfirmation.error;
    console.error("admin-manage-user email change link failed", error);
    return respond(
      {
        error:
          "Não foi possível gerar as confirmações. Verifique se a confirmação segura de alteração de e-mail está habilitada no Supabase.",
      },
      400,
    );
  }
  return respond({
    currentEmail: accountEmail,
    newEmail,
    currentEmailLink: currentConfirmation.data.properties.action_link,
    newEmailLink: newConfirmation.data.properties.action_link,
    message:
      "A troca só será concluída após a confirmação dos dois endereços de e-mail.",
  });
});
