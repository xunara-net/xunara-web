import { api } from "./client";

export function passwordResetError(code: string, password: string, confirmation: string): string {
  if (!/^reset-[A-Za-z0-9_-]{43}$/.test(code.trim())) return "请输入管理员提供的完整一次性重置码";
  if ([...password].length < 12) return "新密码至少需要 12 个字符";
  if (new TextEncoder().encode(password).length > 72) return "新密码不能超过 72 字节（中文和表情会占多个字节）";
  if (password !== confirmation) return "两次输入的新密码不一致";
  return "";
}

export async function resetPassword(code: string, password: string, confirmation: string) {
  const validation = passwordResetError(code, password, confirmation);
  if (validation) throw new Error(validation);
  // 重置码只进入这次 JSON body，不放 query、地址栏、持久存储或自动重试队列。
  const payload = await api<{ changed: true; revoked_sessions: number }>("/api/v1/auth/password-reset", {
    method: "POST", body: { code: code.trim(), new_password: password, confirm_password: confirmation },
  });
  if (!payload || payload.changed !== true || !Number.isSafeInteger(payload.revoked_sessions) || payload.revoked_sessions < 0) {
    throw new Error("重置响应格式不正确，结果未知；请先尝试使用新密码登录，不要连续重复提交");
  }
  return payload;
}
