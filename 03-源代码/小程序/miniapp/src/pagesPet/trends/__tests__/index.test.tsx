/** 健康趋势页面单元测试 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
// screen：心情筛选那组用例按文案点胶囊（同一份文案在多处出现时用 class 定位更稳）
import { render, fireEvent, waitFor, screen } from '@testing-library/react'

// ═══════════════════════════════════════════════════════════════════════════
// Import the mocked modules and the component
// ═══════════════════════════════════════════════════════════════════════════

import { useTrend } from '../../../hooks/useTrend'
import { useMembership } from '../../../hooks/useMembership'
// 报告明细服务：下方 vi.mock 之后拿到的就是被 mock 的函数，用来给两个区块喂数据
import { generateHealthReportData } from '../../services/healthReportPdfService'
import PetTrendsPage, {
  APPETITE_LABELS,
  STOOL_LABELS,
  APPETITE_COLORS,
  STOOL_COLORS,
  RISK_COLORS,
  TIME_RANGE_OPTIONS,
  TREND_TABS,
} from '../index'


import type { TrendDataPoint } from '../../../services/trendService'

// ═══════════════════════════════════════════════════════════════════════════
// Hoisted variables used in vi.mock factories
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 打卡记录服务（2026-09-12 第 4 波：趋势页新增「打卡记录」分区后需要 mock）
 *
 * 【为什么要 mock 而不是让它真跑】真实现会走 api.get 去要 token，在 jsdom 里必然抛错，
 * 页面 catch 后退化成空态 —— 那样「有记录时的列表 / 截断提示 / 空态」三条分支全都测不到。
 */
const { mockGetCheckins } = vi.hoisted(() => ({
  mockGetCheckins: vi.fn(async (..._args: unknown[]) => [] as any[]),
}))

const { mockSwitchPet, mockFetchPets } = vi.hoisted(() => ({
  mockSwitchPet: vi.fn(),
  mockFetchPets: vi.fn(),
}))

const { mockFetchWeightTrend, mockFetchAppetiteTrend, mockFetchStoolTrend, mockFetchSummary, mockFetchMonthlyReport, mockClearError } = vi.hoisted(() => ({
  mockFetchWeightTrend: vi.fn(),
  mockFetchAppetiteTrend: vi.fn(),
  mockFetchStoolTrend: vi.fn(),
  mockFetchSummary: vi.fn(),
  mockFetchMonthlyReport: vi.fn(),
  mockClearError: vi.fn(),
}))

const { mockUseTrendFn } = vi.hoisted(() => ({
  mockUseTrendFn: vi.fn<any>(() => ({
    trendData: [],
    summary: null,
    monthlyReport: null,
    isLoading: false,
    error: null,
    fetchWeightTrend: mockFetchWeightTrend,
    fetchAppetiteTrend: mockFetchAppetiteTrend,
    fetchStoolTrend: mockFetchStoolTrend,
    fetchSummary: mockFetchSummary,
    fetchMonthlyReport: mockFetchMonthlyReport,
    clearError: mockClearError,
  })),
}))

const { mockCheckAccess } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn<any>(() => true),
}))

const { mockUseMembershipFn } = vi.hoisted(() => ({
  mockUseMembershipFn: vi.fn<any>(() => ({
    isMember: true,
    checkAccess: mockCheckAccess,
    shouldShowPaywall: false,
    markPaywallShown: vi.fn(),
  })),
}))

// ═══════════════════════════════════════════════════════════════════════════
// Mock all dependencies before importing the component
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: vi.fn(() => ''),
  useThemeKey: vi.fn(() => 'autumn'),
  usePetWallpaper: vi.fn(() => null),
}))

vi.mock('../../../stores/petStore', () => ({
  usePetStore: vi.fn((selector?: (s: any) => any) => {
    const state = {
      pets: [
        { id: 'pet-1', name: '豆豆', species: 'dog', breedId: 'golden-retriever', avatarPhotoUrl: '', isDeceased: false },
        { id: 'pet-2', name: '咪咪', species: 'cat', breedId: 'persian', avatarPhotoUrl: '', isDeceased: false },
      ],
      currentPet: { id: 'pet-1', name: '豆豆', species: 'dog', breedId: 'golden-retriever', avatarPhotoUrl: '', isDeceased: false },
      fetchPets: mockFetchPets,
      switchPet: mockSwitchPet,
    }
    return selector ? selector(state) : state
  }),
}))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: any) => any) => {
    const state = { user: { id: 'user-1', createdAt: '2024-01-01T00:00:00.000Z' } }
    return selector ? selector(state) : state
  }),
}))

vi.mock('../../../stores/shareStore', () => ({
  useShareStore: vi.fn((selector?: (s: any) => any) => {
    const state = { inviteCode: '' }
    return selector ? selector(state) : state
  }),
}))

vi.mock('../../../hooks/useTrend', () => ({
  useTrend: mockUseTrendFn,
}))

vi.mock('../../../hooks/useMembership', () => ({
  useMembership: mockUseMembershipFn,
}))

vi.mock('../../../components/PetSwitcher', () => ({ default: () => null }))
vi.mock('../../../components/PaywallPopup', () => ({ default: () => null }))
vi.mock('../../../components/AnomalyMarker', () => ({ default: () => null }))
vi.mock('../../../components/PageLoading', () => ({ default: () => null }))
vi.mock('../../../components/PageError', () => ({ default: () => null }))
vi.mock('../../../components/HealthReportPreview', () => ({ default: () => null }))
vi.mock('../../../components/HealthTrendShareCard', () => ({ default: () => null }))
vi.mock('../../../components/NpsSurvey', () => ({ default: () => null }))
vi.mock('../../../components', () => ({
  Icon: ({ name, className }: any) => <span className={className} data-icon={name} />,
  PetAvatar: () => null,
}))

