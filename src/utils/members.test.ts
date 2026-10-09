import { describe, expect, it } from "vitest";
import type { User } from "../api/types";
import { canManageMemberRoles, isLastOwner } from "./members";

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
});
