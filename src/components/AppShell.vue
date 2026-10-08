<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { session } from "../store";

// Navigation groups mirror the specification's console map (spec 93/94):
// 我的账户 / 我的网络 / 接入 / 平台. Items that need a capability the plan
// does not grant stay visible but explain themselves on the page.
const groups = computed(() => [
  {
    title: "总览",
    items: [
      { to: "/dashboard", label: "控制台首页", icon: "🏠" },
      { to: "/plan", label: "套餐与用量", icon: "💎" },
    ],
  },
  {
    title: "我的网络",
    items: [
      { to: "/devices", label: "设备", icon: "💻" },
      { to: "/network", label: "网络", icon: "🌐" },
      { to: "/topology", label: "拓扑与连接", icon: "🕸️" },
      { to: "/permissions", label: "访问权限", icon: "🔐" },
      { to: "/dns", label: "DNS", icon: "🧭" },
      { to: "/routes", label: "路由与出口", icon: "🚏" },
    ],
  },
  {
    title: "接入与安全",
    items: [
      { to: "/api", label: "API 与密钥", icon: "🔑" },
      { to: "/security", label: "安全中心", icon: "🛡️" },
      { to: "/audit", label: "审计日志", icon: "📜" },
    ],
  },
  {
    title: "账户",
    items: [
      { to: "/members", label: "成员与权限", icon: "👥" },
      { to: "/settings", label: "个人设置", icon: "⚙️" },
    ],
  },
]);

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

const title = computed(() => (route.meta.title as string) ?? routeName(route.name?.toString() ?? ""));
const initials = computed(() => {
  const name = session.state.user?.displayName || session.state.user?.loginName || "?";
  return name.slice(0, 1).toUpperCase();
});

function routeName(name: string): string {
  const names: Record<string, string> = {
    dashboard: "控制台首页",
    devices: "设备",
    device: "设备详情",
    network: "网络",
    topology: "拓扑与连接",
    permissions: "访问权限",
    members: "成员与权限",
    dns: "DNS",
    routes: "路由与出口",
    api: "API 与密钥",
    security: "安全中心",
    plan: "套餐与用量",
    audit: "审计日志",
    settings: "个人设置",
    "not-found": "页面不存在",
  };
  return names[name] ?? "控制台";
}

async function signOut() {
  await session.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <span class="brand-mark">玄</span>
        <span>玄序 <span style="color: var(--text-faint); font-weight: 400; font-size: 12px">Xunara</span></span>
      </div>
      <nav class="sidebar-nav">
        <div v-for="group in groups" :key="group.title" class="nav-group">
          <div class="nav-group-title">{{ group.title }}</div>
          <router-link v-for="item in group.items" :key="item.to" :to="item.to" class="nav-item">
            <span class="nav-icon">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </router-link>
        </div>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumbs">
          <span>控制台</span>
          <span>/</span>
          <strong>{{ title }}</strong>
        </div>
        <div style="position: relative">
          <button class="btn ghost" @click="menuOpen = !menuOpen">
            <span class="brand-mark" style="width: 22px; height: 22px; font-size: 12px; border-radius: 6px">
              {{ initials }}
            </span>
            <span>{{ session.state.user?.displayName || session.state.user?.loginName }}</span>
          </button>
          <div v-if="menuOpen" class="menu" @mouseleave="menuOpen = false">
            <div style="padding: 8px 10px; color: var(--text-muted); font-size: 12.5px">
              {{ session.state.user?.email || "未绑定邮箱" }}
            </div>
            <div class="sep" />
            <button @click="$router.push('/settings')">个人设置</button>
            <button @click="$router.push('/security')">安全中心</button>
            <div class="sep" />
            <button style="color: var(--danger)" @click="signOut">退出登录</button>
          </div>
        </div>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>
