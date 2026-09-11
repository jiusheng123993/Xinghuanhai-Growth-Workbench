/**
 * AI 服务客户端（aiProvider）契约单元测试（2026-09-10 补齐）
 *
 * 背景：aiProvider 是取名/聊天所有 AI 请求的唯一出口，此前无任何契约测试，
 * 两个线上问题因此长期隐身：
 *  ① `/api/ai/guard` 返回 `{success,data}` 而前端按平铺读 → isHarmful 恒为 undefined，
 *     namingService/chatService 的输入安全拦截**永不触发**；
 *  ② 取名链路无法关闭思考模式（thinking 未透传）→ max_tokens 被 reasoning 吃空、
 *     content 为空 → 用户拿到的"AI 推荐"实际全是本地名字库。
 * 这里同时锁住"失败不抛错、返回固定文案"这一既有语义（上层大量 catch 降级依赖它）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))

vi.mock('@tarojs/taro', () => ({
  default: { request: (...args: unknown[]) => mockRequest(...args) },
}))
vi.mock('../../utils/storage', () => ({
  storage: { getToken: () => 'test-token' },
}))

/* eslint-disable import/first -- 被测模块必须在 vi.mock 工厂之后 import，
   否则 Taro/storage 的模块级 mock 时序不生效 */
import { chat, guardCheck, guardCheckOutput } from '../aiProvider'

describe('aiProvider', () => {
  beforeEach(() => {
    mockRequest.mockReset()
  })

  describe('chat', () => {
    it('should return content when server responds with success payload', async () => {
      mockRequest.mockResolvedValue({ statusCode: 200, data: { success: true, data: { content: '你好呀' } } })
      await expect(chat({ messages: [{ role: 'user', content: 'hi' }] })).resolves.toBe('你好呀')
    })

    it('should pass thinking flag through to the server when caller disables it', async () => {
      mockRequest.mockResolvedValue({ statusCode: 200, data: { success: true, data: { content: 'ok' } } })
      await chat({ messages: [{ role: 'user', content: '取名' }], thinking: 'disabled' })
      const body = mockRequest.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(body.data.thinking).toBe('disabled')
    })

    it('should return fallback text (not throw) when content is empty', async () => {
      // 思考模式吃空 max_tokens 时服务端返回 success:true + 空 content：
      // 必须落到固定文案，让上层走本地降级而不是把空串当结果渲染
      mockRequest.mockResolvedValue({ statusCode: 200, data: { success: true, data: { content: '' } } })
      await expect(chat({ messages: [{ role: 'user', content: 'hi' }] })).resolves.toBe('AI服务暂不可用，请稍后再试')
    })

    it('should return network fallback text when request rejects', async () => {
      mockRequest.mockRejectedValue(new Error('timeout'))
      await expect(chat({ messages: [{ role: 'user', content: 'hi' }] })).resolves.toBe('网络异常，请检查网络连接后重试')
    })
  })

  describe('guardCheck', () => {
    it('should unwrap {success,data} payload and expose isHarmful', async () => {
      // 契约回归锁：服务端 routes/ai.ts 返回 {success:true,data:{isHarmful,score,isCrisis}}
      mockRequest.mockResolvedValue({
        statusCode: 200,
        data: { success: true, data: { isHarmful: true, score: 8, isCrisis: false } },
      })
      await expect(guardCheck('如何伤害它')).resolves.toEqual({ isHarmful: true, score: 8, isCrisis: false })
    })

    it('should also accept a flat payload (backward compatible)', async () => {
      mockRequest.mockResolvedValue({
        statusCode: 200,
        data: { isHarmful: false, score: 1, isCrisis: true },
      })
      await expect(guardCheck('它走了我很想它')).resolves.toEqual({ isHarmful: false, score: 1, isCrisis: true })
    })

    it('should coerce dirty values and default to safe when fields are missing', async () => {
      mockRequest.mockResolvedValue({ statusCode: 200, data: { success: true, data: { score: 'oops' } } })
      await expect(guardCheck('x')).resolves.toEqual({ isHarmful: false, score: 0, isCrisis: false })
    })

    it('should default to safe when request fails', async () => {
      mockRequest.mockRejectedValue(new Error('network'))
      await expect(guardCheck('x')).resolves.toEqual({ isHarmful: false, score: 0, isCrisis: false })
      mockRequest.mockResolvedValue({ statusCode: 500, data: {} })
      await expect(guardCheck('x')).resolves.toEqual({ isHarmful: false, score: 0, isCrisis: false })
    })
  })

  describe('guardCheckOutput', () => {
    it('should read flat payload from /guard/output', async () => {
      mockRequest.mockResolvedValue({ statusCode: 200, data: { isUnsafeMedicalAdvice: true } })
      await expect(guardCheckOutput('回复')).resolves.toEqual({ isUnsafeMedicalAdvice: true })
    })

    it('should also accept wrapped payload', async () => {
      mockRequest.mockResolvedValue({ statusCode: 200, data: { success: true, data: { isUnsafeMedicalAdvice: true } } })
      await expect(guardCheckOutput('回复')).resolves.toEqual({ isUnsafeMedicalAdvice: true })
    })

    it('should default to safe (false) on failure', async () => {
      mockRequest.mockRejectedValue(new Error('network'))
      await expect(guardCheckOutput('回复')).resolves.toEqual({ isUnsafeMedicalAdvice: false })
    })
  })
})
