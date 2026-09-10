/**
 * 健康趋势服务
 *
 * 宠物健康趋势数据查询（体重/食欲/排便/异常天），月报生成
 *
 * 说明：后端 /api/pets/:petId/trends 系列接口的契约（type/days 单指标序列、report 用 year+month）
 * 与本模块需要的前端多维数据点结构不一致，且 /summary 接口后端未实现。
 * 因此本模块统一基于打卡记录接口（/checkins，契约一致）拉取原始数据，在前端完成
 * 趋势点映射、摘要与月报计算（buildLocalTrendSummary 等），避免 404/400。
 * 待后端补齐 /summary 并调整 report 契约后可切回 API 主路径。
 */
import { getStorage, setStorage } from '../utils/storage'
import type { PetHealthEntry } from './checkinService'
import type { AppetiteLevel, SpiritLevel, PoopLevel, HealthRiskLevel } from '../memory-body/types/memoryBodyTypes'
import { getCheckinsByDateRange } from './checkinService'
import { localDateString } from '../utils/date'

/**
 * 记录所属的「本地日历日」（YYYY-MM-DD）
 *
 * 2026-09-11 全站口径收口：原实现用 toISOString().slice(0,10) / slice(0,10) 取的是 **UTC 日期** ——
 * 东八区 00:00-08:00 的记录会被算成前一天，于是「打卡天数 / 连续天数 / 去重天数」
 * 在早上齐齐差一天，并与已改用本地日的 checkinService、reportService 口径不一致。
 */
function entryDateStr(entry: PetHealthEntry): string {
  return localDateString(entry.createdAt) ?? ''
}

function mapAppetiteLevel(level: AppetiteLevel): 'normal' | 'decreased' | 'increased' | 'none' | 'vomiting' {
  switch (level) {
    case 1: return 'none'
    case 2: return 'decreased'
    case 3: return 'normal'
    case 4: return 'increased'
    case 5: return 'increased'
    case 6: return 'vomiting'
  }
}

function mapSpiritLevel(level: SpiritLevel): 'normal' | 'low' | 'high' | 'lethargic' {
  switch (level) {
    case 1: return 'lethargic'
    case 2: return 'low'
    case 3: return 'normal'
    case 4: return 'normal'
    case 5: return 'high'
  }
}

function mapPoopLevel(level: PoopLevel): 'normal' | 'soft' | 'diarrhea' | 'constipation' | 'bloody' {
  switch (level) {
    case 1: return 'bloody'
    case 2: return 'diarrhea'
    case 3: return 'normal'
    case 4: return 'soft'
    case 5: return 'constipation'
  }
}

export interface TrendDataPoint {
  date: string
  weight?: number
  appetite?: 'normal' | 'decreased' | 'increased' | 'none' | 'vomiting'
  energy?: 'normal' | 'low' | 'high' | 'lethargic'
  stool?: 'normal' | 'soft' | 'diarrhea' | 'constipation' | 'bloody'
  vomiting?: boolean
  riskLevel?: HealthRiskLevel
  hasAbnormal: boolean
}

export interface TrendSummary {
  petId: string
  period: string
  weightTrend: 'stable' | 'increasing' | 'decreasing'
  weightChange: number
  weightChangePercent: number
  appetiteStats: Record<string, number>
  stoolStats: Record<string, number>
  abnormalDays: number
  totalDays: number
  aiAnalysis: string
}

export interface MonthlyReport {
  petId: string
  month: string
  summary: TrendSummary
  highlights: string[]
  concerns: string[]
  recommendations: string[]
}

function getTrendStorageKey(petId: string): string {
  return `trend_${petId}`
}

function getLocalTrendData(petId: string): TrendDataPoint[] {
  const raw = getStorage<TrendDataPoint[]>(getTrendStorageKey(petId))
  // 防御：旧版本曾把后端返回的对象（{type,days,points,trend}）误存进本地缓存，
  // 若读到非数组数据直接视为空，避免后续 .filter() 崩溃
  return Array.isArray(raw) ? raw : []
}

function saveLocalTrendData(petId: string, data: TrendDataPoint[]): void {
  setStorage(getTrendStorageKey(petId), data)
}

