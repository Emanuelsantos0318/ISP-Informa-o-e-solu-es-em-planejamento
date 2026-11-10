# Status da implementação — Planejamento de Produção

## Proteção do projeto

- Trabalho isolado na branch `codex/planejamento-producao`, baseada no commit `8e4b588`.
- Nenhuma alteração enviada à `main`, ao GitHub, ao Cloudflare ou ao Supabase de produção.
- O XLSX de referência foi aberto somente para leitura.
- As migrations novas criam objetos do módulo e não editam tabelas de estoque existentes.

## Entregue nesta etapa

- Nova rota `/planejamento-producao`; a rota existente `/planejamento` continua com sua finalidade atual.
- Planejamento semanal versionado, lançamentos separados entre pacientes e servidores, cálculo por per capita e volume com unidades declaradas e consolidação por UUID/unidade.
- Consulta somente leitura do saldo de estoque. Necessidades não reservam nem baixam estoque.
- Configuração de janelas por dias da semana; criação transacional de entregas consolidadas e conferência das quantidades recebidas. A conferência não registra entrada no estoque.
- Programação de degelo por produto, data/hora e antecedência. A regra de 24 horas para peixe tem validação no banco e os prazos por produto podem ser configurados por administrador/gestor.
- Lançamentos de polpa separados de proteínas.
- Consolidação de polpas por sabor, público, serviço, data e unidade; distribuição pelas faixas semanais cadastradas, mantendo sem faixa e janelas sobrepostas como pendências.
- Mapa diário para impressão e exportação de relatório semanal XLSX com resumo, consolidação de proteínas, pendências, polpas por dia/faixa, entregas e degelo. Quantidades de unidades diferentes não são somadas, e a conferência da entrega não vira movimentação de estoque.
- Importação protegida do arquivo original e de todas as células usadas, preservando abas, fórmulas, resultados em cache, vazios, zeros e estilos. O hash evita importar o mesmo binário duas vezes.
- Pré-classificação de linhas das abas per capita, tabelas diárias de polpas e linhas explícitas dos mapas de proteína. A revisão confirma data, produto e quantidade quando ausentes; linhas dos mapas com data divergente entre aba e título não recebem data sugerida. Registros históricos ficam vinculados à célula de origem e não alteram estoque.
- RLS por empresa/unidade, vínculos compostos de escopo, autoria validada, auditoria de alterações e proteção de planos finalizados.
- Bucket privado `production-imports`, limitado a XLSX de até 10 MiB, com policies por empresa/unidade.

## Auditoria concreta do XLSX

- 10 abas, 3.762 células preenchidas, 1.493 fórmulas e 68 fórmulas sem resultado em cache.
- A pré-classificação conservadora identifica 102 candidatos nas abas de pacientes e servidores: 54 e 48, respectivamente. As datas herdadas do bloco são marcadas para confirmação; os valores não viram registros até confirmação individual.
- A prévia da aba POLPA reconhece 22 linhas (12 servidoras e 10 de pacientes); 5 não têm quantidade numérica e precisam de preenchimento humano.
- Os mapas reconhecem 108 linhas com cabeçalhos explícitos. No mapa `15-10`, 23 linhas ficam sem data sugerida porque o título indica `05-11`; em 3 linhas não há KG total numérico. Os demais candidatos mostram a data do título quando ela combina com o nome da aba.
- Quadros resumo de polpa por dia/faixa e áreas auxiliares seguem preservados como células brutas, sem conversão automática. Campos ausentes e fórmulas sem resultado ficam fora de candidatos estruturados.
- Permanecem divergências de datas e a fórmula suspeita `SERVIDOR per capta !AT4:AT22`, registradas em [ANALISE_PLANILHA_REFERENCIA.md](ANALISE_PLANILHA_REFERENCIA.md). Nada foi corrigido silenciosamente.

## Validação executada

