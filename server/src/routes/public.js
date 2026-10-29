import { Router } from 'express';
import { q, now } from '../db.js';
import { asyncHandler, conflict, notFound } from '../lib/http.js';
import { rateLimit } from '../lib/rateLimit.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { buildPool, draw, getLotteryByShareCode, myResult, withProbability } from '../services/draw.js';
import { enrollmentWall, myEnrollment } from '../services/checkin.js';

const router = Router();
router.get('/departments/:shareCode', asyncHandler((req,res) => { const l=getLotteryByShareCode(req.params.shareCode); if(!l) throw notFound('活动不存在'); res.json({departments:q.all('SELECT DISTINCT department FROM ActivityEmployee WHERE lotteryId=? ORDER BY department',l.id).map(r=>r.department)}); }));

function publicLotteryView(lottery) {
  const { prizes, total } = buildPool(lottery.id);
  const checkinCount = q.get('SELECT COUNT(*) AS n FROM Enrollment WHERE lotteryId = ?', lottery.id)?.n ?? 0;
  return {
    id: lottery.id,
    title: lottery.title,
    description: lottery.description,
    status: lottery.status,
    startAt: lottery.startAt,
    endAt: lottery.endAt,
    shareCode: lottery.shareCode,
    maxDrawsPerUser: lottery.maxDrawsPerUser,
    mode: lottery.mode || 'online',          // online 自助抽奖 | onsite 年会现场
    checkinHint: lottery.checkinHint || '',
    checkinCount,
    poolRemaining: total,
    // 现场模式要展示全部奖项（含已抽完的），所以额外给一份完整清单
    allPrizes: q.all(
      `SELECT id, name, level, type, image, color, totalCount, remainingCount, status
       FROM Prize WHERE lotteryId = ? AND status = 'active' ORDER BY sortOrder ASC, createdAt ASC`,
      lottery.id,
    ),
    prizes: withProbability(prizes, total).map((p) => ({
      id: p.id,
      name: p.name,
      level: p.level,
      type: p.type,
      image: p.image,
      color: p.color,
      sortOrder: p.sortOrder,
      remainingCount: p.remainingCount,
      probability: p.probability,
    })),
  };
}

/** 公开：正在进行中的活动列表（首页用） */
router.get('/', optionalAuth, asyncHandler((req, res) => {
  const rows = q.all("SELECT * FROM Lottery WHERE status = 'active' ORDER BY createdAt DESC LIMIT 20");
  res.json({
    lotteries: rows.map((l) => {
      const { total } = buildPool(l.id);
      return {
        id: l.id, title: l.title, description: l.description, shareCode: l.shareCode,
        endAt: l.endAt, poolRemaining: total,
        prizeCount: q.get("SELECT COUNT(*) AS c FROM Prize WHERE lotteryId = ? AND status = 'active'", l.id).c,
      };
    }),
  });
}));

/** 公开：通过分享码看活动详情（不登录也能看） */
router.get('/share/:shareCode', optionalAuth, asyncHandler((req, res) => {
  const lottery = getLotteryByShareCode(req.params.shareCode);
  if (!lottery) throw notFound('分享链接无效或活动不存在');
  const view = publicLotteryView(lottery);
  if (req.user) {
    const { participation, record, revokedNotice } = myResult(lottery.id, req.user.id);
    view.me = {
      hasParticipated: Boolean(participation?.currentRecordId),
      record,
      drawCount: participation?.drawCount ?? 0,
      canDraw: lottery.status === 'active' && !participation?.currentRecordId && (participation?.drawCount ?? 0) < lottery.maxDrawsPerUser,
      revoked: revokedNotice && revokedNotice.status === 'revoked'
        ? { revokedAt: revokedNotice.revokedAt, reason: revokedNotice.revokeReason, prizeName: revokedNotice.prizeNameSnapshot }
        : null,
    };
  }
  res.json({ lottery: view });
}));

/** 公开：签到墙（头像 + 祝福语，年会大屏 / 活动页展示） */
router.get('/:id/enrollments', asyncHandler((req, res) => {
  const lottery = q.get('SELECT id FROM Lottery WHERE id = ?', req.params.id);
  if (!lottery) throw notFound('活动不存在');
  res.json(enrollmentWall(req.params.id, { limit: Number(req.query.limit) || 200 }));
}));

/** 我的签到资料 */
router.get('/:id/my-enrollment', requireAuth, asyncHandler((req, res) => {
  res.json({ enrollment: myEnrollment(req.params.id, req.user.id) });
}));

/** 执行抽奖（必须登录 + 限流） */
router.post('/:id/draw', requireAuth,
  rateLimit({ windowMs: 10_000, max: 6, keyFn: (req) => `draw:${req.user.id}` }),
  asyncHandler((req, res) => {
    const key = req.get('Idempotency-Key') || null;
    const result = draw({ lotteryId: req.params.id, user: req.user, idempotencyKey: key });
    const { prizes, total } = buildPool(req.params.id);
    res.json({
      replayed: result.replayed,
      record: {
        id: result.record.id,
        prizeId: result.record.prizeId,
        prizeName: result.record.prizeNameSnapshot,
        prizeLevel: result.record.prizeLevelSnapshot,
        prizeType: result.record.prizeTypeSnapshot,
        isWin: result.record.prizeTypeSnapshot !== 'none',
        createdAt: result.record.createdAt,
      },
      wheel: {
        // 前端用它定位扇区：按奖品顺序 + 当前剩余量
        prizes: withProbability(prizes, total).map((p) => ({
          id: p.id, name: p.name, level: p.level, type: p.type,
          remainingCount: p.remainingCount, probability: p.probability, color: p.color,
        })),
      },
    });
  }));

router.get('/:id/my-result', requireAuth, asyncHandler((req, res) => {
  const lottery = q.get('SELECT * FROM Lottery WHERE id = ?', req.params.id);
  if (!lottery) throw notFound('活动不存在');
  const { participation, record, revokedNotice } = myResult(lottery.id, req.user.id);
  res.json({ record, participation, revokedNotice });
}));

/** 公开：最近中奖播报（用户名脱敏） */
router.get('/:id/winners', asyncHandler((req, res) => {
  const rows = q.all(
    `SELECT r.prizeNameSnapshot, r.prizeLevelSnapshot, r.createdAt, u.username
     FROM DrawRecord r JOIN User u ON u.id = r.userId
     WHERE r.lotteryId = ? AND r.status IN ('won','claimed') AND r.prizeTypeSnapshot != 'none'
     ORDER BY r.createdAt DESC LIMIT 12`,
    req.params.id,
  );
  res.json({
    winners: rows.map((r) => ({
      user: r.username.length <= 1 ? `${r.username}*` : `${r.username.slice(0, 1)}${'*'.repeat(Math.min(3, r.username.length - 1))}`,
      prize: r.prizeNameSnapshot,
      level: r.prizeLevelSnapshot,
      at: r.createdAt,
    })),
  });
}));

export default router;

/** 我的全部中奖记录 */
export const meRouter = Router();
meRouter.get('/records', requireAuth, asyncHandler((req, res) => {
  const rows = q.all(
    `SELECT r.*, l.title AS lotteryTitle, l.shareCode
     FROM DrawRecord r JOIN Lottery l ON l.id = r.lotteryId
     WHERE r.userId = ? ORDER BY r.createdAt DESC`,
    req.user.id,
  );
  res.json({ records: rows });
}));


