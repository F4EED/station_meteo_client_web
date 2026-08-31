import { create, toBinary } from "@bufbuild/protobuf";
import type { ConnectionId } from "@core/stores/deviceStore/types";
import {
  ChannelNumber,
  createLogger,
  MeshDevice,
  Protobuf,
  type PacketMetadata,
} from "@meshtastic/sdk";
import type { TransportHTTP } from "@meshtastic/transport-http";
import type { TransportWebBluetooth } from "@meshtastic/transport-web-bluetooth";
import type { TransportWebSerial } from "@meshtastic/transport-web-serial";

const log = createLogger("sdkClient");

export type AnyTransport =
  | TransportHTTP
  | TransportWebBluetooth
  | TransportWebSerial;

/**
 * Firmware PhoneAPI special nonce: stream config/channels/modules, skip the
 * NodeDB dump, file manifest, and satellite replay. Station météo has no node
 * list and no OTA file browser — those dumps are what made USB config crawl.
 * See firmware `SPECIAL_NONCE_ONLY_CONFIG`.
 */
export const SPECIAL_NONCE_ONLY_CONFIG = 69420;

/** Unix seconds after 2020-01-01 — reject unset / boot-relative GPS time. */
const UNIX_MIN_PLAUSIBLE = 1_577_836_800;

export async function buildMeshDevice(
  connectionId: ConnectionId,
  deviceId: number,
  transport: AnyTransport,
): Promise<MeshDevice> {
  log.debug("buildMeshDevice: enter (in-memory, no sqlocal)", {
    connectionId,
    deviceId,
  });
  return new MeshDevice(transport, {
    configId: SPECIAL_NONCE_ONLY_CONFIG,
  });
}

function sendAdmin(
  meshDevice: MeshDevice,
  payloadVariant: Protobuf.Admin.AdminMessage["payloadVariant"],
): void {
  const message = create(Protobuf.Admin.AdminMessageSchema, { payloadVariant });
  meshDevice
    .sendPacket(
      toBinary(Protobuf.Admin.AdminMessageSchema, message),
      Protobuf.Portnums.PortNum.ADMIN_APP,
      "self",
      ChannelNumber.Primary,
      false,
      false,
    )
    .catch((err: Error) => {
      log.warn("admin send failed", {
        name: err?.name,
        message: err?.message,
      });
    });
}

/**
 * Push wall-clock seconds to the node (`set_time_only`). Firmware applies
 * it as NTP quality: fills an unset RTC, or refreshes drift every 30 min.
 * Does not override a live GPS clock.
 */
export function syncDeviceTime(meshDevice: MeshDevice, unixSec?: number): void {
  const value = unixSec ?? Math.floor(Date.now() / 1000);
  if (value < UNIX_MIN_PLAUSIBLE) return;
  log.debug("syncDeviceTime", { value });
  sendAdmin(meshDevice, { case: "setTimeOnly", value });
}

/**
 * If this packet is our node with a GPS fix, (re)set the clock when needed.
 * Prefer NMEA/GPS unix time from the Position protobuf; otherwise host time.
 */
export function maybeSyncTimeFromGpsPosition(
  meshDevice: MeshDevice,
  packet: PacketMetadata<Protobuf.Mesh.Position>,
): void {
  if (packet.from !== meshDevice.meshClient.myNodeNum) return;
  if (meshDevice.meshClient.myNodeNum === 0) return;
  const lat = packet.data.latitudeI;
  const lon = packet.data.longitudeI;
  if (!lat && !lon) return;
  const gpsUnix = packet.data.time;
  const unix =
    gpsUnix && gpsUnix >= UNIX_MIN_PLAUSIBLE
      ? gpsUnix
      : Math.floor(Date.now() / 1000);
  log.info("GPS position: sync clock", { gpsUnix, unix });
  syncDeviceTime(meshDevice, unix);
}

/**
 * Ask the connected node for a fresh environment + device reading (phone
 * path). Fire-and-forget: serial acks for wantAck=false can sit in the
 * queue for up to 60 s.
 */
export function requestLocalTelemetry(meshDevice: MeshDevice): void {
  const send = (variant: Protobuf.Telemetry.Telemetry["variant"]): void => {
    const msg = create(Protobuf.Telemetry.TelemetrySchema, { variant });
    meshDevice
      .sendPacket(
        toBinary(Protobuf.Telemetry.TelemetrySchema, msg),
        Protobuf.Portnums.PortNum.TELEMETRY_APP,
        "self",
        ChannelNumber.Primary,
        false,
        true,
      )
      .catch((err: Error) => {
        log.warn("requestLocalTelemetry failed", {
          name: err?.name,
          message: err?.message,
        });
      });
  };
  send({
    case: "environmentMetrics",
    value: create(Protobuf.Telemetry.EnvironmentMetricsSchema),
  });
  send({
    case: "deviceMetrics",
    value: create(Protobuf.Telemetry.DeviceMetricsSchema),
  });
}
