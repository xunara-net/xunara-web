import { describe, expect, it } from "vitest";
import { enrollmentStatus, relayInstallCommand, relayDesiredStateText, relayBandwidthText } from "./relays";

describe("private relay enrollment", () => {
  it("describes desired state and bandwidth without inventing applied or online status", () => {
    expect(relayDesiredStateText("online")).toBe("启用");
    expect(relayDesiredStateText("unknown")).toBe("未知期望状态");
    expect(relayBandwidthText(0)).toBe("使用中继本地配置");
    expect(relayBandwidthText(-1)).toBe("取消限速");
    expect(relayBandwidthText(1024)).toContain("1,024");
  });
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
