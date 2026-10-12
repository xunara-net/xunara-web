import { describe, expect, it } from "vitest";
import { canAddRoute, exitNodeCommand, rebaseRouteSelection, routeState, stopExitNodeCommand, validRouteAddress, validRoutePrefix } from "./route-management";
import type { RouteNode } from "../api/route-management";
import type { Machine } from "../api/types";

describe("route and local exit helpers", () => {
  it.each(["0.0.0.0/0", "::/0", "10.0.0.0/8", "fd7a:115c:a1e0::/48", "100.100.1.2/32"])("accepts valid IPv4 and IPv6 prefixes %s", (prefix) => {
    expect(validRoutePrefix(prefix)).toBe(true);
  });
  it.each(["127.1", "10.0.0.256/24", "10.0.0.1/-1", "10.0.0.1/33", "fd7a::/129", "fd7a::/01", "fe80::1%eth0/64", "10.0.0.1/24;id"])("rejects malformed or shell-bearing prefixes %s", (prefix) => {
    expect(validRoutePrefix(prefix)).toBe(false);
  });
  it("checks exit and subnet entitlements independently", () => {
    const exitOnly = { max_routes: 4, allow_exit_node: true, allow_subnet_router: false };
    expect(canAddRoute("::/0", exitOnly)).toBe(true); expect(canAddRoute("10.0.0.0/8", exitOnly)).toBe(false);
    expect(canAddRoute("10.0.0.0/8", { ...exitOnly, allow_exit_node: false, allow_subnet_router: true })).toBe(true);
  });
  it("rebases only the user's explicit intent, preserving concurrent additions", () => {
    const latest = ["10.0.0.0/8", "192.168.5.0/24"];
    expect(rebaseRouteSelection(latest, { approve: ["::/0"], unapprove: ["10.0.0.0/8"] })).toEqual(["192.168.5.0/24", "::/0"]);
    expect(latest).toEqual(["10.0.0.0/8", "192.168.5.0/24"]);
  });
  it("does not label approved offline or withdrawn routes as reachable", () => {
    const item: RouteNode = { revision: "a".repeat(64), machine: { online: true, expired: false, approvedRoutes: ["10.0.0.0/8"], announcedRoutes: ["10.0.0.0/8"] } as Machine };
    expect(routeState(item, "10.0.0.0/8")).toBe("宣告与批准匹配");
    expect(routeState(item, "::/0")).toBe("待批准");
    expect(routeState({ ...item, machine: { ...item.machine, online: false } }, "10.0.0.0/8")).toContain("离线");
    expect(routeState({ ...item, machine: { ...item.machine, expired: true } }, "10.0.0.0/8")).toContain("过期");
    expect(routeState({ ...item, machine: { ...item.machine, announcedRoutes: [] } }, "10.0.0.0/8")).toContain("停止宣告");
  });
  it("generates client-local commands without login reset, URL, or secrets", () => {
    expect(exitNodeCommand("100.100.1.2", "linux", false)).toBe('sudo tailscale set --exit-node="100.100.1.2" --exit-node-allow-lan-access=false');
    expect(exitNodeCommand("fd7a:115c:a1e0::2", "windows", true)).toBe('tailscale set --exit-node="fd7a:115c:a1e0::2" --exit-node-allow-lan-access=true');
    expect(stopExitNodeCommand("macos")).toBe('tailscale set --exit-node="" --exit-node-allow-lan-access=false');
    for (const platform of ["android", "ios"] as const) { expect(exitNodeCommand("100.100.1.2", platform, false)).toBe(""); expect(stopExitNodeCommand(platform)).toBe(""); }
  });
  it.each(["100.100.1.2; id", "$(secret)", "127.1", "fe80::1%eth0", "https://node.test", "999.1.1.1", "01.2.3.4"])("rejects an unsafe local command address %s", (address) => {
    expect(validRouteAddress(address)).toBe(false); expect(() => exitNodeCommand(address, "linux", false)).toThrow();
  });
});
