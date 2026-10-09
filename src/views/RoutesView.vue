<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import * as ep from "../api/endpoints";
import type { DERPInfo, ManagedRelay, Route } from "../api/types";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import { emptyResource, refreshResource } from "../utils/resources";

const loading = ref(false);
const routes = reactive(emptyResource<Route[]>());
const relays = reactive(emptyResource<ManagedRelay[]>());
const derp = reactive(emptyResource<DERPInfo>());
const exitNodes = reactive(emptyResource<unknown[]>());

onMounted(load);

async function load() {
  if (loading.value) return;
  loading.value = true;
  try {
    // 分开记录每个请求的结果，某一项失败不能伪装成“0”，也不遮蔽其他已确认的数据。
    await Promise.all([
      refreshResource(routes, ep.listRoutes),
      refreshResource(relays, ep.listManagedRelays),
      refreshResource(derp, ep.getDERP),
      refreshResource(exitNodes, ep.listExitNodes),
    ]);
  } finally {
    loading.value = false;
  }
}

function relayStatus(relay: ManagedRelay): string {
  if (relay.desiredState === "revoked") return "已撤销";
  if (relay.desiredState === "disabled") return "已禁用";
  if (relay.desiredState === "maintenance") return "维护中";
  if (!relay.lastSeen) return "尚无心跳";
  if (!relay.online) return "心跳离线";
  return relay.healthy ? "心跳在线" : "心跳在线 · 健康异常";
}
</script>

<template>
  <PageHeader title="路由与出口" desc="子网路由、出口节点与中继状态。路由批准不等于访问授权。">
    <template #actions><button class="btn" :disabled="loading" @click="load">刷新</button></template>
  </PageHeader>

  <div class="grid cols-3">
    <div class="card stat">
      <div class="label">子网路由</div>
      <div class="value">{{ routes.data?.length ?? "—" }}</div>
      <div class="sub">{{ routes.error ? "读取失败" : "由设备宣告、控制面批准" }}</div>
    </div>
    <div class="card stat">
      <div class="label">出口节点</div>
      <div class="value">{{ exitNodes.data?.length ?? "—" }}</div>
      <div class="sub">{{ exitNodes.error ? "读取失败" : "允许客户端选择为全局出口" }}</div>
    </div>
    <div class="card stat">
      <div class="label">托管中继</div>
      <div class="value">{{ relays.data?.length ?? "—" }}</div>
      <div class="sub">注册到本租户的 Xunara Relay，不含静态公共中继</div>
    </div>
  </div>

  <div v-if="exitNodes.error" class="alert error" role="alert">出口节点读取失败：{{ exitNodes.error }}。请刷新重试。</div>
  <div v-if="derp.error" class="alert error" role="alert">中继配置读取失败：{{ derp.error }}。请刷新重试。</div>
  <div v-else-if="derp.data" class="alert info">
    {{ !derp.data.mapConfigured ? "未设置自定义中继列表，客户端可能使用内置默认中继。" : derp.data.regionsServed === 0 ? "已配置中继列表，但当前没有可用区域。" : `控制面提供 ${derp.data.regionsServed} 个中继区域；注册列表为空不代表没有公共中继。` }}
    心跳和健康上报不代表客户端的实际连接路径。
  </div>

  <div class="card">
    <div class="card-head"><h2>子网路由</h2></div>
    <div v-if="routes.error" class="alert error" role="alert">子网路由读取失败：{{ routes.error }}。请刷新重试。</div>
    <DataTable v-else :columns="[
      { key: 'route', title: '网段' },
      { key: 'machine', title: '设备' },
      { key: 'approved', title: '状态' },
      { key: 'exitNode', title: '类型' },
    ]" :rows="routes.data ?? []" :loading="loading || routes.data === null" empty-title="还没有子网路由">
      <template #cell-route="{ row }"><span class="mono">{{ row.route }}</span></template>
      <template #cell-approved="{ row }"><span class="badge" :class="row.approved ? 'success' : 'warning'">{{ row.approved ? "已批准" : "待批准" }}</span></template>
      <template #cell-exitNode="{ row }"><span class="badge" :class="row.exitNode ? 'primary' : ''">{{ row.exitNode ? "出口节点" : "子网" }}</span></template>
    </DataTable>
  </div>

  <div class="card">
    <div class="card-head"><h2>托管中继节点</h2><span class="hint">租户注册记录 · 最近心跳</span></div>
    <div v-if="relays.error" class="alert error" role="alert">托管中继读取失败：{{ relays.error }}。请刷新重试。</div>
    <DataTable v-else :columns="[
      { key: 'name', title: '节点' },
      { key: 'regionName', title: '区域' },
      { key: 'online', title: '上报状态' },
    ]" :rows="relays.data ?? []" :loading="loading || relays.data === null" row-key="id" empty-title="暂无托管中继" empty-desc="静态公共中继不在注册列表中。自建中继由管理员签发一次性令牌后接入。">
      <template #cell-name="{ row }"><span class="mono">{{ row.name || row.hostname || row.id }}</span></template>
      <template #cell-regionName="{ row }">{{ row.regionName || row.regionCode || "—" }}</template>
      <template #cell-online="{ row }"><span class="badge">{{ relayStatus(row) }}</span></template>
    </DataTable>
  </div>
</template>
