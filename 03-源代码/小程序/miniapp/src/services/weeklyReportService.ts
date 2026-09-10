/**
 * 周报服务
 *
 * 生成宠物健康周报，汇总一周健康数据
 * 优先从后端 API 获取真实数据，模板生成作为降级兜底
 */
import { api } from './api'
import type { PetProfile } from './petService'
import type { PetMoment } from '../types/familyTypes'

interface WeeklyReportData {
  petName: string
  species: string
  breed?: string
  score: number
  scoreTrend: 'up' | 'down' | 'stable'
  checkinDays: number
  anomalyDays: number
  streak: number
  recentMoments: PetMoment[]
}

interface WeeklyReport {
  title: string
  summary: string
  highlights: string[]
  concerns: string[]
  suggestions: string[]
  overallMood: 'excellent' | 'good' | 'fair' | 'concerning'
}

const POSITIVE_ADJECTIVES = ['出色', '优秀', '很棒', '稳定', '良好', '不错']
const CONCERNING_ADJECTIVES = ['需要关注', '有些波动', '略有下滑', '需要注意']
const SPECIES_LABELS: Record<string, string> = { cat: '猫咪', dog: '狗狗' }

function getOverallMood(score: number, anomalyDays: number): WeeklyReport['overallMood'] {
  if (score >= 90 && anomalyDays === 0) return 'excellent'
  if (score >= 80 && anomalyDays <= 1) return 'good'
  if (score >= 65 && anomalyDays <= 3) return 'fair'
  return 'concerning'
}

function getMoodEmoji(mood: WeeklyReport['overallMood']): string {
  switch (mood) {
    case 'excellent': return '🌟'
    case 'good': return '😊'
    case 'fair': return '🤔'
    case 'concerning': return '💊'
  }
}

