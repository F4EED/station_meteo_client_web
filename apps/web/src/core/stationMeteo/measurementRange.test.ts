import { describe, expect, it } from "vitest";
import {
  estimatedCo2Ppm,
  estimatedIaqFromGas,
  resolveIaq,
} from "./measurementRange.ts";

describe("estimatedCo2Ppm", () => {
  it("maps IAQ 0 to ambient 400 ppm", () => {
    expect(estimatedCo2Ppm(0)).toBe(400);
  });

  it("maps IAQ 50 to 600 ppm", () => {
    expect(estimatedCo2Ppm(50)).toBe(600);
  });
});

describe("estimatedIaqFromGas", () => {
  it("returns undefined for missing or non-positive gas", () => {
    expect(estimatedIaqFromGas(0)).toBeUndefined();
    expect(estimatedIaqFromGas(-1)).toBeUndefined();
    expect(estimatedIaqFromGas(Number.NaN)).toBeUndefined();
  });

  it("scores cleaner-than-default air as 0", () => {
    // 400 kOhm > default 100 kOhm ceiling
    expect(estimatedIaqFromGas(400)).toBe(0);
  });

  it("raises IAQ when gas drops below the default ceiling", () => {
    const iaq = estimatedIaqFromGas(50, 40);
    expect(iaq).toBeDefined();
    expect(iaq!).toBeGreaterThan(50);
    expect(iaq!).toBeLessThan(250);
  });
});

describe("resolveIaq", () => {
  it("prefers the firmware IAQ field, including 0", () => {
    expect(resolveIaq({ iaq: 0, gasResistance: 50 })).toBe(0);
    expect(resolveIaq({ iaq: 42, gasResistance: 50 })).toBe(42);
  });

  it("falls back to a gas estimate when iaq is absent", () => {
    const iaq = resolveIaq({ gasResistance: 50, relativeHumidity: 40 });
    expect(iaq).toBe(estimatedIaqFromGas(50, 40));
  });
});
