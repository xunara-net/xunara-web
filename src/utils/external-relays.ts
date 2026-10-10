import { checkDERPMap } from "../api/external-relays";
import type { DERPMap } from "../api/external-relays";
export function parseRelayMap(content: string): DERPMap {
  const value: unknown = JSON.parse(content);
  checkDERPMap(value); return value;
}
// 导入只追加到草稿，不替换部署默认地区或已经编辑的外部地区。
export function mergeRelayMaps(current: DERPMap, incoming: DERPMap, blocked: number[]) {
  checkDERPMap(current); checkDERPMap(incoming);
  const result: DERPMap = structuredClone(current);
  const skipped: number[] = [];
  for (const region of Object.values(incoming.Regions)) {
    if (blocked.includes(region.RegionID) || result.Regions[String(region.RegionID)]) { skipped.push(region.RegionID); continue; }
    result.Regions[String(region.RegionID)] = structuredClone(region);
    const score = incoming.HomeParams?.RegionScore?.[String(region.RegionID)];
    if (score !== undefined) {
      result.HomeParams ??= { RegionScore: {} }; result.HomeParams.RegionScore ??= {};
      result.HomeParams.RegionScore[String(region.RegionID)] = score;
    }
  }
  checkDERPMap(result);
  return { map: result, skipped };
}
