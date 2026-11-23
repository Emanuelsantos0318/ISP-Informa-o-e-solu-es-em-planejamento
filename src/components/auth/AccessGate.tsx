import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  Eye,
  EyeOff,
  LoaderCircle,
  LogIn,
  ShieldCheck,
} from "lucide-react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Field";
import { AppShell } from "@/components/layout/AppShell";
import { OperationalScopeProvider } from "@/lib/supabase/OperationalScopeProvider";
import { ThemeToggle } from "@/components/common/ThemeToggle";

/** Decide entre configuração pendente, login, rotas públicas e área autenticada. */
export function AccessGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isInviteAcceptance =
    router.state.location.pathname === "/aceitar-convite";
  const isPasswordReset = router.state.location.pathname === "/redefinir-senha";
  const isAboutPage = pathname === "/conheca-isp";
  const { client, session, profile, ready, profileError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Operadores começam direto no fluxo de saída para reduzir etapas no balcão.
    if (session && profile?.role === "operator" && pathname === "/")
      void router.navigate({ to: "/saida", replace: true });
  }, [pathname, profile?.role, router, session]);

  // A apresentação comercial é pública e pode abrir mesmo sem a conexão do banco.
  if (isAboutPage) return <>{children}</>;

  if (!ready) {
    return (
      <Message
        title="Verificando acesso"
        text="Carregando sua sessão e perfil autorizado…"
        loading
      />
    );
  }
  if (!client) {
    return (
      <Message
        title="Configuração pendente"
        text="Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no ambiente de execução para habilitar o acesso ao ISP."
      />
    );
  }
  // Convite e redefinição precisam abrir antes da sessão normal estar estabelecida.
  if (isInviteAcceptance || isPasswordReset) return <>{children}</>;
  if (session && profile?.role === "operator" && pathname === "/")
    return (
      <Message
        title="Abrindo área de saída"
        text="Carregando a tela de registro de saídas."
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
    setNotice(null);
    setBusy(true);
    try {
      const identifier = email.trim().toLowerCase();
      // Contas sem e-mail usam o identificador interno definido na criação da conta.
      const credentials = identifier.includes("@")
        ? { email: identifier, password }
        : { email: `${identifier}@users.isp.invalid`, password };
      const { error: signInError } =
        await client.auth.signInWithPassword(credentials);
      if (signInError)
        setError("E-mail ou senha inválidos, ou conta ainda não confirmada.");
    } catch {
      setError("Falha de conexão. Confira sua rede e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    setError(null);
    setNotice(null);
    const identifier = email.trim().toLowerCase();
    if (!identifier.includes("@")) {
      setError(
        "Para recuperar por e-mail, informe o e-mail cadastrado. Contas criadas somente com nome de usuário precisam solicitar a redefinição ao administrador.",
      );
      return;
    }
    setBusy(true);
    try {
      const { error: resetError } = await client.auth.resetPasswordForEmail(
        identifier,
        { redirectTo: `${window.location.origin}/redefinir-senha` },
      );
      if (resetError) {
        setError(
          "Não foi possível solicitar o link. Verifique se o serviço de e-mail do ISP está disponível e tente novamente.",
        );
      } else {
        setNotice(
          "Se este e-mail estiver cadastrado, você receberá um link seguro para criar uma nova senha.",
        );
      }
    } catch {
      setError("Falha de conexão ao solicitar a recuperação da senha.");
    } finally {
      setBusy(false);
    }
  };

  // Sem perfil ativo, somente o formulário de autenticação é apresentado.
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <section className="surface w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-4">
          <img
            src="/isp-logo.png"
            alt="Logo InfoSolutions Planning"
            className="size-24 shrink-0 object-contain"
            width={96}
            height={96}
          />
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
          <Field
            label="E-mail ou nome de usuário"
            htmlFor="login-email"
            required
          >
            <Input
              id="login-email"
              type="text"
              autoCapitalize="none"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Senha" htmlFor="login-password" required>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="pr-11"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
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
          {notice && (
            <p
              role="status"
              className="rounded-md border border-success/30 bg-success-soft p-3 text-sm text-success"
            >
              {notice}
            </p>
          )}
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy ? <LoaderCircle className="animate-spin" /> : <LogIn />}{" "}
            Entrar
          </Button>
          <button
            type="button"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-60"
            disabled={busy}
            onClick={() => void requestPasswordReset()}
          >
            Esqueci minha senha
          </button>
        </form>
        <div className="mt-6 border-t pt-4 text-center">
          <Link
            to="/conheca-isp"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Conheça mais sobre o ISP
          </Link>
        </div>
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
