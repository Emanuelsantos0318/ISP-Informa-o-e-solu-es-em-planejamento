import { createFileRoute } from "@tanstack/react-router";
import { ReportsWorkspace } from "@/components/reports/ReportsWorkspace";

export const Route = createFileRoute("/relatorios/$categoria")({
  head: () => ({ meta: [{ title: "Relatório gerencial · ISP" }] }),
  component: ReportCategoryPage,
});

function ReportCategoryPage() {
  const { categoria } = Route.useParams();
  return <ReportsWorkspace category={categoria} />;
}
