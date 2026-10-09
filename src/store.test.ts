import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { session } from "./store";

const fetchMock = vi.fn<typeof fetch>();
const user = { id: 1, login_name: "alice", display_name: "Alice", email: "", role: "owner", created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z" };

function respond(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
}

beforeEach(() => {
  session.forget();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { origin: "https://alice.example.test" } });
});

afterEach(() => {
  session.forget();
  vi.unstubAllGlobals();
});

describe("account session state", () => {
  it("updates the nickname without dropping the tenant or capabilities", async () => {
    respond({ authenticated: true, user, tenant: { id: "alice" }, capabilities: ["audit"] });
    await session.login("alice", "test password");
    respond({ user: { ...user, display_name: "新昵称" }, password_change_enabled: true, csrf_token: "csrf" });
    await session.updateProfile({ display_name: "新昵称" }, "csrf");
    expect(session.state.user?.displayName).toBe("新昵称");
    expect(session.state.tenant?.id).toBe("alice");
    expect(session.state.capabilities).toEqual(["audit"]);
  });

  it("clears identity and tenant state immediately after password revocation", async () => {
    respond({ authenticated: true, user, tenant: { id: "alice" }, capabilities: ["audit"] });
    await session.login("alice", "test password");
    session.forget();
    expect(session.state.authenticated).toBe(false);
    expect(session.state.user).toBeNull();
    expect(session.state.tenant).toBeNull();
    expect(session.state.capabilities).toEqual([]);
  });

  it("does not apply a response for a different account", async () => {
    respond({ authenticated: true, user });
    await session.login("alice", "test password");
    respond({ user: { ...user, id: 2, login_name: "bob" }, password_change_enabled: false, csrf_token: "other-csrf" });
    await expect(session.updateProfile({ display_name: "new name" }, "csrf")).rejects.toThrow("当前会话已变更");
    expect(session.state.user?.loginName).toBe("alice");
  });
});
