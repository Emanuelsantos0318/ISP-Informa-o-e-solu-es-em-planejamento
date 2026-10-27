import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/common/Field";
import { PageIntro, Panel } from "@/components/common/Panel";
import { BackendNotice } from "@/components/common/BackendNotice";
import {
  EXIT_TYPES,
  SERVICE_OPTIONS,
  serviceLabel,
} from "@/lib/config/services";
import { DEFAULT_STOCK_SETTINGS, type StockSettings } from "@/lib/rules/stock";
import { UNITS } from "@/lib/config/units";
import { OPERATIONAL_TZ } from "@/lib/datetime";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { saveCompanyStockSettings } from "@/lib/supabase/stock-settings";
import { useStockSettings } from "@/lib/supabase/useStockSettings";
import { useOperationalSettings } from "@/lib/supabase/useOperationalSettings";
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  saveOperationalSettings,
  type OperationalSettings,
} from "@/lib/supabase/operational-settings";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações · ISP — Gestão de Estoque" },
      {
        name: "description",
        content:
          "Regras de serviço por horário, limites de estoque e unidades de medida.",
      },
      {
        property: "og:title",
        content: "Configurações · ISP — Gestão de Estoque",
      },
      {
        property: "og:description",
        content:
          "Regras de serviço por horário, limites de estoque e unidades de medida.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

type SettingsForm = {
  criticalPercent: string;
  expiryWarningDays: string;
  minHistoryDays: string;
};

const defaults: SettingsForm = {
  criticalPercent: String(DEFAULT_STOCK_SETTINGS.criticalRatio * 100),
  expiryWarningDays: String(DEFAULT_STOCK_SETTINGS.expiryWarningDays),
  minHistoryDays: String(DEFAULT_STOCK_SETTINGS.minHistoryDays),
};

function SettingsPage() {
  const { client, profile } = useAuth();
  const scope = useOperationalScope();
  const activeUnit = scope.units.find((unit) => unit.id === scope.unitId);
  const queryClient = useQueryClient();
  const settingsQuery = useStockSettings();
  const operationalQuery = useOperationalSettings();
  const settings = settingsQuery.data ?? DEFAULT_STOCK_SETTINGS;
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "stock_manager" ||
    profile?.role === "super_admin";
  const canEditOperational =
    profile?.role === "admin" || profile?.role === "super_admin";
  const [form, setForm] = useState<SettingsForm>(defaults);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [operationalForm, setOperationalForm] = useState<OperationalSettings>(
    DEFAULT_OPERATIONAL_SETTINGS,
  );
  const [operationalSaving, setOperationalSaving] = useState(false);
  const [operationalMessage, setOperationalMessage] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!settingsQuery.isSuccess) return;
    const saved = settingsQuery.data ?? DEFAULT_STOCK_SETTINGS;
    setForm({
      criticalPercent: String(saved.criticalRatio * 100),
      expiryWarningDays: String(saved.expiryWarningDays),
      minHistoryDays: String(saved.minHistoryDays),
    });
  }, [settingsQuery.data, settingsQuery.isSuccess]);

  useEffect(() => {
    if (operationalQuery.data) setOperationalForm(operationalQuery.data);
  }, [operationalQuery.data]);

  const saveOperational = async () => {
    if (
      !client ||
      !profile ||
      (profile.role !== "admin" && profile.role !== "super_admin")
    )
      return;
    const clock = (value: string) =>
      /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
        ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
        : null;
    if (
      [
        ...Object.values(operationalForm.serviceLabels),
        ...Object.values(operationalForm.exitTypeLabels),
      ].some((label) => !label.trim())
    ) {
      setOperationalMessage("Preencha todos os nomes antes de salvar.");
      return;
    }
    const ranges = operationalForm.serviceTimeRules.map((rule) => ({
      start: clock(rule.start),
      end: clock(rule.end),
    }));
    if (
      ranges.some(
        (range) =>
          range.start === null || range.end === null || range.start > range.end,
      ) ||
      ranges.some((a, i) =>
        ranges
          .slice(i + 1)
          .some((b) => a.start! <= b.end! && b.start! <= a.end!),
      )
    ) {
      setOperationalMessage(
        "Informe horários válidos, sem faixas invertidas ou sobrepostas.",
      );
      return;
    }
    setOperationalSaving(true);
    setOperationalMessage(null);
    try {
      await saveOperationalSettings(
        client,
        profile.company_id,
        profile.user_id,
        operationalForm,
      );
      queryClient.setQueryData(
        ["operational-settings", profile.company_id],
        operationalForm,
      );
      setOperationalForm(operationalForm);
      setOperationalMessage("Configurações operacionais salvas.");
    } catch {
      setOperationalMessage(
        "Não foi possível salvar. Verifique a migração e sua permissão de administrador.",
      );
    } finally {
      setOperationalSaving(false);
    }
  };

  const updateForm = (key: keyof SettingsForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveSuccess(false);
    setSaveError(null);
  };

  const saveSettings = async () => {
    if (!client || !profile) {
      setSaveError("Sua sessão não está disponível para salvar configurações.");
      return;
    }
    const criticalPercent = Number(form.criticalPercent);
    const expiryWarningDays = Number(form.expiryWarningDays);
    const minHistoryDays = Number(form.minHistoryDays);
    if (
      !Number.isFinite(criticalPercent) ||
      criticalPercent < 0 ||
      criticalPercent > 100
    ) {
      setSaveError("O limite crítico deve estar entre 0% e 100%.");
      return;
    }
    if (
      !Number.isInteger(expiryWarningDays) ||
      expiryWarningDays < 0 ||
      expiryWarningDays > 365
    ) {
      setSaveError("O aviso de validade deve estar entre 0 e 365 dias.");
      return;
    }
    if (
      !Number.isInteger(minHistoryDays) ||
      minHistoryDays < 1 ||
      minHistoryDays > 365
    ) {
      setSaveError("O histórico mínimo deve estar entre 1 e 365 dias.");
      return;
    }

    const nextSettings: StockSettings = {
      criticalRatio: criticalPercent / 100,
      expiryWarningDays,
      minHistoryDays,
    };
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await saveCompanyStockSettings(client, {
        ...nextSettings,
        companyId: profile.company_id,
        userId: profile.user_id,
      });
      await queryClient.invalidateQueries({
        queryKey: ["stock-settings", profile.company_id],
      });
      setSaveSuccess(true);
    } catch {
      setSaveError(
        "Não foi possível salvar. Confirme sua permissão e a conexão com o Supabase.",
      );
    } finally {
      setSaving(false);
    }
  };

  const settingsUnavailable = settingsQuery.isLoading || settingsQuery.isError;

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Configurações"
        description="Parâmetros operacionais usados pelo ISP."
      />

      {settingsQuery.isLoading && (
        <BackendNotice>
          Carregando parâmetros salvos para a empresa.
        </BackendNotice>
      )}
      {settingsQuery.isError && (
        <BackendNotice>
          Não foi possível consultar as configurações no Supabase. Os padrões
          exibidos abaixo não podem ser editados enquanto a conexão falhar.
        </BackendNotice>
      )}
      {settingsQuery.isSuccess && !settingsQuery.data && (
        <BackendNotice>
          Esta empresa ainda usa os padrões do sistema. Salve os parâmetros
          abaixo para persistir configurações próprias.
        </BackendNotice>
      )}

      <Panel
        title="Parâmetros de estoque e validade"
        description="As alterações são salvas por empresa. Administradores e gestores de estoque podem editar."
        actions={
          <Button
            disabled={!canEdit || settingsUnavailable || saving}
            onClick={() => void saveSettings()}
          >
            {saving ? "Salvando…" : "Salvar configurações"}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Faixa crítica do estoque (%)"
            hint="Crítico quando o saldo está neste percentual ou abaixo do mínimo."
          >
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={form.criticalPercent}
              disabled={!canEdit || settingsUnavailable || saving}
              onChange={(event) =>
                updateForm("criticalPercent", event.target.value)
              }
            />
          </Field>
          <Field
            label="Aviso de vencimento (dias)"
            hint="Sinaliza lotes que vencem neste prazo ou antes."
          >
            <Input
              type="number"
              min={0}
              max={365}
              step={1}
              value={form.expiryWarningDays}
              disabled={!canEdit || settingsUnavailable || saving}
              onChange={(event) =>
                updateForm("expiryWarningDays", event.target.value)
              }
            />
          </Field>
          <Field
            label="Histórico mínimo para consumo (dias)"
            hint="Dias necessários antes de estimar consumo médio."
          >
            <Input
              type="number"
              min={1}
              max={365}
              step={1}
              value={form.minHistoryDays}
              disabled={!canEdit || settingsUnavailable || saving}
              onChange={(event) =>
                updateForm("minHistoryDays", event.target.value)
              }
            />
          </Field>
        </div>
        {!canEdit && (
          <p className="mt-4 text-xs text-muted-foreground">
            Seu perfil pode consultar os parâmetros, mas não alterá-los.
          </p>
        )}
        {saveError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {saveError}
          </p>
        )}
        {saveSuccess && (
          <p role="status" className="mt-4 text-sm text-success">
            Configurações salvas no Supabase.
          </p>
        )}
      </Panel>

      {operationalQuery.isError && (
        <BackendNotice>
          Não foi possível carregar as configurações operacionais. A edição fica
          bloqueada até restabelecer a conexão e aplicar a migração.
        </BackendNotice>
      )}
      {operationalQuery.isLoading && (
        <BackendNotice>
          Carregando configurações operacionais da empresa.
        </BackendNotice>
      )}
      <Panel
        title="Serviços e regras por horário"
        description="Administradores podem ajustar nomes e horários. Os códigos aceitos pelo banco permanecem fixos; faixas sem mapeamento continuam exigindo seleção manual."
        actions={
          <Button
            disabled={
              !canEditOperational ||
              operationalQuery.isLoading ||
              operationalQuery.isError ||
              operationalSaving
            }
            onClick={() => void saveOperational()}
          >
            {operationalSaving ? "Salvando…" : "Salvar regras operacionais"}
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {SERVICE_OPTIONS.map((service) => (
            <Field key={service.code} label={`Nome: ${service.code}`}>
              <Input
                value={
                  operationalForm.serviceLabels[service.code] ?? service.label
                }
                disabled={
                  !canEditOperational ||
                  operationalQuery.isLoading ||
                  operationalQuery.isError ||
                  operationalSaving
                }
                onChange={(event) =>
                  setOperationalForm((current) => ({
                    ...current,
                    serviceLabels: {
                      ...current.serviceLabels,
                      [service.code]: event.target.value,
                    },
                  }))
                }
              />
            </Field>
          ))}
          {EXIT_TYPES.map((type) => (
            <Field key={type.code} label={`Tipo de saída: ${type.code}`}>
              <Input
                value={operationalForm.exitTypeLabels[type.code] ?? type.label}
                disabled={
                  !canEditOperational ||
                  operationalQuery.isLoading ||
                  operationalQuery.isError ||
                  operationalSaving
                }
                onChange={(event) =>
                  setOperationalForm((current) => ({
                    ...current,
                    exitTypeLabels: {
                      ...current.exitTypeLabels,
                      [type.code]: event.target.value,
                    },
                  }))
                }
              />
            </Field>
          ))}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {operationalForm.serviceTimeRules.map((rule, index) => (
            <div
              key={rule.id}
              className="grid grid-cols-[1fr_1fr_1.2fr] items-end gap-2 rounded-md border p-3"
            >
              <Field label="Início">
                <Input
                  type="time"
                  value={rule.start}
                  disabled={
                    !canEditOperational ||
                    operationalQuery.isLoading ||
                    operationalQuery.isError ||
                    operationalSaving
                  }
                  onChange={(e) =>
                    setOperationalForm((current) => ({
                      ...current,
                      serviceTimeRules: current.serviceTimeRules.map(
                        (item, i) =>
                          i === index
                            ? { ...item, start: e.target.value }
                            : item,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="Fim">
                <Input
                  type="time"
                  value={rule.end}
                  disabled={
                    !canEditOperational ||
                    operationalQuery.isLoading ||
                    operationalQuery.isError ||
                    operationalSaving
                  }
                  onChange={(e) =>
                    setOperationalForm((current) => ({
                      ...current,
                      serviceTimeRules: current.serviceTimeRules.map(
                        (item, i) =>
                          i === index ? { ...item, end: e.target.value } : item,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="Faixa">
                <Input
                  value={rule.label}
                  disabled={
                    !canEditOperational ||
                    operationalQuery.isLoading ||
                    operationalQuery.isError ||
                    operationalSaving
                  }
                  onChange={(e) =>
                    setOperationalForm((current) => ({
                      ...current,
                      serviceTimeRules: current.serviceTimeRules.map(
                        (item, i) =>
                          i === index
                            ? { ...item, label: e.target.value }
                            : item,
                      ),
                    }))
                  }
                />
              </Field>
              <p className="col-span-3 text-xs text-muted-foreground">
                {rule.kind === "pending"
                  ? "Seleção manual obrigatória; sem associação automática."
                  : rule.kind === "single"
                    ? `Sugere ${operationalForm.serviceLabels[rule.service] ?? serviceLabel(rule.service)}.`
                    : `Escolha entre ${rule.services.map((code) => operationalForm.serviceLabels[code] ?? serviceLabel(code)).join(" ou ")}.`}
              </p>
              {rule.id === "jantar" && (
                <div className="col-span-3 grid gap-2 sm:grid-cols-2">
                  <Field label="Mapeamento da faixa">
                    <Select
                      value={rule.kind}
                      disabled={
                        !canEditOperational ||
                        operationalQuery.isLoading ||
                        operationalQuery.isError ||
                        operationalSaving
                      }
                      onValueChange={(value) =>
                        setOperationalForm((current) => ({
                          ...current,
                          serviceTimeRules: current.serviceTimeRules.map(
                            (item, i) =>
                              i !== index
                                ? item
                                : value === "pending"
                                  ? {
                                      id: item.id,
                                      start: item.start,
                                      end: item.end,
                                      label: item.label,
                                      kind: "pending",
                                      note: "Seleção manual definida pelo administrador.",
                                    }
                                  : value === "single"
                                    ? {
                                        id: item.id,
                                        start: item.start,
                                        end: item.end,
                                        label: item.label,
                                        kind: "single",
                                        service: "almoco",
                                      }
                                    : {
                                        id: item.id,
                                        start: item.start,
                                        end: item.end,
                                        label: item.label,
                                        kind: "choice",
                                        services: [
                                          "ceia_completa",
                                          "ceia_leve",
                                        ],
                                      },
                          ),
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Manual</SelectItem>
                        <SelectItem value="single">
                          Sugerir um serviço
                        </SelectItem>
                        <SelectItem value="choice">
                          Escolher entre dois serviços
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {rule.kind === "single" && (
                    <Field label="Serviço sugerido">
                      <Select
                        value={rule.service}
                        disabled={
                          !canEditOperational ||
                          operationalQuery.isLoading ||
                          operationalQuery.isError ||
                          operationalSaving
                        }
                        onValueChange={(value) =>
                          setOperationalForm((current) => ({
                            ...current,
                            serviceTimeRules: current.serviceTimeRules.map(
                              (item, i) =>
                                i === index && item.kind === "single"
                                  ? {
                                      ...item,
                                      service: value as typeof item.service,
                                    }
                                  : item,
                            ),
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SERVICE_OPTIONS.map((service) => (
                            <SelectItem key={service.code} value={service.code}>
                              {operationalForm.serviceLabels[service.code] ??
                                service.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                  {rule.kind === "choice" && (
                    <p className="self-end text-xs text-muted-foreground">
                      Opções fixas: ceia completa ou ceia leve.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {operationalMessage && (
          <p role="status" className="mt-4 text-sm">
            {operationalMessage}
          </p>
        )}
        {!canEditOperational && (
          <p className="mt-4 text-xs text-muted-foreground">
            Somente administradores podem alterar essas regras.
          </p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Unidade operacional" className="lg:col-span-1">
          <dl className="grid gap-3 text-sm">
            <Row
              label="Unidade"
              value={activeUnit?.name ?? "Sem unidade selecionada"}
            />
            <Row label="Fuso horário" value={`${OPERATIONAL_TZ} (UTC−3)`} />
            <Row label="Formato" value="dd/mm/aaaa · 24h" />
          </dl>
        </Panel>

        <Panel
          title="Sugestão de serviço por horário"
          className="lg:col-span-2"
          bodyClassName="p-0"
        >
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">Horário</th>
                <th className="px-5 py-2.5 text-left font-medium">Faixa</th>
                <th className="px-5 py-2.5 text-left font-medium">
                  Comportamento
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {operationalForm.serviceTimeRules.map((rule) => (
                <tr key={rule.id}>
                  <td className="whitespace-nowrap px-5 py-3 font-mono text-xs tabular">
                    {rule.start}–{rule.end}
                  </td>
                  <td className="px-5 py-3 font-medium">{rule.label}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {rule.kind === "single" && (
                      <>
                        Sugere{" "}
                        <strong className="text-foreground">
                          {operationalForm.serviceLabels[rule.service] ??
                            serviceLabel(rule.service)}
                        </strong>
                      </>
                    )}
                    {rule.kind === "choice" && (
                      <>
                        Usuário escolhe:{" "}
                        {rule.services
                          .map(
                            (code) =>
                              operationalForm.serviceLabels[code] ??
                              serviceLabel(code),
                          )
                          .join(" ou ")}
                      </>
                    )}
                    {rule.kind === "pending" && (
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="border-warning/50 bg-warning-soft text-warning-foreground"
                        >
                          Pendente
                        </Badge>
                        Seleção manual até aprovação do mapeamento.
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-5 py-3 font-mono text-xs">Demais horários</td>
                <td className="px-5 py-3 font-medium">—</td>
                <td className="px-5 py-3 text-muted-foreground">
                  Seleção manual obrigatória
                </td>
              </tr>
            </tbody>
          </table>
          <BackendNotice className="m-4">
            Esta tabela acompanha as regras salvas no painel acima e também é
            usada ao registrar uma saída. Faixas sem mapeamento pedem seleção
            manual.
          </BackendNotice>
        </Panel>

        <Panel title="Serviços de destino">
          <div className="flex flex-wrap gap-2">
            {SERVICE_OPTIONS.map((service) => (
              <Badge key={service.code} variant="secondary">
                {operationalForm.serviceLabels[service.code] ?? service.label}
              </Badge>
            ))}
          </div>
          <p className="mt-4 text-xs font-medium text-muted-foreground">
            Tipos de saída
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXIT_TYPES.map((type) => (
              <Badge key={type.code} variant="outline">
                {operationalForm.exitTypeLabels[type.code] ?? type.label}
              </Badge>
            ))}
          </div>
        </Panel>

        <Panel title="Regras de estoque e validade">
          <dl className="grid gap-3 text-sm">
            <Row
              label="Estoque crítico"
              value={`Saldo ≤ ${settings.criticalRatio * 100}% do mínimo`}
            />
            <Row label="Estoque baixo" value="Saldo abaixo do mínimo" />
            <Row
              label="Próximo do vencimento"
              value={`Até ${settings.expiryWarningDays} dias`}
            />
            <Row
              label="Histórico mínimo p/ consumo"
              value={`${settings.minHistoryDays} dias`}
            />
          </dl>
        </Panel>

        <Panel title="Unidades de medida">
          <ul className="grid gap-2 text-sm">
            {UNITS.map((unit) => (
              <li key={unit.code} className="flex justify-between">
                <span>{unit.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {unit.short}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Saldos de unidades diferentes nunca são somados.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
