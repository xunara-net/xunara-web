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
  async function signedIn() {
    respond({ authenticated: true, user, session: { id: "current", auth_method: "local" }, tenant: { id: "alice" } });
    await session.login("alice", "test password");
  }

  function sessions(currentId = "current") {
    respond({ sessions: [], current_session_id: currentId, csrf_token: "csrf", generated_at: "2026-10-09T00:00:00Z" });
  }

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

  it("退出使用账户撤销接口，成功后清理快照", async () => {
    await signedIn();
    sessions();
    respond({ revoked_sessions: 1, current_revoked: true });
    await session.logout();
    expect(session.state.authenticated).toBe(false);
    expect(session.state.tenant).toBeNull();
    const [url, options] = fetchMock.mock.calls[2]!;
    expect(String(url)).toBe("https://alice.example.test/api/v1/account/sessions/current");
    expect(options?.method).toBe("DELETE");
    expect(options?.headers).toMatchObject({ "X-CSRF-Token": "csrf" });
  });

  it("网络错误不会只清掉 UI 而留下服务端登录", async () => {
    await signedIn();
    fetchMock.mockRejectedValueOnce(new TypeError("network unavailable"));
    await expect(session.logout()).rejects.toThrow("network unavailable");
    expect(session.state.authenticated).toBe(true);
    expect(session.state.tenant?.id).toBe("alice");
  });

  it("数据库撤销失败时保留当前登录并允许重试", async () => {
    await signedIn();
    sessions();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "SESSION_REVOKE_FAILED: retry" }), { status: 500 }));
    await expect(session.logout()).rejects.toThrow("SESSION_REVOKE_FAILED");
    expect(session.state.authenticated).toBe(true);
    sessions();
    respond({ revoked_sessions: 1, current_revoked: true });
    await session.logout();
    expect(session.state.authenticated).toBe(false);
  });

  it("Cookie 中的账户变更后不误撤销新账户的登录", async () => {
    await signedIn();
    sessions("another-current");
    await expect(session.logout()).rejects.toThrow("当前会话已变更");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session.state.authenticated).toBe(true);
  });

  it("服务端已确认会话过期时清理旧快照", async () => {
    await signedIn();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "authentication required" }), { status: 401 }));
    await session.logout();
    expect(session.state.authenticated).toBe(false);
  });

  it("通行密钥与密码登录共享会话状态", async () => {
    respond({ authenticated: true, user, session: { id: "passkey-session", auth_method: "passkey" }, tenant: { id: "alice" } });
    await session.loginWithPasskey({ id: "credential", rawId: "AQI", type: "public-key", authenticatorAttachment: null, clientExtensionResults: {}, response: { clientDataJSON: "AQI", signature: "AQI" } });
    expect(session.state.session?.authMethod).toBe("passkey");
    expect(session.state.tenant?.id).toBe("alice");
  });
});
