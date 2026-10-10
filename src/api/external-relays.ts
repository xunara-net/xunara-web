import { api } from "./client";
export interface DERPNode {
  Name: string; RegionID: number; HostName: string; DERPPort?: number; STUNPort?: number;
  CertName?: string; IPv4?: string; IPv6?: string; STUNOnly?: boolean; [key: string]: unknown;
}
export interface DERPRegion { RegionID: number; RegionCode: string; RegionName: string; Nodes: DERPNode[]; [key: string]: unknown }
export interface DERPMap { Regions: Record<string, DERPRegion>; HomeParams?: { RegionScore?: Record<string, number> }; omitDefaultRegions?: boolean }
export interface ExternalRelayConfiguration { revision: number; map: DERPMap; applied: boolean; csrf_token: string; official_url: string }
export interface ExternalRelayHistory { revision: number; content: string; actor: string; created: string }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
export function checkDERPMap(value: unknown): asserts value is DERPMap {
  if (!record(value) || !record(value.Regions) || Object.keys(value.Regions).length > 128 || Object.entries(value.Regions).some(([identifier, region]) => !record(region) || !Number.isSafeInteger(region.RegionID) || Number(region.RegionID) <= 0 || String(region.RegionID) !== identifier || typeof region.RegionName !== "string" || typeof region.RegionCode !== "string" || !Array.isArray(region.Nodes) || !region.Nodes.length || region.Nodes.length > 16 || region.Nodes.some((node) => !record(node) || node.RegionID !== region.RegionID || typeof node.Name !== "string" || typeof node.HostName !== "string"))) throw new Error("中继地图格式异常，请提供完整的标准 DERPMap JSON");
}
function checkConfiguration(payload: ExternalRelayConfiguration) {
  if (!payload || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || typeof payload.applied !== "boolean" || typeof payload.csrf_token !== "string" || payload.official_url !== "https://controlplane.tailscale.com/derpmap/default") throw new Error("非托管中继配置响应格式异常");
  checkDERPMap(payload.map);
  return payload;
}
export const getExternalRelayConfiguration = async () => checkConfiguration(await api<ExternalRelayConfiguration>("/api/v2/derp/configuration"));
export async function saveExternalRelayMap(map: DERPMap, revision: number, csrfToken: string) {
  checkDERPMap(map);
  return checkConfiguration(await api<ExternalRelayConfiguration>("/api/v2/derp/configuration", { method: "PUT", body: { map, revision }, headers: { "X-CSRF-Token": csrfToken } }));
}
export async function importOfficialRelayMap(csrfToken: string) {
  const payload = await api<{ map: DERPMap; source: string }>("/api/v2/derp/import-official", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
  if (!payload || payload.source !== "https://controlplane.tailscale.com/derpmap/default") throw new Error("官方地图来源未确认");
  checkDERPMap(payload.map); return payload.map;
}
export async function getExternalRelayHistory() {
  const payload = await api<{ items: ExternalRelayHistory[] }>("/api/v2/derp/history");
  if (!payload || !Array.isArray(payload.items) || payload.items.some((item) => !item || !Number.isSafeInteger(item.revision) || item.revision < 0 || typeof item.content !== "string" || typeof item.actor !== "string" || typeof item.created !== "string")) throw new Error("中继地图历史响应格式异常");
  return payload.items;
}
export const restoreExternalRelayMap = async (restore_from: number, revision: number, csrfToken: string) => checkConfiguration(await api<ExternalRelayConfiguration>("/api/v2/derp/configuration", { method: "PUT", body: { restore_from, revision }, headers: { "X-CSRF-Token": csrfToken } }));
