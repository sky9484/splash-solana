import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const BASE='http://localhost:3100', OUT='/home/claude/render/cap/';
const HIDE = 'nextjs-portal, [data-nextjs-toast], #__next-build-watcher, [data-next-badge-root]{display:none!important}';
async function flow(page){
  await page.goto(`${BASE}/solana`,{waitUntil:'networkidle'});
  await page.evaluate(()=>localStorage.clear()); await page.reload({waitUntil:'networkidle'});
  await page.addStyleTag({content:HIDE});
  await page.getByRole('link',{name:'Start the demo'}).click();
  await page.getByLabel('Company name').fill('Selangor Trading Sdn Bhd');
  await page.getByLabel('Your name').fill('Aisyah Rahman');
  await page.getByRole('button',{name:'Continue'}).click();
  await page.getByRole('heading',{name:'Your recovery kit'}).waitFor();
  await page.getByRole('button',{name:'Show words'}).click();
  const words=await page.locator('.sx-words li').allInnerTexts();
  await page.getByRole('button',{name:'I’ve saved them'}).click();
  for(const label of await page.locator('form label[for^="w"]').allInnerTexts()){
    const idx=Number(label.replace(/\D/g,''))-1; await page.getByLabel(label,{exact:true}).fill(words[idx].trim());}
  await page.getByRole('button',{name:'Check words'}).click();
  await page.getByRole('button',{name:'Create the key on this device'}).click();
  await page.getByRole('heading',{name:'Create your vault'}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'Create vault'}).click();
  await page.getByRole('heading',{name:'Your vault is ready'}).waitFor({timeout:30000});
  await page.getByRole('link',{name:'Add test USDC'}).click();
  await page.getByRole('button',{name:'Add 25,000 test USDC (simulated)'}).click();
  await page.locator('.sx-balance-total',{hasText:'US$25,000.00'}).waitFor();
  await page.getByRole('link',{name:'Pay a supplier'}).first().click();
  await page.getByRole('button',{name:'Use the sample invoice'}).click();
  await page.getByRole('heading',{name:'Zeke’s draft'}).waitFor();
  await page.getByRole('button',{name:'Mark verified'}).click();
  await page.getByRole('heading',{name:'Bank details verified'}).waitFor();
  for(const b of await page.locator('.sx-tick input[type=checkbox]').all()) await b.check();
  await page.getByRole('button',{name:'Confirm and compare routes'}).click();
  await page.getByRole('radiogroup',{name:'Routes'}).waitFor();
  await page.getByRole('button',{name:/^Review /}).click();
  await page.locator('.sx-approve').waitFor();
}
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
// mobile @3x
{ const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:3}); const p=await ctx.newPage(); p.setDefaultTimeout(30000);
  await flow(p); await p.addStyleTag({content:HIDE});
  await p.getByRole('button',{name:'Approve with this device'}).click();
  await p.getByRole('heading',{name:/^Paid\. /}).waitFor({timeout:30000});
  await p.getByRole('link',{name:'Open receipt'}).click();
  await p.getByRole('heading',{name:'Verify this receipt'}).waitFor(); await p.addStyleTag({content:HIDE});
  await p.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(400);
  await p.screenshot({path:OUT+'m-receipt-top.png'}); await ctx.close(); }
// desktop @2x
{ const ctx=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2}); const p=await ctx.newPage(); p.setDefaultTimeout(30000);
  await flow(p); await p.addStyleTag({content:HIDE}); await p.waitForTimeout(300);
  await p.locator('.sx-approve').screenshot({path:OUT+'d-approve-card.png'});
  await p.getByRole('button',{name:'Approve with this device'}).click();
  await p.getByRole('heading',{name:/^Paid\. /}).waitFor({timeout:30000});
  await p.getByRole('link',{name:'Open receipt'}).click();
  await p.getByRole('heading',{name:'Verify this receipt'}).waitFor(); await p.addStyleTag({content:HIDE});
  const card=p.locator('section[aria-labelledby="verify-title"]');
  await p.getByRole('button',{name:'Verify',exact:true}).click();
  await p.getByText('Verified. This record matches the anchored root.').waitFor();
  await card.screenshot({path:OUT+'d-verify-pass.png'});
  await p.getByLabel('Tamper with a field (demo)').check();
  await p.getByRole('button',{name:'Verify',exact:true}).click();
  await p.getByText('Does not verify.').waitFor(); await p.waitForTimeout(300);
  await card.screenshot({path:OUT+'d-verify-tampered.png'}); await ctx.close(); }
await b.close(); console.log('done');
