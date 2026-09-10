/**
 * 健康打卡服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AnomalyItem } from '../../memory-body/types/memoryBodyTypes'

import { api as _api } from '../api'
import { localDateString } from '../../utils/date'
import {
  createCheckin,
  batchCreateCheckins,
  getTodayCheckin,
  getCheckinStats,
  getCheckinsByDateRange,
  getCheckins,
  getLatestCheckin,
  calcHealthScore,
} from '../checkinService'
import type { PetHealthEntry } from '../checkinService'

const mockStorage: Record<string, string> = {}

vi.mock('../../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[`xhh_${key}`]
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[`xhh_${key}`] = JSON.stringify(value)
  }),
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[`xhh_${key}`]
  }),
}))

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../utils/petOwnership', () => ({
  requirePetOwnership: vi.fn(),
  isPetOwnerLocal: vi.fn(() => true),
}))
const api = _api as any

/**
 * 今天的日期串 —— **本地日历日**，不是 UTC
 *
 * 2026-09-11 修复：这里原来写 `new Date().toISOString().split('T')[0]`（UTC），
 * 与被测实现当时的 UTC 口径"自洽"→ 双方一起错：东八区 08:00 之前跑用例/打卡，
 * 都会把当天算成前一天。实现已改为本地日历日（`utils/date.localDateString`），
 * fixture 必须同步，否则这条用例只是在复述旧 bug。
 */
const today = localDateString(new Date())!
const userId = 'user-001'

const mockEntry = {
  petId: 'pet-001',
  userId,
  poopLevel: 3 as const,
  appetiteLevel: 3 as const,
  spiritLevel: 3 as const,
  exerciseLevel: 2 as const,
  hasAnomaly: false,
  anomalyItems: [] as AnomalyItem[],
}

