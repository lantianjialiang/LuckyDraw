/**
 * 视觉验收脚本：admin 建活动 → 加奖品 → 发布 → 新用户抽奖 → 抓旋转/结果截图 + 落点校验
 * 用法：node scripts/win-shot.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT = process.env.SHOT_DIR || 'C:/Users/liang_jia/AppData/Local/Temp/shots';
const API = 'http://localhost:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = (path, body, token) => fetch(API + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body ?? {}),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

// 1. admin 建活动
const admin = (await post('/api/auth/login', { username: 'admin', password: 'admin123' })).body;
const created = await post('/api/admin/lotteries', {
  title: '一等奖测试场',
  description: '这是一个用来验收中奖动画的测试活动，奖池只有一份头奖。',
  startAt: new Date(Date.now() - 3600_000).toISOString(),
  endAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
}, admin.token);
const lid = created.body.lottery?.id;
if (!lid) throw new Error(`create failed ${JSON.stringify(created)}`);

await post(`/api/admin/lotteries/${lid}/prizes`, { name: 'iPhone 16 Pro', level: '一等奖', type: 'prize', totalCount: 1, image: '📱', color: '#FF3D71' }, admin.token);
await post(`/api/admin/lotteries/${lid}/prizes`, { name: 'AirPods Pro 2', level: '二等奖', type: 'prize', totalCount: 1, image: '🎧', color: '#FFA53D' }, admin.token);
await post(`/api/admin/lotteries/${lid}/prizes`, { name: '再来一次', level: '谢谢参与', type: 'none', totalCount: 1, image: '🌈', color: '#8B93A7' }, admin.token);

const published = await post(`/api/admin/lotteries/${lid}/publish`, {}, admin.token);
const code = published.body.lottery?.shareCode;
if (!code) throw new Error(`publish failed ${JSON.stringify(published)}`);
console.log('lottery ready:', lid, code);

// 2. 新用户
const uname = `win_${Date.now().toString(36)}`;
const reg = (await post('/api/auth/register', { username: uname, password: 'test123' })).body;
console.log('user:', uname, reg.token ? 'ok' : 'fail');

// 3. 浏览器
fs.mkdirSync(`${SHOT}/profile3`, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9334',
  `--user-data-dir=${SHOT}/profile3`,
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    targets = await fetch('http://127.0.0.1:9334/json').then((r) => r.json());
    if (targets.some((t) => t.type === 'page')) break;
  } catch { /* wait */ }
}
const page = targets.find((t) => t.type === 'page');
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log('shot:', name);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:5173/l/${code}` });
await sleep(2200);
await evaluate(`localStorage.setItem('ld_token', ${JSON.stringify(reg.token)}); location.reload();`);
await sleep(2600);
await shot('win-0-idle');

await evaluate(`document.querySelector('.spin-btn').click(); 'clicked'`);
await sleep(800);
await shot('win-1-fast');
await sleep(4600);
await shot('win-2-slow');
await sleep(1600);
await shot('win-3-result');

const state = await evaluate(`(() => ({
  name: document.querySelector('.result-name')?.textContent || null,
  eyebrow: document.querySelector('.result-eyebrow')?.textContent || null,
  isLose: !!document.querySelector('.result-card.lose'),
}))()`);
console.log('result:', JSON.stringify(state));

const landing = await evaluate(`(() => {
  const w = window.__wheel; if (!w) return { error: 'no hook' };
  const rot = w.rotation(), twoPi = Math.PI * 2;
  const local = (((-Math.PI / 2 - rot) % twoPi) + twoPi) % twoPi;
  const hit = w.sectors().find((s) => {
    const st = ((s.start % twoPi) + twoPi) % twoPi;
    return local >= st && local < st + s.span;
  });
  return { hit: hit ? hit.name : null };
})()`);
console.log('landing:', JSON.stringify(landing));
console.log(landing.hit === state.name ? '✅ 落点一致' : `❌ 落点不一致 ${landing.hit} vs ${state.name}`);

ws.close();
chrome.kill();
process.exit(0);
