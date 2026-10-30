# Análise técnica do ISP MVP

**Revisão:** 29/10/2026
**Escopo:** código local do projeto, estrutura de rotas, clientes Supabase, Edge Functions, migrations e configuração de build. Não foi feita consulta ao banco remoto nem alteração/deploy em produção.

## Resumo

O ISP tem uma arquitetura coerente para o MVP: React/TanStack Start na interface, Supabase Auth e Postgres como backend, regras de negócio compartilhadas em funções puras, escopo por empresa/unidade, movimentações transacionais por RPC e histórico auditável. O aplicativo já cobre catálogo, entradas, saídas, usuários, configurações operacionais, alertas, planejamento, importação de DANFE/OCR e consulta do histórico legado.

**Conclusão:** adequado para continuar testes controlados, mas ainda não recomendo declarar produção final até resolver os itens de prioridade alta abaixo e conferir o ambiente remoto. O estado da conta Supabase, as políticas efetivamente aplicadas e as variáveis do deploy não podem ser provados apenas pelo repositório local.

## Arquitetura e fluxo dos dados

1. `src/routes/__root.tsx` compõe o HTML raiz, cache de consultas, sessão, tema, proteção de acesso e conteúdo da rota.
2. `src/components/auth/AccessGate.tsx` decide se mostra login, configuração pendente, fluxos de convite/senha ou área autenticada. O operador é encaminhado à saída.
3. `src/lib/supabase/AuthProvider.tsx` valida a sessão e carrega o perfil ISP; `OperationalScopeProvider.tsx` seleciona uma unidade permitida.
4. `src/lib/navigation.ts` centraliza menu, títulos e regras de exibição; os códigos de serviço, destino, tipo de saída e unidade são definidos em `src/lib/config/`.
5. As telas consultam o backend por hooks em `src/lib/supabase/`; React Query mantém cache por empresa/unidade e atualiza as consultas após gravações.
6. Regras puras em `src/lib/rules/` classificam saldo, validade e serviço sugerido. `src/lib/datetime.ts` centraliza datas no fuso `America/Bahia`.
7. Entradas/saídas são gravadas pela RPC PostgreSQL `record_stock_movement_batch` (ou RPC específica de DANFE). A transação valida o escopo, impede repetição por chave de idempotência, atualiza saldo/lote e gera auditoria.
8. Edge Functions de administração validam a sessão e o perfil do administrador no banco antes de convidar ou criar contas. A chave privilegiada fica no ambiente da função.

## Achados prioritários

### Alta — CORS não inclui a origem local atual

`supabase/functions/admin-create-user/index.ts` e `admin-invite-user/index.ts` permitem alguns endereços localhost, mas não `http://192.168.2.31:8080`, que é a origem atual do navegador. Chamadas administrativas a partir desse endereço podem ser bloqueadas pelo navegador. Antes de usar criação/convite nessa forma de acesso, incluir explicitamente a origem de desenvolvimento necessária ou usar uma origem local já liberada. Em produção, validar a origem final da Netlify nas duas funções.

### Alta — Consultas têm limites fixos e não paginam

`src/lib/supabase/catalog.ts` limita produtos a 500; `src/lib/supabase/inventory.ts` limita saldos, lotes, lotes de movimentação e saídas legadas a 1.000 e itens/perfis a outros limites. Ao ultrapassá-los, a interface pode deixar de mostrar produtos ou parte do histórico sem indicar que a lista foi truncada. Adicionar paginação/cursor ou consultas agregadas antes do volume de produção atingir esses valores.

### Alta — Backup e recuperação no plano Free

O código mantém exportação/histórico de dados legados, mas isso não equivale a backup recuperável do banco inteiro. Como o projeto está no Free, precisa existir um procedimento operacional manual, testado e com responsável: exportar tabelas necessárias, guardar cópias fora do Supabase e provar que é possível restaurá-las. O dump local do esquema não contém os registros atuais.

### Média — Contas sem e-mail não têm recuperação autônoma

O login por nome usa um endereço interno `@users.isp.invalid`. Não existe canal de recuperação por e-mail para essas contas; a redefinição depende de um administrador ativo. Isso deve ser explicado na entrega das credenciais e incluído no procedimento administrativo.

### Média — OCR exige revisão humana

O PDF é lido no navegador e o resultado depende da qualidade da imagem/OCR. O fluxo pede conferência antes de gravar, o que é a proteção correta para os erros de leitura observados. Descrição, fornecedor, data e quantidades devem ser conferidos no documento original; a importação só pode ocorrer depois da confirmação.

### Média — Cobertura automatizada não valida o fluxo completo

Há testes unitários para regras de estoque, sugestão de serviço, datas, DANFE e roteamento. Eles não substituem teste integrado de RLS por papel/unidade, funções Edge no navegador, gravação concorrente/idempotente, retirada de unidade avulsa e restauração de backup. Não rodei a suíte de testes nesta revisão.

## Segurança e dados

- O cliente web utiliza chave pública (`VITE_SUPABASE_PUBLISHABLE_KEY`); credenciais privilegiadas não devem ser colocadas em variáveis `VITE_*`.
- A interface oculta ações por papel, mas as políticas RLS e as RPCs do banco são a barreira de segurança real. É necessário validar cada papel diretamente contra o projeto remoto.
- `.env.local` está ignorado pelo Git e não consta entre os arquivos rastreados. Não compartilhar seu conteúdo.
- Credenciais administrativas e tokens foram enviados anteriormente na conversa. Por precaução, revogue/rotacione a senha do banco, a chave secreta do Supabase e o token de acesso da CLI que possam ter sido expostos. Não reutilize os valores enviados.
- Os arquivos `supabase/schema.sql` e migrations descrevem o estado local versionado; esta revisão não comparou a migration history com o banco de produção.

## Comentários adicionados ao código

Foram adicionadas explicações em português nas etapas centrais de autenticação, seleção de unidade, proteção de acesso, busca de produtos, saída operacional, conversão de dados do Supabase, registro transacional, regras de estoque/serviço, datas, navegação, Edge Functions de usuário/convite e migration de movimentação em lote. Os comentários explicam a intenção e os limites do fluxo, sem alterar as regras executadas.

## Verificações desta revisão

- `npx tsc --noEmit`: concluído sem erros.
- ESLint nos arquivos TypeScript alterados: concluído sem erros; dois avisos de Fast Refresh nos provedores de autenticação e unidade.
- Prettier nos arquivos TypeScript comentados e neste relatório: concluído.
- `npm run build`: iniciado, mas a transformação do cliente ficou sem progresso visível por mais de um minuto e foi interrompida. O build ainda precisa ser executado em um ambiente que conclua essa etapa.
- Suíte Vitest: não executada nesta revisão.

## Próximas ações para liberar produção

1. Corrigir/validar CORS para o endereço usado no desenvolvimento e para o domínio final.
2. Implementar paginação e estados explícitos de carregamento de mais registros nas consultas limitadas.
3. Documentar e ensaiar exportação e restauração manual compatível com o Free.
4. Conferir no Supabase remoto as migrations, RLS, papéis, funções e permissões por empresa/unidade.
5. Executar a suíte automatizada e fazer um roteiro de aceitação com operador, gestor, administrador e superadministrador.
6. Configurar variáveis de produção na Netlify, validar build/deploy e concluir um ensaio de ponta a ponta sem dados reais sensíveis.
