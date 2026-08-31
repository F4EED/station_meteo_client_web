import { Button } from "@components/UI/Button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@components/UI/Card.tsx";
import { Input } from "@components/UI/Input.tsx";
import { useToast } from "@core/hooks/useToast.ts";
import {
  type BandKey,
  DEFAULT_PREFS,
  type MeasurementRangePrefs,
  QUANTITY_KEYS,
  type QuantityKey,
  STMET_CMD_SET,
  STMET_MAGIC,
  clonePrefs,
  decodePrefs,
  encodeGet,
  encodePrefs,
} from "@core/stationMeteo/measurementRange.ts";
import { Protobuf } from "@meshtastic/sdk";
import { useActiveClient } from "@meshtastic/sdk-react";
import { useCallback, useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

interface Props {
  onFormInit?: <T extends object>(methods: UseFormReturn<T>) => void;
}

const FIELD_ORDER: BandKey[] = [
  "mean",
  "low",
  "high",
  "veryLow",
  "warnLow",
  "warnHigh",
  "veryHigh",
];

export function MeasurementRange(_props: Props) {
  const { t } = useTranslation("config");
  const { toast } = useToast();
  const client = useActiveClient();
  const [prefs, setPrefs] = useState<MeasurementRangePrefs>(() => clonePrefs());
  const [busy, setBusy] = useState(false);

  const applyIncoming = useCallback((data: Uint8Array) => {
    if (data.byteLength < 8) return false;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, true) !== STMET_MAGIC) return false;
    const decoded = decodePrefs(data);
    if (!decoded) return false;
    setPrefs(decoded);
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
    if (!client) {
      toast({
        title: t("measurementRange.disconnected"),
      });
      return;
    }
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
      toast({
        title: t("measurementRange.loadError"),
      });
    }
  }, [client, t, toast]);

  useEffect(() => {
    void loadFromNode();
  }, [loadFromNode]);

  const saveToNode = useCallback(async () => {
    if (!client) {
      toast({
        title: t("measurementRange.disconnected"),
      });
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
      toast({
        title: t("measurementRange.saved"),
      });
      window.setTimeout(() => setBusy(false), 8000);
    } catch {
      setBusy(false);
      toast({
        title: t("measurementRange.saveError"),
      });
    }
  }, [client, prefs, t, toast]);

  const setField = (qty: QuantityKey, field: BandKey, raw: string) => {
    const value = Number(raw);
    setPrefs((prev) => ({
      ...prev,
      [qty]: {
        ...prev[qty],
        [field]: Number.isFinite(value) ? value : prev[qty][field],
      },
    }));
  };

  return (
    <div className="flex flex-col gap-4 p-1" data-testid="measurement-range">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("measurementRange.description")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !client}
          onClick={() => void loadFromNode()}
        >
          {t("measurementRange.load")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => setPrefs(clonePrefs(DEFAULT_PREFS))}
        >
          {t("measurementRange.resetDefaults")}
        </Button>
        <Button
          type="button"
          disabled={busy || !client}
          onClick={() => void saveToNode()}
        >
          {t("measurementRange.save")}
        </Button>
      </div>
      {QUANTITY_KEYS.map((qty) => (
        <Card key={qty}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t(`measurementRange.quantities.${qty}.label`)}{" "}
              <span className="font-normal text-slate-500">
                {t(`measurementRange.quantities.${qty}.unit`)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FIELD_ORDER.map((field) => (
              <label key={field} className="flex flex-col gap-1 text-sm">
                <span className="text-slate-600 dark:text-slate-300">
                  {t(`measurementRange.fields.${field}`)}
                </span>
                <Input
                  type="number"
                  step="any"
                  value={prefs[qty][field]}
                  onChange={(e) => setField(qty, field, e.target.value)}
                  aria-label={`${t(`measurementRange.quantities.${qty}.label`)} ${t(`measurementRange.fields.${field}`)}`}
                />
              </label>
            ))}
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-slate-500">{t("measurementRange.note")}</p>
    </div>
  );
}
