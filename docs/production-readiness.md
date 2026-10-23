# ISP MVP — avaliação de prontidão para testes de produção

Data da avaliação: 22/10/2026

## Conclusão

O conteúdo atual é uma fundação visual navegável, não um sistema operacional pronto para homologação com dados reais. O prompt mestre descreve corretamente as áreas da operação, mas a maior parte das áreas apresenta estados vazios e avisos explícitos de que o backend ainda não está conectado. Não se deve cadastrar estoque real nem liberar acesso operacional neste estado.

## O que foi verificado

- A aplicação usa React, TypeScript, Vite e TanStack Start. Há rotas para Início, Cadastro, Movimentações, Planejamento, Usuários, Notificações e Configurações.
- As regras puras de sugestão de serviço, situação de estoque, fuso de Salvador e período estão separadas em `src/lib/rules/*` e `src/lib/datetime.ts`.
- Os fluxos de entrada e saída compartilham `MovementActions`; o formulário de produto contextual fica dentro do modal principal.
- O código mostra `BackendNotice` nos pontos que dependeriam de persistência e não apresenta saldos fictícios como reais.
- Não foi encontrado cliente Supabase, pacote `@supabase/supabase-js`, diretório de migrações ou arquivo `.env*` no workspace. O projeto Supabase foi alcançado para inspeção somente de metadados; ainda não está configurado no frontend.
- Não há dependências instaladas neste diretório, e ele não contém metadados `.git` visíveis. Portanto, não foi possível validar histórico/branch Lovable nem executar ferramentas locais.

## Situação por critério de aceitação

| Critério | Situação encontrada |
| --- | --- |
| Sidebar, rotas e estrutura visual | Implementados na fundação visual; precisam de verificação visual responsiva. |
| Dashboard com dados reais e filtros aplicados | Não implementado; cartões e gráficos estão vazios. |
| Entradas/saídas gravadas atomicamente | Não implementado; os modais validam campos, mas confirmam que não gravam. |
| Pesquisa de produtos e cadastro contextual persistente | Interface e preservação de formulário existem; sem produtos ou gravação no backend. |
| Categorias, produtos e fornecedores | Formulários visuais existem; listagens vazias e sem persistência. |
| Autenticação, perfis e autorização no backend | Não implementados. |
| RLS, auditoria, integridade de saldo e histórico | O banco expõe `audit_logs`, `stock_balances` e RPCs; o papel anônimo não tem `SELECT` em `categories`. As políticas por empresa/unidade e a lógica SQL precisam ser verificadas. |
| Planejamento calculado sobre dados reais | Filtros e estrutura visual existem; sem dados, cálculos ou relatórios funcionais. |
| PDF e Excel reais | Não implementados. |
| Testes de regras e fluxos | Existem testes de unidade/roteamento no código, mas não puderam ser executados. |

## Validação executada

- `npm test` — não iniciou: `vitest` não está instalado/disponível.
- `npm run build` — não iniciou: `vite` não está instalado/disponível.
- `npm run lint` — não iniciou: `eslint` não está instalado/disponível.

Esses resultados são bloqueios de ambiente, não evidência de que os testes ou o build passaram ou falharam no código.

## Sequência necessária antes de homologação

1. Identificar o projeto Supabase correto e inspecionar seu esquema, extensões, tabelas, políticas, funções e dados existentes em modo somente leitura.
2. Conectar o frontend com URL e chave pública anon/publishable por variáveis de ambiente; nunca colocar `service_role` no cliente. Configurar autenticação e sessão antes de liberar qualquer rota de operação.
3. Preparar migrações revisáveis para perfis/permissões, unidade operacional, cadastros, lotes, movimentações, itens, saldo consistente e auditoria; aplicar RLS e funções transacionais com validação de autorização e saldo no servidor.
4. Conectar cadastros, movimentos, dashboard, alertas e planejamento ao banco, incluindo estados de carregamento, vazio e erro. Garantir idempotência contra envio duplicado e preservar formulários em caso de erro.
5. Implementar visualização e exportação PDF/XLSX sobre os mesmos dados e filtros reais.
6. Instalar dependências, executar testes, build, lint e revisão de segurança; fazer uma homologação controlada antes de qualquer publicação.

