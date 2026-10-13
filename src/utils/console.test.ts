import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleBase, consolePath, workspaceURL } from "./console";

afterEach(() => vi.unstubAllGlobals());

describe("shared tenant console routing", () => {
  it("accepts a single validated organization component only", () => {
    expect(consoleBase("/t/alice/dashboard")).toBe("/t/alice");
    for (const path of ["/dashboard", "/t/../devices", "/t/a%2fb/login", "/t/ALICE/login", "/t/alice-extra-extra-extra-extra-extra-extra/login"]) {
      expect(consoleBase(path)).toBe("");
    }
  });
  it("scopes requests and identity links to the current workspace", () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example.test:9090", pathname: "/t/alice/login" } });
    expect(consolePath("/api/v1/auth/session")).toBe("/t/alice/api/v1/auth/session");
    expect(workspaceURL("https://app.example.test:9090", "bob")).toBe("/t/bob");
    for (const origin of ["https://other.example.test:9090", "https://app.example.test:9090/path", "https://user@app.example.test:9090"]) {
      expect(() => workspaceURL(origin, "bob")).toThrow();
    }
    for (const org of ["../bob", "bob/anything", "", "bob?token=secret"]) {
      expect(() => workspaceURL("https://app.example.test:9090", org)).toThrow();
    }
  });
});
