import { PageLayout } from "@components/PageLayout.tsx";
import { Sidebar } from "@components/Sidebar.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@components/UI/Card.tsx";
import { useMyNodeAsProto } from "@core/hooks/useNodesAsProto.ts";
import { cn } from "@core/utils/cn.ts";
import type { TelemetryKind, TelemetryReading } from "@meshtastic/sdk";
import { Protobuf } from "@meshtastic/sdk";
import { useActiveClient, useSignal } from "@meshtastic/sdk-react";
import {
  BatteryChargingIcon,
  CloudFogIcon,
  CloudIcon,
  DropletsIcon,
  GaugeIcon,
  LeafIcon,
  ThermometerIcon,
  ThermometerSunIcon,
  WindIcon,
  ZapIcon,
} from "lucide-react";
import { dewPointC, feelsLikeC } from "@core/stationMeteo/derivedWeather.ts";
import {
  batteryLevel,
  co2Level,
  dewPointLevel,
  estimatedCo2Ppm,
  feelsLikeLevel,
  gasOhmLevel,
  humidityLevel,
  iaqLevel,
  type MetricLevel,
  pressureLevel,
  resolveIaq,
  temperatureLevel,
  voltageLevel,
} from "@core/stationMeteo/measurementRange.ts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const EMPTY_HISTORY: TelemetryReading[] = [];
const EMPTY_HISTORY_SIGNAL = {
  value: EMPTY_HISTORY,
  peek: () => EMPTY_HISTORY,
  subscribe: () => () => {},
} as const;

function latestOf(
  history: readonly TelemetryReading[],
  kind: TelemetryKind,
): TelemetryReading | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.kind === kind) return history[i];
  }
  return undefined;
}

function fmt(value: number | undefined, digits = 1, suffix = ""): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

