<script setup lang="ts">
import { computed } from "vue";
import { session } from "../store";
import { createAuthenticationAPI } from "../api/authentication-settings";
import AuthenticationEditor from "../components/AuthenticationEditor.vue";
import PageHeader from "../components/PageHeader.vue";

const owner = computed(() => session.state.user?.role === "owner");
const api = createAuthenticationAPI("/api/v1/authentication", true);
</script>

<template>
  <PageHeader title="登录与注册" desc="管理当前网络的成员加入方式、OAuth2 / OIDC 应用和登录入口。" />
  <AuthenticationEditor v-if="owner" :api="api" />
  <div v-else class="alert info">只有网络所有者可以修改注册策略和登录应用。个人第三方账号绑定在<router-link to="/security">安全中心</router-link>管理。</div>
</template>
