import { useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Field";
import { AppShell } from "@/components/layout/AppShell";
import { OperationalScopeProvider } from "@/lib/supabase/OperationalScopeProvider";

export function AccessGate({ children }: { children: ReactNode }) {
  const { client, session, profile, ready, profileError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready || !client) {
    return (
      <Message
        title="Configuração pendente"
        text="Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no ambiente de execução para habilitar o acesso ao ISP."
      />
    );
  }
  if (!ready)
    return (
      <Message
        title="Verificando acesso"
        text="Carregando sua sessão e perfil autorizado…"
        loading
      />
    );
  if (session && profile)
    return (
      <OperationalScopeProvider>
        <AppShell>{children}</AppShell>
      </OperationalScopeProvider>
    );
  if (session && profileError) {
    return (
      <Message
        title="Acesso não liberado"
        text={profileError}
        action={
          <Button variant="outline" onClick={() => void client.auth.signOut()}>
            Sair
          </Button>
        }
      />
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError)
        setError("E-mail ou senha inválidos, ou conta ainda não confirmada.");
    } catch {
      setError("Falha de conexão. Confira sua rede e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="surface w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              ISP
            </p>
            <h1 className="text-xl font-semibold">Gestão de Estoque</h1>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Entre com uma conta autorizada pela administração da operação.
        </p>
        <form
          onSubmit={(event) => void submit(event)}
          className="mt-6 grid gap-4"
        >
          <Field label="E-mail" htmlFor="login-email" required>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Senha" htmlFor="login-password" required>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy ? <LoaderCircle className="animate-spin" /> : <LogIn />}{" "}
            Entrar
          </Button>
        </form>
      </section>
    </main>
  );
}

function Message({
  title,
  text,
  action,
  loading,
}: {
  title: string;
  text: string;
  action?: ReactNode | undefined;
  loading?: boolean | undefined;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="surface max-w-lg p-6 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
          {loading ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <ShieldCheck />
          )}
        </div>
        <h1 className="mt-4 text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
        {action && <div className="mt-5">{action}</div>}
      </section>
    </main>
  );
}
