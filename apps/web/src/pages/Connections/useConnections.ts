import {
  startConfigHeartbeat,
  startMaintenanceHeartbeat,
  stopHeartbeat,
} from "@app/core/connections/heartbeat.ts";
import {
  buildMeshDevice,
  maybeSyncTimeFromGpsPosition,
  requestLocalTelemetry,
  syncDeviceTime,
} from "@app/core/connections/sdkClient.ts";
import {
  closeTransport,
  openTransport,
  probeConnection,
} from "@app/core/connections/transports.ts";
import {
  createLogger,
  DeviceStatusEnum,
  type MeshDevice,
} from "@meshtastic/sdk";

const log = createLogger("useConnections");
import type {
  Connection,
  ConnectionId,
  ConnectionStatus,
  NewConnection,
} from "@app/core/stores/deviceStore/types";
import { createConnectionFromInput } from "@app/pages/Connections/utils";
import { meshRegistry } from "@core/meshRegistry.ts";
import { useAppStore, useDeviceStore } from "@core/stores";
import { subscribeAll } from "@core/subscriptions.ts";
import { randId } from "@core/utils/randId.ts";
import { useCallback } from "react";

// Per-connection out-of-band handles tracked outside Zustand:
//   - cachedTransports: held BT device / serial port for reconnect + cleanup.
//   - configSubscriptions: onConfigComplete unsubscribers.
const cachedTransports = new Map<ConnectionId, BluetoothDevice | SerialPort>();
const configSubscriptions = new Map<ConnectionId, () => void>();

const TRANSPORT_READY_MS = 15_000;
const CONFIG_COMPLETE_RETRY_MS = 6_000;
const CONFIG_COMPLETE_MAX_TRIES = 3;
const CONFIG_WAIT_MS =
  CONFIG_COMPLETE_RETRY_MS * CONFIG_COMPLETE_MAX_TRIES + 2_000;
const READY_STATUSES = new Set([
  DeviceStatusEnum.DeviceConnected,
  DeviceStatusEnum.DeviceConfiguring,
  DeviceStatusEnum.DeviceConfigured,
]);

function waitUntilTransportReady(meshDevice: MeshDevice): Promise<void> {
  const status = meshDevice.meshClient.device.status;
  if (READY_STATUSES.has(status.value)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(
        new Error(
          "La liaison n'est pas prête. Réessayez Connect — inutile de recharger la page.",
        ),
      );
    }, TRANSPORT_READY_MS);
    const unsub = status.subscribe((next) => {
      if (READY_STATUSES.has(next)) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
    if (READY_STATUSES.has(status.value)) {
      clearTimeout(timer);
      unsub();
      resolve();
    }
  });
}

function waitUntilConfigured(
  meshDevice: MeshDevice,
  isConfigured: () => boolean,
): Promise<void> {
  if (isConfigured()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(limitTimer);
      unsub();
      fn();
    };
    const limitTimer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            "Le nœud n'a pas terminé la configuration. Cliquez Connect — inutile de recharger la page.",
          ),
        ),
      );
    }, CONFIG_WAIT_MS);
    const unsub = meshDevice.meshClient.device.status.subscribe((s) => {
      if (s === DeviceStatusEnum.DeviceConfigured || isConfigured()) {
        finish(() => resolve());
      }
    });
    if (
      isConfigured() ||
      meshDevice.meshClient.device.status.value ===
        DeviceStatusEnum.DeviceConfigured
    ) {
      finish(() => resolve());
    }
  });
}

