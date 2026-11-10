import { useQuery } from "@tanstack/react-query";
import { loadInventorySnapshot } from "./inventory";
import { useAuth } from "./AuthProvider";
import { useOperationalScope } from "./OperationalScopeProvider";

export function useInventorySnapshot({
  from,
  to,
  movementLimit,
}: {
  from?: string | undefined;
  to?: string | undefined;
  movementLimit?: number | undefined;
} = {}) {
  const { client, profile } = useAuth();
  const { unitId } = useOperationalScope();
  return useQuery({
    queryKey: [
      "inventory-snapshot",
      profile?.company_id,
      unitId,
      from,
      to,
      movementLimit ?? "all-movements",
    ],
    queryFn: () => {
      if (!client || !profile || !unitId) {
        throw new Error("Selecione uma unidade para consultar o estoque.");
      }
      return loadInventorySnapshot(
        client,
        profile.company_id,
        unitId,
        from,
        to,
        movementLimit,
      );
    },
    enabled: Boolean(client && profile && unitId),
    staleTime: 30_000,
  });
}
