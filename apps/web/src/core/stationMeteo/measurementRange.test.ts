import { describe, expect, it } from "vitest";
import {
  batteryLevel,
  co2Level,
  dewPointLevel,
  estimatedCo2Ppm,
  estimatedIaqFromGas,
  feelsLikeLevel,
  gasOhmLevel,
  iaqLevel,
  resolveIaq,
  temperatureLevel,
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

describe("metricLevel traffic lights", () => {
  it("returns undefined for missing values", () => {
    expect(temperatureLevel(undefined)).toBeUndefined();
    expect(iaqLevel(undefined)).toBeUndefined();
    expect(batteryLevel(undefined)).toBeUndefined();
  });

  it("marks temperature around the mean as ok", () => {
    expect(temperatureLevel(15)).toBe("ok");
    expect(temperatureLevel(18.4)).toBe("ok");
  });

  it("marks temperature a bit off as warn and extremes as alert", () => {
    expect(temperatureLevel(-5)).toBe("warn");
    expect(temperatureLevel(35)).toBe("warn");
    expect(temperatureLevel(-25)).toBe("alert");
    expect(temperatureLevel(50)).toBe("alert");
  });

  it("treats low IAQ as ok (lower is better)", () => {
    expect(iaqLevel(0)).toBe("ok");
    expect(iaqLevel(80)).toBe("ok");
    expect(iaqLevel(150)).toBe("warn");
    expect(iaqLevel(250)).toBe("alert");
  });

  it("treats low gas resistance as worse air", () => {
    expect(gasOhmLevel(72_000)).toBe("ok");
    expect(gasOhmLevel(3_000)).toBe("warn");
    expect(gasOhmLevel(500)).toBe("alert");
  });

  it("classifies dew point, feels-like, eCO2 and battery", () => {
    expect(dewPointLevel(11.1)).toBe("ok");
    expect(dewPointLevel(17)).toBe("warn");
    expect(feelsLikeLevel(18.2)).toBe("ok");
    expect(co2Level(720)).toBe("ok");
    expect(co2Level(1500)).toBe("warn");
    expect(batteryLevel(101)).toBe("ok");
    expect(batteryLevel(25)).toBe("warn");
    expect(batteryLevel(5)).toBe("alert");
  });
});
