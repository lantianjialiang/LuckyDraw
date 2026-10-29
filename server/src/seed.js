import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { now, q, shortCode, uid } from './db.js';

function ensureUser(username, password, role) {
  const existing = q.get('SELECT * FROM User WHERE username = ?', username);
  if (existing) {
    console.log(`  · 用户 ${username} 已存在，跳过`);
    return existing;
  }
  const user = {
    id: uid('usr'),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    createdAt: now(),
  };
  q.run('INSERT INTO User (id, username, passwordHash, role, createdAt) VALUES (?,?,?,?,?)',
    user.id, user.username, user.passwordHash, user.role, user.createdAt);
  console.log(`  ✓ 创建${role === 'admin' ? '管理员' : '用户'}：${username} / ${password}`);
  return user;
}

const admin = ensureUser(config.defaultAdmin.username, config.defaultAdmin.password, 'admin');
ensureUser('demo', 'demo123', 'user');

/** 建一个演示活动（已发布 + 奖项），标题已存在则跳过 */
function ensureLottery({ title, description, mode = 'online', checkinHint = '', prizes }) {
  const existing = q.get('SELECT * FROM Lottery WHERE title = ?', title);
  if (existing) {
    console.log(`  · 活动《${title}》已存在，跳过（/${existing.shareCode}）`);
    return existing;
  }
  const lotteryId = uid('lot');
  const code = shortCode(8);
  const startAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  q.run(
    `INSERT INTO Lottery (id, title, description, status, startAt, endAt, shareCode, maxDrawsPerUser,
       autoEndWhenEmpty, excludeLastOnRedraw, mode, checkinHint, createdBy, createdAt, updatedAt)
     VALUES (?,?,?, 'active', ?,?,?, 1, 0, 1, ?,?,?,?,?)`,
    lotteryId, title, description, startAt, endAt, code, mode, checkinHint, admin.id, now(), now(),
  );

  prizes.forEach((p, i) => {
    q.run(
      `INSERT INTO Prize (id, lotteryId, name, level, type, totalCount, remainingCount, status, sortOrder, image, color, version, createdAt)
       VALUES (?,?,?,?,?,?,?, 'active', ?,?,?,1,?)`,
      uid('prz'), lotteryId, p.name, p.level, p.type, p.total, p.total, i, p.image, p.color, now(),
    );
  });

  console.log(`  ✓ 创建演示活动：《${title}》 分享码 ${code}`);
  console.log(`    访问 http://localhost:5173/l/${code}`);
  return q.get('SELECT * FROM Lottery WHERE id = ?', lotteryId);
}

// 1) 自助转盘模式
ensureLottery({
  title: '2026 年会幸运大转盘',
  description: '转动命运的转盘，好运不设上限。每人限抽一次，中奖后请在活动结束后联系 HR 领取奖品。',
  prizes: [
    { name: 'iPhone 16 Pro', level: '一等奖', total: 1, type: 'prize', color: '#FF3D71', image: '📱' },
    { name: 'AirPods Pro 2', level: '二等奖', total: 3, type: 'prize', color: '#FFA53D', image: '🎧' },
    { name: '戴森吹风机', level: '三等奖', total: 5, type: 'prize', color: '#FFD84D', image: '💨' },
    { name: '星巴克礼品卡', level: '四等奖', total: 12, type: 'prize', color: '#4ADE80', image: '☕' },
    { name: '定制马克杯', level: '阳光普照', total: 24, type: 'prize', color: '#38BDF8', image: '🍵' },
    { name: '再来一次', level: '谢谢参与', total: 40, type: 'none', color: '#8B93A7', image: '🌈' },
  ],
});

// 2) 年会现场模式（签到 → 主持人按奖项抽）
ensureLottery({
  title: '2026 年会现场抽奖（示例）',
  description: '先签到留下头像和祝福，主持人现场按奖项逐个开奖，随时可以回退重抽。',
  mode: 'onsite',
  checkinHint: '请用工号 + 姓名签到，并留下一句新年祝福',
  prizes: [
    { name: '一等奖 · 戴森吹风机', level: '一等奖', total: 2, type: 'prize', color: '#FF3D71', image: '💨' },
    { name: '二等奖 · 空气炸锅', level: '二等奖', total: 5, type: 'prize', color: '#FFA53D', image: '🍟' },
    { name: '三等奖 · 保温杯', level: '三等奖', total: 10, type: 'prize', color: '#FFD84D', image: '🥤' },
  ],
});

console.log('\n种子数据完成。\n');
