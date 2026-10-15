import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginAccountPasskeyLogin, finishAccountPasskeyLogin, loginAccount, signupTenant } from "./endpoints";
import { api } from "./client";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "https://app.example.test", pathname: "/login" } });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("ordinary account signup and login", () => {
  it("统一通行密钥按用户名发起，并校验服务端确认的账户网络", async () => {
    const credential = { id: "credential", rawId: "AQI", type: "public-key" as const, authenticatorAttachment: null, clientExtensionResults: {}, response: { clientDataJSON: "AQI", signature: "AQI" } };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ options: { publicKey: { challenge: "AQI" } } })));
    await beginAccountPasskeyLogin("alice");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ console_path: "/t/alice", session: { authenticated: true, tenant: { organization_id: "alice" } } })));
    expect(await finishAccountPasskeyLogin("alice", credential)).toEqual({ path: "/t/alice", passwordChangeRequired: false });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://app.example.test/api/self-service/v1/passkey/begin");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://app.example.test/api/self-service/v1/passkey/finish");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ login: "alice", credential });
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).search).toBe("");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ console_path: "/t/alice", session: { authenticated: true, tenant: { organization_id: "bob" } } })));
    await expect(finishAccountPasskeyLogin("alice", credential)).rejects.toThrow("API_RESPONSE_INVALID");
  });
  it("routes by authenticated account without asking for a network identifier", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ console_path: "/t/alice", session: { authenticated: true, tenant: { organization_id: "alice" } } })));
    expect(await loginAccount("/api/self-service/v1/login", "owner", "private-password")).toEqual({ path: "/t/alice", passwordChangeRequired: false });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://app.example.test/api/self-service/v1/login");
    expect(JSON.parse(String(options?.body))).toEqual({ login: "owner", password: "private-password" });
    expect(String(url)).not.toContain("private-password");
  });
  it("rejects credentials sent to a foreign site or unrecognized endpoint", async () => {
    await expect(loginAccount("https://foreign.example.test", "owner", "private-password")).rejects.toThrow();
    await expect(loginAccount("/api/v1/auth/login", "owner", "private-password")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a successful but wrong-tenant acknowledgement", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ console_path: "/t/alice", session: { authenticated: true, tenant: { organization_id: "bob" } } })));
    await expect(loginAccount("/api/self-service/v1/login", "owner", "private-password")).rejects.toThrow();
  });
  it("never automatically redirects a signup to an unvalidated console", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ authenticated: true, handoff: true,
      organization: { id: "alice", domain: "alice.old.example.test", url: "https://alice.old.example.test", console_url: "https://foreign.example.test/dashboard" },
      user: { login_name: "owner" },
    })));
    await expect(signupTenant("/api/self-service/v1/signup", { login: "owner", password: "private-password", email: "", display_name: "" })).rejects.toThrow("REGISTRATION_OUTCOME_UNKNOWN");
  });
  it("scopes API calls to the current console rather than the portal database", async () => {
    window.location.pathname = "/t/alice/dashboard";
    fetchMock.mockResolvedValue(new Response("{}"));
    await api("/api/v2/network/addresses");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://app.example.test/t/alice/api/v2/network/addresses");
  });
});
