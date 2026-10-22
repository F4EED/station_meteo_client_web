import {
  createLogger,
  DeviceStatusEnum,
  type DeviceOutput,
  fromDeviceStream,
  toDeviceStream,
  type Transport,
} from "@meshtastic/sdk";
import { Result, type ResultType } from "better-result";

const log = createLogger("TransportWebSerial");

/**
 * Typed error produced when preparing a `SerialPort` for use fails. `kind`
 * lets callers distinguish recoverable cases (port held briefly during
 * USB re-enumeration) from fatal ones (another tab or process owns the
 * port). `userMessage` is a human-readable, actionable string ready for
 * UI without further interpretation.
 */
export class SerialConnectError extends Error {
  public readonly kind: "in-use" | "busy" | "unavailable";
  public readonly userMessage: string;

  constructor(
    kind: SerialConnectError["kind"],
    userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = "SerialConnectError";
    this.kind = kind;
    this.userMessage = userMessage;
  }
}

const PORT_OPEN_RETRY_DELAYS_MS = [250, 500, 750] as const;
const POST_CLOSE_DELAY_MS = 400;

const SERIAL_OPEN_OPTIONS = {
  baudRate: 115200,
  bufferSize: 1024,
  flowControl: "none" as const,
};

function isPortBusyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as DOMException).name === "InvalidStateError") return true;
  return /already open|failed to open serial port|access is denied/i.test(
    err.message,
  );
}

/**
 * Provides Web Serial transport for Meshtastic devices.
 *
 * Implements the {@link Transport} contract using the Web Serial API.
 * Use {@link TransportWebSerial.create} or {@link TransportWebSerial.createFromPort}
 * to construct an instance.
 */
export class TransportWebSerial implements Transport {
  private _toDevice: WritableStream<Uint8Array>;
  private _fromDevice: ReadableStream<DeviceOutput>;
  private fromDeviceController?: ReadableStreamDefaultController<DeviceOutput>;
  private connection: SerialPort;
  private pipePromise: Promise<void> | null = null;
  private abortController: AbortController;
  private portReadable: ReadableStream<Uint8Array>;
  private incomingReader?: ReadableStreamDefaultReader<DeviceOutput>;
  private rawReader?: ReadableStreamDefaultReader<Uint8Array>;

  private lastStatus: DeviceStatusEnum = DeviceStatusEnum.DeviceDisconnected;
  private closingByUser = false;

  /**
   * Prompt the user to pick a serial port and open a transport on it.
   * Returns `Err` on permission denial or open failure rather than
   * throwing — callers don't need a try/catch.
   */
  public static async create(
    baudRate?: number,
  ): Promise<ResultType<TransportWebSerial, SerialConnectError>> {
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch (cause) {
      return Result.err(
        new SerialConnectError("unavailable", "Serial port not selected.", {
          cause,
        }),
      );
    }
    return TransportWebSerial.createFromPort(port, baudRate);
  }

  /**
   * Open a transport on an already-known {@link SerialPort}. Performs the
   * port-state hygiene needed for reconnect flows:
   *
   * - If `readable` / `writable` are non-null (port still open from a
   *   previous session), close it and wait for the descriptor to settle.
   * - Try `port.open()` up to four times with backoff on
   *   `InvalidStateError` — common during USB re-enumeration.
   *
   * Returns `Err(SerialConnectError)` on persistent failure; the kind
   * distinguishes "port owned by another tab/process" (`in-use`) from
   * "transient busy / could not open" (`busy`) from
   * "permission denied / no streams" (`unavailable`).
   */
  public static async createFromPort(
    port: SerialPort,
    baudRate?: number,
  ): Promise<ResultType<TransportWebSerial, SerialConnectError>> {
    const prep = await TransportWebSerial.preparePort(
      port,
      baudRate ?? SERIAL_OPEN_OPTIONS.baudRate,
    );
    if (Result.isError(prep)) return Result.err(prep.error);
    try {
      return Result.ok(new TransportWebSerial(port));
    } catch (cause) {
      return Result.err(
        new SerialConnectError(
          "unavailable",
          "Serial port opened but its read / write streams are not accessible. Re-plug the device and try again.",
          { cause },
        ),
      );
    }
  }

