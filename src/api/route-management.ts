import { api } from "./client";
import type { Machine } from "./types";
import { validRouteAddress, validRoutePrefix } from "../utils/route-management";

export interface RouteLimits { max_routes: number; allow_subnet_router: boolean; allow_exit_node: boolean; }
export interface RouteNode { machine: Machine; revision: string; }
export interface RouteConfiguration extends RouteNode { csrf_token: string; can_manage: boolean; limits: RouteLimits; }
export interface RouteOverview { items: RouteNode[]; csrf_token: string; can_manage: boolean; limits: RouteLimits; }
export interface ExitNode {
  nodeId: number; stableId: string; hostname: string; owner: string; online: boolean; announced: boolean;
  ipv4?: string; ipv6?: string; clientCount: number; clients: { nodeId: number; stableId: string; hostname: string; owner: string; online: boolean }[];
}
export interface ExitSelection { nodeId: number; stableId: string; hostname: string; owner: string; online: boolean;
  exitNodeStableId: string; exitNodeHostname?: string; resolved: boolean; }
export interface ExitOverview { exitNodes: ExitNode[]; clients: ExitSelection[]; }

function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function integer(value: unknown, minimum = 0) { return Number.isSafeInteger(value) && Number(value) >= minimum; }
function routes(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 256 && value.every(validRoutePrefix) && new Set(value).size === value.length; }
function node(value: unknown): value is RouteNode {
  if (!object(value) || !/^[a-f0-9]{64}$/.test(String(value.revision)) || !object(value.machine)) return false;
  const machine = value.machine;
  const approved = machine.approvedRoutes, announced = machine.announcedRoutes, effective = machine.effectiveRoutes;
  return integer(machine.id, 1) && typeof machine.stableId === "string" && Boolean(machine.stableId) && typeof machine.hostname === "string" &&
    typeof machine.online === "boolean" && typeof machine.expired === "boolean" && routes(approved) && routes(announced) &&
    routes(effective) && effective.every((prefix) => approved.includes(prefix) && announced.includes(prefix));
}
function capabilities(value: unknown): boolean {
  return object(value) && typeof value.csrf_token === "string" && typeof value.can_manage === "boolean" &&
    object(value.limits) && integer(value.limits.max_routes, -1) && typeof value.limits.allow_exit_node === "boolean" &&
    typeof value.limits.allow_subnet_router === "boolean";
}
export async function getRouteOverview(): Promise<RouteOverview> {
  const payload = await api<unknown>("/api/v2/routes/configuration");
  if (!capabilities(payload) || !object(payload) || !Array.isArray(payload.items) || payload.items.length > 2048 ||
    !payload.items.every(node) || payload.items.reduce((total, item) => total + (item.machine.approvedRoutes?.length ?? 0) + (item.machine.announcedRoutes?.length ?? 0), 0) > 2048 ||
    new Set(payload.items.map((item) => item.machine.stableId)).size !== payload.items.length) throw new Error("路由总览格式异常，请重新读取");
  return payload as unknown as RouteOverview;
}
function configuration(value: unknown, reference: string): RouteConfiguration {
  if (!capabilities(value) || !node(value) || (String(value.machine.id) !== reference && value.machine.stableId !== reference)) throw new Error("设备路由配置格式异常，请重新读取");
  return value as RouteConfiguration;
}
export const getRouteConfiguration = async (reference: string) =>
  configuration(await api<unknown>("/api/v2/machines/" + encodeURIComponent(reference) + "/routes"), reference);
export const saveRouteConfiguration = async (reference: string, revision: string, changes: { approve: string[]; unapprove: string[] }, csrf: string) =>
  configuration(await api<unknown>("/api/v2/machines/" + encodeURIComponent(reference) + "/routes", {
    method: "POST", headers: { "X-CSRF-Token": csrf }, body: { revision, ...changes },
  }), reference);

export async function getExitOverview(): Promise<ExitOverview> {
  const payload = await api<unknown>("/api/v2/exit-nodes");
  const client = (value: unknown) => object(value) && integer(value.nodeId, 1) && typeof value.stableId === "string" && Boolean(value.stableId) &&
    typeof value.hostname === "string" && typeof value.owner === "string" && typeof value.online === "boolean";
  if (!object(payload) || !Array.isArray(payload.exitNodes) || !Array.isArray(payload.clients) || payload.exitNodes.length > 2048 || payload.clients.length > 4096 ||
    !payload.exitNodes.every((entry) => client(entry) && object(entry) && typeof entry.announced === "boolean" && integer(entry.clientCount) &&
      Array.isArray(entry.clients) && entry.clients.length <= 4096 && entry.clients.length === entry.clientCount && entry.clients.every(client) &&
      [entry.ipv4, entry.ipv6].every((address) => address === undefined || validRouteAddress(address))) ||
    !payload.clients.every((entry) => client(entry) && object(entry) && typeof entry.exitNodeStableId === "string" && typeof entry.resolved === "boolean" &&
      Boolean(entry.exitNodeStableId) && (entry.exitNodeHostname === undefined || typeof entry.exitNodeHostname === "string")) ||
    new Set(payload.exitNodes.map((entry) => entry.stableId)).size !== payload.exitNodes.length ||
    new Set(payload.clients.map((entry) => entry.stableId)).size !== payload.clients.length) throw new Error("出口节点信息格式异常，请重新读取");
  return payload as unknown as ExitOverview;
}
