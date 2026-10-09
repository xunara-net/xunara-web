<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { User } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import { formatTime, roleLabel } from "../utils/format";
import { canManageMemberRoles, isLastOwner } from "../utils/members";

const loading = ref(true);
const error = ref("");
const users = ref<User[]>([]);
const busy = ref(false);

const canWrite = () => canManageMemberRoles(session.state.user?.role);

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

async function changeRole(user: User, event: Event) {
  const select = event.target as HTMLSelectElement;
  const role = select.value;
  // 原生 select 已经先变化，取消/失败时必须显示服务器确认的角色，而非假装修改成功。
  select.value = user.role;
  if (!canWrite() || busy.value || role === user.role || isLastOwner(user, users.value)) return;
  if (!window.confirm(`将「${user.displayName || user.loginName}」从${roleLabel(user.role)}改为${roleLabel(role)}？这会改变其管理权限。`)) return;
  busy.value = true;
  try {
    await ep.updateUser(user.id, { role });
    if (user.id === session.state.user?.id) await session.load();
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
    <template #actions><button class="btn" :disabled="loading || busy" @click="load">刷新</button></template>
  </PageHeader>

  <div v-if="error" class="alert error" role="alert" style="margin-bottom: 16px">{{ error }}</div>
  <div v-if="!canWrite() && !loading" class="alert info" style="margin-bottom: 16px">
    只有网络所有者可以修改成员角色。你可以查看列表，但不能授予或收回成员管理权限。
  </div>

  <div v-if="!error" class="card">
    <div class="card-head">
      <h2>成员（{{ loading ? "…" : users.length }}）</h2>
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
          :disabled="busy || isLastOwner(row, users)"
          :title="isLastOwner(row, users) ? '至少保留一名所有者，请先授予另一名成员所有者角色' : '修改成员角色'"
          @change="changeRole(row, $event)"
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
