import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginAccountIdentity, beginInvitedIdentity, getAccountIdentities, unlinkAccountIdentity } from "./account-identities";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
function response(body: unknown) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 })); }
const identity = { id: "a".repeat(64), provider_id: "corp", provider_name: "企业账号", email: "user@example.test", display_name: "同事", created_at: "2026-10-11T00:00:00Z", enabled: true };

describe("account identity contracts", () => {
  it("reads server-confirmed bindings and providers", async () => {
    const payload = { items: [identity], providers: [{ id: "corp", name: "企业账号" }], csrf_token: "csrf" };
    response(payload);
    expect(await getAccountIdentities()).toEqual(payload);
  });
  it("does not treat missing metadata as no configured provider", async () => {
    for (const payload of [{}, { items: [], providers: [], csrf_token: "" }, { items: [{ ...identity, enabled: undefined }], providers: [], csrf_token: "csrf" }]) {
      response(payload);
      await expect(getAccountIdentities()).rejects.toThrow("格式异常");
    }
  });
  it("binds with human session CSRF and a provider ID in the body", async () => {
    response({ authorization_url: "https://issuer.example.test/authorize?state=state&code_challenge=pkce" });
    expect(await beginAccountIdentity("corp", "csrf")).toContain("https://issuer.example.test/authorize");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://tenant.example.test/api/v1/account/identities/begin");
    expect(options?.headers).toMatchObject({ "X-CSRF-Token": "csrf" });
    expect(JSON.parse(String(options?.body))).toEqual({ provider_id: "corp" });
  });
  it("never copies an invitation into request or authorization URLs", async () => {
    response({ authorization_url: "https://issuer.example.test/authorize?state=state" });
    const target = await beginInvitedIdentity("corp", "private-invite", "form-proof");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("private-invite");
    expect(target).not.toContain("private-invite");
    expect(JSON.parse(String(options?.body))).toEqual({ provider_id: "corp", invite: "private-invite", registration_token: "form-proof" });
  });
  it("rejects unsafe provider navigation", async () => {
    for (const target of ["javascript:alert(1)", "http://issuer.example.test/authorize", "https://secret@issuer.example.test/authorize", "https://issuer.example.test/#secret", "/unknown"]) {
      response({ authorization_url: target });
      await expect(beginAccountIdentity("corp", "csrf")).rejects.toThrow();
    }
  });
  it("allows isolated loopback OIDC verification", async () => {
    response({ authorization_url: "http://127.0.0.1:3000/authorize?state=state" });
    expect(await beginAccountIdentity("corp", "csrf")).toBe("http://127.0.0.1:3000/authorize?state=state");
  });
  it("requires an explicit unlink session outcome", async () => {
    response({ current_revoked: true });
    expect(await unlinkAccountIdentity(identity.id, "csrf")).toBe(true);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-CSRF-Token": "csrf" });
    response({});
    await expect(unlinkAccountIdentity(identity.id, "csrf")).rejects.toThrow("格式异常");
  });
});
