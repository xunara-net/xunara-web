<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { errorMessage } from "../api/client";
import { getRouteConfiguration, saveRouteConfiguration, type RouteConfiguration } from "../api/route-management";
import { canManageNetwork, routeChanges } from "../utils/devices";
import { canAddRoute, isExitPrefix, rebaseRouteSelection } from "../utils/route-management";
import { session } from "../store";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ reference: string; open: boolean }>();
const emit = defineEmits<{ (event: "changed"): void; (event: "close"): void }>();
const current = ref<RouteConfiguration | null>(null), latest = ref<RouteConfiguration | null>(null);
const selection = ref<string[]>([]), loading = ref(false), saving = ref(false), error = ref(""), saveError = ref("");
const preview = ref(false), conflict = ref(false), latestLoading = ref(false);
const content = ref<HTMLElement | null>(null);
watch(preview, async () => {
  await nextTick();
  if (props.open) content.value?.focus({ preventScroll: true });
});
let sequence = 0, active = true;
onBeforeUnmount(() => { active = false; sequence++; });
watch(() => [props.reference, props.open], () => {
  sequence++; loading.value = false; saving.value = false; latestLoading.value = false;
  preview.value = false; selection.value = []; current.value = null; latest.value = null;
  error.value = ""; saveError.value = ""; conflict.value = false;
  if (props.open) load();
}, { immediate: true });
const canWrite = computed(() => Boolean(current.value?.can_manage && current.value.csrf_token && canManageNetwork(session.state.user?.role)));
const options = computed(() => [...new Set([...(current.value?.machine.announcedRoutes ?? []), ...(current.value?.machine.approvedRoutes ?? []), ...selection.value])]);
const changes = computed(() => routeChanges(current.value?.machine.approvedRoutes ?? [], selection.value));
const dirty = computed(() => changes.value.approve.length + changes.value.unapprove.length > 0);
const validation = computed(() => {
  if (!current.value) return "";
  if (changes.value.approve.some((prefix) => !(current.value!.machine.announcedRoutes ?? []).includes(prefix))) return "新增批准中有已停止宣告的路由，请取消对应选择";
  if (changes.value.approve.some((prefix) => !canAddRoute(prefix, current.value!.limits))) return "当前套餐不允许新增所选类型的路由，可取消已有批准";
  if (changes.value.approve.length && selection.value.some((prefix) => !canAddRoute(prefix, current.value!.limits))) return "新增批准前，请先取消当前套餐不再支持的旧批准";
  if (changes.value.approve.length && current.value.limits.max_routes >= 0 && selection.value.length > current.value.limits.max_routes) return "路由数量超过当前套餐额度，出口 IPv4/IPv6 各占一条";
  return "";
});
async function load() {
  if (saving.value || loading.value) return;
  if (dirty.value && !window.confirm("刷新会清除未发布草稿，继续？")) return;
  const request = ++sequence, reference = props.reference;
  loading.value = true; error.value = ""; current.value = null;
  try {
    const result = await getRouteConfiguration(reference);
    if (active && sequence === request && reference === props.reference) { current.value = result; selection.value = [...(result.machine.approvedRoutes ?? [])]; }
  } catch (failure) { if (active && sequence === request) error.value = errorMessage(failure); }
  finally { if (active && sequence === request) loading.value = false; }
}
function toggle(prefix: string, checked: boolean) {
  if (!canWrite.value || saving.value) return;
  selection.value = checked ? [...new Set([...selection.value, prefix])] : selection.value.filter((entry) => entry !== prefix);
}
function openPreview() { if (!conflict.value) { saveError.value = ""; latest.value = null; preview.value = true; } }
async function publish() {
  if (!current.value || !canWrite.value || !dirty.value || validation.value || saving.value || conflict.value) return;
  const reference = props.reference, before = current.value, request = sequence;
  saving.value = true; saveError.value = "";
  try {
    const result = await saveRouteConfiguration(reference, before.revision, changes.value, before.csrf_token);
    if (!active || request !== sequence || reference !== props.reference) return;
    current.value = result; selection.value = [...(result.machine.approvedRoutes ?? [])]; preview.value = false;
    session.toast("success", "路由审批已保存");
    emit("changed");
    emit("close");
  } catch (failure) {
    if (active && request === sequence && reference === props.reference) {
      saveError.value = errorMessage(failure);
      conflict.value = true;
    }
  } finally { if (active && request === sequence) saving.value = false; }
}
async function readLatest() {
  if (latestLoading.value || saving.value) return;
  const reference = props.reference, request = sequence; latestLoading.value = true;
  try { const result = await getRouteConfiguration(reference); if (active && request === sequence && reference === props.reference) latest.value = result; }
  catch (failure) { if (active && request === sequence) saveError.value = errorMessage(failure); }
  finally { if (active && request === sequence) latestLoading.value = false; }
}
function acceptLatest() {
  if (!latest.value) return;
  const next = rebaseRouteSelection(latest.value.machine.approvedRoutes ?? [], changes.value);
  current.value = latest.value; latest.value = null; selection.value = next;
  conflict.value = false; saveError.value = ""; preview.value = false;
}
</script>

