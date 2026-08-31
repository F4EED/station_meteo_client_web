/**
 * Derived weather from BME688 temperature (°C) and relative humidity (%).
 * No wind sensor: feels-like is humidity-based only.
 */

const MAGNUS_A = 17.62;
const MAGNUS_B = 243.12;

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Dew point °C (Magnus–Tetens, WMO over water).
 * Undefined if temperature or humidity is missing, or RH is out of (0, 100].
 */
export function dewPointC(
  tempC: number | undefined,
  rhPct: number | undefined,
): number | undefined {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(rhPct)) return undefined;
  if (rhPct <= 0 || rhPct > 100) return undefined;
  const gamma = Math.log(rhPct / 100) + (MAGNUS_A * tempC) / (MAGNUS_B + tempC);
  const denom = MAGNUS_A - gamma;
  if (denom === 0) return undefined;
  return (MAGNUS_B * gamma) / denom;
}

/**
 * Saturation vapor pressure hPa (Magnus, over water).
 */
function vaporPressureHpa(tempC: number, rhPct: number): number {
  return (rhPct / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
}

/**
 * Steadman apparent temperature °C, wind = 0.
 * AT = T + 0.33·e − 4.00  (e = vapor pressure hPa)
 */
function steadmanApparentC(tempC: number, rhPct: number): number {
  return tempC + 0.33 * vaporPressureHpa(tempC, rhPct) - 4;
}

/**
 * NWS heat index °C (Rothfusz), input already in °F internally.
 */
function nwsHeatIndexC(tempC: number, rhPct: number): number {
  const T = (tempC * 9) / 5 + 32;
  const R = rhPct;
  const simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + R * 0.094);
  let hiF = simple;
  if ((simple + T) / 2 >= 80) {
    hiF =
      -42.379 +
      2.04901523 * T +
      10.14333127 * R -
      0.22475541 * T * R -
      0.00683783 * T * T -
      0.05481717 * R * R +
      0.00122874 * T * T * R +
      0.00085282 * T * R * R -
      0.00000199 * T * T * R * R;
    if (R < 13 && T >= 80 && T <= 112) {
      hiF -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    } else if (R > 85 && T >= 80 && T <= 87) {
      hiF += ((R - 85) / 10) * ((87 - T) / 5);
    }
  }
  return ((hiF - 32) * 5) / 9;
}

/**
 * Feels-like °C.
 * Heat index when T ≥ 27 °C (hot + humid); otherwise Steadman without wind.
 */
export function feelsLikeC(
  tempC: number | undefined,
  rhPct: number | undefined,
): number | undefined {
  if (!isFiniteNumber(tempC) || !isFiniteNumber(rhPct)) return undefined;
  if (rhPct < 0 || rhPct > 100) return undefined;
  return tempC >= 27
    ? nwsHeatIndexC(tempC, rhPct)
    : steadmanApparentC(tempC, rhPct);
}
