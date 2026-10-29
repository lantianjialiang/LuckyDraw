/** 抽奖台验收：登录 → 打开舞台 → 点开始抽取 → 抓滚动/揭晓画面 */
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
if (!login.token) throw new Error('登录失败: ' + JSON.stringify(login));

fs.mkdirSync(`${SHOT}/profile-stage`, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9357', `--user-data-dir=${SHOT}/profile-stage`,
  '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    targets = await fetch('http://127.0.0.1:9357/json').then((r) => r.json());
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
  if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r?.result?.value;
};
const shot = async (name) => {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOT}/${name}.png`, Buffer.from(png.data, 'base64'));
  console.log('saved', name);
};

await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');

// 先落地同源页面，写入登录态与主题
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
await sleep(1600);
await evaluate(`localStorage.setItem('ld_token', ${JSON.stringify(login.token)}); localStorage.setItem('ld.theme', '${theme}');`);

await send('Page.navigate', { url: `http://127.0.0.1:5173/admin/lotteries/${lotteryId}/stage` });
await sleep(3800);
const diag = await evaluate(`(() => {
  const l = document.querySelector('.stage-prize-label');
  const r = l && l.getBoundingClientRect();
  return {
    prizeButtons: [...document.querySelectorAll('.stage-prize')].map((b) => b.innerText.replace(/\\n/g, '|')),
    label: l ? l.innerText : null,
    labelRect: r ? { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) } : null,
    mainH: Math.round(document.querySelector('.stage-main').getBoundingClientRect().height),
  };
})()`);
console.log('diag:', JSON.stringify(diag, null, 1));
await shot(`stage-${theme}-idle`);

// 抽 3 个人，方便看多人揭晓
await evaluate(`(() => {
  const plus = [...document.querySelectorAll('.stage-side button')].filter((b) => b.textContent.trim() === '+');
  plus[0]?.click(); plus[0]?.click();
  return 'count=3';
})()`);
await sleep(400);

const clicked = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始抽取'));
  if (!btn) return 'no-button';
  if (btn.disabled) return 'disabled';
  btn.click();
  return 'clicked';
})()`);
console.log('click:', clicked);

await sleep(1300);
await shot(`stage-${theme}-rolling`);
await sleep(3200);
await shot(`stage-${theme}-result`);

const state = await evaluate(`(() => ({
  winners: [...document.querySelectorAll('.stage-winner-name')].map((n) => n.textContent),
  hasRolling: !!document.querySelector('.rolling-wall.running'),
}))()`);
console.log('state:', JSON.stringify(state));

ws.close(); chrome.kill();
process.exit(0);
