import { Router } from 'express';
import { z } from 'zod';
import { logAdminOp, now, q, shortCode, tx, uid } from '../db.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound, parseBody } from '../lib/http.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  claimRecord, getLotteryOr404, lotteryStats, planQuantityChange,
  raffle, raffleCandidates, revokeBatch, revokeRecord,
} from '../services/draw.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.patch('/lotteries/:id/stage-brand', asyncHandler((req,res)=>{
 getLotteryOr404(req.params.id);
 const image=z.string().max(1500000).refine(v=>v===''||/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v),'图片格式不支持');
 const brand=parseBody(z.object({company:z.string().trim().max(60),logo:image,background:image}),req.body);
 q.run('UPDATE Lottery SET stageBrand=?, updatedAt=? WHERE id=?',JSON.stringify(brand),now(),req.params.id);
 res.json({ok:true});
}));
router.get('/lotteries/:id/employees', asyncHandler((req, res) => { getLotteryOr404(req.params.id); res.json({items:q.all('SELECT employeeNo,displayName,department FROM ActivityEmployee WHERE lotteryId=? ORDER BY employeeNo',req.params.id)}); }));
router.post('/lotteries/:id/employees/import', asyncHandler((req,res) => {
 getLotteryOr404(req.params.id);
 const rows = parseBody(z.object({items:z.array(z.object({employeeNo:z.string().trim().regex(/^[A-Za-z0-9._-]{1,32}$/),displayName:z.string().trim().min(1).max(24),department:z.string().trim().min(1).max(32)})).min(1).max(10000)}), req.body).items;
 if(new Set(rows.map(r=>r.employeeNo)).size !== rows.length) throw badRequest('文件中存在重复工号，请修正后重试');
 tx(()=> {for(const r of rows) q.run('INSERT INTO ActivityEmployee VALUES (?,?,?,?) ON CONFLICT(lotteryId,employeeNo) DO UPDATE SET displayName=excluded.displayName, department=excluded.department',req.params.id,r.employeeNo,r.displayName,r.department);});
 res.json({count:rows.length});
}));

/* ------------------------------------------------------------------ */
/* 活动 CRUD                                                           */
/* ------------------------------------------------------------------ */

const lotteryInput = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(60),
  description: z.string().max(500).optional().default(''),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  maxDrawsPerUser: z.number().int().min(1).max(100).optional().default(1),
  autoEndWhenEmpty: z.boolean().optional().default(false),
  excludeLastOnRedraw: z.boolean().optional().default(true),
  mode: z.enum(['online', 'onsite']).optional().default('online'),
  checkinHint: z.string().max(120).optional().default(''),
});

router.get('/lotteries', asyncHandler((req, res) => {
  const { status } = req.query;
  const rows = status
    ? q.all('SELECT * FROM Lottery WHERE status = ? ORDER BY createdAt DESC', status)
    : q.all('SELECT * FROM Lottery ORDER BY createdAt DESC');
  res.json({
    lotteries: rows.map((l) => {
      const s = lotteryStats(l.id);
      return {
        ...l,
        prizeCount: s.prizes.filter((p) => p.status === 'active').length,
        poolRemaining: s.poolRemaining,
        records: s.records,
        shareUrl: l.shareCode ? `/l/${l.shareCode}` : null,
      };
    }),
  });
}));

router.post('/lotteries', asyncHandler((req, res) => {
  const input = parseBody(lotteryInput, req.body);
  if (input.startAt && input.endAt && new Date(input.endAt) <= new Date(input.startAt)) {
    throw badRequest('结束时间必须晚于开始时间');
  }
  const id = uid('lot');
  q.run(
    `INSERT INTO Lottery (id, title, description, status, startAt, endAt, maxDrawsPerUser,
       autoEndWhenEmpty, excludeLastOnRedraw, mode, checkinHint, createdBy, createdAt, updatedAt)
     VALUES (?,?,?, 'draft', ?,?,?,?,?,?,?,?,?,?)`,
    id, input.title, input.description, input.startAt ?? null, input.endAt ?? null,
    input.maxDrawsPerUser, input.autoEndWhenEmpty ? 1 : 0, input.excludeLastOnRedraw ? 1 : 0,
    input.mode, input.checkinHint,
    req.user.id, now(), now(),
  );
  logAdminOp({ admin: req.user, action: 'lottery.create', targetType: 'Lottery', targetId: id, lotteryId: id, after: input });
  res.status(201).json({ lottery: getLotteryOr404(id) });
}));

