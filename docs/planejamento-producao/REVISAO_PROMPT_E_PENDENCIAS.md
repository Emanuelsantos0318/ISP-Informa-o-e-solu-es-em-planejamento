# Revisão do prompt e pendências — Planejamento de Produção

Revisão feita em 05/11/2026 com base no prompt mestre, na planilha indicada e no código da branch `codex/planejamento-producao`. Nenhuma alteração foi publicada ou aplicada ao Supabase de produção.

## Situação por requisito

| Requisito | Situação | Evidência / pendência |
| --- | --- | --- |
| Separar o módulo de produção do planejamento de estoque atual | Implementado | Rota `/planejamento-producao`; o módulo consulta o estoque e não cria movimentos nem reservas. |
| Plano semanal, refeições e públicos separados | Implementado | Entidades próprias e cálculos por per capita/volume com unidade explícita. |
| Consolidar produtos sem misturar unidades | Implementado | Consolidação por UUID e unidade; valores ausentes ficam como pendência. |
| Entregas e conferência | Implementado localmente | Fluxo de quantidade planejada/recebida; conferência não altera saldo de estoque. Regras ainda precisam validação operacional. |
| Programação de degelo | Implementado localmente | Agenda por produto/data e regra configurável; regra de 24 horas para peixe validada no banco. |
| Separar polpas de proteínas | Parcial | Lançamento e consolidação diária/faixa implementados. Os quadros-resumo e regras de embalagem da planilha precisam de validação e mapeamento. |
| Importar o XLSX original sem perder fórmulas, células e histórico | Estrutura implementada; arquivo ainda não importado | O leitor preserva arquivo e células, detecta repetição por hash e gera candidatos. Não existem ainda registros históricos importados desta planilha. A validação humana por linha continua necessária. |
| Reconhecer mapas e reconciliar datas/quantidades | Parcial | 108 linhas candidatas reconhecidas; 23 linhas com conflito de data na aba `15-10` e 3 sem KG numérico permanecem sem interpretação automática. |
| Mapas com histórico/versionamento e emissão | Parcial | Importação preserva origem bruta; falta fechar a reconciliação dos mapas e os controles de versões/emissão descritos no prompt. |
| Relatórios e exportações | Parcial | Exportação semanal XLSX e mapa diário para impressão existem. Falta exportação PDF/CSV e filtros/reconciliação gerencial completos. |
| Proteínas cadastradas sem SKU | Feito somente no banco local isolado | Migration `20261105000100_products_without_sku_and_protein_catalog.sql` permite SKU nulo e cadastra 17 itens ausentes na categoria Proteínas, sem SKU/código inventado. Queijo Muçarela e Ricota já existentes foram reaproveitados. Não foi aplicado à produção. |
| Testes de regras e proteção do estoque | Parcial | Testes unitários e smoke test transacional local aprovados. Faltam testes de RLS/RPC com diferentes papéis e reconciliação do XLSX por usuários da unidade. |

## Catálogo de proteínas

Incluídos na categoria **Proteínas**, com unidade `kg`, SKU e código de barras nulos, estoque mínimo zero (sem criar quantidades de saldo): Bacon, Bisteca, Bofe, Calabresa, Charque, Coxa e sobrecoxa, Coxão duro, Coxão mole, Fígado, Filé de frango, Linguiça toscana, Merluza, Patinho, Pernil, Posta, Presunto e Queijo Minas.

Queijo Muçarela e Ricota já existiam como produtos independentes no catálogo local; não foram duplicados nem movidos de categoria. O campo SKU agora aceita ausência real (`NULL`); a interface deixou de copiar o código de barras para o SKU.

Não foram cadastrados `Ovo` como proteína em kg (a planilha mostra quantidade 400 sem unidade inequívoca), `Bolo` (sem quantidade), `Frango grelhado` (preparação não confirmada como produto cru) ou `Peito de frango` (variante não listada no prompt mestre). Estes casos exigem decisão da unidade antes de cadastro ou associação.

## Situação da planilha e das exportações

A exportação semanal XLSX é funcional no código e inclui resumo, consolidação de proteínas, polpas, entregas, degelo e pendências. O mapa diário pode ser impresso. A planilha de referência **não foi importada como dados de produção**, e por isso o sistema ainda não mostra seus registros históricos. A auditoria técnica da planilha está em [ANALISE_PLANILHA_REFERENCIA.md](ANALISE_PLANILHA_REFERENCIA.md).

Antes da importação real, a equipe precisa reconciliar datas divergentes, linhas sem quantidade/unidade, associações de produto e a fórmula suspeita `SERVIDOR per capta !AT4:AT22`. Importar sem essa validação poderia registrar refeições na data ou unidade errada.

## Próximas etapas para completar as funcionalidades

1. Fazer sessão de reconciliação da planilha com responsáveis da produção: datas, produtos, per capita, volumes, unidades, polpas e mapas.
2. Fechar os quadros-resumo de polpas e definir as três faixas/janelas com a unidade.
3. Implementar filtros por período, público, serviço e produto; completar PDF/CSV e relatórios reconciliados.
4. Completar histórico/versionamento dos mapas, registro de emissor e relatório de diferenças por aba/data/produto.
5. Testar permissões RLS e RPC para administrador, gestor e operador, inclusive tentativas de acesso a outra unidade.
6. Repetir testes funcionais com dados conferidos e formalizar aceite da unidade.
7. Só então promover as migrations e a branch para produção, preservando o ISP atual até aprovação.

## Validação técnica desta revisão

- `npx tsc --noEmit`: aprovado.
- `npm test`: 9 arquivos, 58 testes aprovados, incluindo validação de SKU opcional.
- `npm run build`: concluído para cliente e SSR; aviso de chunks grandes acima de 500 KiB, principalmente ExcelJS, PDF.js e gráficos.
- `npm run lint`: reprovado, com 593 erros e 2 avisos; o Prettier aparece como principal regra, então a branch precisa de formatação antes da integração.
- `git diff --check`: sem erro; apenas avisos de conversão CRLF no Windows.
- Em 06/11/2026, o schema e os 17 produtos foram confirmados no PostgreSQL local isolado `ISP_MVP_PLANNING_TEST`. O PostgREST foi recarregado, login de teste funcionou e uma consulta autenticada a `production_plans` retornou HTTP 200. A interface está ativa em `http://localhost:8081/planejamento-producao`, no modo `localtest`; `.env.local` de produção não foi alterado.

## Análise operacional adicional

- **Teste local pronto:** a URL `localhost:8081` consulta o Supabase isolado em `localhost:55321`; não usa o projeto remoto.
- **Sem acesso de produção:** migrations e catálogo continuam somente locais; branch sem deploy/push.
- **Correção de lançamentos pendente:** a listagem não dispõe de editar/excluir item. Recomenda-se definir um fluxo auditado de ajuste antes do uso real.
- **Proteção contra erros de unidade pendente:** a unidade final digitável não é validada contra a unidade do produto vinculado.
- **Proteção de intervalo pendente:** não há constraint/trava no banco para impedir data de consumo fora da semana do plano.
- **Aceite de perfis pendente:** revisar especialmente escrita por `purchasing_approver` e executar testes de papel/unidade, inclusive acesso negado entre unidades.
- **Importação histórica pendente:** os candidatos da planilha permanecem apenas auditados; não foram gravados como dados operacionais.
