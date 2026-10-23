import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { loadOperationalSettings } from "./operational-settings";

export function useOperationalSettings() {
  const { client, profile } = useAuth();
  const companyId = profile?.company_id;
  return useQuery({
    queryKey: ["operational-settings", companyId],
    queryFn: () =>
      client && companyId
        ? loadOperationalSettings(client, companyId)
        : Promise.reject(new Error("Sessão indisponível.")),
    enabled: Boolean(client && companyId),
  });
}
