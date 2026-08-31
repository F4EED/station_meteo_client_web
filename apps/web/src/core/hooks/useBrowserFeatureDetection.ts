import { useMemo } from "react";

export type BrowserFeature = "Web Bluetooth" | "Web Serial" | "Secure Context";

interface BrowserSupport {
  supported: BrowserFeature[];
  unsupported: BrowserFeature[];
}

const IPV4_LOOPBACK = /^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/;

/** localhost, *.localhost, 127.0.0.0/8, ::1 — origines de boucle locale. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") {
    return true;
  }
  return IPV4_LOOPBACK.test(host);
}

/**
 * Web Bluetooth / Web Serial exigent un contexte sécurisé.
 * `http://127.0.0.1` est une origine de confiance (spec Secure Contexts),
 * contrairement à un simple test `hostname === "localhost"`.
 */
export function isSecureBrowserContext(
  locationLike: Pick<Location, "protocol" | "hostname"> = globalThis.location,
  secureContext = globalThis.isSecureContext,
): boolean {
  if (secureContext) {
    return true;
  }
  if (locationLike.protocol === "https:") {
    return true;
  }
  return (
    locationLike.protocol === "http:" &&
    isLoopbackHostname(locationLike.hostname)
  );
}

export function useBrowserFeatureDetection(): BrowserSupport {
  const support = useMemo(() => {
    const features: [BrowserFeature, boolean][] = [
      ["Web Bluetooth", !!navigator.bluetooth],
      ["Web Serial", !!navigator.serial],
      ["Secure Context", isSecureBrowserContext()],
    ];

    return features.reduce<BrowserSupport>(
      (acc, [feature, isSupported]) => {
        const list = isSupported ? acc.supported : acc.unsupported;
        list.push(feature);
        return acc;
      },
      { supported: [], unsupported: [] },
    );
  }, []);

  return support;
}
