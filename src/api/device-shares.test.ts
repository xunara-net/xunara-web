import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeDeviceShare, createDeviceShare, getDeviceShares, shareRecipientLogin, type DeviceShare, type DeviceShares } from "./device-shares";

const share: DeviceShare = { id: "shr_" + "a".repeat(24), status: "pending", direction: "outgoing", node: { stableId: "node-1", hostname: "laptop" },
  sourceOrganization: "alice", targetOrganization: "bob", createdBy: "alice", targetUser: "bob", createdAt: "2026-10-15T00:00:00Z", available: true, can_decide: false, can_revoke: true, online: false };
const payload: DeviceShares = { enabled: true, can_manage: true, tailnet_locked: false, csrf_token: "test-csrf", items: [share] };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("window", { location: { origin: "https://platform.test", pathname: "/t/alice/shares" } }); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
function respond(value: unknown, status = 200) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })); }

describe("account-directed device sharing", () => {
  it("keeps requests in the selected console and credentials out of URLs", async () => {
    respond(payload); expect(await getDeviceShares()).toEqual(payload);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://platform.test/t/alice/api/v2/device-shares");
    respond(share, 201); expect(await createDeviceShare("node-1", " BOB ", "test-csrf")).toEqual(share);
    const [url, options] = fetchMock.mock.calls[1]!;
    expect(new URL(String(url)).search).toBe("");
    expect(options?.headers).toMatchObject({ "X-CSRF-Token": "test-csrf" });
    expect(JSON.parse(String(options?.body))).toEqual({ node: "node-1", recipient_login: "BOB" });
    expect(options?.credentials).toBe("same-origin");
  });
  it("confirms exactly the requested lifecycle action", async () => {
    respond({ ...share, direction: "incoming", status: "accepted", can_revoke: true, ipv4: "100.127.0.1" });
    expect((await changeDeviceShare(share.id, "accept", "csrf")).status).toBe("accepted");
    expect(String(fetchMock.mock.calls[0]?.[0]).endsWith(share.id+"/accept")).toBe(true);
    respond({ ...share, status: "revoked", can_revoke: false }); await changeDeviceShare(share.id, "revoke", "csrf");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
    respond({ ...share, status: "rejected", can_revoke: false }); await expect(changeDeviceShare(share.id, "accept", "csrf")).rejects.toThrow("未确认");
  });
  it("refuses missing csrf before any network mutation", async () => {
    await expect(createDeviceShare("node-1", "bob", "")).rejects.toThrow("会话未确认");
    await expect(changeDeviceShare(share.id, "accept", "")).rejects.toThrow("会话未确认");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{}, { ...payload, enabled: false }, { ...payload, tailnet_locked: true }, { ...payload, csrf_token: "" }, { ...payload, items: null },
    { ...payload, items: [share, share] }, { ...payload, items: [{ ...share, can_decide: true }] }, { ...payload, items: [{ ...share, createdAt: "bad" }] },
    { ...payload, items: [{ ...share, ipv4: "100.127.0.1" }] }])("rejects malformed or contradictory response %j", async (invalid) => {
    respond(invalid); await expect(getDeviceShares()).rejects.toThrow();
  });
  it("keeps failed reads unknown, rather than claiming no invitations", async () => {
    respond({ error: "SHARES_UNAVAILABLE: unavailable" }, 503);
    await expect(getDeviceShares()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not auto-retry an ambiguous mutation", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network lost"));
    await expect(createDeviceShare("node-1", "bob", "csrf")).rejects.toThrow("network lost");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("validates the recipient and exact returned device/account", async () => {
    for (const invalid of ["", "a b", "a\nb", "a".repeat(129)]) expect(() => shareRecipientLogin(invalid)).toThrow();
    expect(shareRecipientLogin(" 用户 ")).toBe("用户");
    respond({ ...share, targetUser: "wrong" }); await expect(createDeviceShare("node-1", "bob", "csrf")).rejects.toThrow("未确认");
    respond({ ...share, node: { stableId: "another" } }); await expect(createDeviceShare("node-1", "bob", "csrf")).rejects.toThrow("未确认");
  });
});
