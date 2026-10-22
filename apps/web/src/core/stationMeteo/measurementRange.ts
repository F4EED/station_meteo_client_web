export const STMET_MAGIC = 0x53544d54; // 'STMT'
export const STMET_VERSION = 1;
export const STMET_SIZE = 180;

export const STMET_CMD_STORE = 0;
export const STMET_CMD_GET = 1;
export const STMET_CMD_SET = 2;
export const STMET_CMD_DATA = 3;

export type BandKey =
  | "mean"
  | "low"
  | "high"
  | "veryLow"
  | "warnLow"
  | "warnHigh"
  | "veryHigh";

export type QuantityKey =
  | "temp"
  | "humidity"
  | "pressure"
  | "gasOhm"
  | "iaq"
  | "co2";

export type MeasurementBand = Record<BandKey, number>;

export type MeasurementRangePrefs = Record<QuantityKey, MeasurementBand>;

export const BAND_KEYS: BandKey[] = [
  "mean",
  "low",
  "high",
  "veryLow",
  "warnLow",
  "warnHigh",
  "veryHigh",
];

export const QUANTITY_KEYS: QuantityKey[] = [
  "temp",
  "humidity",
  "pressure",
  "gasOhm",
  "iaq",
  "co2",
];

/** Same numbers as StationMeteoPrefsStore::defaults() in the firmware. */
export const DEFAULT_PREFS: MeasurementRangePrefs = {
  temp: {
    mean: 15,
    low: -10,
    high: 40,
    veryLow: -20,
    warnLow: 0,
    warnHigh: 35,
    veryHigh: 45,
  },
  humidity: {
    mean: 55,
    low: 20,
    high: 90,
    veryLow: 10,
    warnLow: 30,
    warnHigh: 80,
    veryHigh: 95,
  },
  pressure: {
    mean: 1013,
    low: 980,
    high: 1040,
    veryLow: 960,
    warnLow: 990,
    warnHigh: 1030,
    veryHigh: 1050,
  },
  gasOhm: {
    mean: 50_000,
    low: 5_000,
    high: 1e7,
    veryLow: 1_000,
    warnLow: 10_000,
    warnHigh: 5e6,
    veryHigh: 2e7,
  },
  iaq: {
    mean: 50,
    low: 0,
    high: 150,
    veryLow: 0,
    warnLow: 25,
    warnHigh: 100,
    veryHigh: 200,
  },
  co2: {
    mean: 600,
    low: 400,
    high: 1500,
    veryLow: 350,
    warnLow: 500,
    warnHigh: 1000,
    veryHigh: 2000,
  },
};

export type MetricLevel = "ok" | "warn" | "alert";
export type BandSense = "twoSided" | "lowerBetter" | "higherBetter";

/** Client-only bands (not in the STMET 180-byte payload). */
export const DEW_POINT_BAND: MeasurementBand = {
  mean: 10,
  low: -5,
  high: 18,
  veryLow: -15,
  warnLow: 0,
  warnHigh: 15,
  veryHigh: 20,
};

export const BATTERY_BAND: MeasurementBand = {
  mean: 80,
  low: 20,
  high: 100,
  veryLow: 10,
  warnLow: 30,
  warnHigh: 100,
  veryHigh: 100,
};

export const VOLTAGE_BAND: MeasurementBand = {
  mean: 3.7,
  low: 3.4,
  high: 4.2,
  veryLow: 3.2,
  warnLow: 3.55,
  warnHigh: 4.2,
  veryHigh: 4.35,
};

const BATTERY_PLUGGED_IN = 100;

/**
 * Green / orange / red traffic light vs a measurement band.
 * ok = typical, warn = a bit off, alert = far off.
 */
export function metricLevel(
  value: number | undefined,
  band: MeasurementBand,
  sense: BandSense,
): MetricLevel | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  switch (sense) {
    case "twoSided":
      if (value < band.veryLow || value > band.veryHigh) return "alert";
      if (value < band.warnLow || value > band.warnHigh) return "warn";
      return "ok";
    case "lowerBetter":
      if (value > band.veryHigh) return "alert";
      if (value > band.warnHigh) return "warn";
      return "ok";
    case "higherBetter":
      if (value < band.veryLow) return "alert";
      if (value < band.warnLow) return "warn";
      return "ok";
  }
}

export function temperatureLevel(
  value?: number,
  prefs: MeasurementRangePrefs = DEFAULT_PREFS,
): MetricLevel | undefined {
  return metricLevel(value, prefs.temp, "twoSided");
}

export function humidityLevel(
  value?: number,
  prefs: MeasurementRangePrefs = DEFAULT_PREFS,
): MetricLevel | undefined {
  return metricLevel(value, prefs.humidity, "twoSided");
}

export function pressureLevel(
  value?: number,
  prefs: MeasurementRangePrefs = DEFAULT_PREFS,
): MetricLevel | undefined {
  return metricLevel(value, prefs.pressure, "twoSided");
}

export function dewPointLevel(value?: number): MetricLevel | undefined {
  return metricLevel(value, DEW_POINT_BAND, "twoSided");
}

export function feelsLikeLevel(
  value?: number,
  prefs: MeasurementRangePrefs = DEFAULT_PREFS,
): MetricLevel | undefined {
  return metricLevel(value, prefs.temp, "twoSided");
}

