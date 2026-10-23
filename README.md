# ISP MVP — Gestão de Estoque

Aplicação de gestão de estoque do ISP, com autenticação e persistência no Supabase.

## Desenvolvimento local

1. Instale Node.js LTS.
2. Instale as dependências: `npm ci`.
3. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` com os valores do projeto Supabase autorizado.
4. Inicie a aplicação: `npm run dev`.

## Banco Supabase

As alterações de esquema ficam versionadas em `supabase/migrations`. Para vincular o projeto e aplicar migrações:

```powershell
npx supabase@latest login
npx supabase@latest link --project-ref xfflwtnfzxwpyydeexbx
npx supabase@latest db push --linked
```

Confira o histórico remoto antes de reparar migrações. Nunca use `service_role`, senha PostgreSQL ou credenciais administrativas no frontend. `VITE_SUPABASE_PUBLISHABLE_KEY` deve conter somente a chave pública do projeto.

## Comandos

- `npm run dev`: inicia o servidor local.
- `npm run build`: gera a aplicação de produção.
- `npm run lint`: valida estilo e regras ESLint.
- `npm run test`: executa os testes unitários.

## Segurança

Não versione `.env.local`, chaves secretas, senhas ou chaves de service account. O acesso a dados é controlado por políticas RLS e pelas migrações do Supabase.