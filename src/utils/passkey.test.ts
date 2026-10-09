import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { PasskeyCreationOptionsJSON, PasskeyRequestOptionsJSON } from "../api/types";
import { createPasskey, creationOptions, decodeBase64Url, encodeBase64Url, getPasskey, passkeyAvailability, passkeyErrorMessage, requestOptions } from "./passkey";

const creation: PasskeyCreationOptionsJSON = {
  rp: { id: "localhost", name: "玄序" }, user: { id: "AQI", name: "alice", displayName: "Alice" },
  challenge: "_wAB", pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  excludeCredentials: [{ type: "public-key", id: "AwQ", transports: ["internal"] }],
};
const request: PasskeyRequestOptionsJSON = {
  challenge: "_wAB", rpId: "localhost", userVerification: "required",
  allowCredentials: [{ type: "public-key", id: "AwQ", transports: ["internal"] }],
};
const credentials = { create: vi.fn(), get: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { credentials });
  vi.stubGlobal("PublicKeyCredential", class {});
  credentials.create.mockReset();
  credentials.get.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("通行密钥浏览器适配", () => {
  it("拒绝非安全环境并解释原因", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    expect(passkeyAvailability()).toMatchObject({ supported: false, reason: expect.stringContaining("HTTPS") });
  });

  it("检测浏览器支持，而不是只检测某一类指纹认证器", () => {
    expect(passkeyAvailability().supported).toBe(true);
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(passkeyAvailability().supported).toBe(false);
  });

  it("对全部字节进行无填充 base64url 往返", () => {
    const buffer = Uint8Array.from({ length: 256 }, (_, index) => index).buffer;
    const encoded = encodeBase64Url(buffer);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(new Uint8Array(decodeBase64Url(encoded))).toEqual(new Uint8Array(buffer));
    expect(encodeBase64Url(new ArrayBuffer(0))).toBe("");
  });

  it("解码创建参数但不改变服务端快照", () => {
    const snapshot = JSON.stringify(creation);
    const options = creationOptions(creation);
    expect([...new Uint8Array(options.challenge as ArrayBuffer)]).toEqual([255, 0, 1]);
    expect([...new Uint8Array(options.user.id as ArrayBuffer)]).toEqual([1, 2]);
    expect([...new Uint8Array(options.excludeCredentials![0]!.id as ArrayBuffer)]).toEqual([3, 4]);
    expect(options.excludeCredentials![0]!.transports).toEqual(["internal"]);
    expect(JSON.stringify(creation)).toBe(snapshot);
  });

  it("解码登录参数，允许无用户名登录省略凭据列表", () => {
    const options = requestOptions(request);
    expect([...new Uint8Array(options.allowCredentials![0]!.id as ArrayBuffer)]).toEqual([3, 4]);
    expect(options.userVerification).toBe("required");
    expect(requestOptions({ challenge: "AQI" }).allowCredentials).toBeUndefined();
    expect(request.challenge).toBe("_wAB");
  });

  it("序列化创建响应及认证器传输方式", async () => {
    credentials.create.mockResolvedValue({
      id: "credential", rawId: decodeBase64Url("AwQ"), type: "public-key", authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
      response: { clientDataJSON: decodeBase64Url("AQI"), attestationObject: decodeBase64Url("BQY"), getTransports: () => ["internal"] },
    });
    const controller = new AbortController();
    expect(await createPasskey(creation, controller.signal)).toEqual({
      id: "credential", rawId: "AwQ", type: "public-key", authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: "AQI", attestationObject: "BQY", transports: ["internal"] },
    });
    expect(credentials.create.mock.calls[0]![0].signal).toBe(controller.signal);
  });

  it("序列化断言并保持缺失 userHandle 为 null", async () => {
    credentials.get.mockResolvedValue({
      id: "credential", rawId: decodeBase64Url("AwQ"), type: "public-key", authenticatorAttachment: null,
      getClientExtensionResults: () => ({}),
      response: { clientDataJSON: decodeBase64Url("AQI"), authenticatorData: decodeBase64Url("BQY"), signature: decodeBase64Url("Bwg"), userHandle: null },
    });
    expect((await getPasskey(request, new AbortController().signal)).response).toEqual({
      clientDataJSON: "AQI", authenticatorData: "BQY", signature: "Bwg", userHandle: null,
    });
  });

  it("不把空认证器响应当作已验证凭据", async () => {
    credentials.create.mockResolvedValue(null);
    await expect(createPasskey(creation, new AbortController().signal)).rejects.toThrow("没有取得");
    credentials.get.mockResolvedValue({ type: "password" });
    await expect(getPasskey(request, new AbortController().signal)).rejects.toThrow("没有取得");
  });

  it("展示取消、域名不匹配与服务端失败的中文提示", () => {
    expect(passkeyErrorMessage(new DOMException("cancel", "NotAllowedError"))).toContain("操作已取消");
    expect(passkeyErrorMessage(new DOMException("duplicate", "InvalidStateError"))).toContain("已经保存");
    expect(passkeyErrorMessage(new DOMException("origin", "SecurityError"))).toContain("RP ID");
    expect(passkeyErrorMessage(new DOMException("aborted", "AbortError"))).toContain("已取消");
    expect(passkeyErrorMessage(new ApiError(500, "PASSKEY_SAVE_FAILED: retry"))).toContain("未能保存");
  });
});
