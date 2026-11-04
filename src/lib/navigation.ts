import {
  ArrowLeftRight,
  Bell,
  Building2,
  ClipboardList,
  FileBarChart2,
  LayoutDashboard,
  LineChart,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to:
    | "/"
    | "/movimentacoes"
    | "/saida"
    | "/cadastro"
    | "/planejamento"
    | "/relatorios"
    | "/usuarios"
    | "/notificacoes"
    | "/configuracoes"
    | "/unidades";
  label: string;
  icon: LucideIcon;
  group: "operacao" | "relatorios" | "administracao";
  superAdminOnly?: boolean;
  operatorOnly?: boolean;
};

// Menu, permissões de exibição e títulos das rotas ficam definidos em uma única lista.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Início", icon: LayoutDashboard, group: "operacao" },
  {
    to: "/movimentacoes",
    label: "Movimentações",
    icon: ArrowLeftRight,
    group: "operacao",
  },
  {
    to: "/saida",
    label: "Registrar saída",
    icon: ArrowLeftRight,
    group: "operacao",
    operatorOnly: true,
  },
  {
    to: "/cadastro",
    label: "Cadastro",
    icon: ClipboardList,
    group: "operacao",
  },
  {
    to: "/planejamento",
    label: "Planejamento",
    icon: LineChart,
    group: "operacao",
  },
  {
    to: "/relatorios",
    label: "Central de relatórios",
    icon: FileBarChart2,
    group: "relatorios",
  },
  { to: "/usuarios", label: "Usuários", icon: Users, group: "administracao" },
  {
    to: "/notificacoes",
    label: "Notificações",
    icon: Bell,
    group: "administracao",
  },
  {
    to: "/configuracoes",
    label: "Configurações",
    icon: Settings,
    group: "administracao",
  },
  {
    to: "/unidades",
    label: "Unidades",
    icon: Building2,
    group: "administracao",
    superAdminOnly: true,
  },
];

export function titleForPath(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean.startsWith("/relatorios/")) return "Central de relatórios";
  return NAV_ITEMS.find((i) => i.to === clean)?.label ?? "ISP";
}
