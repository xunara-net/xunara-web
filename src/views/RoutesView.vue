<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import * as ep from "../api/endpoints";
import type { Route } from "../api/types";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import { emptyResource, refreshResource } from "../utils/resources";
const loading = ref(false);
const routes = reactive(emptyResource<Route[]>());
const exitNodes = reactive(emptyResource<unknown[]>());
onMounted(load);
async function load() {
  if (loading.value) return;
  loading.value = true;
  await Promise.all([refreshResource(routes, ep.listRoutes), refreshResource(exitNodes, ep.listExitNodes)]);
  loading.value = false;
}
</script>
<template>
  <PageHeader title="路由与出口" desc="路由批准不等于访问授权；还需访问权限允许及客户端启用路由。"><template #actions><button class="btn" :disabled="loading" @click="load">刷新</button></template></PageHeader>
  <div class="toolbar"><span class="badge">子网路由 {{ routes.data?.length ?? '—' }}</span><span class="badge">出口节点 {{ exitNodes.data?.length ?? '—' }}</span><router-link to="/devices">到设备详情审批路由 →</router-link></div>
  <div v-if="exitNodes.error" class="alert error" role="alert">出口节点读取失败：{{ exitNodes.error }}</div>
  <section class="card"><div class="card-head"><h2>设备宣告的路由</h2></div><div v-if="routes.error" class="alert error" role="alert">子网路由读取失败：{{ routes.error }}</div><DataTable v-else :columns="[{ key: 'route', title: '网段' }, { key: 'machine', title: '设备' }, { key: 'approved', title: '状态' }, { key: 'exitNode', title: '类型' }]" :rows="routes.data ?? []" :loading="loading || routes.data === null" empty-title="还没有路由" empty-desc="设备宣告后，网络管理员可在设备详情中审批。"><template #cell-route="{ row }"><span class="mono">{{ row.route }}</span></template><template #cell-approved="{ row }"><span class="badge" :class="row.approved ? 'success' : 'warning'">{{ row.approved ? '已批准' : '待批准' }}</span></template><template #cell-exitNode="{ row }"><span class="badge">{{ row.exitNode ? '出口节点' : '子网' }}</span></template></DataTable></section>
</template>