  private static async preparePort(
    port: SerialPort,
    baudRate: number,
  ): Promise<ResultType<true, SerialConnectError>> {
    log.debug("preparePort: enter", {
      readable: !!port.readable,
      writable: !!port.writable,
      baudRate,
    });

    if (port.readable || port.writable) {
      log.debug("preparePort: port has live streams, closing");
      try {
        await port.close();
        log.debug("preparePort: close() ok");
      } catch (cause) {
        const err = cause as Error;
        log.warn("preparePort: close() threw", {
          name: err?.name,
          message: err?.message,
        });
        return Result.err(
          new SerialConnectError(
            "in-use",
            "Serial port is open and could not be released. Close any other tab, terminal, or app using it (Arduino IDE, screen, picocom, esptool) and try again.",
            { cause },
          ),
        );
      }
      await new Promise((r) => setTimeout(r, POST_CLOSE_DELAY_MS));
    }

    let lastErr: unknown;
    for (
      let attempt = 0;
      attempt <= PORT_OPEN_RETRY_DELAYS_MS.length;
      attempt++
    ) {
      try {
        log.debug("preparePort: open() attempt", { attempt });
        await port.open({
          ...SERIAL_OPEN_OPTIONS,
          baudRate,
        });
        // nRF52840 TinyUSB (Seeed L1) ignores the phone API until the host
        // asserts DTR. pyserial does this by default; Web Serial does not
        // always, so the node stays silent and config never completes.
        try {
          await port.setSignals({
            dataTerminalReady: true,
            requestToSend: true,
          });
          log.debug("preparePort: DTR/RTS asserted");
        } catch (cause) {
          const sigErr = cause as Error;
          log.warn("preparePort: setSignals threw", {
            name: sigErr?.name,
            message: sigErr?.message,
          });
        }
        await new Promise((r) => setTimeout(r, 250));
        log.debug("preparePort: open() ok", { attempt });
        return Result.ok(true);
      } catch (err) {
        lastErr = err;
        const e = err as Error;
        log.warn("preparePort: open() threw", {
          attempt,
          name: e?.name,
          message: e?.message,
          willRetry:
            isPortBusyError(err) && attempt < PORT_OPEN_RETRY_DELAYS_MS.length,
        });
        if (
          !isPortBusyError(err) ||
          attempt === PORT_OPEN_RETRY_DELAYS_MS.length
        )
          break;
        await new Promise((r) =>
          setTimeout(r, PORT_OPEN_RETRY_DELAYS_MS[attempt]),
        );
      }
    }

    const e = lastErr as Error | undefined;
    log.error("preparePort: failed", { name: e?.name, message: e?.message });

    if (isPortBusyError(lastErr)) {
      return Result.err(
        new SerialConnectError(
          "in-use",
          "Serial port is busy. Another tab, terminal, or app is holding it (Arduino IDE, screen, picocom, esptool, Meshtastic CLI). Close it and try again.",
          { cause: lastErr },
        ),
      );
    }
    return Result.err(
      new SerialConnectError(
        "busy",
        "Could not open the serial port. Re-plug the device and try again.",
        { cause: lastErr },
      ),
    );
  }

