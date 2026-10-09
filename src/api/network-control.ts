import { api } from "./client";
import type { ManagedRelay } from "./types";
import type { AddressRecord, DNSConfiguration, DNSSettings, PolicyConfiguration, PolicyDraft, PolicyExplanation, PolicyHistory, PolicyProbe, PolicyValidation, RelayEnrollment, RelayPool } from "./network-types";

function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function revision(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function hash(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === "string"); }
function requireContract(valid: unknown): asserts valid { if (!valid) throw new Error("网络配置响应格式异常，请刷新重试"); }
function requireItems<Items>(payload: unknown, check: (item: unknown) => boolean): Items[] {
  requireContract(object(payload) && Array.isArray(payload.items) && payload.items.every(check));
  return payload.items as Items[];
}
function dnsSettings(value: unknown): value is DNSSettings {
  return object(value) && typeof value.magic_dns === "boolean" && strings(value.nameservers) && strings(value.search_domains) && object(value.split_dns) && Object.values(value.split_dns).every(strings);
}
function addressRecord(value: unknown): value is AddressRecord {
  return object(value) && revision(value.id) && value.id > 0 && revision(value.revision) && value.revision > 0 && revision(value.node_id) && typeof value.name === "string" && typeof value.type === "string" && typeof value.value === "string" && typeof value.created === "string";
}
function relayEnrollment(value: unknown): value is RelayEnrollment {
  return object(value) && typeof value.id === "string" && typeof value.visibility === "string" && typeof value.used === "boolean" && typeof value.expired === "boolean";
}
function managedRelay(value: unknown): value is ManagedRelay {
  return object(value) && typeof value.id === "string" && typeof value.name === "string" && revision(value.regionId) && revision(value.configVersion) && typeof value.desiredState === "string" && typeof value.visibility === "string" && typeof value.online === "boolean" && typeof value.healthy === "boolean" && Number.isSafeInteger(value.bandwidthLimit);
}

// 未知响应不是“默认拒绝”或“保存成功”；尤其不能将缺失的权限结果渲染为安全结论。
export async function getPolicyConfiguration(): Promise<PolicyConfiguration> {
  const payload = await api<PolicyConfiguration>("/api/v2/policy/configuration");
  requireContract(object(payload) && revision(payload.revision) && hash(payload.base_hash) && object(payload.document) && typeof payload.content === "string" && typeof payload.can_edit === "boolean" && typeof payload.can_grants === "boolean" && typeof payload.csrf_token === "string" && ["default", "file", "database"].includes(payload.source));
  return payload;
}
export async function validatePolicy(body: PolicyDraft) {
  const payload = await api<PolicyValidation>("/api/v2/policy/validate", { method: "POST", body });
  requireContract(object(payload) && object(payload.document) && revision(payload.rule_count) && strings(payload.warnings) && typeof payload.publishable === "boolean" && typeof payload.entitlement_error === "string" && object(payload.tests) && revision(payload.tests.total) && typeof payload.tests.ran === "boolean" && Array.isArray(payload.tests.results) && payload.tests.results.every((result) => object(result) && revision(result.index) && typeof result.pass === "boolean" && typeof result.src === "string" && strings(result.failures)) && object(payload.diff) && strings(payload.diff.added) && strings(payload.diff.removed) && strings(payload.diff.sections));
  return payload;
}
export async function publishPolicy(body: PolicyDraft, csrfToken: string) {
  const payload = await api<{ revision: number; base_hash: string }>("/api/v2/policy/configuration", { method: "PUT", body, headers: { "X-CSRF-Token": csrfToken } });
  requireContract(object(payload) && revision(payload.revision) && payload.revision > body.revision && hash(payload.base_hash));
  return payload;
}
export const listPolicyHistory = async () => requireItems<PolicyHistory>(await api<unknown>("/api/v2/policy/history"), (item) => object(item) && revision(item.revision) && typeof item.content === "string" && typeof item.actor === "string" && typeof item.created === "string");
export async function simulatePolicy(body: PolicyProbe) {
  const payload = await api<PolicyExplanation>("/api/v2/policy/simulate", { method: "POST", body });
  requireContract(object(payload) && typeof payload.allowed === "boolean" && typeof payload.draft === "boolean" && typeof payload.reason === "string" && Array.isArray(payload.matches) && payload.matches.every((match) => object(match) && ["acls", "grants"].includes(String(match.section)) && revision(match.index) && strings(match.sources) && strings(match.destinations)));
  return payload;
}
export async function policyMatrix(body: { content?: string; sources: number[]; destinations: number[]; protocol: "tcp" | "udp"; port: number }) {
  const payload = await api<{ items: { source: number; destination: number; allowed: boolean }[]; draft: boolean }>("/api/v2/policy/matrix", { method: "POST", body });
  const items = requireItems<{ source: number; destination: number; allowed: boolean }>(payload, (item) => object(item) && revision(item.source) && revision(item.destination) && typeof item.allowed === "boolean" && body.sources.includes(item.source) && body.destinations.includes(item.destination));
  requireContract(typeof payload.draft === "boolean" && items.length === body.sources.length * body.destinations.length && new Set(items.map((item) => `${item.source}:${item.destination}`)).size === items.length);
  return payload;
}

