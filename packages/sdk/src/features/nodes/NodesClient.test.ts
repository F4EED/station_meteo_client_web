import { create } from "@bufbuild/protobuf";
import * as Protobuf from "@meshtastic/protobufs";
import { describe, expect, it } from "vitest";
import { MeshClient } from "../../core/client/MeshClient.ts";
import { createFakeTransport } from "../../core/testing/createFakeTransport.ts";
import { ChannelNumber } from "../../core/types.ts";

describe("NodesClient", () => {
  it("populates the list signal from incoming NodeInfo packets", async () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });

    expect(client.nodes.list.value).toEqual([]);

    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 1 }),
    );
    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 2, isFavorite: true }),
    );

    expect(client.nodes.list.value.map((n) => n.num)).toEqual([1, 2]);
    expect(client.nodes.byNum(2)?.isFavorite).toBe(true);
  });

  it("byNum returns undefined for unknown nodes", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });
    expect(client.nodes.byNum(999)).toBeUndefined();
  });

  it("folds live device-metrics telemetry into the node", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });

    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, { num: 100 }),
    );
    client.events.onTelemetryPacket.dispatch({
      id: 1,
      from: 100,
      to: 0,
      channel: ChannelNumber.Primary,
      type: "broadcast",
      rxTime: new Date(1000),
      data: create(Protobuf.Telemetry.TelemetrySchema, {
        variant: {
          case: "deviceMetrics",
          value: create(Protobuf.Telemetry.DeviceMetricsSchema, {
            batteryLevel: 80,
            voltage: 4.1,
          }),
        },
      }),
    });

    expect(client.nodes.byNum(100)?.deviceMetrics?.batteryLevel).toBe(80);
    expect(client.nodes.byNum(100)?.deviceMetrics?.voltage).toBeCloseTo(4.1);
  });

  it("seeds a stub node from MyInfo so the local node exists without a NodeInfo packet", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });

    client.events.onMyNodeInfo.dispatch(
      create(Protobuf.Mesh.MyNodeInfoSchema, { myNodeNum: 0xabc }),
    );

    expect(client.nodes.byNum(0xabc)?.num).toBe(0xabc);
    expect(client.nodes.byNum(0xabc)?.isFavorite).toBe(true);
  });

  it("does not overwrite an existing node when MyInfo arrives later", () => {
    const { transport } = createFakeTransport();
    const client = new MeshClient({ transport });

    client.events.onNodeInfoPacket.dispatch(
      create(Protobuf.Mesh.NodeInfoSchema, {
        num: 7,
        isFavorite: false,
        user: create(Protobuf.Mesh.UserSchema, { longName: "Station" }),
      }),
    );
    client.events.onMyNodeInfo.dispatch(
      create(Protobuf.Mesh.MyNodeInfoSchema, { myNodeNum: 7 }),
    );

    expect(client.nodes.byNum(7)?.user?.longName).toBe("Station");
    expect(client.nodes.byNum(7)?.isFavorite).toBe(false);
  });
});