export function useConnections() {
  const connections = useDeviceStore((s) => s.savedConnections);
  const addSavedConnection = useDeviceStore((s) => s.addSavedConnection);
  const updateSavedConnection = useDeviceStore((s) => s.updateSavedConnection);
  const removeSavedConnectionFromStore = useDeviceStore(
    (s) => s.removeSavedConnection,
  );
  const setActiveConnectionId = useDeviceStore((s) => s.setActiveConnectionId);
  const { addDevice } = useDeviceStore();
  const { setSelectedDevice } = useAppStore();
  const selectedDeviceId = useAppStore((s) => s.selectedDeviceId);

  const updateStatus = useCallback(
    (id: ConnectionId, status: ConnectionStatus, error?: string) => {
      updateSavedConnection(id, {
        status,
        error: error || undefined,
        ...(status === "disconnected" ? { lastConnectedAt: Date.now() } : {}),
      });
    },
    [updateSavedConnection],
  );

  const teardown = useCallback(async (id: ConnectionId, conn?: Connection) => {
    log.debug("teardown: enter", { id });
    stopHeartbeat(id);
    configSubscriptions.get(id)?.();
    configSubscriptions.delete(id);

    if (conn?.meshDeviceId) {
      const device = useDeviceStore.getState().getDevice(conn.meshDeviceId);
      try {
        // Await the underlying transport's close so the port is fully
        // released before the user clicks reconnect — otherwise port.open()
        // can race the close and throw "port already open".
        await device?.connection?.disconnect();
        log.debug("teardown: transport disconnect awaited");
      } catch (e) {
        const err = e as Error;
        log.warn("teardown: transport disconnect threw", {
          name: err?.name,
          message: err?.message,
        });
      }
    }
    closeTransport(cachedTransports.get(id));
    cachedTransports.delete(id);
    log.debug("teardown: done", { id });
  }, []);

  const removeConnection = useCallback(
    async (id: ConnectionId) => {
      const conn = connections.find((c) => c.id === id);
      await teardown(id, conn);
      if (conn?.meshDeviceId) {
        try {
          useDeviceStore.getState().removeDevice(conn.meshDeviceId);
        } catch {}
      }
      meshRegistry.unregister(id);
      removeSavedConnectionFromStore(id);
    },
    [connections, removeSavedConnectionFromStore, teardown],
  );

  const setDefaultConnection = useCallback(
    (id: ConnectionId) => {
      const conn = connections.find((c) => c.id === id);
      if (!conn) return;
      updateSavedConnection(id, { isDefault: !conn.isDefault });
    },
    [connections, updateSavedConnection],
  );

  const setupMeshDevice = useCallback(
    async (
      id: ConnectionId,
      transport: Awaited<ReturnType<typeof openTransport>>["transport"],
      bluetoothDevice?: BluetoothDevice,
      serialPort?: SerialPort,
    ): Promise<number> => {
      // Reuse existing meshDeviceId if the device entry still exists; otherwise mint a new one.
      const conn = connections.find((c) => c.id === id);
      let deviceId = conn?.meshDeviceId;
      if (deviceId && !useDeviceStore.getState().getDevice(deviceId)) {
        deviceId = undefined;
      }
      deviceId = deviceId ?? randId();

      const device = addDevice(deviceId);

      // Flip status to "configuring" up front. buildMeshDevice awaits the
      // OPFS DB open which can take a beat (or stall under multi-tab
      // contention); we don't want the UI looking stuck at "connecting"
      // while persistence is spinning up.
      device.setConnectionPhase("configuring");
      updateStatus(id, "configuring");
      log.debug("setupMeshDevice: building MeshDevice", { id, deviceId });

      const meshDevice = await buildMeshDevice(id, deviceId, transport);
      log.debug("setupMeshDevice: MeshDevice built", { id });

      if (!meshRegistry.has(id)) {
        meshRegistry.register(id, meshDevice.meshClient);
      }
      meshRegistry.setActive(id);

      setSelectedDevice(deviceId);
      device.addConnection(meshDevice);
      subscribeAll(device, meshDevice);

      const cached = bluetoothDevice ?? serialPort;
      if (cached) cachedTransports.set(id, cached);

      setActiveConnectionId(id);
      device.setConnectionId(id);

      await waitUntilTransportReady(meshDevice);

      // Two paths drive the "configured" transition:
      //   1. The `onConfigComplete` event from the firmware. The handler is
      //      attached AFTER buildMeshDevice, which means MeshClient already
      //      started piping fromDevice → decodePacket. If the serial port
      //      had a buffered configCompleteId from a prior session, the
      //      dispatch happens synchronously before this subscribe and we
      //      miss it.
      //   2. The MeshClient.device.status signal. decodePacket flips the
      //      signal to DeviceConfigured on the same configCompleteId, and
      //      signals replay their current value to new subscribers — so we
      //      catch the case the event missed.
      // Either path may fire first; `markConfigured` is idempotent.
      let configuredHandled = false;
      let configureTries = 0;
      let configRetryTimer: ReturnType<typeof setInterval> | undefined;

      const stopConfigRetry = (): void => {
        if (!configRetryTimer) return;
        clearInterval(configRetryTimer);
        configRetryTimer = undefined;
      };

      const markConfigured = (source: string): void => {
        if (configuredHandled) return;
        configuredHandled = true;
        stopConfigRetry();
        log.info("connect transitioned to configured", { id, source });
        device.setConnectionPhase("configured");
        updateStatus(id, "configured");
        startMaintenanceHeartbeat(id, meshDevice);
        requestLocalTelemetry(meshDevice);
        syncDeviceTime(meshDevice);
      };

      const unsubConfigComplete = meshDevice.events.onConfigComplete.subscribe(
        () => markConfigured("onConfigComplete"),
      );
      const unsubStatusSignal = meshDevice.meshClient.device.status.subscribe(
        (s) => {
          if (s === DeviceStatusEnum.DeviceConfigured)
            markConfigured("device.status");
        },
      );
      // Catch-up: signal subscribe doesn't fire for the current value, so
      // check synchronously if the device is already past the gate.
      if (
        meshDevice.meshClient.device.status.value ===
        DeviceStatusEnum.DeviceConfigured
      ) {
        markConfigured("initial-check");
      }

      // Reboot: firmware emits `rebooted` after a soft reset (config write,
      // OTA, manual reboot). The SDK re-runs configure() so MeshClient state
      // re-streams, but the saved-connection status is already "configured"
      // — so the overlay would stay hidden. Flip status back to "configuring"
      // and reset `configuredHandled` so the next onConfigComplete re-marks.
      // Maintenance heartbeat is stopped here so the reconfigure handshake
      // isn't racing pings; markConfigured() restarts it.
      const unsubRebooted = meshDevice.events.onRebooted.subscribe(() => {
        log.info("device rebooted — re-entering configuring", { id });
        stopHeartbeat(id);
        configuredHandled = false;
        configureTries = 0;
        device.setConnectionPhase("configuring");
        updateStatus(id, "configuring");
      });

      const unsubGpsTime = meshDevice.events.onPositionPacket.subscribe(
        (packet) => maybeSyncTimeFromGpsPosition(meshDevice, packet),
      );

      configSubscriptions.set(id, () => {
        stopConfigRetry();
        unsubConfigComplete();
        unsubStatusSignal();
        unsubRebooted();
        unsubGpsTime();
      });

      const sendConfigure = (): void => {
        if (configuredHandled) return;
        configureTries += 1;
        log.debug("setupMeshDevice: calling configure()", {
          id,
          configureTries,
        });
        meshDevice
          .configure()
          .then(() => {
            if (configuredHandled) return;
            log.debug(
              "setupMeshDevice: configure() resolved, sending heartbeat",
              { id },
            );
            return meshDevice
              .heartbeat()
              .then(() => startConfigHeartbeat(id, meshDevice));
          })
          .catch((error) => {
            const e = error as Error;
            log.error("setupMeshDevice: configure() rejected", {
              id,
              name: e?.name,
              message: e?.message,
              configureTries,
            });
            if (configuredHandled) return;
          });
      };

      sendConfigure();
      configRetryTimer = setInterval(() => {
        if (configuredHandled) {
          stopConfigRetry();
          return;
        }
        const progress = meshDevice.meshClient.progress.value;
        const handshakeInFlight =
          progress.phase === "configuring" &&
          (progress.received.config > 0 ||
            progress.received.modules > 0 ||
            progress.received.channels > 0 ||
            progress.received.myInfo ||
            progress.received.metadata);
        if (handshakeInFlight) {
          return;
        }
        if (configureTries >= CONFIG_COMPLETE_MAX_TRIES) {
          return;
        }
        log.info("setupMeshDevice: retry configure()", { id, configureTries });
        sendConfigure();
      }, CONFIG_COMPLETE_RETRY_MS);

      updateSavedConnection(id, { meshDeviceId: deviceId });
      await waitUntilConfigured(meshDevice, () => configuredHandled);
      return deviceId;
    },
    [
      connections,
      addDevice,
      setSelectedDevice,
      setActiveConnectionId,
      updateSavedConnection,
      updateStatus,
    ],
  );

  const connect = useCallback(
    async (id: ConnectionId, opts?: { allowPrompt?: boolean }) => {
      // Read from the live store, not the memoized `connections` closure: callers
      // such as addConnectionAndConnect() add a connection and connect to it in the
      // same tick, before this hook re-renders, so the closure would be stale.
      const conn = useDeviceStore
        .getState()
        .savedConnections.find((c) => c.id === id);
      if (!conn) {
        log.warn("connect: unknown connection id", { id });
        return false;
      }
      if (conn.status === "configured" || conn.status === "connected") {
        log.debug("connect: already connected", { id, status: conn.status });
        return true;
      }

      log.info("connect: enter", {
        id,
        type: conn.type,
        allowPrompt: !!opts?.allowPrompt,
      });
      updateStatus(id, "connecting");
      const tries = conn.type === "serial" ? 3 : 1;
      let lastMessage = "";
      for (let attempt = 0; attempt < tries; attempt++) {
        try {
          if (attempt > 0) {
            log.warn("connect: serial retry after drop", {
              id,
              attempt,
              lastMessage,
            });
            try {
              await teardown(id, conn);
            } catch {}
            await new Promise((r) => setTimeout(r, 800));
            updateStatus(id, "connecting");
          }
          const cached = cachedTransports.get(id);
          const result = await openTransport(conn, {
            allowPrompt: opts?.allowPrompt,
            cachedBluetoothDevice:
              conn.type === "bluetooth"
                ? (cached as BluetoothDevice | undefined)
                : undefined,
            cachedSerialPort:
              conn.type === "serial"
                ? (cached as SerialPort | undefined)
                : undefined,
          });
          log.debug("connect: openTransport ok", { id, attempt });
          await setupMeshDevice(
            id,
            result.transport,
            result.bluetoothDevice,
            result.serialPort,
          );
          log.info(
            "connect: setupMeshDevice resolved, awaiting onConfigComplete",
            { id },
          );

          result.bluetoothDevice?.addEventListener(
            "gattserverdisconnected",
            () => {
              log.warn("BT gattserverdisconnected", { id });
              updateStatus(id, "disconnected");
            },
          );
          if (result.serialPort && navigator.serial) {
            navigator.serial.addEventListener(
              "disconnect",
              (ev: Event) => {
                const { port } = ev as unknown as { port?: SerialPort };
                if (port && port === result.serialPort) {
                  log.warn("USB serial disconnect", { id });
                  const cur = useDeviceStore
                    .getState()
                    .savedConnections.find((c) => c.id === id);
                  if (
                    cur?.status === "configured" ||
                    cur?.status === "connected"
                  ) {
                    updateStatus(id, "disconnected");
                  }
                }
              },
              { once: true },
            );
          }
          return true;
        } catch (err) {
          const e = err as Error;
          lastMessage = e?.message ?? String(err);
          log.error("connect: failed", {
            id,
            attempt,
            name: e?.name,
            message: lastMessage,
          });
          const retryable =
            conn.type === "serial" &&
            attempt < tries - 1 &&
            /connection lost|not ready|streams gone|busy|already open|could not open/i.test(
              lastMessage,
            );
          if (!retryable) {
            try {
              await teardown(id, conn);
            } catch {}
            updateStatus(id, "error", lastMessage);
            return false;
          }
        }
      }
      try {
        await teardown(id, conn);
      } catch {}
      updateStatus(id, "error", lastMessage);
      return false;
    },
    [updateStatus, setupMeshDevice, teardown],
  );

  const disconnect = useCallback(
    async (id: ConnectionId) => {
      const conn = connections.find((c) => c.id === id);
      if (!conn) return;
      try {
        await teardown(id, conn);
        if (conn.meshDeviceId) {
          const device = useDeviceStore.getState().getDevice(conn.meshDeviceId);
          if (device) {
            device.setConnectionId(null);
            device.setConnectionPhase("disconnected");
          }
        }
      } finally {
        updateSavedConnection(id, { status: "disconnected", error: undefined });
      }
    },
    [connections, updateSavedConnection, teardown],
  );

  const addConnection = useCallback(
    (input: NewConnection) => {
      const conn = createConnectionFromInput(input);
      addSavedConnection(conn);
      return conn;
    },
    [addSavedConnection],
  );

  const addConnectionAndConnect = useCallback(
    async (input: NewConnection, btDevice?: BluetoothDevice) => {
      const conn = addConnection(input);
      if (btDevice && conn.type === "bluetooth")
        cachedTransports.set(conn.id, btDevice);
      await connect(conn.id, { allowPrompt: true });
      return conn;
    },
    [addConnection, connect],
  );

  const refreshStatuses = useCallback(async () => {
    const candidates = connections.filter(
      (c) =>
        c.status !== "connected" &&
        c.status !== "configured" &&
        c.status !== "configuring",
    );
    await Promise.all(
      candidates.map(async (c) => {
        const status = await probeConnection(c);
        updateSavedConnection(c.id, { status });
      }),
    );
  }, [connections, updateSavedConnection]);

  const syncConnectionStatuses = useCallback(() => {
    const activeConnection = connections.find(
      (c) => c.meshDeviceId === selectedDeviceId,
    );
    connections.forEach((conn) => {
      const shouldBeConnected = activeConnection?.id === conn.id;
      const isConnectedState =
        conn.status === "connected" ||
        conn.status === "configured" ||
        conn.status === "configuring";
      if (!shouldBeConnected && isConnectedState) {
        updateSavedConnection(conn.id, { status: "disconnected" });
      }
    });
  }, [connections, selectedDeviceId, updateSavedConnection]);

  return {
    connections,
    addConnection,
    addConnectionAndConnect,
    connect,
    disconnect,
    removeConnection,
    setDefaultConnection,
    refreshStatuses,
    syncConnectionStatuses,
  };
}
