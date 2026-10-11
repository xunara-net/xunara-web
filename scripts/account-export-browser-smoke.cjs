const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

async function runAccountExportSmoke({ page, origin, databaseFile, mark }) {
  const endpoint = '**/api/v1/account/export';
  let downloads = 0;
  const countDownload = () => { downloads++; };
  page.on('download', countDownload);
  function database(options = {}) {
    const connection = new DatabaseSync(databaseFile, options);
    connection.exec('PRAGMA busy_timeout = 5000');
    return connection;
  }
  await page.addInitScript(() => {
    window.exportURLs = new Set();
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); window.exportURLs.add(url); return url; };
    URL.revokeObjectURL = (url) => { window.exportURLs.delete(url); revoke(url); };
  });
  async function open() {
    await page.goto(origin + '/settings');
    await page.locator('.account-export > summary').waitFor();
    assert.equal(await page.locator('.account-export').evaluate((element) => element.open), false);
    await page.locator('.account-export > summary').click();
    await page.getByRole('button', { name: '确认并下载', exact: true }).waitFor();
  }
  async function acknowledge() { await page.locator('.export-confirm input').check(); }
  async function save() {
    await acknowledge();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '确认并下载', exact: true }).click();
    const file = await downloaded;
    assert.equal(file.suggestedFilename().startsWith('xunara-'), true);
    const contents = fs.readFileSync(await file.path(), 'utf8');
    await file.delete();
    await page.waitForFunction(() => window.exportURLs.size === 0);
    assert.equal(await page.locator('.export-confirm input').isChecked(), false);
    return contents;
  }
  try {
    mark('account-export-private-json-real-download-own-snapshot-and-cleanup');
    await open();
    assert.equal(await page.getByRole('button', { name: '确认并下载', exact: true }).isDisabled(), true);
    const account = await page.evaluate(async () => (await fetch('/api/v1/account')).json());
    const cookies = await page.context().cookies(origin);
    const own = JSON.parse(await save());
    assert.equal(own.account.id, account.user.id);
    assert.equal(own.schema_version, 1); assert.equal(own.scope, 'account-security');
    assert.equal(own.login_history.length > 10, true);
    assert.equal(own.active_sessions.length, 1);
    assert.equal(Object.hasOwn(own, 'csrf_token'), false);
    const text = JSON.stringify(own);
    assert.equal(text.includes(account.csrf_token), false);
    for (const cookie of cookies) assert.equal(text.includes(cookie.value), false);
    const inspected = database({ readOnly: true });
    try {
      assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='account.export_prepared' AND actor=?").get('user:' + account.user.id).count, 1);
    } finally { inspected.close(); }

    mark('account-export-mobile-csv-and-inclusive-local-date-range');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('导出内容', { exact: true }).selectOption('csv');
    const csv = await save();
    assert.equal(csv.replace(/^\uFEFF/, '').startsWith('记录标识,登录方式,记录类型,'), true);
    assert.equal(csv.includes('private-export-subject'), false);
    await page.getByLabel('导出内容', { exact: true }).selectOption('json');
    const tomorrow = await page.evaluate(() => {
      const date = new Date(); date.setDate(date.getDate() + 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    await page.getByLabel('登录记录开始日期（可选）', { exact: true }).fill(tomorrow);
    await page.getByLabel('结束日期（包含当天，可选）', { exact: true }).fill(tomorrow);
    const filtered = JSON.parse(await save());
    assert.equal(filtered.login_history.length, 0); assert.equal(filtered.active_sessions.length, 1);
    assert.equal(filtered.account.id, account.user.id);
    await page.getByLabel('登录记录开始日期（可选）', { exact: true }).fill('');
    await page.getByLabel('结束日期（包含当天，可选）', { exact: true }).fill('');

    mark('account-export-malformed-response-and-manual-cancellation-save-no-file');
    await page.route(endpoint, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>isolated malformed export</html>' }));
    await acknowledge(); await page.getByRole('button', { name: '确认并下载', exact: true }).click();
    await page.getByText('导出响应不完整或版本不匹配', { exact: false }).waitFor();
    assert.equal(downloads, 3);
    await page.unroute(endpoint);
    let release, arrived, handled;
    const held = new Promise((resolve) => { release = resolve; });
    const entered = new Promise((resolve) => { arrived = resolve; });
    const finished = new Promise((resolve) => { handled = resolve; });
    await page.route(endpoint, async (route) => { arrived(); await held; try { await route.abort('failed'); } catch {} finally { handled(); } });
    await acknowledge(); await page.getByRole('button', { name: '确认并下载', exact: true }).click();
    await entered;
    await page.getByRole('button', { name: '取消导出', exact: true }).click();
    await page.getByText('已取消导出，未发起文件下载。', { exact: true }).waitFor();
    release(); await finished; await page.unroute(endpoint);
    assert.equal(downloads, 3);

    mark('account-export-real-audit-fault-rejects-entire-file-keeps-cookie');
    const fault = database();
    try { fault.exec("CREATE TRIGGER account_export_audit_fault BEFORE INSERT ON audit_events WHEN NEW.action='account.export_prepared' BEGIN SELECT RAISE(IGNORE); END"); } finally { fault.close(); }
    const before = await page.context().cookies(origin);
    await acknowledge(); await page.getByRole('button', { name: '确认并下载', exact: true }).click();
    await page.getByText('暂时无法准备导出', { exact: false }).waitFor();
    assert.equal(downloads, 3); assert.deepEqual(await page.context().cookies(origin), before);
    const cleanup = database();
    try { cleanup.exec('DROP TRIGGER account_export_audit_fault'); } finally { cleanup.close(); }

    mark('account-export-real-row-bound-and-persistent-admission-no-truncation');
    // 明确的规模种子，不在公网创建记录，也不冒充 5000 次真实登录。
    const seeded = database();
    try {
      seeded.prepare(`WITH RECURSIVE samples(number) AS (SELECT 1 UNION ALL SELECT number+1 FROM samples WHERE number < 5001)
        INSERT INTO account_login_records(id,user_id,auth_method,kind,created_at,expires_at,revoked_reason,client_ip,user_agent)
        SELECT printf('export-scale-%05d',number),?,'local','legacy',?,?, '', '', '' FROM samples`).run(
          account.user.id, BigInt(Date.now()) * 1000000n, BigInt(Date.now() + 3600000) * 1000000n);
    } finally { seeded.close(); }
    const bounded = page.waitForResponse((response) => response.url() === origin + '/api/v1/account/export' && response.request().method() === 'POST');
    await acknowledge(); await page.getByRole('button', { name: '确认并下载', exact: true }).click();
    assert.equal((await bounded).status(), 413);
    await page.getByText('数据超过导出上限', { exact: false }).waitFor();
    assert.equal(downloads, 3);
    const pruned = database();
    try { pruned.exec("DELETE FROM account_login_records WHERE id LIKE 'export-scale-%'"); } finally { pruned.close(); }
    await acknowledge(); await page.getByRole('button', { name: '确认并下载', exact: true }).click();
    await page.getByText('导出请求过多', { exact: false }).waitFor();
    assert.equal(downloads, 3);
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.equal(storage.includes('account-security') || storage.includes('login_history'), false);
    assert.equal(page.url().includes(account.csrf_token), false);
  } finally {
    page.off('download', countDownload);
  }
}

module.exports = { runAccountExportSmoke };
