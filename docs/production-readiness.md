# ISP — avaliação de prontidão do MVP

Data: 27/10/2026

## Conclusão executiva

O sistema tem autenticação Supabase, cadastros persistentes, configurações administrativas, entradas/saídas em lote, importação de DANFE, painéis, relatórios e fluxos administrativos. Em 27/10/2026, as 16 migrações locais foram conferidas como aplicadas no projeto remoto e as funções `admin-invite-user` e `admin-create-user` foram confirmadas como ativas. O deploy do frontend desta versão ainda precisa ser validado.

A prontidão para uso com dados reais depende de rotacionar as credenciais que foram compartilhadas, validar as configurações remotas de Auth/SMTP e homologar os fluxos com perfis e saldos de teste. A chave publicável do Supabase e a URL já estão definidas nas variáveis de build do Netlify. O sistema não deve receber estoque real antes dessa homologação.

## O que está implementado

- Login por e-mail/senha, persistência de sessão, leitura do perfil ativo e bloqueio de usuários sem perfil.
- Escopo de empresa/unidade e políticas RLS no banco; gravações operacionais passam por RPCs, não por edição direta de tabelas.
- Cadastro e edição de produtos, categorias e fornecedores; pesquisa de produtos por nome/código e saldo exibido por unidade.
- Entradas e saídas com múltiplos produtos, data/hora operacional, classificações, chave de idempotência, atualização transacional do saldo e auditoria.
- Configuração persistente dos limites de estoque/validade e das sugestões de serviço por horário.
- Importação de DANFE por PDF, leitura no navegador, conferência/vinculação manual de itens, prevenção de duplicidade e histórico fiscal do texto extraído.
- Regras de negócio e fuso horário de Salvador separados em módulos próprios.
- Site público em `https://infosolutionsplannig.netlify.app`; verificados HTTP 200 na página inicial e em `/movimentacoes`.

## Pendências para fechar o MVP

### P0 — antes de usar dados reais

1. **Rotacionar credenciais expostas.** Uma chave secreta do Supabase e uma senha de banco foram compartilhadas na conversa. Revogue a chave secreta e altere a senha do banco no painel Supabase. O navegador deve continuar usando somente a chave publicável; não incluir segredos no Netlify, no `.env` do cliente ou no Git.
2. **Tornar o deploy reproduzível.** O workspace atual não contém `.git` nem remoto configurado. A publicação observada foi feita por CLI, e a configuração Netlify precisa ter `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` definidas para qualquer build futuro. Conectar o repositório correto ao Netlify ou documentar e automatizar o deploy por CLI; validar que um novo build mantém a configuração do Supabase.
3. **Conferir configuração do Supabase Auth.** Confirmar no projeto remoto o `Site URL`, URLs de redirecionamento incluindo `https://infosolutionsplannig.netlify.app`, política de confirmação de e-mail, SMTP e regras de cadastro. A configuração local não prova a configuração remota.
4. **Homologar fluxos com perfis reais.** Com contas separadas de administrador, gestor e operador, conferir login/logout, troca de unidade, permissões negadas e permitidas, cadastro/edição, entrada, saída, saldo atualizado, saldo insuficiente, repetição de envio e auditoria. Fazer somente em ambiente/dados de teste até aprovar os resultados.
5. **Validar dados e escopo inicial.** Conferir com o responsável a lista importada de produtos, unidades, categorias, códigos de barras, mínimos e saldos. A lista de catálogo não substitui inventário físico inicial.

### Estado atual das funções centrais

