import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const productionOrigin = "https://infosolutionsplannig.netlify.app";

function isAllowedOrigin(origin: string | null) {
  if (!origin) return true;
  return (
    origin === productionOrigin ||
    /^http:\/\/(localhost|127\.0\.0\.1):(3000|5173|8080|8081)$/.test(origin) ||
    /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:(8080|8081)$/.test(origin)
  );
}

Deno.serve(async (request) => {
  let failureStage = "initialização";
  try {
  // Restringe origens conhecidas e permite a chamada autenticada do navegador.
  const origin = request.headers.get("Origin");
  const corsHeaders = {
    ...(origin && isAllowedOrigin(origin)
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
  if (origin && !isAllowedOrigin(origin))
    return respond({ error: "Origem não autorizada." }, 403);
  if (request.method !== "POST")
    return respond({ error: "Método não permitido." }, 405);

  // A plataforma também valida o JWT; esta checagem confirma sessão e papel ISP.
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    return respond({ error: "Sessão do ISP inválida." }, 401);

  failureStage = "configuração do Supabase";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  let publishableKeys: Record<string, string> = {};
  try {
    publishableKeys = JSON.parse(
      Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}",
    ) as Record<string, string>;
  } catch {
    return respond(
      { error: "A configuração das chaves públicas do Supabase está inválida." },
      503,
    );
  }
  const publicKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? publishableKeys.default;
  const visionApiKey = Deno.env.get("GOOGLE_CLOUD_VISION_API_KEY");
  if (!supabaseUrl || !publicKey)
    return respond(
      { error: "A função de OCR não está configurada no Supabase." },
      503,
    );
  if (!visionApiKey)
    return respond(
      { error: "A chave do Google Cloud Vision ainda não foi configurada." },
      503,
    );

  failureStage = "validação da sessão";
  const caller = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await caller.auth.getUser();
  if (userError || !userResult.user)
    return respond({ error: "Sessão inválida ou expirada." }, 401);

  failureStage = "validação do perfil";
  const { data: profile, error: profileError } = await caller
    .from("profiles")
    .select("role, status")
    .eq("user_id", userResult.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.status !== "active")
    return respond({ error: "Perfil ISP ativo não encontrado." }, 403);
  if (!["admin", "stock_manager", "super_admin"].includes(profile.role))
    return respond(
      { error: "Seu perfil não pode importar entradas de estoque." },
      403,
    );

  failureStage = "leitura dos dados da imagem";
  let input: { imageBase64?: unknown; mimeType?: unknown };
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Dados da imagem inválidos." }, 400);
  }

  const imageBase64 =
    typeof input.imageBase64 === "string" ? input.imageBase64 : "";
  const mimeType = typeof input.mimeType === "string" ? input.mimeType : "";
  if (!imageBase64 || imageBase64.length > 4_500_000)
    return respond(
      { error: "A página excede o tamanho máximo para OCR." },
      413,
    );
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))
    return respond({ error: "Conteúdo da imagem inválido." }, 400);
  if (!["image/jpeg", "image/png"].includes(mimeType))
    return respond({ error: "Formato de imagem não permitido." }, 415);

  // Envia somente uma página rasterizada; o arquivo PDF não é guardado no Supabase.
  const visionUrl = new URL("https://vision.googleapis.com/v1/images:annotate");
  visionUrl.searchParams.set("key", visionApiKey);
  failureStage = "chamada ao Google Cloud Vision";
  let visionResponse: Response;
  try {
    visionResponse = await fetch(visionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: { languageHints: ["pt"] },
          },
        ],
      }),
    });
  } catch {
    return respond(
      { error: "Não foi possível conectar ao OCR do Google." },
      502,
    );
  }
  if (!visionResponse.ok) {
    // Expõe só a mensagem do provedor para diagnosticar API, chave ou cota;
    // nunca devolve a URL de requisição, que contém a chave de API.
    let providerMessage = "O provedor não informou o motivo.";
    try {
      const providerPayload: unknown = await visionResponse.clone().json();
      if (
        providerPayload &&
        typeof providerPayload === "object" &&
        "error" in providerPayload &&
        providerPayload.error &&
        typeof providerPayload.error === "object" &&
        "message" in providerPayload.error &&
        typeof providerPayload.error.message === "string"
      ) {
        providerMessage = providerPayload.error.message.slice(0, 400);
      }
    } catch {
      // A resposta do Google pode não ser JSON; o status ainda é útil.
    }
    return respond(
      {
        error: `O Google Cloud Vision recusou a página (HTTP ${visionResponse.status}): ${providerMessage}`,
      },
      502,
    );
  }

  failureStage = "leitura da resposta do Google Cloud Vision";
  let payload: {
    responses?: Array<{
      error?: { message?: string };
      fullTextAnnotation?: {
        text?: string;
        pages?: Array<{
          width?: number;
          height?: number;
          blocks?: Array<{
            paragraphs?: Array<{
              words?: Array<{
                boundingBox?: {
                  vertices?: Array<{ x?: number; y?: number }>;
                };
                symbols?: Array<{ text?: string }>;
              }>;
            }>;
          }>;
        }>;
      };
    }>;
  };
  try {
    payload = await visionResponse.json();
  } catch {
    return respond(
      { error: "O serviço de OCR retornou uma resposta inválida. Tente novamente." },
      502,
    );
  }
  const result = payload.responses?.[0];
  if (result?.error)
    return respond(
      { error: "O Google Cloud Vision não conseguiu ler esta página." },
      422,
    );

  const annotation = result?.fullTextAnnotation;
  if (!annotation?.text)
    return respond(
      { error: "Nenhum texto legível foi encontrado nesta página." },
      422,
    );

  const page = annotation.pages?.[0];
  const words = (page?.blocks ?? []).flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.words ?? []).map((word) => {
        const vertices = word.boundingBox?.vertices ?? [];
        const xs = vertices.map((vertex) => vertex.x ?? 0);
        const ys = vertices.map((vertex) => vertex.y ?? 0);
        return {
          text: (word.symbols ?? [])
            .map((symbol) => symbol.text ?? "")
            .join(""),
          bbox: {
            x0: Math.min(...xs),
            x1: Math.max(...xs),
            y0: Math.min(...ys),
            y1: Math.max(...ys),
          },
        };
      }),
    ),
  );

  return respond({
    text: annotation.text,
    width: page?.width ?? 0,
    height: page?.height ?? 0,
    words,
  });
  } catch (error) {
    // Registra apenas o estágio e o tipo; nunca grava PDF, imagem, token ou chave.
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error("danfe-vision-ocr falhou", {
      stage: failureStage,
      errorType,
    });
    const origin = request.headers.get("Origin");
    const headers = {
      ...(origin && isAllowedOrigin(origin)
        ? { "Access-Control-Allow-Origin": origin }
        : {}),
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
      Vary: "Origin",
    };
    return new Response(
      JSON.stringify({
        error: `Falha interna durante ${failureStage}. Consulte os logs da função usando o identificador da requisição.`,
      }),
      { status: 500, headers },
    );
  }
});
