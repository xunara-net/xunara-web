import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDeviceConnection, type DeviceConnection } from "./device-connection";

const payload: DeviceConnection = { stableId: "node-1", generatedAt: "2026-10-12T00:00:00Z", controlOnline: false,
  lastControlSeenAt: null, reportAvailable: false, mapConfigured: false, policyMode: "inherit", homeRegion: null,
  reportedRegionId: 0, reportedRegionAdvertised: false, network: null, endpoints: [], endpointCount: 0,
  endpointsTruncated: false, latencies: [], latenciesTruncated: false };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } }); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
function respond(value: unknown, status = 200) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })); }

describe("device connection contract", () => {
  it("preserves explicit missing reports and uses an escaped tenant-local reference", async () => {
    respond(payload);
    expect(await getDeviceConnection("node/id")).toEqual(payload);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://tenant.example.test/api/v1/machines/node%2Fid/connection");
  });
  it("keeps explicit false distinct from unknown network tests", async () => {
    const actual = { ...payload, reportAvailable: true, network: { linkType: "wifi", udp: false, ipv6: true,
      mappingVariesByDestIP: null, upnp: null, pmp: false, pcp: true } };
    respond(actual);
    expect((await getDeviceConnection(1)).network).toEqual(actual.network);
  });
  it.each([{}, { ...payload, network: {} }, { ...payload, generatedAt: "bad" }, { ...payload, controlOnline: "true" },
    { ...payload, latencies: [{ regionId: 1, name: "bad", code: "bad", addressFamily: "ipv4", milliseconds: -1 }] },
    { ...payload, endpoints: Array(33).fill("1.2.3.4:5") }, { ...payload, homeRegion: {} },
    { ...payload, endpointCount: 1, endpointsTruncated: false }, { ...payload, reportAvailable: true, network: null }])("rejects malformed connection report %j", async (invalid) => {
    respond(invalid); await expect(getDeviceConnection(1)).rejects.toThrow("异常");
  });
  it("does not turn failed reads into an empty successful device", async () => {
    respond({ error: "connection report unavailable" }, 503);
    await expect(getDeviceConnection(1)).rejects.toMatchObject({ status: 503 });
  });
});
