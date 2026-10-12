import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { localExpiryInput, localExpiryToISO, validateDeviceExpirySetting, type DeviceExpirySetting } from "./device-expiry";

describe("device expiry dates", () => {
  const now = Date.parse("2026-10-13T12:00:00Z"), max = 180 * 86400;
  it("round trips local minute inputs while rendering UTC in the API", () => {
    const local = localExpiryInput("2026-10-14T02:34:56.123Z");
    expect(localExpiryToISO(local)).toBe("2026-10-14T02:34:00.000Z");
    expect(localExpiryInput("bad")).toBe("");
  });
  it.each(["", "2026-10-14", "2026-02-30T12:00", "2026-13-01T12:00", "2026-10-14T24:00", "2026-10-14T12:60"])("rejects incomplete/normalized dates %s", (value) => {
    expect(() => localExpiryToISO(value)).toThrow();
  });
  it("converts Shanghai local time and rejects the New York DST gap", () => {
    const execute = (timezone: string, value: string) => execFileSync(process.execPath, ["--input-type=module", "-e", `
      const convert = ${localExpiryToISO.toString()};
      try { process.stdout.write(convert(${JSON.stringify(value)})); } catch { process.stdout.write('invalid'); }
    `], { env: { ...process.env, TZ: timezone }, encoding: "utf8" });
    expect(execute("Asia/Shanghai", "2026-10-14T20:00")).toBe("2026-10-14T12:00:00.000Z");
    expect(execute("America/New_York", "2026-03-08T02:30")).toBe("invalid");
    expect(execute("America/New_York", "2026-11-01T01:30")).toBe("2026-11-01T05:30:00.000Z");
  });
  it.each([
    { mode: "schedule" }, { mode: "schedule", duration_seconds: 0 }, { mode: "schedule", duration_seconds: -1 },
    { mode: "schedule", duration_seconds: max + 1 }, { mode: "schedule", duration_seconds: 1.5 },
    { mode: "schedule", duration_seconds: Infinity }, { mode: "schedule", expires_at: "bad" },
    { mode: "schedule", expires_at: new Date(now).toISOString() },
    { mode: "schedule", expires_at: new Date(now + max * 1000 + 1).toISOString() },
    { mode: "schedule", expires_at: new Date(now + 1000).toISOString(), duration_seconds: 1 },
    { mode: "disable", expires_at: new Date(now + 1000).toISOString() }, { mode: "extend", duration_seconds: 1800 },
    { mode: "unknown" },
  ])("rejects invalid shape or bounds before network access", (value) => {
    expect(() => validateDeviceExpirySetting(value as DeviceExpirySetting, now, max)).toThrow();
  });
  it("uses confirmed server time rather than the phone clock", () => {
    for (const setting of [
      { mode: "schedule", duration_seconds: 1 }, { mode: "schedule", duration_seconds: max },
      { mode: "schedule", expires_at: new Date(now + 1000).toISOString() }, { mode: "disable" }, { mode: "extend" },
    ] as DeviceExpirySetting[]) expect(() => validateDeviceExpirySetting(setting, now, max)).not.toThrow();
    expect(() => validateDeviceExpirySetting({ mode: "disable" }, NaN, max)).toThrow();
    expect(() => validateDeviceExpirySetting({ mode: "disable" }, now, 0)).toThrow();
  });
});
