<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import * as addresses from "../api/addresses";
import type { AddressConfiguration } from "../api/addresses";
import { validateDeviceIPv4 } from "../utils/addresses";
import ModalDialog from "../components/ModalDialog.vue";
import { errorMessage } from "../api/client";
import type { Machine } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import AsyncSection from "../components/AsyncSection.vue";
import DeviceConnectionPanel from "../components/DeviceConnectionPanel.vue";
import NodeRoutePanel from "../components/NodeRoutePanel.vue";
import DeviceExpiryDialog from "../components/DeviceExpiryDialog.vue";
import { formatTime, relativeTime } from "../utils/format";
import { authorizationLabel, canManageNetwork } from "../utils/devices";

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const error = ref("");
const machine = ref<Machine | null>(null);
const saving = ref(false);
const expiryOpen = ref(false);
const canWrite = computed(() => canManageNetwork(session.state.user?.role));
const addressOpen = ref(false), addressLoading = ref(false), addressError = ref(""), addressDraft = ref("");
const allocation = ref<AddressConfiguration | null>(null);
const addressBaseline = ref<Machine | null>(null);
async function openAddress() {
  if (!machine.value || !canWrite.value || saving.value) return;
  addressBaseline.value = machine.value; addressDraft.value = machine.value.ipv4 || "";
  addressError.value = ""; allocation.value = null; addressOpen.value = true; addressLoading.value = true;
  try { allocation.value = await addresses.getAddressConfiguration(); }
  catch (err) { addressError.value = errorMessage(err); }
  finally { addressLoading.value = false; }
}
async function saveAddress() {
  if (!addressBaseline.value || !allocation.value || saving.value || !canWrite.value || !allocation.value.can_edit_ips || allocation.value.pending) return;
  saving.value = true; addressError.value = "";
  try {
    const ipv4 = validateDeviceIPv4(addressDraft.value, allocation.value.ipv4_cidr, allocation.value.reserved_ranges);
    if (!window.confirm(`将设备 IP 从 ${addressBaseline.value.ipv4} 改为 ${ipv4}？现有连接可能中断，按 IP 配置的 ACL、应用和外部 DNS 请同步检查。`)) return;
    const result = await addresses.changeDeviceIPv4(addressBaseline.value, ipv4, allocation.value.csrf_token);
    if (result.stableId === machine.value?.stableId) machine.value = result;
    addressOpen.value = false; session.toast("success", "设备 IPv4 已更新，客户端将在下一次控制面更新时同步");
  } catch (err) { addressError.value = errorMessage(err); }
  finally { saving.value = false; }
}

const announced = computed(() => machine.value?.announcedRoutes ?? []);
const approved = computed(() => machine.value?.approvedRoutes ?? []);

watch(() => route.params.id, load, { immediate: true });

async function load() {
  addressOpen.value = false;
  expiryOpen.value = false;
  const id = String(route.params.id ?? "");
  loading.value = true;
  error.value = "";
  machine.value = null;
  try {
    const result = await ep.getMachine(id);
    if (id !== String(route.params.id ?? "")) return;
    machine.value = result;
  } catch (err) {
    if (id === String(route.params.id ?? "")) error.value = errorMessage(err);
  } finally {
    if (id === String(route.params.id ?? "")) loading.value = false;
  }
}

async function remove() {
  if (!machine.value || !canWrite.value || loading.value || saving.value) return;
  if (!window.confirm(`确定删除设备「${machine.value.hostname}」？`)) return;
  try {
    await ep.deleteMachine(machine.value.id);
    session.toast("success", "设备已删除");
    router.push("/devices");
  } catch (err) {
    session.toast("error", errorMessage(err));
  }
}
</script>

