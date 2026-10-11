import { describe, expect, it } from "vitest";
import { deviceInstallCommand, type DeviceInstallOptions } from "./device-install";
import { coreNavigation, managementNavigation } from "./navigation";

const options: DeviceInstallOptions = { platform: "linux", installClient: true, acceptDNS: true, acceptRoutes: false,
  hostname: "", advertiseSubnets: false, routes: "", advertiseExitNode: false };
const permissions = { allowSubnetRouter: true, allowExitNode: true, maxRoutes: 10 };

describe("device installation and core-first navigation", () => {
  it("downloads the official installer before running it and emits no enrollment secret", () => {
    const command = deviceInstallCommand("https://tenant.example.test:9090", options, permissions);
    expect(command).toContain("https://tailscale.com/install.sh -o");
    expect(command).toContain("--login-server=\"https://tenant.example.test:9090\"");
    expect(command).toContain("--accept-dns=true --accept-routes=false");
    expect(command).not.toContain("| sh");
    expect(command).not.toMatch(/--auth-key|--reset|--force-reauth|curl -k|insecure/);
  });
  it("changes selected arguments and masks subnet host bits without shell interpolation", () => {
    const command = deviceInstallCommand("https://tenant.example.test", { ...options, installClient: false,
      hostname: "home-server", acceptDNS: false, acceptRoutes: true, advertiseSubnets: true,
      routes: "192.168.1.2/24,192.168.1.0/24,10.10.0.0/24", advertiseExitNode: true }, permissions);
    expect(command).toContain('--hostname="home-server"');
    expect(command).toContain('--advertise-routes="192.168.1.0/24,10.10.0.0/24"');
    expect(command).toContain("--advertise-exit-node");
    expect(command).not.toContain("curl");
  });
  it.each(["$(touch bad)", "name; echo bad", "bad\nname", "bad'quote", "bad`quote"])('rejects unsafe hostname %s', (hostname) => {
    expect(() => deviceInstallCommand("https://tenant.example.test", { ...options, hostname }, permissions)).toThrow("设备名称");
  });
  it.each(["0.0.0.0/0", "300.0.0.1/24", "192.168.1.0/24;echo", "", "10.0.0.0/999"])('rejects invalid advertised subnet %s', (routes) => {
    expect(() => deviceInstallCommand("https://tenant.example.test", { ...options, advertiseSubnets: true, routes }, permissions)).toThrow();
  });
  it("uses capabilities and route quotas instead of plan-name branches", () => {
    expect(() => deviceInstallCommand("https://tenant.example.test", { ...options, advertiseExitNode: true }, { ...permissions, allowExitNode: false })).toThrow("出口节点");
    expect(() => deviceInstallCommand("https://tenant.example.test", { ...options, advertiseSubnets: true, routes: "10.0.0.0/24" }, { ...permissions, allowSubnetRouter: false })).toThrow("子网路由");
    expect(() => deviceInstallCommand("https://tenant.example.test", { ...options, advertiseExitNode: true }, { ...permissions, maxRoutes: 1 })).toThrow("额度");
  });
  it.each(["https://user:secret@tenant.example.test", "https://tenant.example.test/?token=secret", "https://tenant.example.test/path", "javascript:bad"])('rejects invalid server root %s', (url) => {
    expect(() => deviceInstallCommand(url, options, permissions)).toThrow();
  });
  it("does not render a Linux shell command for phones or install Linux on Windows", () => {
    expect(deviceInstallCommand("https://tenant.example.test", { ...options, platform: "android" }, permissions)).toBe("");
    expect(deviceInstallCommand("https://tenant.example.test", { ...options, platform: "ios" }, permissions)).toBe("");
    expect(deviceInstallCommand("https://tenant.example.test", { ...options, platform: "windows" }, permissions)).not.toContain("curl");
  });
  it("keeps core functions first without deleting secondary routes or exposing owner configuration", () => {
    expect(coreNavigation.map((item) => item.to)).toEqual(["/dashboard", "/devices", "/network", "/permissions", "/dns", "/routes", "/relays"]);
    expect(managementNavigation("owner").some((item) => item.to === "/authentication")).toBe(true);
    expect(managementNavigation("member").some((item) => item.to === "/authentication")).toBe(false);
    expect(managementNavigation("owner").some((item) => item.to === "/settings")).toBe(true);
  });
});