function getMoodLabel(mood: WeeklyReport['overallMood']): string {
  switch (mood) {
    case 'excellent': return '状态出色'
    case 'good': return '状态良好'
    case 'fair': return '需要关注'
    case 'concerning': return '建议调整'
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getSummaryByMood(mood: WeeklyReport['overallMood'], name: string, score: number): string {
  const speciesWord = '毛孩子'
  switch (mood) {
    case 'excellent':
      return pickRandom([
        `${name}这周${speciesWord}状态特别棒！健康分${score}分，所有指标都保持在理想水平。`,
        `太棒了！${name}这周表现得非常出色，健康分${score}分，继续加油！`,
        `${name}这周活力满满，健康分${score}分，看得出你的用心照顾有了回报。`,
      ])
    case 'good':
      return pickRandom([
        `${name}这周整体状态不错，健康分${score}分。有个别小波动但整体稳定。`,
        `${name}这周表现良好，健康分${score}分，继续保持这个节奏就很好。`,
        `${name}这周健康分${score}分，基本稳定，没有什么大问题。`,
      ])
    case 'fair':
      return pickRandom([
        `${name}这周健康分${score}分，有些指标出现了波动，建议多加观察。`,
        `${name}这周状态有些起伏，健康分${score}分，可能需要注意几个方面。`,
        `${name}这周不算太理想，健康分${score}分，有几个地方需要调整。`,
      ])
    case 'concerning':
      return pickRandom([
        `${name}这周健康分只有${score}分，出现了多次异常，建议重点关注。`,
        `${name}这周状态不太好，健康分${score}分，有${speciesWord}需要你的特别关注。`,
        `${name}这周波动较大，健康分${score}分，建议认真看看下面的提醒。`,
      ])
  }
}

function getHighlights(data: WeeklyReportData, mood: WeeklyReport['overallMood']): string[] {
  const highlights: string[] = []
  const speciesWord = SPECIES_LABELS[data.species] || '宠物'

  if (data.checkinDays >= 6) {
    highlights.push(`${data.petName}本周坚持了${data.checkinDays}天打卡，养成好习惯！`)
  }

  if (data.streak >= 7) {
    highlights.push(`连续${data.streak}天健康打卡，毅力满分！`)
  } else if (data.streak >= 3) {
    highlights.push(`已连续打卡${data.streak}天，离7天小目标越来越近了。`)
  }

  if (mood === 'excellent' || mood === 'good') {
    if (data.score >= 85) {
      highlights.push(`健康分${data.score}分，在同品种${speciesWord}中表现优异。`)
    }
  }

  if (data.anomalyDays === 0) {
    highlights.push(`本周无任何异常指标，${speciesWord}非常健康。`)
  }

  const milestoneMoments = data.recentMoments.filter(m => m.type === 'milestone')
  if (milestoneMoments.length > 0) {
    highlights.push(`本周有${milestoneMoments.length}个值得纪念的时刻。`)
  }

  if (highlights.length === 0) {
    highlights.push(`${data.petName}这周按时打卡，我们在一起。`)
  }

  return highlights
}

function getConcerns(data: WeeklyReportData, mood: WeeklyReport['overallMood']): string[] {
  const concerns: string[] = []
  const speciesWord = SPECIES_LABELS[data.species] || '宠物'

  if (data.checkinDays < 3) {
    concerns.push(`本周仅打卡${data.checkinDays}天，建议增加打卡频率，以便及时发现健康变化。`)
  }

  if (data.anomalyDays >= 3) {
    concerns.push(`本周有${data.anomalyDays}天出现异常指标，建议回顾一下近期饮食和环境变化。`)
  } else if (data.anomalyDays >= 1) {
    concerns.push(`本周出现${data.anomalyDays}次异常指标，持续观察后续变化。`)
  }

  if (data.scoreTrend === 'down') {
    concerns.push(`健康分呈下降趋势，从近期数据看需要关注${speciesWord}的整体状态。`)
  }

  if (mood === 'concerning') {
    concerns.push(`多项指标不理想，建议近期带${speciesWord}做一次健康检查。`)
  }

  if (concerns.length === 0 && mood !== 'excellent') {
    concerns.push('整体状态尚可，但还有提升空间。')
  }

  return concerns
}

function getSuggestions(data: WeeklyReportData, mood: WeeklyReport['overallMood']): string[] {
  const suggestions: string[] = []
  const speciesWord = SPECIES_LABELS[data.species] || '宠物'

  if (data.checkinDays < 5) {
    suggestions.push('建议每天坚持打卡，3秒就能完成，帮助追踪健康变化。')
  }

  if (data.anomalyDays >= 2) {
    suggestions.push('出现多次异常时，建议记录异常发生的时间和环境，方便后续分析。')
  }

  if (data.score < 75) {
    suggestions.push('可以尝试调整饮食或增加运动量，看看下周能否改善。')
  }

  if (data.streak < 3) {
    suggestions.push('坚持连续打卡7天有特别成就哦，从今天开始吧！')
  }

  if (suggestions.length === 0) {
    suggestions.push(`继续保持当前节奏，${data.petName}的每一天都值得被记录。`)
    suggestions.push('下周可以尝试给毛孩子换换新玩具或新食谱，增加新鲜感。')
  }

  return suggestions
}

function getSummaryForAllPets(reports: WeeklyReport[], petCount: number): string {
  const excellentCount = reports.filter(r => r.overallMood === 'excellent').length
  const goodCount = reports.filter(r => r.overallMood === 'good').length
  const fairCount = reports.filter(r => r.overallMood === 'fair').length
  const concerningCount = reports.filter(r => r.overallMood === 'concerning').length

  if (petCount === 1) return reports[0]?.summary || ''

  if (concerningCount > 0) {
    return `本周家庭有${concerningCount}只毛孩子需要特别关注，其他成员状态稳定。`
  }

  if (excellentCount === petCount) {
    return `本周全家人状态都超级棒！${petCount}只毛孩子健康分都在优秀线以上。`
  }

  if (excellentCount + goodCount === petCount) {
    return `本周家庭整体状态良好，${petCount}只毛孩子都在健康轨道上。`
  }

  return `本周家庭健康状态总体平稳，${excellentCount}只出色、${goodCount}只良好、${fairCount}只需关注。`
}

export function generateWeeklyReport(data: WeeklyReportData): WeeklyReport {
  const mood = getOverallMood(data.score, data.anomalyDays)
  const summary = getSummaryByMood(mood, data.petName, data.score)
  const highlights = getHighlights(data, mood)
  const concerns = getConcerns(data, mood)
  const suggestions = getSuggestions(data, mood)

  return {
    title: `${data.petName}的周健康报告`,
    summary,
    highlights,
    concerns,
    suggestions,
    overallMood: mood,
  }
}

export function generateFamilyWeeklySummary(
  reports: WeeklyReport[],
  petCount: number,
): {
  summary: string
  overallMood: WeeklyReport['overallMood']
  highlights: string[]
  concerns: string[]
} {
  const summary = getSummaryForAllPets(reports, petCount)

  const moods = reports.map(r => r.overallMood)
  let overallMood: WeeklyReport['overallMood'] = 'good'
  if (moods.some(m => m === 'concerning')) overallMood = 'concerning'
  else if (moods.some(m => m === 'fair')) overallMood = 'fair'
  else if (moods.every(m => m === 'excellent')) overallMood = 'excellent'

  const highlights: string[] = []
  const concerns: string[] = []

  for (const report of reports) {
    if (report.overallMood === 'excellent') {
      highlights.push(...report.highlights.slice(0, 1))
    }
    if (report.overallMood === 'concerning') {
      concerns.push(...report.concerns.slice(0, 1))
    }
  }

  if (highlights.length === 0 && reports.length > 0) {
    highlights.push(reports[0].highlights[0] || '本周家庭健康记录已生成。')
  }

  return { summary, overallMood, highlights, concerns }
}

export { getMoodEmoji, getMoodLabel, getOverallMood }
export type { WeeklyReport, WeeklyReportData }

// ==================== 后端 API 调用 ====================
// 后端接口返回的是 pet_family_weekly_reports 表的"行结构"（report_data JSONB + ai_insight 等），
// 与页面需要的"视图结构"字段名/层级完全不同（此前页面按视图结构直接消费行结构，
// 导致 report.highlights 等为 undefined，点击进入周报页即崩溃）。
// 因此在 service 层统一做"行结构 → 视图结构"映射，页面只消费映射后的结构。

/** 后端返回的周报原始行结构（与 server WeeklyReportRow 对齐，勿改字段名）
 *  report_data 标记为可选：运行时空值由 mapBackendReportRowToView 兜底为全 0 结构
 */
export interface BackendReportRow {
  id: string
  family_id: string
  week_number: number
  year: number
  report_data?: ReportData
  ai_insight: string | null
  share_card_url: string | null
  created_at: string
}

/** 周报聚合数据（report_data JSONB 的内容结构） */
export interface ReportData {
  health: {
    checkin_count: number
    avg_poop: number
    avg_appetite: number
    avg_spirit: number
    anomaly_count: number
    best_day: string | null
  }
  activities: {
    symptom_checks: number
    food_queries: number
    new_moments: number
    new_milestones: number
  }
  family: {
    feed_count: number
    new_events: number
    active_pets: number
  }
}

/** 页面消费的周报视图结构（由行结构映射而来） */
export interface BackendWeeklyReport {
  id: string
  familyId: string
  /** 该周周一（YYYY-MM-DD，日期横幅用） */
  weekStart: string
  /** 该周周日（YYYY-MM-DD） */
  weekEnd: string
  /** 兼容旧字段名：即 weekStart */
  reportDate: string
  overallMood: 'excellent' | 'good' | 'fair' | 'concerning'
  summary: string
  highlights: string[]
  concerns: string[]
  /** 每只宠物明细：后端聚合暂未存 per-pet 数据，映射后为空数组，后续扩展后填充 */
  petReports: Array<{
    petId: string
    petName: string
    species: string
    breed: string | null
    checkinDays: number
    anomalyDays: number
    streak: number
    score: number
    scoreTrend: 'up' | 'down' | 'stable'
    mood: string
    summary: string
  }>
  /** 后端真实聚合数据（页面 2x2 数据等直接取这里） */
  reportData: ReportData
  aiInsight: string | null
  shareCardUrl: string | null
  createdAt: string
}

/**
 * 由 ISO 年+周数计算该周起止日期（YYYY-MM-DD）
 * 与服务端 getWeekDateRange 同算法：1月4日所在周为第 1 周，周一起始
 */
export function isoWeekDateRange(year: number, weekNumber: number): { weekStart: string; weekEnd: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7 // 周日(0) → 7
  // 第 1 周周一 = 1月4日 - (jan4Day - 1) 天
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1))
  const weekStart = new Date(week1Monday)
  weekStart.setUTCDate(week1Monday.getUTCDate() + (weekNumber - 1) * 7)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6)
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return { weekStart: fmt(weekStart), weekEnd: fmt(weekEnd) }
}

