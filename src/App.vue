<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppShell from "./components/AppShell.vue";
import ToastHost from "./components/ToastHost.vue";
import { session } from "./store";

// The sign-in and registration pages render bare; every other page renders
// inside the console shell.
const route = useRoute();
const bare = computed(() => route.meta.bare === true);

function retryBoot() {
  window.location.reload();
}
</script>

<template>
  <div v-if="session.state.bootError" class="auth-wrap">
    <section class="card auth-card" role="alert">
      <h1 class="auth-title">暂时无法确认登录</h1>
      <p class="auth-sub" style="margin: 16px 0">登录服务或网络暂时不可用，不代表你已退出。恢复后会重新检查会话，当前页面地址不会丢失。</p>
      <details style="margin-bottom: 16px"><summary>查看错误详情</summary><p>{{ session.state.bootError }}</p></details>
      <button class="btn primary" style="width: 100%" @click="retryBoot">重新尝试</button>
    </section>
  </div>
  <template v-else>
    <AppShell v-if="!bare" />
    <router-view v-else />
    <ToastHost />
  </template>
</template>
