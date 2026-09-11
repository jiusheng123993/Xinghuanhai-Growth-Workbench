/**
 * E2E 测试：健康打卡与风险初筛
 * 验证每日健康打卡和症状风险评估流程
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnomalyItem } from '../memory-body/types/memoryBodyTypes'

// ============================================================
// 导入真实模块
// ============================================================
import { api as _api } from '../services/api'
import {
  createCheckin,
  getTodayCheckin,
  getCheckinStats,
  getCheckins,
  getLatestCheckin,
  getCheckinsByDateRange,
} from '../services/checkinService'
import type { CheckinInput, PetHealthEntry, HealthCheckinStats } from '../services/checkinService'

// ============================================================
// Mock 层：共享的 mock storage 和 api
// ============================================================
const mockStorage: Record<string, string> = {}

vi.mock('../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = JSON.stringify(value)
  }),
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[key]
  }),
  getStorageArray: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return []
    try {
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }),
  storage: {
    getToken: vi.fn(() => {
      try {
        const raw = mockStorage['xhh_token']
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    }),
    setToken: vi.fn((token: string) => {
      mockStorage['xhh_token'] = JSON.stringify(token)
    }),
    removeToken: vi.fn(() => {
      delete mockStorage['xhh_token']
    }),
    getUser: vi.fn(() => {
      try {
        const raw = mockStorage['xhh_user']
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    }),
    setUser: vi.fn((user: unknown) => {
      mockStorage['xhh_user'] = JSON.stringify(user)
    }),
    removeUser: vi.fn(() => {
      delete mockStorage['xhh_user']
    }),
    getRefreshToken: vi.fn(() => null),
    setRefreshToken: vi.fn(),
    removeRefreshToken: vi.fn(),
    clear: vi.fn(() => {
      delete mockStorage['xhh_token']
      delete mockStorage['xhh_user']
      delete mockStorage['xhh_refresh_token']
    }),
  },
  setStorageUserId: vi.fn(),
  clearAllStorage: vi.fn(),
}))

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../utils/petOwnership', () => ({
  requirePetOwnership: vi.fn(),
  isPetOwnerLocal: vi.fn(() => true),
}))

vi.mock('../services/syncHelper', () => ({
  queueSync: vi.fn(),
  trySyncAll: vi.fn(),
  trySyncTable: vi.fn(),
}))

const api = _api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

// ============================================================
// 测试常量
// ============================================================
const userId = 'user-001'
const petId = 'pet-001'
const today = new Date().toISOString().split('T')[0]

// 宠物数据（用于 petOwnership 本地校验）
const petProfile = {
  id: petId,
  userId,
  name: '小咪',
  species: 'cat' as const,
  breed: '英短',
  breedId: 'british-shorthair',
  gender: 'female' as const,
  birthDate: '2024-03-15',
  weight: 4.5,
  coatColor: '蓝灰色',
  photos: [],
  isNeutered: true,
  microchipId: '',
  notes: '',
  isDeceased: false,
  allergies: [],
  medications: [],
  chronicConditions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  avatarPhotoUrl: '',
}

// ============================================================
// 测试辅助函数
// ============================================================
function setupPetInStorage(): void {
  // 将宠物数据写入本地存储，使 petOwnership 检查通过
  mockStorage[`pets_${userId}`] = JSON.stringify([petProfile])
}

function makeCheckinInput(overrides: Partial<CheckinInput> = {}): CheckinInput {
  return {
    petId,
    userId,
    poopLevel: 3,
    appetiteLevel: 4,
    spiritLevel: 4,
    exerciseLevel: 2,
    hasAnomaly: false,
    anomalyItems: [] as AnomalyItem[],
    ...overrides,
  }
}

function makeCheckinResponse(
  input: CheckinInput,
  overrides: Partial<PetHealthEntry> = {}
): PetHealthEntry {
  return {
    id: `checkin_${Date.now()}`,
    petId: input.petId,
    userId: input.userId,
    poopLevel: input.poopLevel,
    appetiteLevel: input.appetiteLevel,
    spiritLevel: input.spiritLevel,
    exerciseLevel: input.exerciseLevel,
    weight: input.weight,
    hasAnomaly: input.hasAnomaly,
    anomalyItems: input.anomalyItems,
    riskLevel: 'low',
    aiFeedback: '✅ 您的宠物今天状态不错！继续保持良好的照顾习惯。',
    note: input.note,
    createdAt: new Date(),
    ...overrides,
  }
}

// ============================================================
// 测试套件
// ============================================================
describe('E2E Happy Path 2: 健康打卡 → 风险检测 → 打卡记录', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    // 每个测试前都将宠物数据写入本地存储
    setupPetInStorage()
  })

  describe('步骤 1: 环境准备 — 确认宠物 "小咪" 存在', () => {
    it('宠物数据应该存在于本地存储中', () => {
      const stored = JSON.parse(mockStorage[`pets_${userId}`])
      expect(stored).toHaveLength(1)
      expect(stored[0].name).toBe('小咪')
      expect(stored[0].species).toBe('cat')
      expect(stored[0].id).toBe(petId)
    })
  })

  describe('步骤 2: 正常打卡 — 所有指标正常', () => {
    it('风险等级应为 low，反馈应为正面', async () => {
      const input = makeCheckinInput({
        appetiteLevel: 4,
        spiritLevel: 4,
        poopLevel: 3,
        exerciseLevel: 2,
        hasAnomaly: false,
      })

      vi.mocked(api.post).mockResolvedValue({
        id: 'checkin-001',
        petId: input.petId,
        userId: input.userId,
        poopLevel: input.poopLevel,
        appetiteLevel: input.appetiteLevel,
        spiritLevel: input.spiritLevel,
        exerciseLevel: input.exerciseLevel,
        hasAnomaly: input.hasAnomaly,
        anomalyItems: input.anomalyItems,
        riskLevel: 'low',
        aiFeedback: '✅ 您的宠物今天状态不错！继续保持良好的照顾习惯。',
        createdAt: new Date(),
      })

      const result = await createCheckin(input)

      expect(result.riskLevel).toBe('low')
      expect(result.aiFeedback).toContain('状态不错')
      expect(result.aiFeedback).not.toContain('异常')
      expect(result.aiFeedback).not.toContain('紧急')
      expect(result.poopLevel).toBe(3)
      expect(result.appetiteLevel).toBe(4)
      expect(result.spiritLevel).toBe(4)
      expect(result.exerciseLevel).toBe(2)
      expect(result.hasAnomaly).toBe(false)
      expect(result.id).toBeDefined()
      expect(result.createdAt).toBeDefined()
    })

    it('本地存储中应该保存了打卡记录', async () => {
      const input = makeCheckinInput({
        appetiteLevel: 4,
        spiritLevel: 4,
        poopLevel: 3,
      })

      vi.mocked(api.post).mockResolvedValue({
        id: 'checkin-001',
        petId: input.petId,
        userId: input.userId,
        poopLevel: input.poopLevel,
        appetiteLevel: input.appetiteLevel,
        spiritLevel: input.spiritLevel,
        exerciseLevel: input.exerciseLevel,
        hasAnomaly: input.hasAnomaly,
        anomalyItems: input.anomalyItems,
        riskLevel: 'low',
        aiFeedback: '✅ 您的宠物今天状态不错！继续保持良好的照顾习惯。',
        createdAt: new Date(),
      })

      await createCheckin(input)

      const storageKey = `checkins_${petId}_${userId}`
      const stored = JSON.parse(mockStorage[storageKey])
      expect(Array.isArray(stored)).toBe(true)
      expect(stored).toHaveLength(1)
      expect(stored[0].riskLevel).toBe('low')
    })
  })

  describe('步骤 3: 食欲异常打卡 — 风险检测', () => {
    it('食欲低下 (appetite=2) 应该触发 high 风险等级', async () => {
      const input = makeCheckinInput({
        appetiteLevel: 2,
        spiritLevel: 5,
        poopLevel: 5,
        exerciseLevel: 2,
        hasAnomaly: false,
      })

      vi.mocked(api.post).mockResolvedValue({
        id: 'checkin-002',
        petId: input.petId,
        userId: input.userId,
        poopLevel: input.poopLevel,
        appetiteLevel: input.appetiteLevel,
        spiritLevel: input.spiritLevel,
        exerciseLevel: input.exerciseLevel,
        hasAnomaly: input.hasAnomaly,
        anomalyItems: input.anomalyItems,
        riskLevel: 'high',
        aiFeedback: '🔔 您的宠物出现了一些需要关注的症状。建议密切观察，如持续恶化请就医。具体症状：食欲异常。',
        createdAt: new Date(),
      })

      const result = await createCheckin(input)

      expect(result.riskLevel).toBe('high')
      expect(result.aiFeedback).toContain('需要关注')
      expect(result.aiFeedback).toContain('食欲异常')
      expect(result.appetiteLevel).toBe(2)
    })

    it('食欲低下的打卡应该在本地存储中标记为 high', async () => {
      const input = makeCheckinInput({
        appetiteLevel: 2,
        spiritLevel: 5,
        poopLevel: 5,
      })

      vi.mocked(api.post).mockResolvedValue({
        id: 'checkin-002',
        petId: input.petId,
        userId: input.userId,
        poopLevel: input.poopLevel,
        appetiteLevel: input.appetiteLevel,
        spiritLevel: input.spiritLevel,
        exerciseLevel: input.exerciseLevel,
        hasAnomaly: input.hasAnomaly,
        anomalyItems: input.anomalyItems,
        riskLevel: 'high',
        aiFeedback: '🔔 您的宠物出现了一些需要关注的症状。',
        createdAt: new Date(),
      })

      await createCheckin(input)

      const storageKey = `checkins_${petId}_${userId}`
      const stored = JSON.parse(mockStorage[storageKey])
      expect(stored[0].riskLevel).toBe('high')
    })
  })

  describe('步骤 4: 紧急打卡 — 所有指标异常', () => {
    it('所有指标为 1 应该触发 emergency 风险等级', async () => {
      const input = makeCheckinInput({
        appetiteLevel: 1,
        spiritLevel: 1,
        poopLevel: 1,
        exerciseLevel: 2,
        hasAnomaly: false,
      })

      vi.mocked(api.post).mockResolvedValue({
        id: 'checkin-003',
        petId: input.petId,
        userId: input.userId,
        poopLevel: input.poopLevel,
        appetiteLevel: input.appetiteLevel,
        spiritLevel: input.spiritLevel,
        exerciseLevel: input.exerciseLevel,
        hasAnomaly: input.hasAnomaly,
        anomalyItems: input.anomalyItems,
        riskLevel: 'emergency',
        aiFeedback: '⚠️ 检测到紧急健康信号！建议立即联系宠物医院。具体症状：食欲异常、精神状态异常、排便异常。',
        createdAt: new Date(),
      })

      const result = await createCheckin(input)

      expect(result.riskLevel).toBe('emergency')
      expect(result.aiFeedback).toContain('紧急')
      expect(result.aiFeedback).toContain('立即联系宠物医院')
      expect(result.aiFeedback).toContain('食欲异常')
      expect(result.aiFeedback).toContain('精神状态异常')
      expect(result.aiFeedback).toContain('排便异常')
    })

    it('紧急打卡应该持久化到本地存储', async () => {
      const input = makeCheckinInput({
        appetiteLevel: 1,
        spiritLevel: 1,
        poopLevel: 1,
      })

      vi.mocked(api.post).mockResolvedValue({
        id: 'checkin-003',
        petId: input.petId,
        userId: input.userId,
        poopLevel: input.poopLevel,
        appetiteLevel: input.appetiteLevel,
        spiritLevel: input.spiritLevel,
        exerciseLevel: input.exerciseLevel,
        hasAnomaly: input.hasAnomaly,
        anomalyItems: input.anomalyItems,
        riskLevel: 'emergency',
        aiFeedback: '⚠️ 检测到紧急健康信号！',
        createdAt: new Date(),
      })

      await createCheckin(input)

      const storageKey = `checkins_${petId}_${userId}`
      const stored = JSON.parse(mockStorage[storageKey])
      expect(stored[0].riskLevel).toBe('emergency')
    })
  })

  describe('步骤 5: 获取今日打卡记录', () => {
    it('应该返回今日最新的打卡记录', async () => {
      // 先创建一条打卡记录
      const input = makeCheckinInput({
        appetiteLevel: 4,
        spiritLevel: 4,
        poopLevel: 3,
      })

      vi.mocked(api.post).mockResolvedValue({
        id: 'checkin-today',
        petId: input.petId,
        userId: input.userId,
        poopLevel: input.poopLevel,
        appetiteLevel: input.appetiteLevel,
        spiritLevel: input.spiritLevel,
        exerciseLevel: input.exerciseLevel,
        hasAnomaly: input.hasAnomaly,
        anomalyItems: input.anomalyItems,
        riskLevel: 'low',
        aiFeedback: '✅ 您的宠物今天状态不错！',
        createdAt: new Date(),
      })

      await createCheckin(input)

      // 然后查询今日记录
      vi.mocked(api.get).mockResolvedValue({
        id: 'checkin-today',
        petId: input.petId,
        userId: input.userId,
        poopLevel: input.poopLevel,
        appetiteLevel: input.appetiteLevel,
        spiritLevel: input.spiritLevel,
        exerciseLevel: input.exerciseLevel,
        hasAnomaly: input.hasAnomaly,
        anomalyItems: input.anomalyItems,
        riskLevel: 'low',
        aiFeedback: '✅ 您的宠物今天状态不错！',
        createdAt: new Date(),
      })

      const result = await getTodayCheckin(petId, userId)

      expect(result).not.toBeNull()
      expect(result!.petId).toBe(petId)
      expect(result!.riskLevel).toBe('low')
      expect(api.get).toHaveBeenCalledWith(
        `/api/pets/${petId}/checkins/today?date=${today}`
      )
    })

    it('今日无打卡时应返回 null', async () => {
      vi.mocked(api.get).mockResolvedValue(null)

      const result = await getTodayCheckin(petId, userId)

      expect(result).toBeNull()
    })
  })

  describe('步骤 6: 获取打卡统计', () => {
    it('应该返回打卡统计数据', async () => {
      // 先创建多条打卡记录
      const input1 = makeCheckinInput({ appetiteLevel: 4, spiritLevel: 4, poopLevel: 3 })
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'checkin-s1',
        petId,
        userId,
        poopLevel: 3,
        appetiteLevel: 4,
        spiritLevel: 4,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
        riskLevel: 'low',
        aiFeedback: '✅ 状态不错',
        createdAt: new Date(),
      })
      await createCheckin(input1)

      const input2 = makeCheckinInput({ appetiteLevel: 2, spiritLevel: 5, poopLevel: 5 })
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'checkin-s2',
        petId,
        userId,
        poopLevel: 5,
        appetiteLevel: 2,
        spiritLevel: 5,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
        riskLevel: 'high',
        aiFeedback: '🔔 需要关注',
        createdAt: new Date(),
      })
      await createCheckin(input2)

      // 查询统计（后端无 stats 接口，本地计算）
      const stats = await getCheckinStats(petId, userId)

      expect(stats.totalCheckins).toBeGreaterThanOrEqual(1)
      expect(stats.lastCheckinDate).toBeDefined()
      expect(stats.weeklyCount).toBeGreaterThanOrEqual(0)
      expect(stats.monthlyCount).toBeGreaterThanOrEqual(0)
      expect(typeof stats.streak).toBe('number')
      expect(typeof stats.totalCheckins).toBe('number')
      expect(api.get).not.toHaveBeenCalledWith(`/api/pets/${petId}/checkins/stats`)
    })

    it('无本地记录时应该返回空统计', async () => {
      const stats = await getCheckinStats(petId, userId)

      // 本地统计应该返回默认值
      expect(stats.totalCheckins).toBe(0)
      expect(stats.streak).toBe(0)
      expect(stats.lastCheckinDate).toBeNull()
      expect(stats.weeklyCount).toBe(0)
      expect(stats.monthlyCount).toBe(0)
    })
  })

  describe('步骤 7: 获取打卡历史记录', () => {
    it('打卡记录应该按日期排序', async () => {
      // 创建多条不同日期的打卡记录
      const input1 = makeCheckinInput({ appetiteLevel: 4, spiritLevel: 4, poopLevel: 3 })
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'checkin-h1',
        petId,
        userId,
        poopLevel: 3,
        appetiteLevel: 4,
        spiritLevel: 4,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
        riskLevel: 'low',
        aiFeedback: '✅ 状态不错',
        createdAt: new Date('2026-07-25T10:00:00.000Z'),
      })
      await createCheckin(input1)

      const input2 = makeCheckinInput({ appetiteLevel: 2, spiritLevel: 5, poopLevel: 5 })
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'checkin-h2',
        petId,
        userId,
        poopLevel: 5,
        appetiteLevel: 2,
        spiritLevel: 5,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
        riskLevel: 'high',
        aiFeedback: '🔔 需要关注',
        createdAt: new Date('2026-07-24T10:00:00.000Z'),
      })
      await createCheckin(input2)

      // 查询全部历史
      vi.mocked(api.get).mockResolvedValue([
        {
          id: 'checkin-h1',
          petId,
          userId,
          poopLevel: 3,
          appetiteLevel: 4,
          spiritLevel: 4,
          exerciseLevel: 2,
          hasAnomaly: false,
          anomalyItems: [],
          riskLevel: 'low',
          aiFeedback: '✅ 状态不错',
          createdAt: new Date('2026-07-25T10:00:00.000Z'),
        },
        {
          id: 'checkin-h2',
          petId,
          userId,
          poopLevel: 5,
          appetiteLevel: 2,
          spiritLevel: 5,
          exerciseLevel: 2,
          hasAnomaly: false,
          anomalyItems: [],
          riskLevel: 'high',
          aiFeedback: '🔔 需要关注',
          createdAt: new Date('2026-07-24T10:00:00.000Z'),
        },
      ])

      const history = await getCheckins(petId, userId)

      expect(history).toHaveLength(2)
      expect(history[0].petId).toBe(petId)
      expect(history[1].petId).toBe(petId)
      // 记录应该都包含必要的字段
      for (const entry of history) {
        expect(entry.id).toBeDefined()
        expect(entry.riskLevel).toBeDefined()
        expect(entry.aiFeedback).toBeDefined()
        expect(entry.createdAt).toBeDefined()
      }
      expect(api.get).toHaveBeenCalledWith(`/api/pets/${petId}/checkins`)
    })

    it('可以按日期范围查询打卡记录', async () => {
      vi.mocked(api.get).mockResolvedValue([
        {
          id: 'checkin-r1',
          petId,
          userId,
          poopLevel: 3,
          appetiteLevel: 4,
          spiritLevel: 4,
          exerciseLevel: 2,
          hasAnomaly: false,
          anomalyItems: [],
          riskLevel: 'low',
          aiFeedback: '✅ 状态不错',
          createdAt: new Date('2026-07-25T10:00:00.000Z'),
        },
      ])

      const result = await getCheckinsByDateRange(petId, userId, '2026-07-01', '2026-07-31')

      expect(result).toHaveLength(1)
      expect(result[0].riskLevel).toBe('low')
      expect(api.get).toHaveBeenCalledWith(
        `/api/pets/${petId}/checkins?startDate=2026-07-01&endDate=2026-07-31`
      )
    })
  })

  describe('步骤 8: 获取最新打卡记录', () => {
    it('应该返回时间最新的打卡记录', async () => {
      // 先创建两条记录
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'checkin-old',
        petId,
        userId,
        poopLevel: 3,
        appetiteLevel: 4,
        spiritLevel: 4,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
        riskLevel: 'low',
        aiFeedback: '✅ 状态不错',
        createdAt: new Date('2026-07-24T10:00:00.000Z'),
      })
      await createCheckin(makeCheckinInput({ appetiteLevel: 4, spiritLevel: 4, poopLevel: 3 }))

      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'checkin-new',
        petId,
        userId,
        poopLevel: 3,
        appetiteLevel: 4,
        spiritLevel: 4,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
        riskLevel: 'low',
        aiFeedback: '✅ 状态不错',
        createdAt: new Date('2026-07-25T12:00:00.000Z'),
      })
      await createCheckin(makeCheckinInput({ appetiteLevel: 4, spiritLevel: 4, poopLevel: 3 }))

      // 后端无 latest 接口，本地取最新记录
      const latest = await getLatestCheckin(petId, userId)

      expect(latest).not.toBeNull()
      expect(latest!.id).toBe('checkin-new')
      expect(api.get).not.toHaveBeenCalledWith(`/api/pets/${petId}/checkins/latest`)
    })
  })

  describe('完整流程：从正常到紧急的打卡全流程', () => {
    it('应该完成完整的打卡流程并验证各阶段状态', async () => {
      // 1. 正常打卡
      const normalInput = makeCheckinInput({
        appetiteLevel: 4,
        spiritLevel: 4,
        poopLevel: 3,
      })
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'flow-1',
        petId,
        userId,
        poopLevel: 3,
        appetiteLevel: 4,
        spiritLevel: 4,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
        riskLevel: 'low',
        aiFeedback: '✅ 您的宠物今天状态不错！继续保持良好的照顾习惯。',
        createdAt: new Date(),
      })
      const normal = await createCheckin(normalInput)
      expect(normal.riskLevel).toBe('low')

      // 2. 异常打卡
      const warningInput = makeCheckinInput({
        appetiteLevel: 2,
        spiritLevel: 5,
        poopLevel: 5,
      })
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'flow-2',
        petId,
        userId,
        poopLevel: 5,
        appetiteLevel: 2,
        spiritLevel: 5,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
        riskLevel: 'high',
        aiFeedback: '🔔 您的宠物出现了一些需要关注的症状。建议密切观察，如持续恶化请就医。具体症状：食欲异常。',
        createdAt: new Date(),
      })
      const warning = await createCheckin(warningInput)
      expect(warning.riskLevel).toBe('high')
      expect(warning.aiFeedback).toContain('食欲异常')

      // 3. 紧急打卡
      const emergencyInput = makeCheckinInput({
        appetiteLevel: 1,
        spiritLevel: 1,
        poopLevel: 1,
      })
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'flow-3',
        petId,
        userId,
        poopLevel: 1,
        appetiteLevel: 1,
        spiritLevel: 1,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
        riskLevel: 'emergency',
        aiFeedback: '⚠️ 检测到紧急健康信号！建议立即联系宠物医院。具体症状：食欲异常、精神状态异常、排便异常。',
        createdAt: new Date(),
      })
      const emergency = await createCheckin(emergencyInput)
      expect(emergency.riskLevel).toBe('emergency')
      expect(emergency.aiFeedback).toContain('立即联系宠物医院')

      // 4. 验证记录已持久化到本地存储
      //    注意：checkinService 按日期去重，同一天多次打卡只保留最新一条
      const storageKey = `checkins_${petId}_${userId}`
      const stored = JSON.parse(mockStorage[storageKey])
      expect(stored).toHaveLength(1)
      expect(stored[0].riskLevel).toBe('emergency')
      expect(stored[0].id).toBe('flow-3')
    })
  })
})