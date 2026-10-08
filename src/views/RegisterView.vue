<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { errorMessage } from "../api/client";
import { session } from "../store";

const route = useRoute();
const router = useRouter();

const invite = ref("");
const login = ref("");
const displayName = ref("");
const email = ref("");
const password = ref("");
const busy = ref(false);
const error = ref("");

onMounted(() => {
  const fromQuery = route.query.invite;
  if (typeof fromQuery === "string") invite.value = fromQuery;
});

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    await session.signup({
      invite: invite.value.trim(),
      login: login.value.trim(),
      display_name: displayName.value.trim(),
      email: email.value.trim(),
      password: password.value,
    });
    router.push("/dashboard");
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
          <div class="auth-title">创建账号</div>
          <div class="auth-sub">注册需要管理员发出的邀请码</div>
        </div>
      </div>

      <div v-if="error" class="alert error" style="margin-top: 18px">{{ error }}</div>

      <form style="margin-top: 20px" @submit.prevent="submit">
        <div class="field">
          <label for="invite">邀请码</label>
          <input id="invite" v-model="invite" class="input mono" placeholder="invite-…" />
        </div>
        <div class="field">
          <label for="login">登录名</label>
          <input id="login" v-model="login" class="input" placeholder="字母、数字、@ . _ - +" />
        </div>
        <div class="field">
          <label for="display">昵称</label>
          <input id="display" v-model="displayName" class="input" placeholder="显示名称（可选）" />
        </div>
        <div class="field">
          <label for="email">邮箱</label>
          <input id="email" v-model="email" class="input" type="email" placeholder="name@example.com（可选）" />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input id="password" v-model="password" class="input" type="password" autocomplete="new-password" />
          <div class="help">至少 12 位，建议使用大小写字母、数字与符号的组合。</div>
        </div>
        <button class="btn primary" style="width: 100%; height: 36px" :disabled="busy || !invite || !login || !password">
          {{ busy ? "注册中…" : "注册并登录" }}
        </button>
      </form>

      <div class="auth-footer">
        <router-link to="/login">已有账号，去登录</router-link>
      </div>
    </div>
  </div>
</template>
