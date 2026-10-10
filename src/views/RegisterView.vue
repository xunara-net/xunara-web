<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import { session } from "../store";
import type { ProvidersPayload, TenantSignupResult } from "../api/types";
import { beginInvitedIdentity } from "../api/account-identities";

// One registration page, three deployment shapes:
//
//   closed  — the deployment offers no account creation at all
//   invite  — an administrator hands out invite codes (the classic shape)
//   open    — visitors create their own account; on a hosted deployment the
//             sign-up desk also creates a whole tenant for them
//
// The providers payload says which one this is, so the page never guesses.

const route = useRoute();
const router = useRouter();

const info = ref<ProvidersPayload | null>(null);
const loadError = ref("");
const loading = ref(true);

const invite = ref("");
const login = ref("");
const displayName = ref("");
const email = ref("");
const password = ref("");
const busy = ref(false);
const error = ref("");
const created = ref<TenantSignupResult | null>(null);

const registration = computed(() => info.value?.registration ?? "closed");
const selfService = computed(() => info.value?.self_service ?? null);
/** open + a sign-up desk means a whole tenant is created, not a member. */
const createsTenant = computed(() => registration.value === "open" && selfService.value !== null);
const canRegister = computed(() => registration.value === "invite" || registration.value === "open");

onMounted(() => {
  // 旧链接中的邀请码不再被读取，及时清除地址栏，正式流程改为单独输入。
  if (route.query.invite !== undefined) {
    const query = { ...route.query };
    delete query.invite;
    void router.replace({ path: route.path, query, hash: route.hash });
  }
  void load();
});

async function registerExternal(providerID: string) {
  if (busy.value || !info.value) return;
  if (registration.value === "open") {
    const provider = info.value.providers.find((entry) => entry.id === providerID);
    if (provider) window.location.assign(provider.start_url);
    return;
  }
  if (!info.value.registration_token || !invite.value.trim()) return;
  busy.value = true; error.value = "";
  try {
    const target = await beginInvitedIdentity(providerID, invite.value.trim(), info.value.registration_token);
    invite.value = ""; password.value = "";
    window.location.assign(target);
  } catch (err) { error.value = errorMessage(err); busy.value = false; }
}

