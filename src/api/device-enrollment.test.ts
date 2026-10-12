import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnrollmentKey, expireDevice, getDeviceLifecycle, getEnrollmentCapabilities, updateDeviceExpiry, type DeviceLifecycle } from "./device-enrollment";
import { createAuthKey, deleteAuthKey } from "./endpoints";

const current = { machine: { id: 42, stableId: "device-42", hostname: "home", expired: false }, revision: "a".repeat(64), csrf_token: "csrf-fixture", can_expire: true };
const scheduled = { ...current, server_time: "2026-10-13T12:00:00Z", expiry_policy: { max_duration_seconds: 180 * 86400, extension_seconds: 1800 } };
const capabilities = { csrf_token: "csrf-fixture", can_manage: true, used: 0, max_auth_keys: 10 };
const issued = { id: 7, key: "tskey-auth-abcdefghijklmnopqrstuv2345", expiry: "2026-10-12T08:00:00Z", reusable: false, ephemeral: false };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } }); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
function respond(value: unknown, status = 200) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value), { status })); }

describe("device lifecycle and enrollment credentials", () => {
  it("updates a duration from the server clock, with CSRF and CAS only", async () => {
    const result = { ...scheduled, machine: { ...scheduled.machine, expires: "2026-10-14T12:00:00Z" } };
    respond(result); expect(await updateDeviceExpiry("device-42", scheduled as DeviceLifecycle, { mode: "schedule", duration_seconds: 86400 })).toEqual(result);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://tenant.example.test/api/v2/machines/device-42/expiry");
    expect(options?.headers).toMatchObject({ "X-CSRF-Token": "csrf-fixture" });
    expect(JSON.parse(String(options?.body))).toEqual({ revision: scheduled.revision, mode: "schedule", duration_seconds: 86400 });
  });
  it("verifies exact UTC dates, disabled expiry and the fixed recovery window", async () => {
    const future = "2026-10-14T12:00:00Z";
    respond({ ...scheduled, machine: { ...scheduled.machine, expires: future } });
    await updateDeviceExpiry("device-42", scheduled as DeviceLifecycle, { mode: "schedule", expires_at: future });
    respond(scheduled); await updateDeviceExpiry("device-42", scheduled as DeviceLifecycle, { mode: "disable" });
    const expired = { ...scheduled, machine: { ...scheduled.machine, expired: true, expires: "2026-10-13T11:00:00Z" } };
    respond({ ...scheduled, machine: { ...scheduled.machine, expires: "2026-10-13T12:30:00Z" } });
    await updateDeviceExpiry("device-42", expired as DeviceLifecycle, { mode: "extend" });
  });
  it.each([
    current, { ...scheduled, can_expire: false }, { ...scheduled, csrf_token: "" },
    { ...scheduled, expiry_policy: { ...scheduled.expiry_policy, extension_seconds: 86400 } },
  ])("rejects unconfirmed management authority before writes", async (value) => {
    await expect(updateDeviceExpiry("device-42", value as DeviceLifecycle, { mode: "disable" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires recovery for expired devices and never retries conflicts", async () => {
    await expect(updateDeviceExpiry("device-42", scheduled as DeviceLifecycle, { mode: "extend" })).rejects.toThrow();
    await expect(updateDeviceExpiry("device-42", { ...scheduled, machine: { ...scheduled.machine, expired: true } } as DeviceLifecycle, { mode: "disable" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    respond({ error: "DEVICE_CHANGED: fixture" }, 409);
    await expect(updateDeviceExpiry("device-42", scheduled as DeviceLifecycle, { mode: "disable" })).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...scheduled, machine: { ...scheduled.machine, expires: "2026-10-14T12:00:00Z" } },
    { ...scheduled, machine: { ...scheduled.machine, expired: true } },
    current,
  ])("does not report disabled expiry on an unconfirmed response", async (value) => {
    respond(value); await expect(updateDeviceExpiry("device-42", scheduled as DeviceLifecycle, { mode: "disable" })).rejects.toThrow("尚未确认");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched exact dates and relative duration responses", async () => {
    const result = { ...scheduled, machine: { ...scheduled.machine, expires: "2026-10-14T13:00:00Z" } };
    respond(result); await expect(updateDeviceExpiry("device-42", scheduled as DeviceLifecycle, { mode: "schedule", expires_at: "2026-10-14T12:00:00Z" })).rejects.toThrow("不一致");
    respond(result); await expect(updateDeviceExpiry("device-42", scheduled as DeviceLifecycle, { mode: "schedule", duration_seconds: 86400 })).rejects.toThrow("未确认");
  });
  it("reads a bound lifecycle snapshot and sends only its revision and CSRF", async () => {
    respond(current); expect(await getDeviceLifecycle("device-42")).toEqual(current);
    const expired = { ...current, machine: { ...current.machine, expired: true, expires: "2026-10-12T07:00:00Z" } };
    respond(expired); expect(await expireDevice("device-42", current.revision, current.csrf_token)).toEqual(expired);
    const [url, options] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe("https://tenant.example.test/api/v2/machines/device-42/expire");
    expect(options?.headers).toMatchObject({ "X-CSRF-Token": "csrf-fixture" });
    expect(JSON.parse(String(options?.body))).toEqual({ revision: current.revision });
  });
  it.each([{}, { ...current, revision: "" }, { ...current, can_expire: "true" }, { ...current, csrf_token: "" },
    { ...current, machine: { ...current.machine, stableId: "replacement" } }, { ...current, machine: { ...current.machine, expires: "bad" } }])("rejects unknown lifecycle metadata or a replacement device", async (value) => {
    respond(value); await expect(getDeviceLifecycle("device-42")).rejects.toThrow("有效期响应异常");
  });
  it("does not accept an unconfirmed mutation or retry conflicts", async () => {
    await expect(expireDevice("device-42", "", "csrf")).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
    respond({ error: "DEVICE_CHANGED: fixture" }, 409);
    await expect(expireDevice("device-42", current.revision, current.csrf_token)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    respond(current); await expect(expireDevice("device-42", current.revision, current.csrf_token)).rejects.toThrow("尚未确认");
  });
  it.each([{}, { ...capabilities, can_manage: "true" }, { ...capabilities, csrf_token: "" },
    { ...capabilities, used: -1 }, { ...capabilities, max_auth_keys: -2 }])("fails closed on unknown issuance authority", async (value) => {
    respond(value); await expect(getEnrollmentCapabilities()).rejects.toThrow("未确认");
  });
  it("accepts read-only metadata and unlimited entitlements without guessing plan names", async () => {
    const readonly = { ...capabilities, can_manage: false, csrf_token: "", max_auth_keys: -1 };
    respond(readonly); expect(await getEnrollmentCapabilities()).toEqual(readonly);
  });
  it("mints a short single-use device credential with no token in URL or request body", async () => {
    respond(issued, 201); expect(await createEnrollmentKey(900, "csrf-fixture")).toEqual(issued);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://tenant.example.test/api/v2/auth-keys/enrollment");
    expect(options?.headers).toMatchObject({ "X-CSRF-Token": "csrf-fixture" });
    expect(JSON.parse(String(options?.body))).toEqual({ ttl_seconds: 900 });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(issued.key);
  });
  it.each([899, 86401, 900.5, NaN])("refuses invalid TTL before contacting server", async (ttl) => {
    await expect(createEnrollmentKey(ttl, "csrf-fixture")).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ ...issued, key: "platform-admin-token" }, { ...issued, reusable: true }, { ...issued, expiry: "" }, { ...issued, id: 0 }])("does not display malformed secrets or automatically mint again", async (value) => {
    respond(value, 201); await expect(createEnrollmentKey(900, "csrf-fixture")).rejects.toThrow("未自动重试");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps the legacy creation/deletion contract while adding current CSRF authority", async () => {
    respond(capabilities); respond({ id: 7, key: issued.key }, 201);
    const body = { reusable: true, ephemeral: false, ttl: "1h", tags: ["tag:server"] };
    await createAuthKey(body);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual(body);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ "X-CSRF-Token": capabilities.csrf_token });
    respond(capabilities); respond({ deleted: 7 }); await deleteAuthKey(7);
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: "DELETE", headers: { "X-CSRF-Token": capabilities.csrf_token } });
  });
});
