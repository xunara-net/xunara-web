import type { ManagedRelay } from "../api/types";
import type { RelayEnrollment } from "../api/network-types";

export function relayStatus(relay: ManagedRelay): string {
  if (relay.desiredState === "revoked") return "已撤销";
  if (relay.desiredState === "disabled") return "已禁用";
  if (relay.desiredState === "maintenance") return "维护中";
  if (!relay.lastSeen) return "尚无心跳";
  if (!relay.online) return "心跳离线";
  return relay.healthy ? "心跳在线" : "心跳在线 · 健康异常";
}
export function enrollmentStatus(token: RelayEnrollment): string {
  if (token.used) return "已使用";
  return token.expired ? "已过期" : "待接入";
}
export function relayInstallCommand(controlURL: string): string {
  const url = new URL(controlURL);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("请使用不含密钥的租户控制面根地址");
  const quotedURL = `'${url.origin.replace(/'/g, "'\\''")}'`;
  return `read -r -s -p '请输入一次性接入令牌: ' XUNARA_RELAY_TOKEN; printf '\\n'\nexport XUNARA_RELAY_TOKEN\nxunara-relay -control-url ${quotedURL} -enroll-token-env XUNARA_RELAY_TOKEN -state-dir ./relay-state -hostname YOUR_RELAY_IP -listen :443 -cert-mode selfsigned -region-id 40001 -region-code private -region-name '私有中继' -visibility private\nunset XUNARA_RELAY_TOKEN`;
}
