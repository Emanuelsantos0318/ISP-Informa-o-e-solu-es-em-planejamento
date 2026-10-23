import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Product } from "@/lib/types";
import { EntryDialog } from "./EntryDialog";
import { ExitDialog } from "./ExitDialog";

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
}: {
  size?: "default" | "lg";
  hideButtons?: boolean | undefined;
  request?: MovementRequest | null | undefined;
}) {
  const [entryOpen, setEntryOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [initialProduct, setInitialProduct] = useState<Product | undefined>();

  useEffect(() => {
    if (!request) return;
    setInitialProduct(request.product);
    if (request.type === "entry") setEntryOpen(true);
    else setExitOpen(true);
  }, [request]);

  return (
    <>
      {!hideButtons && (
        <>
          <Button
            variant="success"
            size={size}
            onClick={() => setEntryOpen(true)}
          >
            <ArrowDownToLine /> Nova entrada
          </Button>
          <Button size={size} onClick={() => setExitOpen(true)}>
            <ArrowUpFromLine /> Nova saída
          </Button>
        </>
      )}
      <EntryDialog
        open={entryOpen}
        onOpenChange={setEntryOpen}
        initialProduct={initialProduct}
      />
      <ExitDialog
        open={exitOpen}
        onOpenChange={setExitOpen}
        initialProduct={initialProduct}
      />
    </>
  );
}
