import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deviceInstallCommand, privateDeviceInstallScript, validDeviceAuthKey, type DeviceInstallOptions } from "./device-install";

const token = "tskey-auth-abcdefghijklmnopqrstuv2345";
const options: DeviceInstallOptions = { platform: "linux", installClient: true, acceptDNS: true, acceptRoutes: true,
  hostname: "home-server", advertiseSubnets: true, routes: "192.168.90.1/24", advertiseExitNode: true, authMethod: "token" };
const permissions = { allowSubnetRouter: true, allowExitNode: true, maxRoutes: 10 };

describe("secure device Token command generation", () => {
  it("uses hidden input/file: on desktops, never embeds the key in copied commands", () => {
    for (const platform of ["linux", "macos", "windows"] as const) {
      const command = deviceInstallCommand("https://tenant.example.test:9090", { ...options, platform }, permissions);
      expect(command).toContain("--auth-key="); expect(command).toContain("file:"); expect(command).not.toContain(token);
      expect(command).not.toMatch(/--force-reauth|--reset|--insecure|curl -k/);
      expect(command).toContain('--hostname="home-server"');
      if (platform === "windows") { expect(command).toContain("-AsSecureString"); expect(command).toContain("SetAccessRuleProtection"); expect(command).toContain("ZeroFreeBSTR"); }
      else { expect(command).toContain("stty -echo"); expect(command).toContain('chmod 600 "$key_file"'); }
    }
    expect(deviceInstallCommand("https://tenant.example.test", { ...options, platform: "android" }, permissions)).toBe("");
  });
  it.each(["platform-token", "tskey-api-abcdefghijklmnop", "tskey-auth-short", token+"\nBAD", token+"';echo", token+"$(id)"])('rejects non-device or injectable secrets without echoing them', (invalid) => {
    expect(validDeviceAuthKey(invalid)).toBe(false);
    expect(() => privateDeviceInstallScript("https://tenant.example.test", options, permissions, invalid)).toThrow("设备 Auth Key");
  });
  it("only allows explicit Linux private scripts and preserves entitlement validation", () => {
    expect(() => privateDeviceInstallScript("https://tenant.example.test", { ...options, platform: "windows" }, permissions, token)).toThrow("只用于 Linux");
    expect(() => privateDeviceInstallScript("https://tenant.example.test", options, { ...permissions, allowExitNode: false }, token)).toThrow("出口节点");
    expect(() => privateDeviceInstallScript("https://tenant.example.test/?token=bad", options, permissions, token)).toThrow();
  });
  it.each([{ root: true, fail: "" }, { root: false, fail: "" }, { root: true, fail: "curl" }, { root: false, fail: "tailscale" }])("executes private script safely with mocked installer/client and cleans failures: %j", ({ root, fail }) => {
    const directory = mkdtempSync(join(tmpdir(), "xunara-device-script-"));
    try {
      const bin = join(directory, "bin"), work = join(directory, "work");
      mkdirSync(bin, { mode: 0o700 }); mkdirSync(work, { mode: 0o700 });
      writeFileSync(join(directory, "expected.key"), token+"\n", { mode: 0o600 });
      const executable = (name: string, source: string) => writeFileSync(join(bin, name), "#!/bin/sh\nset -eu\n"+source, { mode: 0o700 });
      executable("id", 'printf "%s\\n" "$FIXTURE_UID"\n');
      executable("sudo", 'exec "$@"\n');
      executable("curl", 'printf "%s\\n" "$@" > "$FIXTURE_DIR/curl-argv"\n[ "$FIXTURE_FAIL" != curl ] || exit 22\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; printf "#!/bin/sh\\nexit 0\\n" > "$1"; fi; shift; done\n');
      executable("tailscale", 'printf "%s\\n" "$@" > "$FIXTURE_DIR/client-argv"\nkey_file=""\nfor argument do case "$argument" in --auth-key=file:*) key_file="${argument#--auth-key=file:}" ;; esac; done\n[ -n "$key_file" ]\n[ "$(stat -c %a "$key_file")" = 600 ]\n[ "$(stat -c %a "$(dirname "$key_file")")" = 700 ]\ncmp -s "$key_file" "$FIXTURE_DIR/expected.key"\nprintf "%s" "$key_file" > "$FIXTURE_DIR/key-path"\n[ "$FIXTURE_FAIL" != tailscale ] || exit 1\n');
      const filename = join(directory, "xunara-device-join.sh");
      writeFileSync(filename, privateDeviceInstallScript("https://tenant.example.test:9090", options, permissions, token), { mode: 0o600 });
      const syntax = spawnSync("sh", ["-n", filename], { encoding: "utf8" }); expect(syntax.status).toBe(0);
      const result = spawnSync("sh", ["-xv", filename], { encoding: "utf8", env: { ...process.env, PATH: bin+":/usr/bin:/bin", TMPDIR: work,
        FIXTURE_DIR: directory, FIXTURE_UID: root ? "0" : "1000", FIXTURE_FAIL: fail } });
      expect(result.stdout+result.stderr).not.toContain(token);
      expect(statSync(filename).mode & 0o777).toBe(0o700);
      expect(readdirSync(work)).toEqual([]);
      if (fail) expect(result.status).not.toBe(0); else expect(result.status).toBe(0);
      if (fail !== "curl") {
        const argumentsText = readFileSync(join(directory, "client-argv"), "utf8");
        expect(argumentsText).not.toContain(token); expect(argumentsText).toContain('--auth-key=file:');
        expect(argumentsText).toContain('--advertise-routes=192.168.90.0/24'); expect(argumentsText).toContain('--advertise-exit-node');
      } else expect(readdirSync(directory)).not.toContain("client-argv");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
