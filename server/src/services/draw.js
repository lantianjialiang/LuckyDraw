import { randomInt } from 'node:crypto';
import { logAdminOp, now, q, tx, uid } from '../db.js';
import { conflict, notFound, badRequest } from '../lib/http.js';

const MAX_RETRY = 5;

export function getLotteryOr404(lotteryId) {
  const lottery = q.get('SELECT * FROM Lottery WHERE id = ?', lotteryId);
  if (!lottery) throw notFound('活动不存在');
  return lottery;
}

export function getLotteryByShareCode(code) {
  return q.get('SELECT * FROM Lottery WHERE shareCode = ?', code);
}

/**
 * 实时奖池：只取 status=active 且 remaining>0 的奖品。
 * 概率不落库，全部按 remainingCount 实时归一化 —— 这是"灵活增减奖项"能立即生效的前提。
 */
export function buildPool(lotteryId, { excludePrizeId = null } = {}) {
  let prizes = q.all(
    `SELECT * FROM Prize WHERE lotteryId = ? AND status = 'active' AND remainingCount > 0
     ORDER BY sortOrder ASC, createdAt ASC`,
    lotteryId,
  );
  // 重抽时排除刚被撤回的奖品（避免同一奖品又被抽回去），但至少保留一个候选
  if (excludePrizeId && prizes.length > 1) {
    const filtered = prizes.filter((p) => p.id !== excludePrizeId);
    if (filtered.length > 0) prizes = filtered;
  }
  const total = prizes.reduce((sum, p) => sum + p.remainingCount, 0);
  return { prizes, total };
}

export function withProbability(prizes, total) {
  return prizes.map((p) => ({
    ...p,
    probability: total > 0 ? p.remainingCount / total : 0,
    issuedCount: p.totalCount - p.remainingCount,
  }));
}

function pickByWeight(candidates) {
  const total = candidates.reduce((s, p) => s + p.remainingCount, 0);
  if (total <= 0) return null;
  // crypto.randomInt 是密码学安全随机，且区间右端开，不会出现 Math.random 的偏置
  let n = randomInt(0, total);
  for (const p of candidates) {
    if (n < p.remainingCount) return p;
    n -= p.remainingCount;
  }
  return candidates[candidates.length - 1];
}

function assertLotteryOpen(lottery) {
  if (lottery.status === 'draft') throw conflict('活动尚未发布');
  if (lottery.status === 'ended') throw conflict('活动已结束');
  const t = Date.now();
  if (lottery.startAt && new Date(lottery.startAt).getTime() > t) throw conflict('活动还没开始');
  if (lottery.endAt && new Date(lottery.endAt).getTime() < t) throw conflict('活动已过期');
}

/**
 * 执行抽奖 —— 全流程在一个事务内：
 *  1. 校验活动状态 / 时间 / 参与次数
 *  2. 条件扣库存（唯一可靠的防超发手段）
 *  3. 写流水 + 占用参与位
 */
