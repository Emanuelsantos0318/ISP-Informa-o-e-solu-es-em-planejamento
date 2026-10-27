# Administração e contas do ISP

## Ativar o Superadministrador

1. Aplique primeiro as migrações locais `20261026000100_add_super_admin_role.sql` e `20261026000200_superadmin_profile_and_preferences.sql` no projeto Supabase autorizado.
2. No Supabase Authentication, identifique a conta da pessoa que será Superadministradora e copie o UUID do usuário.
3. Abra `supabase/bootstrap-super-admin.template.sql`, substitua o UUID de exemplo e revise a conta e a empresa antes de executar o bloco no SQL Editor.
4. Confirme na tabela `profiles` que essa conta ficou com papel `super_admin` e `unit_id` nulo. O papel dá acesso administrativo somente à empresa vinculada ao perfil.

O sistema não promove contas por autoinscrição, Edge Function, formulário público ou alteração enviada pelo navegador. A promoção inicial é uma operação manual privilegiada e gera um registro de auditoria.

## Redefinição de senha por e-mail

- O ISP envia o link por `auth.resetPasswordForEmail` do Supabase Auth. A página de destino é `/redefinir-senha` no mesmo domínio do sistema.
- No Supabase Authentication → URL Configuration, configure o endereço do ambiente como Site URL e inclua nas Redirect URLs os caminhos `/redefinir-senha` e `/aceitar-convite` para produção e desenvolvimento. Para este projeto, os endereços de desenvolvimento usados são `http://localhost:5173` e `http://localhost:8081`.
- Configure um provedor SMTP confiável em Authentication → SMTP Settings para entrega fora do limite de e-mails de teste do Supabase. O projeto precisa ter remetente verificado e DNS de domínio (SPF/DKIM) conforme o provedor.
- Em Authentication → Email Templates → Reset Password, o link deve apontar para `{{ .ConfirmationURL }}`. O código usa o fluxo oficial do Supabase; não envia senha por e-mail.
- Contas sem e-mail (nomes de usuário com endereço interno `@users.isp.invalid`) não conseguem recuperar a senha por e-mail. Um administrador precisa atualizar/validar o e-mail da conta antes de usar esse fluxo.

## Foto de perfil

A migração cria o bucket privado `isp-profile-photos`, limita os arquivos a 5 MB e aceita JPEG, PNG e WebP. As políticas de Storage restringem leitura e gravação à pasta do próprio usuário.

## Logo oficial

A logo oficial está em `public/isp-logo.png` e já é usada na tela de acesso, na navegação lateral e como ícone do site. A imagem é exibida com proporção preservada. Se houver uma versão simplificada para favicon ou uma variante otimizada, ela poderá substituir ou complementar o PNG atual.
