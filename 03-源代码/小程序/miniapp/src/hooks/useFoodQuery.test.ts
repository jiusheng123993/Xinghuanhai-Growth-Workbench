/**
 * useFoodQuery 测试
 * 验证食物查询 Hook 的所有方法和返回值
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useFoodQuery } from './useFoodQuery'

const {
  mockQueryFood,
  mockFetchHistory,
  mockFetchStats,
  mockClearError,
} = vi.hoisted(() => ({
  mockQueryFood: vi.fn(),
  mockFetchHistory: vi.fn(),
  mockFetchStats: vi.fn(),
  mockClearError: vi.fn(),
}))

vi.mock('react', () => {
  const actual = { useCallback: (fn: any) => fn, useEffect: (fn: any) => fn() }
  return { ...actual, default: actual }
})

vi.mock('../stores/foodQueryStore', () => ({
  useFoodQueryStore: vi.fn(() => ({
    history: [],
    lastResult: null,
    stats: null,
    isLoading: false,
    error: null,
    queryFood: mockQueryFood,
    fetchHistory: mockFetchHistory,
    fetchStats: mockFetchStats,
    clearError: mockClearError,
  }))
}))

describe('useFoodQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('返回值包含所有预期字段', () => {
    const result = useFoodQuery()
    expect(result).toHaveProperty('history')
    expect(result).toHaveProperty('lastResult')
    expect(result).toHaveProperty('stats')
    expect(result).toHaveProperty('isLoading')
    expect(result).toHaveProperty('error')
    expect(result).toHaveProperty('queryFood')
    expect(result).toHaveProperty('fetchHistory')
    expect(result).toHaveProperty('fetchStats')
    expect(result).toHaveProperty('clearError')
  })

  it('queryFood 调用 store 的 queryFood', () => {
    const result = useFoodQuery()
    result.queryFood('user1', 'pet1', '苹果', 'dog')
    expect(mockQueryFood).toHaveBeenCalledWith('user1', 'pet1', '苹果', 'dog')
  })

  it('fetchHistory 调用 store 的 fetchHistory', () => {
    const result = useFoodQuery()
    result.fetchHistory('pet1', 'user1')
    expect(mockFetchHistory).toHaveBeenCalledWith('pet1', 'user1')
  })

  it('fetchStats 调用 store 的 fetchStats', () => {
    const result = useFoodQuery()
    result.fetchStats('pet1', 'user1')
    expect(mockFetchStats).toHaveBeenCalledWith('pet1', 'user1')
  })

  it('clearError 调用 store 的 clearError', () => {
    const result = useFoodQuery()
    result.clearError()
    expect(mockClearError).toHaveBeenCalled()
  })
})
