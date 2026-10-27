# Importação de DANFE em PDF

## Fluxo

Na entrada de estoque, use **Importar DANFE por PDF**. A leitura ocorre no navegador. PDFs com texto pesquisável usam PDF.js; páginas sem texto suficiente são renderizadas e processadas pelo Tesseract.js em português. A leitura não altera o estoque. O usuário confere os metadados, escolhe o fornecedor e vincula cada linha a um produto do ISP antes de transferir os itens para o formulário normal de entrada.

A confirmação continua usando o RPC de lote existente. Para importações fiscais, uma nova função chama esse RPC e registra a nota na mesma transação. Restrições únicas por chave de acesso e por fornecedor/número/série/data de emissão impedem duplicidade inclusive entre unidades da empresa, inclusive quando uma cópia tem chave e outra não. O registro guarda metadados, texto extraído e campos estruturados; o PDF original não é enviado nem armazenado. O acesso ao texto segue RLS por empresa/unidade.

## Limites e privacidade

- PDF até 10 MB e 15 páginas; arquivos com senha, inválidos ou além do limite são recusados.
- O texto extraído fica no navegador até a confirmação. Ao confirmar, ele é persistido para consulta do histórico fiscal; não se guarda o arquivo PDF.
- O código e os modelos abertos do OCR são carregados pelo navegador sob demanda. Na primeira leitura digitalizada, o navegador precisa alcançar o CDN público configurado pelo Tesseract.js para baixar o mecanismo/modelo de português. O arquivo fiscal é passado ao worker local do navegador, não enviado ao CDN pelo aplicativo.
- OCR pode confundir letras, códigos e valores. Campos sempre precisam de conferência; linhas não interpretadas podem ser incluídas pela busca de produtos usual.
- A correspondência de produto é manual nesta primeira versão. Não há conversão automática de unidades. CNPJ do fornecedor é validado, mas o cadastro de fornecedores atual não expõe CNPJ para correspondência automática.
- A extração determinística de linhas cobre um formato comum de tabela de DANFE; outros layouts podem exigir vinculação manual. Ainda não houve validação com DANFEs reais representativos.
- Isto não é validação fiscal oficial.

## Banco e implantação

As migrations `20261023000300_stock_invoice_import.sql` e `20261023000400_invoice_duplicate_fallback_date.sql` foram aplicadas no projeto Supabase vinculado em 23/10/2026. Elas acrescentam `stock_invoice_documents`, suas políticas RLS, índices de unicidade e o RPC `record_stock_invoice_movement_batch`. A mudança não escreve movimentos nem saldos existentes.

Não há novas variáveis de ambiente. O app continua usando `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Não coloque `service_role` no navegador. Implantação hospedada precisa permitir Web Workers e downloads do CDN do OCR, com CSP compatível com workers/blob, se houver CSP restritiva.

## Validação nesta entrega

Os testes automatizados cobrem extração determinística de cabeçalho, campos ausentes, uma linha de item comum e os limites configurados. Eles não medem precisão de OCR em imagens reais, não executam a migration em PostgreSQL/Supabase e não simulam uma transação remota. Antes de uso com estoque real, aplicar a migration em ambiente de homologação, revisar CSP/download de worker no destino de hospedagem e conferir DANFEs representativas de cada fornecedor.
