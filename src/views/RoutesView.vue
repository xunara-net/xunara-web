<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { RelayInfo, Route } from "../api/types";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";

const loading = ref(true);
const error = ref("");
const routes = ref<Route[]>([]);
const relays = ref<RelayInfo[]>([]);
const derp = ref<Record<string, unknown> | null>(null);
const exitNodes = ref<unknown[]>([]);

onMounted(async () => {
  try {
    const [r, rel, d, e] = await Promise.all([
      ep.listRoutes(),
      ep.listRelays().catch(() => []),
      ep.getDERP().catch(() => null),
      ep.listExitNodes().then((v) => v.exitNodes ?? []).catch(() => []),
    ]);
    routes.value = r;
    relays.value = rel;
    derp.value = d;
    exitNodes.value = e;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <PageHeader title="路由与出口" desc="子网路由、出口节点与中继状态。" />

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>

  <div class="grid cols-3">
    <div class="card stat">
      <div class="label">子网路由</div>
      <div class="value">{{ routes.length }}</div>
      <div class="sub">由设备宣告、控制面批准</div>
    </div>
    <div class="card stat">
      <div class="label">出口节点</div>
      <div class="value">{{ exitNodes.length }}</div>
      <div class="sub">允许客户端选择为全局出口</div>
    </div>
    <div class="card stat">
      <div class="label">中继（DERP）</div>
      <div class="value">{{ relays.length }}</div>
      <div class="sub">{{ derp && (derp as any).configured === false ? "未配置 DERP" : "已配置" }}</div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>子网路由</h2></div>
    <DataTable :columns="[
      { key: 'route', title: '网段' },
      { key: 'machine', title: '设备' },
      { key: 'approved', title: '状态' },
      { key: 'exitNode', title: '类型' },
    ]" :rows="routes" :loading="loading" empty-title="还没有子网路由">
      <template #cell-route="{ row }"><span class="mono">{{ row.route }}</span></template>
      <template #cell-approved="{ row }"><span class="badge" :class="row.approved ? 'success' : 'warning'">{{ row.approved ? "已批准" : "待批准" }}</span></template>
      <template #cell-exitNode="{ row }"><span class="badge" :class="row.exitNode ? 'primary' : ''">{{ row.exitNode ? "出口节点" : "子网" }}</span></template>
    </DataTable>
  </div>

  <div class="card">
    <div class="card-head"><h2>中继节点</h2><span class="hint">Xunara Relay / DERP</span></div>
    <DataTable :columns="[
      { key: 'name', title: '节点' },
      { key: 'region', title: '区域' },
      { key: 'status', title: '状态' },
    ]" :rows="relays" :loading="loading" empty-title="暂无自建中继" empty-desc="公共 DERP 由控制面配置；自建中继请部署 xunara-relay 并注册。">
      <template #cell-name="{ row }"><span class="mono">{{ row.name || row.id }}</span></template>
      <template #cell-region="{ row }">{{ row.region || "—" }}</template>
      <template #cell-status="{ row }"><span class="badge">{{ row.status || "未知" }}</span></template>
    </DataTable>
  </div>
</template>
