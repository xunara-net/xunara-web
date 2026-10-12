import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deviceInstallCommand, validDeviceAuthKey, type DeviceInstallOptions } from "./device-install";

const token = "tskey-auth-abcdefghijklmnopqrstuv2345";
const options: DeviceInstallOptions = { platform: "linux", installClient: true, acceptDNS: true, acceptRoutes: true,
  hostname: "home-server", advertiseSubnets: true, routes: "192.168.90.1/24", advertiseExitNode: true, authMethod: "token" };
const permissions = { allowSubnetRouter: true, allowExitNode: true, maxRoutes: 10 };

describe("explicit device Token commands", () => {
  it.each(["linux", "macos", "windows"] as const)("embeds the device key only when explicitly selected on %s", (platform) => {
    const command = deviceInstallCommand("https://tenant.example.test:9090", { ...options, platform }, permissions, token);
    expect(command).toContain(`--auth-key="${token}"`);
    expect(command).toContain('--hostname="home-server"');
    expect(command).toContain('https://tenant.example.test:9090');
    expect(command.split("\n").length).toBeLessThanOrEqual(2);
    expect(command).not.toMatch(/file:|stty|Read-Host|mktemp|--force-reauth|--reset|--insecure|curl -k/);
    const browser = deviceInstallCommand("https://tenant.example.test", { ...options, platform, authMethod: "browser" }, permissions, token);
    expect(browser).not.toContain(token); expect(browser).not.toContain("--auth-key");
  });
  it.each(["", "platform-token", "tskey-api-abcdefghijklmnop", "tskey-auth-short",
    token+"\nBAD", token+"';echo", token+"$(id)", token+"\";echo"])("rejects missing, non-device or injectable credentials without echoing them", (invalid) => {
    expect(validDeviceAuthKey(invalid)).toBe(false);
    expect(() => deviceInstallCommand("https://tenant.example.test", options, permissions, invalid)).toThrow("设备 Auth Key");
  });
  it("preserves capability checks and emits no CLI for phones", () => {
    expect(() => deviceInstallCommand("https://tenant.example.test", options, { ...permissions, allowExitNode: false }, token)).toThrow("出口节点");
    expect(() => deviceInstallCommand("https://tenant.example.test", options, { ...permissions, maxRoutes: 2 }, token)).toThrow("额度");
    expect(() => deviceInstallCommand("https://tenant.example.test/?token=bad", options, permissions, token)).toThrow();
    expect(deviceInstallCommand("https://tenant.example.test", { ...options, platform: "android" }, permissions, token)).toBe("");
    expect(deviceInstallCommand("https://tenant.example.test", { ...options, platform: "ios" }, permissions, token)).toBe("");
  });
  it.each([{ install: true, fail: "" }, { install: false, fail: "" }, { install: true, fail: "curl" },
    { install: true, fail: "install" }, { install: true, fail: "tailscale" }])("executes the single copied command and blocks failed installation: %j", ({ install, fail }) => {
    const directory = mkdtempSync(join(tmpdir(), "xunara-device-command-"));
    try {
      const bin = join(directory, "bin"); mkdirSync(bin, { mode: 0o700 });
      const executable = (name: string, source: string) => writeFileSync(join(bin, name), "#!/bin/sh\nset -eu\numask 077\n"+source, { mode: 0o700 });
      executable("sudo", 'exec "$@"\n');
      executable("curl", 'printf "%s\\n" "$@" > "$FIXTURE_DIR/curl-argv"\n[ "$FIXTURE_FAIL" != curl ] || exit 22\nprintf \'#!/bin/sh\\n[ "$FIXTURE_FAIL" != install ] || exit 12\\n\'\n');
      executable("tailscale", 'printf "%s\\n" "$@" > "$FIXTURE_DIR/client-argv"\n[ "$FIXTURE_FAIL" != tailscale ] || exit 1\n');
      const command = deviceInstallCommand("https://tenant.example.test:9090", { ...options, installClient: install }, permissions, token);
      expect(spawnSync("bash", ["-n"], { input: command }).status).toBe(0);
      const result = spawnSync("bash", ["-c", command], { encoding: "utf8", env: { ...process.env, PATH: bin+":/usr/bin:/bin",
        FIXTURE_DIR: directory, FIXTURE_FAIL: fail } });
      expect(result.stdout+result.stderr).not.toContain(token);
      if (fail) expect(result.status).not.toBe(0); else expect(result.status).toBe(0);
      if (fail === "curl" || fail === "install") expect(existsSync(join(directory, "client-argv"))).toBe(false);
      else {
        const argumentsText = readFileSync(join(directory, "client-argv"), "utf8");
        expect(argumentsText).toContain("--auth-key="+token);
        expect(argumentsText).toContain("--login-server=https://tenant.example.test:9090");
        expect(argumentsText).toContain("--advertise-routes=192.168.90.0/24");
        expect(argumentsText).toContain("--advertise-exit-node");
      }
      if (install) expect(readFileSync(join(directory, "curl-argv"), "utf8")).not.toContain(token);
      else expect(existsSync(join(directory, "curl-argv"))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
