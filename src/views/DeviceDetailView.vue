<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { Machine } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import AsyncSection from "../components/AsyncSection.vue";
import { formatTime, relativeTime } from "../utils/format";

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const error = ref("");
const machine = ref<Machine | null>(null);
const routeDraft = ref<string[]>([]);
const saving = ref(false);

const announced = computed(() => machine.value?.announcedRoutes ?? []);
const approved = computed(() => machine.value?.approvedRoutes ?? []);

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const id = String(route.params.id ?? "");
    machine.value = await ep.getMachine(id);
    routeDraft.value = [...(machine.value.approvedRoutes ?? [])];
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function toggleRoute(route: string, checked: boolean) {
  if (checked) {
    if (!routeDraft.value.includes(route)) routeDraft.value.push(route);
  } else {
    routeDraft.value = routeDraft.value.filter((r) => r !== route);
  }
}

async function saveRoutes() {
  if (!machine.value) return;
  saving.value = true;
  try {
    await ep.setMachineRoutes(machine.value.id, routeDraft.value);
    session.toast("success", "路由已更新");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!machine.value) return;
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
  <PageHeader :title="machine?.hostname || '设备详情'" desc="设备信息、路由与撤销操作。">
    <template #actions>
      <router-link class="btn" to="/devices">返回列表</router-link>
      <button class="btn danger" @click="remove">删除设备</button>
    </template>
  </PageHeader>

  <AsyncSection :loading="loading" :error="error">
    <div v-if="machine" class="grid cols-2">
      <div class="card">
        <div class="card-head"><h2>基本信息</h2><StatusBadge :online="machine.online" :expired="machine.expired" /></div>
        <div class="card-body">
          <div class="kv">
            <div class="k">设备名称</div><div class="v">{{ machine.hostname || "—" }}</div>
            <div class="k">设备 ID</div><div class="v mono">{{ machine.stableId }}</div>
            <div class="k">归属用户</div><div class="v">{{ machine.userLoginName || `#${machine.userId}` }}</div>
            <div class="k">连接方式</div><div class="v">{{ machine.method || "—" }}</div>
            <div class="k">首次加入</div><div class="v">{{ formatTime(machine.created) }}</div>
            <div class="k">最后在线</div><div class="v">{{ relativeTime(machine.lastSeen) }}</div>
            <div class="k">临时设备</div><div class="v">{{ machine.ephemeral ? "是" : "否" }}</div>
            <div class="k">出口节点</div><div class="v">{{ machine.exitNode ? "已启用" : "未启用" }}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>网络</h2></div>
        <div class="card-body">
          <div class="kv">
            <div class="k">IPv4</div><div class="v mono">{{ machine.ipv4 || "—" }}</div>
            <div class="k">IPv6</div><div class="v mono">{{ machine.ipv6 || "—" }}</div>
            <div class="k">宣告路由</div><div class="v">{{ announced.length ? announced.join("、") : "无" }}</div>
            <div class="k">已批准路由</div><div class="v">{{ approved.length ? approved.join("、") : "无" }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="machine" class="card">
      <div class="card-head">
        <h2>路由审批</h2>
        <span class="hint">设备宣告的子网路由需要批准后才会下发到网络</span>
      </div>
      <div class="card-body">
        <div v-if="announced.length === 0" class="empty" style="padding: 20px">
          <div class="title">该设备没有宣告路由</div>
          <div class="desc">在设备上运行 <code>tailscale up --advertise-routes=…</code> 后可在此批准。</div>
        </div>
        <template v-else>
          <label v-for="route in announced" :key="route" class="checkbox" style="margin-bottom: 10px">
            <input
              type="checkbox"
              :checked="routeDraft.includes(route)"
              @change="toggleRoute(route, ($event.target as HTMLInputElement).checked)"
            />
            <span class="mono">{{ route }}</span>
          </label>
          <div>
            <button class="btn primary" :disabled="saving" @click="saveRoutes">保存路由</button>
          </div>
        </template>
      </div>
    </div>
  </AsyncSection>
</template>
