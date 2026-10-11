<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getAccountLoginHistory } from "../api/login-history";
import { ApiError, errorMessage } from "../api/client";
import type { AccountLoginHistory } from "../api/types";
import { session } from "../store";
import { formatTime, relativeTime } from "../utils/format";
import { authMethodLabel, revokedReasonLabel, sessionClientLabel } from "../utils/security";

const props = defineProps<{ refreshKey: number }>();
const router = useRouter();
const expanded = ref(false);
const loading = ref(false);
const error = ref("");
const history = ref<AccountLoginHistory | null>(null);
const cursors = ref([""]);
const page = ref(0);
const retry = ref({ page: 0, cursor: "" });
let requestVersion = 0;
let disposed = false;
onBeforeUnmount(() => { disposed = true; requestVersion++; });
watch(() => props.refreshKey, () => { if (expanded.value) void loadPage(0, ""); });

function toggle(event: Event) {
  expanded.value = (event.target as HTMLDetailsElement).open;
  if (expanded.value && !history.value && !loading.value) void loadPage(0, "");
}

async function loadPage(target: number, cursor: string) {
  const version = ++requestVersion;
  loading.value = true;
  error.value = "";
  retry.value = { page: target, cursor };
  try {
    const payload = await getAccountLoginHistory(cursor);
    if (disposed || version !== requestVersion) return;
    history.value = payload;
    page.value = target;
    if (target === 0) cursors.value = [""];
    cursors.value[target] = cursor;
    cursors.value = cursors.value.slice(0, target + 1);
  } catch (failure) {
    if (disposed || version !== requestVersion) return;
    error.value = failure instanceof ApiError && failure.status === 404
      ? "服务端尚未支持独立登录历史，请联系管理员升级；活动登录仍可管理。"
      : errorMessage(failure);
    if (failure instanceof ApiError && failure.status === 401) {
      session.forget();
      await router.replace({ name: "login", query: { return_to: "/security" } });
    }
  } finally {
    if (!disposed && version === requestVersion) loading.value = false;
  }
}
</script>

<template>
  <details class="card login-history" @toggle="toggle">
    <summary>登录记录 <span class="hint">查看来源与最近活动</span></summary>
    <div v-if="expanded" class="card-body">
      <p class="history-note">记录成功登录和会话轮换，即使过期会话被清理仍会保留。旧记录的来源无法补录；浏览器信息为客户端自报，未进行地理定位。不包含失败登录尝试。</p>
      <div class="history-toolbar">
        <span v-if="history">第 {{ page + 1 }} 页 · {{ history.records.length }} 条</span><span v-else>仅本人记录</span>
        <button class="btn small" :disabled="loading" @click="loadPage(0, '')">{{ loading ? '读取中…' : '刷新最新记录' }}</button>
      </div>
      <div v-if="error" class="alert error" role="alert">{{ error }} <button class="btn small" :disabled="loading" @click="loadPage(retry.page, retry.cursor)">重试读取</button></div>
      <p v-if="error && history" class="history-note">以下保留上次成功读取的记录；读取失败不代表没有登录记录。</p>
      <div v-if="loading" class="page-loading" role="status">正在读取登录记录…</div>
      <div v-else-if="history" class="history-list">
        <p v-if="!history.records.length && !error" class="history-note">服务端未保留此页登录记录。</p>
        <article v-for="record in history.records" :key="record.id" class="history-record">
          <div class="record-heading">
            <strong>{{ sessionClientLabel(record.userAgent) }}</strong>
            <div class="record-badges">
              <span v-if="record.id === history.currentSessionId" class="badge primary">当前</span>
              <span class="badge" :class="record.status === 'active' ? 'success' : ''">{{ record.status === 'active' ? '有效' : record.status === 'expired' ? '已过期' : '已退出' }}</span>
              <span v-if="record.kind !== 'login'" class="badge">{{ record.kind === 'rotation' ? '会话轮换' : '旧记录' }}</span>
            </div>
          </div>
          <div class="record-method">{{ authMethodLabel(record.authMethod) }} · <span class="mono">{{ record.clientIP || '来源 IP 未记录' }}</span></div>
          <dl class="record-facts">
            <div><dt>{{ record.kind === 'rotation' ? '轮换时间' : '登录时间' }}</dt><dd>{{ formatTime(record.createdAt) }}</dd></div>
            <div><dt>最近活动</dt><dd :title="formatTime(record.lastSeenAt)">{{ record.lastSeenAt ? relativeTime(record.lastSeenAt) : '未记录' }}</dd></div>
            <div><dt>{{ record.status === 'revoked' ? '退出时间' : '到期时间' }}</dt><dd>{{ formatTime(record.revokedAt || record.expiresAt) }}</dd></div>
          </dl>
          <p v-if="record.status === 'revoked'" class="history-note">{{ revokedReasonLabel(record.revokedReason) }}</p>
          <p v-if="record.kind === 'rotation'" class="history-note">来源继承原登录，不代表在此时间重新完成认证。</p>
          <details v-if="record.userAgent" class="agent-details"><summary>查看客户端自报信息</summary><div>{{ record.userAgent }}</div></details>
        </article>
      </div>
      <div v-if="history" class="history-toolbar pagination">
        <button class="btn small" :disabled="loading || page === 0" @click="loadPage(page - 1, cursors[page - 1] ?? '')">上一页</button>
        <span class="hint">活动时间按分钟记录，不代表设备实时在线。</span>
        <button class="btn small" :disabled="loading || !history.nextCursor" @click="loadPage(page + 1, history.nextCursor)">下一页</button>
      </div>
    </div>
  </details>
</template>

<style scoped>
.login-history > summary { padding: 18px; cursor: pointer; font-weight: 600; }
.login-history > summary .hint { margin-left: 8px; font-weight: 400; }
.history-note { color: var(--text-muted); font-size: 12.5px; line-height: 1.8; margin: 8px 0; }
.history-toolbar, .record-heading, .record-badges { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.history-toolbar { margin: 16px 0; }
.history-record { border-top: 1px solid var(--border); padding: 16px 0; min-width: 0; }
.record-method { color: var(--text-muted); margin-top: 8px; overflow-wrap: anywhere; }
.record-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 14px 0 0; }
.record-facts dt { color: var(--text-muted); font-size: 12px; }
.record-facts dd { margin: 4px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.agent-details { color: var(--text-muted); font-size: 12px; margin-top: 10px; }
.agent-details summary { cursor: pointer; }
.agent-details div { padding-top: 8px; overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: 640px) {
  .record-facts { grid-template-columns: 1fr; gap: 8px; }
  .record-facts > div { display: flex; justify-content: space-between; gap: 12px; }
  .record-facts dd { margin: 0; text-align: right; }
  .pagination .hint { width: 100%; order: 3; }
}
</style>
