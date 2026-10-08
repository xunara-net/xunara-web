<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { User } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import { formatTime, roleLabel } from "../utils/format";

const loading = ref(true);
const error = ref("");
const users = ref<User[]>([]);
const busy = ref(false);

const canWrite = () => {
  const role = session.state.user?.role;
  return role === "owner" || role === "admin";
};

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    users.value = await ep.listUsers();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function changeRole(user: User, role: string) {
  busy.value = true;
  try {
    await ep.updateUser(user.id, { role });
    session.toast("success", `${user.displayName || user.loginName} 的角色已更新`);
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageHeader title="成员与权限" desc="谁可以访问这个网络，以及他们能做什么。">
    <template #actions><button class="btn" @click="load">刷新</button></template>
  </PageHeader>

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>
  <div v-if="!canWrite() && !loading" class="alert info" style="margin-bottom: 16px">
    你的角色是只读成员，可以查看成员列表但不能修改角色。
  </div>

  <div class="card">
    <div class="card-head">
      <h2>成员（{{ users.length }}）</h2>
      <span class="hint">角色决定平台权限：所有者 &gt; 管理员 &gt; 成员 &gt; 只读</span>
    </div>
    <DataTable :columns="[
      { key: 'displayName', title: '成员' },
      { key: 'email', title: '邮箱' },
      { key: 'createdAt', title: '加入时间' },
      { key: 'role', title: '角色', align: 'right' },
    ]" :rows="users" :loading="loading" row-key="id" empty-title="没有成员">
      <template #cell-displayName="{ row }">
        <div>{{ row.displayName || row.loginName }}</div>
        <div class="mono" style="color: var(--text-faint); font-size: 12px">{{ row.loginName }}</div>
      </template>
      <template #cell-email="{ row }">{{ row.email || "—" }}</template>
      <template #cell-createdAt="{ row }">{{ formatTime(row.createdAt) }}</template>
      <template #cell-role="{ row }">
        <select
          v-if="canWrite()"
          class="select"
          style="width: 120px"
          :value="row.role"
          :disabled="busy"
          @change="changeRole(row, ($event.target as HTMLSelectElement).value)"
        >
          <option value="owner">所有者</option>
          <option value="admin">管理员</option>
          <option value="member">成员</option>
          <option value="viewer">只读</option>
        </select>
        <span v-else class="badge">{{ roleLabel(row.role) }}</span>
      </template>
    </DataTable>
  </div>
</template>