1. **Histórico geral.** Implementado com consulta a lotes/itens, unidade, período, tipo e busca; confirmar comportamento com volume real e paginação (a consulta atual limita resultados).
2. **Dashboard.** Cartões, gráficos e movimentações recentes passaram a derivar de produtos, saldos e movimentos reais, filtrados por unidade/período.
3. **Alertas.** Implementados níveis mínimo/zerado, lotes vencidos/próximos do vencimento considerando saldo, e cadastro incompleto.
4. **Planejamento/relatórios.** Implementados consumo médio, cobertura, sugestão de reposição e seis saídas; Excel e impressão para PDF usam o conjunto filtrado. Validar cada modelo com o responsável pelo estoque.
5. **Administração de usuários.** Implementados convite por função Edge protegida, perfil, unidade e ativação; as duas funções estão ativas no projeto remoto. A confirmação dos convites e recuperação de senha ainda depende da configuração remota de Auth/SMTP/URLs de redirecionamento.
6. **Ajustes e perdas.** Incluídos no escopo do MVP para administrador/gestor de estoque, com motivo obrigatório, idempotência e auditoria. A permissão é validada também no banco. Estorno permanece fora do MVP; erros devem ser corrigidos com movimento inverso e motivo, sem editar histórico.
7. **Lotes/validade.** Entradas podem associar lote e validade. A migração preparada baixa saídas pelo FEFO, pula lotes vencidos para consumo normal e permite perda em lote vencido; alertas consideram saldo atual por lote. Sem lote informado na entrada, o saldo segue sem rastreio de validade.

### P2 — qualidade e operação

- Homologar a importação DANFE com documentos reais representativos dos fornecedores; OCR e extração de itens são aproximados e exigem conferência humana. Definir retenção do texto fiscal extraído.
- Testar a interface em celular/tablet e revisar acessibilidade, estados de carregamento, mensagens e paginação dos cadastros.
- Definir monitoramento de erros, rotina de backup e procedimento testado de restauração do Supabase.
- Escolher um gerenciador de pacotes e manter os lockfiles coerentes (`package-lock.json` e `bun.lock` existem no workspace).
- Dividir o bundle do cliente; a avaliação anterior registrou chunk principal acima do limite recomendado pelo Vite.

## Estado de publicação e banco

- Em 27/10/2026, `supabase migration list` confirmou as 16 migrações locais e remotas iguais, de `20261022000100` a `20261026000200`.
- A consulta de funções confirmou `admin-invite-user` e `admin-create-user` como ativas. As variáveis de build do Supabase foram definidas no projeto Netlify `infosolutionsplannig`; o deploy e o acesso à URL ainda precisam de verificação após a publicação.
- Essas verificações não homologam permissões com cada perfil, conteúdo/saldos, restauração de backup, SMTP ou configuração remota de Auth.
- A chave `VITE_SUPABASE_PUBLISHABLE_KEY` é pública por natureza; a proteção dos dados depende de autenticação, RLS e validações das RPCs. Segredos administrativos nunca devem ser enviados ao browser.

## Critério sugerido para considerar o MVP concluído

1. Bloqueadores P0 resolvidos e documentados; frontend publicado e configuração Auth verificada.
2. Homologação aprovada para cada papel e unidade, incluindo falhas e repetição de chamadas.
3. Histórico geral, dashboard e alertas funcionais; catálogo e movimentos confirmados com dados de teste.
4. Escopo explícito para ajustes/perdas, lotes/validade e relatórios; tudo que ficar fora marcado como fase posterior dentro do app.
5. Build de produção reproduzível no Netlify com as variáveis corretas e validação final da URL publicada.

## Limites desta avaliação

Nesta revisão, o checkout limpo passou em `npm ci`, `npx tsc --noEmit`, nos 28 testes e no build Netlify de produção. Vite e Zod foram atualizados para versões corrigidas; a auditoria npm não encontrou vulnerabilidades altas ou críticas, mas ainda aponta duas moderadas em ExcelJS/UUID. ESLint não encontrou erros, com 15 avisos de Fast Refresh e dependências de hooks. Não foram executados lançamentos operacionais de teste no Supabase, revisão visual em dispositivos, OCR com DANFE real, auditoria externa, restauração de backup ou homologação real dos relatórios e permissões.
