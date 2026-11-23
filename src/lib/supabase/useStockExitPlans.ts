import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { useOperationalScope } from "./OperationalScopeProvider";
import { listStockExitPlans } from "./stock-exit-plans";

export function useStockExitPlans({
  includeInactive = false,
}: {
  includeInactive?: boolean | undefined;
} = {}) {
  const { client, profile } = useAuth();
  const { unitId } = useOperationalScope();
  const companyId = profile?.company_id;
  return useQuery({
    queryKey: ["stock-exit-plans", companyId, unitId, includeInactive],
    queryFn: () =>
      client && companyId && unitId
        ? listStockExitPlans(client, companyId, unitId, includeInactive)
        : Promise.resolve([]),
    enabled: Boolean(client && companyId && unitId),
  });
}
