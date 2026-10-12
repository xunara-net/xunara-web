<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { getRouteConfiguration, type RouteConfiguration } from "../api/route-management";
import { errorMessage } from "../api/client";
import RouteApprovalDialog from "./RouteApprovalDialog.vue";
const props = defineProps<{ reference: string }>();
const emit = defineEmits<{ (event: "changed"): void }>();
const current = ref<RouteConfiguration | null>(null), loading = ref(false), error = ref(""), editing = ref(false);
let sequence = 0, active = true;
onBeforeUnmount(() => { active = false; sequence++; });
watch(() => props.reference, () => { editing.value = false; load(); }, { immediate: true });
async function load() {
  const request = ++sequence, reference = props.reference;
  loading.value = true; error.value = ""; current.value = null;
  try { const result = await getRouteConfiguration(reference); if (active && request === sequence && reference === props.reference) current.value = result; }
  catch (failure) { if (active && request === sequence) error.value = errorMessage(failure); }
  finally { if (active && request === sequence) loading.value = false; }
}
function changed() { load(); emit("changed"); }
</script>
<template>
  <section class="card" aria-label="路由审批">
    <div class="card-head"><h2>路由审批</h2><button class="btn small" :disabled="loading" @click="load">刷新路由配置</button></div>
    <div class="card-body stack">
      <p v-if="loading" class="muted" role="status">正在读取路由配置…</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
      <template v-if="current">
        <p class="muted">宣告 {{ current.machine.announcedRoutes?.length }} 条 · 批准 {{ current.machine.approvedRoutes?.length }} 条。审批不代表转发、ACL 或客户端选择已完成。</p>
        <p v-if="!current.can_manage" class="muted">只读 · 需网络管理员</p>
        <button class="btn" @click="editing = true">{{ current.can_manage ? '管理路由与出口' : '查看路由配置' }}</button>
      </template>
    </div>
  </section>
  <RouteApprovalDialog :reference="reference" :open="editing" @close="editing = false" @changed="changed" />
</template>
