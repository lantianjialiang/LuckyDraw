import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHARE = 'euJaFaXw';
const SHOT = process.env.SHOT_DIR || 'C:/Users/liang_jia/AppData/Local/Temp/shots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. 造一个全新用户，避免"已参与"拦截
const uname = `spin_${Date.now().toString(36)}`;
const reg = await fetch('http://localhost:4000/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: uname, password: 'test123' }),
}).then((r) => r.json());
if (!reg.token) throw new Error(`register failed: ${JSON.stringify(reg)}`);
console.log('user:', uname);

// 2. 启动带调试端口的 chrome
fs.mkdirSync(`${SHOT}/profile2`, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9333',
  `--user-data-dir=${SHOT}/profile2`,
  '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    targets = await fetch('http://127.0.0.1:9333/json').then((r) => r.json());
    if (targets.some((t) => t.type === 'page')) break;
  } catch { /* not up yet */ }
}
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

// 3. 极简 CDP 客户端
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

const url = `http://127.0.0.1:5173/l/${SHARE}`;
await send('Page.navigate', { url });
await sleep(2500);

await evaluate(`localStorage.setItem('ld_token', ${JSON.stringify(reg.token)}); location.reload();`);
await sleep(2600);

const btn = await evaluate(`(() => { const b = document.querySelector('.spin-btn'); return b ? b.textContent : 'NO_BUTTON'; })()`);
console.log('button before:', btn);

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log('shot:', name);
};

await shot('spin-0-idle');

// 4. 点击抽奖
await evaluate(`document.querySelector('.spin-btn').click(); 'clicked'`);

await sleep(700);
await shot('spin-1-fast');
await sleep(1500);
await shot('spin-2-mid');
await sleep(3800);
await shot('spin-3-settle');
await sleep(1500);
await shot('spin-4-result');

const state = await evaluate(`(() => ({
  overlay: !!document.querySelector('.result-card'),
  name: document.querySelector('.result-name')?.textContent || null,
  btn: document.querySelector('.spin-btn')?.textContent || null,
}))()`);
console.log('final state:', JSON.stringify(state));

// 5. 校验：指针最终是否真的停在目标扇区上
const landing = await evaluate(`(() => {
  const w = window.__wheel;
  if (!w) return { error: 'no hook' };
  const rot = w.rotation();
  const raw = (-Math.PI / 2 - rot);
  const twoPi = Math.PI * 2;
  const local = ((raw % twoPi) + twoPi) % twoPi;
  const sectors = w.sectors();
  const hit = sectors.find((s) => {
    const st = ((s.start % twoPi) + twoPi) % twoPi;
    return local >= st && local < st + s.span;
  });
  return { rotation: rot, hit: hit ? hit.name : null, sectors: sectors.length };
})()`);
console.log('landing:', JSON.stringify(landing));
console.log(landing.hit === state.name ? '✅ 指针落点与中奖结果一致' : `❌ 不一致: 指针=${landing.hit} 结果=${state.name}`);

ws.close();
chrome.kill();
process.exit(0);
