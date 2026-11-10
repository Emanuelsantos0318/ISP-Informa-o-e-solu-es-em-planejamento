# Roteiro de validação dos mapas de produção

## Escopo

Validar o caminho entre planejamento de proteína e Hortifruti, gravação, consulta, agrupamento, impressão diária e exportação semanal. A regra de negócio não deve criar nem alterar movimentações de estoque.

## Estado observado em 9 de novembro de 2026

- Os testes automatizados do projeto passaram: 10 arquivos e 61 testes.
- A suíte cobre cálculo per capita × volume, zero, justificativa para ajuste, consolidação por produto/unidade/público e leitura conservadora do mapa XLSX.
- O Supabase de produção está ativo, mas não possui as tabelas `production_plans`, `production_plan_entries` nem `production_hortifruti_entries`.
- Não constam no histórico remoto as migrations `20261104000100`, `20261104000200`, `20261105000100`, `20261109000100` e `20261109000200`.
- Nos logs de 24 horas: `GET /rest/v1/production_plans` retornou 404 em 30 chamadas e `POST` retornou 404 em 4 chamadas. As 7 respostas 200 foram `OPTIONS` (preflight), não consultas ou gravações concluídas.
- Nenhum dado de teste foi escrito em produção. Assim, o fluxo funcional em produção **não está aprovado**.

## Preparação segura

1. Aplicar as migrations e validar em ambiente de teste/staging, na ordem registrada no repositório.
2. Usar uma unidade e semana de teste, com produtos de catálogo identificáveis e um item sem vínculo.
3. Anotar quantidades antes do teste. Confirmar que o estoque não muda durante lançamentos de planejamento.
4. Não criar registros fictícios na unidade operacional de produção. Em produção, fazer primeiro verificações somente de leitura; o teste de escrita requer ambiente de teste ou autorização e conjunto de dados de teste isolado.

## Casos funcionais

| ID | Cenário | Ação | Resultado esperado |
| --- | --- | --- | --- |
| MAP-01 | Cálculo padrão | Lançar 0,08 KG/PESSOA × 330 PESSOAS | Necessidade calculada de 26,4 KG, preservando o valor sem arredondamento silencioso. |
| MAP-02 | Públicos diferentes | Lançar o mesmo produto/refeição para paciente e servidor | Entradas aparecem em seções separadas; não misturam públicos. |
| MAP-03 | Refeições diferentes | Lançar o mesmo produto em almoço e jantar | Entradas aparecem em grupos de refeição distintos. |
| MAP-04 | Zero explícito | Informar volume ou quantidade zero quando válido | Zero permanece zero; não vira vazio nem pendência. |
| MAP-05 | Unidade incompatível | Usar, por exemplo, KG/PESSOA com unidade final UN ou volume LOTE | O cálculo não é apresentado como válido; nenhuma conversão é presumida. |
| MAP-06 | Ajuste manual | Informar quantidade final diferente do cálculo e justificativa | O mapa conserva cálculo original, valor final e justificativa; ajuste sem motivo é bloqueado. |
| MAP-07 | Produto sem vínculo | Lançar texto original sem selecionar produto | Texto aparece no mapa e fica marcado como pendente de vínculo, sem entrar em soma por produto. |
| MAP-08 | Persistência | Salvar, recarregar a tela e voltar ao mesmo planejamento | Datas, público, refeição, produto, per capita, volume, unidade e totais permanecem iguais. |
| MAP-09 | Impressão | Imprimir o mapa do dia em A4 retrato | Logo ISP visível, controles ocultos, tabela legível, cabeçalhos e grupos não cortados. |
| MAP-10 | Exportação semanal | Exportar os sete dias e abrir no Excel/LibreOffice | Uma aba por dia, logo, títulos, grupos de refeição/público e totais conferem com a tela. Hortifruti fica na aba própria. |
| MAP-11 | Escopo de unidade | Acessar com usuário autorizado de outra unidade | Consultas e alterações respeitam o RLS; nenhuma linha da unidade anterior aparece. |
| MAP-12 | Estoque | Comparar saldo/movimentos antes e depois de lançamentos e conferências do planejamento | Saldo e histórico de estoque permanecem inalterados; recebimento de mercadoria segue a entrada normal do estoque. |

## Divergência de conteúdo do modelo

No PDF de referência, a coluna **UNIDADE** contém o setor/uso da preparação (por exemplo, “Prato principal” ou “Opção”), não o nome do hospital. A tabela atual do módulo possui `meal_group`, mas a tela não captura esse campo; a exportação atual imprime o nome da unidade organizacional nessa coluna. Antes de considerar o mapa fiel ao modelo, definir e capturar um campo explícito para esse agrupamento. Não preencher linhas antigas por inferência.

## Critérios para liberar o módulo

- Histórico de migrations do Supabase compatível com as migrations requeridas.
- GET e POST das tabelas de planejamento deixam de retornar 404.
- Suite automatizada passa e os casos MAP-01 a MAP-12 são executados em ambiente isolado.
- Layout conferido em impressão PDF e em XLSX real, incluindo quebra de página e logo.
- Coluna `UNIDADE` recebe dado operacional explícito e confirmado, não o nome do hospital por conveniência.
- Administrador, operador e escopo de unidade conferidos com contas e unidades de teste.

## Melhorias recomendadas

1. Capturar a unidade/setor da preparação no lançamento e no importador histórico; mapear para a coluna `UNIDADE`.
2. Acrescentar testes automatizados para grupos do mapa, unidade incompatível com ajuste manual, Hortifruti, conteúdo de XLSX e formatação de data operacional.
3. Mostrar erro de configuração com orientação quando o módulo ainda não tiver migration, preservando a mensagem técnica no diagnóstico.
4. Adicionar um resumo por produto e unidade que reconcilie as linhas do mapa com o total consolidado, sem somar unidades diferentes.
5. Testar impressão com dias longos e tabelas que atravessam páginas; repetir o cabeçalho visual e manter cada título de refeição junto às primeiras linhas.

