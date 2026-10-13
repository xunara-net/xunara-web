# Xunara Web（玄序 · 用户控制台）

公开开户可使用主域名下的独立网络网页入口：注册后直接进入，入口登录显式选择
网络标识，已有账号不用重新注册。新增默认/附加 IPv4 池管理与 Linux 接入前的
只读冲突停止机制；共享页面不是客户端 login-server，也不把地址池冒充 VLAN。
配置、迁移和 Quad100 边界见
[服务端网络安全手册](https://github.com/xunara-net/xunara-server/blob/main/docs/shared-console-and-address-pools.md)。

登录页新增「忘记密码」及 `/reset-password`：输入平台管理员核实身份后交付的
一次性重置码，两次确认新密码；码不进入 URL 或持久存储，结果未知不自动重试。
生成不改密码，兑换才撤销本账户浏览器登录；设备 / 中继 / API Key / 绑定不变。
自动邮件找回、邮箱验证和 2FA 仍未实现。接口及 identity v17 以
[服务端恢复说明](https://github.com/xunara-net/xunara-server/blob/main/docs/password-recovery.md) 为准。

第三方入口复用实际配置，支持 OIDC 与原生 OAuth2 登录、绑定和邀请加入，不增加
虚假的提供方按钮。开发代理与 nginx 均将回调转给后端，配置和未交付边界见
[服务端 OAuth2 手册](https://github.com/xunara-net/xunara-server/blob/main/docs/oauth2-login.md)。

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

API 的线格式按端点分别定义：认证、账户会话与套餐返回蛇形字段，审计返回
Go 导出字段，设备与成员返回驼峰字段。`src/api/adapters.ts` 显式转换为页面模型；
`src/api/endpoints.test.ts` 验证实际响应契约，不对所有接口做通用递归改名。

## 页面（路由）

| 路由 | 页面 |
| --- | --- |
| `/login`、`/register` | 登录 / 按部署策略邀请注册、开放注册或自助开通独立网络 |
| `/dashboard` | 控制台首页 |
| `/devices`、`/devices/:id` | 设备列表 / 设备详情（IPv4 修改、路由审批、删除） |
| `/network`、`/dns`、`/relays`、`/routes` | 网段管理、DNS、默认/公共/托管中继、路由与出口节点（独立功能页） |
| `/topology` | 拓扑与连接（在线/离线分组、路由标签） |
| `/permissions` | ACL / Grants 规则编辑、策略图、权限矩阵、组、高级 HuJSON、测试原因与版本恢复 |
| `/api` | API 密钥与预授权密钥 |
| `/security` | 通行密钥、会话管理、安全概览与改密入口 |
| `/plan` | 套餐、额度与能力 |
| `/audit` | 审计日志 |
| `/members`、`/settings` | 成员与角色、昵称/联系邮箱与密码自助管理 |
| `/authentication` | 所有者管理成员注册方式、OAuth2/OIDC 应用、启停、密钥轮换与归档 |

「成员与权限 → 注册设置」和「安全中心 → 管理第三方登录配置」均直达侧栏的
「登录与注册」。邀请加入与独立网络公开开户分开，不再只提示联系部署管理员。
应用密钥只在当前弹窗的一次请求中使用，提交后清空，不存浏览器、不回显。
身份 v15 与严格配置契约需先升级服务端；配置边界以
[服务端手册](https://github.com/xunara-net/xunara-server/blob/main/docs/authentication-settings.md)为准。

## 网络控制台

「路由与出口」直接搜索/筛选/分页并打开审批弹窗，设备详情复用同一组件。
勾选只产生草稿，预览确认才写入；并发修改/结果未知保留草稿，采用最新状态后
重新预览，不自动重试。区分待批准、停止宣告、离线/过期与配置匹配，成员只读。
出口保留失效选择和自报客户端，提供本机平台选择/停止命令；不可用说明会
警告，手机走 APP，不含认证密钥、不改变其它设备。版本、CSRF/Entitlement
及旧 API 兼容以[服务端路由手册](https://github.com/xunara-net/xunara-server/blob/main/docs/route-management.md)为准。

桌面使用可收起左侧菜单，手机使用默认关闭的侧边抽屉；选择页面后回到正文顶部，
抽屉和弹窗均支持 Escape、焦点返回与独立滚动。各功能通过页内标签切换，不在一页堆叠。

- **访问权限**：可视化与高级编辑共用 Policy AST；草稿经服务端编译、自检、影响预览，
  确认后按版本发布。历史恢复生成新版本，冲突保留草稿。权限测试与矩阵使用实际编译器，
  不发包、不伪造连接质量；未配置策略的旧网络会明确提示完全互通。
- **DNS**：MagicDNS、解析器、搜索域、分流和 A / AAAA 地址记录实际保存并下发；
  系统设备名、服务和证书记录不能覆盖。域名仍由部署管理员配置。
- **地址**：实际/期望网段、仅校验预览与确认保存；已有设备保留 IP，设备详情显式修改。
  网段与旧 IP 基准保护冲突，失败保留草稿；官方设备范围为 CGNAT 子集，RFC1918 用于
  子网路由。Free 默认不可自定义网段，IPv6 仍由系统分配，按 IP 的 ACL/自定义 DNS 须同步。
  首页与套餐页提供网段管理入口；网络页保持修改入口可见，角色、套餐、读取失败、
  待应用与会话未确认分别解释禁用原因。保存后重读服务端快照，SPA 切换首页/套餐页
  不再显示旧网段；配置子网路由与逐台修改旧设备 IP 的入口分开说明。
- **中继**：首屏展示默认与可用地区，区分部署、外部与托管来源；非托管节点可手工
  添加或导入官方地图到草稿，确认发布，支持历史恢复，不假称外部健康或远程控制。
  本租户托管列表、一次性令牌与安全接入命令；心跳、地图与
  公网端口可达性分开说明。令牌只显示一次，不拼入安装命令或浏览器存储。
  配置冲突保留草稿，须查看最新内容并确认新基准后手动保存；历史恢复生成新版本，
  不恢复服务凭据或遥测。期望状态/限速不代表节点已经执行，撤销身份不能通过恢复复活。
- **程序下载**：「我的中继 → 程序下载」提供 Linux AMD64/ARM64/ARMv7、macOS Intel/
  Apple Silicon、Windows AMD64/ARM64 七种已预编译文件，无需自行编译，附校验和及构建
  元数据。[真实预览发布](https://github.com/xunara-net/xunara-relay/releases/tag/v0.1.0-preview.2)
  不含凭据，不承诺全 OS 现场验收、签名安装器或自动升级。
- **添加设备**：按平台 → 接入方式与新 Token 有效期 → 折叠高级选项 → 安装/接入命令排序；先选择有效期再生成，已有 Token 不显示可修改期限。高级参数改变后实时更新下方命令，唯一复制按钮固定在弹窗底部，展开/滚动也可操作；手机同位置复制 APP 自定义服务器地址。Linux 安装与加入仍合并为两行。
- **设备 Token 接入**：显式勾选后粘贴设备 Auth Key 或生成默认 15 分钟一次性密钥，自动写入整条命令的 `--auth-key`，不再单独复制 Token 或下载设备脚本。含 Token 的命令可能进入终端历史、进程参数和剪贴板，勿分享/入 Git；关闭或切换浏览器/手机清除本页秘密，不做浏览器持久存储。手机仍走浏览器授权。
- **立即过期**：设备列表/详情提供独立操作，读取身份/有效期版本并确认；失败或冲突不自动重试，不删除设备或释放额度，手机动作区换行。
- **连接详情**：归属中继/地图来源/端口、UDP/IPv6/NAT、候选端点和客户端探测延迟，不冒充实时路径。
- **私有安装与检测**：接入指南生成固定版已校验 Linux systemd 安装命令，隐藏读取令牌/保留身份升级；私有中继逐行健康检测，不替代心跳。
- **核心导航**：默认展示核心网络，其他管理折叠，保留深链接和手机抽屉。
- **权限边界**：普通成员只读；写入仍由服务端校验角色、套餐与 CSRF，前端禁用/隐藏按钮
  不代替授权。网络路由批准不等于访问允许。

依赖新版服务端（state v23、plans v4、identity v13）；部署顺序与 API 契约见服务端
[网络控制台说明](https://github.com/xunara-net/xunara-server/blob/main/docs/network-console.md)。
隔离 Chromium 回归由兄弟仓库 `xunara-admin/scripts/browser-smoke.cjs` 运行，使用 Node 22
内置 SQLite 构造临时设备；真实管理 API 和编译器不打桩，故障夹具只在隔离状态使用。
这不替代官方客户端注册、DNS / PacketFilter / DERP TLS 的服务端集成测试。

个人设置只修改当前账户：登录名、组织与角色只读，保存昵称后同步更新控制台
展示。邮箱是未验证的联系属性，不用于登录、身份合并或密码找回。

修改密码需要当前密码、符合服务端规则的新密码和确认输入；写请求携带账户
接口提供的 CSRF header。成功后清空账户状态并回到登录页，所有旧控制台登录
失效，已连接的网络设备与 API 密钥不受影响。无本地密码的第三方账户不展示
改密表单。另有平台人工核实的一次性密码重置入口；邮箱验证、自动邮件找回和 2FA 尚未接入此控制台。

安全中心使用人类账户会话接口，提供退出单个、其他或全部控制台登录。
“其他”保留当前浏览器，“全部”成功后清空账户状态并回到登录页；所有写请求
携带会话列表提供的 CSRF header，并显示确认、执行中与失败状态。
活动登录优先展示为手机卡片，包含来源 IP、客户端自报浏览器 / 系统、登录、最近
活动和到期时间；来源未知就明示未记录，不猜地点或硬件。独立「登录记录」默认
收起、按页读取，可刷新 / 重试；区分旧记录和继承来源的会话轮换，不随过期
Session 清理而丢失。失败保留上次成功页且明确提示，不把错误当空历史。
活动按分钟记录，不代表实时在线，不延长过期时间。服务端升级与保留边界以
[登录记录说明](https://github.com/xunara-net/xunara-server/blob/main/docs/account-login-history.md)为准。

个人设置的「个人数据导出」默认折叠：本人账户安全资料 JSON 或成功登录记录 CSV，
可选择日期并明确确认保管责任。等待可取消，错误 / 超限不生成文件，离页取消，
Blob URL 及时清理；私人内容不入浏览器持久存储。日期按浏览器时区包含结束当天，
仅筛选历史；旧服务端明确提示升级。白名单、限额、CSV 前缀、准备审计及尚未交付
的网络导出以[服务端说明](https://github.com/xunara-net/xunara-server/blob/main/docs/account-security-export.md)为准。

网络安全概览展示设备审批、密钥到期、策略和中继配置状态，以及中文安全提示，
不再向普通用户输出原始 JSON。读取失败单独报错；未发现提示不等于安全认证，
已配置中继区域也不等于实时健康。退出登录不修改密码或撤销 API Key。

通行密钥已接入登录页与安全中心：添加自定义名称、读取创建/使用时间及删除，
复用服务端 WebAuthn 验证和持久化挑战，不维护另一套身份逻辑。浏览器交互可取消，
列表或写入失败明确报错，删除前提示保留其他登录方式；删除不自动退出已有登录。
该功能需要服务端为当前租户启用 WebAuthn，并通过固定 HTTPS 域名访问；HTTP
公网调试站点只展示不可用原因，localhost 开发环境除外。

顶部菜单退出与安全中心使用相同账户撤销 API，不再使用旧会话接口或转换器。
网络/服务端失败时保留 UI 登录态并允许重试；成功或服务端已确认过期后才清理状态。
后端旧地址的渐进迁移说明见
[账户接口迁移](https://github.com/xunara-net/xunara-server/blob/main/README.md#account-api-migration)。
密码、通行密钥和第三方登录后回到官方客户端的设备授权、SSH 检查或旧控制台书签时，
使用完整浏览器导航，避免被 SPA 的“页面不存在”路由截获；外部回跳地址不接受。
第三方按钮只导航到提供方列表返回的本站认证 API，并携带安全回跳目标。旧
`/login?provider=…` 书签只转接已配置提供方，不将查询值作为任意跳转地址。

成员页面新增所有者专用邀请面板：按角色和有效期创建、读取状态、确认撤销，
取消/写入失败保留记录，读取失败不假装没有邀请。明文代码只在创建弹窗展示，
关闭/离开页面即清除，不进 URL、浏览器存储或列表；注册页地址与代码分开发送。
成员与管理员不能管理邀请，服务 API Key 不能代替人类会话。注册时由服务端再次
核验成员额度并原子提交，不由前端人数判断放行。当前角色下拉只提供服务端已支持
的 owner/admin/member，Viewer/Network Admin 不作为已实现能力展示。

## 部署

成员角色编辑仅向所有者开放，与服务端授权一致；修改需确认，取消/失败保留原角色，
最后一名所有者不能直接降级。成员读取失败明确报错，不显示成空网络。

路由页分别读取并展示路由、出口、托管中继和 DERP 配置。单项失败标为未知并允许
刷新，不能把故障当作零资源或“已配置”。托管列表读取真实注册记录，不再混用
客户端 Peer Relay 策略；静态公共 DERP 不在注册列表内。未提供自定义 DERP map
不等于没有中继，心跳上报也不等于客户端的实际连接路径。

启动时无法读取登录状态或返回格式不完整时，控制台显示「暂时无法确认登录」
和重试入口，不把故障当成匿名、不丢失当前页面地址，也不挂载受保护的账户功能。
恢复后重新读取持久会话；真正未登录或服务端已确认失效时才跳转登录页。
登录方式加载时不猜测开启密码登录；配置 503 或结构不完整时隐藏登录 / 注册入口、
保留回跳地址并提供「重试登录配置」。恢复后才按服务端确认的初始化、注册和
提供方策略渲染；第三方起始链接及自助注册地址必须是已知的本站 API。
隔离浏览器回归与运行方法见
[超管集成验收](https://github.com/xunara-net/xunara-admin/blob/main/README.md#浏览器集成验收)。

推荐由 `xunara-deploy` 的 nginx 托管 `dist/`，并把 `/api`、`/key`、`/ts2021`、
`/derp`、`/health` 反向代理到 `xunara-server`，保证同源（会话 Cookie 与 CSRF
模型依赖同源）。

## MagicDNS 与第三方账号

DNS 页面在网络未初始化时提供明确的「启用 MagicDNS」确认操作，免费套餐也可以
使用设备名称和开关，其他 DNS 设置仍遵守套餐权限。初始化不改变 IP 或设备身份，
内部域名保持稳定；不是公网域名或公网证书服务。

安全中心增加第三方账号绑定与解绑，服务端确认仍保留可用登录方法后才可解绑。
没有提供方配置或读取失败时明确提示，不宣称已接入真实 OIDC。邀请注册页支持密码
或已配置的 OIDC；邀请码只经 POST 正文，旧 URL 参数不再被读取。

需搭配 [服务端账户入门版本](https://github.com/xunara-net/xunara-server/blob/main/docs/account-onboarding-and-magicdns.md)，
先升级服务端再部署 Web。回调、凭据文件、迁移与未实现边界以服务端文档为准。

## 仓库关系

设备列表/详情「有效期设置」支持 1/7/30/90/180 天、指定本地日期时间、永不
过期和立即过期；已过期设备可显式临时续期 30 分钟，在窗口内重新认证或
调整有效期。紧凑弹窗共用、手机页脚保持可见，修改选择后必须重新确认。
服务器时间、持久权限和身份/有效期 CAS 为准；失败后手动读取最新状态，
不自动重试、不让成员写入。不改变租户默认认证周期，设备密钥与 Token TTL
独立。接口与原子审计契约以[服务端手册](https://github.com/xunara-net/xunara-server/blob/main/docs/device-enrollment.md)为准；
时区/DST、参数与响应确认单测见 `src/utils/device-expiry.test.ts` 和
`src/api/device-enrollment.test.ts`，真实 API/移动端见共享浏览器验收脚本。

上述设备功能需要先升级[服务端事务接入版本](https://github.com/xunara-net/xunara-server/blob/main/docs/device-enrollment.md)。旧 Auth Key Cookie 写入新增 CSRF，Web 从服务端读取当前权限/额度；不把未知权限当作可以签发。Linux 命令保留 Bash pipefail，下载/安装失败不继续接入，执行使用隔离 mock 安装/CLI，Windows/macOS 未做现场执行证明。验证入口为 `npm ci && npm run typecheck && npm test && npm run build`（仓库根目录，Node 22），共享真实 API/剪贴板/手机回归见 `scripts/device-enrollment-browser-smoke.cjs`，由兄弟 Admin 仓库浏览器验收启动；不在正式站试写设备。交互与安全取舍见[简化接入提案](https://github.com/xunara-net/xunara-server/blob/main/docs/proposals/2026-10-12-simplified-device-enrollment.md)。

| 仓库 | 职责 |
| --- | --- |
| `xunara-web` | 用户控制台（本仓库） |
| `xunara-admin` | 平台超级管理员后台 |
| `xunara-server` | 控制面 + 产品后端 + Core API |
| `xunara-relay` | 中继（DERP/STUN） |
| `xunara-deploy` | 部署与编排 |
| `xunara-docs` | 规范与文档 |
