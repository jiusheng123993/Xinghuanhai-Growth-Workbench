/**
 * 食物安全查询状态管理 - 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useFoodQueryStore } from '../foodQueryStore'
import type { PetFoodQuery } from '../../memory-body/types/memoryBodyTypes'
import type { FoodQueryStats } from '../../services/foodService'

const { mockFoodService } = vi.hoisted(() => {
  return {
    mockFoodService: {
      queryFood: vi.fn(),
      getQueryHistory: vi.fn(),
      getQueryStats: vi.fn(),
    },
  }
})

vi.mock('../../services/foodService', () => mockFoodService)

function makeFoodQuery(overrides: Partial<PetFoodQuery> = {}): PetFoodQuery {
  return {
    id: 'fq_test_001',
    userId: 'user-001',
    foodName: '巧克力',
    safetyLevel: 'toxic',
    detail: '巧克力对狗有毒',
    dangerousCompounds: ['可可碱'],
    symptoms: ['呕吐', '腹泻'],
    breedWarnings: [],
    firstAid: '立即联系兽医',
    isMemberQuery: false,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeStats(overrides: Partial<FoodQueryStats> = {}): FoodQueryStats {
  return {
    totalQueries: 10,
    todayQueries: 2,
    remainingFree: 3,
    isMemberUser: false,
    ...overrides,
  }
}

describe('foodQueryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFoodQueryStore.setState({
      history: [],
      lastResult: null,
      stats: null,
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('should have empty history', () => {
      const state = useFoodQueryStore.getState()
      expect(state.history).toEqual([])
    })

    it('should have null lastResult', () => {
      const state = useFoodQueryStore.getState()
      expect(state.lastResult).toBeNull()
    })

    it('should have null stats', () => {
      const state = useFoodQueryStore.getState()
      expect(state.stats).toBeNull()
    })

    it('should have isLoading as false', () => {
      const state = useFoodQueryStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have null error', () => {
      const state = useFoodQueryStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('queryFood', () => {
    it('should set lastResult and prepend to history on success', async () => {
      const mockResult = makeFoodQuery()
      mockFoodService.queryFood.mockResolvedValue(mockResult)

      const result = await useFoodQueryStore.getState().queryFood('user-001', 'pet-001', '巧克力', 'dog')

      expect(result.id).toBe('fq_test_001')
      const state = useFoodQueryStore.getState()
      expect(state.lastResult).not.toBeNull()
      expect(state.lastResult!.id).toBe('fq_test_001')
      expect(state.history).toHaveLength(1)
      expect(state.history[0].id).toBe('fq_test_001')
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should call queryFood service with correct parameters', async () => {
      const mockResult = makeFoodQuery()
      mockFoodService.queryFood.mockResolvedValue(mockResult)

      await useFoodQueryStore.getState().queryFood('user-001', 'pet-001', '巧克力', 'cat')

      expect(mockFoodService.queryFood).toHaveBeenCalledWith('user-001', 'pet-001', '巧克力', 'cat')
    })

    it('should prepend new result before existing history', async () => {
      const existingQuery = makeFoodQuery({ id: 'fq_old_001', foodName: '葡萄' })
      useFoodQueryStore.setState({ history: [existingQuery] })

      const newResult = makeFoodQuery({ id: 'fq_new_001', foodName: '巧克力' })
      mockFoodService.queryFood.mockResolvedValue(newResult)

      await useFoodQueryStore.getState().queryFood('user-001', 'pet-001', '巧克力', 'dog')

      const state = useFoodQueryStore.getState()
      expect(state.history).toHaveLength(2)
      expect(state.history[0].id).toBe('fq_new_001')
      expect(state.history[1].id).toBe('fq_old_001')
    })

    it('should set isLoading to true during request', async () => {
      let resolvePromise: (value: PetFoodQuery) => void
      const pendingPromise = new Promise<PetFoodQuery>((resolve) => {
        resolvePromise = resolve
      })
      mockFoodService.queryFood.mockReturnValue(pendingPromise)

      const promise = useFoodQueryStore.getState().queryFood('user-001', 'pet-001', '巧克力', 'dog')

      expect(useFoodQueryStore.getState().isLoading).toBe(true)

      resolvePromise!(makeFoodQuery())
      await promise

      expect(useFoodQueryStore.getState().isLoading).toBe(false)
    })

    it('should clear error before request', async () => {
      useFoodQueryStore.setState({ error: '之前的错误' })
      mockFoodService.queryFood.mockResolvedValue(makeFoodQuery())

      await useFoodQueryStore.getState().queryFood('user-001', 'pet-001', '巧克力', 'dog')

      expect(useFoodQueryStore.getState().error).toBeNull()
    })

    it('should set error with Error message on failure', async () => {
      mockFoodService.queryFood.mockRejectedValue(new Error('网络异常'))

      await expect(
        useFoodQueryStore.getState().queryFood('user-001', 'pet-001', '巧克力', 'dog')
      ).rejects.toThrow('网络异常')

      const state = useFoodQueryStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('网络异常')
    })

    it('should set default error message for non-Error thrown value', async () => {
      mockFoodService.queryFood.mockRejectedValue('unknown failure')

      await expect(
        useFoodQueryStore.getState().queryFood('user-001', 'pet-001', '巧克力', 'dog')
      ).rejects.toBe('unknown failure')

      const state = useFoodQueryStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('查询食物安全性失败')
    })

    it('should not update lastResult or history on failure', async () => {
      const existingQuery = makeFoodQuery({ id: 'fq_existing' })
      useFoodQueryStore.setState({ lastResult: existingQuery, history: [existingQuery] })

      mockFoodService.queryFood.mockRejectedValue(new Error('失败'))

      await expect(
        useFoodQueryStore.getState().queryFood('user-001', 'pet-001', '巧克力', 'dog')
      ).rejects.toThrow('失败')

      const state = useFoodQueryStore.getState()
      expect(state.lastResult!.id).toBe('fq_existing')
      expect(state.history).toHaveLength(1)
    })

    it('should return the result from service', async () => {
      const mockResult = makeFoodQuery({ id: 'fq_return_test', foodName: '洋葱' })
      mockFoodService.queryFood.mockResolvedValue(mockResult)

      const result = await useFoodQueryStore.getState().queryFood('user-001', 'pet-001', '洋葱', 'dog')

      expect(result).toBe(mockResult)
    })
  })

  describe('fetchHistory', () => {
    it('should load history on success', async () => {
      const mockHistory = [
        makeFoodQuery({ id: 'fq_001' }),
        makeFoodQuery({ id: 'fq_002', foodName: '葡萄' }),
      ]
      mockFoodService.getQueryHistory.mockResolvedValue(mockHistory)

      await useFoodQueryStore.getState().fetchHistory('pet-001', 'user-001')

      const state = useFoodQueryStore.getState()
      expect(state.history).toHaveLength(2)
      expect(state.history[0].id).toBe('fq_001')
      expect(state.history[1].id).toBe('fq_002')
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should call getQueryHistory with correct parameters', async () => {
      mockFoodService.getQueryHistory.mockResolvedValue([])

      await useFoodQueryStore.getState().fetchHistory('pet-002', 'user-003')

      expect(mockFoodService.getQueryHistory).toHaveBeenCalledWith('pet-002', 'user-003')
    })

    it('should set isLoading to true during request', async () => {
      let resolvePromise: (value: PetFoodQuery[]) => void
      const pendingPromise = new Promise<PetFoodQuery[]>((resolve) => {
        resolvePromise = resolve
      })
      mockFoodService.getQueryHistory.mockReturnValue(pendingPromise)

      const promise = useFoodQueryStore.getState().fetchHistory('pet-001', 'user-001')

      expect(useFoodQueryStore.getState().isLoading).toBe(true)

      resolvePromise!([])
      await promise

      expect(useFoodQueryStore.getState().isLoading).toBe(false)
    })

    it('should clear error before request', async () => {
      useFoodQueryStore.setState({ error: '之前的错误' })
      mockFoodService.getQueryHistory.mockResolvedValue([])

      await useFoodQueryStore.getState().fetchHistory('pet-001', 'user-001')

      expect(useFoodQueryStore.getState().error).toBeNull()
    })

    it('should set error with Error message on failure', async () => {
      mockFoodService.getQueryHistory.mockRejectedValue(new Error('服务器错误'))

      await useFoodQueryStore.getState().fetchHistory('pet-001', 'user-001')

      const state = useFoodQueryStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('服务器错误')
    })

    it('should set default error message for non-Error thrown value', async () => {
      mockFoodService.getQueryHistory.mockRejectedValue('timeout')

      await useFoodQueryStore.getState().fetchHistory('pet-001', 'user-001')

      const state = useFoodQueryStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('获取查询历史失败')
    })

    it('should replace existing history with fetched data', async () => {
      const existingQuery = makeFoodQuery({ id: 'fq_old' })
      useFoodQueryStore.setState({ history: [existingQuery] })

      const newHistory = [makeFoodQuery({ id: 'fq_new_001' }), makeFoodQuery({ id: 'fq_new_002' })]
      mockFoodService.getQueryHistory.mockResolvedValue(newHistory)

      await useFoodQueryStore.getState().fetchHistory('pet-001', 'user-001')

      const state = useFoodQueryStore.getState()
      expect(state.history).toHaveLength(2)
      expect(state.history[0].id).toBe('fq_new_001')
    })
  })

  describe('fetchStats', () => {
    it('should load stats on success', async () => {
      const mockStats = makeStats()
      mockFoodService.getQueryStats.mockResolvedValue(mockStats)

      await useFoodQueryStore.getState().fetchStats('pet-001', 'user-001')

      const state = useFoodQueryStore.getState()
      expect(state.stats).not.toBeNull()
      expect(state.stats!.totalQueries).toBe(10)
      expect(state.stats!.todayQueries).toBe(2)
      expect(state.stats!.remainingFree).toBe(3)
      expect(state.stats!.isMemberUser).toBe(false)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should call getQueryStats with correct parameters', async () => {
      mockFoodService.getQueryStats.mockResolvedValue(makeStats())

      await useFoodQueryStore.getState().fetchStats('pet-003', 'user-005')

      expect(mockFoodService.getQueryStats).toHaveBeenCalledWith('pet-003', 'user-005')
    })

    it('should set isLoading to true during request', async () => {
      let resolvePromise: (value: FoodQueryStats) => void
      const pendingPromise = new Promise<FoodQueryStats>((resolve) => {
        resolvePromise = resolve
      })
      mockFoodService.getQueryStats.mockReturnValue(pendingPromise)

      const promise = useFoodQueryStore.getState().fetchStats('pet-001', 'user-001')

      expect(useFoodQueryStore.getState().isLoading).toBe(true)

      resolvePromise!(makeStats())
      await promise

      expect(useFoodQueryStore.getState().isLoading).toBe(false)
    })

    it('should clear error before request', async () => {
      useFoodQueryStore.setState({ error: '之前的错误' })
      mockFoodService.getQueryStats.mockResolvedValue(makeStats())

      await useFoodQueryStore.getState().fetchStats('pet-001', 'user-001')

      expect(useFoodQueryStore.getState().error).toBeNull()
    })

    it('should set error with Error message on failure', async () => {
      mockFoodService.getQueryStats.mockRejectedValue(new Error('统计接口异常'))

      await useFoodQueryStore.getState().fetchStats('pet-001', 'user-001')

      const state = useFoodQueryStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('统计接口异常')
    })

    it('should set default error message for non-Error thrown value', async () => {
      mockFoodService.getQueryStats.mockRejectedValue(500)

      await useFoodQueryStore.getState().fetchStats('pet-001', 'user-001')

      const state = useFoodQueryStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('获取查询统计失败')
    })

    it('should replace existing stats with fetched data', async () => {
      const oldStats = makeStats({ totalQueries: 5 })
      useFoodQueryStore.setState({ stats: oldStats })

      const newStats = makeStats({ totalQueries: 20 })
      mockFoodService.getQueryStats.mockResolvedValue(newStats)

      await useFoodQueryStore.getState().fetchStats('pet-001', 'user-001')

      const state = useFoodQueryStore.getState()
      expect(state.stats!.totalQueries).toBe(20)
    })
  })

  describe('clearError', () => {
    it('should clear error', () => {
      useFoodQueryStore.setState({ error: '查询食物安全性失败' })

      useFoodQueryStore.getState().clearError()

      expect(useFoodQueryStore.getState().error).toBeNull()
    })

    it('should not affect other state when clearing error', () => {
      const query = makeFoodQuery()
      const stats = makeStats()
      useFoodQueryStore.setState({
        history: [query],
        lastResult: query,
        stats,
        isLoading: true,
        error: 'some error',
      })

      useFoodQueryStore.getState().clearError()

      const state = useFoodQueryStore.getState()
      expect(state.error).toBeNull()
      expect(state.history).toHaveLength(1)
      expect(state.lastResult).toBe(query)
      expect(state.stats).toBe(stats)
      expect(state.isLoading).toBe(true)
    })
  })
})
