import { api } from "./client";

export interface RelayHealthResult { relayId: string; configVersion: number; checkedAt: string; status: "reachable" | "unreachable" | "blocked";
  code: string; tlsVerified: boolean; httpStatus: number; latencyMilliseconds: number | null; perspective: "control-plane"; }
export async function checkRelayHealth(id: string, csrfToken: string): Promise<RelayHealthResult> {
  const payload = await api<RelayHealthResult>(`/api/v2/relays/${encodeURIComponent(id)}/health`, { method: "POST", body: {}, headers: { "X-CSRF-Token": csrfToken } });
  if (!payload || payload.relayId !== id || !Number.isSafeInteger(payload.configVersion) || payload.configVersion < 1 ||
      !Number.isFinite(Date.parse(payload.checkedAt)) || !["reachable", "unreachable", "blocked"].includes(payload.status) ||
      typeof payload.code !== "string" || typeof payload.tlsVerified !== "boolean" || !Number.isSafeInteger(payload.httpStatus) ||
      payload.httpStatus < 0 || payload.httpStatus > 599 || payload.perspective !== "control-plane" ||
      !(payload.latencyMilliseconds === null || (typeof payload.latencyMilliseconds === "number" && Number.isFinite(payload.latencyMilliseconds) && payload.latencyMilliseconds >= 0)) ||
      (payload.status === "reachable" && (!payload.tlsVerified || payload.httpStatus !== 200 || payload.code !== "OK" || payload.latencyMilliseconds === null))) {
    throw new Error("中继检测结果格式异常，请重新检测");
  }
  return payload;
}
export function relayHealthDescription(result: RelayHealthResult): string {
  if (result.status === "reachable") return `TLS/HTTP 服务可达 · ${result.latencyMilliseconds?.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ms`;
  const codes: Record<string, string> = { PROBE_ADDRESS_BLOCKED: "目标未通过公网地址校验（可能是内网地址或解析失败）", TARGET_CONFIGURATION_INVALID: "登记地址或端口不完整", TLS_PIN_INVALID: "登记证书指纹无效", PROBE_HTTP_UNEXPECTED: `探测响应异常（HTTP ${result.httpStatus}）`, PROBE_RESPONSE_FAILED: "探测响应未完整读取", CONNECT_OR_TLS_FAILED: "TCP 连接或 TLS 验证失败 / 超时" };
  return codes[result.code] || "检测未通过，请检查地址、证书与防火墙";
}