## Inspeção somente de metadados do Supabase

O catálogo REST do projeto `xfflwtnfzxwpyydeexbx` foi consultado com a chave administrativa; nenhuma linha operacional foi solicitada e nenhuma escrita foi feita. O esquema expõe `companies`, `units`, `profiles`, `categories`, `suppliers`, `products`, `stock_locations`, `stock_balances`, `product_lots`, `stock_movements`, `audit_logs`, `purchase_plans` e `purchase_plan_items`.

Os produtos já possuem `company_id`, `category_id`, `preferred_supplier_id`, SKU, barcode, unidade, estoque mínimo/meta e status. Há lotes e saldo por produto/local/lote. `stock_movements` registra uma linha por produto, com tipo (`entry`, `exit`, `adjustment`, `loss`), quantidade, chave de idempotência, nota e responsável. O RPC `record_stock_movement` aceita somente um produto por chamada, sem serviço de destino, tipo programada/extra, data/hora operacional editável ou vários itens agrupados numa confirmação. O RPC `admin_assign_profile` e os perfis `admin`, `stock_manager`, `operator`, `purchasing_approver` e `viewer` já existem.

Esse modelo cobre mais que o protótipo local, mas ainda diverge dos movimentos com múltiplos itens e dos campos operacionais exigidos. Antes de integrar, é necessário inspecionar o SQL dos RPCs, as políticas RLS, constraints e índices; o catálogo OpenAPI não revela essas regras. A conexão TCP direta à porta 5432 não teve sucesso neste ambiente.

