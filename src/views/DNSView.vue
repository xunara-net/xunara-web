<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { DNSRecord } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";

const loading = ref(true);
const error = ref("");
const records = ref<DNSRecord[]>([]);

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    records.value = await ep.listDNS();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function remove(record: DNSRecord) {
  if (!window.confirm(`删除 ${record.name} 的 ${record.type} 记录？`)) return;
  try {
    await ep.deleteDNS(record.id);
    session.toast("success", "DNS 记录已删除");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  }
}
</script>

<template>
  <PageHeader title="DNS" desc="MagicDNS 名称与自定义记录。">
    <template #actions><button class="btn" @click="load">刷新</button></template>
  </PageHeader>

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>

  <div class="card">
    <div class="card-head">
      <h2>DNS 记录</h2>
      <span class="hint">设备注册时会自动获得 MagicDNS 名称</span>
    </div>
    <DataTable :columns="[
      { key: 'name', title: '名称' },
      { key: 'type', title: '类型' },
      { key: 'value', title: '值' },
      { key: 'actions', title: '操作', align: 'right' },
    ]" :rows="records" :loading="loading" empty-title="暂无自定义 DNS 记录">
      <template #cell-name="{ row }"><span class="mono">{{ row.name }}</span></template>
      <template #cell-value="{ row }"><span class="mono">{{ row.value }}</span></template>
      <template #cell-actions="{ row }">
        <div class="row-actions"><button class="btn small danger" @click="remove(row)">删除</button></div>
      </template>
    </DataTable>
  </div>
</template>
