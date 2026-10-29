import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { now, q, uid } from '../db.js';
import { asyncHandler, badRequest, conflict, notFound, parseBody, unauthorized } from '../lib/http.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { rateLimit } from '../lib/rateLimit.js';
import { checkin } from '../services/checkin.js';
import { getLotteryByShareCode } from '../services/draw.js';

const router = Router();

const credentials = z.object({
  username: z.string().trim().min(3, '用户名至少 3 个字符').max(32, '用户名最多 32 个字符'),
  password: z.string().min(6, '密码至少 6 位').max(64),
});

router.post('/register', asyncHandler((req, res) => {
  const { username, password } = parseBody(credentials.extend({ email: z.string().email().optional().or(z.literal('')) }), req.body);
  const exists = q.get('SELECT id FROM User WHERE username = ?', username);
  if (exists) throw conflict('用户名已被占用');

  const user = {
    id: uid('usr'),
    username,
    email: req.body?.email || null,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'user',
    createdAt: now(),
  };
  q.run('INSERT INTO User (id, username, email, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?)',
    user.id, user.username, user.email, user.passwordHash, user.role, user.createdAt);

  res.status(201).json({
    token: signToken(user),
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  });
}));

router.post('/login', asyncHandler((req, res) => {
  const { username, password } = parseBody(credentials, req.body);
  const user = q.get('SELECT * FROM User WHERE username = ?', username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) throw unauthorized('用户名或密码错误');
  res.json({
    token: signToken(user),
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/**
 * 年会现场签到：工号 + 姓名，免密码。
 * 首次签到会按工号建一个内部账号并返回 JWT；同工号再签一次视为更新资料。
 */
const checkinSchema = z.object({
  shareCode: z.string().trim().min(1, '缺少活动标识'),
  employeeNo: z.string().trim().min(1, '请填写工号').max(32),
  displayName: z.string().trim().min(1, '请填写姓名').max(24),
  department: z.string().trim().max(32).optional().default(''),
  blessing: z.string().trim().max(120).optional().default(''),
  avatar: z.string().max(400_000).optional().default(''),   // 预设 key，或压缩后的图片 dataURL
  avatarKind: z.enum(['preset', 'photo']).optional().default('preset'),
});

router.post('/checkin',
  rateLimit({ windowMs: 60_000, max: 20, keyFn: (req) => `checkin:${req.ip}` }),
  asyncHandler((req, res) => {
    const body = parseBody(checkinSchema, req.body);
    const targetLottery = getLotteryByShareCode(body.shareCode);
    if (!targetLottery) throw notFound('活动不存在');
    const employee = q.get('SELECT * FROM ActivityEmployee WHERE lotteryId = ? AND employeeNo = ?', targetLottery.id, body.employeeNo);
    if (!employee) throw badRequest('工号不存在，请联系管理员核对员工名册');
    if (employee.displayName !== body.displayName) throw badRequest('姓名与工号不匹配');
    if (employee.department !== body.department) throw badRequest('所选部门与员工名册不匹配');
    const lottery = getLotteryByShareCode(body.shareCode);
    if (!lottery) throw notFound('活动不存在或分享链接无效');

    const { user, enrollment, updated } = checkin({
      lottery,
      employeeNo: body.employeeNo,
      displayName: body.displayName,
      department: body.department,
      blessing: body.blessing,
      avatar: body.avatar,
      avatarKind: body.avatarKind,
    });

    res.json({
      token: signToken(user),
      updated,
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
      enrollment,
    });
  }));

export default router;


