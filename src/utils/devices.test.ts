import { describe, expect, it } from "vitest";
import type { AuthKey, Machine } from "../api/types";
import { authorizationLabel, authKeyStatus, canManageNetwork, clientLoginCommand, filterDevices, routeChanges } from "./devices";

const laptop = { id: 1, stableId: "node-1", hostname: "Laptop", online: true, expired: false, ipv4: "100.100.1.2", os: "linux", tags: ["tag:server"] } as Machine;
const phone = { ...laptop, id: 2, hostname: "Phone", online: false, os: "android", tags: [], approvedRoutes: ["10.0.0.0/24"] };
const expired = { ...laptop, id: 3, expired: true };

describe("device workbench", () => {
  it("limits network controls to actual backend write roles", () => {
    expect(["owner", "admin", "member", "viewer", undefined].map(canManageNetwork)).toEqual([true, true, false, false, false]);
  });
  it("searches names, addresses, operating systems and tags without mutating records", () => {
    for (const query of [" LAPTOP ", "100.100.1.2", "LINUX", "tag:server", "node-1"]) {
      expect(filterDevices([laptop], query, "all")).toEqual([laptop]);
    }
    expect(filterDevices([laptop, phone], "missing", "all")).toEqual([]);
  });
  it("separates expired devices from ordinary online/offline and includes inactive approved routes", () => {
    const devices = [laptop, phone, expired];
    expect(filterDevices(devices, "", "online")).toEqual([laptop]);
    expect(filterDevices(devices, "", "offline")).toEqual([phone]);
    expect(filterDevices(devices, "", "expired")).toEqual([expired]);
    expect(filterDevices(devices, "", "router")).toEqual([phone]);
  });
  it("produces route changes and leaves unchanged permissions intact", () => {
    expect(routeChanges(["10.0.0.0/24", "10.1.0.0/24"], ["10.1.0.0/24", "10.2.0.0/24", "10.2.0.0/24"]))
      .toEqual({ approve: ["10.2.0.0/24"], unapprove: ["10.0.0.0/24"] });
    expect(routeChanges(["10.0.0.0/24"], ["10.0.0.0/24"])).toEqual({ approve: [], unapprove: [] });
  });
  it("labels authorization rather than claiming a direct network connection", () => {
    expect(authorizationLabel("authkey")).toBe("预授权密钥");
    expect(authorizationLabel("")).toBe("未上报");
  });
  it("does not mark expired or spent single-use auth keys available", () => {
    const key = { reusable: false, used: true } as AuthKey;
    expect(authKeyStatus(key)).toBe("已使用");
    expect(authKeyStatus({ ...key, reusable: true })).toBe("可用");
    expect(authKeyStatus({ ...key, expiry: "2020-01-01T00:00:00Z" })).toBe("已过期");
  });
});

describe("official client instructions", () => {
  it("generates platform commands only for a valid configured origin", () => {
    expect(clientLoginCommand("http://tenant.test:9090", "linux")).toBe('sudo tailscale up --login-server="http://tenant.test:9090"');
    expect(clientLoginCommand("https://tenant.test", "windows")).toBe('tailscale up --login-server="https://tenant.test"');
    expect(clientLoginCommand("https://tenant.test", "macos")).toContain("tailscale login");
    expect(clientLoginCommand("https://tenant.test", "android")).toBe("");
  });
  it.each(["javascript:alert(1)", "https://user:secret@tenant.test", "https://tenant.test/?secret=1", "https://tenant.test/path", "https://tenant.test/#a", "https://$(command).test"])("rejects unsafe command input %s", (url) => {
    expect(() => clientLoginCommand(url, "linux")).toThrow();
  });
});
