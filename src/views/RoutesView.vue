<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { errorMessage } from "../api/client";
import { getRouteOverview, getExitOverview, type RouteOverview, type RouteNode, type ExitNode, type ExitOverview } from "../api/route-management";
import PageHeader from "../components/PageHeader.vue";
import RouteApprovalDialog from "../components/RouteApprovalDialog.vue";
import ExitNodeHelp from "../components/ExitNodeHelp.vue";
import { emptyResource, type ResourceState } from "../utils/resources";
import { canUseExitSnapshot, isExitPrefix, routeState } from "../utils/route-management";

const loading = ref(false), search = ref(""), kind = ref("all"), status = ref("all");
const page = ref(1), exitPage = ref(1), clientPage = ref(1), pageSize = 12;
const routes = reactive(emptyResource<RouteOverview>()), exits = reactive(emptyResource<ExitOverview>());
const managing = ref(""), selectedExit = ref<ExitNode | null>(null);
let sequence = 0, active = true;
onBeforeUnmount(() => { active = false; sequence++; });
onMounted(load);
watch([search, kind, status], () => { page.value = 1; });

const rows = computed(() => (routes.data?.items ?? []).flatMap((item) =>
  [...new Set([...(item.machine.announcedRoutes ?? []), ...(item.machine.approvedRoutes ?? [])])]
    .map((prefix) => ({ item, prefix, approved: Boolean(item.machine.approvedRoutes?.includes(prefix)), announced: Boolean(item.machine.announcedRoutes?.includes(prefix)) }))));
const subnetCount = computed(() => routes.data ? rows.value.filter((row) => !isExitPrefix(row.prefix)).length : "—");
const filtered = computed(() => rows.value.filter((row) => {
  const query = search.value.trim().toLowerCase();
  return (!query || [row.prefix, row.item.machine.hostname, row.item.machine.ipv4, row.item.machine.userLoginName].join(" ").toLowerCase().includes(query)) &&
    (kind.value === "all" || (kind.value === "exit") === isExitPrefix(row.prefix)) &&
    (status.value === "all" || (status.value === "pending" && !row.approved) || (status.value === "approved" && row.approved) ||
      (status.value === "withdrawn" && row.approved && !row.announced) || (status.value === "offline" && (!row.item.machine.online || row.item.machine.expired)));
}));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)));
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const exitCount = computed(() => Math.max(1, Math.ceil((exits.data?.exitNodes.length ?? 0) / pageSize)));
const visibleExits = computed(() => (exits.data?.exitNodes ?? []).slice((exitPage.value - 1) * pageSize, exitPage.value * pageSize));
const clientCount = computed(() => Math.max(1, Math.ceil((exits.data?.clients.length ?? 0) / pageSize)));
const visibleClients = computed(() => (exits.data?.clients ?? []).slice((clientPage.value - 1) * pageSize, clientPage.value * pageSize));
const configurationFor = (node: ExitNode): RouteNode | undefined => routes.data?.items.find((item) => item.machine.stableId === node.stableId);
function exitStatus(node: ExitNode): string {
  if (!configurationFor(node)) return "路由审批详情未确认";
  if (configurationFor(node)?.machine.expired) return "设备密钥过期";
  if (!node.announced) return "已批准 · 已停止宣告";
  if (!node.online) return "设备离线";
  return canUseExit(node) ? "出口宣告与批准匹配" : "读取期间状态变化 · 请刷新";
}
function canUseExit(node: ExitNode): boolean {
  return canUseExitSnapshot(node, configurationFor(node));
}
async function load() {
  const request = ++sequence;
  loading.value = true; selectedExit.value = null;
  page.value = 1; exitPage.value = 1; clientPage.value = 1;
  // 两类读取独立呈现失败；旧请求不得覆盖审批后重新读取的状态。
  async function read<Value>(state: ResourceState<Value>, fetcher: () => Promise<Value>) {
    state.data = null; state.error = "";
    try { const result = await fetcher(); if (active && request === sequence) state.data = result; }
    catch (failure) { if (active && request === sequence) state.error = errorMessage(failure); }
  }
  await Promise.all([read(routes, getRouteOverview), read(exits, getExitOverview)]);
  if (active && request === sequence) loading.value = false;
}
function changed() { managing.value = ""; load(); }
</script>

