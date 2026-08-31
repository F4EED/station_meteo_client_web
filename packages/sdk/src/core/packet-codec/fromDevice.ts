import type { DeviceOutput } from "../transport/Transport.ts";

/**
 * Transforms a raw byte stream from the device into typed DeviceOutput chunks
 * by parsing the 0x94 0xC3 framing header and length prefix.
 */
export const fromDeviceStream: () => TransformStream<
  Uint8Array,
  DeviceOutput
> = () => {
  let byteBuffer = new Uint8Array([]);
  const textDecoder = new TextDecoder();
  return new TransformStream<Uint8Array, DeviceOutput>({
    transform(chunk: Uint8Array, controller): void {
      byteBuffer = new Uint8Array([...byteBuffer, ...chunk]);
      let processingExhausted = false;
      while (byteBuffer.length !== 0 && !processingExhausted) {
        const framingIndex = byteBuffer.indexOf(0x94);
        if (framingIndex === -1) {
          controller.enqueue({
            type: "debug",
            data: textDecoder.decode(byteBuffer),
          });
          byteBuffer = new Uint8Array([]);
          break;
        }
        if (framingIndex + 1 >= byteBuffer.length) {
          processingExhausted = true;
          break;
        }
        if (byteBuffer[framingIndex + 1] !== 0xc3) {
          if (framingIndex > 0) {
            controller.enqueue({
              type: "debug",
              data: textDecoder.decode(byteBuffer.subarray(0, framingIndex)),
            });
          }
          byteBuffer = byteBuffer.subarray(framingIndex + 1);
          continue;
        }
        if (framingIndex > 0) {
          controller.enqueue({
            type: "debug",
            data: textDecoder.decode(byteBuffer.subarray(0, framingIndex)),
          });
          byteBuffer = byteBuffer.subarray(framingIndex);
        }

        const msb = byteBuffer[2];
        const lsb = byteBuffer[3];

        if (
          msb !== undefined &&
          lsb !== undefined &&
          byteBuffer.length >= 4 + (msb << 8) + lsb
        ) {
          const packetLen = (msb << 8) + lsb;
          const packet = byteBuffer.subarray(4, 4 + packetLen);
          byteBuffer = byteBuffer.subarray(4 + packetLen);
          controller.enqueue({
            type: "packet",
            data: packet,
          });
        } else {
          processingExhausted = true;
        }
      }
    },
  });
};
