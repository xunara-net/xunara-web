const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// 仅由兄弟仓库的隔离验收调用；不接受生产路径，不创建测试专用服务端接口。
function seedIsolatedDevices(state, prefix) {
  assert.ok(path.basename(state).startsWith('xunara-console-smoke-'));
  assert.equal(fs.statSync(state).mode & 0o777, 0o700);
  const db = new DatabaseSync(path.join(state, 'state.db'));
  try {
    db.exec('PRAGMA busy_timeout=5000');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM nodes').get().total, 0);
    const insert = db.prepare(`INSERT INTO nodes
      (id, stable_id, machine_key, node_key, disco_key, user_id, hostname, ipv4, created, method)
      VALUES (?, ?, ?, ?, '', 1, ?, ?, ?, 'authkey')`);
    const network = prefix.split('/')[0].split('.').slice(0, 3).join('.');
    const devices = [];
    for (let index = 1; index <= 10; index++) {
      const device = { id: 1000 + index, hostname: `smoke-device-${String(index).padStart(2, '0')}`, ipv4: `${network}.${index + 20}` };
      insert.run(device.id, 'smoke-' + index, 'mkey:' + crypto.randomBytes(32).toString('hex'),
        'nodekey:' + crypto.randomBytes(32).toString('hex'), device.hostname, device.ipv4, BigInt(Date.now()) * 1000000n);
      devices.push(device);
    }
    return devices;
  } finally { db.close(); }
}

