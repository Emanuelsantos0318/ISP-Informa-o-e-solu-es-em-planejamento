# Diagnóstico do ISP para Planejamento de Produção

## Escopo e proteção

Este diagnóstico foi iniciado na branch `codex/planejamento-producao`, criada a partir do commit `8e4b588`. A branch `main` não foi alterada. Em 06/11/2026, o schema do módulo e o catálogo de proteínas foram confirmados no Supabase local isolado `ISP_MVP_PLANNING_TEST`; nada foi aplicado ao Supabase de produção. Nenhum dado operacional de produção foi modificado.

## Estado runtime revisado em 06/11/2026

- App ativo em `http://localhost:8081/planejamento-producao`, modo Vite `localtest`, apontando para `http://127.0.0.1:55321`. `.env.local` de produção foi mantido intacto.
- Banco PostgreSQL local isolado acessível em `localhost:55322`; `production_plans` e `production_plan_entries` estão presentes, RLS ativo e quatro policies combinadas nas duas tabelas.
- Conta de teste autenticou no Supabase local e a consulta autenticada a `production_plans` retornou HTTP 200.
- Categoria Proteínas local contém 17 produtos com SKU e código de barras nulos.
- `npx tsc --noEmit`, `npm test` (9 arquivos/58 testes) e `npm run build` concluíram. Build gera alertas de bundle grande e configuração Vite; `npm run lint` encontra 593 erros de lint (majoritariamente regras Prettier) e 2 avisos. Nenhuma publicação foi feita.

## Arquitetura encontrada

- Aplicação web em React 19 e TypeScript, com TanStack Start/Router, Tailwind CSS e componentes compartilhados em `src/components`.
- O layout, autenticação, proteção de rotas, tema e cache do TanStack Query são providos pelo shell em `src/routes/__root.tsx`.
- As rotas estão em `src/routes`; `src/routeTree.gen.ts` é gerado pelo plugin do roteador.
- Supabase fornece PostgreSQL, autenticação e Row Level Security. O projeto usa o cliente Supabase diretamente por hooks em `src/lib/supabase`; não foi encontrado ORM.
- A camada de estoque separa consulta e regra de negócio: `loadInventorySnapshot` consulta catálogo, saldos, lotes e movimentos, enquanto `src/lib/rules/stock.ts` concentra regras puras de situação, consumo, cobertura e reposição.
- `useAuth` fornece perfil, empresa e papel; `useOperationalScope` resolve a unidade operacional. As policies chamam `private.has_active_access` para validar empresa, unidade e papel no banco.
- Registros de movimentação são gravados pela RPC transacional `record_stock_movement_batch`. O planejamento de produção não deve reutilizá-la para simular consumo; a regra exige ausência de baixa automática.

## Recursos reutilizáveis

- Catálogo oficial de produtos por UUID, com SKU, código de barras, unidade, categoria, fornecedor e marca.
- Estoque por unidade, localização e lote, com saldos atuais e validade.
- Histórico de movimentações com tipo, quantidade, data, responsável, serviço e documento de origem.
- Entidades de fornecedores, categorias, unidades, usuários, papéis e auditoria.
- Entidades `purchase_plans` e `purchase_plan_items` para sugestões e aprovações de compra; o planejamento de produção deve consultá-las para identificar pedidos pendentes, sem criar compras automaticamente.
- `company_stock_settings` e `company_operational_settings` para configurações compartilhadas.
- Relatórios, filtros, exportação, tabelas paginadas e componentes de interface existentes.

## Lacunas encontradas antes da implementação deste módulo

- A rota atual `/planejamento` implementa consumo, cobertura e reposição para estoque; não é um planejamento de refeições, polpas, entregas, degelo ou mapas de produção.
- Não há tabelas para plano semanal de produção, lançamentos de refeições, entregas programadas, degelo, polpas, apelidos de produtos ou histórico de importação do XLSX.
- Não há importador de planejamento Excel nem armazenamento do arquivo de origem.
- A aplicação não possui regra explícita para antecedência de degelo por produto nem regra de peixe em 24 horas.
- As permissões existentes incluem `admin`, `stock_manager`, `operator`, `purchasing_approver` e `viewer`; o papel `super_admin` é habilitado por migration adicional. O novo módulo deve respeitar papéis e escopo por unidade no banco, não apenas ocultar ações na UI.
- A planilha exige unidades finais explícitas. A tabela de produtos preserva a unidade em texto e não existe conversão de KG, G, UN ou L já validada para este fluxo.

## Pendências identificadas na revisão atual

