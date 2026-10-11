import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRelayHealth, relayHealthDescription } from "./relay-health";

const result = { relayId: "relay-1", configVersion: 1, checkedAt: "2026-10-12T00:00:00Z", status: "reachable" as const,
  code: "OK", tlsVerified: true, httpStatus: 200, latencyMilliseconds: 12.3, perspective: "control-plane" as const };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } }); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
function respond(value: unknown) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value), { status: 200 })); }
describe("relay health probe contract", () => {
  it("posts only an empty probe and a CSRF header, with no arbitrary target", async () => {
    respond(result);
    expect(await checkRelayHealth("relay-1", "fixture-csrf")).toEqual(result);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://tenant.example.test/api/v2/relays/relay-1/health");
    expect(request?.headers).toMatchObject({ "X-CSRF-Token": "fixture-csrf" });
    expect(JSON.parse(String(request?.body))).toEqual({});
    expect(relayHealthDescription(result)).toContain("TLS/HTTP 服务可达");
  });
  it.each([{ tlsVerified: false }, { httpStatus: 302 }, { relayId: "other" }, { latencyMilliseconds: null },
    { status: "healthy" }, { code: "wrong" }, { checkedAt: "bad" }])("does not turn invalid result %j into success", async (changes) => {
    respond({ ...result, ...changes }); await expect(checkRelayHealth("relay-1", "fixture-csrf")).rejects.toThrow("格式异常");
  });
  it("preserves blocked checks separately from node heartbeat health", async () => {
    const blocked = { ...result, status: "blocked" as const, code: "PROBE_ADDRESS_BLOCKED", tlsVerified: false, httpStatus: 0, latencyMilliseconds: null };
    respond(blocked);
    expect(await checkRelayHealth("relay-1", "fixture-csrf")).toEqual(blocked);
    expect(relayHealthDescription(blocked)).toContain("公网地址校验");
  });
});
