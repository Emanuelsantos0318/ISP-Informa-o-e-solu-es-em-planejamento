# Auditoria da planilha de planejamento

## Integridade da origem

- Arquivo: `Planejamento%20PTN%20e%20POLPA%2015%20a%2021-10%20com%20mapas (2).xlsx`.
- Tamanho: 82.014 bytes.
- SHA-256: `2297330e3c53dc5d3a9a7b165129683b19403724b009f6a4fcd8b1b02870716f`.
- A planilha foi aberta somente para leitura. O arquivo original permanece intacto.
- As 10 abas foram identificadas e preservadas com espaços finais onde existem:
  `PACIENTE per capta `, `SERVIDOR per capta `, `POLPA `, `MAPA 15-10`, `MAPA 16-10`, `MAPA 17-10`, `MAPA 18-10`, `MAPA 19-10`, `MAPA 20-10`, `MAPA 21-10`.

## Inventário por aba

| Aba original | Linhas × colunas usadas | Células preenchidas | Fórmulas | Fórmula sem resultado em cache |
|---|---:|---:|---:|---:|
| `PACIENTE per capta ` | 159 × 17 | 554 | 161 | 0 |
| `SERVIDOR per capta ` | 122 × 46 | 1.477 | 554 | 0 |
| `POLPA ` | 56 × 26 | 575 | 66 | 0 |
| `MAPA 15-10` | 28 × 11 | 159 | 92 | 4 |
| `MAPA 16-10` | 27 × 11 | 167 | 104 | 4 |
| `MAPA 17-10` | 27 × 11 | 167 | 104 | 15 |
| `MAPA 18-10` | 28 × 11 | 172 | 108 | 16 |
| `MAPA 19-10` | 26 × 11 | 162 | 100 | 10 |
| `MAPA 20-10` | 27 × 11 | 167 | 104 | 12 |
| `MAPA 21-10` | 25 × 11 | 162 | 100 | 7 |
| **Total** | — | **3.762** | **1.493** | **68** |

Os dados confirmam as sete abas de mapas, além dos três planejamentos (pacientes, servidores e polpas). O prompt anexado estimava 1.179 fórmulas (72 + 358 + 37 + 712); a leitura direta do arquivo encontrou 1.493 (161 + 554 + 66 + 712). Essa diferença não é corrigida nem descartada: o importador deverá registrar as fórmulas efetivamente encontradas, inclusive fórmulas em células auxiliares.

## Fórmulas e reconciliação

- A regra de cálculo da quantidade aparece como `per capita × volume`; resultados em cache foram encontrados para fórmulas nas três abas de planejamento.
- Exemplos conferidos pelos valores armazenados: 0,08 × 195 = 15,60; 0,15 × 265 = 39,75; 0,20 × 50 = 10,00; 0,45 × 500 = 225,00; 0,014 × 850 = 11,90.
- Não foi encontrado resultado de erro (`#REF!`, `#VALUE!` etc.) em cache nas fórmulas inspecionadas.
- 68 fórmulas das abas de mapa não têm resultado armazenado no arquivo; células ficam em branco ou podem depender de recálculo no Excel. Esses valores não devem ser tratados como zero.
- A fórmula de degelo em `SERVIDOR per capta !AT4:AT22` contém `SUMIF($C$106:$C$113, ..., $F$103:$F$113)`: intervalo de critérios com 8 linhas e intervalo de soma com 11 linhas. Os resultados em cache existem, mas a fórmula é estruturalmente suspeita e fica pendente de validação; nenhum desses resultados será corrigido silenciosamente.
- Fórmulas `SUMIF` consolidadas procuram nomes textuais exatos. Variações de caixa, acento, espaço e grafia podem separar um mesmo produto em mais de uma linha.

## Datas e períodos encontrados

- `PACIENTE per capta ` anuncia `UTILIZAÇÃO DE 05 A 11-11`, mas contém blocos de almoço em 17–21/10/2026 e jantar em 05–11/11/2026.
- `SERVIDOR per capta ` anuncia período de novembro, contém uma data explícita em 12/11/2026 e blocos de degelo nomeados com outubro e setembro. A referência textual do degelo inclui 02/10 e datas de 20–24/09.
- `POLPA ` utiliza datas de 02–09/10/2026.
- `MAPA 15-10` tem título interno de quinta-feira, 05/11, divergente do nome da aba; o título aparece em B1 e H1.
- `MAPA 16-10` a `MAPA 21-10` têm títulos internos de 16–21/10/2026.
- Datas armazenadas como fórmulas foram lidas com os seus resultados em cache. A importação deve preservar a expressão e o resultado e usar a data de cada registro, não derivá-la somente do título da aba.

## Estrutura operacional e valores

- Pacientes: colunas A:F organizam data, preparação/refeição, produto textual, per capita, volume e quantidade. Consolidações gerais e entregas aparecem em H:I, K:L e N:O.
- Servidores: existem blocos paralelos A:F e K:P, consolidações de proteínas e totais em áreas auxiliares e sete tabelas de degelo em AA:AT.
- Polpas: blocos repetidos por público/dia, sabor, quantidade e consolidação nas colunas laterais. As datas de outubro não podem ser movidas para novembro por inferência.
- Mapas: sete abas com fórmulas que referenciam os blocos de pacientes/servidores. Há fórmulas com cache ausente em todas elas.
- Célula vazia e zero coexistem. O armazenamento histórico precisa distinguir `null`, `0`, fórmula e texto literal como “Não informado”.
- O documento também contém títulos, instruções, totais e tabelas auxiliares. A importação deve preservar esses dados brutos e não apenas as linhas reconhecidas como refeições.

## Resultado da importação

Nenhum registro foi importado para o ISP nesta fase de auditoria. Não houve cadastro de produto, alteração de estoque ou movimentação. Antes da gravação, o importador deverá apresentar prévia, associação de produtos por UUID, datas divergentes, fórmulas sem cache, intervalos suspeitos, unidades e totais reconciliados. As células não reconhecidas permanecem explicitamente pendentes.

