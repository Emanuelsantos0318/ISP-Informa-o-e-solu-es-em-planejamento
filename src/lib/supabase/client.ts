import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

export type { SupabaseClient, User };

export function createBrowserSupabaseClient(): SupabaseClient | null {
  const url = import.meta.env["VITE_SUPABASE_URL"];
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || typeof window === "undefined") return null;

  return createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storage: window.localStorage,
    },
  });
}
