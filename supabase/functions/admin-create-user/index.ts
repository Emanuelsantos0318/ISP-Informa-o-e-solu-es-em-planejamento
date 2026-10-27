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
  const { data: authUser, error: authError } = await caller.auth.getUser();
  if (authError || !authUser.user)
    return respond({ error: "Sessão inválida ou expirada." }, 401);

  const { data: callerProfile, error: profileError } = await caller
    .from("profiles")
    .select("company_id, role, status")
    .eq("user_id", authUser.user.id)
    .maybeSingle();
  if (
    profileError ||
    !callerProfile ||
    callerProfile.status !== "active" ||
    !["admin", "super_admin"].includes(callerProfile.role)
  ) {
    return respond(
      { error: "Somente um administrador ativo pode criar contas." },
      403,
    );
  }

  let input: {
    username?: unknown;
    fullName?: unknown;
    password?: unknown;
    role?: unknown;
    unitId?: unknown;
  };
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Dados da conta inválidos." }, 400);
  }
  const username =
    typeof input.username === "string"
      ? input.username.trim().toLowerCase()
      : "";
  const fullName =
    typeof input.fullName === "string" ? input.fullName.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const role = input.role;
  const unitId =
    typeof input.unitId === "string" && input.unitId ? input.unitId : null;
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    return respond(
      {
        error:
          "O nome de usuário deve ter 3 a 32 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.",
      },
      400,
    );
  }
  if (
    fullName.length < 1 ||
    fullName.length > 160 ||
    password.length < 8 ||
    password.length > 72
  ) {
    return respond(
      {
        error:
          "Informe nome e senha com pelo menos 8 caracteres (máximo de 72).",
      },
      400,
    );
  }
  if (role !== "operator" && role !== "stock_manager") {
    return respond(
      {
        error:
          "Contas sem e-mail estão disponíveis somente para operadores e gestores de estoque.",
      },
      400,
    );
  }

  const internalEmail = `${username}@users.isp.invalid`;
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, username, login_type: "username" },
    });
  if (createError || !created.user) {
    if (createError?.message.toLowerCase().includes("already")) {
      return respond({ error: "Esse nome de usuário já está em uso." }, 409);
    }
    return respond(
      { error: createError?.message ?? "Não foi possível criar a conta." },
      400,
    );
  }

  const { error: assignError } = await caller.rpc("admin_assign_profile", {
    p_user_id: created.user.id,
    p_company_id: callerProfile.company_id,
    p_unit_id: unitId,
    p_full_name: fullName,
    p_role: role,
    p_status: "active",
  });
  if (assignError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return respond(
      {
        error:
          assignError.code === "42501"
            ? "Você não pode administrar esta unidade."
            : "Não foi possível atribuir o perfil. Verifique a unidade e tente novamente.",
      },
      400,
    );
  }

  const { error: usernameError } = await admin
    .from("profiles")
    .update({ username })
    .eq("user_id", created.user.id)
    .eq("company_id", callerProfile.company_id);
  if (usernameError) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (usernameError.code === "23505")
      return respond({ error: "Esse nome de usuário já está em uso." }, 409);
    return respond(
      {
        error:
          "A conta foi criada, mas o nome de usuário não pôde ser salvo. Tente novamente.",
      },
      500,
    );
  }

  return respond(
    {
      userId: created.user.id,
      username,
      message:
        "Conta criada. Entregue o nome de usuário e a senha inicial ao usuário por um canal seguro.",
    },
    200,
  );
});
