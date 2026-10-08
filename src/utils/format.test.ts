import { describe, expect, it } from "vitest";
import { formatTime, priceText, quotaPercent, quotaText, relativeTime, roleLabel } from "./format";

describe("formatTime", () => {
  it("formats an ISO timestamp", () => {
    expect(formatTime("2026-10-09T02:00:00Z")).toMatch(/2026/);
  });

  it("returns a dash for empty or invalid values", () => {
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime("not-a-date")).toBe("—");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");

  it("describes recent times in Chinese", () => {
    expect(relativeTime("2026-10-09T11:59:30Z", now)).toBe("刚刚");
    expect(relativeTime("2026-10-09T11:30:00Z", now)).toBe("30 分钟前");
    expect(relativeTime("2026-10-09T02:00:00Z", now)).toBe("10 小时前");
    expect(relativeTime("2026-10-05T12:00:00Z", now)).toBe("4 天前");
  });

  it("describes a missing timestamp as never", () => {
    expect(relativeTime(undefined, now)).toBe("从未");
  });
});

describe("quota helpers", () => {
  it("renders unlimited quotas", () => {
    expect(quotaText(-1)).toBe("不限");
    expect(quotaText(10)).toBe("10");
    expect(quotaPercent(5, -1)).toBeNull();
  });

  it("caps the percentage at 100", () => {
    expect(quotaPercent(5, 10)).toBe(50);
    expect(quotaPercent(50, 10)).toBe(100);
  });
});

describe("priceText", () => {
  it("renders CNY and free plans", () => {
    expect(priceText(0, "CNY")).toBe("免费");
    expect(priceText(1990, "CNY")).toBe("¥19.90");
    expect(priceText(10000, "CNY")).toBe("¥100");
  });
});

describe("roleLabel", () => {
  it("translates known roles and passes through unknown ones", () => {
    expect(roleLabel("owner")).toBe("所有者");
    expect(roleLabel("member")).toBe("成员");
    expect(roleLabel("custom")).toBe("custom");
  });
});
