# Xunara Web（玄序 · 用户控制台）

Xunara 的用户控制台：登录/注册、网络总览、设备、拓扑、权限、DNS、路由、
API 密钥、安全中心、审计、套餐用量与个人设置。中文优先，浅色/深色自适应。

```text
xunara-web（本仓库） ──Xunara Core API──▶ xunara-server ──▶ 官方 Tailscale 客户端
```

前端**不接触任何管理凭据**，也不直连数据库或控制面内部状态：全部通过
`/api/v1`、`/api/v2` 的同源会话（HttpOnly Cookie）访问。

## 技术栈

- Vue 3 + TypeScript + Vite
- vue-router（路由即规格中的控制台地图）
- 手写设计系统（CSS 变量，无 UI 框架依赖），中文优先
- Vitest（纯函数与 API 层单测）

## 开发

```bash
npm install
npm run dev        # http://localhost:5173，代理到 http://127.0.0.1:8080
XUNARA_CONTROL_URL=http://10.0.0.5:8080 npm run dev
```

## 构建与检查

```bash
npm run typecheck  # vue-tsc
npm run test       # vitest
npm run build      # 产物在 dist/，由 xunara-deploy 的 nginx 或控制面静态托管
```

API 的线格式按端点分别定义：认证与套餐返回蛇形字段，历史会话与审计返回
Go 导出字段，设备与成员返回驼峰字段。`src/api/adapters.ts` 显式转换为页面模型；
`src/api/endpoints.test.ts` 验证实际响应契约，不对所有接口做通用递归改名。

## 页面（路由）

| 路由 | 页面 |
| --- | --- |
| `/login`、`/register` | 登录 / 按部署策略邀请注册、开放注册或自助开通独立网络 |
| `/dashboard` | 控制台首页 |
| `/devices`、`/devices/:id` | 设备列表 / 设备详情（路由审批、删除） |
| `/network`、`/dns`、`/routes` | 网络、DNS、路由与出口节点 |
| `/topology` | 拓扑与连接（在线/离线分组、路由标签） |
| `/permissions` | 访问权限（策略状态；可视化编辑器在路线图中） |
| `/api` | API 密钥与预授权密钥 |
| `/security` | 会话管理、安全概览与改密入口 |
| `/plan` | 套餐、额度与能力 |
| `/audit` | 审计日志 |
| `/members`、`/settings` | 成员与角色、昵称/联系邮箱与密码自助管理 |

个人设置只修改当前账户：登录名、组织与角色只读，保存昵称后同步更新控制台
展示。邮箱是未验证的联系属性，不用于登录、身份合并或密码找回。

修改密码需要当前密码、符合服务端规则的新密码和确认输入；写请求携带账户
接口提供的 CSRF header。成功后清空账户状态并回到登录页，所有旧控制台登录
失效，已连接的网络设备与 API 密钥不受影响。无本地密码的第三方账户不展示
改密表单。邮箱验证、密码找回和 2FA 尚未接入此控制台。

## 部署

推荐由 `xunara-deploy` 的 nginx 托管 `dist/`，并把 `/api`、`/key`、`/ts2021`、
`/derp`、`/health` 反向代理到 `xunara-server`，保证同源（会话 Cookie 与 CSRF
模型依赖同源）。

## 仓库关系

| 仓库 | 职责 |
| --- | --- |
| `xunara-web` | 用户控制台（本仓库） |
| `xunara-admin` | 平台超级管理员后台 |
| `xunara-server` | 控制面 + 产品后端 + Core API |
| `xunara-relay` | 中继（DERP/STUN） |
| `xunara-deploy` | 部署与编排 |
| `xunara-docs` | 规范与文档 |
