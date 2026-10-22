import { useToast } from "@core/hooks/useToast.ts";
import {
  type MeasurementRangePrefs,
  STMET_CMD_SET,
  STMET_MAGIC,
  clonePrefs,
  decodePrefs,
  encodeGet,
  encodePrefs,
} from "@core/stationMeteo/measurementRange.ts";
import { DeviceStatusEnum, Protobuf } from "@meshtastic/sdk";
import { useActiveClient } from "@meshtastic/sdk-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function useStationMeteoPrefs() {
  const { t } = useTranslation("config");
  const { toast } = useToast();
  const client = useActiveClient();
  const [prefs, setPrefs] = useState<MeasurementRangePrefs>(() => clonePrefs());
  const [busy, setBusy] = useState(false);
  const [fromNode, setFromNode] = useState(false);

  const applyIncoming = useCallback((data: Uint8Array) => {
    if (data.byteLength < 8) return false;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, true) !== STMET_MAGIC) return false;
    const decoded = decodePrefs(data);
    if (!decoded) return false;
    setPrefs(decoded);
    setFromNode(true);
    return true;
  }, []);

  useEffect(() => {
    if (!client) return;
    const handler = (pkt: { data: Uint8Array }) => {
      if (applyIncoming(pkt.data)) setBusy(false);
    };
    client.events.onPrivatePacket.subscribe(handler);
    return () => {
      client.events.onPrivatePacket.unsubscribe(handler);
    };
  }, [client, applyIncoming]);

  const loadFromNode = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    try {
      await client.sendPacket(
        encodeGet(),
        Protobuf.Portnums.PortNum.PRIVATE_APP,
        "self",
        undefined,
        true,
        true,
      );
      window.setTimeout(() => setBusy(false), 8000);
    } catch {
      setBusy(false);
      toast({ title: t("measurementRange.loadError") });
    }
  }, [client, t, toast]);

  const saveToNode = useCallback(async () => {
    if (!client) {
      toast({ title: t("measurementRange.disconnected") });
      return;
    }
    setBusy(true);
    try {
      await client.sendPacket(
        encodePrefs(prefs, STMET_CMD_SET),
        Protobuf.Portnums.PortNum.PRIVATE_APP,
        "self",
        undefined,
        true,
        true,
      );
      toast({ title: t("measurementRange.saved") });
      window.setTimeout(() => setBusy(false), 8000);
    } catch {
      setBusy(false);
      toast({ title: t("measurementRange.saveError") });
    }
  }, [client, prefs, t, toast]);

  const loadedFor = useRef<typeof client>(null);
  useEffect(() => {
    if (!client) return;
    const status = client.device.status;
    const kick = (): void => {
      if (status.value !== DeviceStatusEnum.DeviceConfigured) return;
      if (loadedFor.current === client) return;
      loadedFor.current = client;
      void loadFromNode();
    };
    kick();
    return status.subscribe(kick);
  }, [client, loadFromNode]);

  return { prefs, setPrefs, busy, fromNode, client, loadFromNode, saveToNode };
}