A chave secreta foi usada somente para ler metadados e não foi gravada no projeto. Como foi compartilhada na conversa, recomenda-se revogá-la/rotacioná-la e criar outra para uso exclusivo no backend. Chaves secretas têm privilégios elevados e não devem entrar no frontend ou no Git; consulte a [orientação oficial de chaves Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

A instalação do npm não concluiu após a tentativa de acesso externo, então dependências e validadores continuam indisponíveis. A revisão do SQL pode prosseguir via CLI autenticado ou exportação do esquema pelo Supabase Dashboard, sem compartilhar outra senha no chat.

A publicação pública foi autorizada explicitamente pelo usuário nesta conversa. Ela ainda depende de concluir a implementação, validar build/testes e identificar um destino de hospedagem e suas credenciais de publicação.

## Revisão do dump `public` (schema-only)

O usuário executou `supabase db dump --linked -s public -f supabase/schema.sql` com sucesso. O arquivo contém DDL, sem linhas de tabelas operacionais. A revisão confirma:

- RLS habilitada nas tabelas expostas, policies direcionadas a `authenticated`, grants de leitura/escrita catalográfica para `authenticated` e nenhum grant de tabela para `anon` no estado atual. A requisição anon anterior falhou por falta de permissão, sem retornar dados.
- `record_stock_movement` é `SECURITY DEFINER` com `search_path` vazio; valida identidade, quantidade positiva (máximo 3 casas decimais), escopo e permissão ativa; verifica produto/local/lote, idempotência e saldo insuficiente; grava movimento, saldo e auditoria na mesma transação. Os movimentos e logs são protegidos contra update/delete por trigger append-only.
- `admin_assign_profile` também usa `SECURITY DEFINER` e valida escopo, usuário e autoalteração, com registro de auditoria.
- O dump público não inclui as definições `private.has_active_access` e `private.can_manage_profile` referenciadas pelas policies e RPCs. Assim, a lógica central de isolamento por empresa/unidade permanece por verificar.
- Os `ALTER DEFAULT PRIVILEGES` no fim do dump concedem `ALL` em futuras tabelas, sequências e funções de `public` a `anon` e `authenticated`. RLS ainda pode limitar tabelas, mas o grant automático amplo para funções/tabelas futuras não segue menor privilégio e precisa de revisão/correção em migração antes de criar objetos novos.
- O modelo relacional atual não tem cabeçalho de movimento nem tabela de itens; o RPC grava um produto por chamada. Faltam no histórico os campos operacionais que o prompt exige para uma saída (serviço, tipo programada/extra, data/hora informada), e na entrada origem/documento/fornecedor. Uma sequência de chamadas unitárias não atende atomicidade de uma movimentação com múltiplos itens.
- Há tabelas de planejamento, mas o dump público mostra apenas permissões de leitura para usuários autenticados; os fluxos de criação, aprovação e recebimento precisam de RPCs/policies apropriadas antes de serem habilitados no app.

Para completar a revisão do isolamento e da segurança das funções auxiliares, gerar outro dump, ainda sem dados, incluindo ambos os schemas: `npx supabase@latest db dump --linked -s public,private -f supabase/schema-full.sql`. O comando foi tentado neste ambiente, mas o `npx` não retornou em tempo hábil e foi interrompido; o dump full ainda não existe.

## Consequência para a aplicação

O projeto local permanece uma fundação de interface: não tem cliente Supabase, sessão/autenticação, consultas reais nem mutações persistentes; os produtos de entrada/saída estão explicitamente como arrays vazios. Conectar o frontend sem autenticação e sem alinhar o modelo transacional do banco ao requisito de múltiplos itens criaria fluxos incompletos. Não aplicar alterações remotas até revisar o schema `private` e preparar migrações idempotentes revisáveis.

## Revisão adicional do dump `public,private`

O usuário executou com sucesso `supabase db dump --linked -s public,private -f supabase/schema-full.sql`. As duas funções auxiliares foram revisadas:

- `private.has_active_access` exige `auth.uid()`, perfil ativo associado à empresa ativa, respeita papéis permitidos, permite perfis globais da empresa ou restritos à unidade, e verifica que unidades atribuídas/solicitadas pertençam à empresa e estejam ativas.
- `private.can_manage_profile` só autoriza administradores ativos da empresa; administradores restritos a uma unidade não podem gerenciar perfis fora dela, e unidades alvo precisam estar ativas e pertencer à empresa.
- Ambas são `SECURITY DEFINER`, qualificam referências com schema e definem `search_path` vazio, mitigando shadowing. O schema `private` não consta em `api.schemas` da configuração local, mas concede `USAGE` e `EXECUTE` a `authenticated`; confirmar a configuração remota de schemas expostos e considerar revogar execução direta das helpers se não necessária (as policies e RPCs podem invocá-las como owner).
- O desenho atual das policies cobre leitura segmentada e catálogo gerenciado por `admin`/`stock_manager`. Escrita operacional é via RPC, o que é apropriado; faltam permissões de mutação para lotes e fluxos de compras no estado atual.

A revisão do SQL continua estática: não foram executados testes de autorização com contas/roles reais, nem verificadas configurações do Auth (MFA, confirmação de e-mail, URLs de redirect, rate limits) ou dados existentes. Nenhuma escrita foi feita no Supabase.

## Implementação iniciada após autorização para prosseguir

- Adicionado cliente Supabase de navegador usando somente `VITE_SUPABASE_URL` e a chave publicável; nenhum segredo foi incluído no frontend.
- Adicionado login por e-mail/senha, sessão persistente/renovável, leitura do próprio perfil e bloqueio de acesso sem perfil ativo. O shell agora exibe usuário e opção de sair.
- Perfis vinculados à empresa podem escolher unidade ativa; os dados de estoque são consultados no escopo selecionado e continuam protegidos por RLS.
- Cadastro de categorias, fornecedores e produtos faz consultas e gravações autenticadas. O formulário bloqueia campos que não existem no esquema remoto (por exemplo CNPJ/endereço de fornecedor, custo/descrição e controles de lote/validade de produto) em vez de aparentar que os persistiu. Listas possuem pesquisa e filtro de status.
- Entradas/saídas continuam sem gravação; a interface informa que a RPC atual só aceita um item e que chamadas separadas poderiam gravar parcialmente. Necessária uma migração revisável com cabeçalho/itens e RPC de lote transacional.
- `.env.local` contém apenas URL e chave publicável já informadas pelo usuário e está excluído pelo `.gitignore`; `.env.example` documenta as variáveis sem chave.

## Validação pendente da implementação

A rede para `registry.npmjs.org` não está acessível neste ambiente (`Invoke-WebRequest` não consegue conectar) e `npm install` não concluiu; `node_modules` continua incompleto, sem React, Vite, TypeScript ou Vitest. Logo, não foi possível executar lint, typecheck, testes ou build. O manifesto `package.json` agora inclui `@supabase/supabase-js`, mas `bun.lock` ainda precisa ser regenerado pelo Bun quando o registry estiver acessível. Nenhuma migração ou escrita foi aplicada ao banco remoto. A autenticação depende de haver usuário Auth e perfil ativo já cadastrados; o provisionamento inicial do primeiro administrador ainda precisa ser preparado e validado.

## Provisionamento do primeiro acesso

O app agora exige que a conta exista no Supabase Auth e tenha um perfil ativo. O primeiro administrador não pode ser criado pelo cliente (corretamente, pois ainda não há administrador); há um roteiro SQL local em `supabase/bootstrap-first-admin.template.sql`. Convide/crie o usuário em Authentication → Users, substitua no roteiro o e-mail confirmado e o nome, revise o escopo LBGS/HGRS e só então execute no SQL Editor. O roteiro reusa a empresa/unidade pelo nome/código, aborta para perfil preexistente/inativo e não cria senha. Ele ainda não foi executado no remoto.

## Validação atual após instalação das dependências

Em 22/10/2026, após autorização do usuário para acesso ao registry, `npm install --no-audit --no-fund` concluiu e gerou `package-lock.json`.

- `npm test`: passou — 3 arquivos, 20 testes.
- `npx tsc --noEmit`: passou após corrigir o acesso às variáveis Vite e normalizar a relação de unidade no diretório de usuários.
- `npm run build`: passou para client e SSR. O Vite avisou que o chunk principal passa de 500 kB.
- `npm run lint`: falhou por cerca de 1.024 violações de formatação Prettier e 11 avisos distribuídos pelo código; não são falhas de compilação. É preciso decidir se se formata o repositório inteiro ou se a regra deve ser aplicada apenas aos arquivos mantidos.

Ainda não houve teste de integração contra usuários autenticados, migração, gravação ou escrita no Supabase. O banco remoto permanece sem alterações feitas por esta sessão. A instalação e a validação local não tornam o sistema pronto para produção: os fluxos de movimento transacional, dashboard, planejamento/relatórios e administração de usuários ainda precisam ser concluídos.

## Preview local e destino de hospedagem

O build gera `.output` para o preset `cloudflare-module`. `vite preview` não serve esse artefato e tenta importar `dist/server/server.js`, que não existe. `nitro preview` identifica corretamente o preset, mas não inicia porque o comando tenta executar Wrangler (`npx wrangler dev`) e Wrangler não está instalado. Para homologação via navegador é necessário preparar o runtime de preview/deploy compatível com Cloudflare e testar com as configurações apropriadas. Nenhuma publicação foi feita.

## Resultado final da validação local — 22/10/2026

Esta seção substitui os resultados de validação anteriores deste documento.

- `npm test`: passou, com 20 testes em 3 arquivos.
- `npx tsc --noEmit`: passou.
- `npm run lint`: passou sem erros; restam 8 avisos `react-refresh/only-export-components` em componentes compartilhados.
- `npm run build`: passou para client e SSR com preset `cloudflare-module`. O chunk cliente principal está em aproximadamente 738 kB antes de gzip, acima do limite de 500 kB indicado pelo Vite.
- `vite preview` não é compatível com esse artefato de build neste workspace: tentou carregar `dist/server/server.js`, inexistente.
- `nitro preview` reconheceu o preset, mas não iniciou pois Wrangler não está instalado e o subprocesso `npx wrangler dev` terminou com `ENOENT`.

A dependência Supabase foi instalada via npm e `package-lock.json` foi gerado. O repositório também possui `bun.lock`, que não foi regenerado porque Bun não está instalado. Antes de fechar a rotina de instalação, escolha o lockfile/package manager canônico e regenere o outro ou remova-o conscientemente.

Este resultado valida compilação e testes unitários existentes, não a operação integrada no Supabase nem o deploy. Nenhum DDL foi aplicado e nenhum dado operacional foi escrito no projeto remoto. Ainda faltam o RPC transacional de movimento em lote, telas de histórico/dashboard/planejamento ligadas aos dados, exportações PDF/XLSX e fluxo administrativo completo. A aplicação ainda não deve ser liberada para testes com estoque real.
