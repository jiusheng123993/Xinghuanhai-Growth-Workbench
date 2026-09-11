/**
 * AI 取名服务测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { interpretName, recommendNames } from '../namingService'

const { mockChat, mockGuardCheck, mockRequireAuth, mockCheckInput, mockBuildInterpretPrompt, mockBuildRecommendPrompt } =
  vi.hoisted(() => ({
    mockChat: vi.fn(),
    mockGuardCheck: vi.fn(),
    mockRequireAuth: vi.fn(),
    mockCheckInput: vi.fn(),
    mockBuildInterpretPrompt: vi.fn(),
    mockBuildRecommendPrompt: vi.fn(),
  }))

vi.mock('../aiProvider', () => ({
  chat: mockChat,
  guardCheck: mockGuardCheck,
}))

vi.mock('../../utils/authGuard', () => ({
  requireAuth: mockRequireAuth,
}))

vi.mock('../../utils/ruleGuard', () => ({
  checkInput: mockCheckInput,
}))

vi.mock('../../utils/namingPrompts', () => ({
  buildInterpretPrompt: mockBuildInterpretPrompt,
  buildRecommendPrompt: mockBuildRecommendPrompt,
}))

const AI_REPLY = '根据生辰八字和五行分析，此名大吉，寓意福寿安康。'
const AI_RECOMMEND_REPLY = '推荐：福宝、旺财、来福、吉祥、如意、安康、富贵、金宝、玉如意、长寿。'

describe('namingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChat.mockResolvedValue(AI_REPLY)
    mockGuardCheck.mockResolvedValue({ isHarmful: false, score: 0, isCrisis: false })
    mockCheckInput.mockReturnValue({ blocked: false, action: 'pass' })
    mockBuildInterpretPrompt.mockReturnValue('built interpret prompt')
    mockBuildRecommendPrompt.mockReturnValue('built recommend prompt')
  })

  // ============================================================
  // interpretName
  // ============================================================
  describe('interpretName', () => {
    it('应该在处理前调用 requireAuth', async () => {
      await interpretName('青橘', '中华田园猫', '2024-03-15')

      expect(mockRequireAuth).toHaveBeenCalledOnce()
    })

    it('当 checkInput 返回 blocked 时应返回错误消息', async () => {
      mockCheckInput.mockReturnValue({ blocked: true, action: 'block' })

      const result = await interpretName('危险内容', '中华田园猫', '2024-03-15')

      expect(result).toBe('抱歉，检测到不安全的输入，请使用其他名字重试。')
      expect(mockChat).not.toHaveBeenCalled()
    })

    it('当 guardCheck 返回 isHarmful 时应返回错误消息', async () => {
      mockGuardCheck.mockResolvedValue({ isHarmful: true, score: 0.9, isCrisis: false })

      const result = await interpretName('青橘', '中华田园猫', '2024-03-15')

      expect(result).toBe('抱歉，检测到不安全的输入，请使用其他名字重试。')
      expect(mockChat).not.toHaveBeenCalled()
    })

    it('成功时应调用 chat 并传入正确的 system prompt', async () => {
      const result = await interpretName('青橘', '中华田园猫', '2024-03-15')

      expect(result).toBe(AI_REPLY)
      expect(mockChat).toHaveBeenCalledWith({
        messages: [
          { role: 'system', content: '你是一位精通中国传统文化的取名大师。' },
          { role: 'user', content: 'built interpret prompt' },
        ],
        temperature: 0.8,
        // 必须关闭思考模式（2026-09-10）：开思考时 reasoning 会吃满 max_tokens，
        // 服务端 content 返回空串 → 解读永远降级成本地套话
        thinking: 'disabled',
      })
    })

    it('成功时应调用 buildInterpretPrompt 并传入已净化的参数', async () => {
      await interpretName('青橘', '中华田园猫', '2024-03-15')

      expect(mockBuildInterpretPrompt).toHaveBeenCalledWith('青橘', '中华田园猫', '2024-03-15')
    })

    it('应净化输入中的 < 和 > 字符', async () => {
      await interpretName('<青橘>', '中华<田园猫>', '2024-03-15')

      expect(mockCheckInput).toHaveBeenCalledWith('青橘中华田园猫2024-03-15')
      expect(mockGuardCheck).toHaveBeenCalledWith('青橘中华田园猫')
      expect(mockBuildInterpretPrompt).toHaveBeenCalledWith('青橘', '中华田园猫', '2024-03-15')
    })

    it('应净化输入中的 \\n 和 \\r 字符', async () => {
      await interpretName('青\n橘\r', '中华\n田园猫', '2024-03-15')

      expect(mockCheckInput).toHaveBeenCalledWith('青橘中华田园猫2024-03-15')
      expect(mockGuardCheck).toHaveBeenCalledWith('青橘中华田园猫')
      expect(mockBuildInterpretPrompt).toHaveBeenCalledWith('青橘', '中华田园猫', '2024-03-15')
    })

    it('应将输入截断到50个字符', async () => {
      const longName = '青'.repeat(60)
      const longBreed = '中'.repeat(60)
      const longDate = '2024-03-15'

      await interpretName(longName, longBreed, longDate)

      const truncatedName = '青'.repeat(50)
      const truncatedBreed = '中'.repeat(50)
      expect(mockBuildInterpretPrompt).toHaveBeenCalledWith(truncatedName, truncatedBreed, longDate)
    })

    it('当 chat 失败时应向上抛出错误', async () => {
      const error = new Error('AI 服务不可用')
      mockChat.mockRejectedValue(error)

      await expect(interpretName('青橘', '中华田园猫', '2024-03-15')).rejects.toThrow('AI 服务不可用')
    })
  })

  // ============================================================
  // recommendNames
  // ============================================================
  describe('recommendNames', () => {
    beforeEach(() => {
      mockChat.mockResolvedValue(AI_RECOMMEND_REPLY)
    })

    it('应该在处理前调用 requireAuth', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-03-15', gender: '公' })

      expect(mockRequireAuth).toHaveBeenCalledOnce()
    })

    it('当 checkInput 返回 blocked 时应返回错误消息', async () => {
      mockCheckInput.mockReturnValue({ blocked: true, action: 'block' })

      const result = await recommendNames({ breed: '中华田园猫', birthDate: '2024-03-15', gender: '公' })

      expect(result).toBe('抱歉，检测到不安全的输入，请使用其他内容重试。')
      expect(mockChat).not.toHaveBeenCalled()
    })

    it('成功时应调用 chat 并传入正确的 system prompt', async () => {
      const result = await recommendNames({ breed: '中华田园猫', birthDate: '2024-03-15', gender: '公' })

      expect(result).toBe(AI_RECOMMEND_REPLY)
      expect(mockChat).toHaveBeenCalledWith({
        messages: [
          { role: 'system', content: '你是一位精通中国文化的宠物取名大师。请严格按JSON格式返回结果。' },
          { role: 'user', content: 'built recommend prompt' },
        ],
        temperature: 0.9,
        max_tokens: 2048,
        // 必须关闭思考模式（2026-09-10）：实测开思考时 2048 tokens 全被 reasoning 吃掉、
        // content 长度 0，"AI 推荐"实际全部走本地名字库
        thinking: 'disabled',
      })
    })

    it('成功时应调用 buildRecommendPrompt 并传入已净化的参数和季节', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-03-15', gender: '公' })

      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith({
        breed: '中华田园猫',
        birthDate: '2024-03-15',
        gender: '公',
        season: '春',
        style: undefined,
        photoUrl: undefined,
        description: undefined,
      })
    })

    it('应净化输入中的 < 和 > 字符', async () => {
      await recommendNames({ breed: '<中华田园猫>', birthDate: '2024-03-15', gender: '<公>' })

      expect(mockCheckInput).toHaveBeenCalledWith('中华田园猫公')
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith({
        breed: '中华田园猫',
        birthDate: '2024-03-15',
        gender: '公',
        season: '春',
        style: undefined,
        photoUrl: undefined,
        description: undefined,
      })
    })

    it('应净化输入中的 \\n 和 \\r 字符', async () => {
      await recommendNames({ breed: '中华\r\n田园猫', birthDate: '2024-03-15', gender: '公' })

      expect(mockCheckInput).toHaveBeenCalledWith('中华田园猫公')
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith({
        breed: '中华田园猫',
        birthDate: '2024-03-15',
        gender: '公',
        season: '春',
        style: undefined,
        photoUrl: undefined,
        description: undefined,
      })
    })

    it('应将输入截断到50个字符', async () => {
      const longBreed = '中'.repeat(60)
      const longGender = '公'.repeat(60)

      await recommendNames({ breed: longBreed, birthDate: '2024-03-15', gender: longGender })

      const truncatedBreed = '中'.repeat(50)
      const truncatedGender = '公'.repeat(50)
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith({
        breed: truncatedBreed,
        birthDate: '2024-03-15',
        gender: truncatedGender,
        season: '春',
        style: undefined,
        photoUrl: undefined,
        description: undefined,
      })
    })

    it('当 chat 失败时应向上抛出错误', async () => {
      const error = new Error('AI 服务不可用')
      mockChat.mockRejectedValue(error)

      await expect(recommendNames({ breed: '中华田园猫', birthDate: '2024-03-15', gender: '公' })).rejects.toThrow('AI 服务不可用')
    })
  })

  // ============================================================
  // getBirthSeason（通过 recommendNames 间接测试）
  // ============================================================
  describe('getBirthSeason（通过 recommendNames 间接验证）', () => {
    it('3月应返回"春"', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-03-01', gender: '公' })
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith(expect.objectContaining({ season: '春' }))
    })

    it('5月应返回"春"', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-05-31', gender: '公' })
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith(expect.objectContaining({ season: '春' }))
    })

    it('6月应返回"夏"', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-06-15', gender: '公' })
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith(expect.objectContaining({ season: '夏' }))
    })

    it('8月应返回"夏"', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-08-01', gender: '公' })
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith(expect.objectContaining({ season: '夏' }))
    })

    it('9月应返回"秋"', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-09-15', gender: '公' })
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith(expect.objectContaining({ season: '秋' }))
    })

    it('11月应返回"秋"', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-11-30', gender: '公' })
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith(expect.objectContaining({ season: '秋' }))
    })

    it('12月应返回"冬"', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-12-25', gender: '公' })
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith(expect.objectContaining({ season: '冬' }))
    })

    it('1月应返回"冬"', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-01-01', gender: '公' })
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith(expect.objectContaining({ season: '冬' }))
    })

    it('2月应返回"冬"', async () => {
      await recommendNames({ breed: '中华田园猫', birthDate: '2024-02-28', gender: '公' })
      expect(mockBuildRecommendPrompt).toHaveBeenCalledWith(expect.objectContaining({ season: '冬' }))
    })
  })
})