// services/agentRunner.js
// P2：每個子任務真的送給 Claude 執行，結果自動填回

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || 'claude-sonnet-4-6';

function loadAgents() {
  const agentsPath = path.join(__dirname, '../data/agents.json');
  return JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
}

/**
 * 執行單一子任務
 * @param {Object} subtask - 子任務資料
 * @param {string} sessionInput - 原始任務描述（提供背景）
 * @returns {Promise<string>} 執行結果
 */
async function runSubtask(subtask, sessionInput) {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === subtask.agent_id) || {
    name: subtask.agent_id,
    role: '通用助手',
    skills: [],
  };

  const systemPrompt = `你是「${agent.name}」，負責「${agent.role}」。
你的專長是：${agent.skills.join('、')}。

背景任務：${sessionInput}

你現在負責的子任務是第 ${subtask.seq} 步。
請專注完成這個子任務，給出具體、可用的產出。
回答要簡潔但完整，不需要解釋你是誰或重複任務描述。`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `請完成以下子任務：\n\n**${subtask.title}**\n\n${subtask.description}`,
      }
    ],
  });

  return response.content[0].text;
}

/**
 * 依序執行 session 的所有子任務
 * @param {Array} subtasks
 * @param {string} sessionInput - 原始任務描述
 * @param {Object} callbacks - { onStart, onDone, onError }
 */
async function runAllSubtasks(subtasks, sessionInput, callbacks = {}) {
  const { onStart, onDone, onError } = callbacks;

  for (const subtask of subtasks) {
    if (subtask.status === 'done' || subtask.status === 'skipped') continue;

    try {
      onStart && onStart(subtask);
      const result = await runSubtask(subtask, sessionInput);
      onDone && onDone(subtask, result);
    } catch (err) {
      onError && onError(subtask, err.message);
      // 單一子任務失敗不中斷，繼續下一個
    }
  }
}

module.exports = { runSubtask, runAllSubtasks };