router.get('/lotteries/:id', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  res.json({ lottery, stats: lotteryStats(lottery.id) });
}));

router.patch('/lotteries/:id', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  if (lottery.status === 'ended') throw forbidden('活动已结束，只能查看');
  const input = parseBody(lotteryInput.partial(), req.body);
  const before = { ...lottery };
  const merged = {
    title: input.title ?? lottery.title,
    description: input.description ?? lottery.description,
    startAt: input.startAt === undefined ? lottery.startAt : input.startAt,
    endAt: input.endAt === undefined ? lottery.endAt : input.endAt,
    maxDrawsPerUser: input.maxDrawsPerUser ?? lottery.maxDrawsPerUser,
    autoEndWhenEmpty: input.autoEndWhenEmpty === undefined ? lottery.autoEndWhenEmpty : Number(input.autoEndWhenEmpty),
    excludeLastOnRedraw: input.excludeLastOnRedraw === undefined ? lottery.excludeLastOnRedraw : Number(input.excludeLastOnRedraw),
    mode: input.mode ?? (lottery.mode || 'online'),
    checkinHint: input.checkinHint ?? (lottery.checkinHint || ''),
  };
  if (merged.startAt && merged.endAt && new Date(merged.endAt) <= new Date(merged.startAt)) {
    throw badRequest('结束时间必须晚于开始时间');
  }
  q.run(
    `UPDATE Lottery SET title=?, description=?, startAt=?, endAt=?, maxDrawsPerUser=?,
       autoEndWhenEmpty=?, excludeLastOnRedraw=?, mode=?, checkinHint=?, updatedAt=? WHERE id=?`,
    merged.title, merged.description, merged.startAt, merged.endAt, merged.maxDrawsPerUser,
    merged.autoEndWhenEmpty, merged.excludeLastOnRedraw, merged.mode, merged.checkinHint,
    now(), lottery.id,
  );
  logAdminOp({ admin: req.user, action: 'lottery.update', targetType: 'Lottery', targetId: lottery.id, lotteryId: lottery.id, before, after: merged });
  res.json({ lottery: getLotteryOr404(lottery.id) });
}));

router.delete('/lotteries/:id', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);



  q.run('DELETE FROM Lottery WHERE id = ?', lottery.id);
  logAdminOp({ admin: req.user, action: 'lottery.delete', targetType: 'Lottery', targetId: lottery.id, lotteryId: lottery.id, before: lottery });
  res.json({ ok: true });
}));

/** 发布：生成分享码 + 校验奖池 */
router.post('/lotteries/:id/publish', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  if (lottery.status === 'active') throw conflict('活动已经发布了');
  if (lottery.status === 'ended') throw conflict('活动已结束，请先重新开启');

  return tx(() => {
    const prizes = q.all("SELECT * FROM Prize WHERE lotteryId = ? AND status = 'active' AND remainingCount > 0", lottery.id);
    if (!prizes.length) throw badRequest('至少要有一个可发放的奖品才能发布');
    const total = prizes.reduce((s, p) => s + p.remainingCount, 0);
    if (total <= 0) throw badRequest('奖池总量必须大于 0');

    const code = lottery.shareCode || shortCode(8);
    q.run("UPDATE Lottery SET status = 'active', shareCode = ?, updatedAt = ? WHERE id = ?", code, now(), lottery.id);
    logAdminOp({ admin: req.user, action: 'lottery.publish', targetType: 'Lottery', targetId: lottery.id, lotteryId: lottery.id, before: { status: lottery.status }, after: { status: 'active', shareCode: code } });
    res.json({ lottery: getLotteryOr404(lottery.id) });
  });
}));

router.post('/lotteries/:id/end', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  if (lottery.status !== 'active') throw conflict('只有进行中的活动可以结束');
  q.run("UPDATE Lottery SET status = 'ended', updatedAt = ? WHERE id = ?", now(), lottery.id);
  logAdminOp({ admin: req.user, action: 'lottery.end', targetType: 'Lottery', targetId: lottery.id, lotteryId: lottery.id, before: { status: 'active' }, after: { status: 'ended' } });
  res.json({ lottery: getLotteryOr404(lottery.id) });
}));

