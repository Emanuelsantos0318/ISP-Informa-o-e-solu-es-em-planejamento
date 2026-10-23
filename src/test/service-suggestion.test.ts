import { describe, expect, it } from "vitest";
import {
  applySuggestion,
  selectServiceManually,
  suggestServiceForTime,
  validateServiceSelection,
} from "@/lib/rules/service-suggestion";

describe("suggestServiceForTime", () => {
  it("suggests Desjejum between 03:00 and 05:00", () => {
    expect(suggestServiceForTime("03:00")).toMatchObject({
      kind: "single",
      service: "desjejum",
    });
    expect(suggestServiceForTime("05:00")).toMatchObject({
      kind: "single",
      service: "desjejum",
    });
  });

  it("suggests Almoço between 05:10 and 13:30", () => {
    expect(suggestServiceForTime("05:10")).toMatchObject({
      kind: "single",
      service: "almoco",
    });
    expect(suggestServiceForTime("13:30")).toMatchObject({
      kind: "single",
      service: "almoco",
    });
  });

  it("does not auto-classify the Jantar range (13:50–18:00)", () => {
    expect(suggestServiceForTime("15:00").kind).toBe("pending");
  });

  it("offers a choice between Ceia completa and Ceia leve between 18:20 and 21:00", () => {
    const s = suggestServiceForTime("19:00");
    expect(s.kind).toBe("choice");
    if (s.kind === "choice")
      expect(s.services).toEqual(["ceia_completa", "ceia_leve"]);
  });

  it("requires manual selection outside the ranges", () => {
    expect(suggestServiceForTime("05:05").kind).toBe("none");
    expect(suggestServiceForTime("13:40").kind).toBe("none");
    expect(suggestServiceForTime("22:00").kind).toBe("none");
  });
});

describe("applySuggestion", () => {
  it("applies a single suggestion when there is no manual choice", () => {
    const r = applySuggestion(
      { value: null, manual: false },
      suggestServiceForTime("12:00"),
    );
    expect(r.selection.value).toBe("almoco");
  });

  it("clears the automatic value when moving into the Ceia choice range", () => {
    const r = applySuggestion(
      { value: "almoco", manual: false },
      suggestServiceForTime("19:00"),
    );
    expect(r.selection.value).toBeNull();
  });

  it("never overrides a manual choice and returns the new suggestion as alternative", () => {
    const manual = selectServiceManually("lanche");
    const r = applySuggestion(manual, suggestServiceForTime("04:00"));
    expect(r.selection.value).toBe("lanche");
    expect(r.alternatives).toEqual(["desjejum"]);
  });
});

describe("validateServiceSelection", () => {
  it("rejects an empty or unknown service", () => {
    expect(validateServiceSelection(null)).not.toBeNull();
    expect(validateServiceSelection("jantar")).not.toBeNull();
    expect(validateServiceSelection("ceia_leve")).toBeNull();
  });
});
