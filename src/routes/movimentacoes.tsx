import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { History, Search, X } from "lucide-react";
import { PageIntro, Panel } from "@/components/common/Panel";
import { EmptyTable } from "@/components/common/EmptyTable";
import { Field } from "@/components/common/Field";
import { BackendNotice } from "@/components/common/BackendNotice";
import { MovementActions } from "@/components/movements/MovementActions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EXIT_TYPES, SERVICE_OPTIONS } from "@/lib/config/services";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/supabase/operational-settings";

export const Route = createFileRoute("/movimentacoes")({
  head: () => ({
    meta: [
      { title: "Movimentações · ISP — Gestão de Estoque" },
      {
        name: "description",
        content: "Histórico de entradas e saídas com filtros e detalhamento.",
      },
      {
        property: "og:title",
        content: "Movimentações · ISP — Gestão de Estoque",
      },
      {
        property: "og:description",
        content: "Histórico de entradas e saídas com filtros e detalhamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MovementsPage,
});

const initial = {
  search: "",
  type: "todos",
  service: "todos",
  exitType: "todos",
  from: "",
  to: "",
};

function MovementsPage() {
  const operationalQuery = useOperationalSettings();
  const operational = operationalQuery.data ?? DEFAULT_OPERATIONAL_SETTINGS;
  const [f, setF] = useState(initial);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Movimentações"
        description="Entradas e saídas registradas, com rastreio de responsável e horário."
        actions={<MovementActions />}
      />

      <Panel
        title="Filtros"
        actions={
          dirty && (
            <Button variant="ghost" size="sm" onClick={() => setF(initial)}>
              <X /> Limpar filtros
            </Button>
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Pesquisa" className="lg:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Produto, código ou ID"
                value={f.search}
                onChange={(e) => setF({ ...f, search: e.target.value })}
              />
            </div>
          </Field>
          <Field label="Tipo">
            <Select
              value={f.type}
              onValueChange={(v) => setF({ ...f, type: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="entrada">Entrada</SelectItem>
                <SelectItem value="saida">Saída</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Serviço">
            <Select
              value={f.service}
              onValueChange={(v) => setF({ ...f, service: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {SERVICE_OPTIONS.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {operational.serviceLabels[s.code] ?? s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tipo de saída">
            <Select
              value={f.exitType}
              onValueChange={(v) => setF({ ...f, exitType: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {EXIT_TYPES.map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {operational.exitTypeLabels[t.code] ?? t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="De">
              <Input
                type="date"
                value={f.from}
                onChange={(e) => setF({ ...f, from: e.target.value })}
              />
            </Field>
            <Field label="Até">
              <Input
                type="date"
                value={f.to}
                onChange={(e) => setF({ ...f, to: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Panel>

      <BackendNotice>
        O histórico requer a migração de cabeçalho/itens. O esquema atual não
        guarda serviço, tipo operacional e data/hora informada no evento; os
        registros existentes continuam preservados no banco.
      </BackendNotice>

      <Panel title="Histórico" bodyClassName="p-0">
        <EmptyTable
          icon={History}
          title="Nenhuma movimentação encontrada"
          description="Use Nova entrada ou Nova saída para registrar a primeira movimentação."
          columns={[
            { label: "ID" },
            { label: "Tipo" },
            { label: "Data" },
            { label: "Horário" },
            { label: "Itens" },
            { label: "Quantidade", align: "right" },
            { label: "Responsável" },
            { label: "Serviço" },
            { label: "Classificação" },
            { label: "Observações" },
          ]}
        />
      </Panel>
    </div>
  );
}
