const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');

async function runDeviceEnrollmentSmoke({ page, memberPage, origin, state, mark }) {
  assert.ok(path.basename(state).startsWith('xunara-console-smoke-'));
  assert.equal(fs.statSync(state).mode & 0o777, 0o700);
  const request = page.context().request;
  async function read(endpoint) { const response = await request.get(origin + endpoint); assert.equal(response.status(), 200); return response.json(); }
  async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); }
  const database = new DatabaseSync(path.join(state, 'state.db'));
  database.exec('PRAGMA busy_timeout=5000');
  const select = database.prepare("SELECT * FROM nodes WHERE stable_id = 'smoke-1'"); select.setReadBigInts(true);
  const original = select.get(); assert.ok(original);
  let issued;
  try {
    mark('device-token-real-once-issuance-and-one-copy-direct-command');
    await page.goto(origin + '/devices');
    await page.getByRole('button', { name: '添加设备', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '添加设备', exact: true });
    const baselineKeys = (await read('/api/v1/auth-keys')).authKeys.length;
    await dialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).check();
    const copy = dialog.getByRole('button', { name: '复制命令', exact: true });
    assert.equal(await copy.isDisabled(), true);
    assert.equal((await read('/api/v1/auth-keys')).authKeys.length, baselineKeys);
    const ttl = dialog.getByLabel('接入密钥有效期', { exact: true });
    await ttl.waitFor(); assert.equal(await ttl.inputValue(), '900');
    assert.equal(await dialog.locator('details').getAttribute('open'), null);
    assert.equal(await dialog.evaluate((element) => {
      const selector = element.querySelector('[aria-label="接入密钥有效期"]');
      const field = element.querySelector('[aria-label="设备预授权 Token"]');
      return Boolean(selector && field && !selector.closest('details') && (selector.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true);
    await ttl.selectOption('3600');
    if (process.env.SMOKE_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'add-device-order-mobile.png') });
    }
    await dialog.getByRole('button', { name: '生成一次性 Token', exact: true }).waitFor();
    const creation = page.waitForResponse((response) => response.url().endsWith('/api/v2/auth-keys/enrollment') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '生成一次性 Token', exact: true }).click();
    const response = await creation; assert.equal(response.status(), 201); issued = await response.json();
    assert.equal(response.request().postDataJSON().ttl_seconds, 3600);
    assert.equal(issued.reusable, false); assert.equal(issued.ephemeral, false);
    assert.ok(/^tskey-auth-[a-z2-7]{26}$/.test(issued.key));
    assert.ok(Date.parse(issued.expiry) > Date.now() + 59 * 60000 && Date.parse(issued.expiry) <= Date.now() + 60 * 60000);
    assert.equal(await ttl.inputValue(), '3600'); assert.equal(await ttl.isDisabled(), true);
    const field = dialog.getByLabel('设备预授权 Token', { exact: true });
    await page.waitForFunction(() => document.querySelector('input[aria-label="设备预授权 Token"]')?.value.startsWith('tskey-auth-'));
    assert.ok(await field.inputValue() === issued.key); assert.equal(await field.getAttribute('type'), 'password');
    const command = dialog.getByLabel('设备安装命令', { exact: true });
    let text = await command.textContent();
    assert.ok(text.includes('--auth-key=' + JSON.stringify(issued.key)));
    assert.ok(text.includes(origin)); assert.equal(text.split('\n').length, 2);
    assert.equal(/file:|stty|Read-Host|mktemp/.test(text), false);
    assert.equal(spawnSync('bash', ['-n'], { input: text }).status, 0);
    assert.equal(await dialog.getByRole('button', { name: '复制设备 Token（敏感）', exact: true }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: '下载私有一键加入脚本', exact: true }).count(), 0);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await copy.click();
    assert.ok(await page.evaluate(() => navigator.clipboard.readText()) === text);
    assert.equal(await copy.textContent(), '已复制');
    assert.equal(await dialog.getByRole('button', { name: '生成一次性 Token', exact: true }).count(), 0);
    await page.evaluate(() => navigator.clipboard.writeText(''));
    assert.equal(page.url().includes(issued.key), false);
    assert.equal(await page.evaluate((secret) => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(secret), issued.key), false);
    assert.equal((await read('/api/v1/auth-keys')).authKeys.some((key) => Object.values(key).includes(issued.key)), false);

    mark('device-token-mobile-primary-command-visible-and-advanced-collapsed');
    assert.equal(await copy.count(), 1);
    assert.equal(await copy.evaluate((element) => Boolean(element.closest('.modal-footer'))), true);
    assert.equal(await dialog.evaluate((element) => {
      const advanced = element.querySelector('details'), output = element.querySelector('.device-command-box');
      return Boolean(advanced && output && (advanced.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 }); await noOverflow();
      assert.equal(await dialog.locator('details').getAttribute('open'), null);
      const bounds = await copy.boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844);
      assert.equal(await dialog.getByLabel('安装设备名称', { exact: true }).isVisible(), false);
      if (width === 390 && process.env.SMOKE_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
        await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'simple-device-token-mobile.png') });
      }
    }

    mark('device-token-advanced-before-preview-and-fixed-copy-after-scrolling');
    await page.setViewportSize({ width: 390, height: 540 });
    await dialog.getByText('高级选项', { exact: true }).click();
    const hostname = dialog.getByLabel('安装设备名称', { exact: true });
    await hostname.fill('order-smoke');
    assert.ok((await command.textContent()).includes('--hostname="order-smoke"'));
    for (const bottom of [false, true]) {
      await dialog.locator('.card-body').evaluate((element, bottom) => { element.scrollTop = bottom ? element.scrollHeight : 0; }, bottom);
      await noOverflow(); const bounds = await copy.boundingBox();
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 540);
    }
    await copy.click();
    assert.ok(await page.evaluate(() => navigator.clipboard.readText()) === await command.textContent());
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await hostname.fill(''); await dialog.getByText('高级选项', { exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 844 });

    mark('device-token-clear-on-browser-mobile-close-and-no-mint-replay');
    await dialog.getByLabel('设备平台', { exact: true }).selectOption('windows');
    text = await command.textContent();
    assert.equal(text.split('\n').length, 1);
    assert.ok(text.includes('--auth-key=' + JSON.stringify(issued.key)));
    await dialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).uncheck();
    assert.equal((await command.textContent()).includes(issued.key), false);
    await dialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).check();
    assert.equal(await field.inputValue(), ''); assert.equal(await copy.isDisabled(), true);
    assert.equal(await ttl.isDisabled(), false);
    await field.fill(issued.key);
    assert.equal(await ttl.count(), 0);
    await dialog.getByText('已有 Token 的有效期由签发时决定，不会在这里修改。', { exact: true }).waitFor();
    await dialog.getByLabel('设备平台', { exact: true }).selectOption('android');
    assert.equal(await field.count(), 0); assert.equal(await command.count(), 0);
    assert.equal((await dialog.innerText()).includes(issued.key), false);
    const copyAddress = dialog.getByRole('button', { name: '复制控制面地址', exact: true });
    assert.equal(await copyAddress.count(), 1);
    assert.equal(await copyAddress.evaluate((element) => Boolean(element.closest('.modal-footer'))), true);
    await copyAddress.click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), origin);
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await dialog.getByLabel('设备平台', { exact: true }).selectOption('linux');
    await dialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).check();
    assert.equal(await field.inputValue(), ''); await field.fill(issued.key);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '添加设备', exact: true }).click();
    await dialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).check();
    assert.equal(await field.inputValue(), '');
    assert.equal((await read('/api/v1/auth-keys')).authKeys.length, baselineKeys + 1);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    assert.ok((await read('/api/v1/auth-keys')).authKeys.some((key) => key.id === issued.id && !key.used));

    mark('device-token-unknown-authority-no-mint-and-member-read-only');
    await page.route('**/api/v2/auth-keys/enrollment', (route) => route.fulfill({ status: 503, contentType: 'application/json', json: { error: '密钥权限读取失败（隔离验收）' } }));
    await page.getByRole('button', { name: '添加设备', exact: true }).click();
    await dialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).check();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('button', { name: '生成一次性 Token', exact: true }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: '复制命令', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await page.unroute('**/api/v2/auth-keys/enrollment');
    await memberPage.goto(origin + '/devices');
    assert.equal(await memberPage.getByRole('button', { name: '有效期设置', exact: false }).count(), 0);
    await memberPage.getByRole('button', { name: '添加设备', exact: true }).click();
    const memberDialog = memberPage.getByRole('dialog', { name: '添加设备', exact: true });
    await memberDialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).check();
    await memberDialog.getByText('生成密钥需要网络管理员权限；可以使用管理员提供的设备 Auth Key。', { exact: true }).waitFor();
    assert.equal(await memberDialog.getByRole('button', { name: '生成一次性 Token', exact: true }).count(), 0);
    const memberMetadata = await memberPage.context().request.get(origin + '/api/v2/auth-keys/enrollment');
    const memberView = await memberMetadata.json(); assert.equal(memberView.can_manage, false);
    const denied = await memberPage.context().request.post(origin + '/api/v2/auth-keys/enrollment', { headers: { 'X-CSRF-Token': memberView.csrf_token }, data: { ttl_seconds: 900 } });
    assert.equal(denied.status(), 403); await memberDialog.getByRole('button', { name: '关闭', exact: true }).click();

    mark('device-expiry-settings-server-clock-duration-mobile-and-local-date');
    const lifecycle = '/api/v2/machines/smoke-1/lifecycle', settingsEndpoint = '/api/v2/machines/smoke-1/expiry';
    const initial = await read(lifecycle);
    const deniedExpiry = await memberPage.context().request.post(origin + settingsEndpoint, { headers: { 'X-CSRF-Token': memberView.csrf_token }, data: { revision: initial.revision, mode: 'disable' } });
    assert.equal(deniedExpiry.status(), 403);
    await page.goto(origin + '/devices/' + initial.machine.id);
    const openSettings = async () => {
      await page.getByRole('button', { name: '有效期设置', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '设备有效期设置', exact: true });
      await dialog.getByLabel('过期方式', { exact: true }).waitFor();
    };
    const choose = async (mode) => dialog.getByLabel('过期方式', { exact: true }).selectOption(mode);
    const saveSetting = async (confirmation) => {
      await dialog.getByRole('checkbox', { name: confirmation, exact: true }).check();
      const pending = page.waitForResponse((response) => response.url().endsWith(settingsEndpoint) && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: '保存有效期', exact: true }).click();
      const response = await pending; assert.equal(response.status(), 200);
      await dialog.waitFor({ state: 'detached' }); return response.json();
    };
    await openSettings(); await choose('schedule');
    await dialog.getByLabel('有效期', { exact: true }).selectOption('30');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 }); await noOverflow();
      const bounds = await dialog.getByRole('button', { name: '保存有效期', exact: true }).boundingBox();
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844);
      if (width === 390 && process.env.SMOKE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'device-expiry-mobile.png') });
    }
    const future = await saveSetting('确认修改此设备的密钥到期时间');
    assert.ok(Math.abs(Date.parse(future.machine.expires) - Date.parse(future.server_time) - 30 * 86400000) < 5000);
    await openSettings(); assert.equal(await dialog.getByLabel('有效期', { exact: true }).inputValue(), 'custom');
    const date = dialog.getByLabel('到期时间（本地时区）', { exact: true });
    await date.fill('2020-01-01T00:00');
    await dialog.getByRole('status').filter({ hasText: '未来 180 天' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '保存有效期', exact: true }).isDisabled(), true);
    const selectedDate = await page.evaluate(() => {
      const value = new Date(Date.now() + 2 * 86400000); value.setSeconds(0, 0);
      const pad = (number) => String(number).padStart(2, '0');
      return { local: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`, utc: value.toISOString() };
    });
    await date.fill(selectedDate.local);
    const exact = await saveSetting('确认修改此设备的密钥到期时间');
    assert.equal(Date.parse(exact.machine.expires), Date.parse(selectedDate.utc));

    mark('device-expiry-disable-durable-null-and-no-duplicate-audit');
    await openSettings(); await choose('disable');
    await dialog.getByText('密钥不再自动过期，仅建议用于可信的服务器或路由设备。', { exact: true }).waitFor();
    const disabled = await saveSetting('我信任此设备，确认关闭自动过期');
    assert.equal(disabled.machine.expires, undefined); assert.equal(select.get().expiry, null);
    const auditBefore = database.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE action = 'node.expiry_disabled' AND target = 'node:smoke-1'").get().total;
    await openSettings(); await choose('disable'); await saveSetting('我信任此设备，确认关闭自动过期');
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE action = 'node.expiry_disabled' AND target = 'node:smoke-1'").get().total, auditBefore);

    mark('device-expiry-list-detail-mobile-confirmation-and-mandatory-audit-rollback');
    const view = await read('/api/v2/machines/smoke-1/lifecycle');
    const endpoint = '/api/v2/machines/smoke-1/expire';
    await page.goto(origin + '/devices/' + view.machine.id);
    await openSettings(); await choose('expire');
    const confirm = dialog.getByRole('button', { name: '确认立即过期', exact: true });
    await confirm.waitFor(); assert.equal(await confirm.isDisabled(), true);
    for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); }
    const checkbox = dialog.getByRole('checkbox', { name: '我已准备好重新认证方式，确认让此设备立即过期', exact: true });
    database.exec("CREATE TRIGGER reject_browser_device_expiry BEFORE INSERT ON audit_events WHEN NEW.action = 'node.expired' BEGIN SELECT RAISE(IGNORE); END");
    await checkbox.check();
    const failureResponse = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await confirm.click(); assert.equal((await failureResponse).status(), 503);
    await dialog.getByRole('alert').filter({ hasText: '不自动重试' }).waitFor();
    assert.equal(await confirm.isDisabled(), true); assert.equal(select.get().expiry, original.expiry);
    database.exec('DROP TRIGGER reject_browser_device_expiry');
    await dialog.getByRole('button', { name: '读取最新设备状态', exact: true }).click(); await dialog.getByLabel('过期方式', { exact: true }).waitFor(); await choose('expire'); await checkbox.waitFor();

    mark('device-expiry-cas-no-auto-retry-reauth-warning-and-fact-preservation');
    const changedExpiry = BigInt(Date.now() + 3600000) * 1000000n;
    database.prepare("UPDATE nodes SET expiry = ? WHERE stable_id = 'smoke-1'").run(changedExpiry);
    await checkbox.check();
    const conflict = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await confirm.click(); assert.equal((await conflict).status(), 409);
    await dialog.getByRole('alert').filter({ hasText: '设备身份或有效期已变化' }).waitFor();
    assert.equal(select.get().expiry, changedExpiry); assert.equal(await confirm.isDisabled(), true);
    await dialog.getByRole('button', { name: '读取最新设备状态', exact: true }).click(); await dialog.getByLabel('过期方式', { exact: true }).waitFor(); await choose('expire'); await checkbox.waitFor();
    assert.equal(await checkbox.isChecked(), false); assert.equal(await confirm.isDisabled(), true);
    await checkbox.check(); const success = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await confirm.click(); assert.equal((await success).status(), 200); await dialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '有效期设置', exact: true }).waitFor();
    const updated = select.get(); assert.ok(updated.expiry < BigInt(Date.now()) * 1000000n);
    assert.deepEqual({ ...updated, expiry: original.expiry }, { ...original });
    await page.goto(origin + '/devices');
    const row = page.locator('tbody tr').filter({ hasText: view.machine.hostname });
    const entry = row.getByRole('button', { name: '有效期设置 ' + view.machine.hostname, exact: true });
    assert.equal(await entry.isDisabled(), false);
    assert.ok(database.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE action = 'node.expired' AND target = 'node:smoke-1'").get().total >= 1);

    mark('device-expiry-expired-list-recovery-window-and-no-silent-renewal');
    await entry.click(); dialog = page.getByRole('dialog', { name: '设备有效期设置', exact: true });
    await dialog.getByRole('button', { name: '临时续期 30 分钟', exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('过期方式', { exact: true }).inputValue(), 'extend');
    assert.deepEqual(await dialog.getByLabel('过期方式', { exact: true }).locator('option').allTextContents(), ['临时续期 30 分钟']);
    const recovery = await read(lifecycle);
    const bypass = await request.post(origin + settingsEndpoint, { headers: { 'X-CSRF-Token': recovery.csrf_token }, data: { revision: recovery.revision, mode: 'disable' } });
    assert.equal(bypass.status(), 409);
    await dialog.getByRole('checkbox', { name: '确认临时恢复此设备 30 分钟', exact: true }).check();
    const extension = page.waitForResponse((response) => response.url().endsWith(settingsEndpoint) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '临时续期 30 分钟', exact: true }).click();
    const restored = await (await extension).json();
    assert.equal(restored.machine.expired, false);
    assert.ok(Math.abs(Date.parse(restored.machine.expires) - Date.parse(restored.server_time) - 1800000) < 5000);
    await dialog.waitFor({ state: 'detached' });
    const recoveredFacts = select.get(); assert.deepEqual({ ...recoveredFacts, expiry: original.expiry }, { ...original });
    const duplicate = await request.post(origin + settingsEndpoint, { headers: { 'X-CSRF-Token': restored.csrf_token }, data: { revision: restored.revision, mode: 'extend' } });
    assert.equal(duplicate.status(), 409);

    mark('device-expiry-clock-transition-requires-fresh-recovery-confirmation');
    const closingWindow = await request.post(origin + settingsEndpoint, { headers: { 'X-CSRF-Token': restored.csrf_token }, data: { revision: restored.revision, mode: 'schedule', duration_seconds: 3 } });
    assert.equal(closingWindow.status(), 200);
    await page.goto(origin + '/devices/' + initial.machine.id); await openSettings();
    await dialog.getByRole('alert').filter({ hasText: '设备在此期间已到期' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '临时续期 30 分钟', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: '读取最新设备状态', exact: true }).click();
    await dialog.getByRole('checkbox', { name: '确认临时恢复此设备 30 分钟', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('checkbox', { name: '确认临时恢复此设备 30 分钟', exact: true }).isChecked(), false);
    assert.equal(await dialog.getByRole('button', { name: '临时续期 30 分钟', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_browser_device_expiry');
    database.prepare("UPDATE nodes SET expiry = ? WHERE stable_id = 'smoke-1'").run(original.expiry);
    database.close();
    if (issued) { const metadata = await read('/api/v2/auth-keys/enrollment'); const response = await request.delete(origin + '/api/v1/auth-keys/' + issued.id, { headers: { 'X-CSRF-Token': metadata.csrf_token } }); assert.equal(response.status(), 200); }
  }
}
module.exports = { runDeviceEnrollmentSmoke };
