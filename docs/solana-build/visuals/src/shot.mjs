import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [,, input, out, w, h, clear] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
await p.goto('file://' + process.cwd() + '/' + input); await p.waitForTimeout(400);
await p.screenshot({ path: out, omitBackground: clear === '1' }); await b.close();
