const assert = require('node:assert/strict');

// 此模块仅操作兄弟仓库启动的 localhost 临时租户，禁止用生产凭据做写入验收。
async function runAddressRelaySmoke({ page, memberPage, origin, mark, assignPlan }) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
  const request = page.context().request;
  async function read(endpoint) { const response = await request.get(origin + endpoint); assert.equal(response.status(), 200); return response.json(); }
  async function write(endpoint, data, csrf) { const response = await request.put(origin + endpoint, { data, headers: { 'X-CSRF-Token': csrf } }); assert.equal(response.status(), 200); return response.json(); }
  async function feature(name) { await page.getByRole('navigation', { name: '中继功能' }).getByRole('button', { name, exact: true }).click(); }
  async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); }

  mark('default-relay-visible-first-and-seven-precompiled-direct-downloads');
  await page.goto(origin + '/relays');
  await page.getByRole('heading', { name: '默认与可用中继', exact: true }).waitFor();
  await page.locator('tbody tr').filter({ hasText: '默认验收中继' }).getByText('默认 / 平台', { exact: true }).waitFor();
  await feature('程序下载');
  await page.getByRole('heading', { name: '托管中继程序下载', exact: true }).waitFor();
  const links = await page.getByRole('link', { name: /^直接下载/ }).evaluateAll((elements) => elements.map((element) => element.href));
  assert.equal(links.length, 7); assert.equal(new Set(links).size, 7);
  for (const link of links) assert.ok(link.startsWith('https://github.com/xunara-net/xunara-relay/releases/download/v0.1.0-preview.1/xunara-relay_'));
  assert.ok((await page.getByRole('link', { name: '下载 SHA256SUMS 校验和', exact: true }).getAttribute('href')).endsWith('/SHA256SUMS'));
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); }

  mark('external-relay-manual-publication-survives-reload-without-managed-identity');
  await feature('非托管中继');
  await page.getByRole('heading', { name: '非托管 / 公共中继', exact: true }).waitFor();
  await page.route('**/api/v2/derp/configuration', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '外部地图读取失败（验收注入）' }) }));
  await page.getByRole('button', { name: '刷新配置', exact: true }).click();
  await page.getByRole('alert').getByText('外部地图读取失败（验收注入）', { exact: true }).waitFor();
  assert.equal(await page.getByText('尚未添加外部中继', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '添加或导入公共中继', exact: true }).count(), 0);
  await page.unroute('**/api/v2/derp/configuration');
  await page.getByRole('button', { name: '刷新配置', exact: true }).click();
  await page.getByRole('button', { name: '添加或导入公共中继', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '编辑非托管中继地图', exact: true });
  await dialog.getByText('手动添加一个中继', { exact: true }).click();
  await dialog.getByLabel('外部中继主机', { exact: true }).fill('public.example.test');
  await dialog.getByLabel('外部 DERP 端口', { exact: true }).fill('8443');
  await dialog.getByLabel('外部 STUN 端口', { exact: true }).fill('-1');
  await dialog.getByRole('button', { name: '加入地图草稿', exact: true }).click();
  const draft = JSON.parse(await dialog.getByLabel('非托管中继地图 JSON', { exact: true }).inputValue());
  assert.equal(draft.Regions['901'].Nodes[0].STUNPort, -1);
  assert.equal((await read('/api/v2/derp/configuration')).revision, 0);
  page.once('dialog', (native) => native.accept());
  await dialog.getByRole('button', { name: '确认发布中继地图', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await read('/api/v2/relays/enrolled')).used, 0);
  await page.reload();
  await page.locator('tbody tr').filter({ hasText: '我的公共中继' }).getByText('非托管 / 公共', { exact: true }).waitFor();
  assert.ok((await read('/api/v2/derp')).regions.some((region) => region.id === 990 && region.source === 'deployment'));

  mark('external-map-cas-preserves-draft-and-delete-keeps-default-map');
  await feature('非托管中继');
  await page.getByRole('button', { name: '添加或导入公共中继', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑非托管中继地图', exact: true });
  const preserved = await dialog.getByLabel('非托管中继地图 JSON', { exact: true }).inputValue();
  const configuration = await read('/api/v2/derp/configuration');
  configuration.map.Regions['901'].RegionName = '并发公共中继';
  await write('/api/v2/derp/configuration', { revision: configuration.revision, map: configuration.map }, configuration.csrf_token);
  page.once('dialog', (native) => native.accept());
  await dialog.getByRole('button', { name: '确认发布中继地图', exact: true }).click();
  await dialog.getByRole('alert').getByText('配置已被其他管理员修改', { exact: false }).waitFor();
  assert.equal(await dialog.getByLabel('非托管中继地图 JSON', { exact: true }).inputValue(), preserved);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '刷新配置', exact: true }).click();
  const row = page.locator('tbody tr').filter({ hasText: '并发公共中继' }); await row.waitFor();
  page.once('dialog', (native) => native.accept());
  await row.getByRole('button', { name: '移除地区', exact: true }).click(); await row.waitFor({ state: 'detached' });
  assert.equal(Object.keys((await read('/api/v2/derp/configuration')).map.Regions).length, 0);
  assert.ok((await read('/api/v2/derp')).regions.some((region) => region.id === 990));

  mark('allocation-entitlement-keeps-entry-visible-without-enabling-writes');
  await assignPlan('free');
  assert.equal((await read('/api/v2/network/addresses')).can_edit, false);
  await page.goto(origin + '/network');
  await page.getByRole('status').getByText('当前套餐未开通自定义网段，请联系平台管理员调整套餐权限。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '修改分配网段', exact: true }).isDisabled(), true);
  await page.getByRole('link', { name: '查看套餐权限 →', exact: true }).waitFor();
  await page.getByRole('link', { name: '配置子网路由 →', exact: true }).waitFor();

  mark('tenant-custom-cidr-preview-confirmation-and-old-device-preservation');
  await assignPlan('pro');
  const before = await read('/api/v2/network/addresses');
  const machine = await read('/api/v1/machines/smoke-1');
  await page.route('**/api/v2/network/addresses', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '地址读取失败（验收注入）' }) }));
  await page.goto(origin + '/network');
  await page.getByRole('alert').getByText('地址配置读取失败：地址读取失败（验收注入）', { exact: true }).waitFor();
  await page.getByText('网段权限暂未确认', { exact: true }).waitFor();
  assert.equal(await page.getByText('系统自动分配，当前套餐不允许自定义网段', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '修改分配网段', exact: true }).isDisabled(), true);
  await page.unroute('**/api/v2/network/addresses');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: '修改分配网段', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '修改设备分配网段', exact: true });
  await dialog.getByLabel('IPv4 分配网段', { exact: true }).fill('100.101.50.12/24');
  await dialog.getByRole('button', { name: '校验并预览', exact: true }).click();
  await dialog.getByRole('button', { name: '确认保存分配网段', exact: true }).waitFor();
  assert.equal((await read('/api/v2/network/addresses')).revision, before.revision);
  await noOverflow();
  await dialog.getByRole('button', { name: '确认保存分配网段', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  const saved = await read('/api/v2/network/addresses');
  assert.equal(saved.ipv4_cidr, '100.101.50.0/24'); assert.equal(saved.pending, false);
  assert.equal((await read('/api/v1/machines/smoke-1')).ipv4, machine.ipv4);

  mark('saved-allocation-refreshes-plan-and-dashboard-without-page-reload');
  assert.equal((await read('/api/v1/auth/session')).plan.network_prefix, saved.ipv4_cidr);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: '套餐与用量', exact: true }).click();
  await page.getByRole('heading', { name: '套餐与用量', exact: true }).waitFor();
  await page.getByText(saved.ipv4_cidr, { exact: true }).waitFor();
  await page.getByRole('link', { name: '管理网络网段 →', exact: true }).waitFor();
  await page.getByRole('link', { name: '控制台首页', exact: true }).click();
  await page.getByRole('heading', { name: '控制台首页', exact: true }).waitFor();
  await page.getByText(saved.ipv4_cidr, { exact: true }).waitFor();
  await page.getByRole('link', { name: '管理自定义网段 →', exact: true }).click();
  await page.getByRole('button', { name: '修改分配网段', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '修改设备分配网段', exact: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); }
  await page.setViewportSize({ width: 1440, height: 1000 });

  mark('device-ip-cas-retains-draft-and-applies-only-explicit-confirmed-address');
  await page.goto(origin + '/devices/' + machine.id);
  await page.getByRole('button', { name: '修改 IPv4', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '修改设备 IPv4', exact: true });
  await dialog.getByLabel('设备新 IPv4', { exact: true }).fill('100.101.50.21');
  await write('/api/v2/machines/smoke-1/ipv4', { ipv4: '100.101.50.22', expected_ipv4: machine.ipv4 }, saved.csrf_token);
  page.once('dialog', (native) => native.accept());
  await dialog.getByRole('button', { name: '确认修改 IPv4', exact: true }).click();
  await dialog.getByRole('alert').getByText('网段或设备 IP 已被其他管理员修改', { exact: false }).waitFor();
  assert.equal(await dialog.getByLabel('设备新 IPv4', { exact: true }).inputValue(), '100.101.50.21');
  await dialog.getByRole('button', { name: '关闭并刷新设备', exact: true }).click();
  await page.getByRole('button', { name: '修改 IPv4', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '修改设备 IPv4', exact: true });
  await dialog.getByLabel('设备新 IPv4', { exact: true }).fill('100.101.50.21');
  page.once('dialog', (native) => native.accept());
  await dialog.getByRole('button', { name: '确认修改 IPv4', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  assert.equal((await read('/api/v1/machines/smoke-1')).ipv4, '100.101.50.21');
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); }

  mark('member-cannot-edit-allocation-ip-or-external-map-but-can-download');
  await memberPage.goto(origin + '/network'); await memberPage.getByRole('heading', { name: '网络基本信息', exact: true }).waitFor();
  assert.equal(await memberPage.getByRole('button', { name: '修改分配网段', exact: true }).isDisabled(), true);
  await memberPage.getByRole('status').getByText('只有网络所有者或管理员可以修改网段，请联系网络管理员。', { exact: true }).waitFor();
  await memberPage.goto(origin + '/devices/' + machine.id); await memberPage.getByRole('heading', { name: '基本信息', exact: true }).waitFor();
  assert.equal(await memberPage.getByRole('button', { name: '修改 IPv4', exact: true }).count(), 0);
  await memberPage.goto(origin + '/relays');
  await memberPage.getByRole('navigation', { name: '中继功能' }).getByRole('button', { name: '非托管中继', exact: true }).click();
  await memberPage.getByRole('heading', { name: '非托管 / 公共中继', exact: true }).waitFor();
  assert.equal(await memberPage.getByRole('button', { name: '添加或导入公共中继', exact: true }).count(), 0);
  await memberPage.getByRole('navigation', { name: '中继功能' }).getByRole('button', { name: '程序下载', exact: true }).click();
  await memberPage.getByRole('heading', { name: '托管中继程序下载', exact: true }).waitFor();
  assert.equal(await memberPage.getByRole('link', { name: /^直接下载/ }).count(), 7);
}
module.exports = { runAddressRelaySmoke };
