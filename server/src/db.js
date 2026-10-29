import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'luckydraw.db');

/** 单进程同步 SQLite 句柄。node:sqlite 是同步 API，事务内不会让出事件循环，天然串行。 */
export const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS User (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,
  email        TEXT,
  passwordHash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'user',
  createdAt    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Lottery (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft',   -- draft | active | ended
  startAt         TEXT,
  endAt           TEXT,
  shareCode       TEXT UNIQUE,
  maxDrawsPerUser INTEGER NOT NULL DEFAULT 1,
  autoEndWhenEmpty INTEGER NOT NULL DEFAULT 0,
  excludeLastOnRedraw INTEGER NOT NULL DEFAULT 1,
  prizePoolEmptyHint TEXT DEFAULT '',
  createdBy       TEXT REFERENCES User(id),
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Prize (
  id             TEXT PRIMARY KEY,
  lotteryId      TEXT NOT NULL REFERENCES Lottery(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  level          TEXT DEFAULT '',
  type           TEXT NOT NULL DEFAULT 'prize',    -- prize | none（谢谢参与）
  totalCount     INTEGER NOT NULL DEFAULT 0,
  remainingCount INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',   -- active | disabled
  sortOrder      INTEGER NOT NULL DEFAULT 0,
  image          TEXT DEFAULT '',
  color          TEXT DEFAULT '',
  version        INTEGER NOT NULL DEFAULT 1,       -- 乐观锁
  createdAt      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Participation (
  id              TEXT PRIMARY KEY,
  lotteryId       TEXT NOT NULL REFERENCES Lottery(id) ON DELETE CASCADE,
  userId          TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  currentRecordId TEXT,
  drawCount       INTEGER NOT NULL DEFAULT 0,
  createdAt       TEXT NOT NULL,
  UNIQUE (lotteryId, userId)
);

CREATE TABLE IF NOT EXISTS DrawRecord (
  id                 TEXT PRIMARY KEY,
  lotteryId          TEXT NOT NULL REFERENCES Lottery(id) ON DELETE CASCADE,
  userId             TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  prizeId            TEXT,
  status             TEXT NOT NULL DEFAULT 'won',  -- won | claimed | revoked
  prizeNameSnapshot  TEXT DEFAULT '',
  prizeLevelSnapshot TEXT DEFAULT '',
  prizeTypeSnapshot  TEXT DEFAULT 'prize',
  revokedBy          TEXT,
  revokedAt          TEXT,
  revokeReason       TEXT,
  claimedAt          TEXT,
  createdAt          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AdminOperationLog (
  id         TEXT PRIMARY KEY,
  adminId    TEXT,
  adminName  TEXT,
  action     TEXT NOT NULL,
  targetType TEXT,
  targetId   TEXT,
  lotteryId  TEXT,
  before     TEXT,
  after      TEXT,
  createdAt  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Idempotency (
  key       TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  scope     TEXT NOT NULL,
  recordId  TEXT,
  createdAt TEXT NOT NULL
);

-- 年会/现场模式：参与者签到资料（工号 + 姓名 + 头像 + 祝福语）
CREATE TABLE IF NOT EXISTS Enrollment (
  id          TEXT PRIMARY KEY,
  lotteryId   TEXT NOT NULL REFERENCES Lottery(id) ON DELETE CASCADE,
  userId      TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  employeeNo  TEXT NOT NULL,
  displayName TEXT NOT NULL,
  department  TEXT DEFAULT '',
  blessing    TEXT DEFAULT '',
  avatar      TEXT DEFAULT '',      -- 预设头像 key 或图片 dataURL / URL
  avatarKind  TEXT DEFAULT 'preset',-- preset | photo
  source      TEXT DEFAULT 'checkin',
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL,
  UNIQUE (lotteryId, employeeNo)
);

CREATE INDEX IF NOT EXISTS idx_prize_lottery ON Prize(lotteryId);
CREATE INDEX IF NOT EXISTS idx_record_lottery ON DrawRecord(lotteryId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_record_user ON DrawRecord(userId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_log_lottery ON AdminOperationLog(lotteryId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_enroll_lottery ON Enrollment(lotteryId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_enroll_user ON Enrollment(userId);
`;

db.exec(SCHEMA);

/** 老库升级：缺的列自动补上（SQLite 的 ALTER 只能加列，够用了） */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('Lottery', 'mode', "mode TEXT NOT NULL DEFAULT 'online'");        // online | onsite
ensureColumn('Lottery', 'checkinHint', 'checkinHint TEXT DEFAULT ""');
ensureColumn('DrawRecord', 'batchId', 'batchId TEXT');
ensureColumn('DrawRecord', 'source', "source TEXT NOT NULL DEFAULT 'online'"); // online | onsite
ensureColumn('User', 'displayName', 'displayName TEXT DEFAULT ""');

// batchId 是后来加的列，索引必须在补列之后再建
db.exec('CREATE INDEX IF NOT EXISTS idx_record_batch ON DrawRecord(batchId)');

export const now = () => new Date().toISOString();

export function uid(prefix = '') {
  const hex = randomUUID().replace(/-/g, '').slice(0, 24);
  return prefix ? `${prefix}_${hex}` : hex;
}

/** 短分享码：去掉易混淆字符，8 位 */
const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
export function shortCode(len = 8) {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return out;
}

/**
 * 事务包装。node:sqlite 是同步的，因此用显式 BEGIN IMMEDIATE / COMMIT。
 * 任何抛错都会 ROLLBACK 并向上冒泡。
 */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

export const q = {
  all: (sql, ...params) => db.prepare(sql).all(...params),
  get: (sql, ...params) => db.prepare(sql).get(...params),
  run: (sql, ...params) => db.prepare(sql).run(...params),
};

export function logAdminOp({ admin, action, targetType, targetId, lotteryId, before, after }) {
  q.run(
    `INSERT INTO AdminOperationLog (id, adminId, adminName, action, targetType, targetId, lotteryId, before, after, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    uid('log'),
    admin?.id ?? null,
    admin?.username ?? null,
    action,
    targetType ?? null,
    targetId ?? null,
    lotteryId ?? null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    now(),
  );
}

db.exec(`CREATE TABLE IF NOT EXISTS Employee (employeeNo TEXT PRIMARY KEY, displayName TEXT NOT NULL, department TEXT NOT NULL)`);

db.exec(`CREATE TABLE IF NOT EXISTS ActivityEmployee (lotteryId TEXT NOT NULL REFERENCES Lottery(id) ON DELETE CASCADE, employeeNo TEXT NOT NULL, displayName TEXT NOT NULL, department TEXT NOT NULL, PRIMARY KEY(lotteryId,employeeNo))`);
ensureColumn('Lottery', 'stageBrand', "stageBrand TEXT DEFAULT ''");
ensureColumn('Prize', 'photo', "photo TEXT NOT NULL DEFAULT ''");
