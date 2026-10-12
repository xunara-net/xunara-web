const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

async function runRouteCoreSmoke({ page, memberPage, origin, state, mark }) {
  assert.ok(path.basename(state).startsWith('xunara-console-smoke-'));
  assert.equal(fs.statSync(state).mode & 0o777, 0o700);
  const request = page.context().request;
  async function read(endpoint) {
    const response = await request.get(origin + endpoint, { timeout: 10000 });
    assert.equal(response.status(), 200);
    return response.json();
  }
  async function save(view, approve, unapprove) {
    const response = await request.post(origin + '/api/v2/machines/' + view.machine.stableId + '/routes', {
      headers: { 'X-CSRF-Token': view.csrf_token }, data: { revision: view.revision, approve, unapprove },
    });
    assert.equal(response.status(), 200);
    return response.json();
  }
  async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); }
  async function screenshot(name) {
    if (!process.env.SMOKE_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, name + '.png') });
  }
  const database = new DatabaseSync(path.join(state, 'state.db'));
  database.exec('PRAGMA busy_timeout=5000');
  const select = database.prepare("SELECT stable_id, hostinfo, approved_routes, expiry FROM nodes WHERE stable_id IN ('smoke-1','smoke-2','smoke-3','smoke-4','smoke-5')");
  select.setReadBigInts(true);
  const originals = select.all();
  assert.equal(originals.length, 5);
  const update = database.prepare('UPDATE nodes SET hostinfo = ?, approved_routes = ?, expiry = ? WHERE stable_id = ?');
  function seed(stableId, announced, approved = [], extra = {}, expiry = null) {
    const original = originals.find((node) => node.stable_id === stableId);
    update.run(JSON.stringify({ ...JSON.parse(original.hostinfo || '{}'), RoutableIPs: announced, ...extra }), JSON.stringify(approved), expiry, stableId);
  }
  seed('smoke-1', ['10.40.0.0/16', '192.168.90.0/24', '0.0.0.0/0', '::/0']);
  seed('smoke-2', [], ['10.250.0.0/16'], { ExitNodeID: 'smoke-1' });
  seed('smoke-3', ['10.90.0.0/16'], ['10.90.0.0/16'], {}, BigInt(Date.now() - 86400000) * 1000000n);
  seed('smoke-4', [], [], { ExitNodeID: 'deleted-exit' });
  seed('smoke-5', Array.from({ length: 14 }, (_, index) => '10.' + (100 + index) + '.0.0/16'));
  const endpoint = '/api/v2/machines/smoke-1/routes';
  const view = await read(endpoint), hostname = view.machine.hostname;
  let dialog;
  async function open() {
    await page.getByRole('button', { name: '管理 ' + hostname + ' 路由 10.40.0.0/16', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: '批准路由 10.40.0.0/16', exact: true }).waitFor();
  }
  async function preview() {
    await dialog.getByRole('button', { name: '预览路由变更', exact: true }).click();
    await page.getByRole('dialog', { name: '确认路由审批变更', exact: true }).waitFor();
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
  }
  async function publish(expected = 200) {
    const response = page.waitForResponse((result) => result.url().endsWith(endpoint) && result.request().method() === 'POST');
    await dialog.getByRole('button', { name: '确认保存路由', exact: true }).click();
    assert.equal((await response).status(), expected);
    if (expected === 200) await dialog.waitFor({ state: 'detached' });
  }
  try {
    mark('route-overview-real-states-filter-pagination-and-mobile');
    await page.goto(origin + '/routes');
    await page.getByLabel('搜索路由与设备', { exact: true }).waitFor();
    const management = page.getByRole('region', { name: '路由管理', exact: true });
    assert.equal(await management.locator('.route-entry').count(), 12);
    await management.getByRole('button', { name: '下一页', exact: true }).click();
    assert.equal(await management.locator('.route-entry').count(), 8);
    await page.getByLabel('路由状态', { exact: true }).selectOption('withdrawn');
    await management.getByText('已批准 · 已停止宣告', { exact: true }).waitFor();
    await page.getByLabel('路由状态', { exact: true }).selectOption('offline');
    await management.getByText('已批准 · 设备密钥过期', { exact: true }).waitFor();
    await page.getByLabel('路由状态', { exact: true }).selectOption('all');
    await page.getByLabel('搜索路由与设备', { exact: true }).fill(hostname);
    assert.equal(await management.locator('.route-entry').count(), 4);
    for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); }
    await page.setViewportSize({ width: 390, height: 844 }); await screenshot('routes-mobile');

    mark('route-direct-preview-confirm-and-actual-persistent-approval');
    await open();
    for (const prefix of ['10.40.0.0/16', '0.0.0.0/0', '::/0']) await dialog.getByRole('checkbox', { name: '批准路由 ' + prefix, exact: true }).check();
    assert.deepEqual((await read(endpoint)).machine.approvedRoutes, []);
    await preview(); assert.equal(await page.getByRole('dialog').count(), 1);
    for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); }
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot('route-confirm-mobile'); await publish();
    assert.deepEqual((await read(endpoint)).machine.approvedRoutes, ['0.0.0.0/0', '10.40.0.0/16', '::/0']);

    mark('route-cas-retains-draft-and-preserves-other-admin-additions');
    await page.getByLabel('搜索路由与设备', { exact: true }).fill(hostname); await open();
    await dialog.getByRole('checkbox', { name: '批准路由 10.40.0.0/16', exact: true }).uncheck();
    await save(await read(endpoint), ['192.168.90.0/24'], []);
    await preview(); await publish(409);
    await dialog.getByText('草稿保留，不自动覆盖或重试。先读取最新状态，再重新预览。', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '确认保存路由', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: '读取最新路由状态', exact: true }).click();
    await dialog.getByRole('button', { name: '采用最新版本并重新预览', exact: true }).click();
    assert.equal(await dialog.getByRole('checkbox', { name: '批准路由 10.40.0.0/16', exact: true }).isChecked(), false);
    assert.equal(await dialog.getByRole('checkbox', { name: '批准路由 192.168.90.0/24', exact: true }).isChecked(), true);
    await preview(); await publish();
    assert.deepEqual((await read(endpoint)).machine.approvedRoutes, ['0.0.0.0/0', '192.168.90.0/24', '::/0']);

    mark('route-save-failure-no-autoretry-and-explicit-latest-recovery');
    await page.getByLabel('搜索路由与设备', { exact: true }).fill(hostname); await open();
    await dialog.getByRole('checkbox', { name: '批准路由 192.168.90.0/24', exact: true }).uncheck();
    let intercepted = 0;
    await page.route('**' + endpoint, (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      intercepted++;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"审批不可用（验收注入）"}' });
    });
    await preview(); await publish(503);
    assert.equal(intercepted, 1);
    assert.equal((await read(endpoint)).machine.approvedRoutes.includes('192.168.90.0/24'), true);
    await dialog.getByRole('button', { name: '返回草稿', exact: true }).click();
    assert.equal(await dialog.getByRole('checkbox', { name: '批准路由 192.168.90.0/24', exact: true }).isChecked(), false);
    assert.equal(await dialog.getByRole('button', { name: '预览路由变更', exact: true }).isDisabled(), true);
    await page.unroute('**' + endpoint);
    await dialog.getByRole('button', { name: '读取最新路由状态', exact: true }).click();
    await dialog.getByRole('button', { name: '采用最新版本并重新预览', exact: true }).click();
    await preview(); await publish();

    mark('exit-actual-reports-unresolved-selection-and-platform-local-help');
    const exitPanel = page.getByRole('region', { name: '出口节点', exact: true });
    await exitPanel.getByText('客户端出口选择 · 2 条自报记录', { exact: true }).click();
    await exitPanel.getByText('目标已删除或不再获批', { exact: true }).waitFor();
    await page.getByRole('button', { name: '使用出口 ' + hostname, exact: true }).click();
    dialog = page.getByRole('dialog', { name: '在自己的设备使用出口节点', exact: true });
    await dialog.getByText('此说明仅供排查', { exact: false }).waitFor();
    const command = dialog.getByLabel('选择出口命令', { exact: true });
    const text = await command.textContent();
    assert.equal(spawnSync('bash', ['-n'], { input: text }).status, 0);
    assert.ok(text.startsWith('sudo tailscale set --exit-node='));
    assert.equal(text.includes('--auth-key'), false); assert.equal(text.includes('--login-server'), false);
    await dialog.getByLabel('出口客户端平台', { exact: true }).selectOption('windows');
    assert.equal((await command.textContent()).startsWith('sudo'), false);
    await dialog.getByRole('checkbox', { name: '使用出口时仍允许访问本地局域网', exact: true }).check();
    assert.ok((await command.textContent()).endsWith('--exit-node-allow-lan-access=true'));
    for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); }
    await page.setViewportSize({ width: 390, height: 844 }); await screenshot('exit-help-mobile');
    await dialog.getByLabel('出口客户端平台', { exact: true }).selectOption('android');
    assert.equal(await command.count(), 0);
    await dialog.getByText('在 APP 的「出口节点」选择', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();

    mark('route-device-details-share-same-versioned-dialog-and-read-failure');
    await page.goto(origin + '/devices/smoke-1');
    await page.getByRole('button', { name: '管理路由与出口', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '管理路由与出口', exact: true });
    await dialog.getByRole('checkbox', { name: '批准路由 ::/0', exact: true }).waitFor();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.route('**' + endpoint, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"路由配置不可用（验收注入）"}' }));
    await page.getByRole('button', { name: '刷新路由配置', exact: true }).click();
    await page.getByRole('region', { name: '路由审批', exact: true }).getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button', { name: '管理路由与出口', exact: true }).count(), 0);
    await page.unroute('**' + endpoint);

    mark('route-member-readonly-no-write-controls-and-server-forbidden');
    await memberPage.goto(origin + '/routes');
    await memberPage.getByLabel('搜索路由与设备', { exact: true }).fill(hostname);
    await memberPage.getByRole('button', { name: '查看 ' + hostname + ' 路由 10.40.0.0/16', exact: true }).click();
    const memberDialog = memberPage.getByRole('dialog', { name: '管理路由与出口', exact: true });
    await memberDialog.getByRole('checkbox', { name: '批准路由 ::/0', exact: true }).waitFor();
    assert.equal(await memberDialog.getByRole('checkbox').first().isDisabled(), true);
    assert.equal(await memberDialog.getByRole('button', { name: '预览路由变更', exact: true }).count(), 0);
    const memberView = await memberPage.context().request.get(origin + endpoint).then((response) => response.json());
    assert.equal(memberView.can_manage, false);
    const denied = await memberPage.context().request.post(origin + endpoint, {
      headers: { 'X-CSRF-Token': memberView.csrf_token }, data: { revision: memberView.revision, unapprove: ['::/0'] },
    });
    assert.equal(denied.status(), 403);
    await memberDialog.getByRole('button', { name: '关闭', exact: true }).click();
  } finally {
    for (const original of originals) update.run(original.hostinfo, original.approved_routes, original.expiry, original.stable_id);
    database.close();
  }
}
module.exports = { runRouteCoreSmoke };
