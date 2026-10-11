export const coreNavigation = [
  { to: "/dashboard", label: "控制台首页", icon: "home" },
  { to: "/devices", label: "设备", icon: "device" },
  { to: "/network", label: "网络", icon: "network" },
  { to: "/permissions", label: "访问权限", icon: "lock" },
  { to: "/dns", label: "DNS", icon: "dns" },
  { to: "/routes", label: "路由与出口", icon: "route" },
  { to: "/relays", label: "我的中继", icon: "relay" },
];
export function managementNavigation(role?: string) {
  return [
    { to: "/topology", label: "拓扑与连接", icon: "topology" },
    { to: "/members", label: "成员与权限", icon: "members" },
    { to: "/api", label: "API 与密钥", icon: "key" },
    { to: "/plan", label: "套餐与用量", icon: "plan" },
    { to: "/security", label: "安全中心", icon: "shield" },
    { to: "/audit", label: "审计日志", icon: "audit" },
    ...(role === "owner" ? [{ to: "/authentication", label: "登录与注册", icon: "shield" }] : []),
    { to: "/settings", label: "个人设置", icon: "settings" },
  ];
}
