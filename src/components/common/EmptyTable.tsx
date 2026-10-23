import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

/** Table header with an empty state — columns stay visible so the structure is clear. */
export function EmptyTable({
  columns,
  icon,
  title,
  description,
  action,
}: {
  columns: { label: string; align?: "left" | "right" }[];
  icon: LucideIcon;
  title: string;
  description?: string | undefined;
  action?: ReactNode | undefined;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c.label}
                className={`whitespace-nowrap px-4 py-2.5 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={columns.length}>
              <EmptyState
                icon={icon}
                title={title}
                description={description}
                action={action}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
