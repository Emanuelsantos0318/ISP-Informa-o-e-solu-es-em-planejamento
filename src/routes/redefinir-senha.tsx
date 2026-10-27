import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Field";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { useAuth } from "@/lib/supabase/AuthProvider";

export const Route = createFileRoute("/redefinir-senha")({
  head: () => ({ meta: [{ title: "Redefinir senha · ISP" }] }),
  component: PasswordResetPage,
});

function PasswordResetPage() {
  const { client, session, ready } = useAuth();
  const [authorized, setAuthorized] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const flow = hash.get("type") ?? query.get("type");
    const urlError =
      hash.get("error_description") ?? query.get("error_description");
    if (urlError) {
      setError(
        "O link de redefinição expirou ou não é válido. Solicite outro pela tela Meu Perfil.",
      );
      return;
    }
    if (session && flow === "recovery") {
      setAuthorized(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      setError(
        "Abra o link mais recente enviado para seu e-mail. Se expirou, solicite outro pela tela Meu Perfil.",
      );
    }
  }, [ready, session]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!client || !session || !authorized)
      return setError("O link seguro não está mais válido. Solicite outro.");
    if (password.length < 8)
      return setError("A senha deve ter pelo menos 8 caracteres.");
    if (password !== confirmation) return setError("As senhas não conferem.");
    setBusy(true);
    const { error: passwordError } = await client.auth.updateUser({ password });
    if (!passwordError) {
      await client.auth.signOut({ scope: "others" });
      setComplete(true);
    } else {
      setError(
        "Não foi possível atualizar a senha. Solicite um novo link e tente novamente.",
      );
    }
    setBusy(false);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <section className="surface w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              ISP
            </p>
            <h1 className="text-xl font-semibold">Redefinir senha</h1>
          </div>
        </div>
        {!ready ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Validando o link…
          </p>
        ) : complete ? (
          <div className="grid gap-4">
            <p role="status" className="text-sm text-success">
              Senha alterada com sucesso. As outras sessões foram encerradas
              quando suportado pelo provedor.
            </p>
            <Button asChild>
              <Link to="/">Voltar ao ISP</Link>
            </Button>
          </div>
        ) : authorized ? (
          <form onSubmit={(event) => void submit(event)} className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Defina uma nova senha. O link é temporário e não pode ser
              reutilizado.
            </p>
            <Field label="Nova senha" htmlFor="new-password" required>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Confirme a senha" htmlFor="confirm-password" required>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <KeyRound />}{" "}
              Salvar nova senha
            </Button>
          </form>
        ) : (
          <div className="grid gap-4">
            <p role="alert" className="text-sm text-destructive">
              {error ?? "Aguardando validação do link."}
            </p>
            <Button asChild variant="outline">
              <Link to="/">Voltar ao sistema</Link>
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
