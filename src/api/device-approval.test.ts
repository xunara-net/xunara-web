import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { approveDevice, denyDevice, getDeviceApprovals } from "./endpoints";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "https://app.example.test", pathname: "/t/alice/devices" } });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it("reads tenant-scoped devices and the session-bound approval proof", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ devices: [{ id: "pending" }], csrf_token: "proof" })));
  expect(await getDeviceApprovals()).toEqual({ devices: [{ id: "pending" }], csrfToken: "proof" });
  expect(String(fetchMock.mock.calls[0]![0])).toBe("https://app.example.test/t/alice/api/v1/devices");
});

it.each([approveDevice, denyDevice])("sends approval proof only as a header", async (decide) => {
  fetchMock.mockResolvedValue(new Response("{}"));
  await decide("pending", "private-csrf-proof");
  const [url, options] = fetchMock.mock.calls[0]!;
  expect(String(url)).not.toContain("private-csrf-proof");
  expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("private-csrf-proof");
  expect(options?.method).toBe("POST");
});

it("does not invent an approval proof if an older API omits it", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ devices: [] })));
  expect(await getDeviceApprovals()).toEqual({ devices: [], csrfToken: "" });
});
