export type DeviceExpirySetting =
  | { mode: "schedule"; duration_seconds: number; expires_at?: never }
  | { mode: "schedule"; expires_at: string; duration_seconds?: never }
  | { mode: "disable" | "extend"; expires_at?: never; duration_seconds?: never };

export function localExpiryInput(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const padded = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${padded(date.getMonth() + 1)}-${padded(date.getDate())}T${padded(date.getHours())}:${padded(date.getMinutes())}`;
}

export function localExpiryToISO(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) throw new Error("请选择完整的到期日期和时间");
  const [year, month, day, hour, minute] = parts.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(year, month - 1, day, hour, minute);
  // 拒绝非法日期及夏令时跳变时被浏览器自动顺延的不存在时间。
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new Error("该日期或当地时间不存在，请重新选择");
  }
  return date.toISOString();
}

export function validateDeviceExpirySetting(setting: DeviceExpirySetting, serverNow: number, maxSeconds: number): void {
  if (!Number.isFinite(serverNow) || !Number.isSafeInteger(maxSeconds) || maxSeconds < 1) throw new Error("有效期策略未确认，请重新读取");
  if (setting.mode === "schedule") {
    if ((setting.expires_at === undefined) === (setting.duration_seconds === undefined)) throw new Error("请只选择一种到期时间方式");
    if (setting.duration_seconds !== undefined) {
      if (!Number.isSafeInteger(setting.duration_seconds) || setting.duration_seconds < 1 || setting.duration_seconds > maxSeconds) throw new Error("有效期需在未来 180 天以内");
    } else if (typeof setting.expires_at !== "string" || !Number.isFinite(Date.parse(setting.expires_at)) || Date.parse(setting.expires_at) <= serverNow || Date.parse(setting.expires_at) > serverNow + maxSeconds * 1000) {
      throw new Error("请选择未来 180 天以内的到期时间");
    }
  } else if (!["disable", "extend"].includes(setting.mode) || setting.expires_at !== undefined || setting.duration_seconds !== undefined) {
    throw new Error("有效期设置无效，请重新选择");
  }
}
