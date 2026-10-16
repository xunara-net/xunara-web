const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

process.umask(0o077);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xunara-sharing-smoke-'));
const password = crypto.randomBytes(24).toString('base64url');
const platformToken = crypto.randomBytes(32).toString('base64url');
const stages = [], errors = [];
let daemon, proxy, browser, origin, control;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function mark(stage) { stages.push(stage); console.log(JSON.stringify({ stage })); }
async function freePort() {
  const listener = net.createServer(); await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise((resolve) => listener.close(resolve)); return port;
}
function backend(endpoint, method = 'GET', content, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(control + endpoint, { method, headers: { Host: new URL(origin).host, ...headers } }, (response) => {
      let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body }));
    }); request.on('error', reject); request.end(content);
  });
}
function serve(request, response) {
  if (/^\/(api|t\/[^/]+\/api|setup|health|version)(\/|\?|$)/.test(request.url)) {
    const upstream = http.request(control + request.url, { method: request.method, headers: request.headers }, (result) => { response.writeHead(result.statusCode, result.headers); result.pipe(response); });
    upstream.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(upstream); return;
  }
  const pathname = new URL(request.url, origin).pathname;
  const relative = pathname.replace(/^\/t\/[^/]+/, '');
  const asset = path.resolve(__dirname, '../dist', relative.replace(/^\//, ''));
  const file = relative.startsWith('/assets/') && asset.startsWith(path.resolve(__dirname, '../dist') + path.sep) && fs.existsSync(asset) ? asset : path.resolve(__dirname, '../dist/index.html');
  response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); fs.createReadStream(file).pipe(response);
}
async function signup(login) {
  const context = await browser.newContext();
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.name));
  await page.goto(origin + '/register'); await page.getByLabel('登录名', { exact: true }).fill(login); await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '免费创建账户', exact: true }).click(); await page.waitForURL(origin + '/t/' + login + '/dashboard'); return page;
}
async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); }
async function browserJSON(page, endpoint, method = 'GET', headers = {}) {
  return page.evaluate(async (input) => { const response = await fetch(input.endpoint, { method: input.method, headers: input.headers }); return { status: response.status, payload: await response.json() }; }, { endpoint, method, headers });
}
function publicKey(prefix) { return prefix + crypto.generateKeyPairSync('x25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'); }
async function main() {
  assert.ok(process.env.SMOKE_XUNARAD && fs.existsSync(process.env.SMOKE_XUNARAD));
  const key = path.join(directory, 'key.pem'), cert = path.join(directory, 'cert.pem');
  assert.equal(spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=sharing.test', '-addext', 'subjectAltName=DNS:sharing.test'], { stdio: 'ignore' }).status, 0);
  const certificate = fs.readFileSync(cert), spki = crypto.createHash('sha256').update(new crypto.X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  proxy = https.createServer({ key: fs.readFileSync(key), cert: certificate }, serve); await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  origin = `https://sharing.test:${proxy.address().port}`; control = `http://127.0.0.1:${await freePort()}`;
  const config = path.join(directory, 'orgs.json');
  fs.writeFileSync(config, JSON.stringify({ organizations: [{ id: 'portal', name: '分享隔离验收', domains: ['sharing.test'], state_dir: path.join(directory, 'portal'), server_url: origin, registration: 'open' }], self_service: { site: 'portal', console_url: origin, domain_suffix: 'unreachable.invalid', plan: 'free', native_gateway: true } }));
  const log = fs.openSync(path.join(directory, 'daemon.log'), 'a', 0o600);
  daemon = spawn(process.env.SMOKE_XUNARAD, ['-listen', new URL(control).host, '-grpc-listen', '127.0.0.1:0', '-org-config', config, '-platform-state-dir', directory, '-plans', 'builtin', '-network-pool', '100.100.0.0/16', '-log-level', 'error'], { env: { ...process.env, XUNARA_PLATFORM_ADMIN_TOKEN: platformToken }, stdio: ['ignore', log, log] }); fs.closeSync(log);
  for (let attempt = 0; attempt < 100; attempt++) { try { if ((await backend('/health')).status === 200) break; } catch {} assert.equal(daemon.exitCode, null); await delay(100); }
  const setup = await backend('/api/v1/auth/setup'); const csrf = JSON.parse(setup.body).csrf_token; assert.ok(csrf);
  assert.equal((await backend('/api/v1/auth/setup', 'POST', JSON.stringify({ token: fs.readFileSync(path.join(directory, 'portal/setup-token'), 'utf8').trim(), login: 'portal-owner', password, confirm: password }), { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf })).status, 201);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BINARY, headless: true, args: ['--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP sharing.test 127.0.0.1', '--ignore-certificate-errors-spki-list=' + spki] });
  const sender = await signup('share-sender'), recipient = await signup('share-recipient'), outsider = await signup('share-outsider');
  mark('real-account-inboxes-start-empty');
  await recipient.goto(origin + '/t/share-recipient/shares'); await recipient.getByText('还没有收到设备分享', { exact: true }).waitFor();
  const allocation = await browserJSON(sender, '/t/share-sender/api/v2/network/addresses'); assert.equal(allocation.status, 200);
  const prefix = allocation.payload.ipv4_cidr.split('/')[0].split('.'); prefix[3] = '10';
  const database = new DatabaseSync(path.join(directory, 'orgs/share-sender/state.db'));
  try {
    database.exec('PRAGMA busy_timeout=5000');
    // 仅在临时验收目录构造已注册节点；实际官方 Noise 与包过滤兼容由服务端集成测试验证。
    database.prepare('INSERT INTO nodes(id,stable_id,machine_key,node_key,disco_key,user_id,hostname,ipv4,ipv6,created,method,hostinfo) VALUES (1,?,?,?,?,1,?,?,?,?,?,?)').run('browser-share-node', publicKey('mkey:'), publicKey('nodekey:'), publicKey('discokey:'), 'sharing-laptop', prefix.join('.'), 'fd7a:115c:a1e0::10', BigInt(Date.now()) * 1000000n, 'authkey', JSON.stringify({ Hostname: 'sharing-laptop', OS: 'linux' }));
  } finally { database.close(); }
  mark('device-row-opens-mobile-sharing-dialog-with-no-network-id-or-token');
  await sender.goto(origin + '/t/share-sender/devices'); await sender.getByRole('button', { name: '分享 sharing-laptop', exact: true }).click();
  let dialog = sender.getByRole('dialog', { name: '分享设备', exact: true }); await dialog.getByLabel('对方用户名', { exact: true }).fill('share-recipient');
  for (const width of [320, 390, 768, 1440]) { await sender.setViewportSize({ width, height: 844 }); await noOverflow(sender); const bounds = await dialog.getByRole('button', { name: '发送分享邀请', exact: true }).boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844); }
  await dialog.getByRole('button', { name: '发送分享邀请', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  mark('recipient-confirms-and-sees-only-masquerade-addresses');
  await recipient.getByRole('button', { name: '刷新分享', exact: true }).click(); await recipient.getByRole('button', { name: '接受分享', exact: true }).waitFor();
  recipient.on('dialog', (confirmation) => confirmation.accept()); await recipient.getByRole('button', { name: '接受分享', exact: true }).click();
  await recipient.getByText('共享 IPv4', { exact: true }).waitFor(); assert.equal(await recipient.getByText(prefix.join('.'), { exact: true }).count(), 0);
  assert.equal(await recipient.getByRole('button', { name: '分享设备', exact: true }).count(), 0);
  await recipient.setViewportSize({ width: 390, height: 844 }); await noOverflow(recipient);
  if (process.env.SMOKE_SCREENSHOT_DIR) { fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true, mode: 0o700 }); await recipient.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'device-sharing-mobile.png'), fullPage: true }); }
  await outsider.goto(origin + '/t/share-outsider/shares'); await outsider.getByText('还没有收到设备分享', { exact: true }).waitFor();
  const incoming = await browserJSON(recipient, '/t/share-recipient/api/v2/device-shares'); const current = incoming.payload.items[0];
  const outsiderMeta = await browserJSON(outsider, '/t/share-outsider/api/v2/device-shares');
  assert.equal((await browserJSON(outsider, '/t/share-outsider/api/v2/device-shares/' + current.id + '/accept', 'POST', { 'X-CSRF-Token': outsiderMeta.payload.csrf_token })).status, 404);
  mark('sender-can-revoke-and-recipient-loses-shared-addresses');
  await sender.goto(origin + '/t/share-sender/shares'); await sender.getByRole('button', { name: '我分享的', exact: true }).click(); await sender.getByText('share-recipient', { exact: true }).waitFor();
  sender.on('dialog', (confirmation) => confirmation.accept()); await sender.getByRole('button', { name: '撤销分享', exact: true }).click(); await sender.locator('.share-card').getByText('已撤销', { exact: true }).waitFor();
  await recipient.getByRole('button', { name: '刷新分享', exact: true }).click(); await recipient.locator('.share-card').getByText('已撤销', { exact: true }).waitFor(); assert.equal(await recipient.getByText('共享 IPv4', { exact: true }).count(), 0);
  mark('detail-sharing-unknown-write-requires-explicit-refresh-and-no-auto-retry');
  await sender.goto(origin + '/t/share-sender/devices/1'); await sender.getByRole('button', { name: '分享设备', exact: true }).click(); dialog = sender.getByRole('dialog', { name: '分享设备', exact: true });
  await dialog.getByLabel('对方用户名', { exact: true }).fill('share-recipient');
  let mutations = 0;
  const pattern = '**/api/v2/device-shares';
  await sender.route(pattern, (route) => { if (route.request().method() === 'POST') { mutations++; route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"SHARES_UNAVAILABLE: injected failure"}' }); } else route.continue(); });
  await dialog.getByRole('button', { name: '发送分享邀请', exact: true }).click(); await dialog.getByRole('alert').waitFor(); await delay(350);
  assert.equal(mutations, 1); assert.equal(await dialog.getByRole('button', { name: '发送分享邀请', exact: true }).isDisabled(), true);
  await sender.unroute(pattern); await dialog.getByRole('button', { name: '刷新分享权限', exact: true }).click();
  await dialog.getByRole('button', { name: '发送分享邀请', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  mark('recipient-can-reject-new-invitation-and-mobile-sidebar-is-collapsible');
  await recipient.getByRole('button', { name: '刷新分享', exact: true }).click(); await recipient.getByRole('button', { name: '拒绝', exact: true }).click(); await recipient.locator('.share-card').getByText('已拒绝', { exact: true }).waitFor();
  await recipient.getByRole('button', { name: '打开菜单', exact: true }).click(); await recipient.locator('#console-navigation').getByRole('link', { name: '设备分享', exact: true }).click();
  assert.equal(await recipient.locator('.drawer-backdrop').count(), 0); await noOverflow(recipient);
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, stages: stages.length, viewport: '320/390/768/1440', production_changed: false }));
}
main().catch((failure) => { fs.writeFileSync(path.join(directory, 'failure.log'), failure.stack); console.error(JSON.stringify({ passed: false, stage: stages.at(-1) || 'startup', error: failure.name })); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); if (daemon) { daemon.kill('SIGTERM'); await new Promise((resolve) => { daemon.once('exit', resolve); setTimeout(resolve, 5000); }); }
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  if (process.exitCode) console.error('Private fixture diagnostics retained at ' + directory); else fs.rmSync(directory, { recursive: true, force: true });
});
