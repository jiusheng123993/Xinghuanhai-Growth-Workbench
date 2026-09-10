/**
 * 健康报告服务
 *
 * 生成宠物健康报告文本，格式化输出
 */
import { getCheckinsByDateRange } from './checkinService'
import type { PetHealthEntry } from '../memory-body/types/memoryBodyTypes'
import { getVaccineRecords } from './vaccineService'
import { getPetById, type PetProfile } from './petService'
import { requirePetOwnership } from '../utils/petOwnership'
import { formatPetAge, localDateString, parseLocalDate } from '../utils/date'

export interface HealthReport {
  title: string
  generatedAt: string
  pet: {
    name: string
    species: string
    breed: string
    age: string
    weight: string
  }
  period: {
    startDate: string
    endDate: string
    totalDays: number
  }
  checkinStats: {
    totalCheckins: number
    checkinRate: string
    normalDays: number
    anomalyDays: number
    anomalyRate: string
    streakDays: number
  }
  healthMetrics: {
    appetite: { normal: number; decreased: number; none: number; increased: number }
    spirit: { normal: number; low: number; lethargic: number; high: number }
    poop: { normal: number; soft: number; diarrhea: number; constipation: number; bloody: number }
    exercise: { average: number; min: number; max: number }
  }
  anomalies: Array<{
    date: string
    items: string[]
    riskLevel: string
  }>
  vaccines: Array<{
    name: string
    date: string
    status: string
    nextDue?: string
  }>
  riskSummary: {
    emergencyCount: number
    highCount: number
    mediumCount: number
    lowCount: number
    trend: 'improving' | 'stable' | 'declining'
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 按「本地日历日」去重后的天数
 *
 * 2026-09-11 修复：报告里的「打卡率 / 正常天数 / 异常天数」原来都用 **记录条数**
 * （`entries.length`、`normalEntries.length`…），于是一天补记两次就会算出
 * 「打卡率 200%」这种荒谬值，正常/异常天数也会虚高——而这是要导出给兽医看的报告。
 * 统一改成按天去重：一次打卡记录只代表那一天的状况。
 */
function countUniqueDays(list: PetHealthEntry[]): number {
  const days = new Set<string>()
  for (const entry of list) {
    const raw = entry.createdAt
    const d = raw instanceof Date ? raw : new Date(String(raw))
    // 无法解析的记录不参与计数（不给它硬塞一个 1970-01-01）
    if (Number.isNaN(d.getTime())) continue
    days.add(formatDate(d))
  }
  return days.size
}

/**
 * 年龄文案 —— 统一走 utils/date 的 formatPetAge（2026-09-11 收敛）
 *
 * 原实现只精确到「岁」（2岁3个月的宠物也显示「2岁」），且按 UTC 解析出生日期。
 * 现在会带上剩余月份，报告中"年龄: 2岁3个月"比"年龄: 2岁"更准确。
 */
function calculateAge(birthday?: string): string {
  return formatPetAge(birthday, { fallback: '未知' })
}

/**
 * 连续打卡天数（**按天去重**）
 *
 * 2026-09-11 修复：原实现直接遍历**记录**并维护一个 expectedDate 游标 ——
 * 同一天补记两条时会连续命中两次 `diffDays`（第一条 0、第二条 1），
 * 把"连续打卡 3 天"算成 6 天（这份数字会写进给兽医看的报告）。
 * 现在先按本地日历日去重，再在去重后的日期序列上走游标。
 *
 * @param entries - 周期内的打卡记录（顺序任意，内部会排序）
 * @returns 连续天数；首条允许是"今天或昨天"（今天还没打卡不算断，与原实现一致）
 */
function calculateStreak(entries: PetHealthEntry[]): number {
  if (entries.length === 0) return 0

  // 1) 取「本地日历日」并去重、按新→旧排序（YYYY-MM-DD 可直接字典序比较）
  const dayKeys = entries
    .map((e) => localDateString(e.createdAt))
    .filter((d): d is string => !!d)
  const sortedDays = Array.from(new Set(dayKeys)).sort().reverse()

  // 2) 从今天往回走游标
  let streak = 0
  const cursor = parseLocalDate(new Date())!
  const ONE_DAY_MS = 86400000
  for (const dayKey of sortedDays) {
    const expected = localDateString(cursor)!
    const isFirst = streak === 0
    // 首条允许落在"昨天"：今天尚未打卡时不该把昨天之前的连续记录算断
    const yesterday = localDateString(new Date(cursor.getTime() - ONE_DAY_MS))!
    if (dayKey === expected) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    } else if (isFirst && dayKey === yesterday) {
      streak++
      cursor.setDate(cursor.getDate() - 2)
    } else {
      break
    }
  }

  return streak
}

function calculateRiskTrend(entries: PetHealthEntry[]): 'improving' | 'stable' | 'declining' {
  if (entries.length < 4) return 'stable'

  const recent = entries.slice(0, Math.floor(entries.length / 2))
  const older = entries.slice(Math.floor(entries.length / 2))

  const recentRisk = recent.filter((e) => e.hasAnomaly).length / Math.max(recent.length, 1)
  const olderRisk = older.filter((e) => e.hasAnomaly).length / Math.max(older.length, 1)

  if (recentRisk < olderRisk * 0.7) return 'improving'
  if (recentRisk > olderRisk * 1.3) return 'declining'
  return 'stable'
}

export async function generateHealthReport(
  userId: string,
  petId: string,
  days: number = 30
): Promise<HealthReport | null> {
  requirePetOwnership(petId, userId);
  const pet = await getPetById(userId, petId)
  if (!pet) return null

  const endDate = new Date()
  const startDate = new Date()
  // 窗口恰好是「含今天在内的 days 个自然日」（2026-09-11 修复）：
  // 原实现减 `days` 天，而取数区间是**双闭区间**（`>= start && <= end`）→ 实际横跨 days+1 天，
  // 于是"打卡率 = 打卡天数 / days"在打满时能算出 103%（一天补记两次那类"超过 100%"只是被压小）。
  // 改成减 `days - 1` 后，区间天数与分母 days、与报告里的「共 N 天」三者一致。
  startDate.setDate(startDate.getDate() - (days - 1))

  const entries = await getCheckinsByDateRange(petId, userId, formatDate(startDate), formatDate(endDate))
  const vaccines = await getVaccineRecords(petId)

  const sortedEntries = [...entries].sort((a, b) => {
    const da = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt)
    const db = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt)
    return db.getTime() - da.getTime()
  })

  const anomalyEntries = sortedEntries.filter((e) => e.hasAnomaly)
  const normalEntries = sortedEntries.filter((e) => !e.hasAnomaly)

  const appetiteCounts = { normal: 0, decreased: 0, none: 0, increased: 0 }
  const spiritCounts = { normal: 0, low: 0, lethargic: 0, high: 0 }
  const poopCounts = { normal: 0, soft: 0, diarrhea: 0, constipation: 0, bloody: 0 }
  let exerciseTotal = 0
  let exerciseMin = 5
  let exerciseMax = 0

  for (const entry of sortedEntries) {
    if (entry.appetiteLevel >= 4) appetiteCounts.increased++
    else if (entry.appetiteLevel === 3) appetiteCounts.normal++
    else if (entry.appetiteLevel === 2) appetiteCounts.decreased++
    else appetiteCounts.none++

    if (entry.spiritLevel >= 4) spiritCounts.high++
    else if (entry.spiritLevel === 3) spiritCounts.normal++
    else if (entry.spiritLevel === 2) spiritCounts.low++
    else spiritCounts.lethargic++

    if (entry.poopLevel === 5) poopCounts.constipation++
    else if (entry.poopLevel === 4) poopCounts.soft++
    else if (entry.poopLevel === 3) poopCounts.normal++
    else if (entry.poopLevel === 2) poopCounts.diarrhea++
    else poopCounts.bloody++

    exerciseTotal += entry.exerciseLevel
    exerciseMin = Math.min(exerciseMin, entry.exerciseLevel)
    exerciseMax = Math.max(exerciseMax, entry.exerciseLevel)
  }

  const riskLevels = { emergency: 0, high: 0, medium: 0, low: 0 }
  for (const entry of anomalyEntries) {
    if (entry.riskLevel === 'emergency') riskLevels.emergency++
    else if (entry.riskLevel === 'high') riskLevels.high++
    else if (entry.riskLevel === 'medium') riskLevels.medium++
    else riskLevels.low++
  }

  // 全部按「天」去重（见 countUniqueDays 注释）：报告里的天数/比率类指标必须按天算
  const checkinDays = countUniqueDays(entries)
  const normalDayCount = countUniqueDays(normalEntries)
  const anomalyDayCount = countUniqueDays(anomalyEntries)

  return {
    title: `${pet.name} 健康报告`,
    generatedAt: new Date().toISOString(),
    pet: {
      name: pet.name,
      species: pet.species === 'dog' ? '狗狗' : '猫咪',
      breed: pet.breed || '未知',
      age: calculateAge(pet.birthDate),
      weight: pet.weight ? `${pet.weight}kg` : '未知',
    },
    period: {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      totalDays: days,
    },
    checkinStats: {
      totalCheckins: entries.length,
      // 打卡率 = 去重天数 / 周期天数（原来用记录条数，一天两次会算出 >100%）
      checkinRate: `${Math.round((checkinDays / days) * 100)}%`,
      normalDays: normalDayCount,
      anomalyDays: anomalyDayCount,
      // 异常率同样按天算：异常天数 / 打卡天数
      anomalyRate: checkinDays > 0 ? `${Math.round((anomalyDayCount / checkinDays) * 100)}%` : '0%',
      streakDays: calculateStreak(sortedEntries),
    },
    healthMetrics: {
      appetite: appetiteCounts,
      spirit: spiritCounts,
      poop: poopCounts,
      exercise: {
        average: entries.length > 0 ? Math.round((exerciseTotal / entries.length) * 10) / 10 : 0,
        min: exerciseMin,
        max: exerciseMax,
      },
    },
    anomalies: anomalyEntries.slice(0, 20).map((e) => ({
      date: formatDate(e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt)),
      items: e.anomalyItems,
      riskLevel: e.riskLevel || 'low',
    })),
    vaccines: vaccines.slice(0, 20).map((v) => ({
      name: v.category,
      date: v.date,
      status: v.status === 'completed' ? '已完成' : v.status === 'pending' ? '待接种' : '已过期',
      nextDue: v.nextDate || undefined,
    })),
    riskSummary: {
      emergencyCount: riskLevels.emergency,
      highCount: riskLevels.high,
      mediumCount: riskLevels.medium,
      lowCount: riskLevels.low,
      trend: calculateRiskTrend(sortedEntries),
    },
  }
}

