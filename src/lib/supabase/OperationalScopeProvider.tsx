import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";

type OperationalUnit = {
  id: string;
  name: string;
  code: string;
  company_id: string;
};
type ScopeState = {
  unitId: string | null;
  units: OperationalUnit[];
  canChooseUnit: boolean;
  setUnitId: (id: string) => void;
  loading: boolean;
};
const ScopeContext = createContext<ScopeState | null>(null);

/** Resolve a unidade ativa que limita consultas e movimentações operacionais. */
export function OperationalScopeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { client, profile } = useAuth();
  const [chosenUnitId, setChosenUnitId] = useState<string | null>(null);
  const unitsQuery = useQuery({
    // Lista somente unidades ativas da empresa já validada no perfil.
    queryKey: ["operational-units", profile?.company_id],
    queryFn: async () => {
      if (!client || !profile) return [];
      const { data, error } = await client
        .from("units")
        .select("id, name, code, company_id")
        .eq("company_id", profile.company_id)
        .eq("status", "active")
        .order("name")
        .limit(100);
      if (error) throw error;
      return data as OperationalUnit[];
    },
    enabled: Boolean(client && profile),
  });
  const units = useMemo(() => unitsQuery.data ?? [], [unitsQuery.data]);
  const accessQuery = useQuery({
    queryKey: ["profile-unit-access", profile?.user_id, profile?.company_id],
    queryFn: async () => {
      if (!client || !profile) return [];
      const { data, error } = await client
        .from("profile_unit_access")
        .select("unit_id")
        .eq("user_id", profile.user_id)
        .eq("company_id", profile.company_id);
      if (error) throw error;
      return data.map((row) => row.unit_id);
    },
    enabled: Boolean(client && profile && profile.unit_id !== null),
  });
  const allowedUnitIds = useMemo(
    () =>
      profile?.unit_id === null
        ? units.map((unit) => unit.id)
        : [...new Set([profile?.unit_id, ...(accessQuery.data ?? [])])].filter(
            (id): id is string => typeof id === "string",
          ),
    [profile?.unit_id, units, accessQuery.data],
  );
  const availableUnits = useMemo(
    () => units.filter((unit) => allowedUnitIds.includes(unit.id)),
    [units, allowedUnitIds],
  );
  const canChooseUnit = Boolean(profile && availableUnits.length > 1);
  const unitId =
    profile?.unit_id === null
      ? (availableUnits.find((unit) => unit.id === chosenUnitId)?.id ??
        availableUnits[0]?.id ??
        null)
      : (availableUnits.find((unit) => unit.id === chosenUnitId)?.id ??
        availableUnits[0]?.id ??
        profile?.unit_id ??
        null);

  useEffect(() => {
    // Contas globais recebem uma unidade ativa automaticamente, inclusive
    // quando a empresa possui somente uma unidade e o seletor não aparece.
    if (!profile || profile.unit_id !== null || availableUnits.length === 0)
      return;
    const stored = window.localStorage.getItem(
      `isp.unit.${profile.company_id}`,
    );
    const validStored = availableUnits.some((unit) => unit.id === stored);
    const validChosen = availableUnits.some((unit) => unit.id === chosenUnitId);
    if (!validChosen) {
      const next = validStored ? stored : availableUnits[0]?.id;
      if (next) setChosenUnitId(next);
    }
  }, [profile, availableUnits, chosenUnitId]);

  const setUnitId = useCallback(
    (id: string) => {
      // Impede escolher unidade fora da lista liberada para a empresa.
      if (!canChooseUnit || !availableUnits.some((unit) => unit.id === id))
        return;
      setChosenUnitId(id);
      if (profile)
        window.localStorage.setItem(`isp.unit.${profile.company_id}`, id);
    },
    [canChooseUnit, availableUnits, profile],
  );
  const value = useMemo(
    () => ({
      unitId,
      units: availableUnits,
      canChooseUnit,
      setUnitId,
      loading: unitsQuery.isLoading || accessQuery.isLoading,
    }),
    [
      unitId,
      availableUnits,
      canChooseUnit,
      setUnitId,
      unitsQuery.isLoading,
      accessQuery.isLoading,
    ],
  );
  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}

export function useOperationalScope() {
  const state = useContext(ScopeContext);
  if (!state)
    throw new Error(
      "useOperationalScope deve ser usado dentro de OperationalScopeProvider.",
    );
  return state;
}
