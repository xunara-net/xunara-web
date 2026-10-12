import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExitOverview, getRouteConfiguration, getRouteOverview, saveRouteConfiguration, type RouteConfiguration } from "./route-management";
import type { Machine } from "./types";
import { ApiError, errorMessage } from "./client";

const current: RouteConfiguration = {
  machine: { id: 42, stableId: "route-42", hostname: "home-router", online: true, expired: false,
    approvedRoutes: ["10.0.0.0/8"], announcedRoutes: ["10.0.0.0/8", "::/0"], effectiveRoutes: ["10.0.0.0/8"] } as Machine,
  revision: "a".repeat(64), csrf_token: "csrf-fixture", can_manage: true,
  limits: { max_routes: 10, allow_subnet_router: true, allow_exit_node: false },
};
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } }); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
function respond(value: unknown, status = 200) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value), { status })); }

describe("transactional route management contract", () => {
  it("uses the version-protected endpoint and sends only explicit changes with CSRF", async () => {
    respond(current);
    expect(await saveRouteConfiguration("route-42", current.revision, { approve: ["::/0"], unapprove: [] }, current.csrf_token)).toEqual(current);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://tenant.example.test/api/v2/machines/route-42/routes");
    expect(options?.headers).toMatchObject({ "X-CSRF-Token": "csrf-fixture" });
    expect(JSON.parse(String(options?.body))).toEqual({ revision: current.revision, approve: ["::/0"], unapprove: [] });
    expect(options?.credentials).toBe("same-origin");
  });
  it("accepts numeric references and preserves read-only permissions", async () => {
    const readonly = { ...current, can_manage: false };
    respond(readonly); expect(await getRouteConfiguration("42")).toEqual(readonly);
  });
  it.each([{}, { ...current, revision: "" }, { ...current, can_manage: "true" }, { ...current, limits: {} },
    { ...current, limits: { ...current.limits, max_routes: -2 } },
    { ...current, machine: { ...current.machine, approvedRoutes: null } },
    { ...current, machine: { ...current.machine, approvedRoutes: ["bad"] } },
    { ...current, machine: { ...current.machine, effectiveRoutes: ["192.168.1.0/24"] } },
    { ...current, machine: { ...current.machine, approvedRoutes: Array(257).fill("10.0.0.0/8") } },
    { ...current, machine: { ...current.machine, stableId: "different" } }])("rejects malformed snapshots or a replacement device", async (invalid) => {
    respond(invalid); await expect(getRouteConfiguration("route-42")).rejects.toThrow("格式异常");
  });
  it("keeps failures distinct from an empty network and rejects duplicate overview nodes", async () => {
    respond({ ...current, items: [] }); expect((await getRouteOverview()).items).toEqual([]);
    respond({ ...current, items: [current, current] }); await expect(getRouteOverview()).rejects.toThrow("格式异常");
    respond({ error: "unavailable" }, 503); await expect(getRouteOverview()).rejects.toMatchObject({ status: 503 });
  });
  it("retains conflict errors and never sends an automatic retry", async () => {
    respond({ error: "ROUTES_CHANGED: stale revision" }, 409);
    await expect(saveRouteConfiguration("route-42", current.revision, { approve: [], unapprove: ["10.0.0.0/8"] }, current.csrf_token)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(errorMessage(new ApiError(409, "ROUTES_CHANGED: stale revision"))).toContain("草稿保留");
  });
});

describe("reported exit selections", () => {
  const client = { nodeId: 7, stableId: "phone-7", hostname: "Phone", owner: "alice", online: false };
  const node = { nodeId: 42, stableId: "route-42", hostname: "Router", owner: "alice", online: true, announced: true,
    ipv4: "100.100.1.2", clientCount: 1, clients: [client] };
  const payload = { exitNodes: [node], clients: [{ ...client, exitNodeStableId: node.stableId, resolved: true, exitNodeHostname: node.hostname },
    { ...client, nodeId: 8, stableId: "lost-8", exitNodeStableId: "deleted", resolved: false }] };
  it("retains unresolved client reports instead of hiding stale selections", async () => {
    respond(payload); expect(await getExitOverview()).toEqual(payload);
    respond({ exitNodes: [], clients: [] }); expect((await getExitOverview()).clients).toEqual([]);
  });
  it.each([{}, { exitNodes: null, clients: [] }, { ...payload, clients: null },
    { ...payload, exitNodes: [{ ...node, clientCount: 2 }] },
    { ...payload, exitNodes: [{ ...node, ipv4: "127.0.0.1; echo unsafe" }] },
    { ...payload, exitNodes: [node, node] }])("rejects a missing or inconsistent exit view", async (invalid) => {
    respond(invalid); await expect(getExitOverview()).rejects.toThrow("格式异常");
  });
});
