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
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xunara-browser-authorization-'));
const dist = path.resolve(__dirname, '../dist');
const password = crypto.randomBytes(24).toString('base64url');
const platformToken = crypto.randomBytes(32).toString('base64url');
const errors = [], completed = [];
let daemon, browser, proxy, origin, control, stage = 'startup';
function mark(value) { stage = value; completed.push(value); console.log(JSON.stringify({ stage })); }
const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
function backend(endpoint) {
  return new Promise((resolve, reject) => {
    const request = http.get(control + endpoint, { headers: { Host: new URL(origin).host } }, (response) => {
      let text = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.setTimeout(10000, () => request.destroy(new Error('fixture request timeout')));
    request.on('error', reject);
  });
}
function serve(request, response) {
  const pathname = new URL(request.url, origin).pathname;
  if (/^\/(?:api\/|health$|key$|console(?:\/|$)|t\/[^/]+\/(?:api\/|console(?:\/|$)|login\/?$))/.test(pathname)) {
    const upstream = http.request(control + request.url, { method: request.method, headers: request.headers }, (result) => {
      response.writeHead(result.statusCode, result.headers); result.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream); return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(410); response.end(); return; }
  const asset = pathname.startsWith('/assets/') ? path.resolve(dist, '.' + pathname) : path.join(dist, 'index.html');
  if (!asset.startsWith(dist + path.sep) || !fs.existsSync(asset)) { response.writeHead(404); response.end(); return; }
  const extension = path.extname(asset);
  response.writeHead(200, { 'Content-Type': extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  fs.createReadStream(asset).pipe(response);
}
async function contextPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (failure) => errors.push(failure.name));
  return page;
}
async function browserJSON(page, endpoint, method = 'GET', csrf) {
  return page.evaluate(async ({ endpoint, method, csrf }) => {
    const response = await fetch(endpoint, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: method === 'GET' ? undefined : '{}' });
    return { status: response.status, payload: await response.json() };
  }, { endpoint, method, csrf });
}
async function signup(login) {
  const page = await contextPage();
  await page.goto(origin + '/register');
  await page.getByLabel('登录名', { exact: true }).fill(login);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '免费创建账户', exact: true }).click();
  await page.waitForURL(origin + '/t/' + login + '/dashboard');
  return page;
}
function publicKey(prefix) {
  const value = crypto.generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x;
  return prefix + Buffer.from(value, 'base64url').toString('hex');
}
function seedFlow() {
  const id = crypto.randomBytes(16).toString('hex'), machine = publicKey('mkey:'), node = publicKey('nodekey:');
  const now = BigInt(Date.now()) * 1000000n;
  const database = new DatabaseSync(path.join(directory, 'platform.db'));
  database.prepare('INSERT INTO native_device_flows (id,machine_key,node_key,registration,org_id,noise_key,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, machine, node, JSON.stringify({ Version: 148, NodeKey: node, Hostinfo: { Hostname: 'modern-client', OS: 'linux' } }), '', '', now, now + 900000000000n);
  database.close();
  return id;
}
async function selectAccount(page, flow) {
  await page.goto(origin + '/device/' + flow);
  await page.getByRole('heading', { name: '登录并接入设备', exact: true }).waitFor();
  await page.getByLabel('登录名', { exact: true }).fill('browser-alice');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录并继续', exact: true }).click();
  await page.waitForURL(new RegExp('/t/browser-alice/register/[a-zA-Z0-9_-]+$'));
  await page.getByRole('button', { name: '确认接入', exact: true }).waitFor();
  return new URL(page.url()).pathname.split('/').pop();
}

async function main() {
  assert.ok(process.env.SMOKE_XUNARAD && fs.existsSync(process.env.SMOKE_XUNARAD));
  const key = path.join(directory, 'key.pem'), cert = path.join(directory, 'cert.pem');
  assert.equal(spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=authorization.test', '-addext', 'subjectAltName=DNS:authorization.test'], { stdio: 'ignore' }).status, 0);
  const certificate = fs.readFileSync(cert), spki = crypto.createHash('sha256').update(new crypto.X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  proxy = https.createServer({ key: fs.readFileSync(key), cert: certificate }, serve);
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  origin = 'https://authorization.test:' + proxy.address().port;
  control = 'http://127.0.0.1:' + await freePort();
  const config = path.join(directory, 'orgs.json');
  fs.writeFileSync(config, JSON.stringify({
    organizations: [{ id: 'portal', domains: ['authorization.test'], state_dir: path.join(directory, 'portal'), server_url: origin, registration: 'open' }],
    self_service: { site: 'portal', console_url: origin, domain_suffix: 'unreachable.invalid', native_gateway: true },
  }));
  const log = fs.openSync(path.join(directory, 'daemon.log'), 'a', 0o600);
  daemon = spawn(process.env.SMOKE_XUNARAD, ['-listen', new URL(control).host, '-grpc-listen', '127.0.0.1:0', '-org-config', config, '-platform-state-dir', directory, '-plans', 'builtin', '-network-pool', '100.100.0.0/16', '-log-level', 'error'], { env: { ...process.env, XUNARA_PLATFORM_ADMIN_TOKEN: platformToken }, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await backend('/health')).status === 200) break; } catch {}
    assert.equal(daemon.exitCode, null); await delay(100);
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BINARY, headless: true, args: ['--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP authorization.test 127.0.0.1', '--ignore-certificate-errors-spki-list=' + spki] });
  mark('setup-uses-modern-vue-and-json-proof-without-legacy-form');
  const owner = await contextPage();
  await owner.goto(origin + '/setup');
  await owner.getByLabel('一次性初始化令牌', { exact: true }).fill(fs.readFileSync(path.join(directory, 'portal/setup-token'), 'utf8').trim());
  await owner.getByLabel('管理员登录名', { exact: true }).fill('portal-owner');
  await owner.getByLabel('新密码', { exact: true }).fill(password);
  await owner.getByLabel('再次输入密码', { exact: true }).fill(password);
  await owner.getByRole('button', { name: '完成初始化', exact: true }).click();
  await owner.waitForURL(origin + '/dashboard');
  assert.equal(fs.existsSync(path.join(directory, 'portal/setup-token')), false);
  const alice = await signup('browser-alice'), bob = await signup('browser-bob');
  mark('native-entry-never-adopts-existing-platform-owner-session');
  const flow = seedFlow();
  await owner.goto(origin + '/device/' + flow);
  await owner.getByLabel('登录名', { exact: true }).waitFor();
  assert.equal(await owner.getByRole('button', { name: '确认接入', exact: true }).count(), 0);
  const authID = await selectAccount(owner, flow);
  const approvalURL = owner.url();
  assert.equal((await browserJSON(owner, '/api/v1/machines')).payload.machines.length, 0);
  await owner.getByRole('button', { name: '确认接入', exact: true }).click();
  await owner.getByRole('heading', { name: '设备已获授权', exact: true }).waitFor();
  assert.equal((await browserJSON(owner, '/t/browser-alice/api/v1/machines')).payload.machines.length, 1);
  assert.equal((await browserJSON(bob, '/t/browser-bob/api/v1/machines')).payload.machines.length, 0);
  mark('approval-result-and-denial-use-new-ui-and-durable-api');
  await owner.reload(); await owner.getByRole('heading', { name: '设备已获授权', exact: true }).waitFor();
  await bob.goto(approvalURL);
  await bob.getByRole('link', { name: '登录并继续', exact: true }).waitFor();
  await selectAccount(alice, seedFlow());
  await alice.getByRole('button', { name: '拒绝', exact: true }).click();
  await alice.getByRole('heading', { name: '已拒绝此次请求', exact: true }).waitFor();
  mark('unknown-write-never-retries-and-requires-an-explicit-refresh');
  const uncertainID = await selectAccount(alice, seedFlow());
  const uncertainEndpoint = '/t/browser-alice/api/v1/browser/device-authorizations/' + uncertainID;
  let writes = 0;
  await alice.route('**' + uncertainEndpoint + '/approve', (route) => {
    writes++;
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"AUTH_UNAVAILABLE: fixture outcome unknown"}' });
  });
  await alice.getByRole('button', { name: '确认接入', exact: true }).click();
  await alice.getByRole('alert').waitFor(); await delay(300);
  assert.equal(writes, 1);
  assert.equal(await alice.getByRole('button', { name: '确认接入', exact: true }).isDisabled(), true);
  await alice.unroute('**' + uncertainEndpoint + '/approve');
  await alice.getByRole('button', { name: '刷新状态', exact: true }).click();
  await alice.getByRole('button', { name: '确认接入', exact: true }).waitFor();
  assert.equal(await alice.getByRole('button', { name: '确认接入', exact: true }).isEnabled(), true);
  mark('address-pool-conflict-explains-recovery-without-retrying-or-showing-success');
  let exhaustedWrites = 0;
  await alice.route('**' + uncertainEndpoint + '/approve', (route) => {
    exhaustedWrites++;
    route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"ADDRESS_POOL_EXHAUSTED: no usable device addresses remain"}' });
  });
  await alice.getByRole('button', { name: '确认接入', exact: true }).click();
  await alice.getByRole('alert').waitFor(); await delay(300);
  const exhaustionMessage = await alice.getByRole('alert').innerText();
  assert.match(exhaustionMessage, /默认地址池.*平台管理员/);
  assert.equal(exhaustionMessage.includes('no usable device addresses remain'), false);
  assert.equal(exhaustedWrites, 1);
  assert.equal(await alice.getByRole('button', { name: '确认接入', exact: true }).isDisabled(), true);
  assert.equal(await alice.getByRole('heading', { name: '设备已获授权', exact: true }).count(), 0);
  await alice.unroute('**' + uncertainEndpoint + '/approve');
  await alice.getByRole('button', { name: '刷新状态', exact: true }).click();
  await alice.getByRole('button', { name: '确认接入', exact: true }).waitFor();
  mark('read-only-browser-state-never-offers-approval-controls');
  const current = await browserJSON(alice, uncertainEndpoint);
  await alice.route('**' + uncertainEndpoint, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ...current.payload, can_write: false }),
  }));
  await alice.getByRole('button', { name: '刷新状态', exact: true }).click();
  await alice.getByText('当前账户为只读角色，请联系本网络的管理员审批。', { exact: true }).waitFor();
  assert.equal(await alice.getByRole('button', { name: '确认接入', exact: true }).count(), 0);
  await alice.unroute('**' + uncertainEndpoint);
  mark('expired-missing-and-oauth-failure-have-no-go-html-fallback');
  const database = new DatabaseSync(path.join(directory, 'orgs/browser-alice/state.db'));
  const now = BigInt(Date.now()) * 1000000n, expired = crypto.randomBytes(16).toString('hex');
  database.prepare('INSERT INTO device_authorizations (id,machine_key,node_key,state,requested_action,client_metadata,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(expired, publicKey('mkey:'), publicKey('nodekey:'), 'pending', '', '{}', now - 10000000000n, now - 1000000000n);
  await alice.goto(origin + '/t/browser-alice/register/' + expired);
  await alice.getByRole('heading', { name: '授权链接已过期', exact: true }).waitFor();
  assert.equal(await alice.getByRole('button', { name: '确认接入', exact: true }).count(), 0);
  await alice.goto(origin + '/t/browser-alice/register/' + '0'.repeat(32));
  await alice.getByRole('alert').waitFor();
  await alice.goto(origin + '/auth/error?reason=AUTH_EXPIRED&error_description=untrusted-provider-message');
  await alice.getByRole('heading', { name: '登录链接已失效', exact: true }).waitFor();
  assert.equal((await alice.locator('body').innerText()).includes('untrusted-provider-message'), false);
  for (const reason of ['constructor', '__proto__', 'toString', 'unknown']) {
    await alice.goto(origin + '/auth/error?reason=' + reason);
    await alice.getByRole('heading', { name: '未能完成登录', exact: true }).waitFor();
  }
  mark('ssh-check-details-and-human-decision-use-the-modern-ui');
  const sshID = crypto.randomBytes(16).toString('hex');
  database.prepare('INSERT INTO ssh_check_sessions (id,src_node_id,dst_node_id,local_user,verdict,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
    .run(sshID, 1, 2, 'root', 'pending', now, now + 900000000000n);
  database.close();
  await alice.goto(origin + '/t/browser-alice/ssh/check/' + sshID);
  await alice.getByRole('button', { name: '批准此次连接', exact: true }).click();
  await alice.getByRole('heading', { name: '已批准本次 SSH 检查', exact: true }).waitFor();
  mark('authorization-pages-fit-mobile-and-never-render-legacy-footer');
  for (const width of [320, 390, 768, 1440]) {
    await owner.setViewportSize({ width, height: 844 });
    await owner.goto(approvalURL);
    await owner.getByRole('heading', { name: '设备已获授权', exact: true }).waitFor();
    assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal((await owner.locator('body').innerText()).includes('Xunara console'), false);
    assert.equal(await owner.locator('form[method="post"]').count(), 0);
  }
  assert.equal(errors.length, 0);
  console.log(JSON.stringify({ passed: completed.length, javascriptErrors: 0, artifacts: directory, productionChanged: false }));
}

main().catch((failure) => { console.error(JSON.stringify({ stage, error: failure.name, message: failure.message, artifacts: directory })); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  if (daemon && daemon.exitCode === null) { daemon.kill('SIGTERM'); await new Promise((resolve) => daemon.once('exit', resolve)); }
});
