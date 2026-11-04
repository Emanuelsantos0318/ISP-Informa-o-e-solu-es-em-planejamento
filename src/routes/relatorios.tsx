import { createFileRoute } from "@tanstack/react-router";
import { ReportsWorkspace } from "@/components/reports/ReportsWorkspace";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Central de Relatórios · ISP" },
      {
        name: "description",
        content:
          "Relatórios gerenciais do estoque LBGS baseados nos dados registrados.",
      },
    ],
  }),
  component: () => <ReportsWorkspace />,
});
