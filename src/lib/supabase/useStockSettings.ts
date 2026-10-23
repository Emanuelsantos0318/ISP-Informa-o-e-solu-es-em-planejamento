import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { loadCompanyStockSettings } from "./stock-settings";

export function useStockSettings() {
  const { client, profile } = useAuth();
  const companyId = profile?.company_id;
  return useQuery({
    queryKey: ["stock-settings", companyId],
    queryFn: () =>
      client && companyId
        ? loadCompanyStockSettings(client, companyId)
        : Promise.resolve(null),
    enabled: Boolean(client && companyId),
  });
}
