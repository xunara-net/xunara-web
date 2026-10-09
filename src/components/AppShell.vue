<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { session } from "../store";
import { errorMessage } from "../api/client";
import NavIcon from "./NavIcon.vue";
import { useDialogFocus } from "../utils/dialog";

// Navigation groups mirror the specification's console map (spec 93/94):
// 我的账户 / 我的网络 / 接入 / 平台. Items that need a capability the plan
// does not grant stay visible but explain themselves on the page.
const groups = computed(() => [
  {
    title: "总览",
    items: [
      { to: "/dashboard", label: "控制台首页", icon: "home" },
      { to: "/plan", label: "套餐与用量", icon: "plan" },
    ],
  },
  {
    title: "我的网络",
    items: [
      { to: "/devices", label: "设备", icon: "device" },
      { to: "/network", label: "网络", icon: "network" },
      { to: "/permissions", label: "访问权限", icon: "lock" },
      { to: "/dns", label: "DNS", icon: "dns" },
      { to: "/relays", label: "我的中继", icon: "relay" },
      { to: "/routes", label: "路由与出口", icon: "route" },
      { to: "/topology", label: "拓扑与连接", icon: "topology" },
    ],
  },
  {
    title: "接入与安全",
    items: [
      { to: "/api", label: "API 与密钥", icon: "key" },
      { to: "/security", label: "安全中心", icon: "shield" },
      { to: "/audit", label: "审计日志", icon: "audit" },
    ],
  },
  {
    title: "账户",
    items: [
      { to: "/members", label: "成员与权限", icon: "members" },
      { to: "/settings", label: "个人设置", icon: "settings" },
    ],
  },
]);

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);
const signingOut = ref(false);
const drawerOpen = ref(false);
const collapsed = ref(false);
const isMobile = ref(false);
const drawer = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const mobileDrawerOpen = computed(() => isMobile.value && drawerOpen.value);
useDialogFocus(mobileDrawerOpen, drawer, () => { drawerOpen.value = false; });

let media: MediaQueryList;
function updateViewport() {
  isMobile.value = media.matches;
  if (!isMobile.value) drawerOpen.value = false;
}
onMounted(() => {
  media = window.matchMedia("(max-width: 900px)");
  updateViewport();
  media.addEventListener("change", updateViewport);
});
onBeforeUnmount(() => media?.removeEventListener("change", updateViewport));
watch(() => route.fullPath, async () => {
  drawerOpen.value = false;
  menuOpen.value = false;
  await nextTick();
  window.scrollTo({ top: 0, behavior: "instant" });
  content.value?.focus({ preventScroll: true });
});

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
    relays: "我的中继",
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
  if (signingOut.value) return;
  signingOut.value = true;
  try {
    await session.logout();
    await router.replace({ name: "login", query: { signed_out: "current" } });
  } catch (err) {
    session.toast("error", errorMessage(err));
  } finally {
    signingOut.value = false;
  }
}
</script>

<template>
  <div class="shell" :class="{ 'sidebar-collapsed': collapsed && !isMobile }">
    <div v-if="mobileDrawerOpen" class="drawer-backdrop" @click="drawerOpen = false" />
    <aside id="console-navigation" ref="drawer" class="sidebar" :class="{ 'drawer-open': drawerOpen }" :inert="isMobile && !drawerOpen" :role="mobileDrawerOpen ? 'dialog' : undefined" :aria-modal="mobileDrawerOpen ? true : undefined" aria-label="控制台导航">
      <div class="sidebar-brand">
        <span class="brand-mark">玄</span>
        <span class="brand-name">玄序 <span class="muted">Xunara</span></span>
        <button class="btn ghost small drawer-close" aria-label="关闭菜单" @click="drawerOpen = false">×</button>
      </div>
      <nav class="sidebar-nav" aria-label="功能菜单">
        <div v-for="group in groups" :key="group.title" class="nav-group">
          <div class="nav-group-title">{{ group.title }}</div>
          <router-link v-for="item in group.items" :key="item.to" :to="item.to" class="nav-item" :title="item.label" @click="drawerOpen = false">
            <span class="nav-icon"><NavIcon :name="item.icon" /></span>
            <span class="nav-label">{{ item.label }}</span>
          </router-link>
        </div>
      </nav>
      <button class="sidebar-collapse btn ghost" :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'" @click="collapsed = !collapsed"><NavIcon name="collapse" /><span class="nav-label">收起侧边栏</span></button>
    </aside>

    <div class="main" :inert="mobileDrawerOpen">
      <header class="topbar">
        <div class="crumbs">
          <button class="btn ghost mobile-menu" aria-label="打开菜单" aria-controls="console-navigation" :aria-expanded="drawerOpen" @click="drawerOpen = true"><NavIcon name="menu" /></button>
          <span class="desktop-crumb">控制台 /</span>
          <strong>{{ title }}</strong>
        </div>
        <div style="position: relative">
          <button class="btn ghost" @click="menuOpen = !menuOpen">
            <span class="brand-mark" style="width: 22px; height: 22px; font-size: 12px; border-radius: 6px">
              {{ initials }}
            </span>
            <span class="account-name">{{ session.state.user?.displayName || session.state.user?.loginName }}</span>
          </button>
          <div v-if="menuOpen" class="menu" @mouseleave="menuOpen = false">
            <div style="padding: 8px 10px; color: var(--text-muted); font-size: 12.5px">
              {{ session.state.user?.email || "未绑定邮箱" }}
            </div>
            <div class="sep" />
            <button @click="$router.push('/settings')">个人设置</button>
            <button @click="$router.push('/security')">安全中心</button>
            <div class="sep" />
            <button style="color: var(--danger)" :disabled="signingOut" @click="signOut">{{ signingOut ? '正在退出…' : '退出登录' }}</button>
          </div>
        </div>
      </header>
      <main ref="content" class="content" tabindex="-1" :aria-label="title">
        <router-view />
      </main>
    </div>
  </div>
</template>
