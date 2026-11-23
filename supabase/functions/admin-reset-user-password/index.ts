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
  const respond = (body: Record<string, string>, status = 200) =>
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
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user)
    return respond({ error: "Sessão inválida ou expirada." }, 401);

  const { data: actor, error: actorError } = await admin
    .from("profiles")
    .select("company_id, role, status, unit_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (actorError || !actor)
    return respond({ error: "Não foi possível validar seu perfil." }, 500);
  if (
    actor.status !== "active" ||
    !["admin", "super_admin"].includes(actor.role)
  )
    return respond(
      { error: "Somente um administrador ativo pode redefinir senhas." },
      403,
    );

  let input: { userId?: unknown; password?: unknown };
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Dados inválidos." }, 400);
  }
  const userId = typeof input.userId === "string" ? input.userId : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!userId || password.length < 8 || password.length > 72)
    return respond(
      { error: "Informe uma senha entre 8 e 72 caracteres." },
      400,
    );
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("company_id, unit_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (targetError || !target || target.company_id !== actor.company_id)
    return respond({ error: "Usuário não encontrado nesta empresa." }, 404);
  if (target.role === "super_admin" && userId !== authData.user.id)
    return respond(
      {
        error:
          "A senha de um superadministrador não pode ser redefinida por esta tela.",
      },
      403,
    );

  if (
    userId !== authData.user.id &&
    actor.role !== "super_admin" &&
    actor.unit_id !== null
  ) {
    const { data: actorUnits } = await admin
      .from("profile_unit_access")
      .select("unit_id")
      .eq("user_id", authData.user.id)
      .eq("company_id", actor.company_id);
    const { data: targetUnits } = await admin
      .from("profile_unit_access")
      .select("unit_id")
      .eq("user_id", userId)
      .eq("company_id", actor.company_id);
    const manageable = new Set([
      actor.unit_id,
      ...(actorUnits ?? []).map((row) => row.unit_id),
    ]);
    const assigned = [
      target.unit_id,
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

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password,
  });
  if (updateError) {
    console.error("admin-reset-user-password update failed", updateError);
    return respond({ error: "Não foi possível redefinir a senha." }, 400);
  }
  return respond({
    message: "Senha redefinida. Entregue a nova senha por um canal seguro.",
  });
});