function makeCheckinResponse(overrides: Partial<PetHealthEntry> = {}): PetHealthEntry {
  return {
    id: 'checkin_001',
    petId: 'pet-001',
    userId,
    poopLevel: 3,
    appetiteLevel: 3,
    spiritLevel: 3,
    exerciseLevel: 2,
    hasAnomaly: false,
    anomalyItems: [],
    riskLevel: 'low',
    aiFeedback: '✅ 您的宠物今天状态不错！继续保持良好的照顾习惯。',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('checkinService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  describe('createCheckin', () => {
    it('should create normal checkin successfully', async () => {
      const mockResponse = makeCheckinResponse()
      vi.mocked(api.post).mockResolvedValue(mockResponse)

      const result = await createCheckin(mockEntry)

      expect(result.petId).toBe('pet-001')
      expect(result.poopLevel).toBe(3)
      expect(result.appetiteLevel).toBe(3)
      expect(result.spiritLevel).toBe(3)
      expect(result.riskLevel).toBe('low')
      expect(result.aiFeedback).toContain('状态不错')
      expect(result.id).toBeDefined()
      expect(result.createdAt).toBeDefined()
      expect(api.post).toHaveBeenCalledWith(
        '/api/pets/pet-001/checkins',
        // 全正常档位（便3/食3/神3）应为 low：3="正常"不是轻度异常（历史 caution 语义颠倒已修复）
        expect.objectContaining({ poop_level: 3, risk_level: 'low' })
      )
    })

    it('should trigger emergency when poopLevel is 1', async () => {
      const mockResponse = makeCheckinResponse()
      vi.mocked(api.post).mockResolvedValue(mockResponse)

      await createCheckin({ ...mockEntry, poopLevel: 1 })

      const callArgs = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>
      expect(callArgs.risk_level).toBe('emergency')
      expect(callArgs.ai_feedback).toContain('紧急健康信号')
    })

    it('should trigger emergency when appetiteLevel is 1 and spiritLevel is 1', async () => {
      const mockResponse = makeCheckinResponse()
      vi.mocked(api.post).mockResolvedValue(mockResponse)

      await createCheckin({
        ...mockEntry,
        appetiteLevel: 1,
        spiritLevel: 1,
      })

      const callArgs = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>
      expect(callArgs.risk_level).toBe('emergency')
      expect(callArgs.ai_feedback).toContain('紧急健康信号')
    })

    it('should trigger high when poopLevel is 2', async () => {
      const mockResponse = makeCheckinResponse()
      vi.mocked(api.post).mockResolvedValue(mockResponse)

      await createCheckin({ ...mockEntry, poopLevel: 2 })

      const callArgs = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>
      expect(callArgs.risk_level).toBe('high')
    })

    it('should trigger high when appetiteLevel is 1', async () => {
      const mockResponse = makeCheckinResponse()
      vi.mocked(api.post).mockResolvedValue(mockResponse)

      await createCheckin({ ...mockEntry, appetiteLevel: 1 })

      const callArgs = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>
      expect(callArgs.risk_level).toBe('high')
    })

    it('should trigger high when spiritLevel is 1', async () => {
      const mockResponse = makeCheckinResponse()
      vi.mocked(api.post).mockResolvedValue(mockResponse)

      await createCheckin({ ...mockEntry, spiritLevel: 1 })

      const callArgs = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>
      expect(callArgs.risk_level).toBe('high')
    })

    it('should trigger medium when hasAnomaly is true', async () => {
      const mockResponse = makeCheckinResponse()
      vi.mocked(api.post).mockResolvedValue(mockResponse)

      await createCheckin({ ...mockEntry, hasAnomaly: true, anomalyItems: ['poop'] as AnomalyItem[] })

      const callArgs = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>
      expect(callArgs.risk_level).toBe('medium')
    })

    it('should fallback to local storage when API fails', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))

      const result = await createCheckin(mockEntry)

      expect(result.petId).toBe('pet-001')
      expect(result.riskLevel).toBe('low')
      expect(result.id).toBeDefined()
    })
  })

  describe('getTodayCheckin', () => {
    it('should return today checkin from API', async () => {
      const mockResponse = makeCheckinResponse()
      vi.mocked(api.get).mockResolvedValue(mockResponse)

      const result = await getTodayCheckin('pet-001', userId)

      expect(result).not.toBeNull()
      expect(result!.petId).toBe('pet-001')
      expect(api.get).toHaveBeenCalledWith(
        `/api/pets/pet-001/checkins/today?date=${today}`
      )
    })

    it('should return null when no today checkin exists', async () => {
      vi.mocked(api.get).mockResolvedValue(null)

      const result = await getTodayCheckin('pet-001', userId)

      expect(result).toBeNull()
    })

    it('should fallback to local storage when API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await getTodayCheckin('pet-001', userId)

      expect(result).toBeNull()
    })
  })

  describe('getCheckinStats', () => {
    it('should calculate checkin stats from local records', async () => {
      mockStorage['xhh_checkins_pet-001_user-001'] = JSON.stringify([
        makeCheckinResponse({ id: 'c1', createdAt: new Date(), hasAnomaly: true }),
        makeCheckinResponse({ id: 'c2', createdAt: new Date(Date.now() - 86400000) }),
      ])

      const result = await getCheckinStats('pet-001', userId)

      expect(result.totalCheckins).toBe(2)
      expect(result.lastCheckinDate).toBe(today)
      expect(result.weeklyCount).toBeGreaterThanOrEqual(1)
      expect(result.monthlyCount).toBe(2)
      expect(api.get).not.toHaveBeenCalled()
    })

    it('should return empty stats when no records exist', async () => {
      const result = await getCheckinStats('pet-001', userId)

      expect(result.totalCheckins).toBe(0)
      expect(result.streak).toBe(0)
      expect(result.lastCheckinDate).toBeNull()
    })
  })

  describe('getCheckinsByDateRange', () => {
    it('should return checkins within date range from API', async () => {
      const mockCheckins = [makeCheckinResponse(), makeCheckinResponse({ id: 'checkin_002' })]
      vi.mocked(api.get).mockResolvedValue(mockCheckins)

      const result = await getCheckinsByDateRange('pet-001', userId, '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(2)
      expect(api.get).toHaveBeenCalledWith(
        '/api/pets/pet-001/checkins?startDate=2024-01-01&endDate=2024-01-31'
      )
    })

    it('should fallback to local storage when API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await getCheckinsByDateRange('pet-001', userId, '2024-01-01', '2024-01-31')

      expect(result).toEqual([])
    })
  })

  describe('getCheckins', () => {
    it('should return all checkins from API', async () => {
      const mockCheckins = [makeCheckinResponse(), makeCheckinResponse({ id: 'checkin_002' })]
      vi.mocked(api.get).mockResolvedValue(mockCheckins)

      const result = await getCheckins('pet-001', userId)

      expect(result).toHaveLength(2)
      expect(api.get).toHaveBeenCalledWith('/api/pets/pet-001/checkins')
    })

    it('should fallback to local storage when API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await getCheckins('pet-001', userId)

      expect(result).toEqual([])
    })
  })

  describe('getLatestCheckin', () => {
    it('should return latest checkin from local records', async () => {
      mockStorage['xhh_checkins_pet-001_user-001'] = JSON.stringify([
        makeCheckinResponse({ id: 'checkin_old', createdAt: new Date('2024-01-01T00:00:00.000Z') }),
        makeCheckinResponse({ id: 'checkin_001', createdAt: new Date('2024-01-02T00:00:00.000Z') }),
      ])

      const result = await getLatestCheckin('pet-001', userId)

      expect(result).not.toBeNull()
      expect(result!.id).toBe('checkin_001')
      expect(api.get).not.toHaveBeenCalled()
    })

    it('should return null when no checkins exist', async () => {
      const result = await getLatestCheckin('pet-001', userId)

      expect(result).toBeNull()
    })
  })

  describe('batchCreateCheckins', () => {
    it('应为每只宠物逐条创建打卡', async () => {
      vi.mocked(api.post).mockResolvedValue(makeCheckinResponse())
      const items = [
        { ...mockEntry, petId: 'pet-001' },
        { ...mockEntry, petId: 'pet-002' },
      ]

      const results = await batchCreateCheckins(items)

      expect(results).toHaveLength(2)
      expect(api.post).toHaveBeenCalledTimes(2)
      expect(api.post).toHaveBeenCalledWith('/api/pets/pet-002/checkins', expect.anything())
    })

    it('首只接口失败时仍会本地兜底并继续后续宠物', async () => {
      vi.mocked(api.post)
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue(makeCheckinResponse())
      const items = [
        { ...mockEntry, petId: 'pet-001' },
        { ...mockEntry, petId: 'pet-002' },
      ]

      const results = await batchCreateCheckins(items)

      // createCheckin 内部有“云端失败写本地”兜底，因此不会中断整批
      expect(results).toHaveLength(2)
      expect(api.post).toHaveBeenCalledTimes(2)
    })
  })
})

describe('calcHealthScore 健康分（正常=满分，2026-09-10 修复"都正常仅 64 分"）', () => {
  it('都正常（成型+正常吃完+正常活动）应为 100 分（满分）', () => {
    expect(calcHealthScore(3, 3, 3)).toBe(100)
  })

  it('偏软便 + 正常 + 正常应略低于满分', () => {
    expect(calcHealthScore(4, 3, 3)).toBe(87)
  })

  it('多吃 + 兴奋（略偏离正常）应略低于满分', () => {
    expect(calcHealthScore(3, 4, 4)).toBe(87)
  })

  it('明显异常（腹泻+少吃+萎靡）应为低分', () => {
    const score = calcHealthScore(2, 2, 2)
    expect(score).toBeLessThan(50)
  })

  it('越界值回退默认档（不崩溃）', () => {
    expect(() => calcHealthScore(99, 99, 99)).not.toThrow()
  })
})
