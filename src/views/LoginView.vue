<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import { session } from "../store";
import { getPasskey, passkeyAvailability, passkeyErrorMessage } from "../utils/passkey";
import { legacyProviderLoginURL, loginDestination, providerLoginURL } from "../utils/auth";

const route = useRoute();
const router = useRouter();

const login = ref("");
const password = ref("");
const busy = ref("");
const error = ref("");
const providers = ref<{ id: string; name: string; start_url: string }[]>([]);
const providerLinks = computed(() => providers.value.map((provider) => ({
  ...provider, url: providerLoginURL(provider.start_url, route.query.return_to, provider.id),
})));
const setupRequired = ref(false);
const registration = ref("closed");
const localLogin = ref(true);
const passkeys = ref(false);
const availability = passkeyAvailability();
let operation: AbortController | null = null;
onUnmounted(() => operation?.abort());

onMounted(async () => {
  try {
    const info = await ep.getProviders();
    providers.value = info.providers;
    setupRequired.value = info.setup_required;
    registration.value = info.registration;
    localLogin.value = info.local_login;
    passkeys.value = info.passkeys;
    if (info.setup_required) error.value = "服务尚未初始化，请先由管理员在服务端完成初始化。";
    else {
      // 旧第三方书签经过同一受限 API 入口，不能重新引入 /login 的后端/SPA 双实现。
      const legacyStart = legacyProviderLoginURL(info.providers, route.query.provider, route.query.return_to);
      if (legacyStart) window.location.assign(legacyStart);
    }
  } catch (err) {
    error.value = errorMessage(err);
  }
});

async function submit() {
  if (busy.value || setupRequired.value) return;
  error.value = "";
  busy.value = "password";
  try {
    await session.login(login.value, password.value);
    await afterLogin();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = "";
  }
}

async function passkeyLogin() {
  if (busy.value || !availability.supported || setupRequired.value) return;
  const controller = new AbortController();
  operation = controller;
  error.value = "";
  busy.value = "passkey";
  try {
    const begin = await ep.beginPasskeyLogin();
    controller.signal.throwIfAborted();
    const credential = await getPasskey(begin.options.publicKey, controller.signal);
    controller.signal.throwIfAborted();
    await session.loginWithPasskey(credential);
    await afterLogin();
  } catch (err) {
    error.value = passkeyErrorMessage(err);
  } finally {
    operation = null;
    busy.value = "";
  }
}

async function afterLogin() {
  const target = loginDestination(route.query.return_to);
  if (target.backend) {
    window.location.assign(target.path);
    return;
  }
  await router.push(target.path);
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
      <div v-if="route.query.signed_out === 'all' || route.query.signed_out === 'current'" class="alert success" role="status" style="margin-top: 18px">{{ route.query.signed_out === 'all' ? '全部控制台登录已退出，请重新登录。' : '当前登录已退出，请重新登录。' }}</div>
      <div v-if="error" class="alert error" role="alert" style="margin-top: 18px">{{ error }}</div>

      <form v-if="localLogin" style="margin-top: 20px" @submit.prevent="submit">
        <div class="field">
          <label for="login">登录名</label>
          <input id="login" v-model="login" class="input" autocomplete="username" placeholder="请输入注册时的登录名" />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input id="password" v-model="password" class="input" type="password" autocomplete="current-password" placeholder="密码" />
        </div>
        <button class="btn primary" style="width: 100%; height: 36px" :disabled="!!busy || setupRequired || !login || !password">
          {{ busy === 'password' ? "登录中…" : "登录" }}
        </button>
      </form>

      <div v-if="passkeys" style="margin-top: 16px">
        <button class="btn" style="width: 100%" :disabled="!!busy || setupRequired || !availability.supported" @click="passkeyLogin">{{ busy === 'passkey' ? '等待设备验证…' : '使用通行密钥登录' }}</button>
        <p class="hint" style="margin-top: 8px">{{ availability.supported ? '使用已绑定的指纹、面容、设备 PIN 或安全密钥。' : availability.reason }}</p>
      </div>

      <template v-if="providers.length">
        <div style="display: flex; align-items: center; gap: 10px; margin: 18px 0; color: var(--text-faint); font-size: 12px">
          <div style="flex: 1; height: 1px; background: var(--border)" />
          或使用第三方账号
          <div style="flex: 1; height: 1px; background: var(--border)" />
        </div>
        <a v-for="provider in providerLinks" :key="provider.id" class="btn" style="width: 100%; margin-bottom: 10px" :href="provider.url ?? undefined" :aria-disabled="!provider.url || !!busy">
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