  /**
   * Constructs a transport around a given {@link SerialPort}.
   * @throws If the port lacks readable or writable streams.
   */
  constructor(connection: SerialPort) {
    if (!connection.readable || !connection.writable) {
      throw new Error("Stream not accessible");
    }

    this.connection = connection;
    this.portReadable = connection.readable;
    this.abortController = new AbortController();
    const abortController = this.abortController;

    log.debug("constructor: wiring pipe + reader");

    // Set up the pipe with abort signal for clean cancellation
    const toDeviceTransform = toDeviceStream();
    this.pipePromise = toDeviceTransform.readable
      .pipeTo(connection.writable, { signal: this.abortController.signal })
      .catch((err) => {
        // Ignore expected rejection when we cancel it via the AbortController.
        if (abortController.signal.aborted) {
          log.debug("toDevice pipe aborted (expected)");
          return;
        }
        const e = err as Error;
        console.warn("USB écriture interrompue", e?.name, e?.message);
        log.error("toDevice pipe rejected", {
          name: e?.name,
          message: e?.message,
        });
        void this.releasePort();
        this.emitStatus(DeviceStatusEnum.DeviceDisconnected, "write-error");
      });

    this._toDevice = toDeviceTransform.writable;

    // Wrap + capture controller to inject status packets
    this._fromDevice = new ReadableStream<DeviceOutput>({
      start: async (ctrl) => {
        this.fromDeviceController = ctrl;

        this.emitStatus(DeviceStatusEnum.DeviceConnecting);

        // Web Serial exposes a byte stream. pipeThrough() does not pull it on
        // Chrome/Windows, so the node answers and the page never sees a byte,
        // then port.close() fails with "locked stream". Read the port directly.
        const decoder = fromDeviceStream();
        const rawReader = this.portReadable.getReader();
        this.rawReader = rawReader;
        const decodedWriter = decoder.writable.getWriter();
        const reader = decoder.readable.getReader();
        this.incomingReader = reader;
        void (async () => {
          let loggedRx = false;
          try {
            while (true) {
              const { value, done } = await rawReader.read();
              if (done) {
                await decodedWriter.close();
                break;
              }
              if (value?.byteLength) {
                if (!loggedRx) {
                  loggedRx = true;
                  const head = [...value.subarray(0, 12)]
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join(" ");
                  console.warn("USB octets reçus", value.byteLength, head);
                }
                await decodedWriter.write(value);
              }
            }
          } catch (error) {
            const e = error as Error;
            console.warn("USB lecture interrompue", e?.name, e?.message);
            try {
              await decodedWriter.abort(error);
            } catch {}
          } finally {
            try {
              rawReader.releaseLock();
            } catch {}
          }
        })();

        const onOsDisconnect = (ev: Event) => {
          const { port } = ev as unknown as { port?: SerialPort };
          if (port && port === this.connection) {
            log.warn("OS-level disconnect event");
            this.emitStatus(
              DeviceStatusEnum.DeviceDisconnected,
              "serial-disconnected",
            );
          }
        };
        navigator.serial.addEventListener("disconnect", onOsDisconnect);

        log.debug("read loop starting");
        this.emitStatus(DeviceStatusEnum.DeviceConnected);

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              log.debug("read loop: done=true");
              break;
            }
            ctrl.enqueue(value);
          }
          ctrl.close();
        } catch (error) {
          const e = error as Error;
          log.warn("read loop threw", {
            closingByUser: this.closingByUser,
            name: e?.name,
            message: e?.message,
          });
          if (!this.closingByUser) {
            this.emitStatus(DeviceStatusEnum.DeviceDisconnected, "read-error");
          }
          ctrl.error(error instanceof Error ? error : new Error(String(error)));
          try {
            await this.rawReader?.cancel();
          } catch {}
        } finally {
          reader.releaseLock();
          navigator.serial.removeEventListener("disconnect", onOsDisconnect);
          log.debug("read loop: released reader lock + listener");
        }
      },
    });
  }

  /** Writable stream of bytes to the device. */
  public get toDevice(): WritableStream<Uint8Array> {
    return this._toDevice;
  }

  /** Readable stream of {@link DeviceOutput} from the device. */
  public get fromDevice(): ReadableStream<DeviceOutput> {
    return this._fromDevice;
  }

  private emitStatus(next: DeviceStatusEnum, reason?: string): void {
    if (next === this.lastStatus) {
      return;
    }
    this.lastStatus = next;
    try {
      this.fromDeviceController?.enqueue({
        type: "status",
        data: { status: next, reason },
      });
    } catch {
      // The read loop may already have closed the stream.
    }
  }

  /** Drop the reader lock, then close. port.close() fails while the lock is held. */
  private async releasePort(): Promise<void> {
    const raw = this.rawReader;
    this.rawReader = undefined;
    if (raw) {
      try {
        await raw.cancel();
      } catch {}
      try {
        raw.releaseLock();
      } catch {}
    }
    try {
      await this.connection.close();
    } catch {}
  }

  /**
   * Closes the serial port and emits `DeviceDisconnected("user")`.
   */
  public async disconnect(): Promise<void> {
    log.debug("disconnect: enter");
    try {
      this.closingByUser = true;

      // Stop outbound piping
      this.abortController.abort();
      log.debug("disconnect: aborted toDevice pipe");
      if (this.pipePromise) {
        await this.pipePromise;
        log.debug("disconnect: pipePromise settled");
      }

      // Cancel the reader first. port.close() rejects with
      // "Cannot cancel a locked stream" while pipeThrough still holds
      // port.readable, and the port then stays open for the next Connect.
      const raw = this.rawReader;
      this.rawReader = undefined;
      if (raw) {
        try {
          await raw.cancel();
          log.debug("disconnect: cancelled raw reader");
        } catch (e) {
          const err = e as Error;
          log.warn("disconnect: rawReader.cancel() threw", {
            name: err?.name,
            message: err?.message,
          });
        }
      }

      const reader = this.incomingReader;
      this.incomingReader = undefined;
      if (reader) {
        try {
          await reader.cancel();
          log.debug("disconnect: cancelled incoming reader");
        } catch (e) {
          const err = e as Error;
          log.warn("disconnect: reader.cancel() threw", {
            name: err?.name,
            message: err?.message,
          });
        }
      }

      if (this._fromDevice?.locked) {
        try {
          await this._fromDevice.cancel();
          log.debug("disconnect: cancelled fromDevice");
        } catch (e) {
          const err = e as Error;
          log.warn("disconnect: fromDevice.cancel() threw", {
            name: err?.name,
            message: err?.message,
          });
        }
      }

      await this.connection.close();
      log.debug("disconnect: connection.close() ok");
    } catch (error) {
      const e = error as Error;
      log.warn("disconnect: cleanup failed", {
        name: e?.name,
        message: e?.message,
      });
    } finally {
      this.emitStatus(DeviceStatusEnum.DeviceDisconnected, "user");
      this.closingByUser = false;
      log.debug("disconnect: done");
    }
  }

  /**
   * Reconnects the transport by creating a new AbortController and re-establishing
   * the pipe connection. Only call this after disconnect() or if the connection failed.
   */
  public async reconnect() {
    this.emitStatus(DeviceStatusEnum.DeviceConnecting, "reconnect");

    try {
      if (!this.connection.readable || !this.connection.writable) {
        throw new Error("Stream not accessible");
      }
      this.portReadable = this.connection.readable;

      // Create a new AbortController for the new connection
      this.abortController = new AbortController();
      const abortController = this.abortController;

      // Re-establish the pipe connection
      const toDeviceTransform = toDeviceStream();
      this.pipePromise = toDeviceTransform.readable
        .pipeTo(this.connection.writable, {
          signal: this.abortController.signal,
        })
        .catch((error) => {
          if (abortController.signal.aborted) {
            return;
          }
          console.error("Error piping data to serial port (reconnect):", error);
          this.emitStatus(DeviceStatusEnum.DeviceDisconnected, "write-error");
        });

      this.emitStatus(DeviceStatusEnum.DeviceConnected, "reconnected");
    } catch (error) {
      // Couldn’t re-pipe
      this.emitStatus(DeviceStatusEnum.DeviceDisconnected, "reconnect-failed");
      throw error;
    }
  }
}
