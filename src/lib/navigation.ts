import {
  ArrowLeftRight,
  Bell,
  Building2,
  ClipboardList,
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
    | "/cadastro"
    | "/planejamento"
    | "/usuarios"
    | "/notificacoes"
    | "/configuracoes"
    | "/unidades";
  label: string;
  icon: LucideIcon;
  group: "operacao" | "administracao";
  superAdminOnly?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Início", icon: LayoutDashboard, group: "operacao" },
  {
    to: "/movimentacoes",
    label: "Movimentações",
    icon: ArrowLeftRight,
    group: "operacao",
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
  return NAV_ITEMS.find((i) => i.to === clean)?.label ?? "ISP";
}