/** 重新开启（已结束 → 进行中），用于撤回被锁定的场景 */
router.post('/lotteries/:id/reopen', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  if (lottery.status !== 'ended') throw conflict('只有已结束的活动可以重新开启');
  q.run("UPDATE Lottery SET status = 'active', updatedAt = ? WHERE id = ?", now(), lottery.id);
  logAdminOp({ admin: req.user, action: 'lottery.reopen', targetType: 'Lottery', targetId: lottery.id, lotteryId: lottery.id, before: { status: 'ended' }, after: { status: 'active' } });
  res.json({ lottery: getLotteryOr404(lottery.id) });
}));

/* ------------------------------------------------------------------ */
/* 奖品 CRUD                                                           */
/* ------------------------------------------------------------------ */

const prizePhoto = z.string().max(180000).refine(v => v === '' || /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v), '实物图格式不支持');
const prizeInput = z.object({
  photo: prizePhoto.optional().default(''),
  name: z.string().trim().min(1, '奖品名称不能为空').max(40),
  level: z.string().trim().max(20).optional().default(''),
  type: z.enum(['prize', 'none']).optional().default('prize'),
  totalCount: z.number().int().min(0).max(1_000_000),
  sortOrder: z.number().int().optional(),
  image: z.string().max(500).optional().default(''),
  color: z.string().max(20).optional().default(''),
});

router.get('/lotteries/:id/prizes', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  res.json(lotteryStats(lottery.id));
}));

router.post('/lotteries/:id/prizes', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  if (lottery.status === 'ended') throw forbidden('活动已结束，只能查看');
  const input = parseBody(prizeInput, req.body);
  const idx = q.get('SELECT COALESCE(MAX(sortOrder), -1) AS m FROM Prize WHERE lotteryId = ?', lottery.id).m;
  const id = uid('prz');
  q.run(
    `INSERT INTO Prize (id, lotteryId, name, level, type, totalCount, remainingCount, status, sortOrder, image, color, version, createdAt)
     VALUES (?,?,?,?,?,?,?, 'active', ?,?,?,1,?)`,
    id, lottery.id, input.name, input.level, input.type, input.totalCount, input.totalCount,
    input.sortOrder ?? idx + 1, input.image, input.color, now(),
  );
  q.run('UPDATE Prize SET photo=? WHERE id=?', input.photo, id);
  logAdminOp({ admin: req.user, action: 'prize.create', targetType: 'Prize', targetId: id, lotteryId: lottery.id, after: input });
  res.status(201).json({ stats: lotteryStats(lottery.id) });
}));

const prizePatch = z.object({
  photo: prizePhoto.optional(),
  name: z.string().trim().min(1).max(40).optional(),
  level: z.string().trim().max(20).optional(),
  totalCount: z.number().int().min(0).max(1_000_000).optional(),
  sortOrder: z.number().int().optional(),
  image: z.string().max(500).optional(),
  color: z.string().max(20).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  version: z.number().int().optional(),   // 乐观锁
});

router.patch('/prizes/:id', asyncHandler((req, res) => {
  const prize = q.get('SELECT * FROM Prize WHERE id = ?', req.params.id);
  if (!prize) throw notFound('奖品不存在');
  const lottery = getLotteryOr404(prize.lotteryId);
  if (lottery.status === 'ended') throw forbidden('活动已结束，奖品只读');
  const input = parseBody(prizePatch, req.body);

  if (input.version !== undefined && input.version !== prize.version) {
    throw conflict('数据已被修改，请刷新后重试');
  }

  let nextTotal = prize.totalCount;
  let nextRemaining = prize.remainingCount;

  if (input.totalCount !== undefined && input.totalCount !== prize.totalCount) {
    const plan = planQuantityChange(prize, input.totalCount);
    nextTotal = plan.totalCount;
    nextRemaining = plan.remainingCount;
  }

  q.run(
    `UPDATE Prize SET name=?, level=?, totalCount=?, remainingCount=?, sortOrder=?, image=?, color=?, status=?, photo=?, version = version + 1
     WHERE id = ? AND version = ?`,
    input.name ?? prize.name,
    input.level ?? prize.level,
    nextTotal,
    nextRemaining,
    input.sortOrder ?? prize.sortOrder,
    input.image ?? prize.image,
    input.color ?? prize.color,
    input.status ?? prize.status,
    input.photo ?? prize.photo,
    prize.id,
    prize.version,
  );

  const updated = q.get('SELECT * FROM Prize WHERE id = ?', prize.id);
  if (updated.version === prize.version) throw conflict('数据已被修改，请刷新后重试');

  logAdminOp({
    admin: req.user, action: 'prize.update', targetType: 'Prize', targetId: prize.id, lotteryId: prize.lotteryId,
    before: prize, after: updated,
  });
  res.json({ stats: lotteryStats(prize.lotteryId) });
}));

