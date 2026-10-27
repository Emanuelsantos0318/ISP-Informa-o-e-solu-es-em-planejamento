import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Field";
import { useAuth } from "@/lib/supabase/AuthProvider";

export const Route = createFileRoute("/aceitar-convite")({
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { client, session, profile, ready, profileError } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [inviteVerified, setInviteVerified] = useState(false);
  const [inviteFailed, setInviteFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlError =
    typeof window === "undefined"
      ? null
      : (() => {
          const query = new URLSearchParams(window.location.search);
          const hash = new URLSearchParams(
            window.location.hash.replace(/^#/, ""),
          );
          return (
            query.get("error_description") ??
            query.get("error") ??
            hash.get("error_description") ??
            hash.get("error")
          );
        })();

  useEffect(() => {
    if (!client || !ready || typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    const tokenHash = query.get("token_hash");
    const type = query.get("type");
    if (!tokenHash || type !== "invite") {
      if (session) setInviteVerified(true);
      setVerifying(false);
      return;
    }

    let active = true;
    window.history.replaceState({}, document.title, window.location.pathname);
    void client.auth
      .verifyOtp({ token_hash: tokenHash, type: "invite" })
      .then(({ error: verifyError }) => {
        if (!active) return;
        if (verifyError) {
          setInviteFailed(true);
          setError(
            "Este convite expirou ou já foi utilizado. Peça ao administrador para gerar um novo link.",
          );
        } else {
          setInviteVerified(true);
        }
        setVerifying(false);
      });
    return () => {
      active = false;
    };
  }, [client, ready, session]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!client || !session || !inviteVerified) {
      setError(
        "Abra novamente o link mais recente enviado ao seu e-mail. Se ele expirou, peça ao administrador para reenviar o convite.",
      );
      return;
    }
    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas não conferem.");
      return;
    }

    setBusy(true);
    const { error: updateError } = await client.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(
        "Não foi possível definir sua senha. O link pode ter expirado; peça um novo convite ao administrador.",
      );
      return;
    }
    await navigate({ to: "/" });
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
            <h1 className="text-xl font-semibold">Aceitar convite</h1>
          </div>
        </div>

        {!ready || verifying ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Validando seu
            convite…
          </p>
        ) : urlError ? (
          <Message
            title="Não foi possível abrir o convite"
            text="O link pode ter expirado ou o endereço de retorno do projeto não está autorizado. Peça um novo convite ao administrador."
            detail={urlError}
          />
        ) : inviteFailed ? (
          <Message
            title="Convite inválido ou expirado"
            text={error ?? "Peça ao administrador para gerar um novo link."}
          />
        ) : !inviteVerified || !session ? (
          <Message
            title="Convite inválido ou expirado"
            text="Abra novamente o link mais recente enviado ao seu e-mail. Se o problema continuar, peça ao administrador para reenviar o convite."
          />
        ) : profileError || !profile ? (
          <Message
            title="Acesso ainda não configurado"
            text={
              profileError ??
              "Seu perfil não foi liberado. Peça ao administrador para revisar o convite."
            }
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Convite confirmado. Crie sua senha para acessar o sistema.
            </p>
            <form
              onSubmit={(event) => void submit(event)}
              className="mt-6 grid gap-4"
            >
              <Field label="Nova senha" htmlFor="invite-password" required>
                <Input
                  id="invite-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field
                label="Confirme a senha"
                htmlFor="invite-password-confirm"
                required
              >
                <Input
                  id="invite-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
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
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? <LoaderCircle className="animate-spin" /> : null}Definir
                senha e entrar
              </Button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function Message({
  title,
  text,
  detail,
}: {
  title: string;
  text: string;
  detail?: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
      {detail && (
        <p className="mt-3 break-words rounded-md bg-muted p-3 text-xs text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}
