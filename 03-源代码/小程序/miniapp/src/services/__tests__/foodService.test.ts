/**
 * 食物安全查询服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { api } from '../api'
import { isMember, getQuotaLimit } from '../membershipService'
import {
  queryFood,
  getQueryHistory,
  getQueryStats,
  getTodayQueryCount,
} from '../foodService'
import type { PetFoodQuery } from '../foodService'

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
  },
}))

vi.mock('../membershipService', () => ({
  isMember: vi.fn(),
  getQuotaLimit: vi.fn(),
}))

vi.mock('../../utils/petOwnership', () => ({
  requirePetOwnership: vi.fn(),
  isPetOwnerLocal: vi.fn(() => true),
}))

function makeApiQueryResult(overrides: Partial<PetFoodQuery> = {}): PetFoodQuery {
  return {
    id: 'fq_001',
    userId: 'user_001',
    foodName: '巧克力',
    safetyLevel: 'toxic',
    detail: '巧克力中的可可碱和咖啡因对猫狗有毒',
    dangerousCompounds: ['可可碱', '咖啡因'],
    symptoms: ['呕吐', '腹泻', '心跳加速'],
    breedWarnings: [],
    firstAid: '立即联系宠物医院',
    isMemberQuery: false,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('foodService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  describe('queryFood', () => {
    it('should return API result and save to local storage when API succeeds', async () => {
      const mockResult = makeApiQueryResult({ foodName: '苹果', safetyLevel: 'safe' })
      vi.mocked(api.get).mockResolvedValue(mockResult)

      const result = await queryFood('user_001', 'pet_001', '苹果', 'dog')

      expect(result.foodName).toBe('苹果')
      expect(result.safetyLevel).toBe('safe')
      expect(api.get).toHaveBeenCalledWith('/api/food/query', { keyword: '苹果' })
    })

    it('should fallback to local engine when API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await queryFood('user_001', 'pet_001', '巧克力', 'dog')

      expect(result.foodName).toBe('巧克力')
      expect(result.safetyLevel).toBe('toxic')
      expect(result.id).toBeDefined()
    })

    it('should return toxic level for toxic food via local engine', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await queryFood('user_001', 'pet_001', '葡萄', 'dog')

      expect(result.safetyLevel).toBe('toxic')
      expect(result.foodName).toBe('葡萄')
      expect(result.dangerousCompounds).toBeDefined()
    })

    it('should return safe level for safe food via local engine', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await queryFood('user_001', 'pet_001', '鸡胸肉', 'dog')

      expect(result.safetyLevel).toBe('safe')
      expect(result.foodName).toBe('鸡胸肉')
    })
  })

  describe('getQueryHistory', () => {
    it('should return history list from API when API succeeds', async () => {
      const mockHistory = [
        makeApiQueryResult({ id: 'fq_001', foodName: '巧克力' }),
        makeApiQueryResult({ id: 'fq_002', foodName: '苹果', safetyLevel: 'safe' }),
      ]
      vi.mocked(api.get).mockResolvedValue(mockHistory)

      const result = await getQueryHistory('pet_001', 'user_001')

      expect(result).toHaveLength(2)
      expect(result[0].foodName).toBe('巧克力')
      expect(result[1].foodName).toBe('苹果')
      expect(api.get).toHaveBeenCalledWith('/api/food/history')
    })

    it('should fallback to local storage when API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const localQueries = [
        makeApiQueryResult({ id: 'fq_local_001', foodName: '葡萄' }),
      ]
      mockStorage[`xhh_food_queries_pet_001_user_001`] = JSON.stringify(localQueries)

      const result = await getQueryHistory('pet_001', 'user_001')

      expect(result).toHaveLength(1)
      expect(result[0].foodName).toBe('葡萄')
    })

    it('should return empty array when no history exists', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await getQueryHistory('pet_001', 'user_001')

      expect(result).toEqual([])
    })
  })

  describe('getQueryStats', () => {
    it('should return stats from API when API succeeds', async () => {
      const mockStats = {
        totalQueries: 10,
        todayQueries: 3,
      }
      vi.mocked(api.get).mockResolvedValue(mockStats)
      vi.mocked(isMember).mockResolvedValue(false)
      vi.mocked(getQuotaLimit).mockResolvedValue(5)

      const result = await getQueryStats('pet_001', 'user_001')

      expect(result.totalQueries).toBe(10)
      expect(result.todayQueries).toBe(3)
      expect(result.remainingFree).toBe(2)
      expect(result.isMemberUser).toBe(false)
      expect(api.get).toHaveBeenCalledWith('/api/food/stats')
    })

    it('should fallback to local calculation when API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))
      vi.mocked(isMember).mockResolvedValue(false)
      vi.mocked(getQuotaLimit).mockResolvedValue(5)

      const today = new Date().toISOString().slice(0, 10)
      const localQueries = [
        makeApiQueryResult({ id: 'fq_001', createdAt: new Date() }),
        makeApiQueryResult({ id: 'fq_002', createdAt: new Date() }),
        makeApiQueryResult({ id: 'fq_003', createdAt: new Date('2020-01-01') }),
      ]
      mockStorage[`xhh_food_queries_pet_001_user_001`] = JSON.stringify(localQueries)

      const result = await getQueryStats('pet_001', 'user_001')

      expect(result.totalQueries).toBe(3)
      expect(result.todayQueries).toBe(2)
      expect(result.remainingFree).toBe(3)
      expect(result.isMemberUser).toBe(false)
    })

    it('should return default values when no records exist', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))
      vi.mocked(isMember).mockResolvedValue(false)
      vi.mocked(getQuotaLimit).mockResolvedValue(5)

      const result = await getQueryStats('pet_001', 'user_001')

      expect(result.totalQueries).toBe(0)
      expect(result.todayQueries).toBe(0)
      expect(result.remainingFree).toBe(5)
      expect(result.isMemberUser).toBe(false)
    })
  })

  describe('getTodayQueryCount', () => {
    it('should return today count from API when API succeeds', async () => {
      vi.mocked(api.get).mockResolvedValue({ count: 5 })

      const result = await getTodayQueryCount('pet_001', 'user_001')

      expect(result).toBe(5)
      expect(api.get).toHaveBeenCalledWith('/api/food/today-count')
    })

    it('should fallback to local calculation when API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const today = new Date().toISOString().slice(0, 10)
      const localQueries = [
        makeApiQueryResult({ id: 'fq_001', createdAt: new Date() }),
        makeApiQueryResult({ id: 'fq_002', createdAt: new Date() }),
        makeApiQueryResult({ id: 'fq_003', createdAt: new Date('2020-01-01') }),
      ]
      mockStorage[`xhh_food_queries_pet_001_user_001`] = JSON.stringify(localQueries)

      const result = await getTodayQueryCount('pet_001', 'user_001')

      expect(result).toBe(2)
    })

    it('should return 0 when no records exist', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await getTodayQueryCount('pet_001', 'user_001')

      expect(result).toBe(0)
    })
  })
})
