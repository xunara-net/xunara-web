import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDERP, listExitNodes, listManagedRelays, listRoutes, listUsers } from "./endpoints";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function response(payload: unknown): void {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
}

describe("network API contracts", () => {
  it("reads enrolled DERP records rather than client Peer Relay grants", async () => {
    const relay = { id: "relay-one", name: "上海", hostname: "relay.example.test", desiredState: "online", online: true, healthy: false };
    response({ items: [relay], used: 1, limit: 1 });
    expect(await listManagedRelays()).toEqual([relay]);
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toBe("https://tenant.example.test/api/v2/relays/enrolled");
  });

  it("rejects the wrong relay contract and malformed records", async () => {
    for (const payload of [{ relays: [], grants: [] }, { items: [{ id: "missing-state" }] }, { items: false }]) {
      response(payload);
      await expect(listManagedRelays()).rejects.toThrow("格式异常");
    }
  });

  it("does not interpret missing list fields as zero resources", async () => {
    for (const load of [listRoutes, listExitNodes, listUsers]) {
      response({});
      await expect(load()).rejects.toThrow("格式异常");
    }
  });

  it("accepts server-confirmed empty and null lists", async () => {
    for (const value of [[], null]) {
      response({ routes: value });
      expect(await listRoutes()).toEqual([]);
      response({ exitNodes: value });
      expect(await listExitNodes()).toEqual([]);
      response({ items: value });
      expect(await listManagedRelays()).toEqual([]);
    }
  });

  it("never infers configured DERP from an unknown response", async () => {
    response({});
    await expect(getDERP()).rejects.toThrow("格式异常");
    response({ mapConfigured: false, regionsServed: 0 });
    expect(await getDERP()).toEqual({ mapConfigured: false, regionsServed: 0 });
    response({ mapConfigured: true, regionsServed: -1 });
    await expect(getDERP()).rejects.toThrow("格式异常");
  });
});
