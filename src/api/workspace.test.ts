import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginWorkspace, signupTenant } from "./endpoints";
import { api } from "./client";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "https://app.example.test", pathname: "/login" } });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("explicit workspace signup and login", () => {
  it("signs in only to the selected organization without global username lookup", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ authenticated: true, tenant: { organization_id: "alice" } })));
    expect(await loginWorkspace("https://app.example.test", "alice", "owner", "private-password")).toBe("/t/alice");
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://app.example.test/t/alice/api/v1/auth/login");
    expect(JSON.parse(String(options?.body))).toEqual({ login: "owner", password: "private-password" });
    expect(String(url)).not.toContain("private-password");
  });
  it("rejects credentials sent to a foreign site or malformed organization", async () => {
    await expect(loginWorkspace("https://foreign.example.test", "alice", "owner", "private-password")).rejects.toThrow();
    await expect(loginWorkspace("https://app.example.test", "../alice", "owner", "private-password")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a successful but wrong-tenant acknowledgement", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ authenticated: true, tenant: { organization_id: "bob" } })));
    await expect(loginWorkspace("https://app.example.test", "alice", "owner", "private-password")).rejects.toThrow();
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