export async function getDNSConfiguration(): Promise<DNSConfiguration> {
  const payload = await api<DNSConfiguration>("/api/v2/dns/configuration");
  requireContract(object(payload) && revision(payload.revision) && hash(payload.base_hash) && typeof payload.domain === "string" && typeof payload.can_edit === "boolean" && typeof payload.csrf_token === "string" && dnsSettings(payload.settings));
  return payload;
}
export async function saveDNSConfiguration(body: { revision: number; base_hash: string; settings: DNSSettings }, csrfToken: string) {
  const payload = await api<{ revision: number; base_hash: string; settings: DNSSettings }>("/api/v2/dns/configuration", { method: "PUT", body, headers: { "X-CSRF-Token": csrfToken } });
  requireContract(object(payload) && revision(payload.revision) && payload.revision > body.revision && hash(payload.base_hash) && dnsSettings(payload.settings));
  return payload;
}
export const listAddressRecords = async () => requireItems<AddressRecord>(await api<unknown>("/api/v2/dns/records"), addressRecord);
export async function saveAddressRecord(body: { name: string; type: "A" | "AAAA"; value: string; revision?: number }, csrfToken: string, id?: number) {
  const payload = await api<AddressRecord>(id ? `/api/v2/dns/records/${id}` : "/api/v2/dns/records", { method: id ? "PUT" : "POST", body, headers: { "X-CSRF-Token": csrfToken } });
  requireContract(addressRecord(payload));
  return payload;
}
export const deleteAddressRecord = (record: AddressRecord, csrfToken: string) => api<void>(`/api/v2/dns/records/${record.id}`, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken, "If-Match": String(record.revision) } });

export async function getRelayPool() {
  const payload = await api<RelayPool>("/api/v2/relays/enrolled");
  const items = requireItems<ManagedRelay>(payload, managedRelay);
  requireContract(revision(payload.used) && payload.used === items.length && Number.isSafeInteger(payload.limit) && payload.limit >= -1 && typeof payload.csrf_token === "string" && typeof payload.control_url === "string");
  return payload;
}
export const listRelayEnrollments = async () => requireItems<RelayEnrollment>(await api<unknown>("/api/v2/relays/enroll-tokens"), relayEnrollment);
export async function createRelayEnrollment(name: string, ttlSeconds: number, csrfToken: string) {
  const payload = await api<{ token: string; item: RelayEnrollment }>("/api/v2/relays/enroll-tokens", { method: "POST", body: { name, visibility: "private", ttl_seconds: ttlSeconds }, headers: { "X-CSRF-Token": csrfToken } });
  requireContract(object(payload) && typeof payload.token === "string" && payload.token.length > 0 && relayEnrollment(payload.item));
  return payload;
}
export const revokeRelayEnrollment = (id: string, csrfToken: string) => api<void>(`/api/v2/relays/enroll-tokens/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken } });
export async function updateManagedRelay(id: string, body: { desired_state: string; bandwidth_limit: number; region_name: string }, csrfToken: string) {
  const payload = await api<ManagedRelay>(`/api/v2/relays/${encodeURIComponent(id)}`, { method: "PATCH", body, headers: { "X-CSRF-Token": csrfToken } });
  requireContract(managedRelay(payload));
  return payload;
}
export const deleteManagedRelay = (id: string, csrfToken: string) => api<void>(`/api/v2/relays/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken } });
