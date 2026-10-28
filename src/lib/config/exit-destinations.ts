export const EXIT_DESTINATIONS = [
  { code: "servidor", label: "Servidor" },
  { code: "paciente", label: "Paciente" },
  { code: "patissaria", label: "Patissaria" },
  { code: "lactario", label: "Lactário" },
  { code: "geral", label: "Geral" },
] as const;

export type ExitDestinationCode = (typeof EXIT_DESTINATIONS)[number]["code"];

export function exitDestinationLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return EXIT_DESTINATIONS.find((item) => item.code === code)?.label ?? code;
}