router.post('/prizes/:id/disable', asyncHandler((req, res) => {
  const prize = q.get('SELECT * FROM Prize WHERE id = ?', req.params.id);
  if (!prize) throw notFound('奖品不存在');
  const lottery = getLotteryOr404(prize.lotteryId);
  if (lottery.status === 'ended') throw forbidden('活动已结束，奖品只读');
  q.run("UPDATE Prize SET status = 'disabled', version = version + 1 WHERE id = ?", prize.id);
  logAdminOp({ admin: req.user, action: 'prize.disable', targetType: 'Prize', targetId: prize.id, lotteryId: prize.lotteryId, before: { status: prize.status }, after: { status: 'disabled' } });
  res.json({ stats: lotteryStats(prize.lotteryId) });
}));

router.post('/prizes/:id/enable', asyncHandler((req, res) => {
  const prize = q.get('SELECT * FROM Prize WHERE id = ?', req.params.id);
  if (!prize) throw notFound('奖品不存在');
  const lottery = getLotteryOr404(prize.lotteryId);
  if (lottery.status === 'ended') throw forbidden('活动已结束，奖品只读');
  q.run("UPDATE Prize SET status = 'active', version = version + 1 WHERE id = ?", prize.id);
  logAdminOp({ admin: req.user, action: 'prize.enable', targetType: 'Prize', targetId: prize.id, lotteryId: prize.lotteryId, before: { status: prize.status }, after: { status: 'active' } });
  res.json({ stats: lotteryStats(prize.lotteryId) });
}));

/** 删除：无人中奖则物理删除，否则只能下架（保留历史） */
router.delete('/prizes/:id', asyncHandler((req, res) => {
  const prize = q.get('SELECT * FROM Prize WHERE id = ?', req.params.id);
  if (!prize) throw notFound('奖品不存在');
  const lottery = getLotteryOr404(prize.lotteryId);
  if (lottery.status === 'ended') throw forbidden('活动已结束，奖品只读');

  const used = q.get('SELECT COUNT(*) AS c FROM DrawRecord WHERE prizeId = ?', prize.id).c;
  if (used > 0) {
    q.run("UPDATE Prize SET status = 'disabled', version = version + 1 WHERE id = ?", prize.id);
    logAdminOp({ admin: req.user, action: 'prize.disable_existing_records', targetType: 'Prize', targetId: prize.id, lotteryId: prize.lotteryId, before: prize, after: { status: 'disabled' } });
    return res.json({ deleted: false, disabled: true, message: `该奖品已有 ${used} 条中奖记录，已改为下架处理（历史记录保留）`, stats: lotteryStats(prize.lotteryId) });
  }

  q.run('DELETE FROM Prize WHERE id = ?', prize.id);
  logAdminOp({ admin: req.user, action: 'prize.delete', targetType: 'Prize', targetId: prize.id, lotteryId: prize.lotteryId, before: prize });
  res.json({ deleted: true, stats: lotteryStats(prize.lotteryId) });
}));

/* ------------------------------------------------------------------ */
/* 中奖名单 / 撤回 / 兑奖 / 统计 / 日志                                  */
/* ------------------------------------------------------------------ */

