import { describe, expect, it } from "vitest";
import { addressRecordProtected, describePolicyDiff, parseSelectors, putVisualRule, removeVisualRule, ruleIP, trafficTemplate, visualRules } from "./policy";
import type { PolicyDocument } from "../api/network-types";

describe("one policy AST for visual editing", () => {
  it("creates the plan-allowed rule type without losing other sections", () => {
    const original: PolicyDocument = { ssh: [{ action: "check" }], nodeAttrs: [{ attr: ["https"] }], tests: [{ src: "alice" }], hosts: { nas: "100.64.0.2" } };
    const grants = putVisualRule(original, "group:office", "tag:home", "tcp", "22,443", true);
    expect(grants.grants).toEqual([{ src: ["group:office"], dst: ["tag:home"], ip: ["tcp:22", "tcp:443"] }]);
    expect(grants.ssh).toEqual(original.ssh);
    expect(original.grants).toBeUndefined();
    const acl = putVisualRule(original, "alice", "100.64.0.2", "udp", "53", false);
    expect(acl.acls).toEqual([{ action: "accept", src: ["alice"], dst: ["100.64.0.2:53"], proto: "udp" }]);
  });

  it("updates legacy fields without leaving an additional old rule implementation", () => {
    const original: PolicyDocument = { acls: [{ users: ["*"], ports: ["*:22"] }] };
    const next = putVisualRule(original, "alice", "tag:home", "tcp", "443", false, visualRules(original)[0]);
    expect(next.acls).toEqual([{ action: "accept", src: ["alice"], dst: ["tag:home:443"], proto: "tcp" }]);
    expect(original.acls?.[0]?.users).toEqual(["*"]);
  });

  it("does not widen destination-specific ports through a lossy form conversion", () => {
    const original: PolicyDocument = { acls: [{ src: ["*"], dst: ["tag:home:22", "tag:office:443"], proto: "tcp" }] };
    const rule = visualRules(original)[0]!;
    expect(rule.editable).toBe(false);
    expect(() => putVisualRule(original, "*", "tag:home,tag:office", "tcp", "22,443", false, rule)).toThrow("无损转换");
  });

  it("preserves application grants when applying a network isolation template", () => {
    const original: PolicyDocument = { grants: [{ src: ["alice"], dst: ["tag:home"], ip: ["tcp:443"], app: { "example.test/cap/read": [{ level: "read" }] } }], ssh: [{ action: "check" }] };
    const isolated = trafficTemplate(original, "isolate", true);
    expect(isolated.grants).toEqual([{ src: ["alice"], dst: ["tag:home"], app: { "example.test/cap/read": [{ level: "read" }] } }]);
    expect(isolated.acls).toEqual([]);
    expect(isolated.ssh).toEqual(original.ssh);
    const narrowed = putVisualRule(original, "bob", "tag:home", "tcp", "22", true, visualRules(original)[0]);
    expect(narrowed.grants?.[0]?.app).toEqual(original.grants?.[0]?.app);
  });

  it("removes the selected rule only", () => {
    const document: PolicyDocument = { acls: [{ src: ["*"], dst: ["*:22"] }], grants: [{ src: ["alice"], dst: ["*"], ip: ["tcp:443"] }] };
    expect(removeVisualRule(document, visualRules(document)[0]!).grants).toEqual(document.grants);
    expect(document.acls).toHaveLength(1);
  });

  it("parses and validates services rather than silently treating invalid ports as all", () => {
    expect(ruleIP("tcp", "22，443,8000-8010")).toEqual(["tcp:22", "tcp:443", "tcp:8000-8010"]);
    expect(ruleIP("*", "*")).toEqual(["*"]);
    for (const ports of ["", "0", "65536", "443-22", "22,", "NaN"]) expect(() => ruleIP("tcp", ports)).toThrow();
    expect(() => ruleIP("unknown", "22")).toThrow();
    expect(parseSelectors("tag:home, group:office，tag:home")).toEqual(["tag:home", "group:office"]);
  });

  it("describes permission diffs in ordinary language and preserves raw details separately", () => {
    expect(describePolicyDiff('acls: {"src":["*"],"dst":["tag:home:443"],"proto":"tcp"}', [])).toBe("全部设备 → 设备组 · home · tcp:443");
    expect(describePolicyDiff('ssh: {"action":"check"}', [])).toContain("SSH 登录策略变更");
  });

  it("protects device, certificate and client-unsupported records", () => {
    expect(addressRecordProtected({ name: "nas.xunara.test", node_id: 0, type: "A" })).toBe(false);
    for (const record of [{ name: "node.xunara.test", node_id: 1, type: "A" }, { name: "_acme-challenge.node.xunara.test", node_id: 0, type: "TXT" }, { name: "nas.xunara.test", node_id: 0, type: "CNAME" }]) expect(addressRecordProtected(record)).toBe(true);
  });
});