<template>
  <PageHeader :title="machine?.hostname || '设备详情'" desc="连接与中继、网络地址和路由状态。">
    <template #actions>
      <router-link class="btn" to="/devices">返回列表</router-link>
      <button class="btn" :disabled="loading || saving" @click="load">刷新设备</button>
      <button v-if="canWrite" class="btn" :disabled="loading || saving || !machine || machine.expired" @click="expiryOpen = true">{{ machine?.expired ? '设备已过期' : '立即过期' }}</button>
      <button v-if="canWrite" class="btn danger" :disabled="loading || saving || !machine" @click="remove">删除设备</button>
    </template>
  </PageHeader>

  <AsyncSection :loading="loading" :error="error">
    <DeviceConnectionPanel v-if="machine" :machine="machine" />
    <div v-if="machine" class="grid cols-2">
      <div class="card">
        <div class="card-head"><h2>基本信息</h2><StatusBadge :online="machine.online" :expired="machine.expired" /></div>
        <div class="card-body">
          <div class="kv">
            <div class="k">设备名称</div><div class="v">{{ machine.hostname || "—" }}</div>
            <div class="k">设备 ID</div><div class="v mono">{{ machine.stableId }}</div>
            <div class="k">归属用户</div><div class="v">{{ machine.userLoginName || `#${machine.userId}` }}</div>
            <div class="k">授权方式</div><div class="v">{{ authorizationLabel(machine.method) }}</div>
            <div class="k">系统与版本</div><div class="v">{{ [machine.os, machine.osVersion].filter(Boolean).join(' ') || '未上报' }}</div>
            <div class="k">客户端版本</div><div class="v">{{ machine.clientVersion || '未上报' }}</div>
            <div class="k">DNS 名称</div><div class="v mono">{{ machine.dnsName || '未配置' }}</div>
            <div class="k">首次加入</div><div class="v">{{ formatTime(machine.created) }}</div>
            <div class="k">最后在线</div><div class="v">{{ relativeTime(machine.lastSeen) }}</div>
            <div class="k">临时设备</div><div class="v">{{ machine.ephemeral ? "是" : "否" }}</div>
            <div class="k">出口宣告</div><div class="v">{{ machine.exitNode ? "与批准匹配" : "尚未与批准匹配" }}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>网络</h2></div>
        <div class="card-body">
          <div class="kv">
            <div class="k">IPv4</div><div class="v mono">{{ machine.ipv4 || "—" }} <button v-if="canWrite && machine.ipv4" class="btn small" :disabled="saving || loading" @click="openAddress">修改 IPv4</button></div>
            <div class="k">IPv6</div><div class="v mono">{{ machine.ipv6 || "—" }}</div>
            <div class="k">宣告路由</div><div class="v">{{ announced.length ? announced.join("、") : "无" }}</div>
            <div class="k">已批准路由</div><div class="v">{{ approved.length ? approved.join("、") : "无" }}</div>
            <div class="k">宣告与批准交集</div><div class="v">{{ machine.effectiveRoutes?.length ? machine.effectiveRoutes.join('、') : '无（需同时宣告并批准）' }}</div>
            <div class="k">密钥有效期</div><div class="v">{{ machine.expires ? formatTime(machine.expires) : '未设置到期时间' }}</div>
          </div>
        </div>
      </div>
    </div>

    <NodeRoutePanel v-if="machine" :reference="machine.stableId" @changed="load" />
  </AsyncSection>
  <DeviceExpiryDialog v-if="machine" :open="expiryOpen" :reference="machine.stableId" @close="expiryOpen = false" @expired="machine = $event" />
  <ModalDialog :open="addressOpen" title="修改设备 IPv4" :busy="saving || addressLoading" @close="addressOpen = false"><form class="stack" @submit.prevent="saveAddress"><div v-if="addressError" class="alert error" role="alert">{{ addressError }}<button class="btn small" type="button" :disabled="saving" @click="addressOpen = false; load()">关闭并刷新设备</button></div><p v-if="addressLoading" role="status">正在读取实际分配网段…</p><template v-if="allocation"><p class="muted small-text">当前网段：<span class="mono">{{ allocation.ipv4_cidr }}</span>；当前 IP：{{ addressBaseline?.ipv4 }}</p><div v-if="allocation.pending" class="alert warning">网段变更尚未应用，请刷新网络配置后操作。</div><label class="field"><span class="label">新 IPv4</span><input v-model="addressDraft" class="input mono" aria-label="设备新 IPv4" :disabled="saving || allocation.pending" /></label><p class="muted small-text">只改变这一台设备的 IPv4，不改变身份、IPv6 和路由。服务器会检查占用与当前 IP 基准，此操作可能中断现有连接。</p><button class="btn primary" type="submit" :disabled="saving || allocation.pending || !allocation.can_edit_ips">{{ saving ? '正在保存…' : '确认修改 IPv4' }}</button></template></form><template #footer><button class="btn" :disabled="saving || addressLoading" @click="addressOpen = false">取消</button></template></ModalDialog>
</template>
