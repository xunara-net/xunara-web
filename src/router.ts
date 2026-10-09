import { createRouter, createWebHistory } from "vue-router";
import { session } from "./store";

// Routes follow the specification's console map (spec section 93): account,
// tailnet, billing and settings each own a top-level group.

const routes = [
  { path: "/", redirect: "/dashboard" },
  {
    path: "/login",
    name: "login",
    component: () => import("./views/LoginView.vue"),
    meta: { public: true, bare: true },
  },
  {
    path: "/register",
    name: "register",
    component: () => import("./views/RegisterView.vue"),
    meta: { public: true, bare: true },
  },
  { path: "/dashboard", name: "dashboard", component: () => import("./views/DashboardView.vue") },
  { path: "/devices", name: "devices", component: () => import("./views/DevicesView.vue") },
  {
    path: "/devices/:id",
    name: "device",
    component: () => import("./views/DeviceDetailView.vue"),
  },
  { path: "/network", name: "network", component: () => import("./views/NetworkView.vue") },
  { path: "/topology", name: "topology", component: () => import("./views/TopologyView.vue") },
  {
    path: "/permissions",
    name: "permissions",
    component: () => import("./views/PermissionsView.vue"),
  },
  { path: "/members", name: "members", component: () => import("./views/MembersView.vue") },
  { path: "/dns", name: "dns", component: () => import("./views/DNSView.vue") },
  { path: "/routes", name: "routes", component: () => import("./views/RoutesView.vue") },
  { path: "/api", name: "api", component: () => import("./views/ApiKeysView.vue") },
  { path: "/security", name: "security", component: () => import("./views/SecurityView.vue") },
  { path: "/plan", name: "plan", component: () => import("./views/PlanView.vue") },
  { path: "/audit", name: "audit", component: () => import("./views/AuditView.vue") },
  { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue") },
  { path: "/:pathMatch(.*)*", name: "not-found", component: () => import("./views/NotFoundView.vue") },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  if (!session.state.booted) await session.load();
  // 认证故障由 App 的重试页接管，保留原目标地址，不误重定向到登录页。
  if (session.state.bootError) return true;
  if (to.meta.public) return true;
  if (!session.state.authenticated) {
    return { name: "login", query: { return_to: to.fullPath } };
  }
  return true;
});
