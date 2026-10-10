import { describe, expect, it } from "vitest";
import { mergeRelayMaps, parseRelayMap } from "./external-relays";
import type { DERPMap } from "../api/external-relays";
function map(identifier: number): DERPMap { return { Regions: { [String(identifier)]: { RegionID: identifier, RegionCode: "external", RegionName: "公共地区", Nodes: [{ Name: `external-${identifier}`, RegionID: identifier, HostName: "relay.example.test", DERPPort: 8443, STUNPort: -1, CertName: "sha256-raw:" + "a".repeat(64) }] } } }; }
describe("external DERP map drafts", () => {
  it("keeps default/managed and existing external regions instead of overwriting", () => {
    const current = map(900), incoming = map(901);
    incoming.Regions["900"] = { ...current.Regions["900"]!, RegionName: "不能覆盖" };
    incoming.Regions["1"] = map(1).Regions["1"]!;
    incoming.HomeParams = { RegionScore: { "901": 0.5 } };
    const result = mergeRelayMaps(current, incoming, [1]);
    expect(result.skipped).toEqual([1, 900]);
    expect(result.map.Regions["900"]?.RegionName).toBe("公共地区");
    expect(result.map.Regions["901"]?.Nodes[0]?.STUNPort).toBe(-1);
    expect(result.map.HomeParams?.RegionScore?.["901"]).toBe(0.5);
    expect(Object.keys(current.Regions)).toEqual(["900"]);
  });
  it("rejects malformed documents and retains complete nodes", () => {
    expect(parseRelayMap(JSON.stringify(map(900))).Regions["900"]?.Nodes[0]?.CertName).toContain("sha256-raw:");
    for (const value of ["null", "{}", '{"Regions":[]}', '{"Regions":{"900":{"RegionID":901,"RegionCode":"x","RegionName":"x","Nodes":[]}}}']) expect(() => parseRelayMap(value)).toThrow();
  });
});