function checkinToTrendDataPoint(entry: PetHealthEntry): TrendDataPoint {
  return {
    date: entryDateStr(entry),
    weight: entry.weight,
    appetite: mapAppetiteLevel(entry.appetiteLevel),
    energy: mapSpiritLevel(entry.spiritLevel),
    stool: mapPoopLevel(entry.poopLevel),
    vomiting: entry.anomalyItems.includes('other'),
    riskLevel: entry.riskLevel,
    hasAbnormal: entry.riskLevel !== 'low',
  }
}

function calculateWeightTrend(dataPoints: TrendDataPoint[]): {
  trend: 'stable' | 'increasing' | 'decreasing'
  change: number
  changePercent: number
} {
  const withWeight = dataPoints.filter((d) => d.weight !== undefined && d.weight !== null)
  if (withWeight.length < 2) {
    return { trend: 'stable', change: 0, changePercent: 0 }
  }

  const sorted = [...withWeight].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0].weight!
  const last = sorted[sorted.length - 1].weight!
  const change = last - first
  const changePercent = first !== 0 ? (change / first) * 100 : 0

  let trend: 'stable' | 'increasing' | 'decreasing' = 'stable'
  if (changePercent > 5) {
    trend = 'increasing'
  } else if (changePercent < -5) {
    trend = 'decreasing'
  }

  return { trend, change, changePercent }
}

function calculateAppetiteStats(dataPoints: TrendDataPoint[]): Record<string, number> {
  const stats: Record<string, number> = { normal: 0, decreased: 0, increased: 0, none: 0 }
  for (const dp of dataPoints) {
    if (dp.appetite) {
      stats[dp.appetite] = (stats[dp.appetite] || 0) + 1
    }
  }
  return stats
}

function calculateStoolStats(dataPoints: TrendDataPoint[]): Record<string, number> {
  const stats: Record<string, number> = {
    normal: 0,
    soft: 0,
    diarrhea: 0,
    constipation: 0,
    bloody: 0,
  }
  for (const dp of dataPoints) {
    if (dp.stool) {
      stats[dp.stool] = (stats[dp.stool] || 0) + 1
    }
  }
  return stats
}

function generateAiAnalysis(
  dataPoints: TrendDataPoint[],
  weightTrend: { trend: string; change: number; changePercent: number },
  appetiteStats: Record<string, number>,
  stoolStats: Record<string, number>,
  abnormalDays: number,
  totalDays: number
): string {
  const parts: string[] = []

  if (totalDays === 0) {
    return '暂无足够数据生成健康分析报告，请坚持每日打卡记录宠物健康状况。'
  }

  if (weightTrend.trend === 'stable') {
    parts.push('体重保持稳定，这是健康的好迹象。')
  } else if (weightTrend.trend === 'increasing') {
    if (weightTrend.changePercent > 20) {
      parts.push(`⚠️ 体重增长${weightTrend.changePercent.toFixed(1)}%，增幅较大，建议关注饮食和运动量。`)
    } else if (weightTrend.changePercent > 10) {
      parts.push(`体重增长${weightTrend.changePercent.toFixed(1)}%，处于关注范围，建议适当控制饮食。`)
    } else {
      parts.push(`体重略有增长（${weightTrend.changePercent.toFixed(1)}%），属于正常波动范围。`)
    }
  } else {
    if (weightTrend.changePercent < -20) {
      parts.push(`⚠️ 体重下降${Math.abs(weightTrend.changePercent).toFixed(1)}%，降幅较大，建议尽快就医检查。`)
    } else if (weightTrend.changePercent < -10) {
      parts.push(`体重下降${Math.abs(weightTrend.changePercent).toFixed(1)}%，处于关注范围，建议密切观察。`)
    } else {
      parts.push(`体重略有下降（${Math.abs(weightTrend.changePercent).toFixed(1)}%），属于正常波动范围。`)
    }
  }

  const appetiteTotal = Object.values(appetiteStats).reduce((a, b) => a + b, 0)
  if (appetiteTotal > 0) {
    const noneRatio = (appetiteStats['none'] || 0) / appetiteTotal
    const decreasedRatio = (appetiteStats['decreased'] || 0) / appetiteTotal
    const normalRatio = (appetiteStats['normal'] || 0) / appetiteTotal

    if (noneRatio > 0.3) {
      parts.push('食欲不振天数占比较高，需要重点关注。')
    } else if (decreasedRatio > 0.3) {
      parts.push('食欲下降天数较多，建议观察是否有其他伴随症状。')
    } else if (normalRatio > 0.7) {
      parts.push('食欲整体正常，饮食状况良好。')
    } else {
      parts.push('食欲偶有波动，整体尚可。')
    }
  }

  const stoolTotal = Object.values(stoolStats).reduce((a, b) => a + b, 0)
  if (stoolTotal > 0) {
    const bloodyCount = stoolStats['bloody'] || 0
    const diarrheaCount = stoolStats['diarrhea'] || 0
    const normalCount = stoolStats['normal'] || 0
    const normalRatio = normalCount / stoolTotal

    if (bloodyCount > 0) {
      parts.push(`🚨 出现${bloodyCount}天便血情况，这是紧急信号，请立即就医！`)
    } else if (diarrheaCount > stoolTotal * 0.3) {
      parts.push('腹泻天数较多，建议就医检查消化系统。')
    } else if (normalRatio > 0.7) {
      parts.push('排便情况整体正常。')
    } else {
      parts.push('排便偶有异常，建议持续观察。')
    }
  }

  if (totalDays > 0) {
    const abnormalRatio = abnormalDays / totalDays
    if (abnormalRatio > 0.5) {
      parts.push('异常天数占比超过50%，整体健康状况需要高度重视。')
    } else if (abnormalRatio > 0.3) {
      parts.push('异常天数占比较高，建议进行全面健康检查。')
    } else if (abnormalRatio < 0.1) {
      parts.push('整体健康状况良好，继续保持！')
    }
  }

  const consecutiveNone = findConsecutiveAbnormal(dataPoints, 'appetite', 'none', 3)
  if (consecutiveNone) {
    parts.push('🚨 检测到连续3天以上完全不吃东西，这是紧急情况，请立即就医！')
  }

  const hasBloody = dataPoints.some((d) => d.stool === 'bloody')
  if (hasBloody) {
    parts.push('🚨 检测到便血记录，这是紧急信号，请立即就医！')
  }

  return parts.join('')
}

