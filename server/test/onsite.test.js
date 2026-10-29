/**
 * 年会现场模式测试：签到 + 按奖项抽人 + 回退
 * 运行：npm test
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luckydraw-onsite-'));
process.env.DB_FILE = path.join(tmpDir, 'onsite.db');

const { q, uid, now } = await import('../src/db.js');
const { checkin, enrollmentWall, normalizeEmployeeNo } = await import('../src/services/checkin.js');
const { raffle, raffleCandidates, revokeBatch, revokeRecord } = await import('../src/services/draw.js');

const admin = { id: uid('usr'), username: 'admin' };
q.run('INSERT INTO User (id, username, passwordHash, role, createdAt) VALUES (?,?,?,?,?)',
  admin.id, 'admin', 'x', 'admin', now());

function mkLottery({ status = 'active', mode = 'onsite' } = {}) {
  const id = uid('lot');
  q.run(
    `INSERT INTO Lottery (id, title, status, startAt, endAt, shareCode, maxDrawsPerUser,
       autoEndWhenEmpty, excludeLastOnRedraw, mode, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,1,0,1,?,?,?)`,
    id, '年会', status,
    new Date(Date.now() - 3600_000).toISOString(),
    new Date(Date.now() + 3600_000).toISOString(),
    'CODE' + id.slice(-6), mode, now(), now(),
  );
  return q.get('SELECT * FROM Lottery WHERE id = ?', id);
}

function mkPrize(lotteryId, { name = '奖品', level = '一等奖', total = 3 } = {}) {
  const id = uid('prz');
  q.run(
    `INSERT INTO Prize (id, lotteryId, name, level, type, totalCount, remainingCount, status, sortOrder, version, createdAt)
     VALUES (?,?,?,?, 'prize', ?, ?, 'active', 0, 1, ?)`,
    id, lotteryId, name, level, total, total, now(),
  );
  return q.get('SELECT * FROM Prize WHERE id = ?', id);
}

const people = ['张伟', '王芳', '李娜', '刘洋', '陈静'];
function seedPeople(lottery, n = people.length) {
  return people.slice(0, n).map((name, i) => checkin({
    lottery,
    employeeNo: `E${1001 + i}`,
    displayName: name,
    department: '研发',
    blessing: `祝福 ${i}`,
    avatar: 'a1',
  }).enrollment);
}

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('签到', () => {
  test('同一工号重复签到只更新资料，不新增记录', () => {
    const lottery = mkLottery();
    checkin({ lottery, employeeNo: 'E9001', displayName: '张三', blessing: '第一次' });
    const second = checkin({ lottery, employeeNo: 'E9001', displayName: '张三丰', blessing: '第二次' });
    assert.equal(second.updated, true);
    assert.equal(second.enrollment.displayName, '张三丰');
    assert.equal(second.enrollment.blessing, '第二次');
    const { total } = enrollmentWall(lottery.id);
    assert.equal(total, 1);
  });

  test('工号非法字符会被拒绝', () => {
    assert.throws(() => normalizeEmployeeNo('张 三'), /工号/);
    assert.throws(() => normalizeEmployeeNo(''), /工号/);
    assert.equal(normalizeEmployeeNo(' A-1024 '), 'A-1024');
  });

  test('未发布的活动不能签到', () => {
    const lottery = mkLottery({ status: 'draft' });
    assert.throws(() => checkin({ lottery, employeeNo: 'E1', displayName: '李四' }), /未开放签到/);
  });
});

describe('现场抽奖', () => {
  test('抽 N 人：库存扣减准确，且中奖者不重复', () => {
    const lottery = mkLottery();
    seedPeople(lottery, 5);
    const prize = mkPrize(lottery.id, { total: 3 });

    const res = raffle({ lotteryId: lottery.id, prizeId: prize.id, count: 3, admin });
    assert.equal(res.winners.length, 3);
    const names = res.winners.map((w) => w.displayName);
    assert.equal(new Set(names).size, 3, '同一轮不应抽到重复的人');

    const after = q.get('SELECT * FROM Prize WHERE id = ?', prize.id);
    assert.equal(after.remainingCount, 0);

    // 已中奖的人退出候选池
    const left = raffleCandidates(lottery.id).map((c) => c.displayName);
    assert.equal(left.length, 2);
    names.forEach((n) => assert.ok(!left.includes(n)));
  });

  test('库存不足时拒绝并保持库存不变', () => {
    const lottery = mkLottery();
    seedPeople(lottery, 5);
    const prize = mkPrize(lottery.id, { total: 2 });
    assert.throws(
      () => raffle({ lotteryId: lottery.id, prizeId: prize.id, count: 3, admin }),
      /库存不足/,
    );
    assert.equal(q.get('SELECT remainingCount FROM Prize WHERE id = ?', prize.id).remainingCount, 2);
  });

  test('可抽人数不足时拒绝', () => {
    const lottery = mkLottery();
    seedPeople(lottery, 2);
    const prize = mkPrize(lottery.id, { total: 5 });
    assert.throws(
      () => raffle({ lotteryId: lottery.id, prizeId: prize.id, count: 3, admin }),
      /人数不足/,
    );
  });

  test('活动未进行中不能抽奖', () => {
    // 先签到（结束状态下不允许签到），再把活动结束，验证抽奖被拦
    const lottery = mkLottery();
    seedPeople(lottery, 3);
    const prize = mkPrize(lottery.id, { total: 3 });
    q.run("UPDATE Lottery SET status = 'ended' WHERE id = ?", lottery.id);
    assert.throws(() => raffle({ lotteryId: lottery.id, prizeId: prize.id, count: 1, admin }), /未在进行中/);
  });

  test('整批回退：库存与参与位都恢复，可以重抽', () => {
    const lottery = mkLottery();
    seedPeople(lottery, 5);
    const prize = mkPrize(lottery.id, { total: 3 });

    const first = raffle({ lotteryId: lottery.id, prizeId: prize.id, count: 3, admin });
    assert.equal(q.get('SELECT remainingCount FROM Prize WHERE id = ?', prize.id).remainingCount, 0);

    const rev = revokeBatch({ batchId: first.batchId, admin, reason: '抽错了' });
    assert.equal(rev.revoked, 3);
    assert.equal(q.get('SELECT remainingCount FROM Prize WHERE id = ?', prize.id).remainingCount, 3);
    assert.equal(raffleCandidates(lottery.id).length, 5, '被撤回的人应重新进入候选池');

    // 重抽能补满 3 人
    const again = raffle({ lotteryId: lottery.id, prizeId: prize.id, count: 3, admin });
    assert.equal(again.winners.length, 3);
  });

  test('单人回退后该人可再次被抽中', () => {
    const lottery = mkLottery();
    seedPeople(lottery, 3);
    const prize = mkPrize(lottery.id, { total: 1 });

    const res = raffle({ lotteryId: lottery.id, prizeId: prize.id, count: 1, admin });
    const w = res.winners[0];
    revokeRecord({ recordId: w.recordId, admin, reason: '重抽' });

    assert.equal(q.get('SELECT remainingCount FROM Prize WHERE id = ?', prize.id).remainingCount, 1);
    const candidates = raffleCandidates(lottery.id).map((c) => c.displayName);
    assert.ok(candidates.includes(w.displayName));
  });

  test('未被抽中的人不会产生中奖记录', () => {
    const lottery = mkLottery();
    seedPeople(lottery, 4);
    const prize = mkPrize(lottery.id, { total: 4 });
    raffle({ lotteryId: lottery.id, prizeId: prize.id, count: 2, admin });
    const count = q.get(
      "SELECT COUNT(*) AS c FROM DrawRecord WHERE lotteryId = ? AND status = 'won'", lottery.id,
    ).c;
    assert.equal(count, 2);
  });
});

test('现场中奖次数遵守配置，撤回后恢复一个名额', () => {
 const lottery=mkLottery();
 q.run('UPDATE Lottery SET maxDrawsPerUser=2 WHERE id=?',lottery.id);
 const prize=mkPrize(lottery.id,{total:5});
 seedPeople(lottery,1);
 const first=raffle({lotteryId:lottery.id,prizeId:prize.id,count:1,admin});
 assert.equal(raffleCandidates(lottery.id).length,1);
 raffle({lotteryId:lottery.id,prizeId:prize.id,count:1,admin});
 assert.equal(raffleCandidates(lottery.id).length,0);
 revokeBatch({batchId:first.batchId,admin});
 assert.equal(raffleCandidates(lottery.id).length,1);
});

test('撤回较早中奖记录后，次数和最新中奖记录保持一致',()=>{
 const l=mkLottery();q.run('UPDATE Lottery SET maxDrawsPerUser=2 WHERE id=?',l.id);const p=mkPrize(l.id,{total:4});const [person]=seedPeople(l,1);
 const a=raffle({lotteryId:l.id,prizeId:p.id,count:1,admin});const b=raffle({lotteryId:l.id,prizeId:p.id,count:1,admin});
 revokeRecord({recordId:a.winners[0].recordId,admin});
 const participation=q.get('SELECT * FROM Participation WHERE lotteryId=? AND userId=?',l.id,person.userId);
 assert.equal(participation.drawCount,1);assert.equal(participation.currentRecordId,b.winners[0].recordId);
});
test('旧签到账号再次签到不会丢失中奖资格限制',()=>{
 const l=mkLottery();const [e]=seedPeople(l,1);q.run('UPDATE User SET username=? WHERE id=?','emp:legacy-'+l.id,e.userId);
 const p=mkPrize(l.id);raffle({lotteryId:l.id,prizeId:p.id,count:1,admin});
 const updated=checkin({lottery:l,employeeNo:e.employeeNo,displayName:e.displayName});
 assert.equal(updated.user.id,e.userId);assert.equal(raffleCandidates(l.id).length,0);
});
test('不同活动同一工号使用不同账号',()=>{
 const a=seedPeople(mkLottery(),1)[0],b=seedPeople(mkLottery(),1)[0];assert.notEqual(a.userId,b.userId);
});
test('非法抽奖人数不会扣库存',()=>{
 const l=mkLottery(),p=mkPrize(l.id);seedPeople(l,2);
 for(const count of [0,-1,1.5,51,NaN]) assert.throws(()=>raffle({lotteryId:l.id,prizeId:p.id,count,admin}));
 assert.equal(q.get('SELECT remainingCount FROM Prize WHERE id=?',p.id).remainingCount,3);
});
test('补抽一位只生成一条新记录并扣减一份库存',()=>{
 const l=mkLottery(),p=mkPrize(l.id,{total:4});seedPeople(l,4);
 const first=raffle({lotteryId:l.id,prizeId:p.id,count:2,admin});const extra=raffle({lotteryId:l.id,prizeId:p.id,count:1,admin});
 assert.equal(extra.winners.length,1);assert.ok(!first.winners.some(w=>w.userId===extra.winners[0].userId));
 assert.equal(q.get('SELECT remainingCount FROM Prize WHERE id=?',p.id).remainingCount,1);
});
