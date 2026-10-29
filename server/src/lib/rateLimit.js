import { HttpError } from './http.js';

/**
 * 轻量固定窗口限流（单实例内存版）。
 * 生产多实例请换成 Redis 版本；此处保持零外部依赖。
 */
export function rateLimit({ windowMs = 60_000, max = 30, keyFn } = {}) {
  const hits = new Map();

  // 定期清理，避免 Map 无限增长
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }, windowMs);
  if (timer.unref) timer.unref();

  return (req, _res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    const t = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - t) / 1000);
      return next(new HttpError(429, 'RATE_LIMITED', `操作太频繁，请 ${retry} 秒后再试`));
    }
    next();
  };
}
