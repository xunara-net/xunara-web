import { describe, expect, it } from "vitest";
import { privateRelayInstallCommand } from "./relay-install";
import { relayRelease } from "./relay-downloads";

const options = { hostname: "relay.example.com", port: 9091, regionId: 40001, stun: false, stunPort: 3478, controlCAFile: "", upgrade: false };
describe("private relay installer command", () => {
  it("pins a real release and verifies its installer without embedding enrollment credentials", () => {
    const command = privateRelayInstallCommand("https://tenant.example.test:9090", options);
    expect(command).toContain(`/releases/download/${relayRelease.version}/install-private-relay.sh`);
    expect(command).toContain("sha256sum --check --status");
    expect(command).toContain("--hostname 'relay.example.com' --port 9091 --region-id 40001");
    expect(command).not.toMatch(/xrelay-enroll-|xrelay-token-|TOKEN=|curl -k|--insecure/);
  });
  it("changes optional STUN, process-scoped CA and upgrade flags", () => {
    const command = privateRelayInstallCommand("https://tenant.example.test", { ...options, stun: true, stunPort: 3479, upgrade: true, controlCAFile: "/root/test-ca.crt" });
    expect(command).toContain("--stun --stun-port 3479");
    expect(command).toContain("--control-ca-file '/root/test-ca.crt' --upgrade");
  });
  it.each(["http://tenant.example.test", "https://user:secret@tenant.example.test", "https://tenant.example.test/?secret=bad", "https://tenant.example.test/path"])('rejects unsafe control root %s', (value) => {
    expect(() => privateRelayInstallCommand(value, options)).toThrow();
  });
  it.each(["", "relay;echo bad", "relay\nname", "$(touch bad)", "relay%name"])('rejects unsafe relay hostname %s', (hostname) => {
    expect(() => privateRelayInstallCommand("https://tenant.example.test", { ...options, hostname })).toThrow();
  });
  it("rejects bad ports, missing capabilities and occupied new regions", () => {
    expect(() => privateRelayInstallCommand("https://tenant.example.test", { ...options, port: 65536 })).toThrow();
    expect(() => privateRelayInstallCommand("https://tenant.example.test", options, [40001])).toThrow("区域编号");
    expect(() => privateRelayInstallCommand("https://tenant.example.test", { ...options, controlCAFile: "/root/$(bad)" })).toThrow("CA 文件");
  });
});
