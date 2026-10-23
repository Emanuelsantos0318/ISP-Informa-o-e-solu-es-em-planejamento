import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { useOperationalScope } from "./OperationalScopeProvider";
import { listCategories, listProducts, listSuppliers } from "./catalog";

export function useCatalog({
  includeInactiveProducts = false,
}: {
  includeInactiveProducts?: boolean | undefined;
} = {}) {
  const { client, profile } = useAuth();
  const companyId = profile?.company_id;
  const { unitId } = useOperationalScope();
  const categories = useQuery({
    queryKey: ["categories", companyId],
    queryFn: () =>
      client && companyId
        ? listCategories(client, companyId)
        : Promise.resolve([]),
    enabled: Boolean(client && companyId),
  });
  const suppliers = useQuery({
    queryKey: ["suppliers", companyId],
    queryFn: () =>
      client && companyId
        ? listSuppliers(client, companyId)
        : Promise.resolve([]),
    enabled: Boolean(client && companyId),
  });
  const products = useQuery({
    queryKey: ["products", companyId, unitId, includeInactiveProducts],
    queryFn: () =>
      client && companyId && unitId
        ? listProducts(client, companyId, unitId, includeInactiveProducts)
        : Promise.resolve([]),
    enabled: Boolean(client && companyId && unitId),
  });
  return { categories, suppliers, products, hasUnitScope: Boolean(unitId) };
}
