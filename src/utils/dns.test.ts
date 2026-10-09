import { describe, expect, it } from "vitest";
import { buildDNSSettings, dnsEntries, fullRecordName } from "./dns";

describe("DNS editor", () => {
  it("preserves resolver/search order and normalizes split suffixes", () => {
    expect(dnsEntries("1.1.1.1，9.9.9.9\n1.1.1.1")).toEqual(["1.1.1.1", "9.9.9.9"]);
    expect(buildDNSSettings(true, "1.1.1.1", "home.test office.test", [{ domain: "Office.TEST.", servers: "10.0.0.53,10.0.0.54" }])).toEqual({ magic_dns: true, nameservers: ["1.1.1.1"], search_domains: ["home.test", "office.test"], split_dns: { "office.test": ["10.0.0.53", "10.0.0.54"] } });
  });
  it("rejects duplicate or incomplete routes instead of overwriting them", () => {
    expect(() => buildDNSSettings(true, "", "", [{ domain: "office.test", servers: "10.0.0.53" }, { domain: "Office.TEST.", servers: "10.0.0.54" }])).toThrow("重复");
    expect(() => buildDNSSettings(true, "", "", [{ domain: "office.test", servers: "" }])).toThrow();
  });
  it("expands only short names under the immutable network domain", () => {
    expect(fullRecordName("NAS", "xunara.test")).toBe("nas.xunara.test");
    expect(fullRecordName("nas.xunara.test.", "xunara.test")).toBe("nas.xunara.test");
    expect(() => fullRecordName("nas", "")).toThrow();
  });
});
