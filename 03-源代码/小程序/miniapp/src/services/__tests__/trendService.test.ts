/**
 * 健康趋势服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { api } from '../api'
import {
  getTrendData,
  getTrendSummary,
  getMonthlyReport,
  getWeightTrend,
  getAppetiteTrend,
  getStoolTrend,
  getAbnormalDays,
} from '../trendService'
import type { TrendDataPoint, TrendSummary } from '../trendService'
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

const mockGetCheckinsByDateRange = vi.fn()

vi.mock('../checkinService', () => ({
  getCheckinsByDateRange: (...args: unknown[]) => mockGetCheckinsByDateRange(...args),
}))

const today = new Date().toISOString().split('T')[0]

/**
 * 生成 n 天前的 Date（用于构造"窗口内"的打卡数据，避开本地计算按日期过滤的坑）
 * @param n - 距今的天数，0 表示今天
 */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000)
}

function makeCheckinEntry(overrides: Partial<PetHealthEntry> = {}): PetHealthEntry {
  return {
    id: 'checkin_001',
    petId: 'pet-001',
    userId: 'user-001',
    poopLevel: 3,
    appetiteLevel: 3,
    spiritLevel: 3,
    exerciseLevel: 2,
    weight: 10,
    hasAnomaly: false,
    anomalyItems: [],
    riskLevel: 'low',
    aiFeedback: '✅ 您的宠物今天状态不错！',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeTrendDataPoint(overrides: Partial<TrendDataPoint> = {}): TrendDataPoint {
  return {
    date: today,
    weight: 10,
    appetite: 'normal',
    energy: 'normal',
    stool: 'normal',
    vomiting: false,
    riskLevel: 'low',
    hasAbnormal: false,
    ...overrides,
  }
}

describe('trendService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    mockGetCheckinsByDateRange.mockReset()
  })

  describe('getTrendData', () => {
    it('should return trend data from checkins (本地计算主路径)', async () => {
      // 后端 /trends 契约不适配，趋势数据基于打卡记录接口（/checkins）本地映射
      const mockCheckins = [
        makeCheckinEntry(),
        makeCheckinEntry({ id: 'checkin_002', createdAt: new Date('2024-01-02T00:00:00.000Z'), weight: 11 }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(mockCheckins)

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(2)
      expect(result[0].date).toBe('2024-01-01')
      expect(result[0].weight).toBe(10)
      expect(mockGetCheckinsByDateRange).toHaveBeenCalledWith('pet-001', '', '2024-01-01', '2024-01-31')
      // 不应再调用不适配的 /trends 接口
      expect(api.get).not.toHaveBeenCalledWith(
        '/api/pets/pet-001/trends?startDate=2024-01-01&endDate=2024-01-31'
      )
    })

    it('should fallback to local storage when checkins fail', async () => {
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('Checkin error'))

      const localData = [makeTrendDataPoint({ date: '2024-01-01' })]
      mockStorage['xhh_trend_pet-001'] = JSON.stringify(localData)

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(1)
      expect(result[0].date).toBe('2024-01-01')
    })

    /**
     * 返回顺序必须是升序（旧 → 新）（2026-09-11 新增）
     *
     * 云端 `/checkins` 是 `ORDER BY created_at DESC`（新 → 旧），而消费端（趋势页）
     * 把 `points[0]` 当最早、`points[points.length - 1]` 当最新 —— 直接透传会让
     * 「最新体重」显示成最旧的、体重变化量符号取反、折线图 x 轴反向。
     * 这条用例喂**降序**输入，锁住"服务层负责排成升序"这个契约。
     */
    it('应按日期升序返回（不依赖接口返回顺序）', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([
        makeCheckinEntry({ id: 'c3', createdAt: new Date('2024-01-03T00:00:00.000Z') }),
        makeCheckinEntry({ id: 'c2', createdAt: new Date('2024-01-02T00:00:00.000Z') }),
        makeCheckinEntry({ id: 'c1', createdAt: new Date('2024-01-01T00:00:00.000Z') }),
      ])

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result.map((d) => d.date)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03'])
    })

    it('should return empty array when all sources fail with no local data', async () => {
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('Checkin error'))

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toEqual([])
    })
  })

  describe('getTrendSummary', () => {
    it('should build trend summary from checkins (本地计算主路径)', async () => {
      // 后端未实现 /trends/summary 接口，摘要统一由打卡数据本地计算
      // 注意：窗口为最近一个月，mock 打卡日期须落在窗口内
      const mockCheckins = [
        makeCheckinEntry({ createdAt: daysAgo(1) }),
        makeCheckinEntry({ id: 'checkin_002', createdAt: daysAgo(2), weight: 11 }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(mockCheckins)

      const result = await getTrendSummary('pet-001', 'month')

      expect(result.petId).toBe('pet-001')
      expect(result.period).toBe('month')
      expect(result.totalDays).toBe(2)
      expect(result.weightTrend).toBeDefined()
      expect(result.aiAnalysis).toBeTruthy()
      // 不应再调用不适配的 /trends/summary 接口
      expect(api.get).not.toHaveBeenCalledWith('/api/pets/pet-001/trends/summary?period=month')
    })

    it('should handle empty checkins', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([])

      const result = await getTrendSummary('pet-001', 'month')

      expect(result.totalDays).toBe(0)
      expect(result.aiAnalysis).toContain('暂无足够数据')
    })

    it('should handle week period', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([])

      const result = await getTrendSummary('pet-001', 'week')

      expect(result.period).toBe('week')
      expect(result.totalDays).toBe(0)
    })

    it('should handle quarter period', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([])

      const result = await getTrendSummary('pet-001', 'quarter')

      expect(result.period).toBe('quarter')
      expect(result.totalDays).toBe(0)
    })
  })

  describe('getMonthlyReport', () => {
    it('should build monthly report from checkins (本地计算主路径)', async () => {
      // 后端 /trends/report 参数契约不适配（year+month 数字），月报统一本地生成
      const mockCheckins = [
        makeCheckinEntry(),
        makeCheckinEntry({ id: 'checkin_002', createdAt: new Date('2024-01-15T00:00:00.000Z'), weight: 10.5 }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(mockCheckins)

      const result = await getMonthlyReport('pet-001', '2024-01')

      expect(result.petId).toBe('pet-001')
      expect(result.month).toBe('2024-01')
      expect(result.summary).toBeDefined()
      expect(result.highlights).toBeDefined()
      expect(result.concerns).toBeDefined()
      expect(result.recommendations).toBeDefined()
      // 不应再调用不适配的 /trends/report 接口
      expect(api.get).not.toHaveBeenCalledWith('/api/pets/pet-001/trends/report?month=2024-01')
    })

    it('should handle month with 31 days', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([])

      const result = await getMonthlyReport('pet-001', '2024-01')

      expect(result.month).toBe('2024-01')
      expect(result.summary.totalDays).toBe(0)
    })

    it('should handle February', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([])

      const result = await getMonthlyReport('pet-001', '2024-02')

      expect(result.month).toBe('2024-02')
    })
  })

  describe('getWeightTrend', () => {
    it('should return only data points with weight', async () => {
      // 窗口为最近 3 个月，打卡日期用相对日期保证落在窗口内
      const mockCheckins = [
        makeCheckinEntry({ createdAt: daysAgo(3), weight: 10 }),
        makeCheckinEntry({ id: 'checkin_002', createdAt: daysAgo(2), weight: undefined }),
        makeCheckinEntry({ id: 'checkin_003', createdAt: daysAgo(1), weight: 11 }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(mockCheckins)

      const result = await getWeightTrend('pet-001', 3)

      expect(result).toHaveLength(2)
      expect(result[0].weight).toBe(10)
      expect(result[1].weight).toBe(11)
    })

    it('should return empty array when no weight data', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([
        makeCheckinEntry({ createdAt: daysAgo(1), weight: undefined }),
      ])

      const result = await getWeightTrend('pet-001', 3)

      expect(result).toEqual([])
    })
  })

  describe('getAppetiteTrend', () => {
    it('should return only data points with appetite', async () => {
      const mockCheckins = [
        makeCheckinEntry({ createdAt: daysAgo(2), appetiteLevel: 3 }),
        makeCheckinEntry({ id: 'checkin_002', createdAt: daysAgo(1), appetiteLevel: 2 }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(mockCheckins)

      const result = await getAppetiteTrend('pet-001', 3)

      expect(result).toHaveLength(2)
      expect(result[0].appetite).toBe('normal')
      expect(result[1].appetite).toBe('decreased')
    })

    it('should return empty array when no appetite data', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([])

      const result = await getAppetiteTrend('pet-001', 3)

      expect(result).toEqual([])
    })
  })

  describe('getStoolTrend', () => {
    it('should return only data points with stool', async () => {
      const mockCheckins = [
        makeCheckinEntry({ createdAt: daysAgo(2), poopLevel: 3 }),
        makeCheckinEntry({ id: 'checkin_002', createdAt: daysAgo(1), poopLevel: 4 }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(mockCheckins)

      const result = await getStoolTrend('pet-001', 3)

      expect(result).toHaveLength(2)
      expect(result[0].stool).toBe('normal')
      expect(result[1].stool).toBe('soft')
    })

    it('should return empty array when no stool data', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([])

      const result = await getStoolTrend('pet-001', 3)

      expect(result).toEqual([])
    })
  })

  describe('getAbnormalDays', () => {
    it('should return only abnormal data points', async () => {
      // 窗口为 2024-01-01 ~ 2024-01-31，mock 打卡日期需落在窗口内
      const mockCheckins = [
        makeCheckinEntry({ createdAt: new Date('2024-01-01T00:00:00.000Z'), riskLevel: 'low' }),
        makeCheckinEntry({ id: 'c2', createdAt: new Date('2024-01-02T00:00:00.000Z'), riskLevel: 'high' }),
        makeCheckinEntry({ id: 'c3', createdAt: new Date('2024-01-03T00:00:00.000Z'), riskLevel: 'emergency' }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(mockCheckins)

      const result = await getAbnormalDays('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(2)
      expect(result[0].hasAbnormal).toBe(true)
      expect(result[1].hasAbnormal).toBe(true)
    })

    it('should return empty array when no abnormal days', async () => {
      const mockCheckins = [
        makeCheckinEntry({ createdAt: new Date('2024-01-01T00:00:00.000Z'), riskLevel: 'low' }),
        makeCheckinEntry({ id: 'c2', createdAt: new Date('2024-01-02T00:00:00.000Z'), riskLevel: 'low' }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(mockCheckins)

      const result = await getAbnormalDays('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toEqual([])
    })
  })

  describe('AI analysis rules', () => {
    it('should detect weight increase > 20% as concern', async () => {
      // 窗口为最近一个月，打卡日期用相对日期（daysAgo）保证落在窗口内
      const checkins = [
        makeCheckinEntry({ createdAt: daysAgo(30), weight: 10 }),
        makeCheckinEntry({ id: 'checkin_002', createdAt: daysAgo(1), weight: 13 }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(checkins)

      const result = await getTrendSummary('pet-001', 'month')

      expect(result.weightTrend).toBe('increasing')
      expect(result.weightChangePercent).toBe(30)
      expect(result.aiAnalysis).toContain('增幅较大')
    })

    it('should detect weight decrease > 20% as concern', async () => {
      const checkins = [
        makeCheckinEntry({ createdAt: daysAgo(30), weight: 10 }),
        makeCheckinEntry({ id: 'checkin_002', createdAt: daysAgo(1), weight: 7 }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(checkins)

      const result = await getTrendSummary('pet-001', 'month')

      expect(result.weightTrend).toBe('decreasing')
      expect(result.weightChangePercent).toBe(-30)
      expect(result.aiAnalysis).toContain('降幅较大')
    })

    it('should detect bloody stool as emergency', async () => {
      const checkins = [
        makeCheckinEntry({ createdAt: daysAgo(1), poopLevel: 1, riskLevel: 'emergency' }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(checkins)

      const result = await getTrendSummary('pet-001', 'month')

      expect(result.stoolStats['bloody']).toBe(1)
      expect(result.aiAnalysis).toContain('便血')
      expect(result.aiAnalysis).toContain('紧急信号')
    })

    it('should detect consecutive appetite loss', async () => {
      const checkins = [
        makeCheckinEntry({ id: 'c1', createdAt: daysAgo(3), appetiteLevel: 1, riskLevel: 'high' }),
        makeCheckinEntry({ id: 'c2', createdAt: daysAgo(2), appetiteLevel: 1, riskLevel: 'high' }),
        makeCheckinEntry({ id: 'c3', createdAt: daysAgo(1), appetiteLevel: 1, riskLevel: 'high' }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(checkins)

      const result = await getTrendSummary('pet-001', 'month')

      expect(result.aiAnalysis).toContain('连续3天以上完全不吃东西')
    })

    it('should handle empty data gracefully', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue([])

      const result = await getTrendSummary('pet-001', 'month')

      expect(result.totalDays).toBe(0)
      expect(result.aiAnalysis).toContain('暂无足够数据')
    })

    it('should handle single data point', async () => {
      const checkins = [makeCheckinEntry({ createdAt: daysAgo(1) })]
      mockGetCheckinsByDateRange.mockResolvedValue(checkins)

      const result = await getTrendSummary('pet-001', 'month')

      expect(result.totalDays).toBe(1)
      expect(result.weightTrend).toBe('stable')
      expect(result.weightChange).toBe(0)
    })

    it('should detect abnormal ratio > 30%', async () => {
      const checkins = [
        makeCheckinEntry({ id: 'c1', createdAt: daysAgo(5), riskLevel: 'low' }),
        makeCheckinEntry({ id: 'c2', createdAt: daysAgo(4), riskLevel: 'low' }),
        makeCheckinEntry({ id: 'c3', createdAt: daysAgo(3), riskLevel: 'low' }),
        makeCheckinEntry({ id: 'c4', createdAt: daysAgo(2), appetiteLevel: 1, riskLevel: 'high' }),
        makeCheckinEntry({ id: 'c5', createdAt: daysAgo(1), poopLevel: 1, riskLevel: 'high' }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(checkins)

      const result = await getTrendSummary('pet-001', 'month')

      expect(result.abnormalDays).toBe(2)
      expect(result.aiAnalysis).toContain('异常天数占比较高')
    })
  })

  describe('monthly report generation', () => {
    it('should generate highlights for healthy pet', async () => {
      // getMonthlyReport('pet-001', '2024-01') 的窗口为 2024-01 整月，打卡日期落在窗口内
      const checkins = Array.from({ length: 10 }, (_, i) =>
        makeCheckinEntry({
          id: `c${i}`,
          createdAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
        })
      )
      mockGetCheckinsByDateRange.mockResolvedValue(checkins)

      const result = await getMonthlyReport('pet-001', '2024-01')

      expect(result.highlights).toContain('体重保持稳定')
      expect(result.highlights).toContain('食欲整体良好')
      expect(result.highlights).toContain('排便情况正常')
      expect(result.highlights).toContain('整体健康状况优秀')
    })

    it('should generate concerns for unhealthy pet', async () => {
      const checkins = [
        makeCheckinEntry({ id: 'c1', createdAt: new Date('2024-01-01T00:00:00.000Z'), weight: 10 }),
        makeCheckinEntry({ id: 'c2', createdAt: new Date('2024-01-30T00:00:00.000Z'), weight: 13 }),
        makeCheckinEntry({ id: 'c3', createdAt: new Date('2024-01-15T00:00:00.000Z'), appetiteLevel: 1, riskLevel: 'high' }),
        makeCheckinEntry({ id: 'c4', createdAt: new Date('2024-01-20T00:00:00.000Z'), poopLevel: 1, riskLevel: 'emergency' }),
      ]
      mockGetCheckinsByDateRange.mockResolvedValue(checkins)

      const result = await getMonthlyReport('pet-001', '2024-01')

      expect(result.concerns.length).toBeGreaterThan(0)
      expect(result.concerns.some((c) => c.includes('便血'))).toBe(true)
      expect(result.recommendations.some((r) => r.includes('便血'))).toBe(true)
    })

    it('should recommend more data when data is sparse', async () => {
      const checkins = [makeCheckinEntry({ createdAt: new Date('2024-01-01T00:00:00.000Z') })]
      mockGetCheckinsByDateRange.mockResolvedValue(checkins)

      const result = await getMonthlyReport('pet-001', '2024-01')

      expect(result.recommendations.some((r) => r.includes('数据量较少'))).toBe(true)
    })
  })
})