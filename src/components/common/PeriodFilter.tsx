import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  PERIOD_PRESETS,
  getPeriodRange,
  formatIsoDate,
  type PeriodPreset,
} from "@/lib/datetime";

export type PeriodValue = { preset: PeriodPreset; from: string; to: string };

export function PeriodFilter({
  value,
  onChange,
}: {
  value: PeriodValue;
  onChange: (v: PeriodValue) => void;
}) {
  const range = getPeriodRange(value.preset, new Date(), {
    from: value.from,
    to: value.to,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        value={value.preset}
        onValueChange={(v) =>
          v && onChange({ ...value, preset: v as PeriodPreset })
        }
        className="flex-wrap justify-start rounded-md border bg-card p-0.5"
      >
        {PERIOD_PRESETS.map((p) => (
          <ToggleGroupItem
            key={p.value}
            value={p.value}
            className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {value.preset === "personalizado" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="Data inicial"
            className="h-9 w-[150px]"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">até</span>
          <Input
            type="date"
            aria-label="Data final"
            className="h-9 w-[150px]"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}
      <span className="text-xs text-muted-foreground tabular">
        {range
          ? range.from === range.to
            ? formatIsoDate(range.from)
            : `${formatIsoDate(range.from)} – ${formatIsoDate(range.to)}`
          : "Informe um período válido"}
      </span>
    </div>
  );
}
