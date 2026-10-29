/** 移动端布局诊断：node scripts/mobile-diag.mjs <url> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.env.SHOT_DIR || 'C:/Users/liang_jia/AppData/Local/Temp/shots';
const url = process.argv[2] || 'http://127.0.0.1:5173/l/euJaFaXw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(`${SHOT}/profile5`, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9337', `--user-data-dir=${SHOT}/profile5`,
  '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    targets = await fetch('http://127.0.0.1:9337/json').then((r) => r.json());
    if (targets.some((t) => t.type === 'page')) break;
  } catch { /* wait */ }
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(3500);

const info = await evaluate(`(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
  };
  const over = [...document.querySelectorAll('body *')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.right > window.innerWidth + 1 && r.width > 0)
    .slice(0, 8)
    .map(({ el, r }) => el.tagName + '.' + (el.className || '').toString().split(' ')[0] + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width));
  return {
    vw: window.innerWidth,
    scrollW: document.documentElement.scrollWidth,
    bodyScrollH: document.body.scrollHeight,
    header: pick('header'),
    wheelPage: pick('.wheel-page'),
    wheelStage: pick('.wheel-stage'),
    wheelShell: pick('.wheel-shell'),
    canvas: pick('canvas.wheel-canvas'),
    pointer: pick('.pointer'),
    spinBtn: pick('.spin-btn'),
    prizeSide: pick('.prize-list') || pick('aside'),
    overflowing: over,
  };
})()`);
console.log(JSON.stringify(info, null, 2));
const secs = await evaluate('window.__wheel ? window.__wheel.sectors() : null');
console.log('sectors:', JSON.stringify(secs?.map((s) => [s.name, +(s.span * 360).toFixed(1)])));

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
fs.writeFileSync(`${SHOT}/mobile-full.png`, Buffer.from(shot.data, 'base64'));
console.log('saved mobile-full.png');

const bad = await evaluate(`(() => [...document.querySelectorAll('body *')]
  .map((el) => ({ el, r: el.getBoundingClientRect() }))
  .filter(({ r }) => r.right > window.innerWidth + 1 && r.width > 0 && r.height > 0)
  .filter(({ el }) => !el.closest('.winners-track, .rolling-row, .avatar-wall'))
  .slice(0, 10)
  .map(({ el, r }) => el.tagName + '.' + (el.className || '').toString().split(' ').slice(0, 2).join('.') + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width)))()`);
console.log('offenders:', JSON.stringify(bad, null, 1));
ws.close(); chrome.kill();
process.exit(0);
