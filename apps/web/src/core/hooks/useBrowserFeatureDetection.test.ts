import { describe, expect, it } from "vitest";
import {
  isLoopbackHostname,
  isSecureBrowserContext,
} from "./useBrowserFeatureDetection.ts";

describe("isLoopbackHostname", () => {
  it("accepte localhost et les sous-domaines .localhost", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isLoopbackHostname("app.localhost")).toBe(true);
  });

  it("accepte 127.0.0.1 et le reste de 127.0.0.0/8", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.1.2.3")).toBe(true);
  });

  it("accepte ::1 (avec ou sans crochets)", () => {
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("refuse les hôtes non locaux", () => {
    expect(isLoopbackHostname("example.com")).toBe(false);
    expect(isLoopbackHostname("192.168.1.1")).toBe(false);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
  });
});

describe("isSecureBrowserContext", () => {
  it("fait confiance à window.isSecureContext", () => {
    expect(
      isSecureBrowserContext(
        { protocol: "http:", hostname: "example.com" },
        true,
      ),
    ).toBe(true);
  });

  it("accepte HTTPS même si isSecureContext est faux", () => {
    expect(
      isSecureBrowserContext(
        { protocol: "https:", hostname: "client.example.org" },
        false,
      ),
    ).toBe(true);
  });

  it("accepte http://127.0.0.1 (pas seulement localhost)", () => {
    expect(
      isSecureBrowserContext(
        { protocol: "http:", hostname: "127.0.0.1" },
        false,
      ),
    ).toBe(true);
  });

  it("accepte http://localhost", () => {
    expect(
      isSecureBrowserContext(
        { protocol: "http:", hostname: "localhost" },
        false,
      ),
    ).toBe(true);
  });

  it("refuse http sur un hôte distant", () => {
    expect(
      isSecureBrowserContext(
        { protocol: "http:", hostname: "192.168.1.10" },
        false,
      ),
    ).toBe(false);
  });
});
