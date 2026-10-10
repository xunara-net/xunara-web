<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import * as ep from "../api/endpoints";
import * as addresses from "../api/addresses";
import type { AddressConfiguration, AddressPreview } from "../api/addresses";
import { errorMessage } from "../api/client";
import { canManageNetwork } from "../utils/devices";
import { allocationCompatibilityWarning, allocationEditStatus, normalizeAllocationRange } from "../utils/addresses";
import ModalDialog from "../components/ModalDialog.vue";
import type { Organization } from "../api/types";
import { session } from "../store";
import { emptyResource, refreshResource } from "../utils/resources";
import PageHeader from "../components/PageHeader.vue";
const organization = reactive(emptyResource<Organization>());
const loading = ref(false);
const allocation = reactive(emptyResource<AddressConfiguration>());
const busy = ref(false), editing = ref(false), draft = ref(""), editError = ref("");
const preview = ref<AddressPreview | null>(null);
const baseline = ref<AddressConfiguration | null>(null);
const editorStatus = computed(() => allocationEditStatus(allocation.data, session.state.user?.role, allocation.error));
const canWrite = computed(() => editorStatus.value.allowed);
watch(draft, () => { preview.value = null; }, { flush: "sync" });
function openEdit() {
  if (!canWrite.value || !allocation.data) return;
  baseline.value = allocation.data; draft.value = allocation.data.ipv4_cidr;
  editError.value = ""; preview.value = null; editing.value = true;
}
async function check() {
  if (!baseline.value || busy.value) return;
  busy.value = true; editError.value = ""; preview.value = null;
  try {
    const prefix = normalizeAllocationRange(draft.value, baseline.value.reserved_ranges);
    const result = await addresses.previewAddressRange(prefix, baseline.value.revision, baseline.value.csrf_token);
    draft.value = result.ipv4_cidr; preview.value = result;
  } catch (err) { editError.value = errorMessage(err); }
  finally { busy.value = false; }
}
async function save() {
  if (!baseline.value || !preview.value || busy.value) return;
  busy.value = true; editError.value = "";
  try {
    allocation.data = await addresses.saveAddressRange(preview.value.ipv4_cidr, baseline.value.revision, baseline.value.csrf_token);
    allocation.error = ""; editing.value = false;
    // 首页和套餐页共享服务端快照，保存后同步，避免切页仍看到旧网段。
    await session.load();
    session.toast("success", allocation.data.pending ? "期望网段已提交，请刷新确认应用结果" : "分配网段已更新，已有设备 IP 保持不变");
  } catch (err) { editError.value = errorMessage(err); preview.value = null; }
  finally { busy.value = false; }
}
onMounted(load);
async function load() {
  if (loading.value) return;
  loading.value = true;
  await Promise.all([session.load(), refreshResource(organization, ep.getOrganization), refreshResource(allocation, addresses.getAddressConfiguration)]);
  loading.value = false;
}
</script>
<template>
  <PageHeader title="我的网络" desc="独立的 Tailnet 网络空间；在这里管理设备分配网段。"><template #actions><button class="btn" :disabled="loading || busy" @click="load">刷新</button><button class="btn primary" :disabled="!canWrite || loading || busy" aria-describedby="network-edit-status" @click="openEdit">修改分配网段</button></template></PageHeader>
  <div v-if="organization.error" class="alert error">组织信息读取失败：{{ organization.error }}</div>
  <div v-if="allocation.error" class="alert error" role="alert">地址配置读取失败：{{ allocation.error }}</div>
  <section class="card"><div class="card-head"><h2>网络基本信息</h2></div><div class="card-body"><div class="kv"><div class="k">网络名称</div><div class="v">{{ organization.data?.name || session.state.tenant?.organizationName || '—' }}</div><div class="k">网络编号</div><div class="v mono">{{ organization.data?.id || session.state.tenant?.id || '—' }}</div><div class="k">当前 IPv4 网段</div><div class="v mono">{{ allocation.data?.ipv4_cidr || (allocation.error ? '读取失败' : '正在读取…') }}</div><div class="k">IPv6 网段</div><div class="v mono">{{ allocation.data?.ipv6_cidr || '—' }}<span class="muted small-text"> · 系统分配</span></div><div class="k">网段管理</div><div class="v">{{ !allocation.data ? '网段权限暂未确认' : allocation.data.can_edit ? (canManageNetwork(session.state.user?.role) ? '套餐支持自定义设备分配网段' : '仅网络管理员可以修改') : '系统自动分配，当前套餐不允许自定义网段' }}</div></div><div v-if="allocation.data?.pending" class="alert warning" role="status">期望网段 {{ allocation.data.desired_ipv4_cidr }} 尚未应用，设备仍从当前网段分配。请刷新检查，勿重复提交。</div><div v-if="allocation.data?.devices_outside_range" class="alert info">{{ allocation.data.devices_outside_range }} 台已有设备保留旧网段 IP。可在设备详情逐台显式修改，不会自动断开全部设备。</div></div></section>
  <div id="network-edit-status" class="alert" :class="editorStatus.status === 'error' ? 'warning' : 'info'" role="status"><span>{{ editorStatus.reason }}</span> <router-link v-if="editorStatus.status === 'plan'" to="/plan">查看套餐权限 →</router-link><router-link v-if="allocation.data?.devices_outside_range" to="/devices">前往设备详情逐台修改 IPv4 →</router-link></div>
  <div class="alert info">可自定义合法 IPv4 网段，例如 192.168.50.0/24、10.42.0.0/16 或 100.101.50.0/24，不再限制为 /16～/28。系统仍检查保留地址与租户冲突。接入已有家庭或办公网络也可使用子网路由。<router-link to="/routes">配置子网路由 →</router-link></div>
  <div v-if="allocation.data && allocationCompatibilityWarning(allocation.data.ipv4_cidr)" class="alert warning" role="alert">{{ allocationCompatibilityWarning(allocation.data.ipv4_cidr) }}</div>
  <div class="grid cols-2"><router-link to="/permissions" class="card card-body"><strong>访问权限 →</strong><p class="muted small-text">谁可以访问谁，规则、矩阵、发布与历史恢复。</p></router-link><router-link to="/dns" class="card card-body"><strong>DNS →</strong><p class="muted small-text">设备名称、解析器、搜索域和分流规则。</p></router-link><router-link to="/relays" class="card card-body"><strong>我的中继 →</strong><p class="muted small-text">私有中继接入、下发地图和心跳管理。</p></router-link><router-link to="/routes" class="card card-body"><strong>路由与出口 →</strong><p class="muted small-text">设备宣告的子网和出口路由。</p></router-link></div>
  <ModalDialog :open="editing" title="修改设备分配网段" :busy="busy" @close="editing = false"><form class="stack" @submit.prevent="check"><div v-if="editError" class="alert error" role="alert">{{ editError }}<button class="btn small" type="button" :disabled="busy" @click="editing = false; load()">关闭并刷新基准</button></div><label class="field"><span class="label">IPv4 CIDR</span><input v-model="draft" class="input mono" aria-label="IPv4 分配网段" placeholder="192.168.50.0/24" :disabled="busy" /><span class="help">不限制为 CGNAT 或 /16～/28。服务器仍检查保留网络、其他租户及历史预留。/31 和 /32 分别只有 2 个和 1 个地址，耗尽后不能添加新设备。</span></label><div v-if="allocationCompatibilityWarning(draft)" class="alert warning" role="alert">{{ allocationCompatibilityWarning(draft) }}</div><p class="muted small-text">仅改变后续设备的分配范围；已有 IP、密钥和路由不自动改写。逐台修改 IP 时，请检查按 IP 配置的 ACL、应用和外部 DNS。</p><button class="btn" type="submit" :disabled="busy">{{ busy ? '正在检查…' : '校验并预览' }}</button><div v-if="preview" class="alert warning"><strong>{{ preview.ipv4_cidr }}</strong><p>保留 {{ preview.devices_retained }} 台设备的 IP，其中 {{ preview.devices_outside_range }} 台在新网段之外。</p><button class="btn primary" type="button" :disabled="busy" @click="save">确认保存分配网段</button></div></form><template #footer><button class="btn" :disabled="busy" @click="editing = false">取消</button></template></ModalDialog>
</template>
