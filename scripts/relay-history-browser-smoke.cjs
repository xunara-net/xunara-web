const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 接受隔离验收已创建的中继，不连接生产环境，不把令牌写入参数或验收日志。
async function runRelayHistorySmoke({ userPage, adminPage, origin, api, platformToken, relayIdentity, mark }) {
  const id = relayIdentity.relay_id;
  const endpoint = '/api/platform/v1/organizations/default/relays/' + encodeURIComponent(id);
  const tenantEndpoint = '/api/v2/relays/' + encodeURIComponent(id);
  async function read() {
    const response = await api(endpoint, platformToken, undefined, 'GET');
    assert.equal(response.status, 200);
    return response.json();
  }
  async function change(body) {
    const response = await api(endpoint, platformToken, body, 'PATCH');
    assert.equal(response.status, 200);
    return response.json();
  }
  async function noOverflow(page) {
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll('*')).filter((element) => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })) }));
    if (layout.scroll > layout.width + 1) {
      console.log(JSON.stringify({ layout_failure: new URL(page.url()).pathname, ...layout }));
      if (process.env.SMOKE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'layout-failure.png') });
    }
    assert.ok(layout.scroll <= layout.width + 1);
  }

  // 这里只验收服务自报的 UI 契约；真实执行和 TLS 数据面由 Relay 的 Go 集成测试验证。
  mark('relay-execution-ui-unknown-and-fixed-failure-report');
  await userPage.goto(origin + '/relays');
  await userPage.getByText('执行状态未知', { exact: true }).waitFor();
  await adminPage.goto(origin + '/admin/relays');
  await adminPage.getByText('执行状态未知', { exact: true }).waitFor();
  const existing = await read();
  const telemetry = { healthy: false, connected_clients: 2, uptime_seconds: existing.uptimeSeconds || 0,
    bytes_in: existing.bytesIn || 0, bytes_out: existing.bytesOut || 0 };
  let response = await api('/api/relay/v1/heartbeat', relayIdentity.relay_token, { ...telemetry,
    execution: { config_version: '2', applied_version: '1', status: 'failed', state: 'online', bandwidth_limit: 0, error_code: 'cache_write_failed' } });
  assert.equal(response.status, 200);
  for (const page of [userPage, adminPage]) {
    await page.reload();
    await page.getByText('中继上报执行失败', { exact: true }).waitFor();
    await page.getByText('配置缓存写入失败', { exact: false }).waitFor();
  }

  mark('relay-execution-ui-service-reported-application-not-end-to-end-proof');
  response = await api('/api/relay/v1/heartbeat', relayIdentity.relay_token, { ...telemetry,
    execution: { config_version: '2', applied_version: '2', status: 'applied', state: existing.desiredState, bandwidth_limit: existing.bandwidthLimit } });
  assert.equal(response.status, 200);
  for (const page of [userPage, adminPage]) {
    await page.reload();
    await page.getByText('中继上报已应用 v2', { exact: true }).waitFor();
    await page.getByText('不替代端到端验证', { exact: false }).waitFor();
  }

  mark('relay-cross-surface-cas-preserves-draft-and-requires-explicit-new-baseline');
  await userPage.goto(origin + '/relays');
  await userPage.getByRole('button', { name: '管理', exact: true }).click();
  let dialog = userPage.getByRole('dialog', { name: '管理中继', exact: true });
  await dialog.getByLabel('中继地区名称', { exact: true }).fill('保留的中继草稿');
  await dialog.getByLabel('中继带宽上限', { exact: true }).fill('2048');
  await change({ config_version: 2, region_name: '并发平台修改' });
  const conflict = userPage.waitForResponse((response) => new URL(response.url()).pathname === tenantEndpoint && response.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.equal((await conflict).status(), 409);
  await dialog.getByRole('alert').getByText('草稿保留', { exact: false }).waitFor();
  assert.equal(await dialog.getByLabel('中继地区名称', { exact: true }).inputValue(), '保留的中继草稿');
  assert.equal((await read()).configVersion, 3);
  await dialog.getByRole('button', { name: '查看最新配置（保留草稿）', exact: true }).click();
  await dialog.getByText('最新 v3', { exact: false }).waitFor();
  assert.equal(await dialog.getByLabel('中继地区名称', { exact: true }).inputValue(), '保留的中继草稿');
  await dialog.getByRole('button', { name: '确认最新基准，保留草稿', exact: true }).click();
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  let current = await read();
  assert.equal(current.configVersion, 4);
  assert.equal(current.regionName, '保留的中继草稿');
  assert.equal(current.bandwidthLimit, 2048);
  await userPage.getByText('待应用 v4（上报 v2）', { exact: true }).waitFor();

  mark('relay-history-cancel-and-confirm-restore-as-new-version');
  await userPage.getByRole('button', { name: '历史', exact: true }).click();
  dialog = userPage.getByRole('dialog', { name: '中继配置历史', exact: true });
  await dialog.getByText('当前 v4', { exact: false }).waitFor();
  let historical = dialog.locator('article').filter({ has: userPage.getByText('v2', { exact: true }) });
  userPage.once('dialog', (native) => native.dismiss());
  await historical.getByRole('button', { name: '恢复此配置', exact: true }).click();
  assert.equal((await read()).configVersion, 4);
  userPage.once('dialog', (native) => native.accept());
  await historical.getByRole('button', { name: '恢复此配置', exact: true }).click();
  await dialog.getByText('当前 v5', { exact: false }).waitFor();
  current = await read();
  assert.equal(current.regionName, '上海维护区');
  assert.equal(current.bandwidthLimit, 1024);
  assert.equal(current.connectedClients, 2);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();

  mark('platform-relay-history-cas-conflict-keeps-dialog-and-token');
  await adminPage.getByRole('button', { name: '历史', exact: true }).click();
  dialog = adminPage.getByRole('dialog', { name: '中继配置历史', exact: true });
  await dialog.getByText('当前 v5', { exact: false }).waitFor();
  await change({ config_version: 5, region_name: '历史并发修改' });
  historical = dialog.locator('article').filter({ has: adminPage.getByText('v2', { exact: true }) });
  adminPage.once('dialog', (native) => native.accept());
  await historical.getByRole('button', { name: '恢复此配置', exact: true }).click();
  await dialog.getByRole('alert').getByText('草稿保留', { exact: false }).waitFor();
  assert.equal((await read()).configVersion, 6);
  assert.equal(await adminPage.evaluate(() => sessionStorage.getItem('xunara.admin.token') !== null), true);
  await dialog.getByRole('button', { name: '刷新历史与基准', exact: true }).click();
  await dialog.getByText('当前 v6', { exact: false }).waitFor();
  adminPage.once('dialog', (native) => native.accept());
  await historical.getByRole('button', { name: '恢复此配置', exact: true }).click();
  await dialog.getByText('当前 v7', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();

  mark('relay-history-bounded-list-mobile-scroll-and-keyboard-focus');
  for (let version = 7; version < 59; version++) await change({ config_version: version, region_name: '上海维护区' });
  const historyResponse = await api(endpoint + '/history', platformToken, undefined, 'GET');
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.items.length, 50);
  assert.equal(history.items[0].config_version, 59);
  assert.equal(history.items.some((item) => Object.hasOwn(item, 'token') || Object.hasOwn(item, 'bytes_in')), false);
  const screenshotDirectory = process.env.SMOKE_SCREENSHOT_DIR;
  if (screenshotDirectory) fs.mkdirSync(screenshotDirectory, { recursive: true, mode: 0o700 });
  for (const [page, prefix] of [[userPage, 'user'], [adminPage, 'admin']]) {
    await page.getByRole('button', { name: '历史', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '中继配置历史', exact: true });
    await dialog.getByText('当前 v59', { exact: false }).waitFor();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
      assert.equal(await dialog.evaluate((element) => Array.from(element.querySelectorAll('*')).some((child) => child.scrollHeight > child.clientHeight && getComputedStyle(child).overflowY === 'auto')), true);
    }
    await dialog.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
    if (screenshotDirectory) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(screenshotDirectory, prefix + '-relay-history-mobile.png') });
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.body.style.overflow !== 'hidden'), true);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await adminPage.getByRole('button', { name: '刷新', exact: true }).click();
  await adminPage.locator('tbody').getByText('期望 v59', { exact: false }).waitFor();
}

module.exports = { runRelayHistorySmoke };
