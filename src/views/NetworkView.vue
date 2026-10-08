<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { DNSRecord, Organization, Route } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";

const loading = ref(true);
const error = ref("");
const routes = ref<Route[]>([]);
const dns = ref<DNSRecord[]>([]);
const org = ref<Organization | null>(null);

const plan = computed(() => session.state.plan);

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [r, d, o] = await Promise.all([
      ep.listRoutes(),
      ep.listDNS(),
      ep.getOrganization().catch(() => null),
    ]);
    routes.value = r;
    dns.value = d;
    org.value = o;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function removeDNS(record: DNSRecord) {
  if (!window.confirm(`删除 DNS 记录 ${record.name}？`)) return;
  try {
    await ep.deleteDNS(record.id);
    session.toast("success", "DNS 记录已删除");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  }
}
</script>

<template>
  <PageHeader title="网络" desc="网络地址、DNS 与子网路由。">
    <template #actions><button class="btn" @click="load">刷新</button></template>
  </PageHeader>

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>

  <div class="grid cols-3">
    <div class="card stat">
      <div class="label">网络地址</div>
      <div class="value mono" style="font-size: 20px">{{ plan?.networkPrefix ?? "未分配" }}</div>
      <div class="sub">
        {{ plan?.allowCustomCidr ? "当前套餐可自定义网段" : "由系统自动分配，升级套餐后可自定义" }}
      </div>
    </div>
    <div class="card stat">
      <div class="label">组织 / Tailnet</div>
      <div class="value" style="font-size: 20px">{{ org?.name || session.state.tenant?.organizationName || "默认网络" }}</div>
      <div class="sub">{{ org?.id || session.state.tenant?.id || "default" }}</div>
    </div>
    <div class="card stat">
      <div class="label">子网路由</div>
      <div class="value">{{ routes.length }}</div>
      <div class="sub">已批准 {{ routes.filter((r) => r.approved).length }} 条</div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>DNS 记录</h2><span class="hint">MagicDNS 与自定义记录</span></div>
    <DataTable :columns="[
      { key: 'name', title: '名称' },
      { key: 'type', title: '类型' },
      { key: 'value', title: '值' },
      { key: 'actions', title: '操作', align: 'right' },
    ]" :rows="dns" :loading="loading" empty-title="暂无 DNS 记录">
      <template #cell-name="{ row }"><span class="mono">{{ row.name }}</span></template>
      <template #cell-value="{ row }"><span class="mono">{{ row.value }}</span></template>
      <template #cell-actions="{ row }">
        <div class="row-actions"><button class="btn small danger" @click="removeDNS(row)">删除</button></div>
      </template>
    </DataTable>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>子网路由</h2>
      <router-link to="/routes" class="hint">路由与出口节点 →</router-link>
    </div>
    <DataTable :columns="[
      { key: 'route', title: '网段' },
      { key: 'machine', title: '设备' },
      { key: 'approved', title: '状态' },
      { key: 'primary', title: '主节点' },
    ]" :rows="routes" :loading="loading" empty-title="还没有路由" empty-desc="在设备上宣告网段（--advertise-routes）并在设备详情中批准。">
      <template #cell-route="{ row }"><span class="mono">{{ row.route }}</span></template>
      <template #cell-approved="{ row }"><span class="badge" :class="row.approved ? 'success' : 'warning'">{{ row.approved ? "已批准" : "待批准" }}</span></template>
      <template #cell-primary="{ row }"><span v-if="row.primary" class="badge primary">主</span><span v-else style="color: var(--text-faint)">—</span></template>
    </DataTable>
  </div>
</template>
