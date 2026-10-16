<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import AuthFrame from "../components/AuthFrame.vue";
import { errorMessage } from "../api/client";
import { getSetupState, setupAdministrator } from "../api/browser-authorization";
import { session } from "../store";

const router = useRouter();
const loading = ref(true);
const required = ref(false);
const csrf = ref("");
const busy = ref(false);
const error = ref("");
const body = reactive({ token: "", login: "admin", display_name: "", email: "", password: "", confirm: "" });

async function load() {
  loading.value = true;
  error.value = "";
  csrf.value = "";
  try {
    const state = await getSetupState();
    required.value = state.required;
    csrf.value = state.csrf_token ?? "";
  } catch (failure) { error.value = errorMessage(failure); }
  finally { loading.value = false; }
}

async function submit() {
  if (!csrf.value || busy.value) return;
  if (body.password !== body.confirm) { error.value = "两次输入的密码不一致"; return; }
  busy.value = true;
  error.value = "";
  try {
    await setupAdministrator({ ...body }, csrf.value);
    await session.load();
    await router.replace("/dashboard");
  } catch (failure) { error.value = errorMessage(failure); csrf.value = ""; }
  finally { body.token = ""; body.password = ""; body.confirm = ""; busy.value = false; }
}
onMounted(load);
</script>

<template>
  <AuthFrame title="初始化管理员" subtitle="仅限首次部署。必须持有服务端的一次性初始化令牌，访问网页不会自动获得管理员权限。">
    <p v-if="loading" class="muted" role="status">正在检查初始化状态…</p>
    <template v-else-if="required && csrf">
      <p class="muted">请由部署管理员从服务端状态目录的 <code>setup-token</code> 文件读取令牌，不要通过链接或聊天公开发送。</p>
      <form class="setup-form" @submit.prevent="submit">
        <label for="setup-proof">一次性初始化令牌</label>
        <input id="setup-proof" v-model="body.token" type="password" autocomplete="off" required :disabled="busy" />
        <label for="setup-login">管理员登录名</label>
        <input id="setup-login" v-model="body.login" autocomplete="username" required maxlength="128" :disabled="busy" />
        <label for="setup-name">昵称（可选）</label><input id="setup-name" v-model="body.display_name" autocomplete="nickname" :disabled="busy" />
        <label for="setup-email">联系邮箱（可选）</label><input id="setup-email" v-model="body.email" type="email" autocomplete="email" :disabled="busy" />
        <label for="setup-password">新密码</label>
        <input id="setup-password" v-model="body.password" type="password" autocomplete="new-password" minlength="12" required :disabled="busy" />
        <label for="setup-confirm">再次输入密码</label>
        <input id="setup-confirm" v-model="body.confirm" type="password" autocomplete="new-password" minlength="12" required :disabled="busy" />
        <button class="btn primary" :disabled="busy">{{ busy ? "正在初始化…" : "完成初始化" }}</button>
      </form>
    </template>
    <p v-else-if="!error && !required" class="muted" role="status">此服务已经完成初始化，请使用现有账户登录。</p>
    <p v-if="error" class="alert danger" role="alert">{{ error }}。请重新读取状态后再操作。</p>
    <div class="setup-footer">
      <button v-if="error || (required && !csrf)" class="btn" :disabled="busy || loading" @click="load">重新读取状态</button>
      <router-link to="/login">返回登录</router-link>
    </div>
  </AuthFrame>
</template>

<style scoped>
.setup-form { display: grid; gap: 10px; margin: 24px 0; } .setup-form button { margin-top: 12px; }
.setup-footer { display: flex; align-items: center; gap: 16px; margin-top: 24px; }
.muted { line-height: 1.7; } .alert { margin: 16px 0; }
</style>
