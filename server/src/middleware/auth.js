import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { q } from '../db.js';
import { forbidden, unauthorized } from '../lib/http.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** 可选认证：有 token 就解析，没有也不报错（公开接口用） */
export function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = q.get('SELECT id, username, displayName, email, role, createdAt FROM User WHERE id = ?', payload.sub);
    if (user) req.user = user;
  } catch { /* 忽略无效 token */ }
  next();
}

export function requireAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = q.get('SELECT id, username, displayName, email, role, createdAt FROM User WHERE id = ?', payload.sub);
    if (!user) return next(unauthorized('账号不存在'));
    req.user = user;
    next();
  } catch {
    next(unauthorized('登录已过期，请重新登录'));
  }
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('仅管理员可操作'));
  next();
}

