import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Boxes,
  ClipboardCheck,
  Factory,
  Hospital,
  MessageCircle,
  ScanBarcode,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/common/ThemeToggle";

export const Route = createFileRoute("/conheca-isp")({
  head: () => ({
    meta: [
      { title: "Conheça o ISP · InfoSolutions Planning" },
      {
        name: "description",
        content:
          "Conheça o ISP, sistema de gestão de estoque e planejamento para operações de alimentação hospitalar.",
      },
    ],
  }),
  component: AboutIspPage,
});

const WHATSAPP_NUMBER = "5571999149609";
const WHATSAPP_MESSAGE = encodeURIComponent(
  "Olá! Gostaria de conhecer o ISP e saber como adquirir o sistema.",
);
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`;

const benefits = [
  {
    icon: Boxes,
    title: "Estoque em um só lugar",
    text: "Cadastre produtos, categorias e fornecedores e consulte os saldos por unidade.",
  },
  {
    icon: ScanBarcode,
    title: "Operação com menos etapas",
    text: "Localize produtos pelo código de barras ou pelo nome e registre entradas e saídas em sequência.",
  },
  {
    icon: ClipboardCheck,
    title: "Rastreabilidade das movimentações",
    text: "Consulte quem registrou cada movimento, quando ocorreu e qual foi o destino informado.",
  },
  {
    icon: BarChart3,
    title: "Relatórios para decidir melhor",
    text: "Filtre movimentações e acompanhe consumo médio diário para apoiar as decisões de reposição.",
  },
  {
    icon: Factory,
    title: "Planejamento de produção",
    text: "Organize mapas de proteínas, polpas e hortifruti com quantitativos e impressão para a rotina da unidade.",
  },
  {
    icon: ShieldCheck,
    title: "Acesso por perfil e unidade",
    text: "Administre usuários e permissões conforme as responsabilidades de cada equipe e operação.",
  },
];

function AboutIspPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <img
              src="/isp-logo.png"
              alt="InfoSolutions Planning"
              className="size-12 object-contain"
              width={48}
              height={48}
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                ISP
              </p>
              <p className="font-semibold">InfoSolutions Planning</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline" size="sm">
              <Link to="/">
                <ArrowLeft className="size-4" /> Voltar ao acesso
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b bg-primary text-primary-foreground">
        <div className="pointer-events-none absolute -right-24 -top-32 size-96 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium">
              <Hospital className="size-3.5" /> Gestão para alimentação
              hospitalar
            </span>
            <h1 className="mt-5 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
              Estoque e planejamento mais claros para a rotina da nutrição.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-primary-foreground/80 sm:text-lg">
              O ISP conecta cadastro, movimentações, consumo, relatórios e mapas
              de produção em um fluxo pensado para equipes de almoxarifado e
              nutrição hospitalar.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="bg-white text-primary hover:bg-white/90"
              >
                <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" /> Fale com a equipe
                  <ArrowRight className="size-4" />
                </a>
              </Button>
              <a
                href="#recursos"
                className="inline-flex h-11 items-center rounded-md border border-white/25 px-4 text-sm font-medium hover:bg-white/10"
              >
                Ver recursos do ISP
              </a>
            </div>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 p-6 shadow-xl backdrop-blur-sm">
            <p className="text-sm font-medium text-primary-foreground/75">
              Uma visão integrada da operação
            </p>
            <div className="mt-5 grid gap-3">
              {[
                ["01", "Cadastrar e organizar produtos"],
                ["02", "Registrar entradas e saídas"],
                ["03", "Acompanhar consumo e saldos"],
                ["04", "Planejar e imprimir mapas"],
              ].map(([number, label]) => (
                <div
                  key={number}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-slate-950/15 p-3"
                >
                  <span className="flex size-8 items-center justify-center rounded-md bg-cyan-300/20 text-sm font-semibold text-cyan-100">
                    {number}
                  </span>
                  <span className="text-sm font-medium">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
            Por que o ISP existe
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            Menos controles espalhados. Mais confiança no processo.
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Em operações com grande volume de refeições, a equipe precisa
            localizar produtos depressa, manter o saldo coerente e preparar os
            mapas de produção sem depender de controles desconectados. O ISP
            reúne essas tarefas e mantém um histórico consultável para apoiar a
            rotina e a tomada de decisão.
          </p>
        </div>
        <div
          id="recursos"
          className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {benefits.map((benefit) => (
            <article key={benefit.title} className="surface p-5">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <benefit.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{benefit.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {benefit.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              O que o sistema ajuda a resolver
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Uma rotina operacional mais fluida e rastreável.
            </h2>
          </div>
          <ul className="grid gap-3 text-sm leading-6 text-muted-foreground">
            <li>
              • Reduz a procura manual por itens e informações do estoque.
            </li>
            <li>
              • Facilita registrar e consultar entradas e saídas por unidade.
            </li>
            <li>
              • Ajuda a identificar para onde os produtos foram liberados.
            </li>
            <li>
              • Reúne indicadores de consumo e planejamento em relatórios.
            </li>
            <li>
              • Apoia a preparação dos mapas de proteínas, polpas e hortifruti.
            </li>
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-6 rounded-2xl bg-primary p-7 text-primary-foreground sm:p-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-100">
              Conheça o ISP na sua operação
            </p>
            <h2 className="mt-3 text-2xl font-bold sm:text-3xl">
              Converse com a equipe e solicite uma apresentação.
            </h2>
            <p className="mt-3 text-sm leading-6 text-primary-foreground/80">
              Fale conosco para conhecer os recursos, avaliar a implantação e
              entender as condições para adquirir o sistema.
            </p>
          </div>
          <Button
            asChild
            size="lg"
            className="shrink-0 bg-white text-primary hover:bg-white/90"
          >
            <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" /> Solicitar pelo WhatsApp
              <ArrowRight className="size-4" />
            </a>
          </Button>
        </div>
      </section>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        InfoSolutions Planning · ISP
      </footer>
    </main>
  );
}
