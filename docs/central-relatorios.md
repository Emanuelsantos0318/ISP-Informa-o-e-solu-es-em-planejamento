# Central de Relatórios Gerenciais

## Fonte dos dados

Os relatórios consultam `products`, `categories`, `stock_balances`, `product_lots`, `stock_movement_batches`, `stock_movement_batch_items`, `stock_movements`, `profiles`, `stock_invoice_documents` e os fornecedores do catálogo, respeitando a unidade selecionada e as políticas de acesso já aplicadas pelo cliente Supabase.

## Indicadores

- **Posição atual:** soma dos saldos por produto e lote, situação calculada pelas regras compartilhadas de estoque e limites cadastrados no produto.
- **Entradas, saídas e perdas:** quantidade dos itens de movimentação do período, sem converter unidades.
- **Média diária:** soma das saídas de um produto dividida pelos dias corridos selecionados. A regra compartilhada pode retornar indisponível quando não há histórico mínimo ou consumo.
- **Cobertura:** saldo atual do produto dividido pela média diária, sem estimativa se o consumo não puder ser calculado.
- **Reposição sugerida:** máximo entre zero e meta cadastrada menos saldo atual. Não é pedido de compra.
- **Validade:** comparação entre validade do lote e data atual em America/Bahia, usando a configuração de alerta.
- **Comparação de consumo:** saídas dos dois períodos consecutivos de mesma duração; fica desabilitada quando unidades são incompatíveis ou o filtro não representa saídas.

## Limitações conhecidas do esquema atual

O sistema não registra custo unitário por item, método de custeio, valores de estoque por produto, compromissos/reservas, compras pendentes, entregas futuras, prazo de fornecedor, quantidade física contada, responsável e justificativa de inventário, estornos/devoluções estruturados, data de fabricação, localização de lote ou dados de aproveitamento de resíduos. Esses relatórios mostram a limitação e não inventam os valores.

Notas fiscais mostram o total informado no documento, sem rateio em custo de produto. As consultas do relatório são paginadas, incluindo catálogo, estoque, lotes, movimentos, itens associados, usuários e documentos fiscais dentro do período selecionado. As páginas usam ordenação estável; filtros `in` são divididos em blocos menores para respeitar os limites da API.

O relatório usa a unidade histórica do payload quando foi salva. Movimentos antigos sem unidade registrada herdam a unidade atual do produto; alterações de unidade podem, portanto, limitar a comparabilidade histórica desses registros.

## Uso

Abra **Relatórios gerenciais → Central de relatórios**, escolha uma área ou formato e combine período, tipo de movimento, tipo de saída, categoria, produto, busca por nome/SKU/código de barras, marca, fornecedor, serviço, responsável, situação e unidade de medida. A Central reúne também os seis formatos que antes eram emitidos em Planejamento: movimentações por produto, analítico de movimentações, estoque por categoria, geral de estoque, ranking e consolidado. A opção **Imprimir / PDF** usa a impressão do navegador. A opção **Exportar Excel** gera uma planilha `.xlsx` com os mesmos registros e filtros da prévia.
