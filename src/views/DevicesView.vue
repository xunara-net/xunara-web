<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { Machine, PendingDevice } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { formatTime, relativeTime } from "../utils/format";
import { authorizationLabel, canManageNetwork } from "../utils/devices";

const loading = ref(true);
const error = ref("");
const machines = ref<Machine[]>([]);
const pending = ref<PendingDevice[]>([]);
const busy = ref<Record<string, boolean>>({});
const canWrite = computed(() => canManageNetwork(session.state.user?.role));

const machineColumns = [
  { key: "hostname", title: "设备" },
  { key: "status", title: "状态" },
  { key: "ipv4", title: "Tailscale IP" },
  { key: "method", title: "授权方式" },
  { key: "lastSeen", title: "最后在线" },
  { key: "actions", title: "操作", align: "right" as const },
];

async function load() {
  loading.value = true;
  error.value = "";
  try {
    [machines.value, pending.value] = await Promise.all([ep.listMachines(), ep.listPendingDevices()]);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function approve(device: PendingDevice) {
  if (!canWrite.value) return;
  busy.value[device.id] = true;
  try {
    await ep.approveDevice(device.id);
    session.toast("success", `已批准 ${device.hostname || "设备"}`);
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  } finally {
    busy.value[device.id] = false;
  }
}

async function deny(device: PendingDevice) {
  if (!canWrite.value) return;
  busy.value[device.id] = true;
  try {
    await ep.denyDevice(device.id);
    session.toast("info", `已拒绝 ${device.hostname || "设备"}`);
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  } finally {
    busy.value[device.id] = false;
  }
}

async function remove(machine: Machine) {
  if (!canWrite.value) return;
  if (!window.confirm(`确定删除设备「${machine.hostname || machine.id}」？该设备的密钥将立即失效。`)) return;
  busy.value[machine.stableId] = true;
  try {
    await ep.deleteMachine(machine.stableId);
    session.toast("success", "设备已删除");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  } finally {
    busy.value[machine.stableId] = false;
  }
}
</script>

<template>
  <PageHeader title="设备" desc="加入本网络的设备。新设备默认停在待审批状态，由你确认后加入。">
    <template #actions><button class="btn" @click="load">刷新</button></template>
  </PageHeader>

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>

  <div v-if="!loading && pending.length" class="card">
    <div class="card-head">
      <h2>待审批设备（{{ pending.length }}）</h2>
      <span class="hint">批准后设备才会加入网络</span>
    </div>
    <DataTable :columns="[
      { key: 'hostname', title: '设备' },
      { key: 'os', title: '操作系统' },
      { key: 'created', title: '申请时间' },
      { key: 'actions', title: '操作', align: 'right' },
    ]" :rows="pending" row-key="id">
      <template #cell-hostname="{ row }">
        <div>{{ row.hostname || "未命名设备" }}</div>
        <div class="mono" style="color: var(--text-faint); font-size: 12px">{{ row.machineKey }}</div>
      </template>
      <template #cell-created="{ row }">{{ formatTime(row.created) }}</template>
      <template #cell-actions="{ row }">
        <div v-if="canWrite" class="row-actions">
          <button class="btn small primary" :disabled="busy[row.id]" @click="approve(row)">批准</button>
          <button class="btn small danger" :disabled="busy[row.id]" @click="deny(row)">拒绝</button>
        </div>
      </template>
    </DataTable>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>已加入设备</h2>
      <span class="hint">共 {{ machines.length }} 台</span>
    </div>
    <DataTable :columns="machineColumns" :rows="machines" :loading="loading" empty-title="还没有设备" empty-desc="在设备上安装官方 Tailscale 客户端，并用本服务器地址登录。">
      <template #cell-hostname="{ row }">
        <router-link :to="`/devices/${row.id}`" class="mono">{{ row.hostname || `设备 #${row.id}` }}</router-link>
        <div v-if="row.tags?.length" class="tag-list" style="margin-top: 4px">
          <span v-for="tag in row.tags" :key="tag" class="badge">{{ tag }}</span>
        </div>
      </template>
      <template #cell-status="{ row }"><StatusBadge :online="row.online" :expired="row.expired" /></template>
      <template #cell-ipv4="{ row }">
        <span class="mono">{{ row.ipv4 || "—" }}</span>
        <span v-if="row.exitNode" class="badge primary" style="margin-left: 6px">出口节点</span>
      </template>
      <template #cell-lastSeen="{ row }">{{ relativeTime(row.lastSeen) }}</template>
      <template #cell-method="{ row }">{{ authorizationLabel(row.method) }}</template>
      <template #cell-actions="{ row }">
        <div class="row-actions">
          <router-link class="btn small" :to="`/devices/${row.id}`">详情</router-link>
          <button v-if="canWrite" class="btn small danger" :disabled="busy[row.stableId]" @click="remove(row)">删除</button>
        </div>
      </template>
    </DataTable>
  </div>
</template>
