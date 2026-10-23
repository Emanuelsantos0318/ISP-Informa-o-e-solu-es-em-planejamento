import type { LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconVariants = cva("flex size-9 items-center justify-center rounded-md", {
  variants: {
    tone: {
      primary: "bg-primary-soft text-primary",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning-foreground",
      danger: "bg-destructive-soft text-destructive",
    },
  },
  defaultVariants: { tone: "primary" },
});

export function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  /** null = no data available yet */
  value: number | string | null;
  unit: string;
  icon: LucideIcon;
  hint?: string | undefined;
} & VariantProps<typeof iconVariants>) {
  return (
    <div className="surface flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium leading-snug text-muted-foreground">
          {label}
        </p>
        <span className={cn(iconVariants({ tone }))}>
          <Icon className="size-4.5" />
        </span>
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-tight tabular">
          {value === null ? (
            <span className="text-muted-foreground/60">—</span>
          ) : (
            value
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {value === null ? "Sem dados" : unit}
        </p>
      </div>
      {hint && (
        <p className="border-t pt-2.5 text-[11.5px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
