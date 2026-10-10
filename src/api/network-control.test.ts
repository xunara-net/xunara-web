import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDNSConfiguration, getPolicyConfiguration, policyMatrix, publishPolicy, saveDNSConfiguration, simulatePolicy, validatePolicy, deleteAddressRecord, listRelayConfigurationHistory, updateManagedRelay, deleteManagedRelay } from "./network-control";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } }); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
function respond(payload: unknown) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 })); }
const draft = { revision: 1, base_hash: "a".repeat(64), content: "{}" };
const relay = { id: "relay/test", name: "测试中继", hostname: "relay.test", regionId: 40001, configVersion: 2, desiredState: "online", visibility: "private", online: false, healthy: false, bandwidthLimit: 0 };
const historyItem = { config_version: 1, desired_state: "online", bandwidth_limit: 0, region_name: "原始地区", actor: "system:import", created: "2026-10-10T00:00:00Z" };

describe("network configuration contracts", () => {
  it("rejects missing configuration and validation fields rather than fabricating results", async () => {
    for (const load of [getDNSConfiguration, getPolicyConfiguration, () => validatePolicy(draft)]) { respond({}); await expect(load()).rejects.toThrow("格式异常"); }
  });
  it("does not display malformed simulations as denied or permitted", async () => {
    const body = { source: 1, destination: 2, protocol: "tcp" as const, port: 443 };
    for (const payload of [{}, { allowed: false }, { allowed: true, draft: true, matches: [{ section: "grants", index: 0 }], reason: "ok" }]) { respond(payload); await expect(simulatePolicy(body)).rejects.toThrow("格式异常"); }
    const payload = { allowed: true, draft: true, matches: [{ section: "grants", index: 0, sources: ["alice"], destinations: ["tag:home"] }], reason: "compiled permission" };
    respond(payload);
    expect(await simulatePolicy(body)).toEqual(payload);
  });
  it("requires a complete unique matrix for the requested sources and destinations", async () => {
    const body = { sources: [1], destinations: [2, 3], protocol: "tcp" as const, port: 443 };
    for (const items of [[], [{ source: 1, destination: 2, allowed: true }], [{ source: 1, destination: 2, allowed: true }, { source: 1, destination: 2, allowed: false }]]) { respond({ items, draft: false }); await expect(policyMatrix(body)).rejects.toThrow("格式异常"); }
  });
  it("requires a newer confirmed publication revision and sends session CSRF", async () => {
    respond({ revision: 2, base_hash: "b".repeat(64) });
    expect((await publishPolicy(draft, "csrf-token")).revision).toBe(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-CSRF-Token": "csrf-token" });
    respond({ revision: 1, base_hash: "a".repeat(64) });
    await expect(publishPolicy(draft, "csrf-token")).rejects.toThrow("格式异常");
  });
  it("uses full DNS settings and CAS rather than patching unrelated sections", async () => {
    const settings = { magic_dns: false, nameservers: ["1.1.1.1"], search_domains: [], split_dns: {} };
    respond({ revision: 2, base_hash: "b".repeat(64), settings });
    await saveDNSConfiguration({ revision: 1, base_hash: draft.base_hash, settings }, "csrf-token");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ revision: 1, base_hash: draft.base_hash, settings });
  });
  it("binds record deletion to its latest revision", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteAddressRecord({ id: 10, revision: 3, name: "nas.xunara.test", type: "A", value: "100.64.0.2", node_id: 0, created: "2026-10-10T00:00:00Z" }, "csrf-token");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "If-Match": "3", "X-CSRF-Token": "csrf-token" });
  });
  it("binds relay writes and deletion to the observed version and CSRF", async () => {
    respond(relay);
    const body = { config_version: 1, desired_state: "online", bandwidth_limit: 0, region_name: "原始地区" };
    expect((await updateManagedRelay(relay.id, body, "csrf-token")).configVersion).toBe(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(body);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteManagedRelay(relay, "csrf-token");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ "If-Match": "2", "X-CSRF-Token": "csrf-token" });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("relay%2Ftest");
  });
  it("restores using the current precondition without resending old configuration fields", async () => {
    respond({ ...relay, configVersion: 3 });
    await updateManagedRelay(relay.id, { config_version: 2, restore_from: 1 }, "csrf-token");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ config_version: 2, restore_from: 1 });
  });
  it("rejects a false save acknowledgement and never retries a version conflict", async () => {
    respond(relay);
    await expect(updateManagedRelay(relay.id, { config_version: 2, restore_from: 1 }, "csrf-token")).rejects.toThrow("格式异常");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "RELAY_CONFIG_CHANGED: stale" }), { status: 409 }));
    await expect(updateManagedRelay(relay.id, { config_version: 2, restore_from: 1 }, "csrf-token")).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("requires valid, unique, newest-first relay history rather than displaying fabricated states", async () => {
    respond({ items: [historyItem] });
    expect(await listRelayConfigurationHistory(relay.id)).toEqual([historyItem]);
    for (const items of [[historyItem, historyItem], [historyItem, { ...historyItem, config_version: 2 }], [{ ...historyItem, desired_state: "unknown" }], [{ ...historyItem, created: "invalid" }], [{ ...historyItem, bandwidth_limit: -2 }]]) {
      respond({ items });
      await expect(listRelayConfigurationHistory(relay.id)).rejects.toThrow("格式异常");
    }
  });
});
