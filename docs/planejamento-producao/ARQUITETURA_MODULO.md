# Arquitetura proposta — ISP Planejamento de Produção

## Limite com o sistema atual

O módulo será adicionado em `/planejamento-producao`. A tela de consumo e reposição já existente em `/planejamento` continuará disponível sem mudança de finalidade.

O novo módulo consome o catálogo e a posição de estoque existentes, mas mantém plano, refeições, entregas, degelo, polpas e importações em tabelas próprias. Criar ou editar planejamento nunca chama `record_stock_movement_batch` e nunca altera `stock_balances` ou `stock_movements`.

## Entidades

- `production_plans`: empresa, unidade, semana, datas, responsável, estado e versão.
- `production_plan_entries`: data, público, refeição, grupo/unidade da preparação, preparação, produto opcional, texto original, per capita, volume, unidade final, quantidade calculada, ajuste manual e justificativa.
- `production_delivery_windows`: janelas de consumo/entrega configuráveis por empresa/unidade.
- `production_deliveries` e `production_delivery_items`: entrega e quantidades planejadas/recebidas/pendentes sem gerar movimentação automaticamente.
- `production_thaw_rules` e `production_thaw_schedules`: antecedência por produto/categoria e programação por dia de consumo; regra inicial de peixe de 24 horas precisa de configuração explícita e validável.
- `production_pulp_entries`: lançamentos de polpa separados de proteínas, associados a dia, público, serviço, sabor, produto existente opcional, unidade e quantidade.
- `production_product_aliases`: texto histórico, forma de busca normalizada e produto oficial escolhido; o texto de origem permanece imutável.
- `production_imports`: arquivo no bucket privado, nome, SHA-256, autor, data, estado, abas, contagens e resumo de validação. O hash é único por empresa/unidade para idempotência.
- `production_import_rows`: origem por aba/célula, valor original, fórmula, resultado de cache, data identificada, associação de produto, estado de validação e apontamento para o registro importado.
- `production_audit_events`: trilha de alteração de lançamentos, entregas e programação de degelo, com ator, data, entidade, valores anterior/novo e justificativa.

Os nomes são conceitos e podem ser adaptados ao esquema, mas toda relação deve incluir a chave de escopo da empresa/unidade e FKs compostas onde necessário.

## Cálculo e unidade

- Multiplicar per capita pelo volume somente quando ambos forem numéricos, presentes e compatíveis com a unidade final. Preservar precisão decimal; sem arredondamento intermediário.
- Resultado calculado deve ser produzido no banco ou função de domínio compartilhada e persistida com a entrada.
- Um ajuste manual não apaga o cálculo original: guarda cálculo, valor final, motivo, ator e horário.
- Quantidade zero é diferente de ausente. Unidade não informada ou incompatível produz pendência, nunca conversão automática.
- Consolidação e vínculo de produto usam `products.id`. Aliases apoiam revisão humana, não criam cadastros automaticamente.

## Integração com estoque

- Consulta leitura do catálogo de produtos, saldo atual, lotes e movimentos pelo modelo existente.
- Necessidade, saldo, cobertura, pedido pendente e diferença de entrega são indicadores separados. `purchase_plans` só é consultado; nenhum pedido é criado no fluxo de planejamento.
- Não aplicar baixa, reserva ou entrada prevista ao saldo. Os dados de produção não são estoque disponível.
- A entrega só afeta estoque em fluxo independente de recebimento, após ação explícita e autorizada; esse fluxo não faz parte da importação histórica.

## Importação e reconciliação

1. Ler XLSX no navegador ou função de importação sem modificar a origem.
2. Calcular hash do binário e armazenar arquivo em bucket privado.
3. Extrair todas as abas/células usadas, incluindo fórmulas, valores em cache, vazios, zeros e valores textuais.
4. Classificar linhas reconhecidas e desconhecidas; extrair datas sem inferir datas conflitantes.
5. Mostrar prévia com associações por UUID, pendências e diferenças.
6. Gravar origem e linhas em transação idempotente; histórico nunca entra no estoque.
7. Emitir reconciliação por aba, data, público, refeição, produto, entrega, degelo e sabor.

Um arquivo igual (mesmo hash) é recusado como duplicação ou aberto em modo consulta. Outro arquivo para o mesmo período gera uma nova importação/versão comparável, sem sobrescrever a anterior.

## Segurança e auditoria

- RLS por empresa/unidade usando `private.has_active_access` e `auth.uid()`.
- Administração de configurações, regras, aliases e importação: `admin` e `stock_manager` inicialmente. Leitura disponível para papéis com acesso ativo. Permissões adicionais por fluxo serão documentadas e validadas no banco.
- Uma migration nova cria somente entidades e policies do módulo. Sem `DROP`, limpeza de tabelas existentes ou mudança de movimentos.
- Arquivo original em bucket privado, sem URL pública; acesso conferido por sessão e RLS de storage.
- Triggers de auditoria para alterações mutáveis; dados de origem brutos da importação protegidos contra edição destrutiva.

## Telas

- Visão geral por semana, com pendências de importação/cadastro claramente separadas de fatos calculados.
- Planejamento semanal com seletores de público, refeição, data, preparação e produto.
- Consolidação por produto, público, refeição, dia e entrega.
- Entregas e divergências, degelo e programação diária/semanal.
- Polpas, mapas diários, histórico e prévia/importação de arquivo.
- Relatórios e exportações derivados das mesmas consultas filtradas.

