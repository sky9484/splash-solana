import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync } from 'fs';
const icons = JSON.parse(readFileSync('isoicons3.json','utf8'));
const DEFS = readFileSync('iso3.py','utf8').split("DEFS='''")[1].split("'''")[0];
mkdirSync('isoicons3',{recursive:true});
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 2 });
for (const [name, svg] of Object.entries(icons)) {
  await p.setContent(`<html><body style="margin:0;background:transparent"><svg width="512" height="512" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">${DEFS}${svg}</svg></body></html>`);
  await p.screenshot({ path: `isoicons3/${name}.png`, omitBackground: true });
}
const cells = Object.entries(icons).map(([n,s])=>`<div style="text-align:center;font:500 18px Geist,sans-serif;color:#326273"><svg width="300" height="300" viewBox="0 0 400 400">${DEFS}${s}</svg><div>${n}</div></div>`).join('');
await p.setViewportSize({ width: 1400, height: 1150 });
await p.setContent(`<html><head><style>@font-face{font-family:Geist;src:url(file://${process.cwd()}/Geist-Variable.woff2)}</style></head><body style="margin:0;background:#F6F0ED;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:30px">${cells}</body></html>`);
await p.screenshot({ path: 'isoicons3/00-preview-sheet.png' });
await b.close(); console.log('ok');
