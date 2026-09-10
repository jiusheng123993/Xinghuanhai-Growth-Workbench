/**
 * 健康趋势页面
 * AI月度小结 + 体重/食欲/便便趋势图同屏展示，健康报告导出
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { View, Text, ScrollView, Button } from '@tarojs/components'
import Taro, { useShareAppMessage, useShareTimeline, useDidShow } from '@tarojs/taro'
import { logger } from '../../logger'
import PetSwitcher from '../../components/PetSwitcher'
import PaywallPopup from '../../components/PaywallPopup'
import AnomalyMarker from '../../components/AnomalyMarker'
import PageLoading from '../../components/PageLoading'
import PageError from '../../components/PageError'
import HealthReportPreview from '../../components/HealthReportPreview'
import HealthTrendShareCard from '../../components/HealthTrendShareCard'
import { usePetStore } from '../../stores/petStore'
import { useTrendStore } from '../../stores/trendStore'
import { useAuthStore } from '../../stores/authStore'
import { useShareStore } from '../../stores/shareStore'
import { useTrend } from '../../hooks/useTrend'
import { useMembership } from '../../hooks/useMembership'
import { generateHealthReportData, downloadHealthReport, shareHealthReport, downloadHealthReportCsv, shareReportToVet } from '../services/healthReportPdfService'
import { recordShare } from '../../services/shareService'
import type { TrendDataPoint, TrendSummary, MonthlyReport } from '../../services/trendService'
import type { HealthReportData } from '../../types/reportTypes'
import type { HealthTrendShareData } from '../../types/shareTypes'
import { checkNpsEligibility, submitNpsResponse, dismissNpsSurvey } from '../../services/npsService'
import NpsSurvey from '../../components/NpsSurvey'
import type { NpsTriggerEvent } from '../../types/npsTypes'
import { MedicalDisclaimer } from '../../engines/petSafety/MedicalDisclaimer'
import { getActiveBreeds } from '../../data/petKnowledge/breeds'
import { useAnalytics, usePageView } from '../../hooks/useAnalytics'
import { AnalyticsEventName } from '../../types/analyticsTypes'
import './index.scss'
import { Icon } from '../../components'
import PageBackground from '../../components/PageBackground'
import { localDateString } from '../../utils/date'

type TimeRange = 'week' | 'month' | 'quarter'
type TrendTab = 'weight' | 'appetite' | 'stool' | 'summary'

export const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: 'week', label: '近1周' },
  { key: 'month', label: '近1月' },
  { key: 'quarter', label: '近3月' }
]

export const TREND_TABS: { key: TrendTab; label: string }[] = [
  { key: 'weight', label: '体重' },
  { key: 'appetite', label: '食欲' },
  { key: 'stool', label: '便便' },
  { key: 'summary', label: '综合' }
]

export const APPETITE_LABELS: Record<string, string> = {
  normal: '正常',
  decreased: '减少',
  increased: '增加',
  none: '不吃'
}

export const STOOL_LABELS: Record<string, string> = {
  normal: '正常',
  soft: '偏软',
  diarrhea: '腹泻',
  constipation: '便秘',
  bloody: '便血'
}

export const APPETITE_COLORS: Record<string, string> = {
  normal: '#52C41A',
  decreased: '#FAAD14',
  increased: '#FF8C42',
  none: '#FF4D4F'
}

export const STOOL_COLORS: Record<string, string> = {
  normal: '#52C41A',
  soft: '#FAAD14',
  diarrhea: '#FF8C42',
  constipation: '#FAAD14',
  bloody: '#FF4D4F'
}

export const RISK_COLORS: Record<string, string> = {
  normal: '#52C41A',
  caution: '#FAAD14',
  warning: '#FF8C42',
  emergency: '#FF4D4F'
}

/** 便便评分映射（照原型「平均X.X分」展示） */
const STOOL_SCORES: Record<string, number> = {
  normal: 5,
  soft: 4,
  constipation: 3,
  diarrhea: 2,
  bloody: 1
}

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

