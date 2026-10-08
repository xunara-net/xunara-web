<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import PageHeader from "../components/PageHeader.vue";

// The visual permission editor (topology drag-and-drop, device matrix,
// service pickers) compiles into the same policy AST the server already
// enforces. Until that editor lands, this page reports the compiled policy's
// state — what is enforced, and what the parser refused — so an operator can
// still answer "why can this device reach that one".

const loading = ref(true);
const error = ref("");
const policy = ref<Awaited<ReturnType<typeof ep.getPolicy>> | null>(null);

onMounted(async () => {
  try {
    policy.value = await ep.getPolicy();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <PageHeader title="访问权限" desc="设备之间允许访问的规则。当前版本展示已编译的策略状态，可视化编辑器在路线图中。" />

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>
  <div v-if="loading" class="page-loading"><div class="spinner" /></div>

  <template v-else-if="policy">
    <div class="card">
      <div class="card-head">
        <h2>策略状态</h2>
        <span class="badge" :class="policy.configured ? 'success' : 'warning'">{{ policy.configured ? "已配置" : "未配置" }}</span>
      </div>
      <div class="card-body">
        <div v-if="!policy.configured" class="empty" style="padding: 20px">
          <div class="title">当前没有策略文件</div>
          <div class="desc">默认策略下设备之间可以互相访问。策略文件由管理员在服务端配置（<span class="mono">-policy</span>）。</div>
        </div>
        <div v-else class="kv">
          <div class="k">策略规则数</div><div class="v">{{ policy.rules ?? 0 }}</div>
          <div class="k">策略文件</div><div class="v mono">{{ policy.path || "—" }}</div>
          <div class="k">解析告警</div>
          <div class="v">
            <span v-if="!policy.warnings?.length && !policy.unsupported?.length" style="color: var(--text-muted)">无</span>
            <div v-for="warning in policy.warnings" :key="warning" class="alert warning" style="margin-bottom: 6px">{{ warning }}</div>
            <div v-for="item in policy.unsupported" :key="item" class="alert info" style="margin-bottom: 6px">未支持的字段：{{ item }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>即将到来的可视化权限</h2></div>
      <div class="card-body" style="color: var(--text-muted); font-size: 13px; line-height: 1.9">
        <p>· 在拓扑图上选择两台设备，直接勾选允许的服务（SSH / Web / SMB …）</p>
        <p>· 按设备组、用户或服务配置访问规则，自动编译为 Grants / ACL</p>
        <p>· 每次修改先给出影响预览与权限模拟结果，确认后才生效</p>
      </div>
    </div>
  </template>
</template>
