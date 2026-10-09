<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { SessionInfo } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import { formatTime, relativeTime } from "../utils/format";

const loading = ref(true);
const error = ref("");
const sessions = ref<SessionInfo[]>([]);
const snapshot = ref<Record<string, any> | null>(null);

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [s, snap] = await Promise.all([
      ep.listSessions(),
      ep.getSecurity().catch(() => null),
    ]);
    sessions.value = s;
    snapshot.value = snap as Record<string, any> | null;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function revoke(item: SessionInfo) {
  if (item.id === session.state.session?.id) {
    if (!window.confirm("这是当前会话，退出后需要重新登录。继续？")) return;
    await session.logout();
    window.location.href = "/login";
    return;
  }
  if (!window.confirm("撤销该会话？该设备上的登录会立即失效。")) return;
  try {
    await ep.revokeSession(item.id);
    session.toast("success", "会话已撤销");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  }
}
</script>

<template>
  <PageHeader title="安全中心" desc="登录会话、密钥有效期与安全状态。">
    <template #actions><RouterLink class="btn" to="/settings">修改密码</RouterLink></template>
  </PageHeader>

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>

  <div class="card">
    <div class="card-head">
      <h2>活动会话</h2>
      <span class="hint">退出其他设备或全部设备</span>
    </div>
    <DataTable :columns="[
      { key: 'id', title: '会话' },
      { key: 'authMethod', title: '登录方式' },
      { key: 'createdAt', title: '登录时间' },
      { key: 'expiresAt', title: '过期时间' },
      { key: 'actions', title: '操作', align: 'right' },
    ]" :rows="sessions" :loading="loading" row-key="id" empty-title="没有活动会话">
      <template #cell-id="{ row }">
        <span class="mono">{{ row.id.slice(0, 12) }}…</span>
        <span v-if="row.id === session.state.session?.id" class="badge success" style="margin-left: 6px">当前</span>
      </template>
      <template #cell-authMethod="{ row }">{{ row.authMethod }}</template>
      <template #cell-createdAt="{ row }">{{ relativeTime(row.createdAt) }}</template>
      <template #cell-expiresAt="{ row }">{{ formatTime(row.expiresAt) }}</template>
      <template #cell-actions="{ row }">
        <div class="row-actions"><button class="btn small danger" @click="revoke(row)">撤销</button></div>
      </template>
    </DataTable>
  </div>

  <div v-if="snapshot" class="card">
    <div class="card-head"><h2>安全概览</h2></div>
    <div class="card-body">
      <pre class="mono" style="white-space: pre-wrap; margin: 0; color: var(--text-muted)">{{ JSON.stringify(snapshot, null, 2) }}</pre>
    </div>
  </div>
</template>
