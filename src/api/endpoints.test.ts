import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "./endpoints";
import type { PlanPayload, SnapshotPayload } from "./types";

const freePlan: PlanPayload = {
  id: "free",
  name: "Free",
  price_cents: 0,
  currency: "CNY",
  billing_cycle: "",
  unlimited: false,
  max_devices: 10,
  max_users: 1,
  max_routes: 4,
  max_auth_keys: 3,
  devices_used: 2,
  allow_custom_cidr: false,
  allow_exit_node: false,
  allow_subnet_router: true,
  allow_api: false,
  allow_acl: true,
  allow_grants: false,
  allow_custom_dns: false,
  allow_audit_log: true,
  allow_multi_member: false,
  network_prefix: "100.100.1.0/24",
  network_ranges: ["100.100.1.0/24", "fd7a:115c:a1e0::/48"],
};

const ownerSession: SnapshotPayload = {
  authenticated: true,
  user: {
    id: 1,
    login_name: "alice",
    display_name: "我的网络",
    email: "alice@example.test",
    role: "owner",
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
  },
  session: {
    id: "session-alice",
    auth_method: "local",
    created_at: "2026-10-09T00:00:00Z",
    expires_at: "2026-10-10T00:00:00Z",
  },
  tenant: { id: "alice", organization_id: "alice", organization_name: "我的网络" },
  plan: freePlan,
  capabilities: ["auth.password", "audit"],
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("window", { location: { origin: "https://alice.example.test" } });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

describe("control plane response contracts", () => {
  it("loads an owner session with usable account, quota and tenant fields", async () => {
    respond(ownerSession);
    const snapshot = await endpoints.getSession();
    expect(snapshot.user).toMatchObject({ loginName: "alice", displayName: "我的网络", role: "owner" });
    expect(snapshot.session).toMatchObject({ id: "session-alice", authMethod: "local" });
    expect(snapshot.tenant).toMatchObject({ organizationId: "alice", organizationName: "我的网络" });
    expect(snapshot.plan).toMatchObject({ maxDevices: 10, devicesUsed: 2, allowApi: false, networkPrefix: "100.100.1.0/24" });
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
  });

  it("preserves anonymous setup and local-login restrictions", async () => {
    respond({ authenticated: false, setup_required: true, local_login: false, registration: "closed" });
    expect(await endpoints.getSession()).toMatchObject({
      authenticated: false, setupRequired: true, localLogin: false, registration: "closed",
    });
  });

  it("applies the same contract after sign-in and invitation signup", async () => {
    respond(ownerSession);
    respond(ownerSession);
    expect((await endpoints.login("alice", "test password")).user?.loginName).toBe("alice");
    expect((await endpoints.signup({
      invite: "invitation", login: "alice", display_name: "我的网络", email: "", password: "test password",
    })).plan?.maxUsers).toBe(1);
  });

  it("loads an unlimited plan without inventing finite quotas or a CIDR", async () => {
    respond({ ...freePlan, id: "unlimited", unlimited: true, max_devices: -1, network_prefix: undefined, network_ranges: undefined });
    expect(await endpoints.getPlan()).toMatchObject({ unlimited: true, maxDevices: -1, networkPrefix: undefined });
  });

  it("loads session-list IDs and timestamps from the identity API", async () => {
    respond({ sessions: [{
      ID: "session-alice", UserID: 1, AuthMethod: "local",
      CreatedAt: "2026-10-09T00:00:00Z", ExpiresAt: "2026-10-10T00:00:00Z",
      LastSeenAt: "2026-10-09T01:00:00Z", RevokedAt: "0001-01-01T00:00:00Z", RevokedReason: "",
    }] });
    expect(await endpoints.listSessions()).toEqual([{
      id: "session-alice", authMethod: "local", createdAt: "2026-10-09T00:00:00Z",
      expiresAt: "2026-10-10T00:00:00Z", lastSeenAt: "2026-10-09T01:00:00Z",
      revokedAt: undefined, revokedReason: "",
    }]);
  });

  it("loads audit actions, targets and actors without blank table cells", async () => {
    respond({ events: [{ ID: 5, Time: "2026-10-09T01:00:00Z", Actor: "user:1", Action: "node.approved", Target: "node:2", Detail: "approved" }] });
    expect(await endpoints.listAudit()).toEqual([{
      id: 5, time: "2026-10-09T01:00:00Z", actor: "user:1", action: "node.approved", resource: "node:2", detail: "approved",
    }]);
  });

  it("accepts empty session and audit listings", async () => {
    respond({ sessions: null });
    respond({ events: null });
    expect(await endpoints.listSessions()).toEqual([]);
    expect(await endpoints.listAudit()).toEqual([]);
  });

  it("keeps already-camel-case machine and member responses unchanged", async () => {
    const machine = { id: 2, userLoginName: "alice", hostname: "laptop", lastSeen: "2026-10-09T01:00:00Z" };
    const user = { id: 1, loginName: "alice", displayName: "我的网络", role: "owner" };
    respond({ machines: [machine] });
    respond({ users: [user] });
    expect(await endpoints.listMachines()).toEqual([machine]);
    expect(await endpoints.listUsers()).toEqual([user]);
  });
});