- `npm test`: 8 arquivos e 56 testes aprovados, incluindo reconhecimento conservador de polpas e mapas.
- `npx tsc --noEmit`: sem erros.
- `npm run build`: build cliente/SSR/Nitro concluído. O build ainda mostra avisos de configuração Vite e tamanho de chunks, sem falha.
- `git diff --check`: sem erro de whitespace.
- Revisão estática das migrations encontrou e removeu uma declaração duplicada de trigger de auditoria, que faria a segunda migration falhar na aplicação. A importação histórica agora direciona polpas a registros próprios e mapas a registros históricos de planejamento.
- Em 05/11/2026, as migrations foram executadas em PostgreSQL Supabase local isolado (`ISP_MVP_PLANNING_TEST`, portas 55321/55322), após carregar somente o dump estrutural sem dados. A cadeia local precisou de um registro fictício `LBGS` para satisfazer antigas migrations de catálogo; a migration de CNPJ já estava representada pelo dump e foi omitida. Foram confirmados 13 objetos, 25 policies RLS, 3 RPCs e o bucket privado XLSX de 10 MiB.
- A migration `20261105000100_products_without_sku_and_protein_catalog.sql` permite SKU nulo e insere 17 proteínas ausentes sem SKU/barcode no catálogo local, sem definir saldo. Queijo Muçarela e Ricota existentes foram reaproveitados; itens ambíguos (ovo, bolo, frango grelhado e peito de frango) foram deixados para revisão humana.
- O formulário, a validação e os tipos agora mantêm SKU ausente como `NULL`; não reutilizam o código de barras como SKU.
- Em 05/11/2026, a falha `PGRST205` foi identificada como a tela local usando a URL de produção enquanto as tabelas existiam apenas no banco de teste. O cache do PostgREST local foi recarregado, login local respondeu corretamente e a consulta autenticada de `production_plans` retornou HTTP 200. A aplicação foi iniciada em `http://localhost:8081` em modo `localtest`, apontando para `ISP_MVP_PLANNING_TEST`; `.env.local` de produção permanece sem alteração.
- Um teste transacional autenticado criou plano, lançamento, entrega consolidada e conferência de recebimento (2 kg), verificou status `received` e executou `ROLLBACK`. Login Auth local e resposta HTTP da rota `/planejamento-producao` foram confirmados. Nenhum dado ou migration foi enviado ao Supabase de produção.

## Evolução local — Hortifruti

- Nova aba **Hortifruti** registra item, data, público, serviço, quantidade, unidade e observação em tabela própria, separada de proteínas e polpas.
- O usuário pode vincular um produto do catálogo ou preservar o nome original para revisão posterior. A consolidação mantém separados data, público, serviço e unidade; não converte unidades e não altera o estoque.
- Os lançamentos aparecem no mapa diário e na exportação semanal XLSX.
- A planilha de referência analisada não contém uma aba de Hortifruti. Por isso, esta versão permite lançamento manual e não inventa uma regra de importação para essa categoria.
- A migration `20261109000100_production_hortifruti_entries.sql` foi aplicada apenas ao banco local isolado `ISP_MVP_PLANNING_TEST`; produção não foi alterada.
- O build do módulo, a validação ESLint dos arquivos alterados e a resposta HTTP local foram confirmados. A checagem TypeScript atual ainda aponta um erro em `src/lib/danfe/purchase-order.ts:194`, fora do escopo desta alteração.

## Evolução local — revisão rápida dos mapas

- O formulário de proteína agora captura o grupo/setor operacional usado na coluna `UNIDADE`; lançamentos novos não são salvos sem esse campo.
- O PDF diário e a exportação semanal usam `meal_group` nessa coluna. Registros históricos sem grupo permanecem intactos e são sinalizados para conferência; nenhum valor foi inferido.
- A lista semanal aceita filtros por data, público, refeição e busca por preparação/produto/grupo, com edição do registro no formulário existente.
- O catálogo do formulário de proteína pode ser pesquisado por nome ou SKU sem renderizar a lista completa de produtos de uma só vez.
- Um planejamento vazio pode receber uma cópia de outro plano. As datas são deslocadas para a semana de destino; registros datados fora do período são omitidos e contados na mensagem de retorno.
- A conferência do plano resume grupo ausente, vínculo de produto ausente, quantidade final pendente e ajustes manuais.
- `npm run build` e ESLint específico da rota passaram. A checagem TypeScript continua bloqueada pelo erro preexistente em `src/lib/danfe/purchase-order.ts:194`.
- Nada foi enviado ao GitHub/Cloudflare nem aplicado ao Supabase de produção. O banco remoto segue sem as tabelas do módulo, portanto o fluxo operacional de produção permanece bloqueado.