/** 由聚合数据估算本周整体状态（无 per-pet 数据，用家庭级健康聚合近似） */
function moodFromReportData(rd: ReportData): BackendWeeklyReport['overallMood'] {
  const { checkin_count, anomaly_count } = rd.health
  if (anomaly_count >= 3) return 'concerning'
  if (anomaly_count >= 1) return 'fair'
  if (checkin_count >= 5) return 'excellent'
  return 'good'
}

/** 由聚合数据生成本周亮点文案 */
function highlightsFromReportData(rd: ReportData): string[] {
  const out: string[] = []
  if (rd.health.checkin_count > 0) out.push(`本周健康打卡 ${rd.health.checkin_count} 次`)
  if (rd.health.checkin_count > 0 && rd.health.anomaly_count === 0) out.push('本周无异常记录，状态稳定')
  if (rd.health.best_day) out.push(`最佳打卡日 ${rd.health.best_day}`)
  if (rd.activities.new_moments > 0) out.push(`新增 ${rd.activities.new_moments} 条家庭动态`)
  if (rd.activities.new_milestones > 0) out.push(`达成 ${rd.activities.new_milestones} 个成就`)
  if (rd.family.active_pets > 0) out.push(`${rd.family.active_pets} 只宠物本周活跃`)
  if (out.length === 0) out.push('本周暂无打卡记录，下周记得坚持记录哦')
  return out
}

