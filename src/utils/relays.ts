import type { ManagedRelay } from "../api/types";
import type { RelayEnrollment } from "../api/network-types";

export function relayDesiredStateText(state: string): string {
  const labels: Record<string, string> = { online: "启用", maintenance: "维护中", disabled: "已停用", revoked: "已撤销（不可恢复身份）" };
  return labels[state] ?? "未知期望状态";
}

export function relayBandwidthText(value: number): string {
  if (value === -1) return "取消限速";
  if (value === 0) return "使用中继本地配置";
  return `${value.toLocaleString("zh-CN")} 字节 / 秒 / 连接`;
}

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
