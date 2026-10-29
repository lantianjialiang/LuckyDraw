/**
 * 抽奖核心逻辑测试
 * 运行：npm test
 *
 * 关键点：db.js 在 import 时就会打开数据库文件，所以必须先设置 DB_FILE，
 * 再用动态 import 加载模块，保证每个测试文件用独立库。
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckydraw-test-'));
process.env.DB_FILE = path.join(tmpDir, 'test.db');

const { q, uid, now } = await import('../src/db.js');
const {
  draw, revokeRecord, claimRecord, buildPool, lotteryStats, planQuantityChange,
} = await import('../src/services/draw.js');

let seq = 0;
function mkUser(role = 'user') {
  seq += 1;
  const id = uid('usr');
  q.run('INSERT INTO User (id, username, passwordHash, role, createdAt) VALUES (?,?,?,?,?)',
    id, `u${seq}_${Date.now()}`, 'x', role, now());
  return { id, username: `u${seq}`, role };
}

function mkLottery({ maxDrawsPerUser = 1, status = 'active', excludeLastOnRedraw = 0 } = {}) {
  const id = uid('lot');
  q.run(
    `INSERT INTO Lottery (id, title, status, maxDrawsPerUser, autoEndWhenEmpty, excludeLastOnRedraw, createdAt, updatedAt)
     VALUES (?,?,?,?,0,?,?,?)`,
    id, '测试活动', status, maxDrawsPerUser, excludeLastOnRedraw, now(), now(),
  );
  return id;
}

function mkPrize(lotteryId, { name = '奖品', total = 1, type = 'prize', status = 'active', remaining = null } = {}) {
  const id = uid('prz');
  q.run(
    `INSERT INTO Prize (id, lotteryId, name, level, type, totalCount, remainingCount, status, sortOrder, version, createdAt)
     VALUES (?,?,?,?,?,?,?,?,0,1,?)`,
    id, lotteryId, name, '等级', type, total, remaining ?? total, status, now(),
  );
  return id;
}

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('加权随机：概率分布', () => {
  test('命中率应与剩余数量比例一致（±6%）', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '多', total: 9 });
    mkPrize(lotteryId, { name: '少', total: 1 });

    const N = 800;
    let big = 0;
    for (let i = 0; i < N; i++) {
      const user = mkUser();
      // 每次抽之前把库存复原，保证每一轮的权重恒为 9:1
      q.run("UPDATE Prize SET remainingCount = totalCount WHERE lotteryId = ?", lotteryId);
      q.run('DELETE FROM Participation WHERE lotteryId = ?', lotteryId);
      const r = draw({ lotteryId, user });
      if (r.record.prizeNameSnapshot === '多') big += 1;
    }
    const ratio = big / N;
    assert.ok(ratio > 0.84 && ratio < 0.96, `期望 ≈0.9，实际 ${ratio.toFixed(3)}`);
  });

  test('单个奖品时必定命中', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '唯一', total: 20 });
    for (let i = 0; i < 20; i++) {
      const r = draw({ lotteryId, user: mkUser() });
      assert.equal(r.record.prizeNameSnapshot, '唯一');
    }
  });
});

describe('库存与并发', () => {
  test('10 份奖品被 50 人抢：恰好发 10 份，不超发', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '限量', total: 10 });

    let ok = 0;
    let rejected = 0;
    for (let i = 0; i < 50; i++) {
      try {
        draw({ lotteryId, user: mkUser() });
        ok += 1;
      } catch (err) {
        rejected += 1;
        assert.equal(err.code, 'CONFLICT');
      }
    }

    const remaining = q.get('SELECT remainingCount FROM Prize WHERE lotteryId = ?', lotteryId).remainingCount;
    const records = q.get("SELECT COUNT(*) AS c FROM DrawRecord WHERE lotteryId = ? AND status = 'won'", lotteryId).c;

    assert.equal(ok, 10, '应恰好 10 人成功');
    assert.equal(rejected, 40);
    assert.equal(remaining, 0, '库存不能为负');
    assert.equal(records, 10, '记录数应与发放数一致');
  });

  test('同一用户重复抽奖只会产生一条有效记录', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '奖品', total: 10 });
    const user = mkUser();

    draw({ lotteryId, user });
    assert.throws(() => draw({ lotteryId, user }), (err) => err.status === 409 && err.code === 'CONFLICT');

    const count = q.get('SELECT COUNT(*) AS c FROM Participation WHERE lotteryId = ? AND userId = ?', lotteryId, user.id).c;
    assert.equal(count, 1);
  });

  test('幂等键重放返回同一结果，不重复扣库存', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '奖品', total: 10 });
    const user = mkUser();

    const first = draw({ lotteryId, user, idempotencyKey: 'same-key' });
    const second = draw({ lotteryId, user, idempotencyKey: 'same-key' });

    assert.equal(second.replayed, true);
    assert.equal(second.record.id, first.record.id);
    const remaining = q.get('SELECT remainingCount FROM Prize WHERE lotteryId = ?', lotteryId).remainingCount;
    assert.equal(remaining, 9, '只应扣减一次');
  });

  test('奖池为空时返回明确错误而不是 500', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '已发完', total: 1, remaining: 0 });
    assert.throws(() => draw({ lotteryId, user: mkUser() }), (err) => err.status === 409 && /奖品已抽完/.test(err.message));
  });

  test('活动未发布 / 已结束不能抽奖', () => {
    const draft = mkLottery({ status: 'draft' });
    mkPrize(draft, { total: 5 });
    assert.throws(() => draw({ lotteryId: draft, user: mkUser() }), (e) => e.status === 409);

    const ended = mkLottery({ status: 'ended' });
    mkPrize(ended, { total: 5 });
    assert.throws(() => draw({ lotteryId: ended, user: mkUser() }), (e) => e.status === 409);
  });

  test('抽奖过程中奖品被下架：自动重选而不是报错', () => {
    const lotteryId = mkLottery();
    const big = mkPrize(lotteryId, { name: '大池', total: 100 });
    mkPrize(lotteryId, { name: '备选', total: 1 });

    // 模拟：第一次选中的奖品库存刚好被抢空
    q.run('UPDATE Prize SET remainingCount = 0 WHERE id = ?', big);
    const r = draw({ lotteryId, user: mkUser() });
    assert.equal(r.record.prizeNameSnapshot, '备选');
  });
});

describe('撤回与重抽', () => {
  test('撤回后退库存、释放参与位、用户可重抽', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '奖品', total: 3 });
    const user = mkUser();
    const admin = mkUser('admin');

    const r = draw({ lotteryId, user });
    assert.equal(buildPool(lotteryId).total, 2);

    revokeRecord({ recordId: r.record.id, admin, reason: '测试撤回' });

    const prize = q.get('SELECT * FROM Prize WHERE lotteryId = ?', lotteryId);
    assert.equal(prize.remainingCount, 3, '库存应回补');
    assert.equal(prize.totalCount, 3);

    const part = q.get('SELECT * FROM Participation WHERE lotteryId = ? AND userId = ?', lotteryId, user.id);
    assert.equal(part.currentRecordId, null, '参与位应释放');
    assert.equal(part.drawCount, 0, '抽奖次数应退回');

    // 重抽
    const again = draw({ lotteryId, user });
    assert.ok(again.record.id !== r.record.id);

    const revoked = q.get('SELECT * FROM DrawRecord WHERE id = ?', r.record.id);
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.revokeReason, '测试撤回');
    assert.equal(revoked.prizeNameSnapshot, '奖品', '历史记录保留快照');
  });

  test('已兑奖的记录不能直接撤回', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '奖品', total: 2 });
    const user = mkUser();
    const admin = mkUser('admin');

    const r = draw({ lotteryId, user });
    claimRecord({ recordId: r.record.id, admin });
    assert.throws(() => revokeRecord({ recordId: r.record.id, admin }), (e) => e.status === 409 && /取消兑奖/.test(e.message));
  });

  test('活动结束后不可撤回', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '奖品', total: 2 });
    const user = mkUser();
    const admin = mkUser('admin');
    const r = draw({ lotteryId, user });
    q.run("UPDATE Lottery SET status = 'ended' WHERE id = ?", lotteryId);
    assert.throws(() => revokeRecord({ recordId: r.record.id, admin }), (e) => e.status === 409);
  });

  test('重抽时排除刚被撤回的奖品', () => {
    const lotteryId = mkLottery({ excludeLastOnRedraw: 1 });
    const a = mkPrize(lotteryId, { name: 'A', total: 100 });
    mkPrize(lotteryId, { name: 'B', total: 1 });
    const user = mkUser();
    const admin = mkUser('admin');

    // 人为让 A 必中
    const r = draw({ lotteryId, user });
    q.run('UPDATE Prize SET remainingCount = 1 WHERE id = ?', a);
    revokeRecord({ recordId: r.record.id, admin });

    // 回补后 A 又变成 2，B 是 1；排除 A 后 B 必中
    const again = draw({ lotteryId, user });
    assert.equal(again.record.prizeNameSnapshot, 'B');
  });
});

describe('奖品数量边界', () => {
  test('新总数不能小于已发出数量', () => {
    const prize = { totalCount: 10, remainingCount: 3 }; // 已发 7
    assert.throws(() => planQuantityChange(prize, 5), (e) => e.status === 400);
    assert.deepEqual(planQuantityChange(prize, 7), { totalCount: 7, remainingCount: 0 });
    assert.deepEqual(planQuantityChange(prize, 20), { totalCount: 20, remainingCount: 13 });
  });

  test('统计里的概率随剩余数量实时变化', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: 'A', total: 3 });
    mkPrize(lotteryId, { name: 'B', total: 1 });
    draw({ lotteryId, user: mkUser() });

    const s = lotteryStats(lotteryId);
    const sum = s.prizes.reduce((acc, p) => acc + p.probability, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, '概率之和应为 1');
    assert.equal(s.poolRemaining, 3);
  });

  test('谢谢参与作为特殊奖品也参与奖池', () => {
    const lotteryId = mkLottery();
    mkPrize(lotteryId, { name: '大奖', total: 1 });
    mkPrize(lotteryId, { name: '再来一次', total: 1, type: 'none' });
    const pool = buildPool(lotteryId);
    assert.equal(pool.total, 2);
    assert.equal(pool.prizes.length, 2);
  });
});
