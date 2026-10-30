import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  CalendarDays,
  LogOut,
  UserRound,
} from "lucide-react";
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
import {
  formatDateLong,
  formatDateTime,
  nowInOperationalTz,
} from "@/lib/datetime";
import { titleForPath } from "@/lib/navigation";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import { useInventorySnapshot } from "@/lib/supabase/useInventorySnapshot";
import { useStockSettings } from "@/lib/supabase/useStockSettings";
import {
  classifyExpiry,
  classifyStock,
  DEFAULT_STOCK_SETTINGS,
} from "@/lib/rules/stock";
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
  const inventory = useInventorySnapshot();
  const stockSettings = useStockSettings();
  const settings = stockSettings.data ?? DEFAULT_STOCK_SETTINGS;
  const operationalToday = nowInOperationalTz().date;
  const activeStockAlerts = inventory.data
    ? inventory.data.products.filter((product) => {
        if (!product.active) return false;
        return ["sem_saldo", "critico", "baixo"].includes(
          classifyStock(
            { balance: product.balance, min: product.minimum, max: product.target },
            settings,
          ),
        );
      }).length +
      inventory.data.lots.filter(
        (lot) =>
          lot.quantity > 0 &&
          Boolean(lot.expiresOn) &&
          classifyExpiry(lot.expiresOn!, operationalToday, settings) !== "valido",
      ).length +
      inventory.data.products.filter(
        (product) =>
          product.active && (!product.categoryId || !product.unit || !product.sku),
      ).length
    : 0;
  // O histórico de lotes é também a fonte persistente para atividade recente no sino.
  const recentMovements = (inventory.data?.movements ?? [])
    .filter((movement) => !movement.legacy)
    .slice(0, 4);

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
            <Button variant="ghost" size="icon" aria-label={`Alertas de estoque${activeStockAlerts ? `: ${activeStockAlerts}` : ""}`} className="relative">
              <Bell className="size-4.5" />
              {activeStockAlerts > 0 && (
                <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                  {activeStockAlerts > 9 ? "9+" : activeStockAlerts}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-semibold">Notificações</p>
              <p className="text-xs text-muted-foreground">
                Alertas de estoque e movimentações recentes
              </p>
            </div>
            <div className="border-b px-4 py-3">
              {inventory.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando notificações…</p>
              ) : inventory.isError ? (
                <p className="text-sm text-destructive">Não foi possível carregar os alertas desta unidade.</p>
              ) : activeStockAlerts > 0 ? (
                <Link to="/notificacoes" className="text-sm font-medium text-warning-foreground hover:underline">
                  {activeStockAlerts} alerta(s) de estoque ativo(s) · Ver detalhes
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum alerta de estoque ativo.</p>
              )}
            </div>
            <div className="px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Atividade recente
              </p>
              {recentMovements.length ? (
                <ul className="space-y-3">
                  {recentMovements.map((movement) => {
                    const isEntry = movement.type === "entry";
                    const firstItem = movement.items[0];
                    const otherItems = Math.max(0, movement.items.length - 1);
                    return (
                      <li key={movement.id} className="flex gap-2 text-sm">
                        <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${isEntry ? "bg-success-soft text-success" : "bg-warning-soft text-warning-foreground"}`}>
                          {isEntry ? <ArrowDownToLine className="size-3.5" /> : <ArrowUpFromLine className="size-3.5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {isEntry ? "Entrada registrada" : movement.type === "exit" ? "Saída registrada" : "Movimentação registrada"}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {firstItem
                              ? `${firstItem.name} · ${firstItem.quantity.toLocaleString("pt-BR")} ${firstItem.unit}${otherItems ? ` e mais ${otherItems} produto(s)` : ""}`
                              : `${movement.itemCount} produto(s)`}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatDateTime(movement.occurredAt)}
                            {movement.sourceReference ? ` · ${movement.sourceReference}` : ""}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma entrada ou saída recente.</p>
              )}
            </div>
            <div className="border-t p-2">
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link to="/movimentacoes">Ver todas as movimentações</Link>
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
            <Button
              variant="ghost"
              aria-label="Abrir menu do usuário"
              className={`flex h-10 gap-2 px-2 ${pathname === "/saida" ? "w-10 justify-center" : ""}`}
            >
              <ProfileAvatar className="size-7" />
              {pathname !== "/saida" && (
                <span className="hidden max-w-40 truncate text-sm sm:inline">
                  {profile?.full_name}
                </span>
              )}
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
