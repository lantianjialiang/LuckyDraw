/** 主题与年会页面截图：node scripts/theme-shot.mjs [shareCode] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.env.SHOT_DIR || 'C:/Users/liang_jia/AppData/Local/Temp/shots';
const code = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(`${SHOT}/profile-theme`, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9355', `--user-data-dir=${SHOT}/profile-theme`,
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    targets = await fetch('http://127.0.0.1:9355/json').then((r) => r.json());
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
  if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');

const shot = async (name, theme, url, wait = 3200) => {
  // 先进入同源页面，才能写 localStorage，再刷新让首屏脚本读到
  await send('Page.navigate', { url });
  await sleep(1200);
  await evaluate(`localStorage.setItem('ld.theme', '${theme}'); location.reload();`);
  await sleep(wait);
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOT}/${name}.png`, Buffer.from(png.data, 'base64'));
  console.log('saved', name);
};

await shot('theme-home-dark', 'dark', 'http://127.0.0.1:5173/');
await shot('theme-home-light', 'light', 'http://127.0.0.1:5173/');
if (code) {
  await shot('theme-onsite-dark', 'dark', `http://127.0.0.1:5173/l/${code}`, 4000);
  await shot('theme-onsite-light', 'light', `http://127.0.0.1:5173/l/${code}`, 4000);
}

ws.close(); chrome.kill();
process.exit(0);
