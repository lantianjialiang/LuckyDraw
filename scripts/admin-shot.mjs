/** 后台页面截图验收：node scripts/admin-shot.mjs <lotteryId> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.env.SHOT_DIR || 'C:/Users/liang_jia/AppData/Local/Temp/shots';
const lid = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch('http://localhost:4000/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
}).then((r) => r.json());

fs.mkdirSync(`${SHOT}/profile4`, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9335', `--user-data-dir=${SHOT}/profile4`,
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    targets = await fetch('http://127.0.0.1:9335/json').then((r) => r.json());
    if (targets.some((t) => t.type === 'page')) break;
  } catch { /* wait */ }
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log('shot:', name);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
await sleep(1800);
await evaluate(`localStorage.setItem('ld_token', ${JSON.stringify(login.token)}); location.reload();`);
await sleep(1600);
await shot('admin-0-home');

await evaluate(`history.pushState({}, '', '/admin'); window.dispatchEvent(new PopStateEvent('popstate')); 'ok'`);
await sleep(1600);
await shot('admin-1-list');

if (lid) {
  await evaluate(`history.pushState({}, '', '/admin/lotteries/${lid}'); window.dispatchEvent(new PopStateEvent('popstate')); 'ok'`);
  await sleep(1800);
  await shot('admin-2-detail');

  // 切到中奖名单
  await evaluate(`[...document.querySelectorAll('.tab')].find(b => b.textContent.includes('中奖名单')).click(); 'ok'`);
  await sleep(1500);
  await shot('admin-3-records');

  await evaluate(`[...document.querySelectorAll('.tab')].find(b => b.textContent.includes('操作日志')).click(); 'ok'`);
  await sleep(1200);
  await shot('admin-4-logs');
}

ws.close();
chrome.kill();
process.exit(0);