router.get('/lotteries/:id/records', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 20));
  const status = req.query.status;
  const keyword = (req.query.keyword || '').trim();

  const where = ['r.lotteryId = ?'];
  const params = [lottery.id];
  if (status && ['won', 'claimed', 'revoked'].includes(status)) { where.push('r.status = ?'); params.push(status); }
  if (keyword) { where.push('(u.username LIKE ? OR e.displayName LIKE ? OR u.displayName LIKE ? OR e.employeeNo LIKE ? OR r.prizeNameSnapshot LIKE ?)'); params.push(...Array(5).fill(`%${keyword}%`)); }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = q.get(
    `SELECT COUNT(*) AS c FROM DrawRecord r JOIN User u ON u.id = r.userId LEFT JOIN Enrollment e ON e.lotteryId=r.lotteryId AND e.userId=r.userId ${whereSql}`, ...params,
  ).c;

  const records = q.all(
    `SELECT r.*, u.username, COALESCE(NULLIF(e.displayName, ''), u.displayName) AS displayName, e.employeeNo
     FROM DrawRecord r JOIN User u ON u.id = r.userId LEFT JOIN Enrollment e ON e.lotteryId=r.lotteryId AND e.userId=r.userId
     ${whereSql}
     ORDER BY r.createdAt DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize,
  );

  res.json({ records, total, page, pageSize, stats: lotteryStats(lottery.id) });
}));

router.post('/records/:id/revoke', asyncHandler((req, res) => {
  const reason = String(req.body?.reason || '').slice(0, 200);
  const record = revokeRecord({ recordId: req.params.id, admin: req.user, reason });
  res.json({ record });
}));

router.post('/records/:id/claim', asyncHandler((req, res) => {
  const record = claimRecord({ recordId: req.params.id, admin: req.user });
  res.json({ record });
}));

/* ------------------------------------------------------------------ */
/* 年会现场模式：签到名单 + 按奖项抽奖 + 整批回退                        */
/* ------------------------------------------------------------------ */

/** 签到名单（含中奖状态） */
router.get('/lotteries/:id/enrollments', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  const keyword = (req.query.keyword || '').trim();
  const where = ['e.lotteryId = ?'];
  const params = [lottery.id];
  if (keyword) {
    where.push('(e.employeeNo LIKE ? OR e.displayName LIKE ? OR e.department LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const items = q.all(
    `SELECT e.*,
            p.currentRecordId,
            r.prizeNameSnapshot, r.prizeLevelSnapshot, r.status AS recordStatus, r.batchId
     FROM Enrollment e
     LEFT JOIN Participation p ON p.lotteryId = e.lotteryId AND p.userId = e.userId
     LEFT JOIN DrawRecord r ON r.id = p.currentRecordId
     ${whereSql}
     ORDER BY e.createdAt DESC`,
    ...params,
  );
  const eligible = raffleCandidates(lottery.id).length;
  res.json({ items, total: items.length, eligible });
}));

/** 现场抽奖：指定奖品一次抽出 N 人 */
router.post('/lotteries/:id/raffle', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  const { prizeId, count } = parseBody(
    z.object({ prizeId: z.string().min(1, '请选择奖品'), count: z.number().int().min(1).max(50).optional().default(1) }),
    req.body,
  );
  const result = raffle({ lotteryId: lottery.id, prizeId, count, admin: req.user });
  res.json(result);
}));

/** 整批回退（这一轮抽的人全部作废，可重抽） */
router.post('/batches/:batchId/revoke', asyncHandler((req, res) => {
  const reason = String(req.body?.reason || '').slice(0, 200);
  res.json(revokeBatch({ batchId: req.params.batchId, admin: req.user, reason }));
}));

router.get('/lotteries/:id/stats', asyncHandler((req, res) => {
  const lottery = getLotteryOr404(req.params.id);
  res.json({ lottery, ...lotteryStats(lottery.id) });
}));

router.get('/logs', asyncHandler((req, res) => {
  const { lotteryId } = req.query;
  const rows = lotteryId
    ? q.all('SELECT * FROM AdminOperationLog WHERE lotteryId = ? ORDER BY createdAt DESC LIMIT 200', lotteryId)
    : q.all('SELECT * FROM AdminOperationLog ORDER BY createdAt DESC LIMIT 200');
  res.json({ logs: rows });
}));

export default router;






