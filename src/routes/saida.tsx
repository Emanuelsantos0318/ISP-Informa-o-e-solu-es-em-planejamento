import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpFromLine, ShieldAlert } from "lucide-react";
import { BackendNotice } from "@/components/common/BackendNotice";
import { PageIntro, Panel } from "@/components/common/Panel";
import { MovementActions } from "@/components/movements/MovementActions";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/supabase/AuthProvider";

export const Route = createFileRoute("/saida")({
  head: () => ({
    meta: [
      { title: "Registrar saída · ISP" },
      {
        name: "description",
        content: "Registre retiradas de produtos com um fluxo simples.",
      },
    ],
  }),
  component: OperatorExitPage,
});

function OperatorExitPage() {
  const { profile } = useAuth();
  if (profile?.role !== "operator") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <BackendNotice>
          Esta aba está disponível somente para operadores.
        </BackendNotice>
        <Button asChild variant="outline" className="self-start">
          <Link to="/">Voltar ao início</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageIntro
        title="Registrar saída"
        description="Pesquise ou leia o código de barras, informe a quantidade e confirme a retirada."
      />

      <Panel title="Saída de produtos">
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-md bg-primary-soft p-4">
            <ArrowUpFromLine className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="font-medium">Fluxo rápido</p>
              <p className="mt-1 text-muted-foreground">
                O sistema sugere o serviço pelo horário. Confira o serviço e o
                tipo de saída antes de gravar. O saldo é validado ao adicionar
                cada produto.
              </p>
            </div>
          </div>
          <MovementActions exitOnly simplifiedExit size="lg" />
        </div>
      </Panel>

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <p>
          Cada saída registra data, horário, operador, serviço, classificação e
          produtos para manter o histórico de auditoria.
        </p>
      </div>
    </div>
  );
}
