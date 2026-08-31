import { describe, expect, it } from "vitest";
import { dewPointC, feelsLikeC } from "./derivedWeather.ts";

describe("dewPointC", () => {
  it("returns ~9.3 °C at 20 °C / 50 %", () => {
    expect(dewPointC(20, 50)).toBeCloseTo(9.3, 1);
  });

  it("equals temperature at 100 % RH", () => {
    expect(dewPointC(12, 100)).toBeCloseTo(12, 1);
  });

  it("returns undefined for missing or invalid humidity", () => {
    expect(dewPointC(20, undefined)).toBeUndefined();
    expect(dewPointC(20, 0)).toBeUndefined();
    expect(dewPointC(20, 120)).toBeUndefined();
    expect(dewPointC(undefined, 50)).toBeUndefined();
  });
});

describe("feelsLikeC", () => {
  it("stays near air temperature at 20 °C / 50 %", () => {
    expect(feelsLikeC(20, 50)).toBeCloseTo(20, 0);
  });

  it("is higher than air temperature when hot and humid", () => {
    const feels = feelsLikeC(30, 80);
    expect(feels).toBeDefined();
    expect(feels!).toBeGreaterThan(30);
  });

  it("returns undefined without temperature or humidity", () => {
    expect(feelsLikeC(undefined, 50)).toBeUndefined();
    expect(feelsLikeC(20, undefined)).toBeUndefined();
  });
});
