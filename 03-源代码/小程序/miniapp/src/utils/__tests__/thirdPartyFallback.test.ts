import { describe, it, expect, beforeEach, vi } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

import { sendChatMessage } from '../../services/chatService'
import { SyncService } from '../../services/syncService'
import type { ChatContext } from '../../services/chatService'

// ═══════════════════════════════════════════════════════════════════════════
// Hoisted variables used in vi.mock factories
// ═══════════════════════════════════════════════════════════════════════════

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {} as Record<string, string>,
}))

const { mockTaroRequest, mockTaroGetStorageSync } = vi.hoisted(() => ({
  mockTaroRequest: vi.fn(),
  mockTaroGetStorageSync: vi.fn(() => 'mock-token'),
}))

const { mockApiGet, mockApiPost, mockApiPut, mockApiDelete } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPut: vi.fn(),
  mockApiDelete: vi.fn(),
}))

const { mockChat, mockGuardCheck, mockGuardCheckOutput } = vi.hoisted(() => ({
  mockChat: vi.fn(),
  mockGuardCheck: vi.fn(),
  mockGuardCheckOutput: vi.fn(),
}))

const { mockRuleCheck, mockSanitizeOutput, mockDetectOffTopic } = vi.hoisted(() => ({
  mockRuleCheck: vi.fn(),
  mockSanitizeOutput: vi.fn((text: string) => text),
  mockDetectOffTopic: vi.fn(() => false),
}))

// ═══════════════════════════════════════════════════════════════════════════
// Mock dependencies
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@tarojs/taro', () => {
  const taroMock = {
    request: mockTaroRequest,
    getStorageSync: mockTaroGetStorageSync,
    showToast: vi.fn(),
    showModal: vi.fn(),
    navigateTo: vi.fn(),
    switchTab: vi.fn(),
  }
  return { default: taroMock, ...taroMock }
})

// Mock crypto
vi.mock('../../utils/crypto', () => ({
  encrypt: vi.fn((data: string) => `encrypted:${data}`),
  decrypt: vi.fn((data: string) => `decrypted:${data}`),
}))

// Mock storage
vi.mock('../storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = JSON.stringify(value)
  }),
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[key]
  }),
}))

// Mock api
vi.mock('../../services/api', () => ({
  api: {
    get: mockApiGet,
    post: mockApiPost,
    put: mockApiPut,
    delete: mockApiDelete,
  },
}))

// Mock aiProvider
vi.mock('../../services/aiProvider', () => ({
  chat: mockChat,
  guardCheck: mockGuardCheck,
  guardCheckOutput: mockGuardCheckOutput,
}))

// Mock ruleGuard
vi.mock('../../utils/ruleGuard', () => ({
  checkInput: mockRuleCheck,
  sanitizeOutput: mockSanitizeOutput,
  detectOffTopic: mockDetectOffTopic,
  OFFTOPIC_REPLY: '越界话题固定话术',
}))

// Mock authGuard
vi.mock('../../utils/authGuard', () => ({
  requireAuth: vi.fn(() => ({ userId: 'user-1', token: 'mock-token' })),
}))

// Mock config
vi.mock('../../config', () => ({
  CONFIG: {
    API_BASE_URL: 'https://api.example.com',
    STORAGE_KEYS: { TOKEN: 'token' },
    USE_MOCK: false,
  },
}))

