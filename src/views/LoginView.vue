<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import { session } from "../store";

const route = useRoute();
const router = useRouter();

const login = ref("");
const password = ref("");
const busy = ref(false);
const error = ref("");
const providers = ref<{ id: string; name: string; start_url: string }[]>([]);
const setupRequired = ref(false);
const registration = ref("closed");

onMounted(async () => {
  try {
    const info = await ep.getProviders();
    providers.value = info.providers;
    setupRequired.value = info.setup_required;
    registration.value = info.registration;
    if (info.setup_required) error.value = "服务尚未初始化，请先由管理员在服务端完成初始化。";
  } catch (err) {
    error.value = errorMessage(err);
  }
});

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    await session.login(login.value, password.value);
    const returnTo = typeof route.query.return_to === "string" ? route.query.return_to : "/dashboard";
    router.push(returnTo);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="card auth-card">
      <div style="display: flex; align-items: center; gap: 10px">
        <span class="brand-mark">玄</span>
        <div>
          <div class="auth-title">登录玄序</div>
          <div class="auth-sub">Xunara · Tailscale 兼容组网控制台</div>
        </div>
      </div>

      <div v-if="route.query.password_changed === '1'" class="alert success" role="status" style="margin-top: 18px">密码已修改，所有旧登录已退出。请使用新密码重新登录。</div>
      <div v-if="error" class="alert error" style="margin-top: 18px">{{ error }}</div>

      <form style="margin-top: 20px" @submit.prevent="submit">
        <div class="field">
          <label for="login">登录名</label>
          <input id="login" v-model="login" class="input" autocomplete="username" placeholder="邮箱或用户名" />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input id="password" v-model="password" class="input" type="password" autocomplete="current-password" placeholder="密码" />
        </div>
        <button class="btn primary" style="width: 100%; height: 36px" :disabled="busy || !login || !password">
          {{ busy ? "登录中…" : "登录" }}
        </button>
      </form>

      <template v-if="providers.length">
        <div style="display: flex; align-items: center; gap: 10px; margin: 18px 0; color: var(--text-faint); font-size: 12px">
          <div style="flex: 1; height: 1px; background: var(--border)" />
          或使用第三方账号
          <div style="flex: 1; height: 1px; background: var(--border)" />
        </div>
        <a v-for="provider in providers" :key="provider.id" class="btn" style="width: 100%; margin-bottom: 10px" :href="provider.start_url">
          使用 {{ provider.name }} 登录
        </a>
      </template>

      <div class="auth-footer">
        <router-link v-if="registration === 'invite'" to="/register">使用邀请码注册</router-link>
        <router-link v-else-if="registration === 'open'" to="/register">免费创建账户</router-link>
        <a href="https://github.com/xunara-net/xunara-docs" target="_blank" rel="noreferrer">帮助文档</a>
      </div>
    </div>
  </div>
</template>
