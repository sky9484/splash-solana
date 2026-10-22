/**
 * A small browser driver over the Chrome DevTools Protocol, for the walkthrough in
 * tests/solana-ui.e2e.mjs. It drives an installed Chrome or Edge in headless mode with
 * a throwaway profile, so the walkthrough needs no npm package and no browser download.
 *
 * It finds elements the way a person does: a button, link or heading by its visible name, a
 * field by its label. Clicks and typing go through the DOM (React sees the same events a
 * click or keystroke makes). Node 22+ for the global WebSocket.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** The first installed Chrome/Edge/Chromium, or null. */
export function findChrome() {
  return CANDIDATES.find((p) => p && existsSync(p)) ?? null;
}

/** `profileDir`: keep the browser profile (cookies, IndexedDB with the device key) between runs. */
export async function launch({ executable = findChrome(), timeoutMs = 30_000, profileDir = null } = {}) {
  if (!executable) throw new Error('No Chrome, Edge or Chromium found; set CHROME_PATH');
  const profile = profileDir ?? mkdtempSync(path.join(tmpdir(), 'splash-e2e-'));
  const proc = spawn(
    executable,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let err = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start: ${err.slice(-400)}`)), timeoutMs);
    proc.stderr.on('data', (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on('exit', (code) => reject(new Error(`Chrome exited (${code}): ${err.slice(-400)}`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`.trim()));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  // A command Chrome never answers (a page whose main thread is stuck) fails with its name after
  // 90 s, so a walkthrough reports where it stopped instead of waiting out its whole time limit.
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`Chrome did not answer ${method} within 90 s (the page may be stuck)`));
      }, 90_000);
      pending.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  async function newPage({ width, height }) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    return createPage(call, (fn) => {
      const l = (msg) => msg.sessionId === sessionId && fn(msg);
      listeners.add(l);
      return () => listeners.delete(l);
    }, { width, height });
  }

  async function close() {
    try {
      await send('Browser.close');
    } catch {
      proc.kill();
    }
    await new Promise((r) => (proc.exitCode !== null ? r() : proc.on('exit', r)));
    ws.close();
    if (!profileDir) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  return { newPage, close };
}

