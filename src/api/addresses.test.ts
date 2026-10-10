import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as addresses from "./addresses";
import * as external from "./external-relays";
import { relayRelease } from "../utils/relay-downloads";
import type { Machine } from "./types";
const fetchMock = vi.fn<typeof fetch>();
const configuration = { ipv4_cidr: "100.101.50.0/24", ipv6_cidr: "fd7a:115c:a1e0::/48", revision: 2, desired_revision: 2, desired_ipv4_cidr: "100.101.50.0/24", pending: false, can_edit: true, can_edit_ips: true, devices_total: 3, devices_outside_range: 1, reserved_ranges: ["100.100.100.0/24"], csrf_token: "test-csrf" };
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("window", { location: { origin: "http://localhost:8090" } }); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
function respond(body: unknown) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })); }
describe("address and external relay response contracts", () => {
  it("loads actual and desired separately and sends range version plus CSRF", async () => {
    respond({ ...configuration, pending: true, desired_revision: 3, desired_ipv4_cidr: "100.101.51.0/24" });
    expect((await addresses.getAddressConfiguration()).ipv4_cidr).toBe("100.101.50.0/24");
    respond(configuration); await addresses.saveAddressRange("100.101.50.0/24", 1, "csrf");
    const request = fetchMock.mock.calls[1]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ ipv4_cidr: "100.101.50.0/24", revision: 1 });
    expect(request?.headers).toMatchObject({ "X-CSRF-Token": "csrf" });
  });
  it("fails on missing counters or write result instead of claiming success", async () => {
    respond({ ...configuration, devices_total: undefined });
    await expect(addresses.getAddressConfiguration()).rejects.toThrow("格式异常");
    const machine = { id: 12, stableId: "node-12", ipv4: "100.101.50.20" } as Machine;
    respond({ ...machine, ipv4: "100.101.50.21" });
    await expect(addresses.changeDeviceIPv4(machine, "100.101.50.22", "csrf")).rejects.toThrow("未确认");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ ipv4: "100.101.50.22", expected_ipv4: machine.ipv4 });
  });
  it("only trusts the exact official source and preserves applied status", async () => {
    respond({ map: { Regions: {} }, source: "https://evil.example/" });
    await expect(external.importOfficialRelayMap("csrf")).rejects.toThrow("来源未确认");
    respond({ revision: 1, map: { Regions: {} }, applied: false, csrf_token: "csrf", official_url: "https://controlplane.tailscale.com/derpmap/default" });
    expect((await external.getExternalRelayConfiguration()).applied).toBe(false);
  });
  it("pins seven distinct public binaries and a checksum file to a real release", () => {
    expect(relayRelease.platforms).toHaveLength(7);
    expect(new Set(relayRelease.platforms.map((target) => target.name)).size).toBe(7);
    for (const target of relayRelease.platforms) expect(target.url).toBe(`https://github.com/xunara-net/xunara-relay/releases/download/${relayRelease.version}/${target.name}`);
    expect(relayRelease.checksums).toContain("/SHA256SUMS");
    expect(relayRelease.platforms.filter((target) => target.system === "Windows").every((target) => target.name.endsWith(".exe"))).toBe(true);
  });
});
