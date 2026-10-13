const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

async function runDeviceCoreSmoke({ page, memberPage, origin, state, mark }) {
  const request = page.context().request;
  async function read(endpoint) {
    const response = await request.get(origin + endpoint);
    assert.equal(response.status(), 200);
    return response.json();
  }
  async function noOverflow() {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  async function screenshot(name) {
    if (!process.env.SMOKE_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, name + '.png') });
  }
  mark('core-navigation-default-collapsed-and-management-deep-links');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/devices');
  const navigation = page.getByRole('navigation', { name: '功能菜单', exact: true });
  assert.equal(await navigation.getByRole('link').count(), 7);
  assert.equal(await navigation.getByRole('button', { name: '更多管理与设置', exact: true }).getAttribute('aria-expanded'), 'false');
  await page.goto(origin + '/security');
  await navigation.getByRole('link', { name: '安全中心', exact: true }).waitFor();
  await page.goto(origin + '/devices');

  mark('add-device-actual-tenant-url-checkboxes-and-valid-shell');
  await page.getByRole('button', { name: '添加设备', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '添加设备', exact: true });
  const command = dialog.getByLabel('设备安装命令', { exact: true });
  await command.waitFor();
  assert.ok((await command.textContent()).includes('--login-server=' + JSON.stringify(origin)));
  assert.ok((await command.textContent()).includes('https://tailscale.com/install.sh'));
  assert.equal((await command.textContent()).split('\n').length, 4);
  assert.ok((await command.textContent()).includes('/network-check.py'));
  assert.equal(await dialog.locator('details').getAttribute('open'), null);
  await dialog.getByText('高级选项', { exact: true }).click();
  await dialog.getByRole('checkbox', { name: '接收其他设备发布的子网路由', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '接收网络 DNS 配置（MagicDNS）', exact: true }).uncheck();
  await dialog.getByLabel('安装设备名称', { exact: true }).fill('home-server');
  await dialog.getByRole('checkbox', { name: '将此设备设为子网路由器', exact: true }).check();
  await dialog.getByLabel('安装宣告子网', { exact: true }).fill('192.168.9.7/24');
  await dialog.getByRole('checkbox', { name: '将此设备设为出口节点', exact: true }).check();
  const text = await command.textContent();
  for (const flag of ['--accept-routes=true', '--accept-dns=false', '--hostname="home-server"', '--advertise-routes="192.168.9.0/24"', '--advertise-exit-node']) assert.ok(text.includes(flag));
  assert.equal(spawnSync('bash', ['-n'], { input: text }).status, 0);
  assert.equal(text.includes('--auth-key'), false);
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); if (width === 390) await screenshot('add-device-mobile'); }
  await dialog.getByLabel('设备平台', { exact: true }).selectOption('android');
  assert.equal(await command.count(), 0);
  await dialog.getByRole('button', { name: '复制控制面地址', exact: true }).waitFor();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.route('**/api/v1/overview', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"接入地址读取失败（验收注入）"}' }));
  await page.getByRole('button', { name: '添加设备', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByLabel('设备安装命令').count(), 0);
  await page.unroute('**/api/v1/overview');
  await dialog.getByRole('button', { name: '重新读取接入地址', exact: true }).click();
  await dialog.getByLabel('设备安装命令').waitFor();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();

  mark('device-client-report-real-sqlite-read-and-independent-failure');
  assert.ok(path.basename(state).startsWith('xunara-console-smoke-'));
  assert.equal(fs.statSync(state).mode & 0o777, 0o700);
  const database = new DatabaseSync(path.join(state, 'state.db'));
  try {
    database.exec('PRAGMA busy_timeout=5000');
    database.prepare("UPDATE nodes SET home_derp = 990, hostinfo = ?, endpoints = ? WHERE stable_id = 'smoke-1'").run(
      JSON.stringify({ NetInfo: { PreferredDERP: 990, WorkingUDP: false, WorkingIPv6: true, LinkType: 'wifi', DERPLatency: { '990-v4': .01234 } } }),
      JSON.stringify(['192.0.2.20:41641']));
  } finally { database.close(); }
  const machine = await read('/api/v1/machines/smoke-1');
  await page.goto(origin + '/devices/' + machine.id);
  const panel = page.getByRole('region', { name: '设备连接与中继', exact: true });
  await panel.getByText('默认验收中继', { exact: true }).waitFor();
  await panel.getByText('Wi-Fi', { exact: true }).waitFor();
  await panel.getByText('中继探测延迟（1）', { exact: true }).click();
  await panel.getByText('12.34 ms', { exact: true }).waitFor();
  await panel.getByText('候选连接端点（1）', { exact: true }).click();
  await panel.getByText('192.0.2.20:41641', { exact: true }).waitFor();
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); if (width === 390) await screenshot('device-connection-mobile'); }
  await page.route('**/connection', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"报告读取失败（验收注入）"}' }));
  await panel.getByRole('button', { name: '刷新连接信息', exact: true }).click();
  await panel.getByRole('alert').waitFor();
  await page.getByRole('heading', { name: '基本信息', exact: true }).waitFor();
  await page.unroute('**/connection');
  await panel.getByRole('button', { name: '刷新连接信息', exact: true }).click();
  await panel.getByText('默认验收中继', { exact: true }).waitFor();

  mark('private-relay-installer-public-parameters-and-http-refusal');
  await page.goto(origin + '/relays');
  await page.getByRole('button', { name: '接入指南', exact: true }).click();
  await page.getByLabel('安装中继公网地址', { exact: true }).fill('relay.example.com');
  await page.getByRole('status').getByText('私有中继安装需要不含凭据的 HTTPS 控制面根地址', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('私有中继安装命令').count(), 0);
  // 只替换前端公共地址，独立 Go TLS 测试验证探测；不把此夹具当成公网接入成功。
  await page.route('**/api/v2/relays/enrolled', async (route) => {
    const response = await route.fetch();
    const body = await response.json(); body.control_url = 'https://control.example.com';
    await route.fulfill({ response, json: body });
  });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  const relayCommand = page.getByLabel('私有中继安装命令', { exact: true });
  await relayCommand.waitFor();
  await page.getByRole('checkbox', { name: '开启 STUN（需要另外开放 UDP 端口，有助于直连）', exact: true }).check();
  await page.getByLabel('安装 STUN 端口').fill('3479');
  assert.ok((await relayCommand.textContent()).includes('--stun --stun-port 3479'));
  assert.equal(spawnSync('bash', ['-n'], { input: await relayCommand.textContent() }).status, 0);
  assert.equal((await relayCommand.textContent()).includes('xrelay-enroll-'), false);
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); if (width === 390) await screenshot('private-relay-installer-mobile'); }
  await page.unroute('**/api/v2/relays/enrolled');

  mark('private-relay-health-real-api-ssrf-block-audit-and-member-denial');
  let pool = await read('/api/v2/relays/enrolled');
  const enrollment = await request.post(origin + '/api/v2/relays/enroll-tokens', {
    headers: { 'X-CSRF-Token': pool.csrf_token }, data: { name: '隔离健康检测中继', visibility: 'private', ttl_seconds: 3600 },
  });
  assert.equal(enrollment.status(), 201);
  const token = (await enrollment.json()).token;
  const enrolled = await request.post(origin + '/api/relay/v1/enroll', {
    headers: { Authorization: 'Bearer ' + token }, data: { name: '隔离健康检测中继', hostname: '127.0.0.1', region_id: 40002,
      region_code: 'fixture', region_name: '隔离检测', derp_port: 9444, node_key: 'nodekey:' + crypto.randomBytes(32).toString('hex'), version: 'isolated-browser-fixture' },
  });
  assert.equal(enrolled.status(), 200);
  await page.goto(origin + '/relays');
  await page.getByRole('button', { name: '私有中继', exact: true }).click();
  const row = page.locator('tbody tr').filter({ hasText: '隔离健康检测中继' });
  const checked = page.waitForResponse((response) => response.url().endsWith('/health') && response.request().method() === 'POST');
  await row.getByRole('button', { name: '健康检测', exact: true }).click();
  const result = await checked;
  assert.equal(result.status(), 200);
  assert.equal((await result.json()).code, 'PROBE_ADDRESS_BLOCKED');
  await row.getByText('目标未通过公网地址校验', { exact: false }).waitFor();
  await memberPage.goto(origin + '/relays');
  await memberPage.getByRole('button', { name: '私有中继', exact: true }).click();
  assert.equal(await memberPage.getByRole('button', { name: '健康检测', exact: true }).count(), 0);
  pool = await read('/api/v2/relays/enrolled');
  const relay = pool.items.find((item) => item.name === '隔离健康检测中继');
  const response = await request.delete(origin + '/api/v2/relays/' + relay.id, { headers: { 'X-CSRF-Token': pool.csrf_token, 'If-Match': String(relay.configVersion) } });
  assert.equal(response.status(), 204);
}
module.exports = { runDeviceCoreSmoke };
