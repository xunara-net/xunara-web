<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { ApiError, errorMessage } from "../api/client";
import { accountExportDates, prepareAccountExport, type AccountExportFormat } from "../api/account-export";

const props = defineProps<{ userId: number; csrfToken: string; disabled?: boolean }>();
const emit = defineEmits<{ expired: [error: unknown] }>();
const format = ref<AccountExportFormat>("json");
const from = ref("");
const until = ref("");
const acknowledged = ref(false);
const busy = ref(false);
const error = ref("");
const message = ref("");
const urls = new Set<string>();
let controller: AbortController | null = null;
let disposed = false;

function clearUrls() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}

function cancel() {
  controller?.abort();
  acknowledged.value = false;
}

watch(() => [props.userId, props.csrfToken], () => { cancel(); clearUrls(); message.value = ""; error.value = ""; });
onBeforeUnmount(() => { disposed = true; cancel(); clearUrls(); });

async function download() {
  if (busy.value || props.disabled || !acknowledged.value) return;
  error.value = "";
  message.value = "";
  let dates: { from?: string; until?: string };
  try { dates = accountExportDates(from.value, until.value); } catch (err) { error.value = errorMessage(err); return; }
  const operation = new AbortController();
  controller = operation;
  busy.value = true;
  try {
    const file = await prepareAccountExport(format.value, props.userId, props.csrfToken, dates, operation.signal);
    if (disposed || operation.signal.aborted) return;
    const url = URL.createObjectURL(file.blob);
    urls.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000);
    message.value = "已交给浏览器下载，请在下载列表确认文件并妥善保管。";
  } catch (err) {
    if (disposed) return;
    if (operation.signal.aborted) { message.value = "已取消导出，未发起文件下载。"; return; }
    error.value = err instanceof ApiError && err.status === 404
      ? "当前服务端尚不支持个人导出，请联系管理员升级。"
      : err instanceof ApiError && err.errorCode === "API_RESPONSE_INVALID"
        ? "导出响应不完整或版本不匹配，未发起下载；请联系管理员检查。"
        : err instanceof ApiError && err.errorCode === "REQUEST_TIMEOUT"
          ? "导出请求超时，未发起下载；请稍后手动重试。" : errorMessage(err);
    if (err instanceof ApiError && err.status === 401) emit("expired", err);
  } finally {
    if (controller === operation) controller = null;
    if (!disposed) { busy.value = false; acknowledged.value = false; }
  }
}

function toggle(event: Event) {
  if (!(event.target as HTMLDetailsElement).open) cancel();
}
</script>

<template>
  <details class="card account-export" @toggle="toggle">
    <summary>个人数据导出 <span class="help">JSON 账户安全资料 / CSV 登录记录</span></summary>
    <form class="card-body" @submit.prevent="download">
      <p class="help">仅导出当前网络中本人的已保存资料，不含密码、令牌、密钥认证材料或其他成员数据。不是整个网络的备份。</p>
      <div class="field">
        <label for="account-export-format">导出内容</label>
        <select id="account-export-format" v-model="format" class="input" :disabled="busy || disabled">
          <option value="json">账户安全资料（JSON）</option>
          <option value="csv">成功登录记录（CSV）</option>
        </select>
        <div class="help">JSON 包含资料、绑定名称、通行密钥名称、活动会话和登录记录；CSV 只包含登录记录。</div>
      </div>
      <div class="export-dates">
        <div class="field"><label for="account-export-from">登录记录开始日期（可选）</label><input id="account-export-from" v-model="from" class="input" type="date" min="1971-01-01" max="2261-12-31" :disabled="busy || disabled" /></div>
        <div class="field"><label for="account-export-until">结束日期（包含当天，可选）</label><input id="account-export-until" v-model="until" class="input" type="date" min="1971-01-01" max="2261-12-31" :disabled="busy || disabled" /></div>
      </div>
      <p class="help">日期按浏览器时区计算，仅筛选登录记录，不筛选资料与绑定。每集合最多 5000 条、文件最多 8 MiB，超限会明确拒绝，不截断。CSV 中可能被当作公式的文本会加「文本：」前缀，原值请查看 JSON。</p>
      <label class="export-confirm"><input v-model="acknowledged" type="checkbox" :disabled="busy || disabled" />我知道文件含私人资料，将妥善保存，不公开分享。</label>
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
      <div v-if="message" class="alert info" role="status">{{ message }}</div>
      <div class="export-actions">
        <button class="btn primary" type="submit" :disabled="busy || disabled || !acknowledged">{{ busy ? "正在准备导出…" : "确认并下载" }}</button>
        <button v-if="busy" class="btn" type="button" @click="cancel">取消导出</button>
      </div>
    </form>
  </details>
</template>

<style scoped>
summary { cursor: pointer; padding: 16px; font-weight: 600; }
summary .help { display: block; margin: 6px 0 0; font-weight: 400; }
.card-body { display: grid; gap: 12px; }
.export-dates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.field { margin: 0; min-width: 0; }
.field .input { box-sizing: border-box; min-width: 0; max-width: 100%; }
.export-confirm { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; }
.export-confirm input { flex-shrink: 0; margin-top: 3px; }
.export-actions { display: flex; gap: 10px; flex-wrap: wrap; }
@media (max-width: 600px) { .export-dates { grid-template-columns: 1fr; } }
</style>
