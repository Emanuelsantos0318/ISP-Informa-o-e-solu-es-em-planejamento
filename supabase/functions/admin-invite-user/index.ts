import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://infosolutionsplannig.netlify.app",
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
  const json = (body: Record<string, string>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (origin && !allowedOrigins.has(origin))
    return json({ error: "Origem nÃ£o autorizada." }, 403);
  if (request.method !== "POST")
    return json({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    return json({ error: "Sessão inválida." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey)
    return json({ error: "Função não configurada." }, 500);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await caller.auth.getUser();
  if (userError || !userResult.user)
    return json({ error: "Sessão inválida ou expirada." }, 401);

  const { data: callerProfile, error: profileError } = await admin
    .from("profiles")
    .select("company_id, role, status")
    .eq("user_id", userResult.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("admin-invite-user profile lookup failed", profileError);
    return json(
      { error: "Não foi possível validar seu perfil. Tente novamente." },
      500,
    );
  }
  if (!callerProfile || callerProfile.status !== "active") {
    return json(
      { error: "Sua conta não possui um perfil ativo no ISP." },
      403,
    );
  }
  if (!["admin", "super_admin"].includes(callerProfile.role))
    return json(
      { error: "Somente um administrador ativo pode convidar usuários." },
      403,
    );

  let input: {
    email?: unknown;
    fullName?: unknown;
    role?: unknown;
    unitId?: unknown;
  };
  try {
    input = await request.json();
  } catch {
    return json({ error: "Dados do convite inválidos." }, 400);
  }
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const fullName =
    typeof input.fullName === "string" ? input.fullName.trim() : "";
  const role = input.role;
  const unitId =
    typeof input.unitId === "string" && input.unitId ? input.unitId : null;
  const allowedRoles = [
    "admin",
    "stock_manager",
    "operator",
    "purchasing_approver",
    "viewer",
  ];
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    fullName.length < 1 ||
    fullName.length > 160 ||
    typeof role !== "string" ||
    !allowedRoles.includes(role)
  ) {
    return json({ error: "Informe nome, e-mail e perfil válidos." }, 400);
  }

  const { data: inviteResult, error: inviteError } =
    await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { full_name: fullName } },
    });
  if (
    inviteError ||
    !inviteResult.user ||
    !inviteResult.properties?.hashed_token
  )
    return json(
      { error: inviteError?.message ?? "Não foi possível gerar o convite." },
      400,
    );

  const { error: assignError } = await caller.rpc("admin_assign_profile", {
    p_user_id: inviteResult.user.id,
    p_company_id: callerProfile.company_id,
    p_unit_id: unitId,
    p_full_name: fullName,
    p_role: role,
    p_status: "active",
  });
  if (assignError) {
    await admin.auth.admin.deleteUser(inviteResult.user.id);
    return json(
      {
        error:
          assignError.code === "42501"
            ? "Você não pode administrar esta unidade."
            : "Não foi possível atribuir o perfil. Nenhum convite foi concluído.",
      },
      400,
    );
  }
  const inviteUrl = new URL(
    `${origin ?? "https://infosolutionsplannig.netlify.app"}/aceitar-convite`,
  );
  inviteUrl.searchParams.set(
    "token_hash",
    inviteResult.properties.hashed_token,
  );
  inviteUrl.searchParams.set("type", "invite");
  return json(
    {
      userId: inviteResult.user.id,
      inviteUrl: inviteUrl.toString(),
      message: "Convite gerado e perfil configurado.",
    },
    200,
  );
});