- O XLSX ainda não foi importado; conflitos e dados ausentes registrados na análise da planilha exigem reconciliação com a equipe.
- A tela lista lançamentos, mas não oferece ações de editar ou excluir uma linha. A correção operacional de um lançamento já salvo precisa de uma nova versão do plano, pois o fluxo de alteração na UI não está implementado.
- O formulário permite editar manualmente a unidade final mesmo com produto vinculado. A regra confere a unidade final contra per capita e volume, mas não a compara com `products.unit_of_measure`; uma combinação divergente pode salvar uma quantidade rotulada na unidade errada.
- A data do lançamento tem `min`/`max` no controle HTML, mas a migration não impõe no banco que `consumption_date` esteja entre `week_start` e `week_end`. A integridade precisa ser protegida também na gravação.
- A matriz RLS permite que `purchasing_approver` crie/atualize lançamentos de produção. Essa permissão e as demais regras precisam de aceite e testes por papel/unidade.
- O ESLint aponta 593 erros e 2 avisos, principalmente diferenças do Prettier; o lint global não está limpo. O build avisa sobre bundles grandes (ExcelJS, PDF.js e gráficos), que podem aumentar o tempo de carregamento.
- Relatórios PDF/CSV, filtros gerenciais, versionamento/emissão formal de mapas e os quadros auxiliares/resumos de polpa seguem incompletos conforme a matriz em `REVISAO_PROMPT_E_PENDENCIAS.md`.

## Proposta compatível

1. Adicionar o módulo em `/planejamento-producao`, preservando `/planejamento` e os seus relatórios atuais.
2. Criar tabelas novas, não destrutivas, com chaves para empresa, unidade, semana, produto e registro de origem. Aplicar RLS por `private.has_active_access`.
3. Guardar quantidades calculadas no banco (ou em função de domínio validada) e guardar ajustes manuais com valor calculado, valor ajustado, motivo, ator e data.
4. Reutilizar `products.id` para consolidação. Criar aliases separados que preservem o texto original; não criar produtos automaticamente nem converter unidades.
5. Criar prévia de importação que preserve arquivo binário, hash, aba, endereço, fórmula, resultado armazenado, valor original e estado de validação. Registros históricos importados não alteram estoque.
6. Iniciar a importação com os registros reconhecidos, mas deixar associações, datas e fórmulas divergentes como pendências explícitas, sem correção silenciosa.
7. Implementar planejamento, consolidação, entregas, degelo, polpas e mapas como consultas do mesmo plano, com exportação e impressão derivadas dos registros estruturados.

## Modelo de acesso inicial proposto

- `admin` e `stock_manager`: criar e editar planejamento, configurar regras, revisar associações e importar arquivos.
- `operator`: consultar e registrar lançamentos apenas se a operação confirmar que esse papel participa do planejamento; alterações ficam auditadas.
- `purchasing_approver`: consultar consolidação e demanda de compra, sem alterar entradas ou movimentações.
- `viewer`: somente leitura.
- Todas as consultas e gravações permanecem limitadas à empresa e unidade autorizadas pelo perfil.

Essa matriz é uma proposta técnica baseada nos papéis existentes; o banco precisa impor o escopo final. Não há promoção de papéis nem mudança de permissões globais.

## Riscos e decisões de segurança

- A referência contém datas conflitantes e fórmulas sem resultado armazenado. Importar esses dados diretamente para um planejamento ativo produziria demanda incorreta.
- Valores de ovo e outros itens podem ser UN, KG ou outra unidade; não serão convertidos sem confirmação e cadastro explícito.
- O cadastro de estoque pode não conter correspondência exata para todos os nomes históricos. Esses itens devem ficar pendentes de vínculo por UUID.
- A planilha contém valores zero e células vazias com significados diferentes. A importação deve conservar ambos.
- Nenhuma migration será aplicada ao Supabase de produção durante a implementação nesta branch. O teste de migrations exigirá instância local ou revisão/aprovação separada.

## Plano de desenvolvimento e validação

1. Auditar o arquivo original e registrar integridade, abas, fórmulas, datas e divergências.
2. Definir schema e policies novas; validar impacto sem tocar nas tabelas existentes.
3. Implementar funções puras e testes de cálculo, consolidação, unidade e degelo.
4. Implementar telas e fluxos isolados do planejamento de estoque existente.
5. Implementar prévia, associação de produto, importação idempotente e reconciliação.
6. Testar build, regras e autorização; testar migrations contra cópia local do schema antes de qualquer publicação.

