/**
 * buildLLMRequestBody 单测（思考模式 × 工具调用兼容）
 *
 * 背景（2026-09-10 生产实测）：DeepSeek V4 Flash 默认开启思考模式，
 * 「强制指定函数」的 tool_choice 会 400 "Thinking mode does not support this tool_choice"。
 * 因此 Agent 路由不再强制指定函数（改 auto + 意图提示），本函数保持思考模式默认开启
 * （不注入 thinking 参数），思考模式能显著提升工具参数提取质量（如准确抽出"西瓜"）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    ai: { apiKey: 'test-key', baseUrl: 'https://mock-deepseek', model: 'mock-model' },
  },
}));

import { buildLLMRequestBody } from '../services/agentService.js';

const MSGS = [{ role: 'user' as const, content: '小猫能吃板栗吗' }];

describe('buildLLMRequestBody', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // buildLLMRequestBody 是纯函数，不应发起真实请求；stub 掉防止意外外呼
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('test should not call fetch'))) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('强制指定函数（仍允许该入参，但路由已不产生）：tool_choice 为函数、不注入 thinking', () => {
    const b = buildLLMRequestBody(MSGS, { type: 'function', function: { name: 'query_food_safety' } });
    expect(b.tool_choice).toEqual({ type: 'function', function: { name: 'query_food_safety' } });
    expect(b.thinking).toBeUndefined();
    expect(b.tools).toBeTruthy();
    expect(b.model).toBe('mock-model');
  });

  it('auto：不注入 thinking（保持思考模式默认开启）', () => {
    const b = buildLLMRequestBody(MSGS, 'auto');
    expect(b.tool_choice).toBe('auto');
    expect(b.thinking).toBeUndefined();
  });

  it('缺省：等价 auto，不注入 thinking', () => {
    const b = buildLLMRequestBody(MSGS);
    expect(b.tool_choice).toBe('auto');
    expect(b.thinking).toBeUndefined();
  });

  it('none：不注入 thinking', () => {
    const b = buildLLMRequestBody(MSGS, 'none');
    expect(b.tool_choice).toBe('none');
    expect(b.thinking).toBeUndefined();
  });

  it('messages 原样透传', () => {
    const b = buildLLMRequestBody(MSGS, 'auto');
    expect(b.messages).toEqual(MSGS);
  });
});
