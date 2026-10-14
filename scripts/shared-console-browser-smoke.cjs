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
  if (pathname.startsWith('/api/') || pathname === '/health' || /^\/t\/[^/]+\/(?:api\/|oidc\/|oauth2\/)/.test(pathname)) {
    const upstream = http.request(control + request.url, { method: request.method, headers: request.headers }, (result) => {
      response.writeHead(result.statusCode, result.headers); result.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream); return;
  }
  const asset = pathname.startsWith('/assets/') || pathname === '/network-check.py' ? path.resolve(dist, '.' + pathname) : path.join(dist, 'index.html');
  if (!asset.startsWith(dist + path.sep) || !fs.existsSync(asset)) { response.writeHead(404); response.end(); return; }
  const extension = path.extname(asset);
  response.writeHead(200, { 'Content-Type': extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : extension === '.py' ? 'text/plain' : 'text/html; charset=utf-8' });
  fs.createReadStream(asset).pipe(response);
}
async function snapshot(page, prefix = '') {
  return page.evaluate(async (target) => { const response = await fetch(target + '/api/v1/auth/session'); return response.json(); }, prefix);
}
async function logout(page) {
  await page.locator('.topbar .btn').last().click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/login'));
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
    self_service: { site: 'portal', domain_suffix: 'unreachable.invalid', console_url: origin, plan: 'free' } }));
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
  mark('portal-login-selects-workspace-after-signout');
  await logout(page);
  mark('workspace-cookie-revoked-before-portal-relogin');
  await page.goto(origin + '/login');
  await page.getByLabel('网络标识', { exact: true }).fill('shared-owner');
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
  mark('phone-sidebar-and-dns-guard-download');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/t/shared-owner/network');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  const script = await page.evaluate(async () => { const response = await fetch('/network-check.py'); return { status: response.status, text: await response.text() }; });
  assert.equal(script.status, 200); assert.ok(script.text.includes('100.100.100.100/32'));
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
