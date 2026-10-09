import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "./endpoints";
import type { PasskeyCredentialJSON } from "./types";

const fetchMock = vi.fn<typeof fetch>();
const credential: PasskeyCredentialJSON = {
  id: "credential", rawId: "AQI", type: "public-key", authenticatorAttachment: null,
  clientExtensionResults: {}, response: { clientDataJSON: "AQI", signature: "AwQ" },
};
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(status === 204 ? null : JSON.stringify(body), { status }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { origin: "https://alice.example.test" } });
});
afterEach(() => vi.unstubAllGlobals());

describe("通行密钥 API 契约", () => {
  it("读取公开凭据列表和服务端开关", async () => {
    const payload = { enabled: false, csrf_token: "csrf", passkeys: [{ id: "key", name: "笔记本", created_at: "2026-10-09T00:00:00Z" }] };
    respond(payload);
    expect(await endpoints.getAccountPasskeys()).toEqual(payload);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://alice.example.test/api/v1/account/passkeys");
  });

  it("开始注册携带会话 CSRF 头", async () => {
    respond({ options: { publicKey: { challenge: "AQI" } } });
    expect((await endpoints.beginAccountPasskey("csrf")).options.publicKey.challenge).toBe("AQI");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST", headers: { "X-CSRF-Token": "csrf" }, body: "{}" });
  });

  it("注册提交保留 WebAuthn 响应字段且不把它们放进 URL", async () => {
    respond({ passkey: { id: "key", name: "电脑", created_at: "2026-10-09T00:00:00Z" } }, 201);
    expect((await endpoints.finishAccountPasskey("电脑", credential, "csrf")).passkey.id).toBe("key");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).search).toBe("");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "电脑", credential });
    expect(init?.headers).toMatchObject({ "X-CSRF-Token": "csrf" });
  });

  it("删除编码公共 ID，并使用 CSRF 保护", async () => {
    respond(null, 204);
    await endpoints.deleteAccountPasskey("key/segment", "csrf");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://alice.example.test/api/v1/account/passkeys/key%2Fsegment");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "DELETE", headers: { "X-CSRF-Token": "csrf" } });
  });

  it("公开登录完成后读取统一会话快照，不依赖旧 console 跳转", async () => {
    respond({ options: { publicKey: { challenge: "AQI" } } });
    await endpoints.beginPasskeyLogin();
    respond({ authenticated: true, session: { id: "current", auth_method: "passkey" }, tenant: { id: "alice" } });
    expect(await endpoints.finishPasskeyLogin(credential)).toMatchObject({ authenticated: true, session: { authMethod: "passkey" }, tenant: { id: "alice" } });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://alice.example.test/api/v1/auth/passkey/begin");
    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://alice.example.test/api/v1/auth/passkey/finish");
  });

  it("列表和写入失败不伪装为空列表或成功", async () => {
    respond({ error: "PASSKEY_LIST_FAILED: retry" }, 500);
    await expect(endpoints.getAccountPasskeys()).rejects.toThrow("PASSKEY_LIST_FAILED");
    respond({ error: "CSRF_INVALID: reload" }, 403);
    await expect(endpoints.deleteAccountPasskey("key", "stale")).rejects.toThrow("CSRF_INVALID");
  });
});