export function gasOhmLevel(
  value?: number,
  prefs: MeasurementRangePrefs = DEFAULT_PREFS,
): MetricLevel | undefined {
  return metricLevel(value, prefs.gasOhm, "twoSided");
}

export function iaqLevel(
  value?: number,
  prefs: MeasurementRangePrefs = DEFAULT_PREFS,
): MetricLevel | undefined {
  return metricLevel(value, prefs.iaq, "lowerBetter");
}

export function co2Level(
  value?: number,
  prefs: MeasurementRangePrefs = DEFAULT_PREFS,
): MetricLevel | undefined {
  return metricLevel(value, prefs.co2, "lowerBetter");
}

export function batteryLevel(value?: number): MetricLevel | undefined {
  if (value === undefined) return undefined;
  if (value > BATTERY_PLUGGED_IN) return "ok";
  return metricLevel(value, BATTERY_BAND, "higherBetter");
}

export function voltageLevel(value?: number): MetricLevel | undefined {
  return metricLevel(value, VOLTAGE_BAND, "twoSided");
}

export function estimatedCo2Ppm(iaq: number): number {
  return 400 + iaq * 4;
}

/** Wire `gas_resistance` is kOhm (BME680Sensor). Same scoring as firmware, default ceiling 100 kΩ. */
export function estimatedIaqFromGas(
  gasKohm: number,
  relativeHumidity?: number,
): number | undefined {
  if (!(gasKohm > 0) || !Number.isFinite(gasKohm)) return undefined;
  const gasOhm = gasKohm * 1000;
  const rh =
    relativeHumidity !== undefined && Number.isFinite(relativeHumidity)
      ? Math.min(100, Math.max(0, relativeHumidity))
      : 40;
  const KH = 0.035;
  const LN_FLOOR = Math.log(5000);
  const LN_CEIL_MAX = 18.4;
  const LN_RANGE = Math.log(15);
  const DEFAULT_CEILING = Math.log(100_000);
  const x = Math.log(gasOhm) + KH * (rh - 40);
  const lnCeiling = Math.min(LN_CEIL_MAX, Math.max(LN_FLOOR, DEFAULT_CEILING));
  const below = Math.max(0, lnCeiling - x);
  const gasScore = Math.min(1, below / LN_RANGE) * 500;
  const humDeviation = rh < 30 ? 30 - rh : rh > 60 ? rh - 60 : 0;
  const humScore = Math.min(1, humDeviation / 40) * 500;
  return Math.round(Math.min(500, Math.max(0, gasScore + 0.15 * humScore)));
}

export function resolveIaq(env: {
  iaq?: number;
  gasResistance?: number;
  relativeHumidity?: number;
}): number | undefined {
  if (env.iaq !== undefined) return env.iaq;
  return estimatedIaqFromGas(
    env.gasResistance ?? Number.NaN,
    env.relativeHumidity,
  );
}

function xorHash(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = STMET_SIZE / 4 - 1;
  let h = 0;
  for (let i = 0; i < words; i++) {
    h ^= view.getUint32(i * 4, true);
  }
  return h >>> 0;
}

function writeBand(
  view: DataView,
  offset: number,
  band: MeasurementBand,
): number {
  for (const key of BAND_KEYS) {
    view.setFloat32(offset, band[key], true);
    offset += 4;
  }
  return offset;
}

function readBand(view: DataView, offset: number): [MeasurementBand, number] {
  const band = {} as MeasurementBand;
  for (const key of BAND_KEYS) {
    band[key] = view.getFloat32(offset, true);
    offset += 4;
  }
  return [band, offset];
}

export function encodePrefs(
  prefs: MeasurementRangePrefs,
  cmd: number,
): Uint8Array {
  const buf = new Uint8Array(STMET_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint32(0, STMET_MAGIC, true);
  view.setUint8(4, STMET_VERSION);
  view.setUint8(5, cmd);
  view.setUint16(6, 0, true);
  let offset = 8;
  for (const key of QUANTITY_KEYS) {
    offset = writeBand(view, offset, prefs[key]);
  }
  view.setUint32(STMET_SIZE - 4, xorHash(buf), true);
  return buf;
}

export function encodeGet(): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, STMET_MAGIC, true);
  view.setUint8(4, STMET_VERSION);
  view.setUint8(5, STMET_CMD_GET);
  view.setUint16(6, 0, true);
  return buf;
}

export function decodePrefs(bytes: Uint8Array): MeasurementRangePrefs | null {
  if (bytes.byteLength < STMET_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== STMET_MAGIC) return null;
  if (view.getUint8(4) !== STMET_VERSION) return null;
  const expected = xorHash(bytes.subarray(0, STMET_SIZE));
  if (view.getUint32(STMET_SIZE - 4, true) !== expected) return null;
  const prefs = {} as MeasurementRangePrefs;
  let offset = 8;
  for (const key of QUANTITY_KEYS) {
    const [band, next] = readBand(view, offset);
    prefs[key] = band;
    offset = next;
  }
  return prefs;
}

export function clonePrefs(
  prefs: MeasurementRangePrefs = DEFAULT_PREFS,
): MeasurementRangePrefs {
  return structuredClone(prefs);
}
