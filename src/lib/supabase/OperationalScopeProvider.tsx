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
  const canChooseUnit = Boolean(profile && profile.unit_id === null);
  const unitId = profile?.unit_id ?? chosenUnitId;

  useEffect(() => {
    // Administradores sem unidade fixa recuperam a última unidade escolhida, se ainda válida.
    if (!profile || !canChooseUnit || units.length === 0) return;
    const stored = window.localStorage.getItem(
      `isp.unit.${profile.company_id}`,
    );
    const validStored = units.some((unit) => unit.id === stored);
    const validChosen = units.some((unit) => unit.id === chosenUnitId);
    if (!validChosen) {
      const next = validStored ? stored : units[0]?.id;
      if (next) setChosenUnitId(next);
    }
  }, [profile, canChooseUnit, units, chosenUnitId]);

  const setUnitId = useCallback(
    (id: string) => {
      // Impede escolher unidade fora da lista liberada para a empresa.
      if (!canChooseUnit || !units.some((unit) => unit.id === id)) return;
      setChosenUnitId(id);
      if (profile)
        window.localStorage.setItem(`isp.unit.${profile.company_id}`, id);
    },
    [canChooseUnit, units, profile],
  );
  const value = useMemo(
    () => ({
      unitId,
      units,
      canChooseUnit,
      setUnitId,
      loading: unitsQuery.isLoading,
    }),
    [unitId, units, canChooseUnit, setUnitId, unitsQuery.isLoading],
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
