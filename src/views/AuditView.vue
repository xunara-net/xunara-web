<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { AuditEvent } from "../api/types";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import { formatTime } from "../utils/format";

const loading = ref(true);
const error = ref("");
const events = ref<AuditEvent[]>([]);
const limit = ref(100);

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    events.value = await ep.listAudit(limit.value);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <PageHeader title="审计日志" desc="登录、设备、密钥、权限与平台操作记录。">
    <template #actions>
      <select v-model.number="limit" class="select" style="width: 120px" @change="load">
        <option :value="50">最近 50 条</option>
        <option :value="100">最近 100 条</option>
        <option :value="500">最近 500 条</option>
      </select>
      <button class="btn" @click="load">刷新</button>
    </template>
  </PageHeader>

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>

  <div class="card">
    <div class="card-head"><h2>事件（{{ events.length }}）</h2><span class="hint">时间倒序</span></div>
    <DataTable :columns="[
      { key: 'at', title: '时间', width: '170px' },
      { key: 'action', title: '操作' },
      { key: 'actor', title: '操作者' },
      { key: 'resource', title: '对象' },
      { key: 'detail', title: '说明' },
    ]" :rows="events" :loading="loading" empty-title="暂无审计事件">
      <template #cell-at="{ row }"><span class="nowrap">{{ formatTime(row.at ?? row.time) }}</span></template>
      <template #cell-action="{ row }"><span class="mono">{{ row.action }}</span></template>
      <template #cell-actor="{ row }"><span class="mono">{{ row.actor }}</span></template>
      <template #cell-resource="{ row }"><span class="mono">{{ row.resource }}</span></template>
      <template #cell-detail="{ row }"><span style="color: var(--text-muted)">{{ row.detail || "—" }}</span></template>
    </DataTable>
  </div>
</template>