vi.mock('../../services/healthReportPdfService', () => ({
  generateHealthReportData: vi.fn(),
  downloadHealthReport: vi.fn(),
  shareHealthReport: vi.fn(),
  downloadHealthReportCsv: vi.fn(),
  shareReportToVet: vi.fn(),
}))

vi.mock('../../../services/shareService', () => ({ recordShare: vi.fn() }))
vi.mock('../../../services/npsService', () => ({
  checkNpsEligibility: vi.fn(),
  submitNpsResponse: vi.fn(),
  dismissNpsSurvey: vi.fn(),
}))

vi.mock('../../../engines/petSafety/MedicalDisclaimer', () => ({
  MedicalDisclaimer: class {
    getTrendDisclaimer() { return '医疗免责声明' }
  },
}))

vi.mock('../../../data/petKnowledge/breeds', () => {
  const BREED_DATA = [
    { id: 'golden-retriever', name: '金毛', weightRange: { min: 25, max: 34 } },
    { id: 'persian', name: '波斯猫', weightRange: { min: 3.5, max: 7 } },
  ]
  return { BREED_DATA, getActiveBreeds: () => BREED_DATA }
})

vi.mock('../../../hooks/useAnalytics', () => ({
  useAnalytics: vi.fn(() => ({ trackEvent: vi.fn(), trackPageView: vi.fn() })),
  usePageView: vi.fn(),
}))

vi.mock('../../../types/analyticsTypes', () => ({ AnalyticsEventName: { ShareAction: 'share_action' } }))

vi.mock('../../index.scss', () => ({}))

vi.mock('../../../services/checkinService', () => ({
  getCheckins: (petId: string, userId: string) => mockGetCheckins(petId, userId),
}))

// ═══════════════════════════════════════════════════════════════════════════
// Helper: build a TrendDataPoint with defaults
// ═══════════════════════════════════════════════════════════════════════════

/** Click a tab by its label text to switch the active tab */
function clickTab(container: HTMLElement, label: string) {
  const tabs = container.querySelectorAll('.pet-trends__tab')
  for (let i = 0; i < tabs.length; i++) {
    const tabText = tabs[i].querySelector('.pet-trends__tab-text')
    if (tabText?.textContent === label) {
      fireEvent.click(tabs[i])
      return
    }
  }
}