<template>
  <ModalDialog :open="open" :title="preview ? '确认路由审批变更' : '管理路由与出口'" :busy="saving" @close="emit('close')">
    <div v-if="!preview" ref="content" class="stack" tabindex="-1">
      <p v-if="loading" role="status" class="muted">正在读取当前宣告、批准和套餐权限…</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
      <template v-if="current">
        <p class="muted small-text">路由批准不是访问授权。宣告与批准的交集才具备配置条件，设备还需转发、ACL、防火墙及客户端接收路由。</p>
        <p v-if="!canWrite" class="muted">只读 · 需网络管理员</p>
        <p v-if="current.machine.expired || !current.machine.online" class="alert warning">设备当前{{ current.machine.expired ? '密钥已过期' : '离线' }}，保存审批不会让设备自动上线。</p>
        <p v-if="!current.limits.allow_subnet_router || !current.limits.allow_exit_node" class="muted small-text">套餐未开放{{ !current.limits.allow_subnet_router ? '子网路由' : '' }}{{ !current.limits.allow_subnet_router && !current.limits.allow_exit_node ? ' / ' : '' }}{{ !current.limits.allow_exit_node ? '出口节点' : '' }}的新批准；已有批准仍可取消。</p>
        <p v-if="!options.length" class="muted">该设备没有宣告路由。在已登录的设备用 <code>tailscale set --advertise-routes=…</code> 或 <code>--advertise-exit-node</code> 后刷新。</p>
        <label v-for="prefix in options" :key="prefix" class="checkbox route-choice">
          <input type="checkbox" :aria-label="'批准路由 ' + prefix" :checked="selection.includes(prefix)" :disabled="!canWrite || saving || (!(current.machine.approvedRoutes ?? []).includes(prefix) && !canAddRoute(prefix,current.limits))" @change="toggle(prefix,($event.target as HTMLInputElement).checked)" />
          <span class="mono">{{ prefix }}</span><span class="badge">{{ isExitPrefix(prefix) ? '出口' : '子网' }}</span>
          <span v-if="!(current.machine.announcedRoutes ?? []).includes(prefix)" class="badge warning">已停止宣告</span>
        </label>
        <div v-if="validation" class="alert warning" role="status">{{ validation }}</div>
      </template>
    </div>
    <div v-else ref="content" class="stack" tabindex="-1">
      <p>设备：{{ current?.machine.hostname }}。新增批准可能扩大网络可达范围；这不会修改 ACL，也不会替其他设备选择出口节点。</p>
      <div><strong>新增批准</strong><p v-for="prefix in changes.approve" :key="prefix" class="mono">{{ prefix }}</p><p v-if="!changes.approve.length" class="muted">无</p></div>
      <div><strong>取消批准</strong><p v-for="prefix in changes.unapprove" :key="prefix" class="mono">{{ prefix }}</p><p v-if="!changes.unapprove.length" class="muted">无</p></div>
      <div v-if="validation" class="alert warning">{{ validation }}</div>
    </div>
    <div v-if="saveError" class="alert error" role="alert">{{ saveError }}</div>
    <div v-if="conflict" class="stack"><p class="muted">草稿保留，不自动覆盖或重试。先读取最新状态，再重新预览。</p><button class="btn" :disabled="latestLoading" @click="readLatest">读取最新路由状态</button></div>
    <div v-if="latest" class="stack"><p class="mono">最新批准：{{ (latest.machine.approvedRoutes ?? []).join('、') || '无' }}</p><button class="btn" @click="acceptLatest">采用最新版本并重新预览</button></div>
    <template #footer>
      <button class="btn" :disabled="saving" @click="preview ? preview = false : emit('close')">{{ preview ? '返回草稿' : '关闭' }}</button>
      <button v-if="!preview && canWrite && options.length" class="btn primary" :disabled="!dirty || Boolean(validation) || saving || conflict" @click="openPreview">预览路由变更</button>
      <button v-if="preview" class="btn primary" :disabled="saving || conflict || !canWrite || !dirty || Boolean(validation)" @click="publish">{{ saving ? '正在保存…' : '确认保存路由' }}</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.route-choice { flex-wrap: wrap; gap: 8px; overflow-wrap: anywhere; }
</style>
