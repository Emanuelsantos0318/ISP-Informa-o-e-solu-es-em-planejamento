import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Product } from "@/lib/types";
import { EntryDialog } from "./EntryDialog";
import { ExitDialog } from "./ExitDialog";
import { StockCorrectionDialog } from "./StockCorrectionDialog";
import { Scale } from "lucide-react";
import { useAuth } from "@/lib/supabase/AuthProvider";
import { useOperationalScope } from "@/lib/supabase/OperationalScopeProvider";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "@/lib/session-draft";

export type MovementRequest = {
  key: string;
  product: Product;
  type: "entry" | "exit";
};

/** Single owner for entry and exit dialogs across the app. */
export function MovementActions({
  size = "default",
  hideButtons = false,
  request,
  exitOnly = false,
  simplifiedExit = false,
}: {
  size?: "default" | "lg";
  hideButtons?: boolean | undefined;
  request?: MovementRequest | null | undefined;
  exitOnly?: boolean | undefined;
  simplifiedExit?: boolean | undefined;
}) {
  const [entryOpen, setEntryOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [initialProduct, setInitialProduct] = useState<Product | undefined>();
  const [draftRestored, setDraftRestored] = useState(false);
  const { profile } = useAuth();
  const { unitId } = useOperationalScope();
  const draftPrefix = `isp.movement-dialog.${profile?.user_id ?? "anonymous"}.${unitId ?? "no-unit"}`;
  const canCorrect =
    profile?.role === "operator" ||
    profile?.role === "admin" ||
    profile?.role === "stock_manager" ||
    profile?.role === "super_admin";

  useEffect(() => {
    if (!request) return;
    setInitialProduct(request.product);
    if (request.type === "entry") setEntryOpen(true);
    else setExitOpen(true);
  }, [request]);

  useEffect(() => {
    if (!profile?.user_id) {
      setDraftRestored(true);
      return;
    }
    // Reabre o modal interrompido ao retornar à rota, na mesma aba do navegador.
    const saved = readSessionDraft<{
      type?: "entry" | "exit" | "correction";
      product?: Product;
    }>(`${draftPrefix}.open`);
    if (saved?.type === "entry") {
      setInitialProduct(saved.product);
      setEntryOpen(true);
    } else if (saved?.type === "exit") {
      setInitialProduct(saved.product);
      setExitOpen(true);
    } else if (saved?.type === "correction") setCorrectionOpen(true);
    setDraftRestored(true);
  }, [draftPrefix, profile?.user_id]);

  useEffect(() => {
    if (!draftRestored || request) return;
    const type = entryOpen
      ? "entry"
      : exitOpen
        ? "exit"
        : correctionOpen
          ? "correction"
          : null;
    if (type)
      writeSessionDraft(`${draftPrefix}.open`, { type, product: initialProduct });
    else clearSessionDraft(`${draftPrefix}.open`);
  }, [correctionOpen, draftPrefix, draftRestored, entryOpen, exitOpen, initialProduct, request]);

  const closeEntry = (open: boolean) => {
    setEntryOpen(open);
    if (!open) clearSessionDraft(`${draftPrefix}.entry`);
  };
  const closeExit = (open: boolean) => {
    setExitOpen(open);
    if (!open) clearSessionDraft(`${draftPrefix}.exit`);
  };
  const closeCorrection = (open: boolean) => {
    setCorrectionOpen(open);
    if (!open) clearSessionDraft(`${draftPrefix}.correction`);
  };

  return (
    <>
      {!hideButtons && (
        <>
          {!exitOnly && (
            <Button
              variant="success"
              size={size}
              onClick={() => setEntryOpen(true)}
            >
              <ArrowDownToLine /> Nova entrada
            </Button>
          )}
          <Button size={size} onClick={() => setExitOpen(true)}>
            <ArrowUpFromLine /> Nova saída
          </Button>
          {canCorrect && (
            <Button
              variant="outline"
              size={size}
              onClick={() => setCorrectionOpen(true)}
            >
              <Scale />
              {profile?.role === "operator"
                ? "Ajustar quantidade"
                : "Ajuste / perda"}
            </Button>
          )}
        </>
      )}
      <EntryDialog
        open={entryOpen}
        onOpenChange={closeEntry}
        initialProduct={initialProduct}
        draftKey={`${draftPrefix}.entry`}
      />
      <ExitDialog
        open={exitOpen}
        onOpenChange={closeExit}
        initialProduct={initialProduct}
        simplified={simplifiedExit}
        draftKey={`${draftPrefix}.exit`}
      />
      <StockCorrectionDialog
        open={correctionOpen}
        onOpenChange={closeCorrection}
        draftKey={`${draftPrefix}.correction`}
      />
    </>
  );
}