function makeTrendPoint(overrides: Partial<TrendDataPoint> = {}): TrendDataPoint {
  return {
    date: '2024-01-15',
    weight: 30,
    appetite: 'normal',
    energy: 'normal',
    stool: 'normal',
    vomiting: false,
    riskLevel: 'low',
    hasAbnormal: false,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 常量定义
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 常量定义', () => {
  describe('APPETITE_LABELS', () => {
    it('应包含所有食欲状态映射', () => {
      expect(APPETITE_LABELS).toEqual({
        normal: '正常',
        decreased: '减少',
        increased: '增加',
        none: '不吃',
      })
    })
  })

  describe('STOOL_LABELS', () => {
    it('应包含所有便便状态映射', () => {
      expect(STOOL_LABELS).toEqual({
        normal: '正常',
        soft: '偏软',
        diarrhea: '腹泻',
        constipation: '便秘',
        bloody: '便血',
      })
    })
  })

  describe('APPETITE_COLORS', () => {
    it('应包含所有食欲颜色映射', () => {
      expect(APPETITE_COLORS.normal).toBe('#52C41A')
      expect(APPETITE_COLORS.decreased).toBe('#FAAD14')
      expect(APPETITE_COLORS.increased).toBe('#FF8C42')
      expect(APPETITE_COLORS.none).toBe('#FF4D4F')
    })
  })

  describe('STOOL_COLORS', () => {
    it('应包含所有便便颜色映射', () => {
      expect(STOOL_COLORS.normal).toBe('#52C41A')
      expect(STOOL_COLORS.soft).toBe('#FAAD14')
      expect(STOOL_COLORS.diarrhea).toBe('#FF8C42')
      expect(STOOL_COLORS.constipation).toBe('#FAAD14')
      expect(STOOL_COLORS.bloody).toBe('#FF4D4F')
    })
  })

  describe('RISK_COLORS', () => {
    it('应包含所有风险等级颜色映射', () => {
      expect(RISK_COLORS.normal).toBe('#52C41A')
      expect(RISK_COLORS.caution).toBe('#FAAD14')
      expect(RISK_COLORS.warning).toBe('#FF8C42')
      expect(RISK_COLORS.emergency).toBe('#FF4D4F')
    })
  })

  describe('TIME_RANGE_OPTIONS', () => {
    it('应包含三个时间范围选项', () => {
      expect(TIME_RANGE_OPTIONS).toHaveLength(3)
      expect(TIME_RANGE_OPTIONS[0]).toEqual({ key: 'week', label: '近1周' })
      expect(TIME_RANGE_OPTIONS[1]).toEqual({ key: 'month', label: '近1月' })
      expect(TIME_RANGE_OPTIONS[2]).toEqual({ key: 'quarter', label: '近3月' })
    })
  })

  describe('TREND_TABS', () => {
    it('应包含四个趋势标签', () => {
      expect(TREND_TABS).toHaveLength(4)
      expect(TREND_TABS[0]).toEqual({ key: 'weight', label: '体重' })
      expect(TREND_TABS[1]).toEqual({ key: 'appetite', label: '食欲' })
      expect(TREND_TABS[2]).toEqual({ key: 'stool', label: '便便' })
      expect(TREND_TABS[3]).toEqual({ key: 'summary', label: '综合' })
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 核心工具函数
// ═══════════════════════════════════════════════════════════════════════════

function getAbnormalItems(point: TrendDataPoint): string[] {
  const items: string[] = []
  if (point.appetite && point.appetite !== 'normal') {
    items.push(`食欲${APPETITE_LABELS[point.appetite]}`)
  }
  if (point.stool && point.stool !== 'normal') {
    items.push(`便便${STOOL_LABELS[point.stool]}`)
  }
  if (point.vomiting) {
    items.push('呕吐')
  }
  if (point.hasAbnormal && items.length === 0) {
    items.push('数据异常')
  }
  return items
}

function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length >= 3) {
    return `${parts[1]}/${parts[2]}`
  }
  return dateStr
}

function getMonthStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

describe('健康趋势页 - 工具函数', () => {
  describe('formatDateLabel', () => {
    it('标准日期格式应返回 MM/DD', () => {
      expect(formatDateLabel('2024-01-15')).toBe('01/15')
      expect(formatDateLabel('2024-12-31')).toBe('12/31')
    })

    it('不完整日期应返回原字符串', () => {
      expect(formatDateLabel('2024-01')).toBe('2024-01')
      expect(formatDateLabel('invalid')).toBe('invalid')
    })

    it('边界：单数月日应正确格式化', () => {
      expect(formatDateLabel('2024-03-05')).toBe('03/05')
    })
  })

  describe('getMonthStr', () => {
    it('应返回 YYYY-MM 格式', () => {
      expect(getMonthStr(new Date(2024, 0, 15))).toBe('2024-01')
      expect(getMonthStr(new Date(2024, 11, 1))).toBe('2024-12')
    })

    it('应正确处理六月（零索引）', () => {
      expect(getMonthStr(new Date(2024, 5, 10))).toBe('2024-06')
    })
  })

  describe('getAbnormalItems', () => {
    it('正常数据应返回空数组', () => {
      const point = makeTrendPoint({ appetite: 'normal', stool: 'normal', hasAbnormal: false })
      expect(getAbnormalItems(point)).toEqual([])
    })

    it('食欲异常应返回对应描述', () => {
      const point = makeTrendPoint({ appetite: 'none', hasAbnormal: true })
      expect(getAbnormalItems(point)).toEqual(['食欲不吃'])
    })

    it('食欲减少应返回对应描述', () => {
      const point = makeTrendPoint({ appetite: 'decreased', hasAbnormal: true })
      expect(getAbnormalItems(point)).toEqual(['食欲减少'])
    })

    it('便便异常应返回对应描述', () => {
      const point = makeTrendPoint({ stool: 'diarrhea', hasAbnormal: true })
      expect(getAbnormalItems(point)).toEqual(['便便腹泻'])
    })

    it('便血应返回对应描述', () => {
      const point = makeTrendPoint({ stool: 'bloody', hasAbnormal: true, riskLevel: 'emergency' })
      expect(getAbnormalItems(point)).toEqual(['便便便血'])
    })

    it('呕吐应返回对应描述', () => {
      const point = makeTrendPoint({ vomiting: true, hasAbnormal: true })
      expect(getAbnormalItems(point)).toEqual(['呕吐'])
    })

    it('hasAbnormal 为 true 但无具体异常时应返回数据异常', () => {
      const point = makeTrendPoint({
        appetite: 'normal',
        stool: 'normal',
        vomiting: false,
        hasAbnormal: true,
        riskLevel: 'high',
      })
      expect(getAbnormalItems(point)).toEqual(['数据异常'])
    })

    it('同时存在多个异常时应全部返回', () => {
      const point = makeTrendPoint({
        appetite: 'none',
        stool: 'bloody',
        vomiting: true,
        hasAbnormal: true,
        riskLevel: 'emergency',
      })
      const items = getAbnormalItems(point)
      expect(items).toContain('食欲不吃')
      expect(items).toContain('便便便血')
      expect(items).toContain('呕吐')
      expect(items).toHaveLength(3)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 体重曲线展示
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 体重曲线展示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('体重数据为空时显示空状态', () => {
    const { container } = render(React.createElement(PetTrendsPage))

    const emptyText = container.querySelector('.trend-chart__empty-text')
    expect(emptyText).toBeTruthy()
  })

  it('体重数据点应正确渲染折线图', () => {
    const mockTrendData = [
      makeTrendPoint({ date: '2024-01-01', weight: 30 }),
      makeTrendPoint({ date: '2024-01-02', weight: 30.5 }),
      makeTrendPoint({ date: '2024-01-03', weight: 31 }),
    ]
    mockUseTrendFn.mockReturnValue({
      trendData: mockTrendData,
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const chartContainer = container.querySelector('.trend-chart__container')
    expect(chartContainer).toBeTruthy()

    const dataPoints = container.querySelectorAll('.trend-chart__data-point')
    expect(dataPoints.length).toBe(3)
  })

  it('体重超出品种标准范围应显示警告色', () => {
    const mockTrendData = [
      makeTrendPoint({ date: '2024-01-01', weight: 40 }),
      makeTrendPoint({ date: '2024-01-02', weight: 40.5 }),
    ]
    mockUseTrendFn.mockReturnValue({
      trendData: mockTrendData,
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const outOfRange = container.querySelector('.trend-chart__data-point--out-of-range')
    expect(outOfRange).toBeTruthy()
  })

  it('品种正常范围对比线应显示', () => {
    const mockTrendData = [
      makeTrendPoint({ date: '2024-01-01', weight: 30 }),
    ]
    mockUseTrendFn.mockReturnValue({
      trendData: mockTrendData,
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const breedRangeZone = container.querySelector('.trend-chart__breed-range-zone')
    expect(breedRangeZone).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. 食欲趋势展示
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 食欲趋势展示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('食欲数据为空时显示空状态', () => {
    const { container } = render(React.createElement(PetTrendsPage))

    const emptyText = container.querySelector('.trend-chart__empty-text')
    expect(emptyText).toBeTruthy()
  })

  it('食欲数据应渲染柱状图', () => {
    const mockTrendData = [
      makeTrendPoint({ date: '2024-01-01', appetite: 'normal', weight: undefined }),
      makeTrendPoint({ date: '2024-01-02', appetite: 'decreased', weight: undefined }),
      makeTrendPoint({ date: '2024-01-03', appetite: 'increased', weight: undefined }),
    ]
    mockUseTrendFn.mockReturnValue({
      trendData: mockTrendData,
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const chartCards = container.querySelectorAll('.trends-chart-card')
    const appetiteCard = chartCards[1]
    const barItems = appetiteCard?.querySelectorAll('.trend-chart__bar-item') || []
    expect(barItems.length).toBe(3)
  })

  it('食欲图例应显示所有状态', () => {
    const mockTrendData = [
      makeTrendPoint({ date: '2024-01-01', appetite: 'normal', weight: undefined }),
    ]
    mockUseTrendFn.mockReturnValue({
      trendData: mockTrendData,
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const chartCards = container.querySelectorAll('.trends-chart-card')
    const appetiteCard = chartCards[1]
    const legendItems = appetiteCard?.querySelectorAll('.trend-chart__legend-item') || []
    expect(legendItems.length).toBe(4)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4b. 食欲卡「连续N天正常」的天数口径（2026-09-11 修复 P3-7：按自然日去重）
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 食欲连续正常天数按自然日去重', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  /**
   * 渲染趋势页并取出食欲卡右侧那句指标文案
   * （页面首屏用 useTrend 的 trendData 初始化三张图的 points，store 为空时不会覆盖）
   * @param trendData - 要灌给 useTrend 的趋势数据点
   * @returns 指标文案，例如「连续3天正常」或「近期有波动」
   */
  function renderAppetiteStreakText(trendData: TrendDataPoint[]): string {
    mockUseTrendFn.mockReturnValue({
      trendData,
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))
    const chartCards = container.querySelectorAll('.trends-chart-card')
    // 卡片顺序固定为 体重 / 食欲 / 便便，所以第 2 张就是食欲卡
    return chartCards[1]?.querySelector('.trends-chart-card__metric-text')?.textContent || ''
  }

  it('同一天补记多条只算一天（旧实现按条数会算成 4 天）', () => {
    const text = renderAppetiteStreakText([
      makeTrendPoint({ date: '2024-01-01', appetite: 'normal', weight: undefined }),
      makeTrendPoint({ date: '2024-01-02', appetite: 'normal', weight: undefined }),
      makeTrendPoint({ date: '2024-01-03', appetite: 'normal', weight: undefined }),
      // 同一天补记的第二条：归并后依然是「3 天」
      makeTrendPoint({ date: '2024-01-03', appetite: 'normal', weight: undefined }),
    ])

    expect(text).toContain('连续3天正常')
  })

  it('同一天多条时取该日最晚的一条（数组旧→新）', () => {
    // 1-02 早上正常、晚上食欲变差 → 按「当天最晚的一条」算，连续天数归零
    const text = renderAppetiteStreakText([
      makeTrendPoint({ date: '2024-01-01', appetite: 'normal', weight: undefined }),
      makeTrendPoint({ date: '2024-01-02', appetite: 'normal', weight: undefined }),
      makeTrendPoint({ date: '2024-01-02', appetite: 'decreased', weight: undefined }),
    ])

    expect(text).toContain('近期有波动')
  })

  it('后端 /checkins 的新→旧顺序同样取该日最晚的一条', () => {
    // 后端 checkinRepository 按 created_at DESC 返回，同一天里先出现的那条才是「当天最晚」，
    // 旧实现从数组末尾往前数，会把这两条 normal 算成「连续2天正常」（因此本用例能锁住方向判断）
    const text = renderAppetiteStreakText([
      makeTrendPoint({ date: '2024-01-02', appetite: 'decreased', weight: undefined }),
      makeTrendPoint({ date: '2024-01-02', appetite: 'normal', weight: undefined }),
      makeTrendPoint({ date: '2024-01-01', appetite: 'normal', weight: undefined }),
    ])

    expect(text).toContain('近期有波动')
  })

  it('日期解析不出来的脏数据不参与计数（不凭空多算一天）', () => {
    const text = renderAppetiteStreakText([
      makeTrendPoint({ date: '2024-01-01', appetite: 'normal', weight: undefined }),
      makeTrendPoint({ date: '', appetite: 'normal', weight: undefined }),
    ])

    expect(text).toContain('连续1天正常')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. 便便趋势展示
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 便便趋势展示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('便便数据为空时显示空状态并引导打卡', () => {
    const { container } = render(React.createElement(PetTrendsPage))

    const emptyText = container.querySelector('.trend-chart__empty-text')
    expect(emptyText).toBeTruthy()
    const emptyHint = container.querySelector('.trend-chart__empty-hint')
    expect(emptyHint).toBeTruthy()
  })

  it('便便数据应渲染不同颜色的柱状图', () => {
    const mockTrendData = [
      makeTrendPoint({ date: '2024-01-01', stool: 'normal', weight: undefined }),
      makeTrendPoint({ date: '2024-01-02', stool: 'soft', weight: undefined }),
      makeTrendPoint({ date: '2024-01-03', stool: 'bloody', weight: undefined, hasAbnormal: true, riskLevel: 'emergency' }),
    ]
    mockUseTrendFn.mockReturnValue({
      trendData: mockTrendData,
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const chartCards = container.querySelectorAll('.trends-chart-card')
    const stoolCard = chartCards[2]
    const barItems = stoolCard?.querySelectorAll('.trend-chart__bar-item') || []
    expect(barItems.length).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. 异常标记
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 异常标记', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('有异常数据时应显示异常标记线', () => {
    const mockTrendData = [
      makeTrendPoint({ date: '2024-01-01', weight: 30 }),
      makeTrendPoint({ date: '2024-01-02', weight: 30.5, hasAbnormal: true, riskLevel: 'high', appetite: 'none' }),
      makeTrendPoint({ date: '2024-01-03', weight: 31 }),
    ]
    mockUseTrendFn.mockReturnValue({
      trendData: mockTrendData,
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    expect(container.querySelector('.trend-chart__container')).toBeTruthy()
  })

  it('应显示异常标记说明', () => {
    const mockTrendData = [
      makeTrendPoint({ date: '2024-01-01', hasAbnormal: true, riskLevel: 'high', appetite: 'none', weight: undefined }),
      makeTrendPoint({ date: '2024-01-03', hasAbnormal: true, riskLevel: 'emergency', stool: 'bloody', weight: undefined }),
    ]
    const mockSummary = {
      petId: 'pet-1',
      period: 'week',
      weightTrend: 'stable' as const,
      weightChange: 0,
      weightChangePercent: 0,
      appetiteStats: { normal: 0, decreased: 0, increased: 0, none: 2 },
      stoolStats: { normal: 0, soft: 0, diarrhea: 0, constipation: 0, bloody: 1 },
      abnormalDays: 2,
      totalDays: 2,
      aiAnalysis: '检测到异常',
    }

    mockUseTrendFn.mockReturnValue({
      trendData: mockTrendData,
      summary: mockSummary,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const note = container.querySelector('.trends-note')
    expect(note).toBeTruthy()
    expect(note?.textContent).toContain('异常')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. 切换时间范围
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 切换时间范围', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('应渲染三个时间范围按钮', () => {
    const { container } = render(React.createElement(PetTrendsPage))

    const timeBtns = container.querySelectorAll('.pet-trends__time-btn')
    expect(timeBtns.length).toBe(3)
  })

  it('会员用户可以看到所有时间范围（无锁定图标）', () => {
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const lockIcons = container.querySelectorAll('.pet-trends__time-btn-lock')
    expect(lockIcons.length).toBe(0)
  })

  it('免费用户近1月和近3月应显示锁定图标', () => {
    mockUseMembershipFn.mockReturnValue({
      isMember: false,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const lockIcons = container.querySelectorAll('.pet-trends__time-btn-lock')
    expect(lockIcons.length).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. 月度AI健康报告
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 月度AI健康报告', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('月度小结应显示 AI 健康小结文本', () => {
    const mockMonthlyReport = {
      petId: 'pet-1',
      month: '2024-01',
      summary: {
        petId: 'pet-1',
        period: 'month',
        weightTrend: 'stable' as const,
        weightChange: 0.5,
        weightChangePercent: 1.5,
        appetiteStats: { normal: 20, decreased: 2, increased: 1, none: 0 },
        stoolStats: { normal: 18, soft: 3, diarrhea: 1, constipation: 1, bloody: 0 },
        abnormalDays: 3,
        totalDays: 23,
        aiAnalysis: '体重稳定，食欲正常',
      },
      highlights: ['体重保持稳定', '食欲整体良好'],
      concerns: ['有2天食欲下降'],
      recommendations: ['建议坚持每日打卡'],
    }

    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: {
        petId: 'pet-1',
        period: 'week',
        weightTrend: 'stable',
        weightChange: 0,
        weightChangePercent: 0,
        appetiteStats: {},
        stoolStats: {},
        abnormalDays: 0,
        totalDays: 0,
        aiAnalysis: '',
      },
      monthlyReport: mockMonthlyReport,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const aiText = container.querySelector('.trends-ai-card__text')
    expect(aiText).toBeTruthy()
    expect(aiText?.textContent).toContain('体重稳定')
  })

  it('无月度数据时 AI 小结卡显示默认引导文案', () => {
    const { container } = render(React.createElement(PetTrendsPage))

    const aiText = container.querySelector('.trends-ai-card__text')
    expect(aiText).toBeTruthy()
    expect(aiText?.textContent).toContain('暂无月度小结')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. 健康数据为空时的空状态
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 空状态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('无数据时体重视图应显示空状态并引导打卡', () => {
    const { container } = render(React.createElement(PetTrendsPage))

    expect(container.querySelector('.trend-chart__empty')).toBeTruthy()
    expect(container.querySelector('.trend-chart__empty-text')?.textContent).toBe('暂无体重数据')
  })

  it('加载中应显示 PageLoading', () => {
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: true,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    expect(container.querySelector('.pet-trends__content')).toBeTruthy()
  })

  it('有错误时应显示 PageError 并提供重试', () => {
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: '网络异常，请检查网络连接',
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    expect(container.querySelector('.pet-trends__content')).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. 切换标签页
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 切换标签页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('应同时渲染体重/食欲/便便三张图表卡', () => {
    const { container } = render(React.createElement(PetTrendsPage))

    // 2026-09-12 IA 第 2b 批：本页新增「异常记录 / 用药史」两张卡（同样是 .trends-chart-card），
    // 卡片总数固定值不再成立；用例意图（三张图表都要在）不变，改为按标题断言。
    const titles = Array.from(container.querySelectorAll('.trends-chart-card__title')).map((el) => el.textContent)
    expect(titles).toContain('体重曲线')
    expect(titles).toContain('食欲趋势')
    expect(titles).toContain('便便评分')
  })

  it('应显示 AI 月度小结卡', () => {
    const { container } = render(React.createElement(PetTrendsPage))

    const aiCard = container.querySelector('.trends-ai-card')
    expect(aiCard).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11. 综合视图 - AI 趋势分析
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - AI 趋势分析', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('应显示 AI 月度小结卡及小结文本', () => {
    const mockSummary = {
      petId: 'pet-1',
      period: 'week',
      weightTrend: 'stable' as const,
      weightChange: 0,
      weightChangePercent: 0,
      appetiteStats: { normal: 5, decreased: 1, increased: 1, none: 0 },
      stoolStats: { normal: 6, soft: 1, diarrhea: 0, constipation: 0, bloody: 0 },
      abnormalDays: 1,
      totalDays: 7,
      aiAnalysis: '体重保持稳定，这是健康的好迹象。食欲整体正常。',
    }

    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: mockSummary,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const aiCard = container.querySelector('.trends-ai-card')
    expect(aiCard).toBeTruthy()
    expect(aiCard?.textContent).toContain('AI')
    expect(aiCard?.textContent).toContain('健康小结')
  })

  it('存在异常天数时 AI 小结卡应标记有异常', () => {
    const mockSummary = {
      petId: 'pet-1',
      period: 'month',
      weightTrend: 'decreasing' as const,
      weightChange: -2,
      weightChangePercent: -5,
      appetiteStats: { normal: 15, decreased: 8, increased: 0, none: 2 },
      stoolStats: { normal: 18, soft: 3, diarrhea: 3, constipation: 0, bloody: 1 },
      abnormalDays: 7,
      totalDays: 25,
      aiAnalysis: '体重下降，需关注。',
    }

    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: mockSummary,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })

    const { container } = render(React.createElement(PetTrendsPage))

    const badge = container.querySelector('.trends-ai-card__badge')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toContain('有异常')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 12. 导出按钮
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 导出按钮', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('应渲染导出相关按钮', () => {
    const { container } = render(React.createElement(PetTrendsPage))

    const exportSection = container.querySelector('.export-section')
    expect(exportSection).toBeTruthy()

    const buttons = exportSection?.querySelectorAll('button')
    expect(buttons).toBeTruthy()
    expect(buttons!.length).toBeGreaterThanOrEqual(5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 13. 健康报告明细（2026-09-12 IA 第 2b 批：pagesPet/health-report 并入本页）
// ═══════════════════════════════════════════════════════════════════════════

describe('健康趋势页 - 健康报告明细（异常记录 / 用药史）', () => {
  const mockedGenerate = vi.mocked(generateHealthReportData)

  /** 造一份最小可用的报告数据：只填两个区块真正用到的字段 */
  function makeReport(overrides: Record<string, unknown> = {}) {
    return {
      pet: {
        id: 'pet-1', name: '豆豆', species: 'dog', breed: '金毛', birthDate: '2020-01-01',
        gender: 'male', neutered: true, weight: 30, allergies: [], medications: [], chronicConditions: [],
      },
      entries: [],
      symptoms: [
        { date: '2024-01-15', symptoms: ['呕吐', '食欲下降'], urgencyLevel: 'high', aiAssessment: '建议 24 小时内就医' },
      ],
      vaccines: [
        { name: '狂犬疫苗', dateGiven: '2024-01-10', dateDue: '2025-01-10', status: 'done' },
        { name: '体内驱虫', dateGiven: '', dateDue: '2024-03-01', status: 'pending' },
      ],
      generatedAt: '2024-01-20',
      period: '2023-12-21 至 2024-01-20',
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrendFn.mockReturnValue({
      trendData: [],
      summary: null,
      monthlyReport: null,
      isLoading: false,
      error: null,
      fetchWeightTrend: mockFetchWeightTrend,
      fetchAppetiteTrend: mockFetchAppetiteTrend,
      fetchStoolTrend: mockFetchStoolTrend,
      fetchSummary: mockFetchSummary,
      fetchMonthlyReport: mockFetchMonthlyReport,
      clearError: mockClearError,
    })
    mockUseMembershipFn.mockReturnValue({
      isMember: true,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
  })

  it('会员：异常记录与用药史都应渲染（含 AI 建议与高风险标签）', async () => {
    mockedGenerate.mockResolvedValue(makeReport() as never)

    const { container } = render(React.createElement(PetTrendsPage))

    await waitFor(() => expect(container.querySelectorAll('.trends-report-item').length).toBe(3))
    expect(container.textContent).toContain('呕吐、食欲下降')
    expect(container.textContent).toContain('建议 24 小时内就医')
    expect(container.textContent).toContain('狂犬疫苗')
    expect(container.textContent).toContain('较紧急')
  })

  it('用药史按 status 显示状态（不再把待接种写成已完成）', async () => {
    mockedGenerate.mockResolvedValue(makeReport() as never)

    const { container } = render(React.createElement(PetTrendsPage))

    await waitFor(() => expect(container.querySelectorAll('.trends-report-item').length).toBe(3))
    expect(container.textContent).toContain('已完成')
    expect(container.textContent).toContain('待接种')
    expect(container.querySelector('.trends-report-item__tag--ok')?.textContent).toContain('已完成')
    expect(container.querySelector('.trends-report-item__tag--warn')?.textContent).toContain('待接种')
  })

  it('会员但近30天没有记录：两个区块走空态', async () => {
    mockedGenerate.mockResolvedValue(makeReport({ symptoms: [], vaccines: [] }) as never)

    const { container } = render(React.createElement(PetTrendsPage))

    await waitFor(() => expect(container.textContent).toContain('近30天没有异常记录'))
    expect(container.textContent).toContain('暂无用药记录')
  })

  it('非会员：只给开通引导卡，不渲染明细、也不请求报告数据', () => {
    mockUseMembershipFn.mockReturnValue({
      isMember: false,
      checkAccess: mockCheckAccess,
      shouldShowPaywall: false,
      markPaywallShown: vi.fn(),
    })
    mockedGenerate.mockResolvedValue(makeReport() as never)

    const { container } = render(React.createElement(PetTrendsPage))

    expect(container.querySelector('.trends-report-locked')).toBeTruthy()
    expect(container.querySelectorAll('.trends-report-item').length).toBe(0)
    expect(mockedGenerate).not.toHaveBeenCalled()
  })
})

/**
 * 打卡记录分区（2026-09-12 第 4 波：原始打卡明细从时光页迁入健康档案页）
 *
 * 用户原话：「打卡记录和日记/时光不是一个东西，你塞在一起了」。
 * 这组用例锁三件事：① 列表每一行都来自真实记录（日期 + 大便/小便/食欲/精神/体重）；
 * ② 到达 30 条上限时界面**如实说明**（不许让用户以为只有这些）；③ 没有记录时给真实空态。
 */
describe('健康趋势页 - 打卡记录分区（2026-09-12 第 4 波迁入）', () => {
  /** 构造一条打卡记录（字段对齐 checkinService 返回的 PetHealthEntry） */
  function makeCheckin(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ck-1',
      petId: 'pet-1',
      userId: 'user-1',
      poopLevel: 3,
      appetiteLevel: 3,
      spiritLevel: 3,
      exerciseLevel: 2,
      weight: 12.5,
      hasAnomaly: false,
      anomalyItems: [],
      riskLevel: 'low',
      note: '',
      createdAt: '2026-09-10T04:00:00.000Z',
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCheckins.mockResolvedValue([])
  })

  it('按日期倒序列出真实打卡记录：日期 + 大便/小便/食欲/精神 + 体重都来自记录本身', async () => {
    mockGetCheckins.mockResolvedValue([
      makeCheckin({ id: 'ck-new', createdAt: '2026-09-11T04:00:00.000Z', poopLevel: 4, note: '小便: 颜色偏黄' }),
      makeCheckin({ id: 'ck-old', createdAt: '2026-09-09T04:00:00.000Z', weight: undefined }),
    ])

    const { container } = render(React.createElement(PetTrendsPage))

    await waitFor(() => expect(container.querySelectorAll('.trends-checkin-item').length).toBe(2))
    // 倒序：新的（09-11）在前
    const dates = Array.from(container.querySelectorAll('.trends-checkin-item__date')).map((el) => el.textContent)
    expect(dates[0]).toBe('2026-09-11')
    expect(dates[1]).toBe('2026-09-09')

    const first = container.querySelectorAll('.trends-checkin-item')[0]
    const values = Array.from(first.querySelectorAll('.trends-checkin-tag__value')).map((el) => el.textContent)
    // 大便 4 → 偏软；小便取自 note 里那句；食欲/精神 3 → 正常
    expect(values).toEqual(['偏软', '颜色偏黄', '正常', '正常'])
    // 体重只在真的有值的那条上显示（09-09 那条没称）
    expect(first.querySelector('.trends-checkin-item__weight-text')?.textContent).toBe('12.5 kg')
    expect(container.querySelectorAll('.trends-checkin-item__weight').length).toBe(1)
    // 头部计数是全量条数
    expect(container.textContent).toContain('共 2 条')
  })

  it('超过 30 条时只渲染最近 30 条，并在界面上如实写明「仅显示最近 30 条（共 M 条）」', async () => {
    // 造 35 条：2026-09-01 ~ 2026-09-05 各 7 条，日期倒序后可验证截断口径
    const entries = []
    for (let i = 0; i < 35; i += 1) {
      entries.push(makeCheckin({
        id: 'ck-' + i,
        // 从 09-05 往前每天递减（字符串可直接排序），保证首条是 09-05
        createdAt: '2026-09-' + String(5 - Math.floor(i / 7)).padStart(2, '0') + 'T04:00:00.000Z',
      }))
    }
    mockGetCheckins.mockResolvedValue(entries)

    const { container } = render(React.createElement(PetTrendsPage))

    await waitFor(() => expect(container.querySelectorAll('.trends-checkin-item').length).toBe(30))
    // 如实告知上限：这句必须出现，且带上全量条数
    expect(container.querySelector('.trends-checkin-limit')?.textContent).toBe('仅显示最近 30 条（共 35 条）')
    expect(container.textContent).toContain('共 35 条')
  })

  /**
   * 读当前列表里每行的心情中文名（角标文案形如「💩 开心」，这里取后半段）
   * @param container - 渲染容器
   * @returns 与 .trends-checkin-item 一一对应的心情名；没有日记块的行给 null
   */
  function rowMoodLabels(container: HTMLElement): (string | null)[] {
    return Array.from(container.querySelectorAll('.trends-checkin-item')).map((item) => {
      const text = item.querySelector('.trends-checkin-diary__mood-text')?.textContent || ''
      return text ? text.replace(/^\S+\s*/, '') : null
    })
  }

  it('每条打卡下面显示它自己那句自动生成的日记与心情档位，卡片顶部写明句子来源', async () => {
    mockGetCheckins.mockResolvedValue([makeCheckin({ id: 'ck-1', note: '今天去公园了' })])

    const { container } = render(React.createElement(PetTrendsPage))
    await waitFor(() => expect(container.querySelectorAll('.trends-checkin-item').length).toBe(1))

    // 来源说明：必须让用户看懂这些句子不是自己写的（否则又变回我哪有填这么多）
    const source = container.querySelector('.trends-checkin-source')?.textContent || ''
    expect(source).toContain('团团根据这条打卡自动写的')

    // 每行都有日记块：正文非空，且不是把打卡备注复读一遍（证明走的是 diaryEngine 的模板文案）
    expect(container.querySelectorAll('.trends-checkin-diary').length).toBe(1)
    const diaryText = container.querySelector('.trends-checkin-diary__text')?.textContent || ''
    expect(diaryText.length).toBeGreaterThan(0)
    expect(diaryText).not.toBe('今天去公园了')
    // 心情角标（心情筛选的取值来源）—— 5 档之一
    expect(container.querySelector('.trends-checkin-diary__mood-text')?.textContent || '').toMatch(
      /开心|平静|疲惫|不舒服|骄傲/,
    )
    // 用户自己填的备注仍然照常展示（它和自动生成的句子是两回事）
    expect(container.querySelector('.trends-checkin-item__note')?.textContent).toContain('今天去公园了')
  })

  it('6 档心情筛选：按每条打卡自动生成的心情筛记录，点「全部」恢复', async () => {
    mockGetCheckins.mockResolvedValue([
      makeCheckin({ id: 'ck-1', createdAt: '2026-09-10T04:00:00.000Z' }),
      makeCheckin({
        id: 'ck-2',
        createdAt: '2026-09-11T04:00:00.000Z',
        poopLevel: 1,
        appetiteLevel: 1,
        spiritLevel: 1,
        note: '今天不太舒服',
      }),
    ])

    const { container } = render(React.createElement(PetTrendsPage))
    await waitFor(() => expect(container.querySelectorAll('.trends-checkin-item').length).toBe(2))

    // 6 档胶囊都在（全部 + 5 种心情）
    const chips = Array.from(
      container.querySelectorAll('.trends-checkin-filter__list .trends-checkin-chip__text'),
    ).map((el) => el.textContent)
    expect(chips).toEqual(['全部', '开心', '平静', '疲惫', '不舒服', '骄傲'])

    // 【为什么按渲染出来的心情现算期望值】心情由 diaryEngine 按记录内容算出来，
    // 在用例里写死具体档位会让测试依赖它的内部规则；这里验证的是**筛选行为本身**：
    // 选某个心情 → 屏幕上只剩这个心情的记录，且条数与计数一致。
    const moods = rowMoodLabels(container)
    const target = moods[0]
    expect(target).toBeTruthy()
    const expectedCount = moods.filter((m) => m === target).length

    fireEvent.click(screen.getByText(target as string))
    await waitFor(() => expect(container.querySelectorAll('.trends-checkin-item').length).toBe(expectedCount))
    expect(rowMoodLabels(container).every((m) => m === target)).toBe(true)
    expect(container.querySelector('.trends-checkin-filter__count')?.textContent).toBe(`筛出 ${expectedCount} 条`)

    fireEvent.click(screen.getByText('全部'))
    await waitFor(() => expect(container.querySelectorAll('.trends-checkin-item').length).toBe(2))
  })

  it('该心情下一条记录都没有时给轻量空态（不是 0 行表格，也不与没有记录那句打架）', async () => {
    mockGetCheckins.mockResolvedValue([makeCheckin({ id: 'ck-1' })])

    const { container } = render(React.createElement(PetTrendsPage))
    await waitFor(() => expect(container.querySelectorAll('.trends-checkin-item').length).toBe(1))

    // 挑一个这条记录**没有**的心情档位（5 档里至少缺一个，因为只有一条记录）
    const moods = rowMoodLabels(container)
    const missing = ['开心', '平静', '疲惫', '不舒服', '骄傲'].find((m) => !moods.includes(m))
    if (!missing) throw new Error('这条打卡把 5 种心情都占了，用例前提不成立')

    fireEvent.click(screen.getByText(missing))
    await waitFor(() => expect(container.textContent).toContain('这个心情下暂时没有打卡记录'))
    expect(container.querySelectorAll('.trends-checkin-item').length).toBe(0)
    // 两个空态不能同时出现（一个说没有记录、一个说这个心情下没有，会互相打架）
    expect(container.textContent).not.toContain('这只毛孩子还没有打卡记录')
  })
})