export function draw({ lotteryId, user, idempotencyKey = null }) {
  // 幂等：同一用户 + 同一 Idempotency-Key 直接返回上次结果（防双击 / 多标签页）
  if (idempotencyKey) {
    const hit = q.get(
      'SELECT * FROM Idempotency WHERE key = ? AND userId = ? AND scope = ?',
      idempotencyKey, user.id, `draw:${lotteryId}`,
    );
    if (hit) {
      const record = q.get('SELECT * FROM DrawRecord WHERE id = ?', hit.recordId);
      if (record) {
        const lottery = getLotteryOr404(lotteryId);
        return { replayed: true, record, lottery, prize: record.prizeId ? q.get('SELECT * FROM Prize WHERE id = ?', record.prizeId) : null };
      }
    }
  }

  return tx(() => {
    const lottery = getLotteryOr404(lotteryId);
    assertLotteryOpen(lottery);

    let participation = q.get('SELECT * FROM Participation WHERE lotteryId = ? AND userId = ?', lotteryId, user.id);
    if (participation?.currentRecordId) {
      throw conflict('你已经参与过这个活动了');
    }
    if (participation && participation.drawCount >= lottery.maxDrawsPerUser) {
      throw conflict('抽奖次数已用完');
    }

    // 重抽时是否排除上次被撤回的奖品
    let excludePrizeId = null;
    if (lottery.excludeLastOnRedraw) {
      const lastRevoked = q.get(
        `SELECT * FROM DrawRecord WHERE lotteryId = ? AND userId = ? AND status = 'revoked'
         ORDER BY createdAt DESC LIMIT 1`,
        lotteryId, user.id,
      );
      if (lastRevoked?.prizeId) excludePrizeId = lastRevoked.prizeId;
    }

    let { prizes, total } = buildPool(lotteryId, { excludePrizeId });
    if (!prizes.length || total <= 0) throw conflict('奖品已抽完，感谢参与');

    let chosen = null;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const candidate = pickByWeight(prizes);
      if (!candidate) break;
      // 条件更新：库存正确性靠 WHERE 条件保证，不靠"先查后改"
      const res = q.run(
        `UPDATE Prize SET remainingCount = remainingCount - 1, version = version + 1
         WHERE id = ? AND remainingCount > 0 AND status = 'active'`,
        candidate.id,
      );
      if (res.changes > 0) {
        chosen = { ...candidate, remainingCount: candidate.remainingCount - 1 };
        break;
      }
      // 被并发抢空或被管理员下架 → 从候选里剔除后重选
      prizes = prizes.filter((p) => p.id !== candidate.id);
      if (!prizes.length) break;
    }
    if (!chosen) throw conflict('奖品刚刚被抢空了，请稍后再试');

    const recordId = uid('rec');
    q.run(
      `INSERT INTO DrawRecord (id, lotteryId, userId, prizeId, status, prizeNameSnapshot, prizeLevelSnapshot, prizeTypeSnapshot, createdAt)
       VALUES (?,?,?,?, 'won', ?,?,?,?)`,
      recordId, lotteryId, user.id, chosen.id, chosen.name, chosen.level, chosen.type, now(),
    );

    if (participation) {
      q.run(
        'UPDATE Participation SET currentRecordId = ?, drawCount = drawCount + 1 WHERE id = ?',
        recordId, participation.id,
      );
    } else {
      q.run(
        'INSERT INTO Participation (id, lotteryId, userId, currentRecordId, drawCount, createdAt) VALUES (?,?,?,?,?,?)',
        uid('par'), lotteryId, user.id, recordId, 1, now(),
      );
    }

    if (idempotencyKey) {
      q.run(
        'INSERT OR IGNORE INTO Idempotency (key, userId, scope, recordId, createdAt) VALUES (?,?,?,?,?)',
        idempotencyKey, user.id, `draw:${lotteryId}`, recordId, now(),
      );
    }

    // 抽完自动结束
    if (lottery.autoEndWhenEmpty) {
      const left = q.get(
        `SELECT COALESCE(SUM(remainingCount), 0) AS s FROM Prize WHERE lotteryId = ? AND status = 'active'`,
        lotteryId,
      ).s;
      if (left <= 0) {
        q.run("UPDATE Lottery SET status = 'ended', updatedAt = ? WHERE id = ?", now(), lotteryId);
        lottery.status = 'ended';
      }
    }

    const record = q.get('SELECT * FROM DrawRecord WHERE id = ?', recordId);
    return { replayed: false, record, lottery, prize: q.get('SELECT * FROM Prize WHERE id = ?', chosen.id) };
  });
}

/** 我的结果：当前有效记录 + 是否还能再抽 */
export function myResult(lotteryId, userId) {
  const participation = q.get('SELECT * FROM Participation WHERE lotteryId = ? AND userId = ?', lotteryId, userId);
  const record = participation?.currentRecordId
    ? q.get('SELECT * FROM DrawRecord WHERE id = ?', participation.currentRecordId)
    : null;
  const revokedNotice = q.get(
    `SELECT * FROM DrawRecord WHERE lotteryId = ? AND userId = ? AND status = 'revoked'
     ORDER BY createdAt DESC LIMIT 1`,
    lotteryId, userId,
  );
  return { participation, record, revokedNotice };
}

