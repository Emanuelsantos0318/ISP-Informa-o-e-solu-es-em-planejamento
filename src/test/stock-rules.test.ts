import { describe, expect, it } from "vitest";
import {
  averageDailyConsumption,
  classifyExpiry,
  classifyStock,
  coverageDays,
  suggestReorder,
} from "@/lib/rules/stock";
import { getPeriodRange, nowInOperationalTz } from "@/lib/datetime";
import { isValidCnpj } from "@/lib/validation/cnpj";

describe("suggestReorder", () => {
  it("is max(0, target − balance) using max stock as target", () => {
    expect(suggestReorder({ balance: 30, max: 100 })).toBe(70);
    expect(suggestReorder({ balance: 120, max: 100 })).toBe(0);
  });
  it("prefers an explicit target over max stock", () => {
    expect(suggestReorder({ balance: 30, max: 100, target: 50 })).toBe(20);
  });
  it("cannot suggest without a target", () => {
    expect(suggestReorder({ balance: 30 })).toBeNull();
  });
});

describe("classifyStock", () => {
  it("classifies balance levels", () => {
    expect(classifyStock({ balance: 0, min: 10 })).toBe("sem_saldo");
    expect(classifyStock({ balance: 5, min: 10 })).toBe("critico");
    expect(classifyStock({ balance: 8, min: 10 })).toBe("baixo");
    expect(classifyStock({ balance: 50, min: 10, max: 40 })).toBe("acima");
    expect(classifyStock({ balance: 20, min: 10, max: 40 })).toBe("adequado");
  });
});

describe("consumption estimates", () => {
  it("returns null when history is insufficient", () => {
    expect(averageDailyConsumption(30, 3)).toBeNull();
    expect(coverageDays(10, null)).toBeNull();
  });
  it("computes average and coverage with enough history", () => {
    const avg = averageDailyConsumption(70, 7);
    expect(avg).toBe(10);
    expect(coverageDays(25, avg)).toBe(2.5);
  });
});

describe("classifyExpiry", () => {
  it("flags expired and near-expiry lots", () => {
    expect(classifyExpiry("2026-10-01", "2026-10-22")).toBe("vencido");
    expect(classifyExpiry("2026-11-10", "2026-10-22")).toBe("proximo");
    expect(classifyExpiry("2027-01-30", "2026-10-22")).toBe("valido");
  });
});

describe("America/Bahia dates", () => {
  it("uses UTC-3 for the operational date and time", () => {
    // 02:30 UTC on Oct 23 is 23:30 on Oct 22 in Bahia
    expect(nowInOperationalTz(new Date("2026-10-23T02:30:00Z"))).toEqual({
      date: "2026-10-22",
      time: "23:30",
    });
  });
  it("computes the last 7 days inclusive", () => {
    expect(getPeriodRange("7d", new Date("2026-10-22T15:00:00Z"))).toEqual({
      from: "2026-10-16",
      to: "2026-10-22",
    });
  });
});

describe("isValidCnpj", () => {
  it("validates check digits", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });
});
