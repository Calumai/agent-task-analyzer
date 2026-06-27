// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const db = require('./services/db');
const { decomposeTask, loadAgents } = require('./services/taskDecomposer');
const { runAllSubtasks } = require('./services/agentRunner');
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

// ── Task Decomposition (P1) ───────────────────────────────
app.post('/api/decompose', async (req, res) => {
  const { input } = req.body;

  if (!input || input.trim().length === 0) {
    return res.status(400).json({ error: '請輸入任務描述' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 未設定，請檢查 .env 檔案' });
  }

  const sessionId = uuidv4();
  res.json({ sessionId, status: 'decomposing' });

  try {
    db.createSession({ id: sessionId, title: input.slice(0, 40), rawInput: input });
    db.updateSessionStatus(sessionId, 'decomposing');

    sse.broadcast('session:created', { sessionId, status: 'decomposing', input });

    const { title, subtasks } = await decomposeTask(sessionId, input);

    db.updateSessionTitle(sessionId, title);
    db.createSubtasks(subtasks);
    db.updateSessionStatus(sessionId, 'pending');

    sse.broadcast('session:decomposed', { sessionId, title, subtasks });

  } catch (err) {
    console.error('[decompose error]', err);
    try { db.updateSessionStatus(sessionId, 'error'); } catch {}
    sse.broadcast('session:error', { sessionId, error: err.message });
  }
});

// ── Run Session (P2) ──────────────────────────────────────
app.post('/api/sessions/:id/run', async (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'running') {
    return res.status(409).json({ error: '已在執行中' });
  }

  const subtasks = db.getSubtasks(req.params.id);
  res.json({ ok: true, message: '開始執行' });

  db.updateSessionStatus(session.id, 'running');
  sse.broadcast('session:running', { sessionId: session.id });

  await runAllSubtasks(subtasks, session.raw_input, {
    onStart(subtask) {
      db.updateSubtaskStatus(subtask.id, 'running');
      sse.broadcast('subtask:updated', {
        subtaskId: subtask.id,
        sessionId: session.id,
        status: 'running',
      });
    },
    onDone(subtask, result) {
      db.updateSubtaskStatus(subtask.id, 'done', { result });
      sse.broadcast('subtask:updated', {
        subtaskId: subtask.id,
        sessionId: session.id,
        status: 'done',
        result,
      });
    },
    onError(subtask, error) {
      db.updateSubtaskStatus(subtask.id, 'error', { error });
      sse.broadcast('subtask:updated', {
        subtaskId: subtask.id,
        sessionId: session.id,
        status: 'error',
        error,
      });
    },
  });

  // 檢查是否全部完成
  const final = db.getSubtasks(session.id);
  const allDone = final.every(s => ['done', 'skipped'].includes(s.status));
  const hasError = final.some(s => s.status === 'error');
  const finalStatus = allDone ? 'done' : hasError ? 'error' : 'pending';

  db.updateSessionStatus(session.id, finalStatus);
  sse.broadcast('session:finished', { sessionId: session.id, status: finalStatus });
});

// ── Subtask manual status update ──────────────────────────
app.patch('/api/subtasks/:id/status', (req, res) => {
  const { status, result, error } = req.body;
  const validStatuses = ['pending', 'running', 'done', 'error', 'skipped'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status 必須是 ${validStatuses.join(' | ')}` });
  }

  try {
    db.updateSubtaskStatus(req.params.id, status, { result, error });
    sse.broadcast('subtask:updated', { subtaskId: req.params.id, status, result, error });
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
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
db.ready.then(() => app.listen(PORT, HOST, () => {
  console.log(`\n🤖 Agent Task Analyzer`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🌐 http://${HOST}:${PORT}`);
  console.log(`📦 DB: ${process.env.DB_PATH || './data/tasks.db'}`);
  console.log(`🔑 API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ 已設定' : '❌ 未設定（請檢查 .env）'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━\n`);
}));