export function formatReportAsText(report: HealthReport): string {
  const trendLabel = { improving: '好转中', stable: '稳定', declining: '需关注' }

  return `═══════════════════════════
  ${report.title}
═══════════════════════════

📋 基本信息
  宠物名称: ${report.pet.name}
  品种: ${report.pet.breed}
  物种: ${report.pet.species}
  年龄: ${report.pet.age}
  体重: ${report.pet.weight}

📅 报告周期
  ${report.period.startDate} ~ ${report.period.endDate}
  共 ${report.period.totalDays} 天

📊 打卡统计
  总打卡次数: ${report.checkinStats.totalCheckins}
  打卡率: ${report.checkinStats.checkinRate}
  正常天数: ${report.checkinStats.normalDays}
  异常天数: ${report.checkinStats.anomalyDays}
  异常率: ${report.checkinStats.anomalyRate}
  连续打卡: ${report.checkinStats.streakDays} 天

🏥 健康指标
  食欲: 正常${report.healthMetrics.appetite.normal}次 减退${report.healthMetrics.appetite.decreased}次 亢进${report.healthMetrics.appetite.increased}次 拒食${report.healthMetrics.appetite.none}次
  精神: 正常${report.healthMetrics.spirit.normal}次 低落${report.healthMetrics.spirit.low}次 萎靡${report.healthMetrics.spirit.lethargic}次 兴奋${report.healthMetrics.spirit.high}次
  便便: 正常${report.healthMetrics.poop.normal}次 软便${report.healthMetrics.poop.soft}次 腹泻${report.healthMetrics.poop.diarrhea}次 便秘${report.healthMetrics.poop.constipation}次 血便${report.healthMetrics.poop.bloody}次
  运动: 平均${report.healthMetrics.exercise.average}分 (${report.healthMetrics.exercise.min}-${report.healthMetrics.exercise.max})

⚠️ 风险评估
  紧急: ${report.riskSummary.emergencyCount}次
  高风险: ${report.riskSummary.highCount}次
  中风险: ${report.riskSummary.mediumCount}次
  低风险: ${report.riskSummary.lowCount}次
  趋势: ${trendLabel[report.riskSummary.trend]}

${report.anomalies.length > 0 ? `🔍 异常记录\n${report.anomalies.map((a) => `  ${a.date}: ${a.items.join('、')} (${a.riskLevel})`).join('\n')}\n` : ''}
${report.vaccines.length > 0 ? `💉 疫苗记录\n${report.vaccines.map((v) => `  ${v.name}: ${v.date} (${v.status})${v.nextDue ? ` → 下次: ${v.nextDue}` : ''}`).join('\n')}\n` : ''}
═══════════════════════════
   🐱 团团 · 星河宠记 AI 宠物管家
  报告生成时间: ${formatDate(new Date(report.generatedAt))}
═══════════════════════════`
}
