<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { Machine, Route } from "../api/types";
import PageHeader from "../components/PageHeader.vue";
import { relativeTime } from "../utils/format";

// The topology view shows the network as it is: every device grouped by
// reachability, the routes it carries and the exit nodes it offers. The
// interactive graph with per-link latency arrives with the connection
// telemetry milestone; this view deliberately renders real data only.

const loading = ref(true);
const error = ref("");
const machines = ref<Machine[]>([]);
const routes = ref<Route[]>([]);

const online = computed(() => machines.value.filter((m) => m.online));
const offline = computed(() => machines.value.filter((m) => !m.online));
const exitNodes = computed(() => machines.value.filter((m) => m.exitNode));

function routesOf(machine: Machine): string[] {
  return machine.approvedRoutes ?? machine.effectiveRoutes ?? [];
}

onMounted(async () => {
  try {
    [machines.value, routes.value] = await Promise.all([ep.listMachines(), ep.listRoutes()]);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <PageHeader title="拓扑与连接" desc="设备之间的可达关系。连接类型（直连 / DERP 中继）由客户端协商，控制面不转发流量。" />

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>

  <div class="grid cols-3">
    <div class="card stat">
      <div class="label">在线设备</div>
      <div class="value" style="color: var(--success)">{{ online.length }}</div>
      <div class="sub">共 {{ machines.length }} 台</div>
    </div>
    <div class="card stat">
      <div class="label">出口节点</div>
      <div class="value">{{ exitNodes.length }}</div>
      <div class="sub">可承载全局流量</div>
    </div>
    <div class="card stat">
      <div class="label">已批准路由</div>
      <div class="value">{{ routes.length }}</div>
      <div class="sub">子网与出口路由</div>
    </div>
  </div>

  <div v-if="loading" class="page-loading"><div class="spinner" /></div>
  <template v-else>
    <div v-for="group in [
      { title: '在线设备', items: online, tone: 'online' },
      { title: '离线设备', items: offline, tone: 'offline' },
    ]" :key="group.title" class="card">
      <div class="card-head"><h2>{{ group.title }}（{{ group.items.length }}）</h2></div>
      <div class="card-body">
        <div v-if="group.items.length === 0" class="empty" style="padding: 20px"><div class="title">没有设备</div></div>
        <div v-else class="grid cols-3">
          <div v-for="machine in group.items" :key="machine.id" class="card" style="box-shadow: none">
            <div class="card-body" style="padding: 14px">
              <div style="display: flex; align-items: center; justify-content: space-between">
                <router-link :to="`/devices/${machine.id}`" class="mono" style="font-weight: 600">{{ machine.hostname }}</router-link>
                <span class="dot" :class="machine.online ? 'online' : 'offline'" />
              </div>
              <div class="mono" style="color: var(--text-muted); font-size: 12px; margin-top: 6px">{{ machine.ipv4 || "未分配地址" }}</div>
              <div v-if="routesOf(machine).length" class="tag-list" style="margin-top: 10px">
                <span v-for="route in routesOf(machine)" :key="route" class="badge">{{ route }}</span>
              </div>
              <div style="color: var(--text-faint); font-size: 12px; margin-top: 10px">
                最后在线 {{ relativeTime(machine.lastSeen) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>