/** 撤回单条（不含事务，供批量撤回复用） */
function revokeOne({ recordId, admin, reason = '' }) {
  const record = q.get('SELECT * FROM DrawRecord WHERE id = ?', recordId);
  if (!record) throw notFound('记录不存在');
  if (record.status === 'revoked') throw conflict('该记录已撤回');
  if (record.status === 'claimed') throw conflict('该记录已兑奖，请先取消兑奖');
  if (record.status !== 'won') throw conflict('该记录当前不可撤回');

  const lottery = q.get('SELECT * FROM Lottery WHERE id = ?', record.lotteryId);
  if (!lottery) throw notFound('活动不存在');
  if (lottery.status === 'ended') throw conflict('活动已结束，无法撤回（请先重新开启活动）');

  const before = { status: record.status, prizeId: record.prizeId };

  q.run(
    `UPDATE DrawRecord SET status = 'revoked', revokedBy = ?, revokedAt = ?, revokeReason = ? WHERE id = ?`,
    admin.id, now(), reason, recordId,
  );

  // 库存回补：奖品被删/被下架则不回补，只在日志里注明
  let stockRestored = false;
  if (record.prizeId) {
    const prize = q.get('SELECT * FROM Prize WHERE id = ?', record.prizeId);
    if (prize && prize.status === 'active') {
      // 回补不能超过总量
      const res = q.run(
        `UPDATE Prize SET remainingCount = MIN(remainingCount + 1, totalCount), version = version + 1
         WHERE id = ? AND remainingCount < totalCount`,
        prize.id,
      );
      stockRestored = res.changes > 0;
    }
  }

  const participation = q.get('SELECT * FROM Participation WHERE lotteryId = ? AND userId = ?', record.lotteryId, record.userId);
  if (participation) {
    const latest = q.get("SELECT id FROM DrawRecord WHERE lotteryId=? AND userId=? AND status IN ('won','claimed') ORDER BY createdAt DESC, rowid DESC LIMIT 1", record.lotteryId, record.userId);
    q.run('UPDATE Participation SET currentRecordId = ?, drawCount = MAX(drawCount - 1, 0) WHERE id = ?', latest?.id ?? null, participation.id);
  }

  logAdminOp({
    admin,
    action: 'record.revoke',
    targetType: 'DrawRecord',
    targetId: recordId,
    lotteryId: record.lotteryId,
    before,
    after: { status: 'revoked', stockRestored, reason },
  });

  return { ...record, status: 'revoked', stockRestored };
}

/** 撤回：退库存 + 释放参与位，用户可重抽 */
export function revokeRecord(args) {
  return tx(() => revokeOne(args));
}

/** 整批撤回（现场抽奖一次抽出多人，回退时按批撤销） */
export function revokeBatch({ batchId, admin, reason = '' }) {
  return tx(() => {
    const rows = q.all(`SELECT * FROM DrawRecord WHERE batchId = ? AND status = 'won'`, batchId);
    if (!rows.length) throw notFound('该批次没有可撤回的记录');
    const done = rows.map((r) => revokeOne({ recordId: r.id, admin, reason }));
    return { batchId, revoked: done.length };
  });
}

/* ============================================================
   现场抽奖（年会模式）：按奖项一次抽出 N 个人
   ============================================================ */

/** 可抽候选人：已签到，且当前没有有效中奖记录（一人一中） */
export function raffleCandidates(lotteryId) {
  return q.all(
    `SELECT e.* FROM Enrollment e
     WHERE e.lotteryId = ?
       AND (SELECT COUNT(*) FROM DrawRecord r
         WHERE r.lotteryId=e.lotteryId AND r.userId=e.userId AND r.status IN ('won','claimed')
       ) < (SELECT maxDrawsPerUser FROM Lottery WHERE id=e.lotteryId)
     ORDER BY e.createdAt ASC`,
    lotteryId,
  );
}

