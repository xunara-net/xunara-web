import { describe, expect, it } from "vitest";
import type { User } from "../api/types";
import { canManageMemberRoles, hasMemberVersion, isLastOwner, memberRoleUpdate } from "./members";

const owner: User = { id: 1, loginName: "owner", displayName: "所有者", email: "", role: "owner" };

describe("member role boundaries", () => {
  it("allows only the server-defined owner role to manage roles", () => {
    expect(canManageMemberRoles("owner")).toBe(true);
    for (const role of ["admin", "member", "viewer", "unknown", undefined]) {
      expect(canManageMemberRoles(role)).toBe(false);
    }
  });

  it("protects the last owner without blocking other members", () => {
    const member = { ...owner, id: 2, role: "member" };
    expect(isLastOwner(owner, [owner, member])).toBe(true);
    expect(isLastOwner(member, [owner, member])).toBe(false);
    expect(isLastOwner(owner, [owner, { ...member, role: "owner" }])).toBe(false);
  });

  it("keeps the server's nanosecond version in a role change", () => {
    const updatedAt = "2026-10-11T00:00:00.123456789Z";
    const member = { ...owner, role: "member", updatedAt };
    expect(memberRoleUpdate(member, "admin")).toEqual({ role: "admin", expectedUpdatedAt: updatedAt });
    expect(member.updatedAt).toBe(updatedAt);
  });

  it("does not invent versions or offer unsupported roles", () => {
    for (const updatedAt of [undefined, "", "invalid"]) {
      const member = { ...owner, updatedAt };
      expect(hasMemberVersion(member)).toBe(false);
      expect(() => memberRoleUpdate(member, "admin")).toThrow("无法确认成员版本");
    }
    expect(() => memberRoleUpdate({ ...owner, updatedAt: "2026-10-11T00:00:00Z" }, "viewer")).toThrow("不支持的成员角色");
  });
});
