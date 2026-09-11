/**
 * useTrend 测试
 * 验证健康趋势 Hook 的所有方法和 Store 调用
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useTrend } from './useTrend'

const {
  mockFetchWeightTrend,
  mockFetchAppetiteTrend,
  mockFetchStoolTrend,
  mockFetchSummary,
  mockFetchMonthlyReport,
  mockUseTrendStoreFn,
} = vi.hoisted(() => {
  const mockStoreState = {
    trendData: [],
    summary: null,
    monthlyReport: null,
    isLoading: false,
    error: null,
    fetchTrendData: vi.fn(),
    fetchSummary: vi.fn(),
    fetchMonthlyReport: vi.fn(),
    fetchWeightTrend: vi.fn(),
    fetchAppetiteTrend: vi.fn(),
    fetchStoolTrend: vi.fn(),
    clearError: vi.fn(),
  }

  function mockUseTrendStore(selector: any) {
    if (typeof selector === 'function') {
      return selector(mockStoreState)
    }
    return mockStoreState
  }
  mockUseTrendStore.getState = () => mockStoreState

  const fn = vi.fn().mockImplementation(mockUseTrendStore)
  Object.assign(fn, { getState: mockUseTrendStore.getState })

  return {
    mockFetchWeightTrend: mockStoreState.fetchWeightTrend,
    mockFetchAppetiteTrend: mockStoreState.fetchAppetiteTrend,
    mockFetchStoolTrend: mockStoreState.fetchStoolTrend,
    mockFetchSummary: mockStoreState.fetchSummary,
    mockFetchMonthlyReport: mockStoreState.fetchMonthlyReport,
    mockUseTrendStoreFn: fn,
  }
})

vi.mock('react', () => {
  const actual = { useCallback: (fn: any) => fn, useEffect: (fn: any) => fn() }
  return { ...actual, default: actual }
})

vi.mock('../stores/trendStore', () => ({
  useTrendStore: mockUseTrendStoreFn
}))

describe('useTrend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('返回值包含所有预期字段', () => {
    const result = useTrend()
    expect(result).toHaveProperty('trendData')
    expect(result).toHaveProperty('summary')
    expect(result).toHaveProperty('monthlyReport')
    expect(result).toHaveProperty('isLoading')
    expect(result).toHaveProperty('error')
    expect(result).toHaveProperty('fetchTrendData')
    expect(result).toHaveProperty('fetchSummary')
    expect(result).toHaveProperty('fetchMonthlyReport')
    expect(result).toHaveProperty('fetchWeightTrend')
    expect(result).toHaveProperty('fetchAppetiteTrend')
    expect(result).toHaveProperty('fetchStoolTrend')
    expect(result).toHaveProperty('clearError')
  })

  it('fetchWeightTrend 调用 store 的 fetchWeightTrend', () => {
    const result = useTrend()
    result.fetchWeightTrend('pet1', 3)
    expect(mockFetchWeightTrend).toHaveBeenCalledWith('pet1', 3)
  })

  it('fetchAppetiteTrend 调用 store 的 fetchAppetiteTrend', () => {
    const result = useTrend()
    result.fetchAppetiteTrend('pet1', 3)
    expect(mockFetchAppetiteTrend).toHaveBeenCalledWith('pet1', 3)
  })

  it('fetchStoolTrend 调用 store 的 fetchStoolTrend', () => {
    const result = useTrend()
    result.fetchStoolTrend('pet1', 3)
    expect(mockFetchStoolTrend).toHaveBeenCalledWith('pet1', 3)
  })

  it('fetchSummary 调用 store 的 fetchSummary', () => {
    const result = useTrend()
    result.fetchSummary('pet1', 'month')
    expect(mockFetchSummary).toHaveBeenCalledWith('pet1', 'month')
  })

  it('fetchMonthlyReport 调用 store 的 fetchMonthlyReport', () => {
    const result = useTrend()
    result.fetchMonthlyReport('pet1', '2024-03')
    expect(mockFetchMonthlyReport).toHaveBeenCalledWith('pet1', '2024-03')
  })
})