### Próximas mudanças que ainda exigem desenho e migração

- Aprovação formal, bloqueio de edição e notificações persistentes foram adicionados na continuação local descrita abaixo; ainda precisam de validação por papéis em ambiente de homologação.
- A comparação com estoque usa baixas efetivamente registradas; ela não representa refeições servidas e deixa sem conciliação serviços/unidades ainda não confirmados.
- Templates reutilizáveis de preparações e grade multi-linha precisam ser validados com os formulários usados pela equipe para não propagar volumes antigos como se fossem atuais.

## Pendências antes de uso operacional

1. Repetir os testes de RLS/RPC com mais papéis e validar a importação do arquivo de referência numa homologação com usuários responsáveis.
2. Completar o mapeamento dos quadros resumo da POLPA, das categorias auxiliares e das três faixas de entrega. Os mapas de proteína têm extração conservadora, mas precisam de reconciliação por aba e data.
3. Acrescentar filtros de período, público, serviço e produto ao relatório. O XLSX semanal já reúne proteínas, polpas, entregas, degelo e pendências.
4. Validar as janelas de entrega, os produtos e as regras de degelo com a equipe da unidade. O cadastro por categoria está modelado no banco; a tela atual configura regra por produto.
5. Importar o arquivo em ambiente de homologação para conferir quantidades por data, público e produto com os responsáveis.
6. Só depois dessa validação, decidir a publicação da branch e a aplicação das migrations. A produção atual continua sem essas tabelas e funções.

Veja a revisão requisito a requisito em [REVISAO_PROMPT_E_PENDENCIAS.md](REVISAO_PROMPT_E_PENDENCIAS.md). A planilha de referência foi auditada, mas ainda não foi importada como registros históricos.

## Continuação local — 09/11/2026

- A aba `Semana e refeições` agora suporta revisão do mapa por papéis. Enviar para revisão, aprovar, devolver com comentário, iniciar e concluir chamam a RPC `transition_production_plan`; o banco valida estado, papel e conteúdo. A migração também bloqueia alterações nos lançamentos após o envio, até a devolução para ajuste.
- A nova migration `20261109191909_production_review_notifications.sql` persiste notificações por destinatário/unidade, com RLS individual e confirmação de leitura. O usuário só pode marcar avisos próprios como lidos; os links carregam o ID do plano para abrir o mesmo planejamento.
- A aba `Notificações` exibe esses avisos junto dos alertas já existentes.
- A aba `Planejado × saídas` cruza proteínas e Hortifruti com baixas reais em `stock_movement_batches` e `stock_movements`, por produto, data, serviço e unidade. Sem correspondência confirmada de serviço ou unidade, os registros são separados como não comparáveis; nenhum fator de conversão é presumido. A tela avisa que baixa do almoxarifado não equivale a refeição servida e que polpas não são reconciliadas por falta de vínculo entre sabor e produto.
- `npm run build` concluiu build cliente, SSR e Nitro. ESLint não apontou erros; três avisos sobre dependências memoizadas foram corrigidos nesta continuação. `git diff --check` sem problemas.
- A migração e as telas permanecem somente nesta branch/localidade. A migration ainda depende das migrações anteriores do módulo de produção e não foi aplicada ao Supabase de produção; portanto, a funcionalidade não está ativa no site publicado.
- Continuação em 10/11: o Docker Desktop foi iniciado e a migration foi aplicada somente ao PostgreSQL local isolado `ISP_MVP_PLANNING_TEST` (porta 55322). O fluxo autenticado foi validado em transação com rollback: envio para revisão, aprovação, início, conclusão, devolução com comentário, notificação criada, rejeição de mudança direta de status e bloqueio de edição do mapa após o envio. Verifiquei em seguida que nenhum plano, lançamento ou aviso de teste permaneceu gravado. A migration não foi aplicada à produção.
