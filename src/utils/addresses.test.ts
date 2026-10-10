import { describe, expect, it } from "vitest";
import { allocationEditStatus, normalizeAllocationRange, validateDeviceIPv4 } from "./addresses";
const reserved = ["100.100.0.0/24", "100.100.100.0/24", "100.115.92.0/23", "100.127.0.0/16"];
describe("official client address management", () => {
  it("normalizes host bits without silently accepting RFC1918", () => {
    expect(normalizeAllocationRange("100.101.50.12/24", reserved)).toBe("100.101.50.0/24");
    for (const prefix of ["192.168.50.0/24", "10.10.0.0/24", "100.64.0.0/10", "100.100.100.0/24", "100.115.92.0/24", "100.127.0.0/24", "100.101.50.0/29", "100.101.50.0/99", "100.101.050.0/24", "100.101.256.0/24"]) expect(() => normalizeAllocationRange(prefix, reserved)).toThrow();
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
