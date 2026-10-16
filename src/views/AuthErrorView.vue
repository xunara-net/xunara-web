<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AuthFrame from "../components/AuthFrame.vue";

const route = useRoute();
const reasons: Record<string, [string, string]> = {
  AUTH_EXPIRED: ["登录链接已失效", "请从登录页或设备客户端重新开始，不要重复使用旧链接。"],
  AUTH_ALREADY_USED: ["此登录请求已处理", "请回到客户端确认状态，需要登录时请重新发起。"],
  AUTH_FORBIDDEN: ["未能完成授权", "账号、邀请或绑定条件未满足。请使用正确账号重新发起，必要时联系网络管理员。"],
  AUTH_RATE_LIMITED: ["操作过于频繁", "请稍后再试，不要连续重复提交。"],
  AUTH_UNAVAILABLE: ["登录服务暂不可用", "现有登录不会因此被退出。请稍后重试或联系管理员检查登录配置。"],
};
const copy = computed(() => {
  const reason = typeof route.query.reason === "string" ? route.query.reason : "";
  return Object.hasOwn(reasons, reason) ? reasons[reason]! : ["未能完成登录", "未能确认本次登录，请返回登录页重新开始。"];
});
</script>

<template>
  <AuthFrame :title="copy[0]" :subtitle="copy[1]">
    <router-link class="btn primary" to="/login">返回登录</router-link>
  </AuthFrame>
</template>
