import { describe, expect, it } from "vitest";
import { emptyResource, refreshResource } from "./resources";

describe("independent resource loading", () => {
  it("starts unknown rather than inventing an empty list", () => {
    expect(emptyResource<number[]>()).toEqual({ data: null, error: "" });
  });

  it("shows a server-confirmed empty list", async () => {
    const resource = emptyResource<number[]>();
    await refreshResource(resource, async () => []);
    expect(resource).toEqual({ data: [], error: "" });
  });

  it("clears stale data on failure and recovers on retry", async () => {
    const resource = { data: [3] as number[] | null, error: "" };
    await refreshResource(resource, async () => { throw new Error("读取失败"); });
    expect(resource).toEqual({ data: null, error: "读取失败" });
    await refreshResource(resource, async () => [2]);
    expect(resource).toEqual({ data: [2], error: "" });
  });

  it("keeps successful results when another resource fails", async () => {
    const routes = emptyResource<number[]>();
    const relays = emptyResource<number[]>();
    await Promise.all([
      refreshResource(routes, async () => [1]),
      refreshResource(relays, async () => { throw new Error("中继读取失败"); }),
    ]);
    expect(routes.data).toEqual([1]);
    expect(relays).toEqual({ data: null, error: "中继读取失败" });
  });
});
