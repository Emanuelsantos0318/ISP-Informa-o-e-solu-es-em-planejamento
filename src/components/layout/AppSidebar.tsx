import { Link, useRouterState } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";

const GROUPS: { id: NavItem["group"]; label: string }[] = [
  { id: "operacao", label: "Operação" },
  { id: "administracao", label: "Administração" },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const { profile } = useAuth();
  const scope = useOperationalScope();
  const activeUnit = scope.units.find((unit) => unit.id === scope.unitId);
  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      (item.to !== "/" || profile?.role !== "operator") &&
      (!item.superAdminOnly || profile?.role === "super_admin") &&
      (!item.operatorOnly || profile?.role === "operator"),
  );
  const homePath = profile?.role === "operator" ? "/saida" : "/";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
        <Link
          to={homePath}
          className="flex items-center gap-2.5 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          onClick={() => isMobile && setOpenMobile(false)}
        >
          <img
            src="/isp-logo.png"
            alt="InfoSolutions Planning"
            className="size-10 shrink-0 object-contain group-data-[collapsible=icon]:size-8"
            width={40}
            height={40}
          />
          <span className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-[15px] font-semibold tracking-tight text-sidebar-accent-foreground">
              ISP
            </span>
            <span className="text-[11px] text-sidebar-muted">
              Gestão de Estoque
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="pt-2">
        {GROUPS.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel className="text-[10.5px] uppercase tracking-[0.08em] text-sidebar-muted">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleItems
                  .filter((i) => i.group === group.id)
                  .map((item) => {
                    const active =
                      item.to === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.to);
                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                          className="h-9 data-[active=true]:font-medium data-[active=true]:shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                        >
                          <Link
                            to={item.to}
                            onClick={() => isMobile && setOpenMobile(false)}
                          >
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          <p className="text-xs font-semibold text-sidebar-accent-foreground">
            ISP — Gestão de Estoque
          </p>
          <p className="text-[11px] text-sidebar-muted">
            Unidade: {activeUnit?.name ?? "Sem unidade selecionada"}
          </p>
        </div>
        <div
          className="hidden text-center text-[10px] font-semibold text-sidebar-muted group-data-[collapsible=icon]:block"
          title={`ISP · ${activeUnit?.name ?? "Sem unidade"}`}
        >
          ISP
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
