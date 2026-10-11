import { api } from "./client";

export interface DeviceConnection {
  stableId: string;
  generatedAt: string;
  controlOnline: boolean;
  lastControlSeenAt: string | null;
  reportAvailable: boolean;
  mapConfigured: boolean;
  policyMode: "inherit" | "none" | "regions";
  homeRegion: {
    id: number; code: string; name: string; source: string; advertised: boolean; serversTruncated: boolean;
    servers: { name: string; hostname: string; derpPort: number; stunPort: number; stunOnly: boolean }[];
  } | null;
  reportedRegionId: number;
  reportedRegionAdvertised: boolean;
  network: {
    linkType: "" | "wired" | "wifi" | "mobile";
    udp: boolean | null; ipv6: boolean | null; mappingVariesByDestIP: boolean | null;
    upnp: boolean | null; pmp: boolean | null; pcp: boolean | null;
  } | null;
  endpoints: string[];
  endpointCount: number;
  endpointsTruncated: boolean;
  latencies: { regionId: number; code: string; name: string; addressFamily: "ipv4" | "ipv6"; milliseconds: number }[];
  latenciesTruncated: boolean;
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function date(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function optionalBool(value: unknown): value is boolean | null { return value === null || typeof value === "boolean"; }

export async function getDeviceConnection(reference: string | number): Promise<DeviceConnection> {
  const payload = await api<unknown>(`/api/v1/machines/${encodeURIComponent(reference)}/connection`);
  if (!object(payload) || typeof payload.stableId !== "string" || !payload.stableId || !date(payload.generatedAt) ||
      typeof payload.controlOnline !== "boolean" || !(payload.lastControlSeenAt === null || date(payload.lastControlSeenAt)) ||
      typeof payload.reportAvailable !== "boolean" || typeof payload.mapConfigured !== "boolean" ||
      !["inherit", "none", "regions"].includes(String(payload.policyMode)) || !integer(payload.reportedRegionId) ||
      typeof payload.reportedRegionAdvertised !== "boolean" || !Array.isArray(payload.endpoints) || payload.endpoints.length > 32 ||
      !payload.endpoints.every((entry) => typeof entry === "string" && entry.length <= 128) || !integer(payload.endpointCount) ||
      payload.endpointCount < payload.endpoints.length || typeof payload.endpointsTruncated !== "boolean" ||
      payload.endpointsTruncated !== (payload.endpointCount > payload.endpoints.length) ||
      !Array.isArray(payload.latencies) || payload.latencies.length > 128 || typeof payload.latenciesTruncated !== "boolean" ||
      !payload.latencies.every((entry) => object(entry) && integer(entry.regionId) && entry.regionId > 0 &&
        typeof entry.name === "string" && typeof entry.code === "string" && ["ipv4", "ipv6"].includes(String(entry.addressFamily)) &&
        typeof entry.milliseconds === "number" && Number.isFinite(entry.milliseconds) && entry.milliseconds >= 0 && entry.milliseconds <= 3600000)) {
    throw new Error("设备连接信息格式异常，请刷新重试");
  }
  const home = payload.homeRegion;
  if (home !== null && (!object(home) || !integer(home.id) || home.id <= 0 || typeof home.name !== "string" ||
      typeof home.code !== "string" || !["", "deployment", "external", "managed"].includes(String(home.source)) ||
      typeof home.advertised !== "boolean" || typeof home.serversTruncated !== "boolean" ||
      !Array.isArray(home.servers) || home.servers.length > 32 || !home.servers.every((entry) => object(entry) &&
        typeof entry.name === "string" && typeof entry.hostname === "string" && integer(entry.derpPort) && entry.derpPort <= 65535 &&
        Number.isSafeInteger(entry.stunPort) && Number(entry.stunPort) >= -1 && Number(entry.stunPort) <= 65535 && typeof entry.stunOnly === "boolean"))) {
    throw new Error("设备中继信息格式异常，请刷新重试");
  }
  const network = payload.network;
  if (payload.reportAvailable ? (!object(network) || !["", "wired", "wifi", "mobile"].includes(String(network.linkType)) ||
      ![network.udp, network.ipv6, network.mappingVariesByDestIP, network.upnp, network.pmp, network.pcp].every(optionalBool)) : network !== null) {
    throw new Error("客户端网络报告格式异常，请刷新重试");
  }
  return payload as unknown as DeviceConnection;
}
