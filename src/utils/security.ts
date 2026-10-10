import type { AccountSession, SecurityFinding } from "../api/types";

export function splitAccountSessions(sessions: AccountSession[], currentId: string) {
  const active = sessions.filter((item) => item.status === "active");
  active.sort((first, second) => Number(second.id === currentId) - Number(first.id === currentId));
  return {
    active,
    history: sessions.filter((item) => item.status !== "active"),
    otherCount: active.filter((item) => item.id !== currentId).length,
  };
}

export function authMethodLabel(method: string): string {
  if (method === "local") return "密码登录";
  if (method === "passkey") return "通行密钥";
  if (method.startsWith("oidc:")) return `第三方登录 · ${method.slice(5)}`;
  return method ? `第三方登录 · ${method}` : "未记录";
}

export function revokedReasonLabel(reason?: string): string {
  const labels: Record<string, string> = {
    "signed out all sessions": "退出全部登录",
    "signed out other sessions": "退出其他登录",
    "signed out one session": "单独退出",
    "password changed": "修改密码后退出",
    "identity unlinked": "第三方账号解绑后退出",
    rotated: "会话已轮换",
    logout: "主动退出",
    "revoked by the platform operator": "管理员强制下线",
    "revoked through the platform API": "通过接口撤销",
  };
  return reason ? labels[reason] ?? reason : "已退出";
}

export function severityLabel(severity: string) {
  const labels: Record<string, { label: string; tone: string }> = {
    high: { label: "高风险", tone: "danger" },
    medium: { label: "需处理", tone: "warning" },
    low: { label: "建议关注", tone: "warning" },
    info: { label: "提示", tone: "primary" },
  };
  return labels[severity] ?? { label: "安全提示", tone: "" };
}

export function securityFindingText(finding: SecurityFinding): { title: string; detail: string; route?: string } {
  const translations: Record<string, { title: string; detail: string; route: string }> = {
    "policy.absent": {
      title: "尚未设置设备访问规则",
      detail: "网络内设备默认可以互相访问。可先查看访问权限，再请管理员配置符合实际需求的规则。",
      route: "/permissions",
    },
    "policy.load_error": {
      title: "访问规则加载失败",
      detail: "当前仍在执行上次有效的策略，请管理员检查并修复服务端策略配置。",
      route: "/permissions",
    },
    "tka.unsigned_nodes": {
      title: "网络锁已启用，但存在未签名设备",
      detail: "这些设备可能无法访问启用网络锁的对端，请管理员完成签名或移除不可信设备。",
      route: "/devices",
    },
    "nodes.expired_keys": {
      title: "存在密钥已过期的设备",
      detail: "相关设备需要重新认证才能接入网络，请检查设备详情。",
      route: "/devices",
    },
    "nodes.keys_expiring": {
      title: "设备密钥将在 30 天内到期",
      detail: "请及时重新认证，避免密钥到期导致设备失联。",
      route: "/devices",
    },
    "apikeys.never_expires": {
      title: "存在长期有效的 API 密钥",
      detail: "建议设置有效期，及时撤销不再使用的服务密钥；退出控制台登录不会撤销这些密钥。",
      route: "/api",
    },
    "devices.pending": {
      title: "有设备正在等待审批",
      detail: "请仅批准本人或可信成员发起的设备连接，拒绝不明来源的申请。",
      route: "/devices",
    },
  };
  return translations[finding.id] ?? { title: finding.title, detail: finding.detail };
}