/** 由聚合数据生成需关注事项文案 */
function concernsFromReportData(rd: ReportData): string[] {
  const out: string[] = []
  if (rd.health.anomaly_count > 0) out.push(`本周有 ${rd.health.anomaly_count} 次异常记录，请留意毛孩子状态`)
  if (rd.health.checkin_count === 0) out.push('本周没有健康打卡，建议恢复每日记录')
  return out
}

/** 后端行结构 → 页面视图结构（含对缺失 report_data 的容错） */
export function mapBackendReportRowToView(row: BackendReportRow): BackendWeeklyReport {
  // report_data 缺失时兜底为全 0 结构，避免页面访问 undefined 崩溃
  const rd: ReportData = row.report_data ?? {
    health: { checkin_count: 0, avg_poop: 0, avg_appetite: 0, avg_spirit: 0, anomaly_count: 0, best_day: null },
    activities: { symptom_checks: 0, food_queries: 0, new_moments: 0, new_milestones: 0 },
    family: { feed_count: 0, new_events: 0, active_pets: 0 },
  }
  const { weekStart, weekEnd } = isoWeekDateRange(row.year, row.week_number)
  return {
    id: row.id,
    familyId: row.family_id,
    weekStart,
    weekEnd,
    reportDate: weekStart,
    overallMood: moodFromReportData(rd),
    summary: row.ai_insight || '',
    highlights: highlightsFromReportData(rd),
    concerns: concernsFromReportData(rd),
    petReports: [], // 后端聚合暂未存 per-pet 明细，空数组由页面隐藏"成员小结"区块
    reportData: rd,
    aiInsight: row.ai_insight,
    shareCardUrl: row.share_card_url,
    createdAt: row.created_at,
  }
}

/** 获取最新周报（返回映射后的视图结构；无周报或请求失败返回 null） */
export async function getLatestWeeklyReport(familyId: string): Promise<BackendWeeklyReport | null> {
  try {
    const res = await api.get<BackendReportRow>(
      `/api/families/${familyId}/weekly-reports/latest`
    )
    return res ? mapBackendReportRowToView(res) : null
  } catch {
    return null
  }
}

/** 获取周报列表（每项均映射为视图结构） */
export async function getWeeklyReportList(
  familyId: string,
  page: number = 1,
  pageSize: number = 10,
): Promise<{ items: BackendWeeklyReport[]; total: number }> {
  try {
    const res = await api.get<{ items: BackendReportRow[]; total: number; page: number; page_size: number }>(
      `/api/families/${familyId}/weekly-reports`,
      { page: String(page), page_size: String(pageSize) }
    )
    return { items: (res?.items ?? []).map(mapBackendReportRowToView), total: res?.total ?? 0 }
  } catch {
    return { items: [], total: 0 }
  }
}