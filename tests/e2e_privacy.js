const { chromium } = require('playwright-core'); const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, 'test_index.html'), 'utf8'), PRIV = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  for (const [w, scheme] of [[1280, 'light'], [390, 'dark']]) {
    const c = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    await c.route('**/*', (r) => { const u = r.request().url(); if (u.endsWith('/editorial_pm/privacy.html')) return r.fulfill({ contentType: 'text/html', body: PRIV }); if (u.startsWith('https://studio-pastel.github.io/')) return r.fulfill({ contentType: 'text/html', body: HTML }); if (u.includes('gsi/client')) return r.fulfill({ contentType: 'application/javascript', body: 'window.google={accounts:{id:{initialize(){},renderButton(e){e.textContent="[Google]"}}}}' }); return r.abort(); });
    const p = await c.newPage();
    await p.goto('https://studio-pastel.github.io/editorial_pm/'); await p.waitForTimeout(500);
    const href = await p.locator('#landing a[href="privacy.html"]').count();
    await p.goto('https://studio-pastel.github.io/editorial_pm/?sheet=TESTSHEET000000000000000000000000000000000A'); await p.waitForTimeout(500);
    const href2 = await p.locator('#login a[href="privacy.html"]').isVisible();
    await p.click('#login a[href="privacy.html"]'); await p.waitForTimeout(400);
    const t = await p.title(), sw = await p.evaluate(() => document.documentElement.scrollWidth);
    const good = href === 1 && href2 && t === 'プライバシーポリシー — エディトリアルPM' && sw <= w;
    console.log((good ? 'PASS ' : 'FAIL ') + w + 'px ' + scheme + ': links on landing and sign-in, page opens, no horizontal scroll (' + sw + ')');
    if (!good) process.exitCode = 1;
    await p.screenshot({ path: path.join(__dirname, 'out', 'priv_' + w + '.png'), fullPage: false });
  }
  await b.close();
  console.log(process.exitCode ? 'FAILED' : 'ALL PASSED');
})();
