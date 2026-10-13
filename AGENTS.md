# Instruções permanentes do projeto

## Requisitos e decisões
- Trate a especificação funcional e técnica aprovada como fonte oficial. Até ela ser adicionada a este repositório, use `docs/architecture.md` como registro provisório das premissas e sinalize divergências antes de implementar regras de negócio.
- Não invente credenciais, endpoints, integrações, políticas comerciais nem resultados de testes. Use variáveis de ambiente de exemplo sem valores secretos.
- Preserve arquivos existentes. Antes de alterar configuração ou dependências, entenda seu uso e documente decisões relevantes.

## Segurança obrigatória
- Todo acesso a dados deve ser negado por padrão e validado no servidor. A interface nunca é uma fronteira de segurança.
- Nunca confie em `tenantId`, `unitId`, papel ou permissões enviados pelo cliente. Derive identidade de `request.auth`, confira memberships armazenados e imponha tenant/unidade nas Security Rules ou no backend confiável.
- Todo documento de negócio pertence a exatamente um `tenantId`; dados de unidades levam `unitId` quando aplicável. Consultas, índices e regras devem preservar esse escopo.
- Não permita que um usuário altere seu próprio tenant, papel, status, associação ou claims. Mudanças administrativas exigem Security Rules ou backend confiável; o ator e a operação devem ficar registrados. Só publique regras permissivas após testes positivos e negativos no Emulator Suite.
- Chaves de conta de serviço e segredos só podem existir em ambiente de servidor/secret manager. Nunca os inclua no cliente, no Git ou em logs.
- O Superadministrador é exclusivo da ISP, separado de papéis de clientes, com MFA recomendado/obrigatório conforme decisão de segurança, menor privilégio, auditoria e operações privilegiadas no backend.
- App Check complementa Authentication e Security Rules; não substitui autorização. Qualquer backend confiável futuro deve revalidar autorização e entrada, sem colocar Admin SDK no cliente.
- Mudanças em Security Rules, claims, isolamento, autenticação ou operações administrativas exigem testes automatizados negativos e positivos antes de aprovação.

## Engenharia
- Use TypeScript estrito, validação de entrada no limite, tipos compartilhados sem confiar em tipos como validação, e componentes acessíveis.
- Mantenha configuração separada por ambiente. Não misture projetos Firebase de desenvolvimento, homologação e produção.
- Respeite a política de custo: não habilite nem adicione Storage, Functions, Run, Hosting ou serviço com potencial de cobrança sem autorização explícita; mantenha o projeto no plano sem cobrança e monitore limites gratuitos.
- Toda nova coleção deve documentar proprietário, escopo, retenção, leitura/escrita e índices necessários em `docs/data-model.md`.
- Mantenha testes de regras usando Firebase Emulator Suite. Nunca execute testes destrutivos contra projetos remotos.
- Atualize README e documentos de arquitetura quando uma decisão estrutural mudar.

## Fluxo
- Antes de alterar arquivos, inspecione o estado atual e arquivos relacionados.
- Execute verificações pertinentes disponíveis e relate claramente o que não pôde ser executado por falta de configuração externa.
- Não declare produção pronta sem revisão de segurança, testes em emulador, configuração de ambientes, monitoramento, backup e aprovação operacional.