/** crypto 安全的 Fisher-Yates 洗牌 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function raffle({ lotteryId, prizeId, count = 1, admin }) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw conflict('抽取人数必须是 1 到 50 的整数');
  return tx(() => {
    const lottery = getLotteryOr404(lotteryId);
    if (lottery.status !== 'active') throw conflict('活动未在进行中，无法抽奖');

    const prize = q.get('SELECT * FROM Prize WHERE id = ? AND lotteryId = ?', prizeId, lotteryId);
    if (!prize) throw notFound('奖品不存在');
    if (prize.status !== 'active') throw conflict('该奖品已下架，无法抽取');
    if (prize.remainingCount < n) {
      throw conflict(`库存不足：${prize.name} 仅剩 ${prize.remainingCount} 份，无法抽出 ${n} 人`);
    }

    const candidates = raffleCandidates(lotteryId);
    if (candidates.length < n) {
      throw conflict(`人数不足：已签到且未中奖的只有 ${candidates.length} 人，无法抽出 ${n} 人`);
    }

    const picked = shuffle(candidates).slice(0, n);
    const batchId = uid('bat');
    const out = [];

    for (const person of picked) {
      const res = q.run(
        `UPDATE Prize SET remainingCount = remainingCount - 1, version = version + 1
         WHERE id = ? AND remainingCount > 0 AND status = 'active'`,
        prize.id,
      );
      if (res.changes === 0) throw conflict('库存刚刚被改动，请重试');

      const recordId = uid('rec');
      q.run(
        `INSERT INTO DrawRecord (id, lotteryId, userId, prizeId, status, prizeNameSnapshot, prizeLevelSnapshot, prizeTypeSnapshot, batchId, source, createdAt)
         VALUES (?,?,?,?, 'won', ?,?,?,?, 'onsite', ?)`,
        recordId, lotteryId, person.userId, prize.id,
        prize.name, prize.level, prize.type, batchId, now(),
      );

      const participation = q.get('SELECT * FROM Participation WHERE lotteryId = ? AND userId = ?', lotteryId, person.userId);
      if (participation) {
        q.run(
          'UPDATE Participation SET currentRecordId = ?, drawCount = drawCount + 1 WHERE id = ?',
          recordId, participation.id,
        );
      } else {
        q.run(
          'INSERT INTO Participation (id, lotteryId, userId, currentRecordId, drawCount, createdAt) VALUES (?,?,?,?,?,?)',
          uid('par'), lotteryId, person.userId, recordId, 1, now(),
        );
      }

      out.push({
        recordId,
        userId: person.userId,
        employeeNo: person.employeeNo,
        displayName: person.displayName,
        department: person.department,
        blessing: person.blessing,
        avatar: person.avatar,
        avatarKind: person.avatarKind,
      });
    }

    logAdminOp({
      admin,
      action: 'raffle.draw',
      targetType: 'Prize',
      targetId: prize.id,
      lotteryId,
      before: { remainingCount: prize.remainingCount },
      after: { batchId, count: n, remainingCount: prize.remainingCount - n },
    });

    return {
      batchId,
      prize: { id: prize.id, name: prize.name, level: prize.level, remainingCount: prize.remainingCount - n },
      winners: out,
    };
  });
}

export function claimRecord({ recordId, admin }) {
  return tx(() => {
    const record = q.get('SELECT * FROM DrawRecord WHERE id = ?', recordId);
    if (!record) throw notFound('记录不存在');
    if (record.status !== 'won') throw conflict('只有待兑奖的记录可以兑奖');
    q.run("UPDATE DrawRecord SET status = 'claimed', claimedAt = ? WHERE id = ?", now(), recordId);
    logAdminOp({ admin, action: 'record.claim', targetType: 'DrawRecord', targetId: recordId, lotteryId: record.lotteryId, before: { status: 'won' }, after: { status: 'claimed' } });
    return { ...record, status: 'claimed' };
  });
}

/**
 * 改数量的边界校验（纯函数，便于测试）：
 * 新总数不能小于已发出数量，remaining 随 delta 平移。
 */
export function planQuantityChange(prize, nextTotal) {
  const issued = prize.totalCount - prize.remainingCount;
  if (nextTotal < issued) {
    throw badRequest(`新总数不能小于已发出数量（已发出 ${issued} 份，需先撤回 ${issued - nextTotal} 条中奖记录）`);
  }
  const nextRemaining = prize.remainingCount + (nextTotal - prize.totalCount);
  if (nextRemaining < 0) throw badRequest('剩余数量不能为负');
  return { totalCount: nextTotal, remainingCount: nextRemaining };
}

export function lotteryStats(lotteryId) {
  const prizes = q.all('SELECT * FROM Prize WHERE lotteryId = ? ORDER BY sortOrder ASC, createdAt ASC', lotteryId);
  const pool = prizes.filter((p) => p.status === 'active' && p.remainingCount > 0);
  const total = pool.reduce((s, p) => s + p.remainingCount, 0);
  const rows = prizes.map((p) => ({
    ...p,
    issuedCount: p.totalCount - p.remainingCount,
    probability: pool.includes(p) && total > 0 ? p.remainingCount / total : 0,
  }));
  const counts = q.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'won' AND prizeTypeSnapshot != 'none' THEN 1 ELSE 0 END) AS won,
       SUM(CASE WHEN status = 'claimed' AND prizeTypeSnapshot != 'none' THEN 1 ELSE 0 END) AS claimed,
       SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked,
       SUM(CASE WHEN prizeTypeSnapshot = 'none' AND status != 'revoked' THEN 1 ELSE 0 END) AS none
     FROM DrawRecord WHERE lotteryId = ?`,
    lotteryId,
  );
  return {
    prizes: rows,
    poolRemaining: total,
    records: {
      total: counts?.total ?? 0,
      won: counts?.won ?? 0,
      claimed: counts?.claimed ?? 0,
      revoked: counts?.revoked ?? 0,
      none: counts?.none ?? 0,
    },
  };
}