async function load() {
  loading.value = true;
  loadError.value = "";
  info.value = null;
  try {
    info.value = await ep.getProviders();
  } catch (err) {
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function valid(): boolean {
  if (loading.value || loadError.value || !canRegister.value || !info.value?.local_login || info.value.setup_required || created.value) return false;
  if (!login.value.trim() || !password.value) return false;
  if (registration.value === "invite" && !invite.value.trim()) return false;
  return true;
}

async function submit() {
  if (busy.value || !valid()) return;
  error.value = "";
  busy.value = true;
  try {
    const desk = selfService.value;
    if (registration.value === "open" && desk) {
      created.value = await ep.signupTenant(desk.endpoint, {
        login: login.value.trim(),
        display_name: displayName.value.trim(),
        email: email.value.trim(),
        password: password.value,
      });
      password.value = "";
      // A shared parent-domain cookie means the browser is already signed in
      // on the tenant host; otherwise the tenant host asks once for the
      // password that was just set.
      if (created.value.handoff) {
        window.location.assign(`${created.value.organization.url}/dashboard`);
      }
      return;
    }
    await session.signup({
      invite: registration.value === "invite" ? invite.value.trim() : "",
      login: login.value.trim(),
      display_name: displayName.value.trim(),
      email: email.value.trim(),
      password: password.value,
    });
    window.location.assign("/dashboard");
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
          <div class="auth-title">{{ selfService ? "创建免费账户" : "创建账号" }}</div>
          <div class="auth-sub">
            {{
              selfService
                ? "注册后自动开通你的专属网络空间"
                : registration === "invite"
                  ? "注册需要管理员发出的邀请码"
                  : "Xunara · Tailscale 兼容组网控制台"
            }}
          </div>
        </div>
      </div>

      <div v-if="loadError" class="alert error" style="margin-top: 18px">{{ loadError }}</div>

      <div v-if="loading" class="help" style="margin-top: 18px">正在确认注册方式…</div>
      <button v-else-if="loadError" class="btn" style="margin-top: 12px" @click="load">重新加载</button>

      <!-- Tenant created: the success state replaces the form so a refresh or
           a second submit cannot create a duplicate tenant. -->
      <template v-if="created">
        <div class="alert success" style="margin-top: 18px">
          你的网络空间已创建：<span class="mono">{{ created.organization.domain }}</span>
        </div>
        <p class="help" style="margin-top: 12px">
          {{
            created.handoff
              ? "正在进入你的控制台…"
              : "浏览器将前往你的专属域名，请使用刚设置的账号登录。"
          }}
        </p>
        <a class="btn primary" style="width: 100%; height: 36px; margin-top: 8px" :href="created.organization.url">
          进入我的控制台
        </a>
      </template>

      <!-- Registration disabled by the deployment. -->
      <template v-else-if="!loading && !loadError && (!canRegister || (!info?.local_login && !info?.providers.length) || info?.setup_required)">
        <div class="alert info" style="margin-top: 18px">
          {{ info?.setup_required ? "服务尚未初始化，请等待管理员完成配置。" : "本部署未开放自助注册，请联系管理员获取账号。" }}
        </div>
        <a class="btn" style="width: 100%; height: 36px; margin-top: 12px" href="/login">返回登录</a>
      </template>

      <template v-else-if="!loading && !loadError">
        <div v-if="error" class="alert error" style="margin-top: 18px">{{ error }}</div>

          <div v-if="registration === 'invite'" class="field" style="margin-top: 20px">
            <label for="invite">邀请码</label>
            <input id="invite" v-model="invite" class="input mono" placeholder="invite-…" :disabled="busy" autocomplete="off" />
            <p class="help">在管理员提供的网络注册地址输入邀请码。邀请码一次有效，请勿添加到网址中。</p>
          </div>
        <div v-if="!createsTenant && info?.providers.length" class="stack" style="margin-top: 16px">
          <button v-for="provider in info.providers" :key="provider.id" class="btn" :disabled="busy || registration === 'invite' && (!invite.trim() || !info.registration_token)" @click="registerExternal(provider.id)">{{ busy ? '正在授权…' : `使用 ${provider.name} 加入网络` }}</button>
          <p class="help">授权成功后，邀请码与成员额度在服务端一起确认。不需要另设密码。</p>
        </div>

        <form v-if="info?.local_login" style="margin-top: 20px" @submit.prevent="submit">
          <div class="field">
            <label for="login">登录名</label>
            <input
              id="login"
              v-model="login"
              class="input"
              autocomplete="username"
              placeholder="字母、数字、@ . _ - +"
            />
            <div v-if="createsTenant" class="help">它将作为你的网络空间域名前缀。</div>
          </div>
          <div class="field">
            <label for="display">昵称</label>
            <input id="display" v-model="displayName" class="input" placeholder="显示名称（可选）" />
          </div>
          <div class="field">
            <label for="email">邮箱</label>
            <input
              id="email"
              v-model="email"
              class="input"
              type="email"
              autocomplete="email"
              placeholder="name@example.com（可选）"
            />
          </div>
          <div class="field">
            <label for="password">密码</label>
            <input
              id="password"
              v-model="password"
              class="input"
              type="password"
              autocomplete="new-password"
            />
            <div class="help">至少 12 位，建议使用大小写字母、数字与符号的组合。</div>
          </div>
          <button class="btn primary" style="width: 100%; height: 36px" :disabled="busy || !valid()">
            {{ busy ? "注册中…" : selfService ? "免费创建账户" : "注册并登录" }}
          </button>
        </form>
      </template>

      <div v-if="!created" class="auth-footer">
        <router-link to="/login">已有账号，去登录</router-link>
      </div>
    </div>
  </div>
</template>
