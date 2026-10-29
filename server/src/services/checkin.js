import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { now, q, tx, uid } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';

/**
 * 年会/现场模式签到：工号 + 姓名，免密码。
 * 同一工号重复签到视为"更新资料"，不会产生重复记录。
 */

const ENO_RE = /^[A-Za-z0-9._-]{1,32}$/;

export function normalizeEmployeeNo(raw) {
  const v = String(raw ?? '').trim();
  if (!v) throw badRequest('请填写工号');
  if (!ENO_RE.test(v)) throw badRequest('工号只能包含字母、数字、点、下划线和中划线');
  return v;
}

/** 工号对应的内部账号名，同一工号跨活动复用同一个 User */
export const employeeUsername = (employeeNo) => `emp:${employeeNo}`;

function ensureUser(employeeNo, displayName, lotteryId) {
  const username = `emp:${lotteryId}:${employeeNo}`;
  let user = q.get('SELECT * FROM User WHERE username = ?', username);
  if (!user) {
    const id = uid('usr');
    q.run(
      'INSERT INTO User (id, username, passwordHash, role, displayName, createdAt) VALUES (?,?,?,?,?,?)',
      id, username, bcrypt.hashSync(randomBytes(24).toString('hex'), 10), 'user', displayName, now(),
    );
    user = q.get('SELECT * FROM User WHERE id = ?', id);
  } else if (displayName && user.displayName !== displayName) {
    q.run('UPDATE User SET displayName = ? WHERE id = ?', displayName, user.id);
    user.displayName = displayName;
  }
  return user;
}

export function checkin({ lottery, employeeNo, displayName, department = '', blessing = '', avatar = '', avatarKind = 'preset' }) {
  if (lottery.status !== 'active') throw conflict('活动未开放签到');
  if (lottery.endAt && new Date(lottery.endAt).getTime() < Date.now()) throw conflict('活动已结束');

  const eno = normalizeEmployeeNo(employeeNo);
  const name = String(displayName ?? '').trim();
  if (!name) throw badRequest('请填写姓名');
  if (name.length > 24) throw badRequest('姓名最多 24 个字符');
  if (blessing && blessing.length > 120) throw badRequest('祝福语最多 120 个字');
  if (department && department.length > 32) throw badRequest('部门最多 32 个字');

  return tx(() => {
    const prev = q.get('SELECT * FROM Enrollment WHERE lotteryId = ? AND employeeNo = ?', lottery.id, eno);
    // Preserve an existing enrollment's identity and its prize history on re-check-in.
    const user = (prev && q.get('SELECT * FROM User WHERE id = ?', prev.userId)) || ensureUser(eno, name, lottery.id);
    const payload = [lottery.id, user.id, eno, name, department, blessing, avatar, avatarKind === 'photo' ? 'photo' : 'preset'];

    if (prev) {
      q.run(
        `UPDATE Enrollment SET userId = ?, displayName = ?, department = ?, blessing = ?,
         avatar = ?, avatarKind = ?, updatedAt = ? WHERE id = ?`,
        user.id, name, department, blessing, avatar, avatarKind === 'photo' ? 'photo' : 'preset', now(), prev.id,
      );
    } else {
      q.run(
        `INSERT INTO Enrollment (id, lotteryId, userId, employeeNo, displayName, department, blessing, avatar, avatarKind, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        uid('enr'), ...payload, now(), now(),
      );
    }

    const enrollment = q.get('SELECT * FROM Enrollment WHERE lotteryId = ? AND employeeNo = ?', lottery.id, eno);
    return { user, enrollment, updated: !!prev };
  });
}

export function myEnrollment(lotteryId, userId) {
  return q.get('SELECT * FROM Enrollment WHERE lotteryId = ? AND userId = ?', lotteryId, userId) || null;
}

/** 签到墙：头像 + 姓名 + 祝福语（公开，供大屏展示） */
export function enrollmentWall(lotteryId, { limit = 200 } = {}) {
  const rows = q.all(
    `SELECT employeeNo, displayName, department, blessing, avatar, avatarKind, createdAt
     FROM Enrollment WHERE lotteryId = ? ORDER BY createdAt DESC LIMIT ?`,
    lotteryId, limit,
  );
  const total = q.get('SELECT COUNT(*) AS n FROM Enrollment WHERE lotteryId = ?', lotteryId)?.n ?? 0;
  return { total, items: rows };
}

export function requireEnrollment(lotteryId, userId) {
  const e = myEnrollment(lotteryId, userId);
  if (!e) throw notFound('请先完成签到');
  return e;
}

