import { describe, expect, it } from "vitest";
import { operationalDateTimeToIso } from "@/lib/datetime";

describe("operationalDateTimeToIso", () => {
  it("converts America/Bahia wall time to the matching UTC instant", () => {
    expect(operationalDateTimeToIso("2026-10-22", "12:34")).toBe(
      "2026-10-22T15:34:00.000Z",
    );
  });

  it("rejects invalid dates and times", () => {
    expect(operationalDateTimeToIso("2026-02-30", "12:00")).toBeNull();
    expect(operationalDateTimeToIso("2026-10-22", "24:00")).toBeNull();
  });
});
