/** 活动详情页验收：settings / checkin 两个 tab 截图 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.env.SHOT_DIR || 'C:/Users/liang_jia/AppData/Local/Temp/shots';
const lotteryId = process.argv[2];
const theme = process.argv[3] || 'dark';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch('http://localhost:4000/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
}).then((r) => r.json());

fs.mkdirSync(`${SHOT}/profile-detail`, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9361', `--user-data-dir=${SHOT}/profile-detail`,
  '--window-size=1600,1100', 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    targets = await fetch('http://127.0.0.1:9361/json').then((r) => r.json());
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
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOT}/${name}.png`, Buffer.from(png.data, 'base64'));
  console.log('saved', name);
};
const clickTab = (text) => evaluate(`(() => {
  const t = [...document.querySelectorAll('.tab')].find((b) => b.textContent.includes(${JSON.stringify(text)}));
  if (!t) return 'missing';
  t.click(); return 'ok';
})()`);

await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
await sleep(1500);
await evaluate(`localStorage.setItem('ld_token', ${JSON.stringify(login.token)}); localStorage.setItem('ld.theme', '${theme}');`);
await send('Page.navigate', { url: `http://127.0.0.1:5173/admin/lotteries/${lotteryId}` });
await sleep(3200);

console.log('settings tab:', await clickTab('活动设置'));
await sleep(900);
await shot(`detail-${theme}-settings`);

console.log('checkin tab:', await clickTab('签到名单'));
await sleep(1400);
await shot(`detail-${theme}-checkin`);

ws.close(); chrome.kill();
process.exit(0);
