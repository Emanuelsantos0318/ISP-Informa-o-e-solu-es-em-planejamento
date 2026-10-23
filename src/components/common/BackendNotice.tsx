import { DatabaseZap } from "lucide-react";
import { cn } from "@/lib/utils";

/** Honest notice shown where saving/reading depends on the database (next phase). */
export function BackendNotice({
  children = "O banco de dados ainda não está conectado. Nada é gravado nesta etapa.",
  className,
}: {
  children?: React.ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5 text-xs text-warning-foreground",
        className,
      )}
    >
      <DatabaseZap className="mt-px size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
