/**
 * Agent 意图路由回归测试：「记录回忆」不得被判成 chat 而禁用工具
 *
 * 事故背景（2026-09-11 生产实测）：
 *   用户说"记录回忆…"，LLM 意图分类器返回 {"intent":"chat","confidence":0.9}，
 *   agentLoop 对 chat 意图走 tool_choice='none'（禁用全部工具）→ 模型物理上无法调用
 *   record_memory，只会用文字回一句"记下了"（生产日志：intent=chat、tool_chain 为空）。
 *   用户以为记了，去「时光」什么都没有。
 *
 * 修复：agentRuleIntent.detectMemoryRecordIntent 规则预筛命中 → 直接锁定 memory 意图
 * （跳过 LLM 分类）→ auto + 意图提示 record_memory。
 *
 * 本测试锁死三点：
 *   ① 明确请求（"记录回忆…"/"帮我记下今天的事"）：tool_choice 不再是 'none'，且系统提示词
 *      点名 record_memory（工具真正可被调用）；
 *   ② 对照组普通分享（chat）：仍是 tool_choice='none' 且无 record_memory 提示，边界未被放宽。
 *
 * 注意：agentLoop 除主循环外还会异步触发「记忆摄入」的 LLM 调用，该调用不带 tools；
 * 断言一律只看**带 tools 的请求体**（即 Agent 主循环请求），避免被异步请求干扰。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));

vi.mock('../config.js', () => ({
  config: {
    ai: { apiKey: 'test-key', baseUrl: 'https://mock-deepseek', model: 'mock-model' },
  },
}));

vi.mock('../db.js', () => ({ pool: mockPool }));

import { agentLoop } from '../services/agentService.js';

/** 构造一次 OpenAI 兼容的成功响应（纯文本回复，不触发工具执行） */
function llmTextResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  };
}

/** 单次 LLM 请求体（只保留测试关心的字段） */
interface LLMBody {
  tools?: unknown;
  tool_choice?: unknown;
  messages: Array<{ role: string; content: string }>;
}

/**
 * 跑完一次 agentLoop，返回 Agent 主循环发出的请求体（带 tools 的那些）与事件类型
 * @param message - 用户消息
 */
async function runAgent(message: string) {
  const all: LLMBody[] = [];
  const events: string[] = [];

  globalThis.fetch = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
    all.push(JSON.parse(String(init.body || '{}')) as LLMBody);
    // 模拟事故现场：意图分类器无论问什么都回 chat 意图
    return llmTextResponse('{"intent":"chat","confidence":0.9,"reason":"分享日常"}') as unknown as Response;
  }) as unknown as typeof fetch;

  for await (const event of agentLoop(message, [], { userId: 'user-1', petId: 'pet-1' })) {
    events.push(event.type);
  }
  return { agentBodies: all.filter((b) => b.tools), events };
}

describe('agentLoop 意图路由 - 记录回忆', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockPool.query.mockReset();
    // 系统提示词构建会读库（宠物档案/长期记忆等）：统一给空结果，本测试不关心内容
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('明确"记录回忆"：不禁用工具，且系统提示词点名 record_memory', async () => {
    const { agentBodies, events } = await runAgent('记录回忆：豆豆今天追逗猫棒玩疯了');

    // 主循环只跑一轮（pre-screen 命中 → 无工具调用 → 直接出文案）
    expect(agentBodies).toHaveLength(1);
    // ① 工具的物理可用性：chat 意图的 'none' 会让 record_memory 永远调不到
    expect(agentBodies[0].tool_choice).toBe('auto');
    // ② 确定性意图提示：必须注入"本轮意图提示 + record_memory"（基础提示词本来就提到
    //    record_memory，所以断言点是hint 段落本身，而不是工具名是否出现）
    expect(agentBodies[0].messages[0].content).toContain('本轮意图提示');
    expect(agentBodies[0].messages[0].content).toContain('**record_memory**');
    expect(events).toContain('done');
  });

  it('本人明确要求记录但分类器说 chat：仍走 memory 路由（核心回归）', async () => {
    const { agentBodies } = await runAgent('帮我记下今天的事');

    expect(agentBodies).toHaveLength(1);
    expect(agentBodies[0].tool_choice).not.toBe('none');
    expect(agentBodies[0].messages[0].content).toContain('**record_memory**');
  });

  it('对照组：普通分享仍是 chat 路由（tool_choice=none 且无记录提示），边界未被放宽', async () => {
    const { agentBodies } = await runAgent('今天可乐和布丁两个人在房子里跑来跑去的 吵死了 他们玩的很开心');

    expect(agentBodies).toHaveLength(1);
    expect(agentBodies[0].tool_choice).toBe('none');
    expect(agentBodies[0].messages[0].content).not.toContain('本轮意图提示');
  });
});