function findConsecutiveAbnormal(
  dataPoints: TrendDataPoint[],
  field: 'appetite' | 'stool' | 'energy',
  value: string,
  minDays: number
): boolean {
  const sorted = [...dataPoints].sort((a, b) => a.date.localeCompare(b.date))
  let consecutive = 0
  for (const dp of sorted) {
    if (dp[field] === value) {
      consecutive++
      if (consecutive >= minDays) return true
    } else {
      consecutive = 0
    }
  }
  return false
}

function generateHighlights(
  dataPoints: TrendDataPoint[],
  weightTrend: { trend: string; change: number; changePercent: number },
  appetiteStats: Record<string, number>,
  stoolStats: Record<string, number>
): string[] {
  const highlights: string[] = []

  if (dataPoints.length === 0) return highlights

  if (weightTrend.trend === 'stable') {
    highlights.push('体重保持稳定')
  }

  const appetiteTotal = Object.values(appetiteStats).reduce((a, b) => a + b, 0)
  if (appetiteTotal > 0 && (appetiteStats['normal'] || 0) / appetiteTotal > 0.7) {
    highlights.push('食欲整体良好')
  }

  const stoolTotal = Object.values(stoolStats).reduce((a, b) => a + b, 0)
  if (stoolTotal > 0 && (stoolStats['normal'] || 0) / stoolTotal > 0.7) {
    highlights.push('排便情况正常')
  }

  const abnormalRatio = dataPoints.filter((d) => d.hasAbnormal).length / dataPoints.length
  if (abnormalRatio < 0.1 && dataPoints.length >= 7) {
    highlights.push('整体健康状况优秀')
  }

  return highlights
}

function generateConcerns(
  dataPoints: TrendDataPoint[],
  weightTrend: { trend: string; change: number; changePercent: number },
  appetiteStats: Record<string, number>,
  stoolStats: Record<string, number>
): string[] {
  const concerns: string[] = []

  if (weightTrend.changePercent > 20) {
    concerns.push(`体重增长${weightTrend.changePercent.toFixed(1)}%，需关注`)
  } else if (weightTrend.changePercent < -20) {
    concerns.push(`体重下降${Math.abs(weightTrend.changePercent).toFixed(1)}%，需关注`)
  }

  const appetiteTotal = Object.values(appetiteStats).reduce((a, b) => a + b, 0)
  if (appetiteTotal > 0 && (appetiteStats['none'] || 0) > 0) {
    concerns.push(`有${appetiteStats['none']}天完全不吃东西`)
  }

  const stoolTotal = Object.values(stoolStats).reduce((a, b) => a + b, 0)
  if ((stoolStats['bloody'] || 0) > 0) {
    concerns.push(`出现${stoolStats['bloody']}天便血`)
  }
  if ((stoolStats['diarrhea'] || 0) > 0) {
    concerns.push(`出现${stoolStats['diarrhea']}天腹泻`)
  }

  const abnormalDays = dataPoints.filter((d) => d.hasAbnormal).length
  if (dataPoints.length > 0 && abnormalDays / dataPoints.length > 0.3) {
    concerns.push(`异常天数占比${((abnormalDays / dataPoints.length) * 100).toFixed(0)}%`)
  }

  return concerns
}

