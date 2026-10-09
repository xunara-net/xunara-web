import type { User } from "../api/types";

export function canManageMemberRoles(role: string | undefined): boolean {
  // 与服务端 requireOwner 对齐：管理员能管理设备，不代表能授予或收回成员角色。
  return role === "owner";
}

export function isLastOwner(user: User, users: readonly User[]): boolean {
  return user.role === "owner" && users.filter((member) => member.role === "owner").length === 1;
}
