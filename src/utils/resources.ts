import { errorMessage } from "../api/client";

export interface ResourceState<Value> {
  data: Value | null;
  error: string;
}

export function emptyResource<Value>(): ResourceState<Value> {
  return { data: null, error: "" };
}

export async function refreshResource<Value>(state: ResourceState<Value>, load: () => Promise<Value>): Promise<void> {
  // 未知、读取失败和真实空列表是三种状态；失败后不能继续显示旧数据为实时结果。
  state.data = null;
  state.error = "";
  try {
    state.data = await load();
  } catch (error) {
    state.error = errorMessage(error);
  }
}
