import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { createBrowserSupabaseClient, type SupabaseClient } from "./client";
import type { UserProfile } from "./types";

type AuthState = {
  client: SupabaseClient | null;
  session: Session | null;
  profile: UserProfile | null;
  ready: boolean;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!client || !session) return;
    const { data, error } = await client
      .from("profiles")
      .select(
        "user_id, company_id, unit_id, full_name, role, status, avatar_path, theme_preference",
      )
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error || !data || data.status !== "active") {
      setProfileError(
        "Não foi possível atualizar seu perfil. Tente novamente.",
      );
      return;
    }
    setProfile(data as UserProfile);
    setProfileError(null);
  }, [client, session]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    setClient(supabase);
    if (!supabase) {
      setReady(true);
      return;
    }

    let active = true;
    const loadProfile = async (nextSession: Session | null) => {
      setSession(nextSession);
      setProfile(null);
      setProfileError(null);
      if (!nextSession) return;

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select(
            "user_id, company_id, unit_id, full_name, role, status, avatar_path, theme_preference",
          )
          .eq("user_id", nextSession.user.id)
          .maybeSingle();
        if (!active) return;
        if (error) {
          setProfileError(
            "Não foi possível carregar seu perfil de acesso. Tente novamente.",
          );
        } else if (!data || data.status !== "active") {
          setProfileError(
            "Sua conta ainda não tem um perfil ativo no ISP. Peça ao administrador para liberar o acesso.",
          );
        } else {
          setProfile(data as UserProfile);
        }
      } catch {
        if (active)
          setProfileError("Falha de conexão ao validar seu perfil de acesso.");
      }
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      void loadProfile(data.session).finally(() => {
        if (active) setReady(true);
      });
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!active) return;
        setReady(false);
        // Defer network work outside Supabase's auth event callback.
        window.setTimeout(() => {
          if (!active) return;
          void loadProfile(nextSession).finally(() => {
            if (active) setReady(true);
          });
        }, 0);
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ client, session, profile, ready, profileError, refreshProfile }),
    [client, session, profile, ready, profileError, refreshProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const state = useContext(AuthContext);
  if (!state) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return state;
}
