import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideBrowserAuthorization, deviceNextPath, getBrowserAuthorization, getDeviceFlow, getSetupState, loginDeviceFlow, setupAdministrator } from "./browser-authorization";

const fetchMock = vi.fn<typeof fetch>();
const id = "a".repeat(32);
const detail = {
  id, state: "pending", hostname: "我的电脑", os: "windows", created_at: "2026-10-16T00:00:00Z", expires_at: "2026-10-16T00:15:00Z",
  ephemeral: false, requested_tags: [], login_name: "alice", organization: "alice", can_write: true, csrf_token: "session-proof",
};
function respond(payload: unknown, status = 200) { fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status })); }

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("window", { location: { origin: "https://app.example.test", pathname: "/t/alice/register/" + id } });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("新版浏览器授权 API", () => {
  it.each(["pending", "approved", "denied", "expired"])("读取 %s 设备状态而不是旧 HTML", async (state) => {
    respond({ ...detail, state });
    expect((await getBrowserAuthorization("device", id)).state).toBe(state);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://app.example.test/t/alice/api/v1/browser/device-authorizations/" + id);
  });
  it.each([
    { ...detail, id: "different" }, { ...detail, state: "unknown" }, { ...detail, can_write: undefined },
    { ...detail, csrf_token: "" }, { ...detail, requested_tags: null }, { ...detail, created_at: "bad-date" },
  ])("响应不完整时不能启用审批", async (payload) => {
    respond(payload);
    await expect(getBrowserAuthorization("device", id)).rejects.toMatchObject({ errorCode: "API_RESPONSE_INVALID" });
  });
  it.each([true, false])("决定仅以 JSON 和会话绑定请求头提交", async (approve) => {
    respond({ id, state: approve ? "approved" : "denied" });
    await decideBrowserAuthorization("device", id, "private-proof", approve);
    const [target, options] = fetchMock.mock.calls[0]!;
    expect(String(target)).not.toContain("private-proof");
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("private-proof");
    expect(options?.body).toBe("{}");
  });
  it("超时、旧 HTML 与未知决定不能显示为授权成功", async () => {
    respond({ id, state: "pending" });
    await expect(decideBrowserAuthorization("device", id, "proof", true)).rejects.toMatchObject({ errorCode: "API_RESPONSE_INVALID" });
    fetchMock.mockResolvedValue(new Response("<form>old</form>"));
    await expect(getBrowserAuthorization("device", id)).rejects.toMatchObject({ errorCode: "API_RESPONSE_INVALID" });
  });
  it("保留 SSH 来源、目标与系统账户，已领取状态不代表连接建立", async () => {
    respond({ ...detail, session: { id, state: "consumed", localUser: "root", src: { nodeId: 1, hostname: "笔记本" }, dst: { nodeId: 2 }, createdAt: detail.created_at, expiresAt: detail.expires_at } });
    expect(await getBrowserAuthorization("ssh", id)).toMatchObject({ state: "consumed", source: "笔记本", destination: "设备 #2", local_user: "root" });
  });
  it("未登录与暂时不可用保持不同状态", async () => {
    respond({ error: "authentication required" }, 401);
    await expect(getBrowserAuthorization("device", id)).rejects.toMatchObject({ status: 401 });
    respond({ error: "AUTH_UNAVAILABLE: try again" }, 503);
    await expect(getBrowserAuthorization("device", id)).rejects.toMatchObject({ status: 503 });
  });
});

describe("账户选择与初始化", () => {
  it("只接受确定的同源设备授权跳转", () => {
    expect(deviceNextPath("/t/alice/register/" + id)).toBe("/t/alice/register/" + id);
    expect(deviceNextPath("/devices")).toBe("/devices");
    for (const value of ["https://foreign.test", "//foreign.test", "/\\foreign", "/api/v1/account", "/t/../devices", "/devices?token=private", "/devices#x", "/login"]) {
      expect(() => deviceNextPath(value)).toThrow();
    }
  });
  it("普通账户凭据只在 JSON 正文，表单证明只在请求头", async () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example.test", pathname: "/device/" + id } });
    respond({ hostname: "手机", csrf_token: "proof" });
    expect(await getDeviceFlow(id)).toEqual({ hostname: "手机", csrf_token: "proof" });
    respond({ next_path: "/t/alice/register/" + id });
    expect(await loginDeviceFlow(id, "alice", "private-password", "proof")).toBe("/t/alice/register/" + id);
    const [target, options] = fetchMock.mock.calls[1]!;
    expect(String(target)).toBe("https://app.example.test/api/v1/browser/device-flows/" + id + "/login");
    expect(String(target)).not.toMatch(/private-password|proof/);
    expect(JSON.parse(String(options?.body))).toEqual({ login: "alice", password: "private-password" });
  });
  it("初始化令牌永远不从状态端点读取，也不放 URL", async () => {
    respond({ required: true, csrf_token: "proof" });
    expect(await getSetupState()).toEqual({ required: true, csrf_token: "proof" });
    respond({ authenticated: true });
    await setupAdministrator({ token: "private-bootstrap-proof", login: "owner", password: "private-password", confirm: "private-password", display_name: "", email: "" }, "proof");
    const [target, options] = fetchMock.mock.calls[1]!;
    expect(String(target)).not.toMatch(/private|proof/);
    expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("proof");
    expect(JSON.parse(String(options?.body)).token).toBe("private-bootstrap-proof");
  });
});