export default function PetTrendsPage() {
  const { pets, currentPet, fetchPets, switchPet } = usePetStore()
  const { isMember, checkAccess, shouldShowPaywall, markPaywallShown } = useMembership()
  const user = useAuthStore(s => s.user)
  const inviteCode = useShareStore(s => s.inviteCode)
  const {
    trendData,
    summary,
    monthlyReport,
    isLoading: storeLoading,
    error,
    fetchWeightTrend,
    fetchAppetiteTrend,
    fetchStoolTrend,
    fetchSummary,
    fetchMonthlyReport,
    clearError
  } = useTrend()

  const [timeRange, setTimeRange] = useState<TimeRange>('month')
  const [paywallVisible, setPaywallVisible] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [reportData, setReportData] = useState<HealthReportData | null>(null)
  const [showTrendShare, setShowTrendShare] = useState(false)
  const [trendShareData, setTrendShareData] = useState<HealthTrendShareData | null>(null)
  const [showNpsSurvey, setShowNpsSurvey] = useState(false)
  const [npsTriggerEvent, setNpsTriggerEvent] = useState<NpsTriggerEvent>('manual')
  const { trackPageView, trackEvent } = useAnalytics()

  /** 三张图表各自的独立数据源（同一接口共用 trendData 槽位，逐项快照） */
  const [weightPoints, setWeightPoints] = useState<TrendDataPoint[]>(() => trendData)
  const [appetitePoints, setAppetitePoints] = useState<TrendDataPoint[]>(() => trendData)
  const [stoolPoints, setStoolPoints] = useState<TrendDataPoint[]>(() => trendData)

  const disclaimerText = new MedicalDisclaimer().getTrendDisclaimer()

  usePageView('trends')

  useShareAppMessage(() => ({
    title: '星河宠记 - 宠物健康趋势',
    path: `/pagesPet/trends/index${inviteCode ? `?inviteCode=${inviteCode}` : ''}`,
  }))
  useShareTimeline(() => ({
    title: '星河宠记 - 宠物健康趋势',
    query: inviteCode ? `inviteCode=${inviteCode}` : '',
  }))

  useDidShow(() => {
    if (user) fetchPets(user.id)
  })

  useEffect(() => {
    if (currentPet?.id) {
      loadTrendData()
    }
  }, [currentPet?.id, timeRange])

  const loadTrendData = useCallback(async () => {
    if (!currentPet?.id) return
    clearError()
    try {
      const monthsMap: Record<TimeRange, number> = { week: 1, month: 1, quarter: 3 }
      const months = monthsMap[timeRange]
      await fetchWeightTrend(currentPet.id, months)
      const weightStored = useTrendStore.getState().trendData
      setWeightPoints(weightStored.length > 0 ? weightStored : trendData)
      await fetchAppetiteTrend(currentPet.id, months)
      const appetiteStored = useTrendStore.getState().trendData
      setAppetitePoints(appetiteStored.length > 0 ? appetiteStored : trendData)
      await fetchStoolTrend(currentPet.id, months)
      const stoolStored = useTrendStore.getState().trendData
      setStoolPoints(stoolStored.length > 0 ? stoolStored : trendData)
      await fetchSummary(currentPet.id, timeRange)
      await fetchMonthlyReport(currentPet.id, getMonthStr(new Date()))
    } catch {
      // 错误统一由 store error 呈现
    }
  }, [currentPet?.id, timeRange, trendData, clearError, fetchWeightTrend, fetchAppetiteTrend, fetchStoolTrend, fetchSummary, fetchMonthlyReport])

  /**
   * 切换宠物
   * 2026-09-11 补失败兜底：petStore.switchPet 失败时会 throw，
   * 原来这里不接 promise —— 用户点另一只宠物"没反应"，控制台还多一条未处理拒绝。
   */
  const handlePetSwitch = useCallback((petId: string) => {
    switchPet(petId).catch((err: unknown) => {
      // 优先用本次捕获的异常：store.error 可能是上一次无关操作留下的旧消息（审查 P2-5）
      const msg = err instanceof Error ? err.message : ''
      Taro.showToast({ title: msg || usePetStore.getState().error || '切换失败，请重试', icon: 'none' })
    })
  }, [switchPet])

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    if (!isMember && (range === 'month' || range === 'quarter')) {
      trackEvent('show_paywall', { feature: 'trends_time_range' })
      setPaywallVisible(true)
      return
    }
    trackEvent('change_time_range', { range })
    setTimeRange(range)
  }, [isMember])

  const handleExportReport = useCallback(async () => {
    if (!currentPet?.id || !user?.id) return

    const hasAccess = checkAccess('health_report_export')
    if (!hasAccess) {
      trackEvent('show_paywall', { feature: 'health_report_export' })
      setPaywallVisible(true)
      return
    }
    trackEvent('click_export_report')

    setGenerating(true)
    try {
      // 局部改名 generatedReport / err：避免遮蔽组件状态 reportData 与外层 error（no-shadow）
      const generatedReport = await generateHealthReportData(user.id, currentPet.id)
      await downloadHealthReport(generatedReport, currentPet.name)
      const npsStatus = checkNpsEligibility(user.id, user.createdAt || new Date().toISOString())
      if (npsStatus.isEligible) {
        setShowNpsSurvey(true)
        setNpsTriggerEvent('after_export')
      }
    } catch (err) {
      logger.error('Trends', 'Failed to generate report', err)
      Taro.showToast({ title: '导出报告失败', icon: 'none' })
    } finally {
      setGenerating(false)
    }
  }, [currentPet, user, checkAccess])

  const handlePreviewReport = useCallback(async () => {
    if (!currentPet?.id || !user?.id) return

    const hasAccess = checkAccess('health_report_export')
    if (!hasAccess) {
      trackEvent('show_paywall', { feature: 'health_report_preview' })
      setPaywallVisible(true)
      return
    }

    setGenerating(true)
    try {
      const generatedReport = await generateHealthReportData(user.id, currentPet.id)
      setReportData(generatedReport)
      setShowReport(true)
    } catch (err) {
      logger.error('Trends', 'Failed to preview report', err)
      Taro.showToast({ title: '预览报告失败', icon: 'none' })
    } finally {
      setGenerating(false)
    }
  }, [currentPet, user, checkAccess])

  const handleShareTrend = useCallback(() => {
    if (!currentPet || !summary) return
    setTrendShareData({
      petName: currentPet.name,
      petAvatar: currentPet.avatarPhotoUrl || currentPet.avatarCartoonUrl || '',
      dateRange: `${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('zh-CN')} - ${new Date().toLocaleDateString('zh-CN')}`,
      trendSummary: summary.aiAnalysis || '暂无趋势数据',
      aiInsight: summary.weightChangePercent > 0 ? '体重上升趋势' : summary.weightChangePercent < 0 ? '体重下降趋势' : '体重稳定',
    })
    setShowTrendShare(true)
  }, [currentPet, summary])

  const handleExportCsv = useCallback(async () => {
    if (!currentPet?.id || !user?.id) return

    const hasAccess = checkAccess('health_report_export')
    if (!hasAccess) {
      trackEvent('show_paywall', { feature: 'health_report_export' })
      setPaywallVisible(true)
      return
    }
    trackEvent('click_export_csv')

    setGenerating(true)
    try {
      const generatedReport = await generateHealthReportData(user.id, currentPet.id)
      await downloadHealthReportCsv(generatedReport, currentPet.name)
    } catch (err) {
      logger.error('Trends', 'Failed to export CSV', err)
      Taro.showToast({ title: '导出CSV失败', icon: 'none' })
    } finally {
      setGenerating(false)
    }
  }, [currentPet, user, checkAccess])

  const handleShareToVet = useCallback(async () => {
    if (!currentPet?.id || !user?.id) return

    const hasAccess = checkAccess('health_report_export')
    if (!hasAccess) {
      trackEvent('show_paywall', { feature: 'health_report_export' })
      setPaywallVisible(true)
      return
    }
    trackEvent('click_share_to_vet')

    setGenerating(true)
    try {
      const generatedReport = await generateHealthReportData(user.id, currentPet.id)
      await shareReportToVet(generatedReport, currentPet.name)
    } catch (err) {
      logger.error('Trends', 'Failed to share to vet', err)
      Taro.showToast({ title: '分享给兽医失败', icon: 'none' })
    } finally {
      setGenerating(false)
    }
  }, [currentPet, user, checkAccess])

  const handleTrendShareConfirm = useCallback(() => {
    if (!user?.id || !currentPet?.id) return
    trackEvent(AnalyticsEventName.ShareAction, { type: 'trend', platform: 'wechat' })
    Taro.showShareMenu({ withShareTicket: true })
    recordShare(user.id, 'health_trend', currentPet.id, 'wechat')
    setShowTrendShare(false)
  }, [user?.id, currentPet?.id, trackEvent])

  const handleTrendShareClose = useCallback(() => {
    setShowTrendShare(false)
  }, [])

  const breedWeightRange = useMemo(() => {
    if (!currentPet?.breedId) return null
    const breed = getActiveBreeds().find((b) => b.id === currentPet.breedId)
    if (!breed) return null
    return { min: breed.weightRange.min, max: breed.weightRange.max, name: breed.name }
  }, [currentPet?.breedId])

  const weightChartData = useMemo(() => {
    const withWeight = weightPoints.filter((d) => d.weight !== undefined && d.weight !== null)
    if (withWeight.length === 0) return null
    const weights = withWeight.map((d) => d.weight!)
    const minWeight = Math.min(...weights)
    const maxWeight = Math.max(...weights)
    const range = maxWeight - minWeight || 1
    return {
      points: withWeight,
      minWeight,
      maxWeight,
      range
    }
  }, [weightPoints])

  const breedWeightAnalysis = useMemo(() => {
    if (!breedWeightRange || !weightChartData || weightChartData.points.length === 0) return null
    const latestWeight = weightChartData.points[weightChartData.points.length - 1]?.weight
    if (latestWeight === undefined) return null

    const { min, max, name } = breedWeightRange
    const mid = (min + max) / 2
    const deviation = latestWeight - mid
    const deviationPercent = (deviation / mid) * 100

    let status: 'underweight' | 'normal' | 'overweight' | 'obese'
    let suggestion: string

    if (latestWeight < min) {
      status = 'underweight'
      suggestion = `低于${name}标准体重下限${min}kg，建议增加营养摄入并排查潜在健康问题`
    } else if (latestWeight > max) {
      const overPercent = ((latestWeight - max) / max) * 100
      if (overPercent > 20) {
        status = 'obese'
        suggestion = `严重超重，超出${name}标准上限${max}kg的${overPercent.toFixed(0)}%，建议立即制定减重计划`
      } else {
        status = 'overweight'
        suggestion = `超出${name}标准体重上限${max}kg，建议控制饮食增加运动`
      }
    } else {
      status = 'normal'
      suggestion = `在${name}标准体重范围${min}-${max}kg内，继续保持`
    }

    return { status, suggestion, deviation, deviationPercent, latestWeight, min, max, mid }
  }, [breedWeightRange, weightChartData])

  const breedWeightTrend = useMemo(() => {
    if (!breedWeightRange || !weightChartData || weightChartData.points.length < 3) return null
    const points = weightChartData.points
    const recent = points.slice(-3)
    const first = recent[0].weight!
    const last = recent[recent.length - 1].weight!
    const change = last - first
    const changePercent = (change / first) * 100

    let direction: 'stable' | 'increasing' | 'decreasing'
    if (Math.abs(changePercent) < 2) {
      direction = 'stable'
    } else if (changePercent > 0) {
      direction = 'increasing'
    } else {
      direction = 'decreasing'
    }

    return { direction, change, changePercent, first, last }
  }, [breedWeightRange, weightChartData])

  /** 体重卡右侧指标：近30天体重变化 */
  const weightChangeText = useMemo(() => {
    if (weightChartData && weightChartData.points.length >= 2) {
      const first = weightChartData.points[0].weight
      const last = weightChartData.points[weightChartData.points.length - 1].weight
      if (first !== undefined && last !== undefined) {
        const change = last - first
        return `${change > 0 ? '+' : ''}${change.toFixed(1)}kg`
      }
    }
    return null
  }, [weightChartData])

  /**
   * 食欲卡右侧指标：末尾连续正常天数（按自然日去重）
   *
   * 2026-09-11 修复「按条数冒充天数」（审查 P3-7）：appetitePoints 里**每条打卡一行**
   * （由 trendService.checkinToTrendDataPoint 逐条映射而来），同一天补记两次就是两行；
   * 原来的实现直接在数组末尾累加条数，于是「连续正常 3 天」会被算成 4、5 天。
   * 现在先把同一自然日归并成一天，再数末尾连续正常的天数。
   *
   * 归并规则：
   * - 日期统一走 utils/date 的 localDateString（本地日历日 YYYY-MM-DD）；
   *   不能自己写 toISOString().slice(0, 10) —— 那是 UTC，东八区 20:00 之后会差一天；
   * - 同一天多条时保留「当天最晚的一条」：当天最后的状态比早上那条更贴近用户直觉；
   * - 归并结果再按日期字符串从新到旧排序（YYYY-MM-DD 可直接字典序比较），
   *   这样末尾不依赖数组本身是升序还是降序（与 reportService.calculateStreak 同一思路）。
   */
  const appetiteStreak = useMemo(() => {
    // 1) 先取每条记录的本地日历日：解析不出日期（date 为空串/脏数据）的直接跳过，
    //    宁可少算一天，也不凭空多算一天
    const dated = appetitePoints
      .map((point) => ({ day: localDateString(point.date), point }))
      .filter((item): item is { day: string; point: TrendDataPoint } => item.day !== null)

    // 2) 判断数组是「新→旧」还是「旧→新」
    // TrendDataPoint 只有日期、没有时刻字段，同一自然日内的先后只能靠数组顺序推断：
    // 后端 /checkins 按 created_at DESC 返回（新→旧），本地缓存兜底则是插入顺序（旧→新），
    // 两个来源方向相反，所以这里用首尾日期比一次大小，而不是写死升序
    const newestFirst = dated.length > 1 && dated[0].day > dated[dated.length - 1].day

    // 3) 同一自然日只留一条「当天最晚的」：
    // 新→旧时当天最晚的那条先出现（保留首次），旧→新时最后出现的那条最晚（覆盖）
    const latestOfDay = new Map<string, TrendDataPoint>()
    for (const { day, point } of dated) {
      if (newestFirst && latestOfDay.has(day)) continue
      latestOfDay.set(day, point)
    }

    // 4) 从最新的一天往回数连续正常，遇到第一个非 normal 就停
    let streak = 0
    for (const day of Array.from(latestOfDay.keys()).sort().reverse()) {
      if (latestOfDay.get(day)!.appetite === 'normal') streak++
      else break
    }
    return streak
  }, [appetitePoints])

  /** 便便卡右侧指标：平均评分 */
  const stoolAvgScore = useMemo(() => {
    const scored = stoolPoints.filter((p) => p.stool && STOOL_SCORES[p.stool] !== undefined)
    if (scored.length === 0) return null
    const avg = scored.reduce((sum, p) => sum + STOOL_SCORES[p.stool!], 0) / scored.length
    return avg.toFixed(1)
  }, [stoolPoints])

  const weightAbnormalSet = useMemo(() => new Set(weightPoints.filter((d) => d.hasAbnormal).map((d) => d.date)), [weightPoints])
  const appetiteAbnormalSet = useMemo(() => new Set(appetitePoints.filter((d) => d.hasAbnormal).map((d) => d.date)), [appetitePoints])
  const stoolAbnormalSet = useMemo(() => new Set(stoolPoints.filter((d) => d.hasAbnormal).map((d) => d.date)), [stoolPoints])

  /** AI 月度小结卡数据 */
  const monthLabel = new Date().getMonth() + 1
  const hasAbnormal = (summary?.abnormalDays || 0) > 0
  const aiSummaryText = monthlyReport?.summary?.aiAnalysis || summary?.aiAnalysis || '暂无月度小结数据，持续打卡将自动生成 AI 健康小结'

  const renderWeightChart = () => {
    if (!weightChartData || weightChartData.points.length === 0) {
      return (
        <View className='trend-chart__empty'>
          <Text className='trend-chart__empty-text'>暂无体重数据</Text>
          <Text className='trend-chart__empty-hint'>打卡时记录体重即可生成趋势图</Text>
        </View>
      )
    }

    const { points, minWeight, maxWeight, range } = weightChartData
    const chartHeight = 320
    const chartWidth = 100
    const paddingTop = 20
    const paddingBottom = 40
    const drawHeight = chartHeight - paddingTop - paddingBottom

    const displayMin = breedWeightRange ? Math.min(minWeight, breedWeightRange.min) : minWeight
    const displayMax = breedWeightRange ? Math.max(maxWeight, breedWeightRange.max) : maxWeight
    const displayRange = displayMax - displayMin || 1

    const latestWeight = points[points.length - 1]?.weight
    const isOverWeight = breedWeightRange && latestWeight !== undefined
      ? latestWeight > breedWeightRange.max
      : false
    const isUnderWeight = breedWeightRange && latestWeight !== undefined
      ? latestWeight < breedWeightRange.min
      : false
    const isOutOfRange = isOverWeight || isUnderWeight

    const breedRangeTopY = paddingTop + ((displayMax - breedWeightRange!.max) / displayRange) * drawHeight
    const breedRangeBottomY = paddingTop + ((displayMax - breedWeightRange!.min) / displayRange) * drawHeight

    return (
      <View className='trend-chart__container'>
        {breedWeightRange && (
          <View className='trend-chart__breed-range-header'>
            <Text className='trend-chart__breed-range-label'>
              {breedWeightRange.name}标准体重范围
            </Text>
            <Text className={`trend-chart__breed-range-value${isOutOfRange ? ' trend-chart__breed-range-value--warning' : ''}`}>
              {breedWeightRange.min} ~ {breedWeightRange.max} kg
            </Text>
            {isOutOfRange && (
              <Text className='trend-chart__breed-range-warning'>
                {isOverWeight ? '当前超重' : '当前偏轻'}
              </Text>
            )}
          </View>
        )}

        {/* 品种体重分析卡片 */}
        {breedWeightAnalysis && (
          <View className={`trend-chart__breed-analysis trend-chart__breed-analysis--${breedWeightAnalysis.status}`}>
            <View className='trend-chart__breed-analysis-header'>
              <Text className='trend-chart__breed-analysis-title'>
                {breedWeightAnalysis.status === 'normal' ? '✅ 体重正常' :
                 breedWeightAnalysis.status === 'underweight' ? '⚠️ 体重偏轻' :
                 breedWeightAnalysis.status === 'overweight' ? '⚠️ 体重偏重' :
                 '🔴 严重超重'}
              </Text>
              <Text className='trend-chart__breed-analysis-value'>
                {breedWeightAnalysis.latestWeight}kg / {breedWeightAnalysis.min}-{breedWeightAnalysis.max}kg
              </Text>
            </View>
            <Text className='trend-chart__breed-analysis-suggestion'>
              {breedWeightAnalysis.suggestion}
            </Text>
            {breedWeightTrend && (
              <View className='trend-chart__breed-trend'>
                <Text className='trend-chart__breed-trend-label'>
                  近期趋势（近3次）：
                </Text>
                <Text className={`trend-chart__breed-trend-value trend-chart__breed-trend-value--${breedWeightTrend.direction}`}>
                  {breedWeightTrend.direction === 'stable' ? '稳定' :
                   breedWeightTrend.direction === 'increasing' ? `上升 ${breedWeightTrend.changePercent.toFixed(1)}%` :
                   `下降 ${Math.abs(breedWeightTrend.changePercent).toFixed(1)}%`}
                </Text>
              </View>
            )}
          </View>
        )}
        <View className='trend-chart__y-axis'>
          <Text className='trend-chart__y-label'>{displayMax.toFixed(1)}kg</Text>
          <Text className='trend-chart__y-label'>{((displayMax + displayMin) / 2).toFixed(1)}kg</Text>
          <Text className='trend-chart__y-label'>{displayMin.toFixed(1)}kg</Text>
        </View>
        <View className='trend-chart__plot-area'>
          <View className='trend-chart__grid'>
            <View className='trend-chart__grid-line' />
            <View className='trend-chart__grid-line' />
            <View className='trend-chart__grid-line' />
          </View>
          <View className='trend-chart__line-chart' style={{ height: `${chartHeight}rpx` }}>
            {breedWeightRange && (
              <View
                className='trend-chart__breed-range-zone'
                style={{
                  top: `${breedRangeTopY}rpx`,
                  height: `${breedRangeBottomY - breedRangeTopY}rpx`
                }}
              >
                <View className='trend-chart__breed-range-line trend-chart__breed-range-line--top' />
                <View className='trend-chart__breed-range-line trend-chart__breed-range-line--bottom' />
              </View>
            )}
            {points.map((point, index) => {
              const x = (index / (points.length - 1 || 1)) * chartWidth
              const y = paddingTop + ((displayMax - point.weight!) / displayRange) * drawHeight
              const isAbnormal = weightAbnormalSet.has(point.date)
              const pointOutOfRange = breedWeightRange
                && (point.weight! > breedWeightRange.max || point.weight! < breedWeightRange.min)
              return (
                <View
                  key={point.date}
                  className={`trend-chart__data-point${pointOutOfRange ? ' trend-chart__data-point--out-of-range' : ''}`}
                  style={{
                    left: `${x}%`,
                    bottom: `${chartHeight - y}rpx`
                  }}
                >
                  <View className={`trend-chart__dot${pointOutOfRange ? ' trend-chart__dot--out-of-range' : ''}`} />
                  <Text className={`trend-chart__point-value${pointOutOfRange ? ' trend-chart__point-value--out-of-range' : ''}`}>
                    {point.weight}kg
                  </Text>
                  {isAbnormal && (
                    <AnomalyMarker
                      date={point.date}
                      riskLevel={(point.riskLevel || 'caution') as 'normal' | 'caution' | 'warning' | 'emergency'}
                      items={getAbnormalItems(point)}
                      position={{ x: 0, y: 0 }}
                    />
                  )}
                </View>
              )
            })}
            {points.length > 1 && (
              <svg
                className='trend-chart__svg-line'
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                preserveAspectRatio='none'
              >
                <polyline
                  points={points
                    .map((point, index) => {
                      const x = (index / (points.length - 1 || 1)) * chartWidth
                      const y = paddingTop + ((displayMax - point.weight!) / displayRange) * drawHeight
                      return `${x},${y}`
                    })
                    .join(' ')}
                  fill='none'
                  stroke='#FF8C42'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
            )}
          </View>
          <View className='trend-chart__x-axis'>
            {points.map((point) => (
              <Text key={point.date} className='trend-chart__x-label'>
                {formatDateLabel(point.date)}
              </Text>
            ))}
          </View>
        </View>
      </View>
    )
  }

  const renderAppetiteChart = () => {
    if (appetitePoints.length === 0) {
      return (
        <View className='trend-chart__empty'>
          <Text className='trend-chart__empty-text'>暂无食欲数据</Text>
          <Text className='trend-chart__empty-hint'>打卡时记录食欲即可生成趋势图</Text>
        </View>
      )
    }

    return (
      <View className='trend-chart__container'>
        <View className='trend-chart__bar-chart'>
          {appetitePoints.map((point) => (
            <View key={point.date} className={`trend-chart__bar-item${appetiteAbnormalSet.has(point.date) ? ' trend-chart__bar-item--abnormal' : ''}`}>
              <View className='trend-chart__bar-wrap'>
                <View
                  className='trend-chart__bar'
                  style={{
                    height: '100%',
                    backgroundColor: APPETITE_COLORS[point.appetite || 'normal'] || '#52C41A'
                  }}
                />
                {appetiteAbnormalSet.has(point.date) && <View className='trend-chart__bar-mark' />}
              </View>
              <Text className='trend-chart__bar-label'>
                {APPETITE_LABELS[point.appetite || 'normal'] || '未知'}
              </Text>
              <Text className='trend-chart__x-label'>{formatDateLabel(point.date)}</Text>
            </View>
          ))}
        </View>
        <View className='trend-chart__legend'>
          {Object.entries(APPETITE_LABELS).map(([key, label]) => (
            <View key={key} className='trend-chart__legend-item'>
              <View
                className='trend-chart__legend-dot'
                style={{ backgroundColor: APPETITE_COLORS[key] }}
              />
              <Text className='trend-chart__legend-text'>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    )
  }

  const renderStoolChart = () => {
    if (stoolPoints.length === 0) {
      return (
        <View className='trend-chart__empty'>
          <Text className='trend-chart__empty-text'>暂无便便数据</Text>
          <Text className='trend-chart__empty-hint'>打卡时记录便便状态即可生成趋势图</Text>
        </View>
      )
    }

    return (
      <View className='trend-chart__container'>
        <View className='trend-chart__bar-chart'>
          {stoolPoints.map((point) => (
            <View key={point.date} className={`trend-chart__bar-item${stoolAbnormalSet.has(point.date) ? ' trend-chart__bar-item--abnormal' : ''}`}>
              <View className='trend-chart__bar-wrap'>
                <View
                  className='trend-chart__bar'
                  style={{
                    height: '100%',
                    backgroundColor: STOOL_COLORS[point.stool || 'normal'] || '#52C41A'
                  }}
                />
                {stoolAbnormalSet.has(point.date) && <View className='trend-chart__bar-mark' />}
              </View>
              <Text className='trend-chart__bar-label'>
                {STOOL_LABELS[point.stool || 'normal'] || '未知'}
              </Text>
              <Text className='trend-chart__x-label'>{formatDateLabel(point.date)}</Text>
            </View>
          ))}
        </View>
        <View className='trend-chart__legend'>
          {Object.entries(STOOL_LABELS).map(([key, label]) => (
            <View key={key} className='trend-chart__legend-item'>
              <View
                className='trend-chart__legend-dot'
                style={{ backgroundColor: STOOL_COLORS[key] }}
              />
              <Text className='trend-chart__legend-text'>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    )
  }

  return (
    <View className='pet-trends-page'>
      {/* 全小程序统一动态背景层 */}
      <PageBackground />

      <PetSwitcher
        pets={pets}
        currentPetId={currentPet?.id || null}
        onSwitch={handlePetSwitch}
      />

      <View className='pet-trends__time-range'>
        {TIME_RANGE_OPTIONS.map((option) => {
          const locked = !isMember && (option.key === 'month' || option.key === 'quarter')
          return (
            <View
              key={option.key}
              className={`pet-trends__time-btn ${timeRange === option.key ? 'pet-trends__time-btn--active' : ''}${locked ? ' pet-trends__time-btn--locked' : ''}`}
              onClick={() => handleTimeRangeChange(option.key)}
            >
              <Text className='pet-trends__time-btn-text'>{option.label}</Text>
              {locked && <Text className='pet-trends__time-btn-lock'>🔒</Text>}
            </View>
          )
        })}
      </View>

      <ScrollView scrollY className='pet-trends__content' enhanced showScrollbar={false}>
        {/* 主题化：滚动内容统一加内边距包裹层（webview 渲染模式 scroll-view 不支持 padding，内边距放在内部容器上，见 index.scss） */}
        <View className='pet-trends__content-inner'>
        {storeLoading ? (
          <PageLoading text='加载健康数据中...' />
        ) : error ? (
          <PageError message={error} onRetry={loadTrendData} />
        ) : (
          <View className='pet-trends__chart-area'>
            {/* ===== AI 月度小结卡 ===== */}
            <View className='trends-ai-card'>
              <View className='trends-ai-card__head'>
                <View className='trends-ai-card__icon'>
                  <Text className='trends-ai-card__icon-text'>✨</Text>
                </View>
                <Text className='trends-ai-card__title'>AI {monthLabel}月健康小结</Text>
                <View className={`trends-ai-card__badge${hasAbnormal ? ' trends-ai-card__badge--warn' : ''}`}>
                  <View className={`trends-ai-card__badge-dot${hasAbnormal ? ' trends-ai-card__badge-dot--warn' : ''}`} />
                  <Text className='trends-ai-card__badge-text'>{hasAbnormal ? '有异常' : '无异常'}</Text>
                </View>
              </View>
              <Text className='trends-ai-card__text'>{aiSummaryText}</Text>
            </View>

            {/* ===== 体重曲线卡 ===== */}
            <View className='trends-chart-card'>
              <View className='trends-chart-card__head'>
                <View className='trends-chart-card__title-wrap'>
                  <Icon name='scales' size={16} tone='primary' className='trends-chart-card__icon' />
                  <Text className='trends-chart-card__title'>体重曲线</Text>
                </View>
                <View className={`trends-chart-card__metric${weightChangeText && weightChangeText.startsWith('-') ? ' trends-chart-card__metric--down' : ''}`}>
                  <Icon name='chart-line' size={12} tone='primary' className='trends-chart-card__metric-icon' />
                  <Text className='trends-chart-card__metric-text'>
                    近30天 {weightChangeText || '暂无变化'}
                  </Text>
                </View>
              </View>
              {renderWeightChart()}
            </View>

            {/* ===== 食欲趋势卡 ===== */}
            <View className='trends-chart-card'>
              <View className='trends-chart-card__head'>
                <View className='trends-chart-card__title-wrap'>
                  <Icon name='bowl-food' size={16} tone='primary' className='trends-chart-card__icon' />
                  <Text className='trends-chart-card__title'>食欲趋势</Text>
                </View>
                <View className='trends-chart-card__metric'>
                  <Icon name='check-circle' size={12} tone='primary' className='trends-chart-card__metric-icon' />
                  <Text className='trends-chart-card__metric-text'>
                    {appetiteStreak > 0 ? `连续${appetiteStreak}天正常` : '近期有波动'}
                  </Text>
                </View>
              </View>
              {renderAppetiteChart()}
            </View>

            {/* ===== 便便评分卡 ===== */}
            <View className='trends-chart-card'>
              <View className='trends-chart-card__head'>
                <View className='trends-chart-card__title-wrap'>
                  <Icon name='drop' size={16} tone='primary' className='trends-chart-card__icon' />
                  <Text className='trends-chart-card__title'>便便评分</Text>
                </View>
                <View className='trends-chart-card__metric'>
                  <Icon name='star' size={12} tone='primary' className='trends-chart-card__metric-icon' />
                  <Text className='trends-chart-card__metric-text'>
                    {stoolAvgScore ? `平均${stoolAvgScore}分` : '暂无评分'}
                  </Text>
                </View>
              </View>
              {renderStoolChart()}
            </View>

            {/* ===== 异常标记说明 ===== */}
            <View className='trends-note'>
              <Text className='trends-note__icon'>ℹ️</Text>
              <Text className='trends-note__text'>打卡异常天数已在图表中以橙色圆点标记</Text>
            </View>

            {/* ===== 健康报告导出（业务保留） ===== */}
            <View className='export-section'>
              <Button
                className='preview-btn'
                onClick={handlePreviewReport}
                disabled={generating || !currentPet}
              >
                {generating ? '生成中...' : '预览报告'}
              </Button>
              <Button
                className='export-btn'
                onClick={handleExportReport}
                disabled={generating || !currentPet}
              >
                {generating ? '生成中...' : '保存图片'}
              </Button>
              <Button
                className='csv-btn'
                onClick={handleExportCsv}
                disabled={generating || !currentPet}
              >
                {generating ? '生成中...' : '导出CSV'}
              </Button>
              <Button
                className='vet-btn'
                onClick={handleShareToVet}
                disabled={generating || !currentPet}
              >
                分享给兽医
              </Button>
              <Button
                className='share-btn'
                onClick={handleShareTrend}
                disabled={!currentPet || !summary}
              >
                分享趋势
              </Button>
            </View>
          </View>
        )}
        </View>
      </ScrollView>

      <PaywallPopup
        visible={paywallVisible}
        featureName='健康趋势'
        remainingFree={0}
        onUpgrade={() => { setPaywallVisible(false); Taro.navigateTo({ url: '/pagesUser/member/index' }) }}
        onClose={() => setPaywallVisible(false)}
      />

      {showReport && reportData && (
        <View className='report-modal'>
          <View className='modal-overlay' onClick={() => setShowReport(false)} />
          <View className='modal-content'>
            <View className='modal-header'>
              <Text className='modal-title'>健康报告预览</Text>
              <Text className='modal-close' onClick={() => setShowReport(false)}>✕</Text>
            </View>
            <View className='modal-body'>
              <HealthReportPreview data={reportData} />
            </View>
            <View className='modal-footer'>
              <Button className='download-btn' onClick={handleExportReport}>
                保存到相册
              </Button>
            </View>
          </View>
        </View>
      )}

      {showTrendShare && trendShareData && (
        <HealthTrendShareCard
          {...trendShareData}
          inviteCode={inviteCode}
          onShare={handleTrendShareConfirm}
          onClose={handleTrendShareClose}
        />
      )}

      {showNpsSurvey && user && (
        <NpsSurvey
          triggerEvent={npsTriggerEvent}
          onSubmit={(score, feedback) => {
            submitNpsResponse(user.id, score, npsTriggerEvent, feedback)
            setShowNpsSurvey(false)
          }}
          onDismiss={() => {
            dismissNpsSurvey()
            setShowNpsSurvey(false)
          }}
        />
      )}

      <View className='pet-trends__disclaimer'>
        <Text className='pet-trends__disclaimer-text'>{disclaimerText}</Text>
      </View>
    </View>
  )
}