function generateRecommendations(
  dataPoints: TrendDataPoint[],
  weightTrend: { trend: string; change: number; changePercent: number },
  appetiteStats: Record<string, number>,
  stoolStats: Record<string, number>
): string[] {
  const recommendations: string[] = []

  if (dataPoints.length < 7) {
    recommendations.push('数据量较少，建议坚持每日打卡以获得更准确的分析')
  }

  if (weightTrend.changePercent > 10) {
    recommendations.push('建议控制饮食并增加运动量')
  } else if (weightTrend.changePercent < -10) {
    recommendations.push('建议增加营养摄入，必要时就医检查')
  }

  const appetiteTotal = Object.values(appetiteStats).reduce((a, b) => a + b, 0)
  if (appetiteTotal > 0 && (appetiteStats['none'] || 0) / appetiteTotal > 0.2) {
    recommendations.push('食欲问题持续存在，建议就医检查')
  }

  const stoolTotal = Object.values(stoolStats).reduce((a, b) => a + b, 0)
  if ((stoolStats['bloody'] || 0) > 0) {
    recommendations.push('便血是紧急信号，请立即就医')
  }
  if ((stoolStats['diarrhea'] || 0) > stoolTotal * 0.3) {
    recommendations.push('腹泻频繁，建议就医检查消化系统')
  }

  if (dataPoints.length >= 30) {
    recommendations.push('建议定期进行年度体检')
  }

  return recommendations
}

/**
 * 按日期升序排序（旧 → 新）
 *
 * 2026-09-11 修复一个页面级的顺序 bug：`getTrendData` 之前**直接透传**打卡接口的顺序，
 * 而云端 `/checkins` 是 `ORDER BY created_at DESC`（新 → 旧）、本地缓存兜底又是另一个方向，
 * 于是消费端（趋势页）的一切"首/尾"假设都可能是反的：
 *   · `points[points.length - 1]` 被当作「最新体重」→ 实际取到**最旧**的；
 *   · 近 30 天体重变化的 first/last 取反 → 变化量符号都可能反；
 *   · 折线图按数组顺序绘制 → x 轴从新到旧。
 * 页面本来就是按"升序"写的（`points[0]` 当最早），所以这里统一成升序是**修复**而非改变约定。
 */
function sortByDateAsc(points: TrendDataPoint[]): TrendDataPoint[] {
  // YYYY-MM-DD 可直接字典序比较；用 slice 复制，避免就地排序污染调用方数组
  return [...points].sort((a, b) => a.date.localeCompare(b.date))
}

export async function getTrendData(
  petId: string,
  startDate: string,
  endDate: string,
  userId?: string
): Promise<TrendDataPoint[]> {
  try {
    // 后端 /trends 接口只返回单指标序列（type/days），且需要 userId 归属校验，
    // 无法一次给出体重/食欲/便便等多维数据点。这里直接基于打卡记录接口
    // （/checkins，契约一致且可用）获取原始数据再本地映射，保证数据完整。
    // 注意：后端 /checkins 只识别 days 参数，startDate/endDate 会被剥离，
    // 云端可能返回窗口外数据，这里映射后按日期范围再过滤一次。
    const checkins = await getCheckinsByDateRange(petId, userId || '', startDate, endDate)
    const trendData = sortByDateAsc(
      checkins
        .map(checkinToTrendDataPoint)
        .filter((d) => d.date >= startDate && d.date <= endDate)
    )
    saveLocalTrendData(petId, trendData)
    return trendData
  } catch (error) {
    // 云端/本地打卡均不可用时，回退到趋势本地缓存（按日期过滤、同样升序）
    const local = getLocalTrendData(petId)
    return sortByDateAsc(local.filter((d) => d.date >= startDate && d.date <= endDate))
  }
}

