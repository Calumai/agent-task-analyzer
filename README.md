# 🤖 Agent Task Analyzer

> 輸入任何目標，AI 自動拆解成子任務並分派給最合適的 agent。

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## ✨ 功能

- **任務拆解** — 輸入目標，Claude 自動拆解成 2–8 個子任務
- **Agent 分派** — 每個子任務自動分配給最合適的 agent
- **即時狀態** — SSE 即時推送，不需刷新頁面
- **執行追蹤** — 手動標記子任務狀態（待執行 → 執行中 → 完成）
- **歷史紀錄** — 所有任務記錄在本機 SQLite

## 🚀 快速開始

### 方式 1：本機直接跑（最快）

```bash
git clone https://github.com/YOUR_NAME/agent-task-analyzer
cd agent-task-analyzer
cp .env.example .env
# 編輯 .env，填入你的 ANTHROPIC_API_KEY
npm install
npm start
```

打開 http://127.0.0.1:3000

### 方式 2：Docker

```bash
cp .env.example .env
# 編輯 .env，填入你的 ANTHROPIC_API_KEY
docker-compose up -d
```

打開 http://127.0.0.1:3000

## ⚙️ 設定

編輯 `.env`：

```env
ANTHROPIC_API_KEY=sk-ant-...   # 必填
PORT=3000                        # 選填，預設 3000
MODEL=claude-sonnet-4-6         # 選填，預設 claude-sonnet-4-6
```

## 🧩 自訂 Agents

編輯 `data/agents.json`，加入你自己的 agent 定義：

```json
{
  "id": "my_agent",
  "name": "我的 Agent",
  "role": "負責的工作描述",
  "skills": ["skill1", "skill2"],
  "icon": "🚀",
  "color": "#00FF88"
}
```

重啟伺服器後生效。

## 📡 API

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/agents` | 取得所有 agents |
| GET | `/api/sessions` | 取得歷史任務 |
| GET | `/api/sessions/:id` | 取得特定任務詳情 |
| POST | `/api/decompose` | 送出任務（觸發拆解） |
| PATCH | `/api/subtasks/:id/status` | 更新子任務狀態 |
| GET | `/api/events` | SSE 事件流 |
| GET | `/api/health` | 健康檢查 |

## 🗂 專案結構

```
agent-task-analyzer/
├── server.js              # Express 主伺服器
├── services/
│   ├── db.js              # SQLite 資料存取
│   ├── taskDecomposer.js  # Claude API 任務拆解
│   └── sse.js             # SSE 廣播
├── public/
│   └── index.html         # 前端 UI
├── data/
│   └── agents.json        # Agent 定義（可自訂）
├── .env.example
├── docker-compose.yml
└── Dockerfile
```

## 🗺 Roadmap

- [x] P0：專案骨架 + SQLite schema
- [x] P1：Claude 任務拆解 MVP
- [ ] P2：Agent 真實執行（串接 Claude API 自動執行子任務）
- [ ] P3：執行歷史 Replay 頁面
- [ ] P4：像素藝術風格 Agent 辦公室視覺
- [ ] P5：Webhook 整合（執行完成通知）

## 📄 License

MIT
