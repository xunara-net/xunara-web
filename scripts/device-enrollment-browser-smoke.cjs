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
    await dialog.getByRole('button', { name: '生成一次性 Token', exact: true }).waitFor();
    const creation = page.waitForResponse((response) => response.url().endsWith('/api/v2/auth-keys/enrollment') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '生成一次性 Token', exact: true }).click();
    const response = await creation; assert.equal(response.status(), 201); issued = await response.json();
    assert.equal(issued.reusable, false); assert.equal(issued.ephemeral, false);
    assert.ok(/^tskey-auth-[a-z2-7]{26}$/.test(issued.key));
    assert.ok(Date.parse(issued.expiry) > Date.now() + 14 * 60000 && Date.parse(issued.expiry) <= Date.now() + 15 * 60000);
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

    mark('device-token-clear-on-browser-mobile-close-and-no-mint-replay');
    await dialog.getByLabel('设备平台', { exact: true }).selectOption('windows');
    text = await command.textContent();
    assert.equal(text.split('\n').length, 1);
    assert.ok(text.includes('--auth-key=' + JSON.stringify(issued.key)));
    await dialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).uncheck();
    assert.equal((await command.textContent()).includes(issued.key), false);
    await dialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).check();
    assert.equal(await field.inputValue(), ''); assert.equal(await copy.isDisabled(), true);
    await field.fill(issued.key);
    await dialog.getByLabel('设备平台', { exact: true }).selectOption('android');
    assert.equal(await field.count(), 0); assert.equal(await command.count(), 0);
    assert.equal((await dialog.innerText()).includes(issued.key), false);
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
    assert.equal(await memberPage.getByRole('button', { name: '立即过期', exact: false }).count(), 0);
    await memberPage.getByRole('button', { name: '添加设备', exact: true }).click();
    const memberDialog = memberPage.getByRole('dialog', { name: '添加设备', exact: true });
    await memberDialog.getByRole('checkbox', { name: '使用 Token 免网页登录', exact: true }).check();
    await memberDialog.getByText('生成密钥需要网络管理员权限；可以使用管理员提供的设备 Auth Key。', { exact: true }).waitFor();
    assert.equal(await memberDialog.getByRole('button', { name: '生成一次性 Token', exact: true }).count(), 0);
    const memberMetadata = await memberPage.context().request.get(origin + '/api/v2/auth-keys/enrollment');
    const memberView = await memberMetadata.json(); assert.equal(memberView.can_manage, false);
    const denied = await memberPage.context().request.post(origin + '/api/v2/auth-keys/enrollment', { headers: { 'X-CSRF-Token': memberView.csrf_token }, data: { ttl_seconds: 900 } });
    assert.equal(denied.status(), 403); await memberDialog.getByRole('button', { name: '关闭', exact: true }).click();

    mark('device-expiry-list-detail-mobile-confirmation-and-mandatory-audit-rollback');
    const view = await read('/api/v2/machines/smoke-1/lifecycle');
    const endpoint = '/api/v2/machines/smoke-1/expire';
    await page.goto(origin + '/devices/' + view.machine.id);
    await page.getByRole('button', { name: '立即过期', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '立即使设备过期', exact: true });
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
    await dialog.getByRole('button', { name: '读取最新设备状态', exact: true }).click(); await checkbox.waitFor();

    mark('device-expiry-cas-no-auto-retry-reauth-warning-and-fact-preservation');
    const changedExpiry = BigInt(Date.now() + 3600000) * 1000000n;
    database.prepare("UPDATE nodes SET expiry = ? WHERE stable_id = 'smoke-1'").run(changedExpiry);
    await checkbox.check();
    const conflict = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await confirm.click(); assert.equal((await conflict).status(), 409);
    await dialog.getByRole('alert').filter({ hasText: '设备身份或有效期已变化' }).waitFor();
    assert.equal(select.get().expiry, changedExpiry); assert.equal(await confirm.isDisabled(), true);
    await dialog.getByRole('button', { name: '读取最新设备状态', exact: true }).click(); await checkbox.waitFor();
    assert.equal(await checkbox.isChecked(), false); assert.equal(await confirm.isDisabled(), true);
    await checkbox.check(); const success = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await confirm.click(); assert.equal((await success).status(), 200); await dialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '设备已过期', exact: true }).waitFor();
    const updated = select.get(); assert.ok(updated.expiry < BigInt(Date.now()) * 1000000n);
    assert.deepEqual({ ...updated, expiry: original.expiry }, { ...original });
    await page.goto(origin + '/devices');
    const row = page.locator('tbody tr').filter({ hasText: view.machine.hostname });
    assert.equal(await row.getByRole('button', { name: '立即过期 ' + view.machine.hostname, exact: true }).isDisabled(), true);
    assert.ok(database.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE action = 'node.expired' AND target = 'node:smoke-1'").get().total >= 1);
  } finally {
    database.exec('DROP TRIGGER IF EXISTS reject_browser_device_expiry');
    database.prepare("UPDATE nodes SET expiry = ? WHERE stable_id = 'smoke-1'").run(original.expiry);
    database.close();
    if (issued) { const metadata = await read('/api/v2/auth-keys/enrollment'); const response = await request.delete(origin + '/api/v1/auth-keys/' + issued.id, { headers: { 'X-CSRF-Token': metadata.csrf_token } }); assert.equal(response.status(), 200); }
  }
}
module.exports = { runDeviceEnrollmentSmoke };
