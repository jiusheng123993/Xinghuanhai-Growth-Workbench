/**
 * E2E 测试：AI 聊天对话
 * 验证 AI 宠物管家的聊天对话功能
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import Taro from '@tarojs/taro'
import { chat, guardCheck, guardCheckOutput } from '../services/aiProvider'

const mockStorage: Record<string, string> = {}
vi.mock('../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = JSON.stringify(value)
  }),
  // aiProvider 依赖 storage 命名导出（utils/storage.ts 的 storage 对象）
  storage: {
    getToken: vi.fn(() => 'mock_token'),
    setToken: vi.fn(),
    removeToken: vi.fn(),
    getUser: vi.fn(() => null),
    setUser: vi.fn(),
    removeUser: vi.fn(),
    getRefreshToken: vi.fn(() => null),
    setRefreshToken: vi.fn(),
    removeRefreshToken: vi.fn(),
    clear: vi.fn(),
  },
}))

// 工厂内局部变量改名 requestStub：与解构出的外层 mockTaroRequest 同名会触发 no-shadow
const { mockTaroRequest } = vi.hoisted(() => {
  const requestStub = vi.fn()
  return { mockTaroRequest: requestStub }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn(() => 'mock_token'),
    request: mockTaroRequest,
  },
}))

vi.mock('../config', () => ({
  CONFIG: {
    API_BASE_URL: 'https://api.test.com',
    STORAGE_KEYS: { TOKEN: 'token' },
    USE_MOCK: false,
  },
}))

describe('Happy Path 4: AI对话交互 → 智能回复', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  describe('chat 函数', () => {
    it('发送聊天消息 → mock AI 回复，验证回复包含有用建议', async () => {
      mockTaroRequest.mockResolvedValue({
        statusCode: 200,
        data: { success: true, data: { content: '猫咪食欲不振可能是压力、口腔问题或消化系统不适引起的。建议先观察猫咪的精神状态，如果持续超过24小时或伴有呕吐腹泻，请及时就医。' } },
      })

      const reply = await chat({
        messages: [
          { role: 'system', content: '你是一个宠物助手' },
          { role: 'user', content: '我的猫咪今天不怎么吃东西怎么办' },
        ],
        temperature: 0.7,
      })

      expect(reply).toBeTruthy()
      expect(typeof reply).toBe('string')
      expect(reply.length).toBeGreaterThan(0)
      expect(reply).not.toBe('AI服务暂不可用，请稍后再试')
      expect(reply).not.toBe('网络异常，请检查网络连接后重试')
    })

    it('发送带宠物上下文的聊天消息 → 验证请求中包含宠物信息（名字、品种、年龄）', async () => {
      mockTaroRequest.mockResolvedValue({
        statusCode: 200,
        data: { success: true, data: { content: '小橘作为中华田园猫，4岁属于青壮年阶段。请关注它的饮食和运动情况。' } },
      })

      const reply = await chat({
        messages: [
          { role: 'system', content: '你是一个宠物助手' },
          { role: 'user', content: '我的猫咪小橘（中华田园猫，4岁）今天怎么样' },
        ],
        temperature: 0.7,
      })

      expect(reply).toBeTruthy()
      expect(mockTaroRequest).toHaveBeenCalledTimes(1)

      const callArgs = mockTaroRequest.mock.calls[0][0] as Record<string, unknown>
      expect(callArgs.url).toBe('https://api.test.com/api/ai/chat')
      expect(callArgs.method).toBe('POST')
      expect(callArgs.header).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock_token',
        })
      )

      const data = callArgs.data as { messages: Array<{ role: string; content: string }> }
      const userMessage = data.messages.find((m) => m.role === 'user')
      expect(userMessage).toBeDefined()
      expect(userMessage!.content).toContain('小橘')
      expect(userMessage!.content).toContain('中华田园猫')
      expect(userMessage!.content).toContain('4岁')
    })
  })

  describe('guardCheck 函数', () => {
    it('检测有害内容 → mock guardCheck 返回 isHarmful=true，验证被拦截', async () => {
      mockTaroRequest.mockResolvedValue({
        statusCode: 200,
        data: { isHarmful: true, score: 0.95, isCrisis: false },
      })

      const result = await guardCheck('如何伤害我的宠物')

      expect(result.isHarmful).toBe(true)
      expect(result.score).toBe(0.95)
      expect(result.isCrisis).toBe(false)
    })

    it('检测安全内容 → mock guardCheck 返回 isHarmful=false，验证通过', async () => {
      mockTaroRequest.mockResolvedValue({
        statusCode: 200,
        data: { isHarmful: false, score: 0.05, isCrisis: false },
      })

      const result = await guardCheck('我的猫咪今天食欲不太好')

      expect(result.isHarmful).toBe(false)
      expect(result.score).toBe(0.05)
      expect(result.isCrisis).toBe(false)
    })
  })

  describe('guardCheckOutput 函数', () => {
    it('检测输出中的不安全医疗建议 → 验证 isUnsafeMedicalAdvice 标记', async () => {
      mockTaroRequest.mockResolvedValue({
        statusCode: 200,
        data: { isUnsafeMedicalAdvice: true },
      })

      const result = await guardCheckOutput('建议给猫咪服用阿莫西林500mg')

      expect(result.isUnsafeMedicalAdvice).toBe(true)
    })

    it('检测安全的输出内容 → 验证 isUnsafeMedicalAdvice=false', async () => {
      mockTaroRequest.mockResolvedValue({
        statusCode: 200,
        data: { isUnsafeMedicalAdvice: false },
      })

      const result = await guardCheckOutput('建议多观察猫咪的状态，必要时咨询兽医')

      expect(result.isUnsafeMedicalAdvice).toBe(false)
    })
  })

  describe('错误处理', () => {
    it('网络异常 → mock Taro.request 失败，验证返回优雅的错误信息', async () => {
      mockTaroRequest.mockRejectedValue(new Error('Network timeout'))

      const reply = await chat({
        messages: [
          { role: 'user', content: '猫咪不吃东西怎么办' },
        ],
      })

      expect(reply).toBe('网络异常，请检查网络连接后重试')
    })

    it('非 200 状态码 → mock 500 状态码，验证返回优雅的错误信息', async () => {
      mockTaroRequest.mockResolvedValue({
        statusCode: 500,
        data: null,
      })

      const reply = await chat({
        messages: [
          { role: 'user', content: '猫咪不吃东西怎么办' },
        ],
      })

      expect(reply).toBe('AI服务暂不可用，请稍后再试')
    })
  })
})