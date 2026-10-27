import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, CalendarDays, LogOut, UserRound } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateLong } from "@/lib/datetime";
import { titleForPath } from "@/lib/navigation";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function useToday() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(formatDateLong());
    const id = setInterval(() => setLabel(formatDateLong()), 60_000);
    return () => clearInterval(id);
  }, []);
  return label;
}

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const today = useToday();
  const { client, profile } = useAuth();
  const scope = useOperationalScope();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur md:px-6">
      <SidebarTrigger
        className="-ml-1 text-muted-foreground"
        aria-label="Recolher ou expandir menu"
      />
      <Separator orientation="vertical" className="h-5" />
      <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">
        {titleForPath(pathname)}
      </h1>
      <div className="ml-auto flex items-center gap-1.5 md:gap-3">
        <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
          <CalendarDays className="size-4" />
          <span className="tabular">{today ?? "\u00a0"}</span>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Alertas de estoque">
              <Bell className="size-4.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-semibold">Alertas</p>
              <p className="text-xs text-muted-foreground">
                Estoque crítico e validade
              </p>
            </div>
            <div className="px-4 py-6 text-center">
              <p className="text-sm font-medium">Nenhum alerta carregado</p>
              <p className="mt-1 text-xs text-muted-foreground">
                A central de alertas será conectada aos dados do estoque.
              </p>
            </div>
            <div className="border-t p-2">
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link to="/notificacoes">Ver central de notificações</Link>
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {scope.canChooseUnit && (
          <Select
            value={scope.unitId ?? ""}
            onValueChange={scope.setUnitId}
            disabled={scope.loading || scope.units.length === 0}
          >
            <SelectTrigger className="h-9 w-36 sm:w-48">
              <SelectValue
                placeholder={
                  scope.loading ? "Carregando unidade…" : "Selecione unidade"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {scope.units.map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  {unit.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex h-10 gap-2 px-2">
              <ProfileAvatar className="size-7" />
              <span className="hidden max-w-40 truncate text-sm sm:inline">
                {profile?.full_name}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <span className="block truncate">{profile?.full_name}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {profile?.role}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/perfil">
                <UserRound /> Meu perfil
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void client?.auth.signOut()}>
              <LogOut /> Sair do sistema
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