<template>
  <PageHeader title="路由与出口" desc="直接管理子网路由和出口批准；访问权限仍由 ACL、设备转发和客户端设置共同决定。"><template #actions><button class="btn" :disabled="loading" @click="load">刷新</button></template></PageHeader>
  <div class="toolbar">
    <span class="badge">子网路由 {{ subnetCount }}</span><span class="badge">出口节点 {{ exits.data?.exitNodes.length ?? '—' }}</span>
    <router-link to="/permissions">检查访问权限 →</router-link>
  </div>
  <section class="card" aria-label="路由管理">
    <div class="card-head"><h2>路由审批</h2><span v-if="routes.data && !routes.data.can_manage" class="muted">只读 · 需网络管理员</span></div>
    <div class="card-body stack">
      <div v-if="routes.error" class="alert error" role="alert">子网路由读取失败：{{ routes.error }}</div>
      <p v-if="!routes.data && !routes.error" role="status" class="muted">正在读取路由…</p>
      <template v-if="routes.data">
        <p class="muted small-text">审批先预览、再确认。宣告与批准匹配不代表实时可达；离线、停止宣告、密钥过期会单独标明。</p>
        <div class="route-filters">
          <input v-model="search" class="input" aria-label="搜索路由与设备" placeholder="网段、设备或用户" />
          <select v-model="kind" class="select" aria-label="路由类型"><option value="all">全部类型</option><option value="subnet">子网路由</option><option value="exit">出口默认路由</option></select>
          <select v-model="status" class="select" aria-label="路由状态"><option value="all">全部状态</option><option value="pending">待批准</option><option value="approved">已批准</option><option value="withdrawn">已停止宣告</option><option value="offline">离线 / 过期</option></select>
        </div>
        <div v-if="!visible.length" class="empty"><div class="title">{{ rows.length ? '没有匹配的路由' : '还没有路由' }}</div><div class="desc">在设备上宣告子网或出口后刷新；审批不会自动开启设备转发。</div></div>
        <article v-for="row in visible" :key="row.item.machine.stableId + ':' + row.prefix" class="route-entry">
          <div class="route-info">
            <strong class="mono">{{ row.prefix }}</strong><span class="badge">{{ isExitPrefix(row.prefix) ? '出口' : '子网' }}</span>
            <span class="badge" :class="{ warning: !row.approved || !row.announced || !row.item.machine.online || row.item.machine.expired }">{{ routeState(row.item, row.prefix) }}</span>
            <div class="route-device"><router-link :to="'/devices/' + encodeURIComponent(row.item.machine.stableId)">{{ row.item.machine.hostname }}</router-link><span class="muted">{{ row.item.machine.ipv4 || row.item.machine.ipv6 }} · {{ row.item.machine.userLoginName || '用户 #' + row.item.machine.userId }}</span></div>
          </div>
          <button class="btn small" :aria-label="(routes.data.can_manage ? '管理 ' : '查看 ') + row.item.machine.hostname + ' 路由 ' + row.prefix" @click="managing = row.item.machine.stableId">{{ routes.data.can_manage ? '管理审批' : '查看配置' }}</button>
        </article>
        <div v-if="filtered.length" class="route-pagination"><span class="muted">共 {{ filtered.length }} 条 · {{ page }} / {{ pageCount }} 页</span><button class="btn small" :disabled="page <= 1" @click="page--">上一页</button><button class="btn small" :disabled="page >= pageCount" @click="page++">下一页</button></div>
      </template>
    </div>
  </section>
  <section class="card" aria-label="出口节点">
    <div class="card-head"><h2>已批准的出口节点</h2></div>
    <div class="card-body stack">
      <div v-if="exits.error" class="alert error" role="alert">出口节点读取失败：{{ exits.error }}</div>
      <p v-if="!exits.data && !exits.error" role="status" class="muted">正在读取出口节点…</p>
      <template v-if="exits.data">
        <p class="muted small-text">在需要使用出口的那台设备选择出口。这里的客户端数量来自最后一次自报，不是实时流量或可用性检测。</p>
        <p v-if="!visibleExits.length" class="muted">尚无已批准的出口。设备宣告 IPv4 / IPv6 默认路由后，可在上方管理审批。</p>
        <article v-for="node in visibleExits" :key="node.stableId" class="route-entry exit-entry">
          <div class="route-info">
            <router-link :to="'/devices/' + encodeURIComponent(node.stableId)"><strong>{{ node.hostname }}</strong></router-link>
            <span class="badge" :class="{ warning: !canUseExit(node) }">{{ exitStatus(node) }}</span>
            <div class="route-device"><span class="mono">{{ node.ipv4 || node.ipv6 }}</span><span class="muted">{{ node.owner }} · 自报选择 {{ node.clientCount }} 台</span></div>
            <details v-if="node.clients.length"><summary>查看自报客户端</summary><p v-for="client in node.clients.slice(0, 8)" :key="client.stableId">{{ client.hostname }} · {{ client.online ? '在线' : '离线' }}</p><p v-if="node.clients.length > 8" class="muted">其余 {{ node.clients.length - 8 }} 台可在下方「客户端出口选择」查看。</p></details>
          </div>
          <button class="btn small" :disabled="!node.ipv4 && !node.ipv6" :aria-label="'使用出口 ' + node.hostname" @click="selectedExit = node">{{ canUseExit(node) ? '使用此出口' : '查看使用说明' }}</button>
        </article>
        <div v-if="exits.data.exitNodes.length > pageSize" class="route-pagination"><span class="muted">{{ exitPage }} / {{ exitCount }} 页</span><button class="btn small" :disabled="exitPage <= 1" @click="exitPage--">上一页</button><button class="btn small" :disabled="exitPage >= exitCount" @click="exitPage++">下一页</button></div>
        <details v-if="exits.data.clients.length" class="client-selections">
          <summary>客户端出口选择 · {{ exits.data.clients.length }} 条自报记录</summary>
          <article v-for="client in visibleClients" :key="client.stableId" class="route-entry">
            <div class="route-info"><router-link :to="'/devices/' + encodeURIComponent(client.stableId)">{{ client.hostname }}</router-link><span class="muted">{{ client.owner }}</span><span>{{ client.exitNodeHostname || client.exitNodeStableId }}</span><span class="badge" :class="{ warning: !client.resolved }">{{ client.resolved ? '指向已批准出口' : '目标已删除或不再获批' }}</span></div>
          </article>
          <div class="route-pagination"><span class="muted">{{ clientPage }} / {{ clientCount }} 页</span><button class="btn small" :disabled="clientPage <= 1" @click="clientPage--">上一页</button><button class="btn small" :disabled="clientPage >= clientCount" @click="clientPage++">下一页</button></div>
        </details>
      </template>
    </div>
  </section>
  <RouteApprovalDialog :reference="managing" :open="Boolean(managing)" @close="managing = ''" @changed="changed" />
  <ExitNodeHelp :node="selectedExit" :available="Boolean(selectedExit && canUseExit(selectedExit))" @close="selectedExit = null" />
</template>

<style scoped>
.route-filters { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.route-entry { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.route-info { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; overflow-wrap: anywhere; }
.route-device { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; font-size: 13px; }
.route-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.route-pagination > span { margin-right: auto; }
.route-entry > button { flex-shrink: 0; }
.route-info details { width: 100%; font-size: 13px; }
.client-selections > summary, .route-info summary { cursor: pointer; padding: 8px 0; }
@media (max-width: 560px) {
  .route-filters { grid-template-columns: 1fr 1fr; }
  .route-filters > input { grid-column: 1 / -1; }
  .route-entry { align-items: flex-start; flex-direction: column; gap: 10px; }
  .route-entry > button { align-self: flex-end; }
}
</style>