async function runNetworkSmoke({ page, memberPage, origin, state, mark, assertSecretNotStored }) {
  const request = page.context().request;
  async function read(endpoint) {
    const response = await request.get(origin + endpoint, { timeout: 10000 });
    assert.equal(response.status(), 200);
    return response.json();
  }
  async function write(endpoint, body, csrf, expected = 200, method = 'put') {
    const response = await request[method](origin + endpoint, { timeout: 10000,
      headers: { 'X-CSRF-Token': csrf }, data: body });
    assert.equal(response.status(), expected);
    return expected === 204 ? null : response.json();
  }
  async function noOverflow() {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  async function publish(expected) {
    await page.getByRole('button', { name: '预览并发布', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '预览并确认权限变更', exact: true });
    await dialog.getByText('校验通过', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: '确认发布', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText(`生效版本 ${expected}`, { exact: true }).waitFor();
  }
  async function feature(name) { await page.locator('.feature-tabs').getByRole('button', { name, exact: true }).click(); }

  mark('mobile-drawer-navigation-focus-scroll-and-desktop-collapse');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/permissions');
  await page.getByRole('button', { name: '添加访问规则', exact: true }).waitFor();
  assert.equal(await page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right <= 1), true);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.getByRole('button', { name: '打开菜单', exact: true }).click();
  assert.equal(await page.locator('.main').evaluate((element) => element.inert), true);
  assert.equal(await page.getByRole('button', { name: '收起侧边栏', exact: true }).isVisible(), false);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '打开菜单');
  await page.getByRole('button', { name: '打开菜单', exact: true }).click();
  await page.getByRole('navigation', { name: '功能菜单' }).getByRole('link', { name: 'DNS', exact: true }).click();
  await page.waitForURL(origin + '/dns');
  await page.getByRole('heading', { name: '自定义地址记录', exact: true }).waitFor();
  await page.waitForFunction(() => scrollY <= 1 && !document.querySelector('.main').inert && document.body.style.overflow !== 'hidden');
  assert.equal(await page.locator('main').evaluate((element) => element.contains(document.activeElement) || element === document.activeElement), true);
  await noOverflow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.getByRole('button', { name: '打开菜单', exact: true }).isVisible(), false);
  assert.equal(await page.getByRole('button', { name: '关闭菜单', exact: true }).isVisible(), false);
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  assert.ok((await page.locator('.sidebar').boundingBox()).width <= 80);
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();

  const snapshot = await read('/api/v1/auth/session');
  const devices = seedIsolatedDevices(state, snapshot.plan.network_prefix);
  const source = devices[0], destination = devices[1];

  mark('visual-policy-groups-rule-preview-confirmation-and-actual-publication');
  await page.goto(origin + '/permissions');
  await page.getByRole('button', { name: '添加访问规则', exact: true }).waitFor();
  await feature('设备组 / 成员组');
  await page.getByRole('button', { name: '添加设备组', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '设备组（标签）', exact: true });
  await dialog.getByLabel('组名称', { exact: true }).fill('home');
  await dialog.getByLabel('组成员或所有者', { exact: true }).fill(snapshot.user.login_name);
  await dialog.getByRole('button', { name: '加入草稿', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await feature('访问规则');
  page.once('dialog', (native) => native.accept());
  await page.getByRole('button', { name: '应用模板到草稿', exact: true }).click();
  await page.getByText('没有网络允许规则，默认拒绝', { exact: true }).waitFor();
  await page.getByRole('button', { name: '添加访问规则', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '允许谁访问谁', exact: true });
  await dialog.getByLabel('来源', { exact: true }).selectOption(source.ipv4);
  await dialog.getByLabel('目标', { exact: true }).selectOption(destination.ipv4);
  await dialog.getByLabel('允许的服务', { exact: true }).selectOption('https');
  await dialog.getByRole('button', { name: '加入草稿', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '预览并发布', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '预览并确认权限变更', exact: true });
  await dialog.getByText('校验通过', { exact: false }).waitFor();
  assert.equal((await read('/api/v2/policy/configuration')).revision, 0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await read('/api/v2/policy/configuration')).revision, 0);
  await publish(1);
  let current = await read('/api/v2/policy/configuration');
  assert.deepEqual(current.document.tagOwners['tag:home'], [snapshot.user.login_name]);
  assert.equal(current.document.grants.length, 1);

  mark('policy-simulation-live-results-and-rule-explanation');
  await page.getByRole('button', { name: '测试权限', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '权限测试与原因', exact: true });
  await dialog.getByLabel('测试来源设备', { exact: true }).selectOption(String(source.id));
  await dialog.getByLabel('测试目标设备', { exact: true }).selectOption(String(destination.id));
  await dialog.getByRole('button', { name: '检查权限', exact: true }).click();
  await dialog.getByText('允许访问', { exact: true }).waitFor();
  await dialog.getByText('grants #1', { exact: false }).waitFor();
  await dialog.getByLabel('测试端口', { exact: true }).fill('22');
  await dialog.getByRole('button', { name: '检查权限', exact: true }).click();
  await dialog.getByText('拒绝访问', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();

  mark('policy-graph-matrix-cross-page-and-mobile-layout');
  await feature('设备图示');
  await page.locator('.flow-row').getByText(source.hostname, { exact: true }).waitFor();
  await page.locator('.flow-row').getByText(destination.hostname, { exact: true }).waitFor();
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(); }
  if (process.env.SMOKE_ARTIFACT_DIR) {
    fs.mkdirSync(process.env.SMOKE_ARTIFACT_DIR, { recursive: true, mode: 0o700 });
    await page.screenshot({ path: path.join(process.env.SMOKE_ARTIFACT_DIR, 'acl-graph-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(process.env.SMOKE_ARTIFACT_DIR, 'acl-graph-mobile.png'), fullPage: true });
  }
  await feature('权限矩阵');
  const cell = page.getByRole('button', { name: `${source.hostname} 到 ${destination.hostname} 查看权限原因`, exact: true });
  await cell.getByText('允许', { exact: true }).waitFor();
  await page.getByRole('button', { name: '下一组目标', exact: true }).click();
  await page.getByRole('button', { name: `${source.hostname} 到 ${devices[8].hostname} 查看权限原因`, exact: true }).getByText('拒绝', { exact: true }).waitFor();
  await page.getByRole('button', { name: '上一组目标', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await cell.click();
  dialog = page.getByRole('dialog', { name: '权限测试与原因', exact: true });
  await dialog.getByText('允许访问', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  mark('policy-invalid-fields-self-tests-and-stale-write-preserve-draft');
  await feature('高级策略');
  await page.getByLabel('高级权限策略', { exact: true }).fill('{"acls":[],"unknown":true}');
  await page.getByRole('button', { name: '校验并查看变更', exact: true }).click();
  await page.getByText('策略校验未通过', { exact: false }).waitFor();
  assert.equal((await read('/api/v2/policy/configuration')).revision, 1);
  await page.getByLabel('高级权限策略', { exact: true }).fill(JSON.stringify({ ...current.document,
    tests: [{ src: source.ipv4, accept: [destination.ipv4 + ':22'] }] }));
  await page.getByRole('button', { name: '校验并查看变更', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '预览并确认权限变更', exact: true });
  await dialog.getByText('未通过发布条件，原有权限保持不变', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: '确认发布', exact: true }).isDisabled(), true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const isolated = JSON.stringify({ ...current.document, grants: [] });
  await page.getByLabel('高级权限策略', { exact: true }).fill(isolated);
  await page.getByRole('button', { name: '校验并查看变更', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '预览并确认权限变更', exact: true });
  await dialog.getByText('校验通过', { exact: false }).waitFor();
  await write('/api/v2/policy/configuration', { revision: current.revision, base_hash: current.base_hash, content: current.content }, current.csrf_token);
  await dialog.getByRole('button', { name: '确认发布', exact: true }).click();
  await dialog.getByText('配置已被其他管理员修改', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('高级权限策略', { exact: true }).inputValue(), isolated);
  assert.equal((await read('/api/v2/policy/configuration')).revision, 2);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  page.once('dialog', (native) => native.accept());
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('生效版本 2', { exact: true }).waitFor();

  mark('policy-deny-all-history-and-versioned-restoration');
  await feature('访问规则');
  page.once('dialog', (native) => native.accept());
  await page.getByRole('button', { name: '应用模板到草稿', exact: true }).click();
  await publish(3);
  await feature('历史版本');
  const original = page.locator('.rule-item').filter({ has: page.getByText('版本 1', { exact: true }) });
  await original.getByRole('button', { name: '预览恢复此版', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '预览并确认权限变更', exact: true });
  await dialog.getByRole('button', { name: '确认发布', exact: true }).click();
  await page.getByText('生效版本 4', { exact: true }).waitFor();
  assert.deepEqual((await read('/api/v2/policy/configuration')).document.grants, current.document.grants);

  mark('dns-address-record-create-edit-conflict-confirmation-and-delete');
  await page.goto(origin + '/dns');
  await page.getByRole('button', { name: '添加 DNS 记录', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '添加 DNS 地址记录', exact: true });
  await dialog.getByLabel('记录名称', { exact: true }).fill('browser-nas');
  await dialog.getByLabel('记录地址', { exact: true }).fill(destination.ipv4);
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const dnsConfiguration = await read('/api/v2/dns/configuration');
  const dnsRow = page.locator('tbody tr').filter({ hasText: `browser-nas.${dnsConfiguration.domain}` });
  await dnsRow.waitFor();
  await dnsRow.getByRole('button', { name: '编辑', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑 DNS 地址记录', exact: true });
  await dialog.getByLabel('记录地址', { exact: true }).fill(source.ipv4);
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await dnsRow.getByText(source.ipv4, { exact: true }).waitFor();
  page.once('dialog', (native) => native.dismiss());
  await dnsRow.getByRole('button', { name: '删除', exact: true }).click();
  assert.equal(await dnsRow.count(), 1);
  page.once('dialog', (native) => native.accept());
  await dnsRow.getByRole('button', { name: '删除', exact: true }).click();
  await dnsRow.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '添加 DNS 记录', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '添加 DNS 地址记录', exact: true });
  await dialog.getByLabel('记录名称', { exact: true }).fill(source.hostname);
  await dialog.getByLabel('记录地址', { exact: true }).fill(source.ipv4);
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await dialog.getByText('设备自动生成或证书工作流的记录不可在此修改', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  mark('dns-resolvers-search-split-persistence-and-stale-version');
  await feature('解析器');
  await page.getByLabel('DNS 解析器', { exact: true }).fill('223.5.5.5\n119.29.29.29');
  await feature('搜索域');
  await page.getByLabel('DNS 搜索域', { exact: true }).fill('home.example.test');
  await feature('分流 DNS');
  await page.getByRole('button', { name: '添加分流规则', exact: true }).click();
  await page.getByLabel('分流域名 1', { exact: true }).fill('office.example.test');
  await page.getByLabel('分流解析器 1', { exact: true }).fill('10.0.0.53');
  await page.getByRole('button', { name: '预览并保存设置', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '确认 DNS 设置变更', exact: true });
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const dns = await read('/api/v2/dns/configuration');
  assert.deepEqual(dns.settings.nameservers, ['223.5.5.5', '119.29.29.29']);
  assert.deepEqual(dns.settings.split_dns, { 'office.example.test': ['10.0.0.53'] });
  await page.reload();
  await feature('解析器');
  assert.equal(await page.getByLabel('DNS 解析器', { exact: true }).inputValue(), '223.5.5.5\n119.29.29.29');
  await page.getByLabel('DNS 解析器', { exact: true }).fill('1.1.1.1');
  await page.getByRole('button', { name: '预览并保存设置', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '确认 DNS 设置变更', exact: true });
  await write('/api/v2/dns/configuration', { revision: dns.revision, base_hash: dns.base_hash, settings: dns.settings }, dns.csrf_token);
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await dialog.getByText('配置已被其他管理员修改', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByLabel('DNS 解析器', { exact: true }).inputValue(), '1.1.1.1');
  page.once('dialog', (native) => native.accept());
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByLabel('DNS 解析器', { exact: true }).waitFor();

  mark('tenant-private-relay-once-only-token-revoke-and-read-only-members');
  await page.goto(origin + '/relays');
  await page.getByRole('button', { name: '接入私有中继', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '接入私有中继', exact: true });
  await dialog.getByLabel('中继令牌名称', { exact: true }).fill('浏览器私有中继');
  await dialog.getByRole('button', { name: '创建一次性令牌', exact: true }).click();
  const secret = await dialog.getByLabel('一次性中继接入令牌', { exact: true }).inputValue();
  assert.ok(secret.startsWith('xrelay-enroll-'));
  await assertSecretNotStored(page, secret);
  await dialog.getByRole('button', { name: '已保存，关闭', exact: true }).click();
  assert.equal((await page.content()).includes(secret), false);
  await feature('接入令牌');
  const tokenRow = page.locator('tbody tr').filter({ hasText: '浏览器私有中继' });
  await tokenRow.waitFor();
  page.once('dialog', (native) => native.accept());
  await tokenRow.getByRole('button', { name: '撤销', exact: true }).click();
  await tokenRow.waitFor({ state: 'detached' });
  await feature('接入指南');
  assert.equal((await page.locator('pre').innerText()).includes(secret), false);
  await noOverflow();
  for (const target of ['/permissions', '/dns', '/relays']) {
    await memberPage.goto(origin + target);
    await memberPage.getByText(target === '/dns' ? '当前成员只能查看 DNS' : '只读', { exact: false }).first().waitFor();
    for (const name of ['添加访问规则', '预览并发布', '添加 DNS 记录', '接入私有中继']) {
      assert.equal(await memberPage.getByRole('button', { name, exact: true }).count(), 0);
    }
  }
}

module.exports = { runNetworkSmoke };
