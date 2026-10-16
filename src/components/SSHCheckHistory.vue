<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { listSSHChecks, sshCheckStates, type SSHCheckPage, type SSHCheckPeer, type SSHCheckState } from "../api/ssh-check";
import { ApiError, errorMessage } from "../api/client";
import { formatTime } from "../utils/format";
import { session } from "../store";

const route = useRoute();
const router = useRouter();
const expanded = ref(false);
const state = ref<SSHCheckState | "">("");
const data = ref<SSHCheckPage | null>(null);
const loading = ref(false);
const error = ref("");
const cursors = ref([""]);
const page = ref(0);
const retry = ref({ page: 0, cursor: "" });
let controller: AbortController | undefined;
let disposed = false;
onBeforeUnmount(() => { disposed = true; controller?.abort(); });
watch(() => route.hash, (hash) => {
  if (hash !== "#ssh-check") return;
  expanded.value = true;
  if (!data.value && !loading.value) void load(0, "");
}, { immediate: true });

function peerName(value: SSHCheckPeer) { return value.hostname || value.stableId || `已删除设备 #${value.nodeId}`; }
function toggle(event: Event) {
  expanded.value = (event.target as HTMLDetailsElement).open;
  if (expanded.value && !data.value && !loading.value) void load(0, "");
}
function filter() {
  data.value = null;
  cursors.value = [""];
  page.value = 0;
  void load(0, "");
}
async function load(target: number, cursor: string) {
  controller?.abort();
  const pending = new AbortController();
  controller = pending;
  loading.value = true;
  error.value = "";
  retry.value = { page: target, cursor };
  try {
    const payload = await listSSHChecks(state.value, cursor, pending.signal);
    if (disposed || pending.signal.aborted) return;
    data.value = payload;
    page.value = target;
    if (target === 0) cursors.value = [""];
    cursors.value[target] = cursor;
    cursors.value = cursors.value.slice(0, target + 1);
  } catch (failure) {
    if (disposed || pending.signal.aborted) return;
    error.value = errorMessage(failure);
    if (failure instanceof ApiError && failure.status === 401) {
      session.forget();
      await router.replace({ name: "login", query: { return_to: "/security#ssh-check" } });
    }
  } finally {
    if (!disposed && !pending.signal.aborted) loading.value = false;
  }
}
</script>

<template>
  <details id="ssh-check" class="card ssh-history" :open="expanded" @toggle="toggle">
    <summary>SSH 连接审批 <span class="hint">查看来源、目标及审批结果</span></summary>
    <div v-if="expanded" class="card-body">
      <p class="hint">这里是本网络的短期审批记录，不代表连接已建立或仍在线。批准 / 拒绝仍须在客户端提供的独立授权页面完成；长期变更记录请查看<RouterLink to="/audit">审计日志</RouterLink>。</p>
      <div class="ssh-toolbar">
        <label>状态 <select v-model="state" class="input" aria-label="审批状态" :disabled="loading" @change="filter"><option value="">全部状态</option><option v-for="(label, value) in sshCheckStates" :key="value" :value="value">{{ label }}</option></select></label>
        <button class="btn small" :disabled="loading" @click="load(0, '')">{{ loading ? '读取中…' : '刷新记录' }}</button>
      </div>
      <div v-if="error" class="alert error" role="alert">{{ error }} <button class="btn small" :disabled="loading" @click="load(retry.page, retry.cursor)">重试</button></div>
      <p v-if="error && data" class="hint">保留上次成功读取的记录；读取失败不表示没有审批。</p>
      <p v-if="loading" class="hint" role="status">正在读取 SSH 审批记录…</p>
      <div v-else-if="data" class="ssh-records">
        <p v-if="!error && !data.items.length" class="hint">此页没有符合条件的审批记录；已清理的短期记录不会补录。</p>
        <article v-for="record in data.items" :key="record.id" class="ssh-record">
          <div class="ssh-heading"><strong>{{ peerName(record.src) }} → {{ peerName(record.dst) }}</strong><span class="badge" :class="record.state === 'pending' ? 'warning' : record.state === 'accepted' ? 'success' : ''">{{ sshCheckStates[record.state] }}</span></div>
          <dl>
            <div><dt>来源设备</dt><dd><RouterLink v-if="record.src.stableId" :to="`/devices/${encodeURIComponent(record.src.stableId)}`">{{ peerName(record.src) }}</RouterLink><span v-else>{{ peerName(record.src) }}</span></dd></div>
            <div><dt>目标设备</dt><dd><RouterLink v-if="record.dst.stableId" :to="`/devices/${encodeURIComponent(record.dst.stableId)}`">{{ peerName(record.dst) }}</RouterLink><span v-else>{{ peerName(record.dst) }}</span></dd></div>
            <div><dt>系统账号</dt><dd class="mono">{{ record.localUser || '未指定' }}</dd></div>
            <div><dt>请求时间</dt><dd>{{ formatTime(record.createdAt) }}</dd></div>
            <div><dt>审批期限</dt><dd>{{ formatTime(record.expiresAt) }}</dd></div>
            <div v-if="record.decidedBy"><dt>审批人</dt><dd>{{ record.decidedBy.loginName || `账号 #${record.decidedBy.userId}` }}</dd></div>
            <div v-if="record.decidedAt"><dt>决策时间</dt><dd>{{ formatTime(record.decidedAt) }}</dd></div>
            <div v-if="record.state === 'consumed'"><dt>结果已取走</dt><dd>{{ record.verdict === 'accept' ? '批准' : '拒绝' }} · {{ formatTime(record.consumedAt) }}</dd></div>
          </dl>
        </article>
      </div>
      <div v-if="data" class="ssh-toolbar">
        <button class="btn small" :disabled="loading || page === 0" @click="load(page - 1, cursors[page - 1] ?? '')">上一页</button><span class="hint">第 {{ page + 1 }} 页</span><button class="btn small" :disabled="loading || !data.nextCursor" @click="load(page + 1, data.nextCursor)">下一页</button>
      </div>
    </div>
  </details>
</template>

<style scoped>
.ssh-history { scroll-margin-top: 80px; }
.ssh-history > summary { padding: 18px; cursor: pointer; font-weight: 600; }
.ssh-history > summary .hint { margin-left: 8px; font-weight: 400; }
.ssh-toolbar, .ssh-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin: 14px 0; }
.ssh-toolbar label { display: flex; align-items: center; gap: 8px; }
.ssh-toolbar select { width: auto; }
.ssh-record { border-top: 1px solid var(--border); padding: 8px 0; min-width: 0; }
.ssh-heading strong { overflow-wrap: anywhere; min-width: 0; }
.ssh-record dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ssh-record dt { color: var(--text-muted); font-size: 12px; }
.ssh-record dd { margin: 4px 0 0; font-size: 13px; overflow-wrap: anywhere; }
@media (max-width: 640px) { .ssh-record dl { grid-template-columns: 1fr; } }
</style>
