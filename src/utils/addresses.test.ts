import { describe, expect, it } from "vitest";
import { allocationCompatibilityWarning, allocationEditStatus, normalizeAllocationRange, validateDeviceIPv4 } from "./addresses";
const reserved = ["0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "100.100.0.0/24", "100.100.100.0/24", "100.115.92.0/23", "100.127.0.0/16"];
describe("flexible IPv4 address management", () => {
  it("normalizes host bits and accepts safe private, public and small ranges", () => {
    expect(normalizeAllocationRange("100.101.50.12/24", reserved)).toBe("100.101.50.0/24");
    expect(normalizeAllocationRange("192.168.50.12/24", reserved)).toBe("192.168.50.0/24");
    expect(normalizeAllocationRange("10.42.50.12/8", reserved)).toBe("10.0.0.0/8");
    expect(normalizeAllocationRange("172.31.50.12/12", reserved)).toBe("172.16.0.0/12");
    expect(normalizeAllocationRange("192.168.50.12/29", reserved)).toBe("192.168.50.8/29");
    expect(normalizeAllocationRange("192.168.50.5/31", reserved)).toBe("192.168.50.4/31");
    expect(normalizeAllocationRange("192.168.50.5/32", reserved)).toBe("192.168.50.5/32");
    expect(normalizeAllocationRange("8.8.4.12/24", reserved)).toBe("8.8.4.0/24");
  });
  it("preserves malformed, global, client and deployment reserved range checks", () => {
    for (const prefix of ["0.0.0.0/0", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4", "240.0.0.0/4", "192.0.2.0/24", "100.64.0.0/10", "100.100.100.0/24", "100.115.92.0/24", "100.127.0.0/24", "100.101.50.0/99", "100.101.050.0/24", "100.101.256.0/24", "fd00::/64"]) expect(() => normalizeAllocationRange(prefix, reserved)).toThrow();
    expect(() => normalizeAllocationRange("192.168.50.0/24", [...reserved, "192.168.50.20/32"])).toThrow();
  });
  it("warns about compatibility without rejecting nonstandard ranges", () => {
    for (const prefix of ["192.168.50.0/24", "10.0.0.0/8", "172.16.0.0/12", "8.8.4.0/24", "192.168.50.20/32"]) expect(allocationCompatibilityWarning(prefix)).toContain("允许保存");
    expect(allocationCompatibilityWarning("100.101.50.20/32")).toBe("");
    expect(allocationCompatibilityWarning("invalid")).toBe("");
  });
  it("uses every address in /31 and /32 without weakening larger pool boundaries", () => {
    expect(validateDeviceIPv4("192.168.50.4", "192.168.50.4/31", reserved)).toBe("192.168.50.4");
    expect(validateDeviceIPv4("192.168.50.5", "192.168.50.4/31", reserved)).toBe("192.168.50.5");
    expect(validateDeviceIPv4("192.168.50.20", "192.168.50.20/32", reserved)).toBe("192.168.50.20");
    expect(validateDeviceIPv4("10.42.50.20", "10.0.0.0/8", reserved)).toBe("10.42.50.20");
    for (const address of ["192.168.50.0", "192.168.50.3", "192.168.51.1"]) expect(() => validateDeviceIPv4(address, "192.168.50.0/30", reserved)).toThrow();
    expect(() => validateDeviceIPv4("192.168.50.21", "192.168.50.20/32", reserved)).toThrow();
    expect(() => validateDeviceIPv4("100.100.100.100", "100.100.100.100/32", reserved)).toThrow();
    expect(() => validateDeviceIPv4("127.0.0.1", "127.0.0.1/32", reserved)).toThrow();
  });
  it("checks actual range, exact IPv4, boundaries and deployment reservations", () => {
    expect(validateDeviceIPv4("100.101.50.20", "100.101.50.0/24", reserved)).toBe("100.101.50.20");
    for (const address of ["100.101.50.0", "100.101.50.255", "100.101.51.20", "::ffff:100.101.50.20", "100.101.050.20"]) expect(() => validateDeviceIPv4(address, "100.101.50.0/24", reserved)).toThrow();
    expect(() => validateDeviceIPv4("100.101.50.20", "100.101.50.0/24", [...reserved, "100.101.50.16/28"])).toThrow();
  });
});

describe("allocation editing availability", () => {
  const configuration = { can_edit: true, pending: false, csrf_token: "test-csrf" };

  it.each(["owner", "admin"])("allows %s only after server permission and session confirmation", (role) => {
    expect(allocationEditStatus(configuration, role)).toMatchObject({ allowed: true, status: "ready" });
  });
  it.each(["member", "viewer", "", undefined])("keeps %s read-only with an explicit role reason", (role) => {
    expect(allocationEditStatus(configuration, role)).toMatchObject({ allowed: false, status: "role" });
  });
  it("does not turn unknown or failed reads into a plan restriction", () => {
    expect(allocationEditStatus(null, "owner")).toMatchObject({ allowed: false, status: "loading" });
    expect(allocationEditStatus(null, "owner", "读取失败")).toMatchObject({ allowed: false, status: "error" });
    expect(allocationEditStatus(configuration, "owner", "读取失败")).toMatchObject({ allowed: false, status: "error" });
  });
  it("uses the live entitlement rather than a plan name or cached capability", () => {
    expect(allocationEditStatus({ ...configuration, can_edit: false }, "owner")).toMatchObject({ allowed: false, status: "plan" });
  });
  it("blocks an unapplied allocation instead of submitting a second write", () => {
    expect(allocationEditStatus({ ...configuration, pending: true }, "owner")).toMatchObject({ allowed: false, status: "pending" });
  });
  it("requires a confirmed session token", () => {
    expect(allocationEditStatus({ ...configuration, csrf_token: "" }, "admin")).toMatchObject({ allowed: false, status: "session" });
  });
});
