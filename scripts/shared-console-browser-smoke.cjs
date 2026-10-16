const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

process.umask(0o077);
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'xunara-shared-console-smoke-'));
const dist = path.resolve(__dirname, '../dist');
const password = crypto.randomBytes(24).toString('base64url');
const platformToken = crypto.randomBytes(32).toString('base64url');
const errors = [], completed = [];
const nativeGateway = process.env.SMOKE_NATIVE_GATEWAY === '1';
let daemon, browser, proxy, origin, control, stage = 'startup';
const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
function mark(value) { stage = value; completed.push(value); console.log(JSON.stringify({ stage })); }
async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
function backend(endpoint, method = 'GET', body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(control + endpoint, { method, headers: { Host: new URL(origin).host,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders } }, (response) => {
      let text = '';
      response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text, json: () => JSON.parse(text) }));
    });
    request.setTimeout(15000, () => request.destroy(new Error('local fixture timeout')));
    request.on('error', reject); request.end(body);
  });
}
function serve(request, response) {
  const pathname = new URL(request.url, origin).pathname;
  if (pathname.startsWith('/api/') || pathname === '/health' || /^\/console(?:\/|$)/.test(pathname) || pathname === '/ui/prefs' || /^\/t\/[^/]+\/(?:api\/|oidc\/|oauth2\/|console(?:\/|$)|ui\/prefs$|login\/?$)/.test(pathname)) {
    const upstream = http.request(control + request.url, { method: request.method, headers: request.headers }, (result) => {
      response.writeHead(result.statusCode, result.headers); result.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream); return;
  }
  if (pathname === '/network-check.py') { response.writeHead(410); response.end(); return; }
  const asset = pathname.startsWith('/assets/') || pathname === '/network-check.sh' ? path.resolve(dist, '.' + pathname) : path.join(dist, 'index.html');
  if (!asset.startsWith(dist + path.sep) || !fs.existsSync(asset)) { response.writeHead(404); response.end(); return; }
  const extension = path.extname(asset);
  response.writeHead(200, { 'Content-Type': extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : extension === '.sh' ? 'text/plain' : 'text/html; charset=utf-8' });
  fs.createReadStream(asset).pipe(response);
}
async function snapshot(page, prefix = '') {
  return page.evaluate(async (target) => { const response = await fetch(target + '/api/v1/auth/session'); return response.json(); }, prefix);
}
async function logout(page) {
  await page.locator('.topbar .btn').last().click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/login');
}
async function main() {
  assert.ok(process.env.SMOKE_XUNARAD && fs.existsSync(process.env.SMOKE_XUNARAD));
  const key = path.join(state, 'key.pem'), certificateFile = path.join(state, 'cert.pem');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', certificateFile,
    '-subj', '/CN=control.example.test', '-addext', 'subjectAltName=DNS:control.example.test'], { stdio: 'ignore' });
  assert.equal(generated.status, 0);
  const certificate = fs.readFileSync(certificateFile);
  const spki = crypto.createHash('sha256').update(new crypto.X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  proxy = https.createServer({ key: fs.readFileSync(key), cert: certificate }, serve);
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  origin = `https://control.example.test:${proxy.address().port}`;
  control = `http://127.0.0.1:${await unusedPort()}`;
  const configuration = path.join(state, 'organizations.json');
  fs.writeFileSync(configuration, JSON.stringify({ organizations: [{ id: 'portal', name: '单证书注册验收', domains: ['control.example.test'],
    server_url: origin, state_dir: path.join(state, 'portal'), registration: 'open' }],
    self_service: { site: 'portal', domain_suffix: 'unreachable.invalid', console_url: origin, plan: 'free', native_gateway: nativeGateway } }));
  const log = fs.openSync(path.join(state, 'daemon.log'), 'a', 0o600);
  daemon = spawn(process.env.SMOKE_XUNARAD, ['-listen', new URL(control).host, '-grpc-listen', '127.0.0.1:0', '-org-config', configuration,
    '-platform-state-dir', state, '-plans', 'builtin', '-network-pool', '100.100.0.0/16', '-log-level', 'error'],
    { env: { ...process.env, XUNARA_PLATFORM_ADMIN_TOKEN: platformToken }, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await backend('/health')).status === 200) break; } catch {}
    if (daemon.exitCode !== null) throw new Error('isolated daemon exited');
    await sleep(100);
  }
  const setup = await backend('/setup');
  const csrf = /name="_csrf" value="([^"]+)"/.exec(setup.text)?.[1];
  assert.ok(csrf);
  const initialized = await backend('/setup', 'POST', new URLSearchParams({ token: fs.readFileSync(path.join(state, 'portal/setup-token'), 'utf8').trim(),
    _csrf: csrf, login: 'portal-owner', password, confirm: password }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(initialized.status, 302);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BINARY || undefined, headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP control.example.test 127.0.0.1', '--ignore-certificate-errors-spki-list=' + spki] });
  const context = await browser.newContext(), page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.name));
  mark('signup-handoff-with-no-wildcard-dns-or-certificate');
  await page.goto(origin + '/register');
  await page.getByLabel('登录名', { exact: true }).fill('shared-owner');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '免费创建账户', exact: true }).click();
  await page.waitForURL(origin + '/t/shared-owner/dashboard');
  assert.equal((await snapshot(page, '/t/shared-owner')).tenant.organization_id, 'shared-owner');
  assert.equal((await snapshot(page)).authenticated, false);
  const cookies = await context.cookies();
  assert.ok(cookies.some((cookie) => cookie.name === 'xunara_session_tenant_shared-owner' && cookie.path === '/t/shared-owner/' && cookie.httpOnly && cookie.secure));
  mark('retired-console-bookmarks-reach-new-security-without-html-fallback');
  const sshPattern = '**/t/shared-owner/api/v2/ssh-check/sessions*';
  const actualHistory = page.waitForResponse((response) => response.url().includes('/api/v2/ssh-check/sessions'));
  await page.goto(origin + '/t/shared-owner/console/ssh-check?state=pending&token=discarded-fixture');
  await page.waitForURL(origin + '/t/shared-owner/security#ssh-check');
  assert.equal((await actualHistory).status(), 200);
  const sshPanel = page.locator('#ssh-check');
  await sshPanel.getByText('此页没有符合条件的审批记录；已清理的短期记录不会补录。', { exact: true }).waitFor();
  const sshHeading = await sshPanel.locator('summary').boundingBox();
  assert.ok(sshHeading && sshHeading.y >= 0 && sshHeading.y < 844);
  assert.equal(await page.getByText('Xunara console', { exact: false }).count(), 0);
  assert.equal(await page.evaluate(async () => (await fetch('/t/shared-owner/console/machines/old/delete', { method: 'POST', redirect: 'manual' })).status), 410);
  mark('ssh-history-ui-fixture-status-pagination-errors-and-mobile');
  // 记录内容只在隔离浏览器注入；真实 API、租户路由及空记录已经单独验证。
  const historyRecord = { id: 'fixture-check', state: 'pending', verdict: 'pending', src: { nodeId: 1, hostname: '来源设备-很长的中文设备名称-SSH-检查' },
    dst: { nodeId: 2 }, localUser: 'root', createdAt: '2026-10-16T02:00:00Z', expiresAt: '2026-10-16T02:15:00Z' };
  let historyFailure = false;
  await page.route(sshPattern, (route) => {
    assert.equal(route.request().method(), 'GET');
    if (historyFailure) return route.fulfill({ status: 503, contentType: 'application/json', json: { error: '隔离验收读取失败' } });
    const query = new URL(route.request().url()).searchParams;
    const consumed = query.has('cursor') || query.get('state') === 'consumed';
    return route.fulfill({ status: 200, contentType: 'application/json', json: {
      items: [{ ...historyRecord, ...(consumed ? { state: 'consumed', verdict: 'reject', decidedAt: historyRecord.createdAt, decidedBy: { userId: 3 }, consumedAt: historyRecord.expiresAt } : {}) }],
      nextCursor: consumed ? '' : 'fixture-next-page',
    } });
  });
  await sshPanel.getByRole('button', { name: '刷新记录', exact: true }).click();
  await sshPanel.getByText('待审批', { exact: true }).last().waitFor();
  await sshPanel.getByRole('button', { name: '下一页', exact: true }).click();
  await sshPanel.getByText('第 2 页', { exact: true }).waitFor();
  await sshPanel.getByText('拒绝 ·', { exact: false }).waitFor();
  await sshPanel.getByLabel('审批状态', { exact: true }).selectOption('consumed');
  await sshPanel.getByText('第 1 页', { exact: true }).waitFor();
  await sshPanel.getByText('账号 #3', { exact: true }).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  historyFailure = true;
  await sshPanel.getByRole('button', { name: '刷新记录', exact: true }).click();
  await sshPanel.getByRole('alert').getByText('隔离验收读取失败', { exact: false }).waitFor();
  assert.equal(await sshPanel.getByText('此页没有符合条件的审批记录；已清理的短期记录不会补录。', { exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await sshPanel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(state, 'ssh-history-mobile.png') });
  await page.unroute(sshPattern);
  const anonymous = await browser.newContext();
  const oldBookmark = await anonymous.newPage();
  await oldBookmark.goto(origin + '/console/ssh-check');
  assert.equal(new URL(oldBookmark.url()).pathname, '/login');
  assert.equal(new URL(oldBookmark.url()).searchParams.get('return_to'), '/security#ssh-check');
  await anonymous.close();
  await page.goto(origin + '/t/shared-owner/dashboard');
  mark('dashboard-uses-one-enrollment-dialog-without-legacy-inline-commands');
  await page.getByRole('button', { name: '添加第一台设备', exact: true }).waitFor();
  assert.equal(await page.getByText('三步把设备接进这个网络', { exact: true }).count(), 0);
  assert.equal(await page.locator('.snippet').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const firstDeviceBounds = await page.getByRole('button', { name: '添加第一台设备', exact: true }).boundingBox();
  assert.ok(firstDeviceBounds && firstDeviceBounds.y >= 0 && firstDeviceBounds.y + firstDeviceBounds.height <= 844);
  await page.screenshot({ path: path.join(state, 'dashboard-onboarding-mobile.png') });
  const initialKeys = await page.evaluate(async () => (await fetch('/t/shared-owner/api/v1/auth-keys')).json());
  await page.getByRole('button', { name: '添加第一台设备', exact: true }).click();
  const enrollmentDialog = page.getByRole('dialog', { name: '添加设备', exact: true });
  const nativeServer = nativeGateway ? origin : 'https://shared-owner.unreachable.invalid';
  await enrollmentDialog.getByLabel('设备安装命令', { exact: true }).waitFor();
  const nativeCommand = await enrollmentDialog.getByLabel('设备安装命令', { exact: true }).textContent();
  assert.ok(nativeCommand.includes('--login-server=' + JSON.stringify(nativeServer)));
  assert.equal(nativeCommand.includes('--login-server=' + JSON.stringify(origin)), nativeGateway);
  assert.equal(nativeCommand.includes('--auth-key='), false);
  const notice = enrollmentDialog.getByRole('note', { name: '设备接入地址说明', exact: true });
  if (nativeGateway) assert.ok((await notice.innerText()).includes('使用统一接入地址'));
  else {
    assert.ok((await notice.innerText()).includes(nativeServer));
    assert.ok((await notice.innerText()).includes('尚未检测设备地址的连通性'));
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const bounds = await enrollmentDialog.getByRole('button', { name: '复制命令', exact: true }).boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844);
  }
  await enrollmentDialog.getByLabel('设备平台', { exact: true }).selectOption('android');
  assert.equal(await enrollmentDialog.getByLabel('设备安装命令', { exact: true }).count(), 0);
  assert.equal(await enrollmentDialog.getByRole('button', { name: '复制控制面地址', exact: true }).count(), 1);
  assert.equal(await enrollmentDialog.locator('pre').textContent(), nativeServer);
  await enrollmentDialog.getByRole('button', { name: '关闭', exact: true }).click();
  const afterOpenKeys = await page.evaluate(async () => (await fetch('/t/shared-owner/api/v1/auth-keys')).json());
  assert.deepEqual(afterOpenKeys, initialKeys);
  mark('missing-path-or-portal-native-address-never-falls-back-or-mints-a-token');
  // 只在隔离浏览器注入读取故障；不改租户配置，不伪造 DNS / TLS 验收结果。
  let addressOverride;
  const overviewPattern = '**/t/shared-owner/api/v1/overview';
  const overviewSnapshot = await page.evaluate(async () => {
    const response = await fetch('/t/shared-owner/api/v1/overview');
    return { status: response.status, payload: await response.json() };
  });
  assert.equal(overviewSnapshot.status, 200);
  await page.route(overviewPattern, async (route) => {
    assert.equal(route.request().method(), 'GET');
    const payload = { ...overviewSnapshot.payload };
    delete payload.clientLoginUrl;
    payload.nativeGateway = false;
    if (addressOverride === undefined) delete payload.serverUrl;
    else payload.serverUrl = addressOverride;
    await route.fulfill({ status: 200, contentType: 'application/json', json: payload });
  });
  for (const invalid of [undefined, '', origin, origin + '/t/shared-owner']) {
    addressOverride = invalid;
    await page.getByRole('button', { name: '添加设备', exact: true }).click();
    await enrollmentDialog.getByRole('alert').waitFor();
    assert.equal(await enrollmentDialog.getByLabel('设备安装命令', { exact: true }).count(), 0);
    assert.equal(await enrollmentDialog.getByRole('button', { name: '复制命令', exact: true }).count(), 0);
    assert.equal(await enrollmentDialog.getByRole('button', { name: '生成一次性 Token', exact: true }).count(), 0);
    await enrollmentDialog.getByLabel('设备平台', { exact: true }).selectOption('android');
    assert.equal(await enrollmentDialog.getByRole('button', { name: '复制控制面地址', exact: true }).count(), 0);
    await enrollmentDialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.unroute(overviewPattern);
  assert.deepEqual(await page.evaluate(async () => (await fetch('/t/shared-owner/api/v1/auth-keys')).json()), initialKeys);
  await page.getByRole('button', { name: '添加设备', exact: true }).click();
  await enrollmentDialog.getByLabel('设备安装命令', { exact: true }).waitFor();
  await enrollmentDialog.getByRole('button', { name: '关闭', exact: true }).click();
  mark('pending-first-device-guidance-links-to-the-current-network');
  const pendingPattern = '**/t/shared-owner/api/v1/devices';
  await page.route(pendingPattern, (route) => route.fulfill({ status: 200, contentType: 'application/json', json: {
    devices: [{ id: 'isolated-pending', hostname: 'isolated-device', created: new Date().toISOString() }],
  } }));
  await page.reload();
  await page.getByRole('heading', { name: '已有设备等待审批', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '添加第一台设备', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: '查看待审批设备', exact: true }).getAttribute('href'), '/t/shared-owner/devices');
  await page.unroute(pendingPattern);
  await page.reload();
  await page.getByRole('button', { name: '添加第一台设备', exact: true }).waitFor();
  mark('duplicate-public-signup-rejected-without-a-second-workspace');
  const duplicateContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const duplicatePage = await duplicateContext.newPage();
  duplicatePage.on('pageerror', (error) => errors.push(error.name));
  await duplicatePage.goto(origin + '/register');
  await duplicatePage.getByLabel('登录名', { exact: true }).fill(' SHARED-OWNER ');
  await duplicatePage.getByLabel('密码', { exact: true }).fill(crypto.randomBytes(24).toString('base64url'));
  await duplicatePage.getByRole('button', { name: '免费创建账户', exact: true }).click();
  await duplicatePage.getByText(/该用户名已注册/).waitFor();
  assert.equal(new URL(duplicatePage.url()).pathname, '/register');
  const organizations = await backend('/api/platform/v1/organizations', 'GET', undefined, { Authorization: 'Bearer ' + platformToken });
  assert.equal(organizations.status, 200);
  assert.equal(organizations.json().organizations.filter((entry) => entry.id.startsWith('shared-owner')).length, 1);
  assert.equal(await duplicatePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await duplicateContext.close();
  mark('portal-login-identifies-account-after-signout');
  await logout(page);
  mark('legacy-existing-deleted-and-unknown-tenant-bookmarks-use-common-login');
  for (const tenant of ['shared-owner', 'deleted', 'gggg']) {
    await page.goto(origin + '/t/' + tenant + '/login');
    assert.equal(new URL(page.url()).pathname, '/login');
    await page.getByLabel('登录名', { exact: true }).waitFor();
  }
  mark('another-account-signs-in-from-the-old-workspace-bookmark-without-scope-selection');
  const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const otherPage = await otherContext.newPage();
  otherPage.on('pageerror', (error) => errors.push(error.name));
  await otherPage.goto(origin + '/register');
  await otherPage.getByLabel('登录名', { exact: true }).fill('shared-other');
  await otherPage.getByLabel('密码', { exact: true }).fill(password);
  await otherPage.getByRole('button', { name: '免费创建账户', exact: true }).click();
  await otherPage.waitForURL(origin + '/t/shared-other/dashboard');
  await logout(otherPage);
  await otherPage.goto(origin + '/t/shared-owner/login?return_to=' + encodeURIComponent('/t/shared-owner/network'));
  assert.equal(new URL(otherPage.url()).pathname, '/login');
  await otherPage.getByLabel('登录名', { exact: true }).fill('shared-other');
  await otherPage.getByLabel('密码', { exact: true }).fill(password);
  await otherPage.getByRole('button', { name: '登录', exact: true }).click();
  await otherPage.waitForURL(origin + '/t/shared-other/network');
  assert.equal((await snapshot(otherPage, '/t/shared-other')).tenant.organization_id, 'shared-other');
  assert.equal((await snapshot(otherPage, '/t/shared-owner')).authenticated, false);
  assert.equal(await otherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  mark('expired-workspace-session-does-not-pin-the-next-account');
  await logout(otherPage);
  await otherPage.goto(origin + '/t/shared-other/network');
  await otherPage.waitForURL((url) => url.pathname === '/login');
  await otherPage.getByLabel('登录名', { exact: true }).fill('shared-owner');
  await otherPage.getByLabel('密码', { exact: true }).fill(password);
  await otherPage.getByRole('button', { name: '登录', exact: true }).click();
  await otherPage.waitForURL(origin + '/t/shared-owner/network');
  assert.equal((await snapshot(otherPage, '/t/shared-owner')).tenant.organization_id, 'shared-owner');
  await logout(otherPage);
  await otherContext.close();
  mark('workspace-cookie-revoked-before-portal-relogin');
  await page.goto(origin + '/login');
  assert.equal(await page.getByLabel('网络标识', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('登录范围', { exact: true }).count(), 0);
  await page.getByLabel('登录名', { exact: true }).fill('shared-owner');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(origin + '/t/shared-owner/dashboard');
  mark('nested-core-pages-use-the-tenant-api-not-the-portal');
  for (const destination of ['devices', 'network', 'dns', 'permissions', 'relays']) {
    await page.goto(origin + '/t/shared-owner/' + destination);
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal((await snapshot(page, '/t/shared-owner')).authenticated, true);
  }
  mark('tenant-passkey-binds-and-signs-in-on-the-shared-rp');
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(origin + '/t/shared-owner/security');
  await page.getByLabel('密钥名称', { exact: true }).fill('共享入口验收');
  await page.getByRole('button', { name: '添加通行密钥', exact: true }).click();
  await page.getByText('通行密钥已添加，下次可使用设备锁屏验证登录。', { exact: true }).waitFor();
  await logout(page);
  assert.equal(await page.getByRole('button', { name: '使用通行密钥登录', exact: true }).isDisabled(), true);
  await page.getByLabel('登录名', { exact: true }).fill('shared-owner');
  await page.getByRole('button', { name: '使用通行密钥登录', exact: true }).click();
  await page.waitForURL(origin + '/t/shared-owner/dashboard');
  assert.equal((await snapshot(page, '/t/shared-owner')).session.auth_method, 'passkey');
  mark('multiple-pools-preview-confirmation-and-reload');
  const catalog = await backend('/api/platform/v1/plans', 'GET', undefined, { Authorization: 'Bearer ' + platformToken });
  assert.equal(catalog.status, 200);
  const configured = { ...catalog.json().plans.find((entry) => entry.id === 'free'), allow_custom_cidr: true };
  delete configured.default; delete configured.device_allowance;
  const savedPlan = await backend('/api/platform/v1/plans', 'POST', JSON.stringify(configured), { Authorization: 'Bearer ' + platformToken });
  assert.equal(savedPlan.status, 200);
  assert.equal(savedPlan.json().max_devices, 10);
  await page.goto(origin + '/t/shared-owner/network');
  await page.getByRole('button', { name: '修改分配网段', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '修改设备分配网段' });
  await dialog.getByLabel('IPv4 分配网段', { exact: true }).fill('100.101.50.0/24');
  await dialog.getByLabel('附加 IPv4 网段', { exact: true }).fill('192.168.60.0/24\n10.42.0.0/24');
  await dialog.getByRole('button', { name: '校验并预览', exact: true }).click();
  await dialog.getByRole('button', { name: '确认保存分配网段', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.reload();
  const pools = await page.evaluate(async () => (await fetch('/t/shared-owner/api/v2/network/addresses')).json());
  assert.deepEqual(pools.extra_ipv4_cidrs, ['10.42.0.0/24', '192.168.60.0/24']);
  mark('owner-selects-default-pool-with-preview-and-retains-the-original');
  await page.getByRole('button', { name: '将 192.168.60.0/24 设为默认网段', exact: true }).click();
  const selection = page.getByRole('dialog', { name: '设置默认网段', exact: true });
  assert.equal(await selection.getByLabel('IPv4 分配网段', { exact: true }).inputValue(), '192.168.60.0/24');
  assert.ok((await selection.getByLabel('附加 IPv4 网段', { exact: true }).inputValue()).includes('100.101.50.0/24'));
  assert.equal(await selection.getByRole('button', { name: '确认保存分配网段', exact: true }).count(), 0);
  await selection.getByRole('button', { name: '取消', exact: true }).click();
  const unchanged = await page.evaluate(async () => (await fetch('/t/shared-owner/api/v2/network/addresses')).json());
  assert.equal(unchanged.revision, pools.revision);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '将 192.168.60.0/24 设为默认网段', exact: true }).click();
  await selection.getByRole('button', { name: '校验并预览', exact: true }).click();
  await selection.getByRole('button', { name: '确认保存分配网段', exact: true }).click();
  await selection.waitFor({ state: 'hidden' });
  await page.reload();
  const changed = await page.evaluate(async () => (await fetch('/t/shared-owner/api/v2/network/addresses')).json());
  assert.equal(changed.ipv4_cidr, '192.168.60.0/24');
  assert.deepEqual(changed.extra_ipv4_cidrs, ['10.42.0.0/24', '100.101.50.0/24']);
  assert.ok(changed.revision > pools.revision);
  assert.equal(changed.desired_revision, changed.revision);
  assert.equal(changed.pending, false);
  mark('read-only-conflict-guide-checks-all-applied-pools-without-writing');
  await page.reload();
  const conflictHelp = page.locator('.network-conflict-help');
  assert.equal(await conflictHelp.getAttribute('open'), null);
  await conflictHelp.getByText('网段冲突检查与处理', { exact: true }).click();
  const readOnlyCommand = conflictHelp.getByLabel('只读网络冲突检查命令', { exact: true });
  await readOnlyCommand.waitFor();
  const text = await readOnlyCommand.textContent();
  for (const prefix of [changed.ipv4_cidr, ...changed.extra_ipv4_cidrs]) assert.ok(text.includes(JSON.stringify(prefix)));
  assert.equal(/sudo|tailscale (up|set)|auth-key|install\.sh|curl -k/.test(text), false);
  await conflictHelp.getByText('旧设备 IP 不会自动改变', { exact: false }).waitFor();
  await conflictHelp.getByText('换地址池或关闭 MagicDNS 不能保证解除冲突', { exact: false }).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  const writes = [];
  const watchWrite = (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && request.url().includes('/api/')) writes.push(request.method());
  };
  page.on('request', watchWrite);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await conflictHelp.getByRole('button', { name: '复制只读检查命令', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  page.off('request', watchWrite);
  assert.deepEqual(writes, []);
  const currentPools = await page.evaluate(async () => (await fetch('/t/shared-owner/api/v2/network/addresses')).json());
  assert.equal(currentPools.revision, changed.revision);
  mark('unknown-or-pending-pools-cannot-produce-a-conflict-check-command');
  const addressPattern = '**/t/shared-owner/api/v2/network/addresses';
  await page.route(addressPattern, (route) => route.fulfill({ status: 503, contentType: 'application/json', json: { error: '检查快照不可用（隔离验收）' } }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('地址配置读取失败：', { exact: false }).waitFor();
  assert.equal(await readOnlyCommand.count(), 0);
  assert.equal(await conflictHelp.getByRole('button', { name: '复制只读检查命令', exact: true }).isDisabled(), true);
  await page.unroute(addressPattern);
  await page.route(addressPattern, (route) => route.fulfill({ status: 200, contentType: 'application/json', json: { ...currentPools, pending: true } }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('尚未应用，设备仍从当前网段分配。', { exact: false }).waitFor();
  assert.equal(await readOnlyCommand.count(), 0);
  assert.equal(await conflictHelp.getByRole('button', { name: '复制只读检查命令', exact: true }).isDisabled(), true);
  await page.unroute(addressPattern);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await readOnlyCommand.waitFor();
  assert.equal(await readOnlyCommand.textContent(), text);
  await page.setViewportSize({ width: 390, height: 844 });
  await conflictHelp.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(state, 'network-conflict-help-mobile.png') });
  mark('phone-sidebar-and-dns-guard-download');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/t/shared-owner/network');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const script = await page.evaluate(async () => { const response = await fetch('/network-check.sh'); return { status: response.status, text: await response.text() }; });
  assert.equal(script.status, 200); assert.ok(script.text.startsWith('#!/bin/sh\n')); assert.ok(script.text.includes('100.100.100.100/32'));
  assert.equal(await page.evaluate(async () => (await fetch('/network-check.py')).status), 410);
  await page.screenshot({ path: path.join(state, 'shared-console-mobile.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: completed.length, javascriptErrors: 0, artifacts: state }));
}
main().catch(async (error) => {
  const pages = browser?.contexts().flatMap((context) => context.pages()) ?? [];
  await pages[0]?.screenshot({ path: path.join(state, 'failure.png') });
  console.error(JSON.stringify({ failedStage: stage, error: error.name, artifacts: state,
    pages: pages.map((page) => page.url()), locations: error.stack?.split('\n').filter((line) => line.includes(__filename)) }));
  process.exitCode = 1;
})
  .finally(async () => { await browser?.close(); daemon?.kill('SIGTERM'); await new Promise((resolve) => proxy ? proxy.close(resolve) : resolve()); });
