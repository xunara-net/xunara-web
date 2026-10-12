import { api } from "./client";
import type { Machine } from "./types";
import { validDeviceAuthKey } from "../utils/device-install";

export interface DeviceLifecycle { machine: Machine; revision: string; csrf_token: string; can_expire: boolean; }
export interface EnrollmentCapabilities { csrf_token: string; can_manage: boolean; used: number; max_auth_keys: number; }
export interface EnrollmentKey { id: number; key: string; expiry: string; reusable: false; ephemeral: false; }
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function integer(value: unknown, minimum = 0) { return Number.isSafeInteger(value) && Number(value) >= minimum; }
function capabilities(value: unknown, flag: string): boolean {
  return object(value) && typeof value[flag] === "boolean" && typeof value.csrf_token === "string" &&
    (!value[flag] || value.csrf_token.length > 0);
}
function lifecycle(value: unknown, reference: string): DeviceLifecycle {
  if (!capabilities(value, "can_expire") || !object(value) || !object(value.machine) ||
    typeof value.revision !== "string" || !/^[a-f0-9]{64}$/.test(value.revision) ||
    !integer(value.machine.id, 1) || typeof value.machine.stableId !== "string" || !value.machine.stableId ||
    (String(value.machine.id) !== reference && value.machine.stableId !== reference) ||
    typeof value.machine.hostname !== "string" || typeof value.machine.expired !== "boolean" ||
    (value.machine.expires !== undefined && (typeof value.machine.expires !== "string" || !Number.isFinite(Date.parse(value.machine.expires))))) {
    throw new Error("设备有效期响应异常，请重新读取后确认");
  }
  return value as unknown as DeviceLifecycle;
}
export const getDeviceLifecycle = async (reference: string) =>
  lifecycle(await api<unknown>(`/api/v2/machines/${encodeURIComponent(reference)}/lifecycle`), reference);
export const expireDevice = async (reference: string, revision: string, csrf: string) => {
  if (!/^[a-f0-9]{64}$/.test(revision) || !csrf) throw new Error("请先读取设备有效期并确认操作");
  const result = lifecycle(await api<unknown>(`/api/v2/machines/${encodeURIComponent(reference)}/expire`, {
    method: "POST", headers: { "X-CSRF-Token": csrf }, body: { revision },
  }), reference);
  if (!result.machine.expired || !result.machine.expires) throw new Error("尚未确认设备已经过期，请先读取最新状态，勿重复提交");
  return result;
};
export async function getEnrollmentCapabilities(): Promise<EnrollmentCapabilities> {
  const value = await api<unknown>("/api/v2/auth-keys/enrollment");
  if (!capabilities(value, "can_manage") || !object(value) || !integer(value.used) || !integer(value.max_auth_keys, -1)) {
    throw new Error("设备密钥权限或额度未确认，请重新读取");
  }
  return value as unknown as EnrollmentCapabilities;
}
export async function createEnrollmentKey(ttlSeconds: number, csrf: string): Promise<EnrollmentKey> {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 900 || ttlSeconds > 86400 || !csrf) throw new Error("请确认权限及 15 分钟～24 小时的密钥有效期");
  const value = await api<unknown>("/api/v2/auth-keys/enrollment", { method: "POST", headers: { "X-CSRF-Token": csrf }, body: { ttl_seconds: ttlSeconds } });
  if (!object(value) || !integer(value.id, 1) || !validDeviceAuthKey(value.key) || typeof value.expiry !== "string" ||
    !Number.isFinite(Date.parse(value.expiry)) || value.reusable !== false || value.ephemeral !== false) throw new Error("设备密钥响应异常，未自动重试；请在预授权密钥页检查记录");
  return value as unknown as EnrollmentKey;
}