async function createPage(call, subscribe, viewport) {
  let { width, height } = viewport;
  const requests = [];
  const errors = [];
  /** requestId → URL, so a request that never finishes can be named. */
  const inflight = new Map();
  /** Requests a waitIdle gave up on (still in flight at its timeout). */
  const stuck = [];
  let lastActivity = Date.now();
  subscribe((msg) => {
    const p = msg.params;
    if (msg.method === 'Network.requestWillBeSent') {
      inflight.set(p.requestId, p.request.url);
      lastActivity = Date.now();
      requests.push({ url: p.request.url, method: p.request.method, body: p.request.postData ?? '', headers: JSON.stringify(p.request.headers) });
    } else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') {
      inflight.delete(p.requestId);
      lastActivity = Date.now();
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'exception');
    } else if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
      errors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable', { maxPostDataSize: 65_536 });
  let mobile = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Resizes the page; under 768 px it is a phone (mobile viewport, touch). */
  async function setViewport(w, h) {
    width = w;
    height = h;
    mobile = w < 768;
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    await sleep(300);
  }
  await setViewport(width, height);

  /** Runs `fn` in the page with JSON arguments; returns its (awaited) JSON result. */
  async function evaluate(fn, ...args) {
    const res = await call('Runtime.evaluate', {
      expression: `(${fn})(...${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value;
  }

  async function waitIdle({ quietMs = 500, timeoutMs = 30_000 } = {}) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const ready = await evaluate(() => document.readyState).catch(() => 'loading');
      if (ready === 'complete' && inflight.size === 0 && Date.now() - lastActivity >= quietMs) return;
      await sleep(100);
    }
    stuck.push(...inflight.values());
  }

  async function goto(url) {
    await call('Page.navigate', { url });
    await waitIdle();
  }

  /** Polls `fn` in the page until it returns something truthy. */
  async function waitFor(fn, args = [], { timeoutMs = 30_000, what = 'condition' } = {}) {
    const end = Date.now() + timeoutMs;
    let last;
    while (Date.now() < end) {
      try {
        last = await evaluate(fn, ...args);
        if (last) return last;
      } catch {
        /* navigating: try again */
      }
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  // The in-page finder. Kept as a string so it is defined once and shared by every lookup.
  const FIND = `(role, name, exact) => {
    const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').replace(/[\\u2018\\u2019]/g, "'").trim();
    const want = typeof name === 'string' ? norm(name) : '';
    // innerText carries the CSS: lines set as separate spans read "abroad.Prove", and text-transform
    // makes "PAY SUPPLIERS". Plain names compare without spaces or case; a pattern sees the text as it reads.
    const squash = (s) => s.replace(/\\s+/g, '').toLowerCase();
    const match = (s) => { const t = norm(s); return name instanceof Object ? new RegExp(name.source, name.flags).test(t) : exact ? squash(t) === squash(want) : squash(t) === squash(want) || squash(t).startsWith(squash(want)); };
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
    const sel = { button: 'button, [role=button], input[type=submit]', link: 'a[href]', heading: 'h1, h2, h3, h4, [role=heading]', text: 'p, h1, h2, h3, h4, li, span, div, dd, td, strong' }[role];
    const all = [...document.querySelectorAll(sel)].filter(visible);
    return all.find((el) => match(el.getAttribute('aria-label')) || match(el.innerText ?? el.textContent)) ?? null;
  }`;

  const pattern = (name) => (name instanceof RegExp ? { source: name.source, flags: name.flags } : name);

  async function find(role, name, { exact = false, timeoutMs = 30_000 } = {}) {
    return waitFor(
      new Function('role', 'name', 'exact', `const f = ${FIND}; document.querySelectorAll('[data-e2e-hit]').forEach((e) => e.removeAttribute('data-e2e-hit')); const el = f(role, name, exact); if (!el) return false; el.setAttribute('data-e2e-hit', '1'); return true;`),
      [role, pattern(name), exact],
      { timeoutMs, what: `${role} "${name}"` },
    );
  }

  async function click(role, name, opts = {}) {
    await find(role, name, opts);
    await waitFor(() => {
      const el = document.querySelector('[data-e2e-hit]');
      return el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    }, [], { what: `${role} "${name}" to be enabled` });
    await evaluate(() => {
      const el = document.querySelector('[data-e2e-hit]');
      el.removeAttribute('data-e2e-hit');
      el.scrollIntoView({ block: 'center' });
      el.click();
    });
    await waitIdle({ quietMs: 300 });
  }

  /** The text field, select or checkbox a <label> names (by `for`, by nesting, or aria-label). */
  const FIELD = `(label) => {
    const norm = (s) => (s ?? '').replace(/\\s+/g, '').replace(/[\\u2018\\u2019]/g, "'").toLowerCase();
    const want = norm(label);
    for (const l of document.querySelectorAll('label')) {
      if (norm(l.innerText || l.textContent) !== want) continue;
      const el = l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector('input, select, textarea');
      if (el) return el;
    }
    return [...document.querySelectorAll('input, select, textarea')].find((el) => norm(el.getAttribute('aria-label')) === want) ?? null;
  }`;

  async function fill(label, value) {
    await waitFor(new Function('label', `return !!(${FIELD})(label);`), [label], { what: `field "${label}"` });
    await evaluate(
      new Function('label', 'value', `
        const el = (${FIELD})(label);
        el.scrollIntoView({ block: 'center' });
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
        if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new Event('change', { bubbles: true }));
      `),
      label,
      value,
    );
  }

  async function check(label) {
    await evaluate(new Function('label', `const el = (${FIELD})(label); if (!el.checked) el.click();`), label);
  }

  async function text(selector) {
    return evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.innerText), selector);
  }

  async function screenshot(file) {
    await sleep(250);
    const { cssContentSize } = await call('Page.getLayoutMetrics');
    // An open sheet or dialog is fixed to the viewport: a full-page capture stretches it over the page
    // behind and composites the two, so it is shot as a person sees it, one viewport tall.
    const overlay = await evaluate(() => !!document.querySelector('.iso-sheet-root, .iso-modal-root'));
    if (overlay) {
      // The visible viewport exactly as it is (scrolled where the person is), not a page-sized clip.
      const format = file.endsWith('.webp') ? 'webp' : file.endsWith('.jpg') ? 'jpeg' : 'png';
      const { data } = await call('Page.captureScreenshot', { format, ...(format === 'png' ? {} : { quality: 88 }), captureBeyondViewport: false });
      writeFileSync(file, Buffer.from(data, 'base64'));
      return;
    }
    const h = Math.ceil(Math.max(cssContentSize.height, height));
    await call('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile });
    await sleep(200);
    // .webp at quality 88 keeps text sharp at a fraction of a full-page PNG's size.
    const format = file.endsWith('.webp') ? 'webp' : file.endsWith('.jpg') ? 'jpeg' : 'png';
    const { data } = await call('Page.captureScreenshot', { format, ...(format === 'png' ? {} : { quality: 88 }), captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    writeFileSync(file, Buffer.from(data, 'base64'));
  }

  /** Real key presses (CDP Input events, not DOM clicks): for the keyboard-only walk. */
  const KEYS = {
    Tab: { code: 'Tab', keyCode: 9 },
    Enter: { code: 'Enter', keyCode: 13, text: String.fromCharCode(13) },
    Escape: { code: 'Escape', keyCode: 27 },
    ' ': { code: 'Space', keyCode: 32, text: ' ' },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  };
  async function press(key, { shift = false } = {}) {
    const k = KEYS[key];
    if (!k) throw new Error(`press: no key ${key}`);
    const modifiers = shift ? 8 : 0;
    await call('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers });
    await sleep(60);
  }
  /** Text typed into whatever has focus, as a keyboard would. */
  async function type(text) {
    await call('Input.insertText', { text });
    await sleep(60);
  }
  /** Tab (or Shift+Tab) until the focused element passes `test` (run in the page), at most `max` presses. */
  async function tabTo(test, { what = 'the control', max = 80, shift = false } = {}) {
    for (let i = 0; i <= max; i++) {
      if (await evaluate(test)) return i;
      await press('Tab', { shift });
    }
    throw new Error(`Tabbed ${max} times without reaching ${what}`);
  }

  /** Emulate CSS media features, e.g. [{ name: 'prefers-reduced-motion', value: 'reduce' }]. */
  async function emulateMedia(features) {
    await call('Emulation.setEmulatedMedia', { features });
  }

  return { goto, evaluate, waitFor, find, click, fill, check, text, screenshot, setViewport, waitIdle, emulateMedia, press, type, tabTo, requests, errors, stuck, sleep };
}
