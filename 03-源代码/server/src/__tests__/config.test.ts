/**
 * buildAiConfig 单测（2026-09-10 策略变更：官方 DeepSeek 为唯一运行时入口）
 *
 * 背景：原逻辑"检测到任一 ARK_* 就整组切火山方舟"已按用户决策移除——
 * 微信「深度合成-AI问答」类目的火山合作协议仅作报备材料，运行时一律走官方 API。
 * 本测试锁定：①AI_* 整组语义 + 官方默认兜底；②误配 ARK_* 必须被忽略（防回切）；
 * ③纯空格 key 视为未配置。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildAiConfig } from '../config'

// 只关心 buildAiConfig 纯函数，为避免受 .env 真实值干扰，统一清空相关变量
const AI_ENV_KEYS = ['ARK_API_KEY', 'ARK_BASE_URL', 'ARK_MODEL', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL'] as const

function clearAiEnv() {
  for (const k of AI_ENV_KEYS) delete process.env[k]
}

function setEnv(values: Partial<Record<typeof AI_ENV_KEYS[number], string>>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

describe('buildAiConfig', () => {
  beforeEach(() => clearAiEnv())
  // 测完还原，避免影响其他测试文件读取 config
  afterEach(() => clearAiEnv())

  it('should use full AI_* trio when all three are configured', () => {
    setEnv({
      AI_API_KEY: 'official-key',
      AI_BASE_URL: 'https://api.deepseek.com/v1',
      AI_MODEL: 'deepseek-v4-flash',
    })
    const c = buildAiConfig()
    expect(c).toEqual({
      apiKey: 'official-key',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
    })
  })

  it('should fill DeepSeek official defaults when only AI_API_KEY is set', () => {
    // 只配 key：baseUrl/model 应回落官方默认（避免拼出非法组合）
    setEnv({ AI_API_KEY: 'official-key' })
    const c = buildAiConfig()
    expect(c.apiKey).toBe('official-key')
    expect(c.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(c.model).toBe('deepseek-chat')
  })

  it('should start cleanly (empty key + official defaults) when nothing is configured', () => {
    clearAiEnv()
    const c = buildAiConfig()
    expect(c.apiKey).toBe('')
    expect(c.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(c.model).toBe('deepseek-chat')
  })

  it('should treat whitespace-only AI_API_KEY as empty', () => {
    // 边界：纯空格 key 应被 trim 后视为未配置，避免发出带空 key 的真实请求
    setEnv({ AI_API_KEY: '   ', AI_MODEL: 'deepseek-chat' })
    const c = buildAiConfig()
    expect(c.apiKey).toBe('')
    expect(c.model).toBe('deepseek-chat')
  })

  it('should IGNORE ARK_* entirely (2026-09-10 决策：报备走火山材料、调用走官方)', () => {
    // 关键回归锁：即使误配了 ARK_*，运行时也绝不能切回火山方舟
    setEnv({
      ARK_API_KEY: 'ark-key',
      ARK_BASE_URL: 'https://ark.example.com/api/v3',
      ARK_MODEL: 'deepseek-v4-flash-ga-260731',
      AI_API_KEY: 'official-key',
      AI_BASE_URL: 'https://api.deepseek.com/v1',
      AI_MODEL: 'deepseek-v4-flash',
    })
    const c = buildAiConfig()
    expect(c.apiKey).toBe('official-key')
    expect(c.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(c.model).toBe('deepseek-v4-flash')
  })

  it('should keep official defaults even when ONLY ARK_* is set (no silent Ark fallback)', () => {
    // 只误配 ARK_*（无 AI_*）：key 为空（调用时抛"AI 服务未配置"），绝不回落火山默认
    setEnv({ ARK_API_KEY: 'ark-key' })
    const c = buildAiConfig()
    expect(c.apiKey).toBe('')
    expect(c.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(c.model).toBe('deepseek-chat')
  })
})
