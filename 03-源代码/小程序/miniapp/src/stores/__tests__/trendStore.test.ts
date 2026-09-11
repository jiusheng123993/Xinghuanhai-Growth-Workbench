/**
 * 健康趋势状态管理 - 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useTrendStore } from '../trendStore'
import type { TrendDataPoint, TrendSummary, MonthlyReport } from '../../services/trendService'

const { mockTrendService } = vi.hoisted(() => {
  return {
    mockTrendService: {
      getTrendData: vi.fn(),
      getTrendSummary: vi.fn(),
      getMonthlyReport: vi.fn(),
      getWeightTrend: vi.fn(),
      getAppetiteTrend: vi.fn(),
      getStoolTrend: vi.fn(),
      getAbnormalDays: vi.fn(),
    },
  }
})

vi.mock('../../services/trendService', () => mockTrendService)

const today = new Date().toISOString().split('T')[0]

function makeTrendDataPoint(overrides: Partial<TrendDataPoint> = {}): TrendDataPoint {
  return {
    date: today,
    weight: 10,
    appetite: 'normal',
    energy: 'normal',
    stool: 'normal',
    vomiting: false,
    riskLevel: 'low' as const,
    hasAbnormal: false,
    ...overrides,
  }
}

function makeTrendSummary(overrides: Partial<TrendSummary> = {}): TrendSummary {
  return {
    petId: 'pet-001',
    period: 'month',
    weightTrend: 'stable',
    weightChange: 0,
    weightChangePercent: 0,
    appetiteStats: { normal: 10, decreased: 0, increased: 0, none: 0 },
    stoolStats: { normal: 10, soft: 0, diarrhea: 0, constipation: 0, bloody: 0 },
    abnormalDays: 0,
    totalDays: 10,
    aiAnalysis: '体重保持稳定，这是健康的好迹象。',
    ...overrides,
  }
}

function makeMonthlyReport(overrides: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    petId: 'pet-001',
    month: '2024-01',
    summary: makeTrendSummary(),
    highlights: ['体重保持稳定'],
    concerns: [],
    recommendations: [],
    ...overrides,
  }
}

describe('trendStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTrendStore.setState({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('should have empty trendData', () => {
      const state = useTrendStore.getState()
      expect(state.trendData).toEqual([])
    })

    it('should have null summary', () => {
      const state = useTrendStore.getState()
      expect(state.summary).toBeNull()
    })

    it('should have null monthlyReport', () => {
      const state = useTrendStore.getState()
      expect(state.monthlyReport).toBeNull()
    })

    it('should have isLoading as false', () => {
      const state = useTrendStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have null error', () => {
      const state = useTrendStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('fetchTrendData', () => {
    it('should load trend data', async () => {
      const mockData = [makeTrendDataPoint(), makeTrendDataPoint({ date: '2024-01-02' })]
      mockTrendService.getTrendData.mockResolvedValue(mockData)

      await useTrendStore.getState().fetchTrendData('pet-001', '2024-01-01', '2024-01-31')

      const state = useTrendStore.getState()
      expect(state.trendData).toHaveLength(2)
      expect(state.trendData[0].date).toBe(today)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
      expect(mockTrendService.getTrendData).toHaveBeenCalledWith('pet-001', '2024-01-01', '2024-01-31', '')
    })

    it('should set error when fetch fails', async () => {
      mockTrendService.getTrendData.mockRejectedValue(new Error('Network error'))

      await useTrendStore.getState().fetchTrendData('pet-001', '2024-01-01', '2024-01-31')

      const state = useTrendStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Network error')
    })

    it('should set default error message for non-Error throws', async () => {
      mockTrendService.getTrendData.mockRejectedValue('unknown error')

      await useTrendStore.getState().fetchTrendData('pet-001', '2024-01-01', '2024-01-31')

      const state = useTrendStore.getState()
      expect(state.error).toBe('获取趋势数据失败')
    })
  })

  describe('fetchSummary', () => {
    it('should load trend summary', async () => {
      const mockSummary = makeTrendSummary()
      mockTrendService.getTrendSummary.mockResolvedValue(mockSummary)

      await useTrendStore.getState().fetchSummary('pet-001', 'month')

      const state = useTrendStore.getState()
      expect(state.summary).not.toBeNull()
      expect(state.summary!.petId).toBe('pet-001')
      expect(state.summary!.period).toBe('month')
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
      expect(mockTrendService.getTrendSummary).toHaveBeenCalledWith('pet-001', 'month', '')
    })

    it('should set error when fetch fails', async () => {
      mockTrendService.getTrendSummary.mockRejectedValue(new Error('Summary error'))

      await useTrendStore.getState().fetchSummary('pet-001', 'month')

      const state = useTrendStore.getState()
      expect(state.error).toBe('Summary error')
    })
  })

  describe('fetchMonthlyReport', () => {
    it('should load monthly report', async () => {
      const mockReport = makeMonthlyReport()
      mockTrendService.getMonthlyReport.mockResolvedValue(mockReport)

      await useTrendStore.getState().fetchMonthlyReport('pet-001', '2024-01')

      const state = useTrendStore.getState()
      expect(state.monthlyReport).not.toBeNull()
      expect(state.monthlyReport!.petId).toBe('pet-001')
      expect(state.monthlyReport!.month).toBe('2024-01')
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
      expect(mockTrendService.getMonthlyReport).toHaveBeenCalledWith('pet-001', '2024-01', '')
    })

    it('should set error when fetch fails', async () => {
      mockTrendService.getMonthlyReport.mockRejectedValue(new Error('Report error'))

      await useTrendStore.getState().fetchMonthlyReport('pet-001', '2024-01')

      const state = useTrendStore.getState()
      expect(state.error).toBe('Report error')
    })
  })

  describe('fetchWeightTrend', () => {
    it('should load weight trend data', async () => {
      const mockData = [makeTrendDataPoint({ weight: 10 }), makeTrendDataPoint({ date: '2024-01-02', weight: 11 })]
      mockTrendService.getWeightTrend.mockResolvedValue(mockData)

      await useTrendStore.getState().fetchWeightTrend('pet-001', 3)

      const state = useTrendStore.getState()
      expect(state.trendData).toHaveLength(2)
      expect(state.isLoading).toBe(false)
      expect(mockTrendService.getWeightTrend).toHaveBeenCalledWith('pet-001', 3, '')
    })

    it('should use default months value', async () => {
      mockTrendService.getWeightTrend.mockResolvedValue([])

      await useTrendStore.getState().fetchWeightTrend('pet-001')

      expect(mockTrendService.getWeightTrend).toHaveBeenCalledWith('pet-001', 3, '')
    })

    it('should set error when fetch fails', async () => {
      mockTrendService.getWeightTrend.mockRejectedValue(new Error('Weight error'))

      await useTrendStore.getState().fetchWeightTrend('pet-001')

      const state = useTrendStore.getState()
      expect(state.error).toBe('Weight error')
    })
  })

  describe('fetchAppetiteTrend', () => {
    it('should load appetite trend data', async () => {
      const mockData = [makeTrendDataPoint({ appetite: 'normal' })]
      mockTrendService.getAppetiteTrend.mockResolvedValue(mockData)

      await useTrendStore.getState().fetchAppetiteTrend('pet-001', 6)

      const state = useTrendStore.getState()
      expect(state.trendData).toHaveLength(1)
      expect(mockTrendService.getAppetiteTrend).toHaveBeenCalledWith('pet-001', 6, '')
    })

    it('should set error when fetch fails', async () => {
      mockTrendService.getAppetiteTrend.mockRejectedValue(new Error('Appetite error'))

      await useTrendStore.getState().fetchAppetiteTrend('pet-001')

      const state = useTrendStore.getState()
      expect(state.error).toBe('Appetite error')
    })
  })

  describe('fetchStoolTrend', () => {
    it('should load stool trend data', async () => {
      const mockData = [makeTrendDataPoint({ stool: 'normal' })]
      mockTrendService.getStoolTrend.mockResolvedValue(mockData)

      await useTrendStore.getState().fetchStoolTrend('pet-001')

      const state = useTrendStore.getState()
      expect(state.trendData).toHaveLength(1)
      expect(mockTrendService.getStoolTrend).toHaveBeenCalledWith('pet-001', 3, '')
    })

    it('should set error when fetch fails', async () => {
      mockTrendService.getStoolTrend.mockRejectedValue(new Error('Stool error'))

      await useTrendStore.getState().fetchStoolTrend('pet-001')

      const state = useTrendStore.getState()
      expect(state.error).toBe('Stool error')
    })
  })

  describe('fetchAbnormalDays', () => {
    it('should load abnormal days data', async () => {
      const mockData = [makeTrendDataPoint({ hasAbnormal: true, riskLevel: 'high' as const })]
      mockTrendService.getAbnormalDays.mockResolvedValue(mockData)

      await useTrendStore.getState().fetchAbnormalDays('pet-001', '2024-01-01', '2024-01-31')

      const state = useTrendStore.getState()
      expect(state.trendData).toHaveLength(1)
      expect(state.trendData[0].hasAbnormal).toBe(true)
      expect(mockTrendService.getAbnormalDays).toHaveBeenCalledWith('pet-001', '2024-01-01', '2024-01-31', '')
    })

    it('should set error when fetch fails', async () => {
      mockTrendService.getAbnormalDays.mockRejectedValue(new Error('Abnormal error'))

      await useTrendStore.getState().fetchAbnormalDays('pet-001', '2024-01-01', '2024-01-31')

      const state = useTrendStore.getState()
      expect(state.error).toBe('Abnormal error')
    })
  })

  describe('clearError', () => {
    it('should clear error', () => {
      useTrendStore.setState({ error: 'Some error' })

      useTrendStore.getState().clearError()

      const state = useTrendStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      useTrendStore.setState({
        trendData: [makeTrendDataPoint()],
        summary: makeTrendSummary(),
        monthlyReport: makeMonthlyReport(),
        isLoading: true,
        error: 'Some error',
      })

      useTrendStore.getState().reset()

      const state = useTrendStore.getState()
      expect(state.trendData).toEqual([])
      expect(state.summary).toBeNull()
      expect(state.monthlyReport).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })
})