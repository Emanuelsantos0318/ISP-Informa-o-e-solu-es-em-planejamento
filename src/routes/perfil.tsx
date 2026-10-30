import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, KeyRound, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Field";
import { PageIntro, Panel } from "@/components/common/Panel";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { createUuid } from "@/lib/uuid";

export const Route = createFileRoute("/perfil")({
  head: () => ({ meta: [{ title: "Meu perfil · ISP — Gestão de Estoque" }] }),
  component: ProfilePage,
});

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function ProfilePage() {
  const { client, session, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(profile?.full_name ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const previewUrl = useMemo(
    () => (photo ? URL.createObjectURL(photo) : null),
    [photo],
  );
  const email = session?.user.email ?? "";
  const externalEmailIsValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !email.toLowerCase().endsWith("@users.isp.invalid") &&
    Boolean(session?.user.email_confirmed_at || session?.user.confirmed_at);

  useEffect(() => setName(profile?.full_name ?? ""), [profile?.full_name]);
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const saveProfile = async () => {
    setError(null);
    setMessage(null);
    if (!client || !profile || !session)
      return setError("Sessão não disponível.");
    const fullName = name.trim();
    if (!fullName || fullName.length > 160)
      return setError("Informe um nome entre 1 e 160 caracteres.");
    if (photo && (!PHOTO_TYPES[photo.type] || photo.size > MAX_PHOTO_BYTES)) {
      return setError("Selecione uma imagem JPG, PNG ou WebP de até 5 MB.");
    }

    setSaving(true);
    let nextPath = removePhoto ? null : profile.avatar_path;
    let uploadedPath: string | null = null;
    try {
      if (photo) {
        const extension = PHOTO_TYPES[photo.type];
        const path = `${session.user.id}/${createUuid()}.${extension}`;
        const { error: uploadError } = await client.storage
          .from("isp-profile-photos")
          .upload(path, photo, { contentType: photo.type, upsert: false });
        if (uploadError)
          throw new Error(
            "Não foi possível enviar a foto. Verifique a migração e o armazenamento do Supabase.",
          );
        uploadedPath = path;
        nextPath = path;
      }
      const { error: updateError } = await client.rpc("update_own_profile", {
        p_full_name: fullName,
        p_avatar_path: nextPath,
      });
      if (updateError)
        throw new Error(
          "Não foi possível salvar o perfil. Confira a migração do Supabase e tente novamente.",
        );
      if (profile.avatar_path && profile.avatar_path !== nextPath) {
        await client.storage
          .from("isp-profile-photos")
          .remove([profile.avatar_path]);
      }
      setPhoto(null);
      setRemovePhoto(false);
      setMessage("Perfil atualizado.");
      await refreshProfile();
      await queryClient.invalidateQueries({
        queryKey: ["profile-avatar", profile.user_id],
      });
    } catch (cause) {
      if (uploadedPath)
        await client.storage.from("isp-profile-photos").remove([uploadedPath]);
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar o perfil.",
      );
    } finally {
      setSaving(false);
    }
  };

  const requestPasswordReset = async () => {
    setError(null);
    setMessage(null);
    if (!client || !externalEmailIsValid) {
      setError(
        "Esta conta não tem um e-mail externo confirmado. Solicite a um administrador a atualização ou validação do e-mail antes de redefinir a senha.",
      );
      return;
    }
    setSendingReset(true);
    const { error: resetError } = await client.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      },
    );
    setSendingReset(false);
    if (resetError) {
      setError(
        "O Supabase não conseguiu enviar o link. Verifique o serviço de e-mail e a URL de retorno autorizada do projeto.",
      );
      return;
    }
    setMessage(`Enviamos um link seguro de redefinição para ${email}.`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Meu perfil"
        description="Atualize seus dados pessoais e as opções de acesso da sua conta."
      />
      {message && (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Panel
        title="Dados pessoais"
        description="Nome, foto e e-mail de acesso. Seu perfil e suas unidades autorizadas não podem ser alterados nesta tela."
      >
        <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex flex-col items-center gap-2">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Pré-visualização da foto do perfil"
                className="size-20 rounded-full object-cover"
              />
            ) : (
              <ProfileAvatar className="size-20 text-xl" />
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
            >
              <Camera /> Escolher foto
            </Button>
            <input
              ref={fileRef}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                setPhoto(event.target.files?.[0] ?? null);
                setRemovePhoto(false);
              }}
            />
            {profile?.avatar_path && !photo && !removePhoto && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRemovePhoto(true)}
              >
                <Trash2 /> Remover foto
              </Button>
            )}
            {removePhoto && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRemovePhoto(false)}
              >
                Manter foto atual
              </Button>
            )}
            {photo && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPhoto(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Cancelar foto selecionada
              </Button>
            )}
          </div>
          <div className="grid gap-4">
            <Field label="Nome completo" htmlFor="profile-name" required>
              <Input
                id="profile-name"
                value={name}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="E-mail cadastrado">
              <Input value={email || "Esta conta não possui e-mail"} readOnly />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button disabled={saving} onClick={() => void saveProfile()}>
                <Save /> {saving ? "Salvando…" : "Salvar perfil"}
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          A foto é privada, acessível somente pela sua conta, e limitada a JPG,
          PNG ou WebP de até 5 MB.
        </p>
      </Panel>
      <Panel
        title="Senha"
        description="A redefinição é feita pelo provedor de autenticação usando um link temporário. A senha nunca é enviada por e-mail."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">
              {externalEmailIsValid
                ? `E-mail confirmado: ${email}`
                : "E-mail externo confirmado não disponível"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Contas criadas somente com nome de usuário não podem iniciar
              recuperação por e-mail.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!externalEmailIsValid || sendingReset}
            onClick={() => void requestPasswordReset()}
          >
            <KeyRound />{" "}
            {sendingReset ? "Enviando link…" : "Enviar link de redefinição"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
