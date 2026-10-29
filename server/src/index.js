import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { rateLimit } from './lib/rateLimit.js';
import { HttpError } from './lib/http.js';
import authRoutes from './routes/auth.js';
import publicRoutes, { meRouter } from './routes/public.js';
import adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use('/api/admin/lotteries/:id/stage-brand', express.json({ limit: '3mb' }));
app.use(express.json({ limit: '256kb' }));

// 请求日志
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    if (req.path.startsWith('/api')) {
      console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 20 }), authRoutes);
app.use('/api/lotteries', publicRoutes);
app.use('/api/me', meRouter);
app.use('/api/admin', adminRoutes);

// 生产环境托管前端静态文件
const distDir = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next(new HttpError(404, 'NOT_FOUND', `接口不存在: ${req.method} ${req.path}`));
  next();
});

// 统一错误处理
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器开小差了，请稍后再试' } });
});

app.listen(config.port, () => {
  console.log(`\n  🎡 Luckydraw server  →  http://localhost:${config.port}`);
  console.log(`     API base  →  http://localhost:${config.port}/api\n`);
});

