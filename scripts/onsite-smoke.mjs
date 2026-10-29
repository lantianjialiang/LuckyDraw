/** 年会模式冒烟：建活动(onsite) → 发布 → 签到 → 现场抽奖 → 回退 → 重抽 */
const API = 'http://localhost:4000/api';
const req = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
};

const admin = (await req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })).j.token;
if (!admin) throw new Error('管理员登录失败');

// 1. 建一个年会活动
const created = await req('/admin/lotteries', {
  method: 'POST', token: admin,
  body: {
    title: '2026 年会现场抽奖（冒烟）',
    description: '按奖项逐个抽取，可回退',
    mode: 'onsite',
    checkinHint: '请用工号+姓名签到，并留下祝福语',
    startAt: new Date(Date.now() - 3600_000).toISOString(),
    endAt: new Date(Date.now() + 86400_000).toISOString(),
    maxDrawsPerUser: 1,
  },
});
const lid = created.j.lottery?.id;
console.log('活动:', lid, created.status);

// 2. 加奖品
for (const [name, level, count] of [['一等奖 iPhone 16', '一等奖', 2], ['二等奖 空气炸锅', '二等奖', 3], ['三等奖 保温杯', '三等奖', 5]]) {
  const r = await req(`/admin/lotteries/${lid}/prizes`, {
    method: 'POST', token: admin,
    body: { name, level, type: 'prize', totalCount: count, sortOrder: 0 },
  });
  if (r.status >= 400) console.log('加奖品失败', name, JSON.stringify(r.j));
}

// 3. 发布
const pub = await req(`/admin/lotteries/${lid}/publish`, { method: 'POST', token: admin });
console.log('发布:', pub.status, pub.j.lottery?.shareCode, 'mode=', pub.j.lottery?.mode);
const shareCode = pub.j.lottery?.shareCode;

// 4. 签到 12 人
const people = ['张伟', '王芳', '李娜', '刘洋', '陈静', '赵磊', '孙强', '周敏', '吴超', '郑爽', '冯刚', '蒋雯'];
for (let i = 0; i < people.length; i++) {
  const r = await req('/auth/checkin', {
    method: 'POST',
    body: {
      shareCode,
      employeeNo: 'E' + String(1001 + i),
      displayName: people[i],
      department: ['研发', '市场', '人事', '财务'][i % 4],
      blessing: ['新年快乐！', '祝公司蒸蒸日上', '抽奖必中', '开心每一天'][i % 4],
      avatar: ['a1', 'a2', 'a3', 'a4'][i % 4],
      avatarKind: 'preset',
    },
  });
  if (r.status >= 400) console.log('签到失败', people[i], JSON.stringify(r.j));
}
const wall = await req(`/lotteries/${lid}/enrollments`);
console.log('签到人数:', wall.j.total);

// 5. 现场抽奖：二等奖 3 人
const prizes = (await req(`/admin/lotteries/${lid}/stats`, { token: admin })).j.prizes;
const p2 = prizes.find((p) => p.level === '二等奖');
const draw1 = await req(`/admin/lotteries/${lid}/raffle`, { method: 'POST', token: admin, body: { prizeId: p2.id, count: 3 } });
console.log('抽奖:', draw1.status, draw1.j.winners?.map((w) => w.displayName).join('、'), 'batch=', draw1.j.batchId);

// 6. 库存与可抽人数
const st = await req(`/admin/lotteries/${lid}/stats`, { token: admin });
console.log('库存:', st.j.prizes.map((p) => `${p.name}:${p.remainingCount}/${p.totalCount}`).join(', '));
const enr = await req(`/admin/lotteries/${lid}/enrollments`, { token: admin });
console.log('可抽人数:', enr.j.eligible, '/ 签到', enr.j.total);

// 7. 整批回退
const rev = await req(`/admin/batches/${draw1.j.batchId}/revoke`, { method: 'POST', token: admin, body: { reason: '抽错了，重来' } });
console.log('整批回退:', rev.status, JSON.stringify(rev.j));
const st2 = await req(`/admin/lotteries/${lid}/stats`, { token: admin });
console.log('回退后库存:', st2.j.prizes.map((p) => `${p.name}:${p.remainingCount}`).join(', '));

// 8. 再抽一次（应能抽到新的一批）
const draw2 = await req(`/admin/lotteries/${lid}/raffle`, { method: 'POST', token: admin, body: { prizeId: p2.id, count: 3 } });
console.log('重抽:', draw2.status, draw2.j.winners?.map((w) => w.displayName).join('、'));

// 9. 单人回退
const one = draw2.j.winners?.[0];
const rev1 = await req(`/admin/records/${one.recordId}/revoke`, { method: 'POST', token: admin, body: { reason: '单人回退' } });
console.log('单人回退:', rev1.status);
const enr2 = await req(`/admin/lotteries/${lid}/enrollments`, { token: admin });
console.log('回退后可抽人数:', enr2.j.eligible);

console.log('shareCode =', shareCode, ' lotteryId =', lid);
