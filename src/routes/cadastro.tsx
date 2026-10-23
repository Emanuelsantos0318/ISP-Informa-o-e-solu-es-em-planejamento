import { useState } from "react";
import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  ChevronDown,
  FolderTree,
  Package,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { PageIntro, Panel } from "@/components/common/Panel";
import { EmptyTable } from "@/components/common/EmptyTable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryFormDialog } from "@/components/cadastro/CategoryFormDialog";
import { ProductFormDialog } from "@/components/cadastro/ProductFormDialog";
import { SupplierFormDialog } from "@/components/cadastro/SupplierFormDialog";
import { MovementActions } from "@/components/movements/MovementActions";
import type { MovementRequest } from "@/components/movements/MovementActions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BackendNotice } from "@/components/common/BackendNotice";
import { useCatalog } from "@/lib/supabase/useCatalog";
import type { CatalogProduct } from "@/lib/supabase/catalog";
import { unitShort } from "@/lib/config/units";

export const Route = createFileRoute("/cadastro")({
  head: () => ({
    meta: [
      { title: "Cadastro · ISP — Gestão de Estoque" },
      {
        name: "description",
        content: "Cadastro de categorias, produtos e fornecedores.",
      },
      { property: "og:title", content: "Cadastro · ISP — Gestão de Estoque" },
      {
        property: "og:description",
        content: "Cadastro de categorias, produtos e fornecedores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CadastroPage,
});

type Section = "produtos" | "categorias" | "fornecedores";

function CadastroPage() {
  const [tab, setTab] = useState<Section>("produtos");
  const [open, setOpen] = useState<Section | null>(null);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(
    null,
  );
  const [movementRequest, setMovementRequest] =
    useState<MovementRequest | null>(null);
  const catalog = useCatalog({ includeInactiveProducts: true });
  const productRows = (catalog.products.data ?? []).map((product) => ({
    id: product.id,
    active: product.status === "active",
    cells: [
      product.name,
      product.sku,
      product.barcode ?? "—",
      product.categoryName ?? "—",
      product.unit,
      `${product.balance} ${unitShort(product.unit)}`,
      String(product.minimumStock),
      product.desiredStock === null ? "—" : String(product.desiredStock),
      product.status === "active" ? "Ativo" : "Inativo",
    ],
    actions: (
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditingProduct(product)}
        >
          <Pencil /> Editar
        </Button>
        {product.status === "active" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                Ajustar estoque <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  setMovementRequest({
                    key: crypto.randomUUID(),
                    product,
                    type: "entry",
                  })
                }
              >
                <ArrowDownToLine /> Registrar entrada
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  setMovementRequest({
                    key: crypto.randomUUID(),
                    product,
                    type: "exit",
                  })
                }
              >
                <ArrowUpFromLine /> Registrar saída
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    ),
  }));
  const categoryRows = (catalog.categories.data ?? []).map((category) => ({
    id: category.id,
    active: category.status === "active",
    cells: [
      category.name,
      category.description ?? "—",
      "—",
      category.status === "active" ? "Ativa" : "Inativa",
    ],
  }));
  const supplierRows = (catalog.suppliers.data ?? []).map((supplier) => ({
    id: supplier.id,
    active: supplier.status === "active",
    cells: [
      supplier.name,
      "—",
      "—",
      supplier.contact_name ?? "—",
      supplier.phone ?? "—",
      supplier.email ?? "—",
      supplier.status === "active" ? "Ativo" : "Inativo",
    ],
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        title="Cadastro"
        description="Produtos, categorias e fornecedores. Itens usados no histórico são inativados, nunca excluídos."
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen("categorias")}>
              <FolderTree /> Nova categoria
            </Button>
            <Button variant="outline" onClick={() => setOpen("fornecedores")}>
              <Building2 /> Novo fornecedor
            </Button>
            <Button onClick={() => setOpen("produtos")}>
              <Plus /> Novo produto
            </Button>
          </>
        }
      />

      <BackendNotice>
        Listas e cadastros consultam o Supabase com sua sessão autenticada e
        respeitam as políticas RLS. Os campos que o esquema remoto ainda não
        suporta são recusados pelo formulário para evitar perda silenciosa.
      </BackendNotice>
      {!catalog.hasUnitScope && (
        <BackendNotice>
          Selecione uma unidade ativa no cabeçalho para consultar produtos e
          saldos.
        </BackendNotice>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Section)}>
        <TabsList>
          <TabsTrigger value="produtos">
            <Package className="size-4" /> Produtos
          </TabsTrigger>
          <TabsTrigger value="categorias">
            <FolderTree className="size-4" /> Categorias
          </TabsTrigger>
          <TabsTrigger value="fornecedores">
            <Building2 className="size-4" /> Fornecedores
          </TabsTrigger>
        </TabsList>

        <TabsContent value="produtos" className="mt-4">
          <ListPanel
            placeholder="Nome, código de barras ou categoria"
            onCreate={() => setOpen("produtos")}
            createLabel="Novo produto"
            icon={Package}
            emptyTitle="Nenhum produto cadastrado"
            rows={productRows}
            isLoading={catalog.products.isLoading}
            loadError={catalog.products.isError}
            columns={[
              "Produto",
              "SKU",
              "Código de barras",
              "Categoria",
              "Unidade",
              "Saldo",
              "Mín.",
              "Máx.",
              "Status",
            ]}
            hasActions
          />
        </TabsContent>
        <TabsContent value="categorias" className="mt-4">
          <ListPanel
            placeholder="Nome da categoria"
            onCreate={() => setOpen("categorias")}
            createLabel="Nova categoria"
            icon={FolderTree}
            emptyTitle="Nenhuma categoria cadastrada"
            rows={categoryRows}
            isLoading={catalog.categories.isLoading}
            loadError={catalog.categories.isError}
            columns={["Categoria", "Descrição", "Produtos", "Status"]}
          />
        </TabsContent>
        <TabsContent value="fornecedores" className="mt-4">
          <ListPanel
            placeholder="Nome, fantasia ou CNPJ"
            onCreate={() => setOpen("fornecedores")}
            createLabel="Novo fornecedor"
            icon={Building2}
            emptyTitle="Nenhum fornecedor cadastrado"
            rows={supplierRows}
            isLoading={catalog.suppliers.isLoading}
            loadError={catalog.suppliers.isError}
            columns={[
              "Razão social",
              "Nome fantasia",
              "CNPJ",
              "Contato",
              "Telefone",
              "E-mail",
              "Status",
            ]}
          />
        </TabsContent>
      </Tabs>

      <ProductFormDialog
        open={open === "produtos"}
        onOpenChange={(o) => !o && setOpen(null)}
      />
      <ProductFormDialog
        open={editingProduct !== null}
        onOpenChange={(o) => !o && setEditingProduct(null)}
        product={editingProduct ?? undefined}
      />
      <MovementActions hideButtons request={movementRequest} />
      <CategoryFormDialog
        open={open === "categorias"}
        onOpenChange={(o) => !o && setOpen(null)}
      />
      <SupplierFormDialog
        open={open === "fornecedores"}
        onOpenChange={(o) => !o && setOpen(null)}
      />
    </div>
  );
}

function ListPanel({
  placeholder,
  onCreate,
  createLabel,
  icon,
  emptyTitle,
  columns,
  rows,
  isLoading,
  loadError,
  hasActions,
}: {
  placeholder: string;
  onCreate: () => void;
  createLabel: string;
  icon: typeof Package;
  emptyTitle: string;
  columns: string[];
  rows: {
    id: string;
    active: boolean;
    cells: string[];
    actions?: ReactNode | undefined;
  }[];
  isLoading: boolean;
  loadError: boolean;
  hasActions?: boolean | undefined;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ativos");
  const visibleRows = rows.filter((row) => {
    const matchesStatus =
      status === "todos" || (status === "ativos" ? row.active : !row.active);
    return (
      matchesStatus &&
      row.cells
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(search.trim().toLocaleLowerCase("pt-BR"))
    );
  });
  return (
    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="inativos">Inativos</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loadError ? (
        <div role="alert" className="p-5 text-sm text-destructive">
          Não foi possível carregar dados permitidos para este perfil.
        </div>
      ) : isLoading ? (
        <div role="status" className="p-5 text-sm text-muted-foreground">
          Carregando registros…
        </div>
      ) : visibleRows.length === 0 ? (
        <EmptyTable
          icon={icon}
          title={emptyTitle}
          description={
            rows.length
              ? "Nenhum registro corresponde aos filtros."
              : "Os registros aparecerão aqui após serem salvos."
          }
          action={
            <Button size="sm" variant="outline" onClick={onCreate}>
              <Plus /> {createLabel}
            </Button>
          }
          columns={columns.map((label) => ({ label }))}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="px-4 py-3 font-medium">
                    {column}
                  </th>
                ))}
                {hasActions && (
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleRows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30">
                  {row.cells.map((cell, index) => (
                    <td key={`${row.id}-${index}`} className="px-4 py-3">
                      {cell}
                    </td>
                  ))}
                  {hasActions && <td className="px-4 py-3">{row.actions}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