export async function getTrendSummary(
  petId: string,
  period: 'week' | 'month' | 'quarter',
  userId?: string
): Promise<TrendSummary> {
  const now = new Date()
  let startDate: Date

  switch (period) {
    case 'week':
      startDate = new Date(now)
      startDate.setDate(now.getDate() - 7)
      break
    case 'month':
      startDate = new Date(now)
      startDate.setMonth(now.getMonth() - 1)
      break
    case 'quarter':
      startDate = new Date(now)
      startDate.setMonth(now.getMonth() - 3)
      break
  }

  const startStr = startDate.toISOString().slice(0, 10)
  const endStr = now.toISOString().slice(0, 10)

  // 后端未实现 /trends/summary 接口（404），统一走本地计算：
  // 基于打卡数据生成趋势摘要，避免请求失败报错
  const dataPoints = await getTrendData(petId, startStr, endStr, userId)
  return buildLocalTrendSummary(petId, period, dataPoints)
}

function buildLocalTrendSummary(
  petId: string,
  period: string,
  dataPoints: TrendDataPoint[]
): TrendSummary {
  const weightResult = calculateWeightTrend(dataPoints)
  const appetiteStats = calculateAppetiteStats(dataPoints)
  const stoolStats = calculateStoolStats(dataPoints)
  const abnormalDays = dataPoints.filter((d) => d.hasAbnormal).length
  const totalDays = dataPoints.length

  const aiAnalysis = generateAiAnalysis(
    dataPoints,
    weightResult,
    appetiteStats,
    stoolStats,
    abnormalDays,
    totalDays
  )

  return {
    petId,
    period,
    weightTrend: weightResult.trend,
    weightChange: weightResult.change,
    weightChangePercent: weightResult.changePercent,
    appetiteStats,
    stoolStats,
    abnormalDays,
    totalDays,
    aiAnalysis,
  }
}

export async function getMonthlyReport(
  petId: string,
  month: string,
  userId?: string
): Promise<MonthlyReport> {
  // 后端 /trends/report 使用 year+month 数字参数（month=2026-08 会 400），
  // 且返回结构与前端 MonthlyReport 契约不符，统一走本地生成
  const [year, monthNum] = month.split('-').map(Number)
  const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`
  const lastDay = new Date(year, monthNum, 0).getDate()
  const endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const dataPoints = await getTrendData(petId, startDate, endDate, userId)
  const summary = buildLocalTrendSummary(petId, 'month', dataPoints)

  const weightResult = calculateWeightTrend(dataPoints)
  const appetiteStats = calculateAppetiteStats(dataPoints)
  const stoolStats = calculateStoolStats(dataPoints)

  return {
    petId,
    month,
    summary,
    highlights: generateHighlights(dataPoints, weightResult, appetiteStats, stoolStats),
    concerns: generateConcerns(dataPoints, weightResult, appetiteStats, stoolStats),
    recommendations: generateRecommendations(dataPoints, weightResult, appetiteStats, stoolStats),
  }
}

export async function getWeightTrend(
  petId: string,
  months: number = 3,
  userId?: string
): Promise<TrendDataPoint[]> {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - months)

  const startStr = startDate.toISOString().slice(0, 10)
  const endStr = endDate.toISOString().slice(0, 10)

  const allData = await getTrendData(petId, startStr, endStr, userId)
  return allData.filter((d) => d.weight !== undefined && d.weight !== null)
}

export async function getAppetiteTrend(
  petId: string,
  months: number = 3,
  userId?: string
): Promise<TrendDataPoint[]> {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - months)

  const startStr = startDate.toISOString().slice(0, 10)
  const endStr = endDate.toISOString().slice(0, 10)

  const allData = await getTrendData(petId, startStr, endStr, userId)
  return allData.filter((d) => d.appetite !== undefined)
}

export async function getStoolTrend(
  petId: string,
  months: number = 3,
  userId?: string
): Promise<TrendDataPoint[]> {
  const endDate = new Date()
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - months)

  const startStr = startDate.toISOString().slice(0, 10)
  const endStr = endDate.toISOString().slice(0, 10)

  const allData = await getTrendData(petId, startStr, endStr, userId)
  return allData.filter((d) => d.stool !== undefined)
}

export async function getAbnormalDays(
  petId: string,
  startDate: string,
  endDate: string,
  userId?: string
): Promise<TrendDataPoint[]> {
  const allData = await getTrendData(petId, startDate, endDate, userId)
  return allData.filter((d) => d.hasAbnormal)
}