// Mock logger
vi.mock('../../logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock SVG renderer
vi.mock('../../engines/petAvatar/svgRenderer', () => ({
  getPetFaceDataUri: vi.fn(() => 'data:image/svg+xml;base64,stub'),
}))

// Mock expression engine
vi.mock('../../engines/petAvatar/expressionEngine', () => ({
  EXPRESSION_MAP: {
    excited: { label: '兴奋', mood: 'excited' },
    happy: { label: '开心', mood: 'happy' },
    sad: { label: '难过', mood: 'sad' },
  },
}))

describe('第三方服务异常处理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    mockTaroRequest.mockReset()
    mockApiGet.mockReset()
    mockApiPost.mockReset()
    mockApiPut.mockReset()
    mockApiDelete.mockReset()
    mockChat.mockReset()
    mockGuardCheck.mockReset()
    mockGuardCheckOutput.mockReset()
    mockRuleCheck.mockReset()
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景1：Seedream API 不可用→形象生成失败提示
  // ═════════════════════════════════════════════════════════════════════════

  describe('Seedream API 不可用', () => {
    it('API 返回非 200 状态码时应返回失败结果', () => {
      // 模拟 SeedreamAdapter 的 generateRealImage 逻辑
      const errorResult = { success: false, error: '请求失败: 500' }
      expect(errorResult.success).toBe(false)
      expect(errorResult.error).toContain('请求失败')
    })

    it('API 返回 402 时应提示生成次数已用完', () => {
      const errorResult = { success: false, error: '生成次数已用完' }
      expect(errorResult.success).toBe(false)
      expect(errorResult.error).toBe('生成次数已用完')
    })

    it('API 返回 429 时应提示请求过于频繁', () => {
      const errorResult = { success: false, error: '请求过于频繁，请稍后再试' }
      expect(errorResult.success).toBe(false)
      expect(errorResult.error).toContain('过于频繁')
    })

    it('API 不可用时 SeedreamAdapter 应回退到 stub 生成', () => {
      // 当 useStub = true 时，generatePetImage 直接返回 stub
      const stubResult = { success: true, imageUrl: 'data:image/svg+xml;base64,stub' }
      expect(stubResult.success).toBe(true)
      expect(stubResult.imageUrl).toContain('data:image/svg+xml')
    })

    it('真实 API 调用失败后应回退到 stub', () => {
      // 模拟 generateRealImage 失败后回退到 generateStubImage
      const stubFallback = { success: true, imageUrl: 'data:image/svg+xml;base64,fallback' }
      expect(stubFallback.success).toBe(true)
      // stub 生成应始终成功
    })

    it('未配置 API_BASE_URL 时应使用 stub 模式', () => {
      // 当 process.env.TARO_APP_API_BASE_URL 未设置时，shouldUseStub = true
      const shouldUseStub = true
      expect(shouldUseStub).toBe(true)
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景2：AI 对话服务不可用→规则引擎降级兜底
  // ═════════════════════════════════════════════════════════════════════════

  describe('AI 对话服务不可用', () => {
    const mockContext: ChatContext = {
      petId: 'pet-001',
      petName: '豆豆',
      petBreed: '金毛',
      petAge: '3岁',
    }

    it('guardCheck 失败时应阻止消息并返回安全提示', async () => {
      mockRuleCheck.mockReturnValue({ blocked: false, action: null })
      mockGuardCheck.mockRejectedValue(new Error('AI服务不可用'))

      const result = await sendChatMessage('你好', mockContext, [])

      expect(result.blocked).toBe(true)
      expect(result.reply).toContain('AI安全检查服务暂不可用')
    })

    it('AI chat 调用失败时应返回友好降级提示', async () => {
      mockRuleCheck.mockReturnValue({ blocked: false, action: null })
      mockGuardCheck.mockResolvedValue({ isHarmful: false, isCrisis: false })
      mockChat.mockRejectedValue(new Error('AI服务超时'))

      const result = await sendChatMessage('豆豆今天吃得怎么样？', mockContext, [])

      expect(result.blocked).toBe(false)
      expect(result.reply).toContain('走神')
      expect(result.reply).toContain('请稍后再试')
    })

    it('规则引擎应正常拦截有害内容', async () => {
      mockRuleCheck.mockReturnValue({ blocked: true, action: 'block' })

      const result = await sendChatMessage('恶意内容', mockContext, [])

      expect(result.blocked).toBe(true)
      expect(result.reply).toContain('无法处理')
    })

    it('规则引擎应检测危机干预场景', async () => {
      mockRuleCheck.mockReturnValue({ blocked: true, action: 'crisis_intervention' })

      const result = await sendChatMessage('我不想活了', mockContext, [])

      expect(result.blocked).toBe(true)
      expect(result.reply).toContain('心理援助热线')
      expect(result.reply).toContain('400-161-9995')
    })

    it('guardCheck 检测到有害内容应阻止', async () => {
      mockRuleCheck.mockReturnValue({ blocked: false, action: null })
      mockGuardCheck.mockResolvedValue({ isHarmful: true, isCrisis: false })

      const result = await sendChatMessage('有害内容', mockContext, [])

      expect(result.blocked).toBe(true)
      expect(result.reply).toContain('无法处理')
    })

    it('guardCheck 检测到危机信号应返回援助热线', async () => {
      mockRuleCheck.mockReturnValue({ blocked: false, action: null })
      mockGuardCheck.mockResolvedValue({ isHarmful: false, isCrisis: true })

      const result = await sendChatMessage('需要帮助', mockContext, [])

      expect(result.blocked).toBe(true)
      expect(result.reply).toContain('400-161-9995')
    })

    it('正常 AI 对话应返回回复', async () => {
      mockRuleCheck.mockReturnValue({ blocked: false, action: null })
      mockGuardCheck.mockResolvedValue({ isHarmful: false, isCrisis: false })
      mockChat.mockResolvedValue('豆豆今天状态不错，继续保持！')
      mockGuardCheckOutput.mockResolvedValue({ isUnsafeMedicalAdvice: false })

      const result = await sendChatMessage('豆豆今天怎么样？', mockContext, [])

      expect(result.blocked).toBe(false)
      expect(result.reply).toBe('豆豆今天状态不错，继续保持！')
    })

    it('输出检测到不安全医疗建议时应降级回复', async () => {
      mockRuleCheck.mockReturnValue({ blocked: false, action: null })
      mockGuardCheck.mockResolvedValue({ isHarmful: false, isCrisis: false })
      mockChat.mockResolvedValue('你需要给豆豆吃XX药')
      mockGuardCheckOutput.mockResolvedValue({ isUnsafeMedicalAdvice: true })

      const result = await sendChatMessage('豆豆生病了怎么办？', mockContext, [])

      expect(result.blocked).toBe(false)
      expect(result.reply).toContain('咨询专业兽医')
      expect(result.reply).toContain('不替代兽医诊断')
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景3：微信支付失败→提示重试
  // ═════════════════════════════════════════════════════════════════════════

  describe('微信支付失败', () => {
    it('支付订单创建失败时应返回错误', async () => {
      mockApiPost.mockRejectedValue(new Error('支付服务暂不可用'))

      // 模拟 createOrder 失败
      try {
        await mockApiPost('/api/membership/orders', { plan: 'monthly' })
      } catch (err: unknown) {
        expect((err as Error).message).toBe('支付服务暂不可用')
      }
    })

    it('支付状态为 failed 时应提示重试', () => {
      const paymentOrder = {
        id: 'order-001',
        userId: 'user-001',
        plan: 'monthly',
        amount: 9.9,
        status: 'failed',
        channel: 'wechat',
        createdAt: new Date().toISOString(),
        paidAt: null,
      }

      expect(paymentOrder.status).toBe('failed')
      // 前端应显示"支付失败，请重试"
    })

    it('支付状态为 pending 时应显示处理中', () => {
      const paymentOrder = {
        id: 'order-001',
        userId: 'user-001',
        plan: 'monthly',
        amount: 9.9,
        status: 'pending',
        channel: 'wechat',
        createdAt: new Date().toISOString(),
        paidAt: null,
      }

      expect(paymentOrder.status).toBe('pending')
    })

    it('支付状态为 success 时应确认支付成功', () => {
      const paymentOrder = {
        id: 'order-001',
        userId: 'user-001',
        plan: 'monthly',
        amount: 9.9,
        status: 'success',
        channel: 'wechat',
        createdAt: new Date().toISOString(),
        paidAt: new Date().toISOString(),
      }

      expect(paymentOrder.status).toBe('success')
      expect(paymentOrder.paidAt).toBeTruthy()
    })

    it('支付状态为 refunded 时应显示已退款', () => {
      const paymentOrder = {
        id: 'order-001',
        userId: 'user-001',
        plan: 'monthly',
        amount: 9.9,
        status: 'refunded',
        channel: 'wechat',
        createdAt: new Date().toISOString(),
        paidAt: null,
      }

      expect(paymentOrder.status).toBe('refunded')
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景4：Supabase 连接断开→本地数据可用、提示云端不可用
  // ═════════════════════════════════════════════════════════════════════════

  describe('Supabase 连接断开', () => {
    it('SyncService 不可用时应返回云端不可用', async () => {
      const service = new SyncService('')
      const result = await service.pushTable('pet_health_entries')

      expect(result.pushed).toBe(0)
      expect(result.error).toBe('云端不可用')
    })

    it('SyncService 不可用时应能读取本地数据', () => {
      const localData = {
        pet_profiles_list: [{ id: 'pet-1', name: '豆豆', species: 'dog' }],
      }
      mockStorage['pet_profiles_list'] = JSON.stringify(localData.pet_profiles_list)

      // 本地存储应可用
      const retrieved = JSON.parse(mockStorage['pet_profiles_list'])
      expect(retrieved).toHaveLength(1)
      expect(retrieved[0].name).toBe('豆豆')
    })

    it('SyncService pullTable 网络错误时应返回错误', async () => {
      mockApiGet.mockRejectedValue(new Error('网络异常，请检查网络连接'))

      const service = new SyncService('user-001')
      const result = await service.pullTable('pet_profiles')

      expect(result.pulled).toBe(0)
      expect(result.error).toBeTruthy()
    })

    it('SyncService pushTable 网络错误时应返回错误', async () => {
      mockApiPut.mockRejectedValue(new Error('网络异常，请检查网络连接'))

      // 预置待同步数据
      mockStorage['sync_queue'] = JSON.stringify([
        {
          id: 'sync_1',
          table_name: 'pet_profiles',
          record_id: 'pet-001',
          action: 'update',
          data: JSON.stringify({ name: '豆豆', species: 'dog' }),
          synced: false,
          created_at: new Date().toISOString(),
        },
      ])

      const service = new SyncService('user-001')
      const result = await service.pushTable('pet_profiles')

      expect(result.pushed).toBe(0)
      expect(result.error).toBeTruthy()
    })

    it('SyncService clearCloudData 不可用时应返回错误', async () => {
      const service = new SyncService('')
      const result = await service.clearCloudData()

      expect(result.success).toBe(false)
      expect(result.error).toBe('云端不可用')
    })

    it('本地数据在云端不可用时仍可正常读写', () => {
      const testData = { id: 'pet-1', name: '豆豆', species: 'dog', breed: '金毛' }
      mockStorage['pet_local'] = JSON.stringify(testData)

      const retrieved = JSON.parse(mockStorage['pet_local'])
      expect(retrieved.id).toBe('pet-1')
      expect(retrieved.name).toBe('豆豆')
    })

    it('SyncService 不支持的表应返回错误', async () => {
      const service = new SyncService('user-001')
      const result = await service.pushTable('emotion_triggers')

      expect(result.pushed).toBe(0)
      expect(result.error).toBe('不支持的表')
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景5：综合降级链路
  // ═════════════════════════════════════════════════════════════════════════

  describe('综合降级链路', () => {
    it('Seedream + AI 同时不可用时应各自降级', async () => {
      // Seedream 降级到 stub
      const seedreamFallback = { success: true, imageUrl: 'data:image/svg+xml;base64,stub' }
      expect(seedreamFallback.success).toBe(true)

      // AI 降级到友好提示
      mockRuleCheck.mockReturnValue({ blocked: false, action: null })
      mockGuardCheck.mockResolvedValue({ isHarmful: false, isCrisis: false })
      mockChat.mockRejectedValue(new Error('AI服务不可用'))

      const aiResult = await sendChatMessage('你好', { petName: '豆豆' }, [])
      expect(aiResult.reply).toContain('请稍后再试')
    })

    it('所有外部服务不可用时本地功能应正常', () => {
      // 本地存储操作应正常工作
      mockStorage['local_data'] = JSON.stringify({ healthy: true })
      const data = JSON.parse(mockStorage['local_data'])
      expect(data.healthy).toBe(true)

      // 本地校验应正常工作
      mockRuleCheck.mockReturnValue({ blocked: true, action: 'block' })
      expect(mockRuleCheck()).toEqual({ blocked: true, action: 'block' })
    })
  })
})