export default function MeteoPage() {
  const { t } = useTranslation("ui");
  const myNode = useMyNodeAsProto();
  const client = useActiveClient();
  const nodeNum = myNode?.num;

  const historySig = useMemo(
    () =>
      client && nodeNum !== undefined
        ? client.telemetry.history(nodeNum)
        : EMPTY_HISTORY_SIGNAL,
    [client, nodeNum],
  );
  const history = useSignal(historySig);

  const envReading = latestOf(history, "environmentMetrics");
  const deviceReading = latestOf(history, "deviceMetrics");
  const powerReading = latestOf(history, "powerMetrics");

  const env = envReading?.value as
    | Protobuf.Telemetry.EnvironmentMetrics
    | undefined;
  const device = deviceReading?.value as
    | Protobuf.Telemetry.DeviceMetrics
    | undefined;
  const power = powerReading?.value as
    | Protobuf.Telemetry.PowerMetrics
    | undefined;

  const iaq = env ? resolveIaq(env) : undefined;
  const envPresent =
    env?.temperature !== undefined ||
    env?.relativeHumidity !== undefined ||
    env?.barometricPressure !== undefined;
  const iaqOrPending =
    iaq !== undefined ? String(iaq) : envPresent ? t("meteo.iaqHeating") : "—";
  const gasOhm =
    env?.gasResistance !== undefined && env.gasResistance > 0
      ? env.gasResistance * 1000
      : undefined;
  const dewPoint = dewPointC(env?.temperature, env?.relativeHumidity);
  const feelsLike = feelsLikeC(env?.temperature, env?.relativeHumidity);
  const co2Ppm = iaq !== undefined ? estimatedCo2Ppm(iaq) : undefined;
  const co2OrPending =
    co2Ppm !== undefined
      ? `${Math.round(co2Ppm)} ppm`
      : envPresent
        ? t("meteo.iaqHeating")
        : "—";
  const statusLabel = (level: MetricLevel) =>
    t(
      level === "ok"
        ? "meteo.statusOk"
        : level === "warn"
          ? "meteo.statusWarn"
          : "meteo.statusAlert",
    );

  const envCards = [
    {
      key: "temp",
      label: t("meteo.temperature"),
      value: fmt(env?.temperature, 1, " °C"),
      icon: ThermometerIcon,
      level: temperatureLevel(env?.temperature),
    },
    {
      key: "humidity",
      label: t("meteo.humidity"),
      value: fmt(env?.relativeHumidity, 0, " %"),
      icon: DropletsIcon,
      level: humidityLevel(env?.relativeHumidity),
    },
    {
      key: "dewPoint",
      label: t("meteo.dewPoint"),
      value: fmt(dewPoint, 1, " °C"),
      icon: CloudFogIcon,
      level: dewPointLevel(dewPoint),
    },
    {
      key: "feelsLike",
      label: t("meteo.feelsLike"),
      value: fmt(feelsLike, 1, " °C"),
      icon: ThermometerSunIcon,
      level: feelsLikeLevel(feelsLike),
    },
    {
      key: "pressure",
      label: t("meteo.pressure"),
      value: fmt(env?.barometricPressure, 1, " hPa"),
      icon: GaugeIcon,
      level: pressureLevel(env?.barometricPressure),
    },
    {
      key: "iaq",
      label: t("meteo.iaq"),
      value: iaqOrPending,
      icon: LeafIcon,
      level: iaqLevel(iaq),
    },
    {
      key: "gas",
      label: t("meteo.gas"),
      value: fmt(gasOhm, 0, " Ω"),
      icon: WindIcon,
      level: gasOhmLevel(gasOhm),
    },
    {
      key: "co2",
      label: t("meteo.co2"),
      value: co2OrPending,
      icon: CloudIcon,
      level: co2Level(co2Ppm),
    },
  ];

  const powerCards = [
    {
      key: "battery",
      label: t("meteo.battery"),
      value:
        device?.batteryLevel !== undefined
          ? device.batteryLevel > 100
            ? t("batteryStatus.pluggedIn")
            : `${device.batteryLevel} %`
          : "—",
      icon: BatteryChargingIcon,
      level: batteryLevel(device?.batteryLevel),
    },
    {
      key: "voltage",
      label: t("meteo.voltage"),
      value: fmt(device?.voltage ?? power?.ch1Voltage, 2, " V"),
      icon: ZapIcon,
      level: voltageLevel(device?.voltage ?? power?.ch1Voltage),
    },
  ];

  return (
    <PageLayout
      label={t("meteo.title")}
      leftBar={<Sidebar />}
      contentClassName="overflow-auto"
    >
      <div
        data-testid="station-meteo"
        className="flex flex-col gap-8 p-4 md:p-6"
      >
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t("meteo.environment")}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {envCards.map(({ key, ...card }) => (
              <MetricCard key={key} {...card} statusLabel={statusLabel} />
            ))}
          </div>
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t("meteo.power")}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {powerCards.map(({ key, ...card }) => (
              <MetricCard key={key} {...card} statusLabel={statusLabel} />
            ))}
          </div>
        </section>
        <p className="text-sm text-slate-500">
          {envReading || deviceReading
            ? t("meteo.lastUpdate", {
                time: (envReading ?? deviceReading)?.time.toLocaleString(),
              })
            : t("meteo.waiting")}
        </p>
      </div>
    </PageLayout>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  level,
  statusLabel,
}: {
  label: string;
  value: string;
  icon: typeof ThermometerIcon;
  level?: MetricLevel;
  statusLabel: (level: MetricLevel) => string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
        <Icon className="size-5 text-slate-500" aria-hidden />
        <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "flex items-center gap-2 text-2xl font-semibold tabular-nums",
          )}
        >
          <span>{value}</span>
          {level ? (
            <span
              data-testid={`meteo-status-${level}`}
              className={cn(
                "inline-block size-3 shrink-0 rounded-full",
                level === "ok" && "bg-green-600",
                level === "warn" && "bg-orange-500",
                level === "alert" && "bg-red-500",
              )}
              title={statusLabel(level)}
              aria-label={statusLabel(level)}
            />
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}
