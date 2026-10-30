import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

export type { SupabaseClient, User };

/** Cria o cliente do Supabase somente no navegador, com sessão persistida. */
export function createBrowserSupabaseClient(): SupabaseClient | null {
  // A chave pública pode estar no app; segredos de serviço nunca devem vir por VITE_.
  const url = import.meta.env["VITE_SUPABASE_URL"];
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || typeof window === "undefined") return null;

  // A sessão é mantida no dispositivo e atualizada automaticamente pelo SDK.
  return createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storage: window.localStorage,
    },
  });
}
