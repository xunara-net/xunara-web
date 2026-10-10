import type { User } from "../api/types";

export function canManageMemberRoles(role: string | undefined): boolean {
  // 与服务端 requireOwner 对齐：管理员能管理设备，不代表能授予或收回成员角色。
  return role === "owner";
}

export function isLastOwner(user: User, users: readonly User[]): boolean {
  return user.role === "owner" && users.filter((member) => member.role === "owner").length === 1;
}

export function hasMemberVersion(user: User): boolean {
  return typeof user.updatedAt === "string" && user.updatedAt.length > 0 && Number.isFinite(Date.parse(user.updatedAt));
}

export function memberRoleUpdate(user: User, role: string): { role: string; expectedUpdatedAt: string } {
  if (!hasMemberVersion(user)) throw new Error("无法确认成员版本，请刷新列表或升级服务端后再修改角色");
  if (!["owner", "admin", "member"].includes(role)) throw new Error("不支持的成员角色");
  // 原样传回纳秒精度版本，不用 Date 转换成毫秒而误报冲突。
  return { role, expectedUpdatedAt: user.updatedAt! };
}
