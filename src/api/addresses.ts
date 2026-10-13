import { api } from "./client";
import type { Machine } from "./types";

export interface AddressConfiguration {
  ipv4_cidr: string; ipv6_cidr: string; revision: number; desired_revision: number;
  desired_ipv4_cidr: string; pending: boolean; can_edit: boolean; can_edit_ips: boolean;
  devices_total: number; devices_outside_range: number; reserved_ranges: string[]; csrf_token: string;
  extra_ipv4_cidrs?: string[]; desired_extra_ipv4_cidrs?: string[]; supports_multi_ipv4?: boolean;
}
export interface AddressPreview { ipv4_cidr: string; extra_ipv4_cidrs?: string[]; devices_retained: number; devices_outside_range: number }
function counter(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function checkConfiguration(value: AddressConfiguration): AddressConfiguration {
  if (!value || typeof value.ipv4_cidr !== "string" || typeof value.ipv6_cidr !== "string" || !counter(value.revision) || !counter(value.desired_revision) || typeof value.desired_ipv4_cidr !== "string" || typeof value.pending !== "boolean" || typeof value.can_edit !== "boolean" || typeof value.can_edit_ips !== "boolean" || !counter(value.devices_total) || !counter(value.devices_outside_range) || value.devices_outside_range > value.devices_total || !Array.isArray(value.reserved_ranges) || value.reserved_ranges.some((prefix) => typeof prefix !== "string") || typeof value.csrf_token !== "string") throw new Error("地址配置响应格式异常，请刷新重试");
  for (const field of ["extra_ipv4_cidrs", "desired_extra_ipv4_cidrs"] as const) {
    if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field]!.some((prefix) => typeof prefix !== "string"))) throw new Error("附加网段响应格式异常，请刷新重试");
  }
  if (value.supports_multi_ipv4 !== undefined && typeof value.supports_multi_ipv4 !== "boolean") throw new Error("多网段能力未确认");
  if (value.supports_multi_ipv4 && (!value.extra_ipv4_cidrs || !value.desired_extra_ipv4_cidrs)) throw new Error("多网段数据未确认");
  return value;
}
export const getAddressConfiguration = async () => checkConfiguration(await api<AddressConfiguration>("/api/v2/network/addresses"));
export async function previewAddressRange(ipv4_cidr: string, revision: number, csrfToken: string, extra?: string[]) {
  const payload = await api<AddressPreview>("/api/v2/network/addresses/validate", { method: "POST", body: { ipv4_cidr, revision, ...(extra === undefined ? {} : { extra_ipv4_cidrs: extra }) }, headers: { "X-CSRF-Token": csrfToken } });
  if (!payload || typeof payload.ipv4_cidr !== "string" || !counter(payload.devices_retained) || !counter(payload.devices_outside_range) || payload.devices_outside_range > payload.devices_retained) throw new Error("网段预览响应格式异常，尚未保存");
  if (extra !== undefined && (!Array.isArray(payload.extra_ipv4_cidrs) || payload.extra_ipv4_cidrs.some((prefix) => typeof prefix !== "string"))) throw new Error("附加网段预览未确认，尚未保存");
  return payload;
}
export const saveAddressRange = async (ipv4_cidr: string, revision: number, csrfToken: string, extra?: string[]) => checkConfiguration(await api<AddressConfiguration>("/api/v2/network/addresses", { method: "PUT", body: { ipv4_cidr, revision, ...(extra === undefined ? {} : { extra_ipv4_cidrs: extra }) }, headers: { "X-CSRF-Token": csrfToken } }));
export async function changeDeviceIPv4(machine: Machine, ipv4: string, csrfToken: string) {
  const payload = await api<Machine>(`/api/v2/machines/${encodeURIComponent(machine.stableId)}/ipv4`, { method: "PUT", body: { ipv4, expected_ipv4: machine.ipv4 }, headers: { "X-CSRF-Token": csrfToken } });
  if (!payload || payload.stableId !== machine.stableId || payload.id !== machine.id || payload.ipv4 !== ipv4) throw new Error("IP 修改结果未确认，请刷新设备信息后再操作");
  return payload;
}
