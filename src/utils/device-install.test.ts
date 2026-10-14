import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deviceInstallCommand, networkCheckCommand, type DeviceInstallOptions } from "./device-install";
import { coreNavigation, managementNavigation } from "./navigation";

const options: DeviceInstallOptions = { platform: "linux", installClient: true, acceptDNS: true, acceptRoutes: false,
  hostname: "", advertiseSubnets: false, routes: "", advertiseExitNode: false };
const permissions = { allowSubnetRouter: true, allowExitNode: true, maxRoutes: 10 };

describe("standalone read-only network diagnosis", () => {
  it("checks the applied pools without enrollment or privileged network changes", () => {
    const command = networkCheckCommand(["192.168.60.7/24", "100.101.50.0/24", "192.168.60.0/24"], "https://app.example.test/network-check.py");
    expect(command).toContain('python3 - "192.168.60.0/24" "100.101.50.0/24"');
    expect(command.split("\n")).toHaveLength(2);
    expect(command).not.toMatch(/sudo|tailscale up|tailscale set|install.sh|auth-key|curl -k|ip route add/);
    expect(deviceInstallCommand("https://tenant.example.test", { ...options, protectNetwork: true }, {
      ...permissions, networkRanges: ["192.168.60.7/24", "100.101.50.0/24", "192.168.60.0/24"], checkScriptURL: "https://app.example.test/network-check.py",
    })).toContain(command + " &&\n");
  });
  it.each([undefined, [], ["0.0.0.0/0"], ["192.168.60.0/24;echo bad"], Array(130).fill("100.101.50.0/24")])("does not generate a check from unknown or unsafe pools: %s", (ranges) => {
    expect(() => networkCheckCommand(ranges, "https://app.example.test/network-check.py")).toThrow();
  });
  it.each([undefined, "http://app.example.test/network-check.py", "https://user:secret@app.example.test/network-check.py", "https://app.example.test/network-check.py?token=secret", "https://app.example.test/other.py", "https://$(id).example.test/network-check.py", "https://`id`.example.test/network-check.py"])("rejects insecure or interpolated script sources: %s", (source) => {
    expect(() => networkCheckCommand(["100.101.50.0/24"], source)).toThrow();
  });
  it("allows loopback HTTP only for isolated local validation", () => {
    expect(networkCheckCommand(["100.101.50.0/24"], "http://127.0.0.1:8080/network-check.py")).toContain("http://127.0.0.1:8080/network-check.py");
  });
  it.each([
    { name: "download failure", source: "exit 22", status: 22 },
    { name: "detected conflict", source: "printf '%s\\n' 'raise SystemExit(1)'", status: 1 },
    { name: "unconfirmed snapshot", source: "printf '%s\\n' 'raise SystemExit(2)'", status: 2 },
    { name: "successful check", source: "printf '%s\\n' 'raise SystemExit(0)'", status: 0 },
  ])("propagates $name in a real shell before any following action", ({ source, status }) => {
    const directory = mkdtempSync(join(tmpdir(), "xunara-check-shell-"));
    try {
      writeFileSync(join(directory, "curl"), "#!/bin/sh\n" + source + "\n", { mode: 0o700 });
      const command = networkCheckCommand(["100.101.50.0/24"], "https://app.example.test/network-check.py");
      const result = spawnSync("bash", ["-c", command + " && printf 'following-action'"], {
        env: { ...process.env, PATH: directory + ":" + (process.env.PATH ?? "") }, encoding: "utf8", timeout: 5000,
      });
      expect(result.status).toBe(status);
      expect(result.stdout).toBe(status === 0 ? "following-action" : "");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe("device installation and core-first navigation", () => {
  it("stops before installation when a read-only network check fails", () => {
    const command = deviceInstallCommand("https://tenant.example.test", { ...options, protectNetwork: true }, {
      ...permissions, networkRanges: ["100.101.50.0/24", "192.168.60.0/24"], checkScriptURL: "https://app.example.test/network-check.py",
    });
    expect(command).toContain('xunara_check=$(curl -fsSL --max-time 30 "https://app.example.test/network-check.py") &&');
    expect(command).toContain('python3 - "100.101.50.0/24" "192.168.60.0/24" &&');
    expect(command.indexOf("python3 -")).toBeLessThan(command.indexOf("https://tailscale.com/install.sh"));
    expect(command).not.toContain("curl -k");
    expect(() => deviceInstallCommand("https://tenant.example.test", { ...options, protectNetwork: true }, permissions)).toThrow();
  });
  it("combines the official installer and browser enrollment in two short lines", () => {
    const command = deviceInstallCommand("https://tenant.example.test:9090", options, permissions);
    expect(command).toContain("curl -fsSL https://tailscale.com/install.sh | sh");
    expect(command).toContain("--login-server=\"https://tenant.example.test:9090\"");
    expect(command).toContain("bash -o pipefail");
    expect(command.split("\n")).toHaveLength(2);
    expect(command).not.toMatch(/--accept-dns|--accept-routes|mktemp|trap/);
    expect(command).not.toMatch(/--auth-key|--reset|--force-reauth|curl -k|insecure/);
  });
  it("keeps only preferences different from each platform's upstream defaults", () => {
    for (const platform of ["linux", "windows", "macos"] as const) {
      const command = deviceInstallCommand("https://tenant.example.test", { ...options, platform,
        installClient: false, acceptRoutes: platform !== "linux" }, permissions);
      expect(command).not.toMatch(/--accept-dns|--accept-routes/);
      const changed = deviceInstallCommand("https://tenant.example.test", { ...options, platform,
        installClient: false, acceptDNS: false, acceptRoutes: platform === "linux" }, permissions);
      expect(changed).toContain("--accept-dns=false");
      expect(changed).toContain(`--accept-routes=${platform === "linux"}`);
    }
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
    expect(coreNavigation.map((item) => item.to)).toEqual(["/dashboard", "/devices", "/shares", "/network", "/permissions", "/dns", "/routes", "/relays"]);
    expect(managementNavigation("owner").some((item) => item.to === "/authentication")).toBe(true);
    expect(managementNavigation("member").some((item) => item.to === "/authentication")).toBe(false);
    expect(managementNavigation("owner").some((item) => item.to === "/settings")).toBe(true);
  });
});
