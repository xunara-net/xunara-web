import { describe, expect, it } from "vitest";
import { enrollmentStatus, relayInstallCommand } from "./relays";

describe("private relay enrollment", () => {
  it("uses server-confirmed token states", () => {
    const base = { id: "token-id", visibility: "private", used: false, expired: false };
    expect(enrollmentStatus(base)).toBe("待接入");
    expect(enrollmentStatus({ ...base, expired: true })).toBe("已过期");
    expect(enrollmentStatus({ ...base, used: true, expired: true })).toBe("已使用");
  });
  it("does not insert a credential in the installation command", () => {
    const command = relayInstallCommand("https://tenant.example.test/");
    expect(command).toContain("read -r -s");
    expect(command).toContain("-enroll-token-env XUNARA_RELAY_TOKEN");
    expect(command).toContain("-cert-mode selfsigned");
    expect(command).not.toContain("insecure");
    for (const url of ["https://user:secret@example.test", "https://example.test/?token=secret", "https://example.test/#secret", "file:///tmp/identity"]) expect(() => relayInstallCommand(url)).toThrow();
  });
});
