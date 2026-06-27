// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const db = require('./services/db');
const { decomposeTask, loadAgents } = require('./services/taskDecomposer');
const sse = require('./services/sse');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SSE endpoint ──────────────────────────────────────────
app.get('/api/events', (req, res) => {
  sse.addClient(res);
});

// ── Agents ────────────────────────────────────────────────
app.get('/api/agents', (req, res) => {
  try {
    const agents = loadAgents();
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ──────────────────────────────────────────────
app.get('/api/sessions', (req, res) => {
  const sessions = db.listSessions(30);
  res.json({ sessions });
});

app.get('/api/sessions/:id', (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const subtasks = db.getSubtasks(req.params.id);
  res.json({ session, subtasks });
});

// ── Task Decomposition (P1 核心) ──────────────────────────
app.post('/api/decompose', async (req, res) => {
  const { input } = req.body;

  if (!input || input.trim().length === 0) {
    return res.status(400).json({ error: '請輸入任務描述' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 未設定，請檢查 .env 檔案' });
  }

  const sessionId = uuidv4();

  // 立即回傳 session id，讓前端開始監聽
  res.json({ sessionId, status: 'decomposing' });

  // 背景執行拆解
  try {
    // 先建立 pending session（title 暫時用 input 前段）
    db.createSession({
      id: sessionId,
      title: input.slice(0, 40),
      rawInput: input,
    });
    db.updateSessionStatus(sessionId, 'decomposing');

    sse.broadcast('session:created', {
      sessionId,
      status: 'decomposing',
      input,
    });

    // 呼叫 Claude 拆解
    const { title, subtasks } = await decomposeTask(sessionId, input);

    // 更新 session title
    db.updateSessionTitle(sessionId, title);

    // 儲存子任務
    db.createSubtasks(subtasks);
    db.updateSessionStatus(sessionId, 'pending');

    sse.broadcast('session:decomposed', {
      sessionId,
      title,
      subtasks,
    });

  } catch (err) {
    console.error('[decompose error]', err);
    try {
      db.updateSessionStatus(sessionId, 'error');
    } catch {}
    sse.broadcast('session:error', {
      sessionId,
      error: err.message,
    });
  }
});

// ── Subtask status update ─────────────────────────────────
app.patch('/api/subtasks/:id/status', (req, res) => {
  const { status, result, error } = req.body;
  const validStatuses = ['pending', 'running', 'done', 'error', 'skipped'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status 必須是 ${validStatuses.join(' | ')}` });
  }

  try {
    db.updateSubtaskStatus(req.params.id, status, { result, error });

    sse.broadcast('subtask:updated', {
      subtaskId: req.params.id,
      status,
      result,
      error,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    model: process.env.MODEL || 'claude-sonnet-4-6',
    apiKeySet: !!process.env.ANTHROPIC_API_KEY,
    sseClients: sse.clientCount(),
  });
});

// ── Start ─────────────────────────────────────────────────
db.ready.then(() => app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🤖 Agent Task Analyzer`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🌐 http://127.0.0.1:${PORT}`);
  console.log(`📦 DB: ${process.env.DB_PATH || './data/tasks.db'}`);
  console.log(`🔑 API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ 已設定' : '❌ 未設定（請檢查 .env）'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━\n`);
}));
