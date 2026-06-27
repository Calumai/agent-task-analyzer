// services/db.js — 使用 sql.js（純 JS SQLite，零原生依賴）
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './data/tasks.db';
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let db;   // sql.js Database instance
let SQL;  // sql.js module

// sql.js 是非同步初始化，用這個 promise 確保 ready
const ready = initSqlJs().then(SqlJs => {
  SQL = SqlJs;
  // 讀取已有 DB 或建立新的
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  initSchema();
  return db;
});

function save() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS task_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      raw_input TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      agent_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      result TEXT,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_subtasks_session ON subtasks(session_id);
  `);
  save();
}

// ── helpers ──────────────────────────────────────────────
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

// ── Session CRUD ──────────────────────────────────────────
function createSession({ id, title, rawInput }) {
  run(`INSERT INTO task_sessions (id, title, raw_input) VALUES (?,?,?)`,
    [id, title, rawInput]);
  return getSession(id);
}

function getSession(id) {
  return get('SELECT * FROM task_sessions WHERE id = ?', [id]);
}

function listSessions(limit = 20) {
  return all(`SELECT * FROM task_sessions ORDER BY created_at DESC LIMIT ?`, [limit]);
}

function updateSessionStatus(id, status) {
  run(`UPDATE task_sessions SET status=?, updated_at=strftime('%s','now') WHERE id=?`,
    [status, id]);
}

function updateSessionTitle(id, title) {
  run(`UPDATE task_sessions SET title=? WHERE id=?`, [title, id]);
}

// ── Subtask CRUD ──────────────────────────────────────────
function createSubtasks(subtasks) {
  for (const s of subtasks) {
    run(`INSERT INTO subtasks (id,session_id,seq,title,description,agent_id)
         VALUES (?,?,?,?,?,?)`,
      [s.id, s.session_id, s.seq, s.title, s.description, s.agent_id]);
  }
}

function getSubtasks(sessionId) {
  return all('SELECT * FROM subtasks WHERE session_id=? ORDER BY seq ASC', [sessionId]);
}

function updateSubtaskStatus(id, status, { result, error } = {}) {
  const now = Math.floor(Date.now() / 1000);
  run(`UPDATE subtasks SET
        status=?,
        result=COALESCE(?,result),
        error=COALESCE(?,error),
        started_at=CASE WHEN ?=1 THEN ? ELSE started_at END,
        finished_at=CASE WHEN ?=1 THEN ? ELSE finished_at END
       WHERE id=?`,
    [
      status,
      result || null,
      error || null,
      status === 'running' ? 1 : 0, now,
      ['done','error','skipped'].includes(status) ? 1 : 0, now,
      id
    ]
  );
}

module.exports = {
  ready,
  createSession,
  getSession,
  listSessions,
  updateSessionStatus,
  updateSessionTitle,
  createSubtasks,
  getSubtasks,
  updateSubtaskStatus,
};
