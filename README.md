# ISP Info Solutions Planning

Base técnica inicial para uma plataforma SaaS multiempresa com React, TypeScript e Firebase. Este repositório contém documentação e scaffolding; não representa um produto implementado ou pronto para produção.

## Estado dos requisitos

A especificação funcional e técnica aprovada ainda não foi localizada neste diretório. Até sua inclusão e revisão, as decisões abaixo são propostas iniciais derivadas do pedido de inicialização. Não há regras de negócio detalhadas aprovadas neste repositório.

## Estrutura

```text
.
├── docs/                 # Arquitetura, dados, permissões, segurança e roadmap
├── src/                  # Aplicação React
├── firebase/             # Regras Firestore e configuração do emulador
├── .env.example          # Apenas nomes de configuração pública de exemplo
├── AGENTS.md             # Instruções permanentes para desenvolvimento
└── package.json
```

## Começar

1. Instale Node.js LTS e npm em versão compatível com Vite.
2. Execute `npm install`.
3. Instale o Firebase CLI globalmente (`npm install -g firebase-tools`) para executar os emuladores locais. Não é necessário fazer login para rodar apenas os emuladores.
4. Configure `.env.local` com a configuração pública do projeto Firebase de desenvolvimento fornecido pela equipe. O arquivo `.env.local` está ignorado pelo Git. Não coloque chaves privadas ou credenciais de serviço no frontend.
5. Execute `npm run dev`.

Para entrar pela tela inicial, habilite o provedor **E-mail/senha** em Firebase Console → Authentication → Sign-in method e crie as contas pela equipe. O app não oferece cadastro público. Não habilite autenticação por telefone, pois a política atual evita recursos com cobrança.

O SDK inicializa Authentication e Firestore quando a configuração está presente; Storage não faz parte do projeto. As regras locais permitem ler o próprio estado de provisionamento, acessar tenant/unidades conforme membership e, para Superadministrador ISP provisionado, gerenciar metadados e associações. Módulos de negócio e os demais caminhos continuam negados. A última execução registrada de `npm run test:rules` passou no Firestore Emulator em 12/10/2026 (5 testes, incluindo isolamento entre tenants e escopo por unidade). Essas regras foram publicadas no Firestore do projeto de desenvolvimento nessa data, substituindo regras temporárias de leitura/gravação públicas. O primeiro documento `platformAdmins` também foi criado; ainda é necessário confirmar o reconhecimento do papel pela aplicação após autenticação. Isso não valida produção. Os emuladores locais podem ser habilitados com `VITE_USE_FIREBASE_EMULATORS=true`. Analytics/telemetria permanecem desativados até aprovação de política de privacidade e consentimento. A política atual exige permanecer no Spark, sem vincular faturamento; respeite as cotas gratuitas e não habilite serviços que exijam upgrade.

### Banco Firestore do projeto conectado

O banco existente tem ID `default` (sem parênteses), edição Enterprise, modo Firestore nativo e `Firestore Data Access` habilitado. `getFirestore(app)` seleciona o banco especial `(default)`; por isso `VITE_FIREBASE_DATABASE_ID=default` seleciona explicitamente o banco que existe. A API JavaScript para bancos nomeados está em Public Preview e a referência Firebase recomenda não usá-la em produção. Esta configuração serve para desenvolvimento; antes da produção será necessário migrar para um banco `(default)` compatível com a API estável ou reavaliar a disponibilidade estável do SDK e a política de custos. O banco conectado está marcado elegível à cota gratuita, mas uso acima das cotas pode ser cobrado. Não habilitamos Storage, acesso MongoDB nem faturamento nesta alteração.

O Admin SDK é exclusivo do backend. Use credenciais gerenciadas/ADC ou Secret Manager no ambiente de servidor; não coloque service account JSON neste repositório. `firebase.json` configura regras e portas dos emuladores. Foi publicada somente a versão das regras Firestore descrita acima; Hosting, Functions, Storage e deploy automatizado não foram habilitados.

## Documentação

- [Arquitetura e ambientes](docs/architecture.md)
- [Modelo de dados](docs/data-model.md)
- [Matriz inicial de permissões](docs/permissions.md)
- [Plano de testes de segurança](docs/security-test-plan.md)
- [Dependências externas e primeira fase](docs/implementation-plan.md)
- [Bootstrap manual do Superadministrador](docs/superadmin-bootstrap.md)

## Scripts previstos

- `npm run dev`: servidor local Vite.
- `npm run build`: verificação TypeScript e bundle de produção.
- `npm run test:rules`: executa os testes positivos e negativos das regras no Firestore Emulator (requer Firebase CLI global, JDK 21+ para a CLI instalada neste ambiente e baixa o emulador local na primeira execução).

O harness contém cenários positivos e negativos para Superadministrador, isolamento entre tenants e escopo por unidade. A suíte passou na última execução registrada; ela deve ser repetida após qualquer mudança nas regras. Consulte `docs/security-test-plan.md`.
