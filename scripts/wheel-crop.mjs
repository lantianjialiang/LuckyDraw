/** 转盘高清裁剪截图：node scripts/wheel-crop.mjs [url] [width] [height] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.env.SHOT_DIR || 'C:/Users/liang_jia/AppData/Local/Temp/shots';
const url = process.argv[2] || 'http://127.0.0.1:5173/l/euJaFaXw';
const W = Number(process.argv[3] || 390);
const H = Number(process.argv[4] || 844);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 9340 + (W % 50);
fs.mkdirSync(`${SHOT}/profile-${W}x${H}`, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${SHOT}/profile-${W}x${H}`,
  `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
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

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 600 });
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(3500);

const box = await evaluate(
  "(() => { const el = document.querySelector('.wheel-shell'); if (!el) return { missing: true, href: location.href, body: document.body.innerText.slice(0, 200) }; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()",
);
if (box.missing) { console.log('WHEEL MISSING:', JSON.stringify(box)); ws.close(); chrome.kill(); process.exit(1); }
console.log('wheel box:', JSON.stringify(box));
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 3 } });
fs.writeFileSync(`${SHOT}/wheel-crop-${W}.png`, Buffer.from(shot.data, 'base64'));
console.log('saved wheel-crop-' + W + '.png');
ws.close(); chrome.kill();
process.exit(0);
