<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import * as ep from "../api/endpoints";
import type { Organization } from "../api/types";
import { session } from "../store";
import { emptyResource, refreshResource } from "../utils/resources";
import PageHeader from "../components/PageHeader.vue";
const organization = reactive(emptyResource<Organization>());
const loading = ref(false);
onMounted(load);
async function load() {
  if (loading.value) return;
  loading.value = true;
  await refreshResource(organization, ep.getOrganization);
  loading.value = false;
}
</script>
<template>
  <PageHeader title="我的网络" desc="独立的 Tailnet 网络空间；访问权限、DNS 和中继在各自页面管理。"><template #actions><button class="btn" :disabled="loading" @click="load">刷新</button></template></PageHeader>
  <div v-if="organization.error" class="alert error">组织信息读取失败：{{ organization.error }}</div>
  <section class="card"><div class="card-head"><h2>网络基本信息</h2></div><div class="card-body"><div class="kv"><div class="k">网络名称</div><div class="v">{{ organization.data?.name || session.state.tenant?.organizationName || '—' }}</div><div class="k">网络编号</div><div class="v mono">{{ organization.data?.id || session.state.tenant?.id || '—' }}</div><div class="k">分配网段</div><div class="v mono">{{ session.state.plan?.networkPrefix || '尚未分配' }}</div><div class="k">网段管理</div><div class="v">{{ session.state.plan?.allowCustomCidr ? '套餐支持自定义网段，请联系平台管理员变更；本页面不执行地址迁移。' : '由系统自动分配，当前套餐不允许自定义网段。' }}</div></div></div></section>
  <div class="grid cols-2"><router-link to="/permissions" class="card card-body"><strong>访问权限 →</strong><p class="muted small-text">谁可以访问谁，规则、矩阵、发布与历史恢复。</p></router-link><router-link to="/dns" class="card card-body"><strong>DNS →</strong><p class="muted small-text">设备名称、解析器、搜索域和分流规则。</p></router-link><router-link to="/relays" class="card card-body"><strong>我的中继 →</strong><p class="muted small-text">私有中继接入、下发地图和心跳管理。</p></router-link><router-link to="/routes" class="card card-body"><strong>路由与出口 →</strong><p class="muted small-text">设备宣告的子网和出口路由。</p></router-link></div>
</template>
