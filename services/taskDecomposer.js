// services/taskDecomposer.js
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || 'claude-sonnet-4-6';

// 載入可用的 agents
function loadAgents() {
  const agentsPath = path.join(__dirname, '../data/agents.json');
  return JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
}

/**
 * 將使用者輸入的任務拆解成子任務清單
 * @param {string} sessionId
 * @param {string} userInput - 使用者描述的任務
 * @returns {Promise<Array>} subtasks
 */
async function decomposeTask(sessionId, userInput) {
  const agents = loadAgents();

  const agentList = agents.map(a =>
    `- ${a.id} (${a.name}): ${a.role}，擅長 ${a.skills.join(', ')}`
  ).join('\n');

  const systemPrompt = `你是一個 AI Agent 任務規劃師。
你的工作是將使用者的任務拆解成可執行的子任務，並分派給最合適的 agent。

可用的 agents：
${agentList}

規則：
1. 子任務數量：2 到 8 個
2. 每個子任務必須可以獨立執行
3. 子任務要有明確的執行順序（seq 從 1 開始）
4. 描述要具體，讓 agent 知道「要做什麼」和「預期產出是什麼」
5. 必須嚴格回傳 JSON，不要加任何說明文字

回傳格式：
{
  "session_title": "簡短的任務標題（10字以內）",
  "subtasks": [
    {
      "seq": 1,
      "title": "子任務標題",
      "description": "具體說明這個子任務要做什麼，預期產出是什麼",
      "agent_id": "agent的id（必須是上面列表中的其中一個）"
    }
  ]
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      { role: 'user', content: `請幫我拆解這個任務：\n\n${userInput}` }
    ]
  });

  const rawText = response.content[0].text.trim();

  // 清理可能的 markdown code block
  const jsonText = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(jsonText);

  // 驗證 agent_id 合法性
  const validAgentIds = agents.map(a => a.id);
  const subtasks = parsed.subtasks.map((s, i) => ({
    id: uuidv4(),
    session_id: sessionId,
    seq: s.seq || i + 1,
    title: s.title,
    description: s.description,
    agent_id: validAgentIds.includes(s.agent_id) ? s.agent_id : validAgentIds[0],
  }));

  return {
    title: parsed.session_title || userInput.slice(0, 30),
    subtasks,
  };
}

module.exports = { decomposeTask, loadAgents };
