/**
 * 健康趋势页面
 * AI月度小结 + 体重/食欲/便便趋势图同屏展示，健康报告导出
 *
 * 【2026-09-12 高保真 v2 第 2 波 · 屏 07「健康档案」对齐】
 * 新增（按 v2 逐块落地，数据全部真实派生，无一处造数）：
 *   ① 宽幅页头（插画 + 健康档案 / 宠物名 · 近 30 天）；
 *   ② 体重趋势「近 7 天」柱状速览 +「vs 上周」差值；
 *   ③ 当前体重 / 连续正常天数 两张数据卡；
 *   ④ 健康报告区块（真实周报 / 年报入口 + 导出 PDF / 分享趋势 两枚动作卡）。
 * 保留：AI 月度小结、三条趋势曲线/柱状、异常记录与用药史的会员门禁、导出区五按钮、免责声明。
 *
 * 【2026-09-12 第 4 波 · 打卡记录迁入本页】用户原话：「打卡记录和日记/时光不是一个东西，
 *  你塞在一起了」——原始打卡明细（大便/小便/食欲/精神/体重）从此只在**健康档案页**展示，
 *  时光线只留照片回忆 + 日记。本页因此新增「打卡记录」分区（见 checkinRecords 那一段 effect 与
 *  .trends-checkin-* 一组样式），数据源是既有的 checkinService.getCheckins，没有新接口、没有假数据。
 *
 * 【2026-09-12 第 4b 波 · 日记正文也归到这里】用户看完第 4 波后又指出：「你的打卡记录怎么全部
 *  归类到时光了　吃得好睡得好这个全部都是打卡的吧？？　我哪有填了那么多时光」——
 *  时光页上那些「今天吃得香睡得香，是快乐的一天～」并不是用户写的回忆，而是 diaryService 按
 *  **每条打卡 1:1 自动生成**的正文。所以本波把「自动生成的日记正文 + 6 档心情筛选」也从时光页
 *  搬到本分区：每句正文跟着它自己那条打卡显示，同一行上还能看到它的心情档位、并按心情筛记录。
 *  界面上必须写清这些句子的来源（.trends-checkin-source），不能让用户以为是自己写过的。
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { View, Text, ScrollView, Button, Image } from '@tarojs/components'
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
// 打卡记录（2026-09-12 第 4 波迁入）：明细走既有的 checkinService.getCheckins，不新造接口
import { getCheckins } from '../../services/checkinService'
import type { PetHealthEntry } from '../../memory-body/types/memoryBodyTypes'
// 宠物日记正文（2026-09-12 第 4b 波从时光页迁入）：每条打卡 1:1 自动生成的句子 + 心情档位。
// 【为什么直接复用 diaryService】时光页当年显示的就是它算出来的那批内容，搬过来必须用**同一份映射**，
// 否则同一条打卡在两处会读到两套文案；diaryEngine 也不会因为时光页撤掉而变成孤儿代码。
import { generateDiaryFromEntries, type DiaryRecord } from '../../services/diaryService'
import type { DiaryTone } from '../../types/avatarTypes'
// 页头插画：v2 屏 07 顶部那条「插画 + 标题」宽幅卡。
// 图走 data/illustrations.ts 的服务器 URL 机制（主包只剩约 143KB，塞不进图片），
// 这里直接调 seasonalIllustrationUrl 是为了拿**四季节变体**：Illustration 组件只认
// IllustrationName 联合类型，而 'grid-report' 在 SEASONAL_SLOT 里映射的正是
// health-record-<季>-hero.jpg（v2 用的同一张图），拼出的 URL 与组件内部完全一致。
import { seasonalIllustrationUrl } from '../../data/illustrations'
import { useThemeClass, useThemeKey } from '../../hooks/useThemeClass'

type TimeRange = 'week' | 'month' | 'quarter'
type TrendTab = 'weight' | 'appetite' | 'stool' | 'summary'

export const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: 'week', label: '近1周' },
  { key: 'month', label: '近1月' },
  { key: 'quarter', label: '近3月' }
]

/**
 * 时间范围 → 天数（本轮新增，给 v2 的「近 N 天」副标题与近 7 天窗口计算用）
 *
 * 【为什么 week 记 7 天】`fetchWeightTrend(petId, months)` 的入参是**月数**，
 * week / month 都传 1（见 loadTrendData），所以「近1周」实际是近 1 个月的数据。
 * 卡片副标题必须如实写数据窗口（近 30 天），不能跟着按钮写「近 7 天」——
 * 那会把 30 天的数据说成 7 天的，是**假数据**的一种。
 * 下面 WEEK_WINDOW_DAYS 才是真的 7 天窗口，用于「vs 上周」的两次读数比较（按日期筛，不请求新数据）。
 */
const RANGE_WINDOW_DAYS: Record<TimeRange, number> = { week: 30, month: 30, quarter: 90 }

/** 「vs 上周」的比较窗口：真·7 天（按日期从已取到的数据里筛，不额外发请求） */
const WEEK_WINDOW_DAYS = 7

/** 中文数字（只用到 1~6，用于「X 月第 N 周报告」；超出范围时回退成阿拉伯数字） */
const CN_NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/**
 * 数字 → 中文数字（1~10 走中文，其余原样返回）
 * @param n 数字
 * @returns 例：2 → '二'；12 → '12'
 */
function cnNumeral(n: number): string {
  return n >= 1 && n <= 10 ? CN_NUMERALS[n] : String(n)
}

/**
 * 取某个日期所在的「当月第几周」（1 起算，向上取整）
 * 用于「9 月第 2 周报告」这种真实周报标题 —— 周次由日期算出来，不写死。
 * @param date 目标日期
 * @returns 例：9 月 11 日 → 2
 */
function weekOfMonth(date: Date): number {
  return Math.ceil(date.getDate() / 7)
}

/**
 * 时间窗口 → 起始日（本地日历日的 00:00）
 *
 * 【为什么不用 toISOString()】它是 UTC：东八区 20:00 之后取到的是**前一天**，
 * 窗口会少一天（本项目 utils/date 的 localDateString 就是为这个坑存在的，这里保持同一口径）。
 * @param days 窗口天数
 * @returns 起始日期（本地时间）
 */
function rangeStartDate(days: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (days - 1))
  return d
}

/**
 * 从体重数据点里挑出「窗口内的」并按日期升序排列
 *
 * 先按 date 字符串排序（YYYY-MM-DD 可直接字典序比较），
 * 再按窗口起点过滤 —— 这样索引 0 一定是窗口内最早、末位一定是窗口内最新。
 *
 * ⚠️ **不要简化成「取数组末尾 = 最新」**：云端 /checkins 返回的是 created_at DESC（新→旧），
 * 本地缓存兜底却是插入顺序（旧→新），两个来源方向相反（本页 2026-09-11 修过一次同类 bug）。
 * 这里显式排序，就是为了不再依赖「数组方向」这个隐含前提。
 * @param points 体重数据点
 * @param days 窗口天数（从今天往前数）
 * @returns 升序排列的窗口内数据点（无体重值的点已被调用方过滤掉）
 */
function pickWindowPoints(points: TrendDataPoint[], days: number): TrendDataPoint[] {
  const start = rangeStartDate(days)
  const startKey = localDateString(start)
  if (!startKey) return []
  return points
    .filter((p) => p.weight !== undefined && p.weight !== null && p.date >= startKey)
    .sort((a, b) => a.date.localeCompare(b.date))
}

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

/**
 * 疫苗/用药状态 → 中文标签
 *
 * 【为什么不用原页的写死文案】原 pagesPet/health-report 的「用药史」把每一行都标成
 * 「已完成」、卡片右上角写死「均已按时完成」，但 HealthReportData.vaccines 里其实带
 * `status`（done / pending / overdue）——待接种、已逾期的记录都会被写成「已完成」，是
 * 一眼可见的错。2026-09-12 迁入本页时改为按 status 显示，数据源不变。
 */
const MED_STATUS_LABELS: Record<string, string> = {
  done: '已完成',
  pending: '待接种',
  overdue: '已逾期'
}

/** 疫苗/用药状态 → 贴纸样式后缀（对应 .trends-report-item__tag--* 的三个变体） */
const MED_STATUS_TONES: Record<string, string> = {
  done: 'ok',
  pending: 'warn',
  overdue: 'danger'
}

/**
 * 打卡记录的条数上限（2026-09-12 第 4 波）
 *
 * 【为什么定 30】本页是「健康档案」，打卡明细是长尾数据（活跃用户一年能攒几百条），
 * 全量渲染会让内层 scroll-view 变得极长；30 条约等于最近一个月，是「翻最近的情况」最常用的量。
 * 【上限必须如实告知】到达上限时页面上会明确写出「仅显示最近 N 条（共 M 条）」——
 * 不许让用户以为屏幕上这些就是全部（本项目的硬约束：不造假、不误导）。
 */
const CHECKIN_RECORD_LIMIT = 30

/**
 * 打卡明细的中文标签（数值档位 → 文案）
 *
 * 【为什么在本页再定义一份】打卡页 pagesPet/checkin 的同名映射没有导出（文件内 const），
 * 而任务书的硬约束是「只许改 timeline / trends / 必要的 services」——不能为了复用去动打卡页。
 * 取值口径与打卡页逐字一致（1=带血…5=便秘 等），改动时两处要一起改。
 */
const CHECKIN_POOP_LABELS: Record<number, string> = { 1: '带血', 2: '腹泻', 3: '正常', 4: '偏软', 5: '便秘' }
const CHECKIN_APPETITE_LABELS: Record<number, string> = { 1: '不吃', 2: '少吃', 3: '正常', 4: '多吃', 5: '呕吐' }
const CHECKIN_SPIRIT_LABELS: Record<number, string> = { 1: '萎靡', 2: '安静', 3: '正常', 4: '兴奋', 5: '亢奋' }

/**
 * 一条打卡记录里「小便」的展示文案
 *
 * 【为什么要这么取】pet_health_entries **没有独立的尿检字段**（数据库与前端类型都没有）：
 * 打卡弹窗只在「颜色偏黄 / 频次异常」这两种非正常情况把结论写进 
ote（形如 小便: 颜色偏黄），
 * 正常时什么也不写。所以：
 *   · note 里带「小便」→ 如实展示写下来的那句（去掉前缀，避免与标签重复）；
 *   · 没有相关字样 → 显示「正常」—— 这是**有依据的推断**（弹窗没记异常就是正常档），
 *     而不是编造数据；对应地，hover 不到的边界（用户从别处写的自由备注）不会被误当成尿检结论。
 * 【边界】note 是自由文本，可能同时含大便/小便等多段描述；这里只用正则匹配「小便」那一段。
 */
function formatUrineText(entry: PetHealthEntry): string {
  const note = entry.note || ''
  const matched = /小便[ 　]*[:：][ 　]*([^，,;； 　]+)/.exec(note)
  if (matched && matched[1]) return matched[1].trim()
  return '正常'
}

/**
 * 一条打卡记录 → 展示用的结构化行（2026-09-12 第 4 波）
 *
 * 【为什么在渲染前转一层】页面上要显示「数值 → 中文」的映射结果，而映射表里查不到的值
 * （服务端将来加了新档位、或脏数据）必须有个统一的兜底口径，散在 JSX 里做判断会漏。
 * 【未知档位怎么显示】显示成「未知」而不是空字符串：空着会被读成「没有这项」，「未知」才是真话。
 */
function buildCheckinRecordRow(entry: PetHealthEntry) {
  const poop = CHECKIN_POOP_LABELS[entry.poopLevel as unknown as number]
  const appetite = CHECKIN_APPETITE_LABELS[entry.appetiteLevel as unknown as number]
  const spirit = CHECKIN_SPIRIT_LABELS[entry.spiritLevel as unknown as number]
  return {
    id: entry.id,
    date: localDateString(entry.createdAt) || '',
    poop: poop || '未知',
    urine: formatUrineText(entry),
    appetite: appetite || '未知',
    spirit: spirit || '未知',
    // 体重是可选项（没称就不显示），0 也按「没记录」处理（服务端不会存 0，但脏数据要兜住）
    weight: entry.weight !== undefined && entry.weight !== null && Number(entry.weight) > 0
      ? Number(entry.weight)
      : null,
    note: entry.note || '',
  }
}

/**
 * 心情色板（2026-09-12 第 4b 波：随日记正文从时光页原样搬入）
 *
 * 这五个色是**心情语义色**（开心/平静/疲惫/不舒服/骄傲），不是主题色：
 * 换主题时心情的颜色本身不该跟着变，所以刻意保留 hex、没有改成 var(--*)。
 */
const CHECKIN_TONE_COLORS: Record<string, string> = {
  happy: '#52C41A',
  neutral: '#8C8C8C',
  tired: '#FAAD14',
  sick: '#FF4D4F',
  proud: '#FF8C42',
}

/** 心情中文名（筛选胶囊与每条记录的心情角标共用，避免同一套文案两处各写各的） */
const CHECKIN_TONE_LABELS: Record<string, string> = {
  happy: '开心',
  neutral: '平静',
  tired: '疲惫',
  sick: '不舒服',
  proud: '骄傲',
}

/**
 * 6 档心情筛选（全部 + 5 种心情）—— 2026-09-12 第 4b 波从时光页原样搬入
 *
 * 【它筛的是什么】筛的是 diaryEngine 给每条打卡算出的**心情档位**（不是打卡本身的字段）：
 * 选「开心」= 只看那天团团写成开心口吻的打卡记录。
 * key 用 DiaryTone 收口：diaryEngine 将来新增心情时，这里漏加会被 tsc 直接报出来。
 */
const CHECKIN_TONE_FILTERS: { key: DiaryTone | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'happy', label: '开心' },
  { key: 'neutral', label: '平静' },
  { key: 'tired', label: '疲惫' },
  { key: 'sick', label: '不舒服' },
  { key: 'proud', label: '骄傲' },
]

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
  /**
   * 主题类名：**必须挂在页面自己的根节点上**（全站 41 个页面里，本页 scss 用的主题变量最多）
   *
   * 为什么：小程序端每个页面独立渲染，app 组件的 JSX 不包裹页面节点，挂在 app 层的
   * `.theme-*` 传不进页面；本页此前只用了 useThemeKey() 给页头插画换季，
   * 没挂主题类 → 页面永远吃 styles/_theme.scss 里 page{} 的秋季基线变量，切主题无效。
   * 口径与 pages/creative、pages/mine 一致。
   */
  const themeClass = useThemeClass()
  const { pets, currentPet, fetchPets, switchPet } = usePetStore()
  const { isMember, checkAccess, shouldShowPaywall, markPaywallShown } = useMembership()
  const user = useAuthStore(s => s.user)
  const inviteCode = useShareStore(s => s.inviteCode)
  // 当前主题：页头插画要按季换图（四季主题各一套；starry / grid 回退默认季）
  const themeKey = useThemeKey()
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

  /**
   * 健康报告明细（异常记录 / 用药史）的数据与加载态
   * 2026-09-12 IA 第 2b 批：pagesPet/health-report 并入本页后，这两段内容改由本页承载。
   */
  const [healthReport, setHealthReport] = useState<HealthReportData | null>(null)
  const [reportDetailLoading, setReportDetailLoading] = useState(false)

  /**
   * 打卡记录（2026-09-12 第 4 波从时光页迁入）
   *
   * 【数据结构】直接存 PetHealthEntry 原始记录（不预转视图态）：页面渲染时才用
   * buildCheckinRecordRow 转中文，避免「换了文案要重新请求」这种别扭的耦合。
   * 	otal 是**全量条数**（不是数组长度）：界面上要如实写「仅显示最近 30 条（共 M 条）」，
   * 只拿截断后的数组是数不出 M 的。
   * loading 只用于首屏占位；加载失败时退化成空态（不显示假行）。
   */
  const [checkinRecords, setCheckinRecords] = useState<PetHealthEntry[]>([])
  const [checkinRecordsTotal, setCheckinRecordsTotal] = useState(0)
  const [checkinRecordsLoading, setCheckinRecordsLoading] = useState(false)
  /**
   * 每条打卡自动生成的日记正文（2026-09-12 第 4b 波从时光页迁入）
   *
   * 【为什么要单独存一份】日记正文与心情档位是 diaryService 按**全量**打卡算出来的
   * （diaryEngine 会算那天连续打卡几天，只喂截断后的 30 条会让更早的记录写成错的数字），
   * 而列表只渲染最近 CHECKIN_RECORD_LIMIT 条 —— 两者数据量不同，所以分开存：
   * checkinRecords 决定**显示哪些行**，checkinDiaries 决定**每行显示哪句话**。
   * 渲染时按 entry.id 对齐，不会出现文案串到别的记录上。
   */
  const [checkinDiaries, setCheckinDiaries] = useState<DiaryRecord[]>([])
  /**
   * 心情筛选当前值（6 档：all + 5 种心情）—— 2026-09-12 第 4b 波从时光页搬入
   *
   * 【为什么在本页】它筛的是每条打卡自动生成的日记心情档位，日记正文搬到这里之后，
   * 筛选自然跟着走（在时光页它已经筛不动任何东西）。默认 'all' = 不过滤。
   */
  const [checkinToneFilter, setCheckinToneFilter] = useState<DiaryTone | 'all'>('all')

  /**
   * scroll-view 的「滚到某个 id」目标（scroll-into-view）。
   *
   * 【为什么留这个能力】本页比一屏长很多（真机量到内容高约 1978px、视口 753px），
   * 用户在别处（例如「今天」页点的异常提醒）进来时，直接落到「健康报告」这一段会更好用；
   * 另外它也是本页唯一可靠的**程序化滚动**手段（真机上 element.scrollTo / page.scrollTop
   * 两条自动化 API 都滚不动这个 scroll-view，scroll-into-view 才是官方那条路）。
   * 现在默认空串（不滚），只在需要时 set 一下即可复用。
   */
  const [scrollTarget, setScrollTarget] = useState('')

  /** 「查看健康报告」被点了几次（用于在"报告区块 / 导出区"之间交替跳转，见 handleJumpToReport） */
  const jumpCountRef = useRef(0)

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
   * 报告明细的会员门槛（2026-09-12 判断依据，**勿随手改成人人可见**）
   *
   * 原 pagesPet/health-report 对**非会员只渲染会员门禁**（`useMemberGate('health_report')`，
   * featureKey `health_report` 即会员权益「健康报告导出」，免费档 freeValue ❌）。
   * 也就是说「异常记录 / 用药史」这两段在合并前就是会员内容 —— 迁进本页必须继续拦住，
   * 否则等于顺手把付费内容开放出去（任务书明确要求该保留就保留）。
   *
   * 实现口径与本页既有的「近1月 / 近3月」锁一致，统一用 useMembership().isMember：
   * 不引入第二套门禁实现（useMemberGate），也不额外多打一次 checkAccess 网络请求。
   * 代价：membership 还没加载完时 isMember 为 false → 先显示开通引导卡，会员会有极短的一瞬
   * 看到引导（与本页时间范围锁的既有表现相同，不是本次新引入的问题）。
   */
  const canViewReportDetail = isMember

  /**
   * 拉取报告明细数据（异常记录 / 用药史）
   *
   * 与导出/预览走同一个服务 generateHealthReportData —— 这正是两页服务同源的证据，
   * 只是这里只取 symptoms / vaccines 两个字段渲染成区块。
   * 非会员不请求：既省一次四连查（宠物 / 打卡 / 疫苗 / 症状），也不让明细落到内存里被绕过。
   */
  useEffect(() => {
    // 先取出基础值：闭包里直接用 user?.id 会被 TS 判为可能为空（窄化进不了回调）
    const petId = currentPet?.id
    const userId = user?.id
    if (!canViewReportDetail || !userId || !petId) {
      // 非会员 / 未登录 / 未选宠物：清空，避免换账号或删宠物后残留上一份明细
      setHealthReport(null)
      return
    }
    let cancelled = false
    // 切宠物时先清空，避免新宠物的页面上短暂显示上一只宠物的异常记录
    setHealthReport(null)
    setReportDetailLoading(true)
    ;(async () => {
      try {
        const detail = await generateHealthReportData(userId, petId)
        if (!cancelled) setHealthReport(detail || null)
      } catch (err) {
        // 明细失败不打断整页：区块退化成空态，趋势图与导出入口照常可用
        logger.error('Trends', 'Failed to load health report detail', err)
        if (!cancelled) setHealthReport(null)
      } finally {
        if (!cancelled) setReportDetailLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [canViewReportDetail, user?.id, currentPet?.id])

  /**
   * 拉取当前宠物的打卡记录（2026-09-12 第 4 波从时光页迁入）
   *
   * 【数据源】checkinService.getCheckins(petId, userId) —— 与打卡页、时光页、健康报告用的是
   * **同一个既有接口**，不新造接口、不造假示例数据（任务书硬约束）。
   * 【排序】服务端返回 created_at DESC（新→旧），这里**再做一次本地排序**：
   * 本分区明确承诺「按日期倒序」，把顺序建立在接口实现细节上是脆的（换库/加分页就会乱）；
   * 排序键用本地日历日字符串，等长可直接字典序比较。
   * 【截断】只把最近 CHECKIN_RECORD_LIMIT 条放进 state，同时把全量条数单独记下来 ——
   * 界面据此如实写「仅显示最近 30 条（共 M 条）」。
   * 【失败语义】接口失败时退化为空数组 + 总数 0，界面走空态（绝不显示假行）。
   * 【竞态】与健康报告明细同款 cancelled 守卫：切宠物/切账号时旧响应必须丢弃，
   * 否则新宠物的页面上会闪过上一只的打卡记录。
   */
  useEffect(() => {
    const petId = currentPet?.id
    const userId = user?.id
    if (!petId || !userId) {
      // 未登录 / 未选宠物：清空，避免换账号或删宠物后残留上一份记录
      setCheckinRecords([])
      setCheckinRecordsTotal(0)
      setCheckinDiaries([])
      return
    }
    let cancelled = false
    // 切宠物时先清空，避免新宠物的页面上短暂显示上一只的打卡记录
    setCheckinRecords([])
    setCheckinRecordsTotal(0)
    // 日记正文同理清空：它和 checkinRecords 是同一次请求的两副面孔，不能一头新一头旧
    setCheckinDiaries([])
    // 心情筛选也归零：上一只宠物选中的「开心」不该带到新宠物的记录上
    setCheckinToneFilter('all')
    setCheckinRecordsLoading(true)
    ;(async () => {
      try {
        const entries = await getCheckins(petId, userId)
        if (cancelled) return
        const sorted = [...entries].sort((a, b) =>
          (localDateString(b.createdAt) || '').localeCompare(localDateString(a.createdAt) || ''),
        )
        setCheckinRecords(sorted.slice(0, CHECKIN_RECORD_LIMIT))
        setCheckinRecordsTotal(sorted.length)
        // 日记正文：用**全量**（已排序）记录生成，理由见 checkinDiaries 的 state 注释。
        // 第二个参数是生日 —— diaryEngine 靠它判断那天是不是生日，传 null 时按非生日处理。
        setCheckinDiaries(generateDiaryFromEntries(sorted, currentPet?.birthDate ?? null))
      } catch (err) {
        // 明细失败不打断整页：分区退化成空态，趋势图与导出入口照常可用
        logger.error('Trends', 'Failed to load checkin records', err)
        if (!cancelled) {
          setCheckinRecords([])
          setCheckinRecordsTotal(0)
          setCheckinDiaries([])
        }
      } finally {
        if (!cancelled) setCheckinRecordsLoading(false)
      }
    })()
    return () => { cancelled = true }
    // 【为什么依赖里带 birthDate】日记正文要用它判断那天是不是生日；
    // birthDate 是档案里的慢变字段，改动时重拉一次打卡没有任何副作用（同一次请求本来就并发跑着）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPet?.id, currentPet?.birthDate, user?.id])

  /**
   * 打卡记录分区要渲染的行（数值 → 中文文案 + 它自己那句自动生成的日记）
   *
   * 用 useMemo 而不是在 JSX 里 .map 时现算：该映射是纯函数，重渲染（比如切时间范围）
   * 时没必要把 30 条记录重算一遍，也让 JSX 只剩展示逻辑。
   *
   * 【第 4b 波新增日记三件套】diaryText / diaryTone / diaryEmoji 来自 diaryService 的**同一份
   * 1:1 映射**（按 entry.id 对齐，不另算一套）。找不到对应日记时不编文案：
   * 那三件套留空，这一行就只显示打卡明细（渲染层据此跳过日记块）。
   */
  const checkinRecordRows = useMemo(() => {
    const diariesById = new Map(checkinDiaries.map((record) => [record.entry.id, record]))
    return checkinRecords.map((entry) => {
      const diary = diariesById.get(entry.id)
      return {
        ...buildCheckinRecordRow(entry),
        diaryText: diary?.diary.text ?? '',
        diaryTone: (diary?.diary.tone ?? null) as DiaryTone | null,
        diaryEmoji: diary?.diary.emoji ?? '',
      }
    })
  }, [checkinRecords, checkinDiaries])

  /**
   * 心情筛选后的行（第 4b 波：心情筛选从时光页搬到这里）
   *
   * 【筛的范围】只筛已经加载出来的那些行（最多最近 CHECKIN_RECORD_LIMIT 条）——
   * 未加载的老记录不可能被筛出来，页脚的「仅显示最近 30 条（共 M 条）」已经把这件事如实写明，
   * 这里不额外造一个「能筛全量」的假承诺。
   * 【'all' 直通】默认档直接返回原数组，不做多余的 filter 拷贝。
   */
  const visibleCheckinRows = useMemo(
    () => (checkinToneFilter === 'all'
      ? checkinRecordRows
      : checkinRecordRows.filter((row) => row.diaryTone === checkinToneFilter)),
    [checkinRecordRows, checkinToneFilter],
  )

  /**
   * 跳到本页下方的「健康报告」区块
   *
   * 用 scroll-view 的 scrollIntoView（id 见 .trends-report-sec）。
   * 【为什么要先清空再设】scrollIntoView 只在**属性值发生变化**时触发滚动；
   * 连点两次必须让值中间经过一次空值，否则第二次不会动（Taro 对同名属性做的是 diff）。
   *
   * 【为什么第 2 次跳到导出区】用户连点两次的意图是"再往下看看" ——
   * 第 1 次落到报告区块（带周报/年报入口），第 2 次落到最底部的导出区；
   * 之后在两者之间来回。这样这个入口不只是"跳一次就没用了"。
   */
  const handleJumpToReport = useCallback(() => {
    jumpCountRef.current += 1
    const target = jumpCountRef.current % 2 === 1 ? 'trends-report-sec' : 'trends-export-sec'
    setScrollTarget('')
    // 下一帧再设目标值：让「空 → 目标」这一次变化真正落在视图层，连点也能重复生效
    setTimeout(() => setScrollTarget(target), 0)
  }, [])

  /** 非会员点「开通会员」：复用本页支付墙（与时间范围锁同一套交互，不另做引导页） */
  const handleOpenReportDetail = useCallback(() => {
    // 埋点 feature 用 health_report 而不是 trends：这个引导来自报告明细，不是趋势图本身
    trackEvent('show_paywall', { feature: 'health_report' })
    setPaywallVisible(true)
  }, [trackEvent])

  /**
   * 「健康报告」两条列表项的真实周次 / 月份标题
   *
   * v2 写的是「9 月第 2 周报告 / 8 月月报」——那是**截图当天的**日期，不能照抄成硬编码，
   * 否则用户 12 月打开还看到「9 月」。这里按当前日期算：周次 = 当月第几周，月报 = 上一个自然月。
   */
  const reportRowLabels = useMemo(() => {
    const now = new Date()
    const weekLabel = `${now.getMonth() + 1} 月第 ${cnNumeral(weekOfMonth(now))} 周报告`
    // 上一个自然月：1 月要回退到去年 12 月
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return { weekLabel, monthLabel: `${prev.getMonth() + 1} 月月报` }
  }, [])

  /**
   * 跳到真实的报告页（pagesPet 分包内已注册的页面，不新造路由）
   * 两页都自带「当前宠物」取数（weekly-report 用 store 里的宠物、yearly-review 按 currentPet 初始化），
   * 所以这里不需要带参数；用 navigateTo 是因为它们都是**普通页面**，不是 tabBar 页。
   */
  const handleOpenReportPage = useCallback((url: string) => {
    trackEvent('click_report_entry', { target: url })
    Taro.navigateTo({ url }).catch(() => {
      // 分包页跳转失败（如分包还没下载完）时不静默：给一句提示，用户可重试
      Taro.showToast({ title: '页面打开失败，请重试', icon: 'none' })
    })
  }, [trackEvent])

  /** 异常记录（原 health-report 区块 4）：近 30 天症状检查，服务端最多返回 5 条 */
  const reportAnomalies = useMemo(() => healthReport?.symptoms || [], [healthReport])

  /** 用药史（原 health-report 区块 5）：疫苗 / 驱虫等接种记录 */
  const reportMeds = useMemo(() => healthReport?.vaccines || [], [healthReport])

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

  /** 体重卡右侧指标：窗口内体重变化（首末两条按日期比较，不依赖数组方向） */
  const weightChangeText = useMemo(() => {
    const windowPoints = pickWindowPoints(weightChartData?.points || [], RANGE_WINDOW_DAYS[timeRange])
    if (windowPoints.length < 2) return null
    const first = windowPoints[0].weight
    const last = windowPoints[windowPoints.length - 1].weight
    if (first === undefined || last === undefined) return null
    const change = last - first
    return `${change > 0 ? '+' : ''}${change.toFixed(1)}kg`
  }, [weightChartData, timeRange])

  /**
   * v2 块 3「体重趋势」柱状图的柱数据：**近 7 天**的体重记录
   *
   * 【为什么是 7 天而不是跟着 timeRange】v2 这张卡固定写「近 7 天」、横轴是周一…今天。
   * 时间范围切到「近3月」时，如果直接把 90 天的记录铺进来，柱子会有几十根、横轴挤成一团；
   * 而 v2 要的是一张「本周」速览图。所以这里固定取最近 7 天，
   * 卡片副标题也如实写「近 7 天」，不做任何「数据是 90 天、标题写 7 天」的假标注。
   * 7 天的数据本就在 week/month 已取的 30 天窗口内，不额外发请求。
   */
  const weekWeightBars = useMemo(
    () => pickWindowPoints(weightChartData?.points || [], WEEK_WINDOW_DAYS),
    [weightChartData]
  )

  /**
   * v2 块 1 右上角「+0.1 vs 上周」：近 7 天内最早与最新两条体重之差
   *
   * 只有 >=2 条记录才算得出变化；不足 2 条时返回 null，卡片改显示「暂无对比」，
   * 绝不拿 0 冒充「持平」（本项目对「造数」是零容忍）。
   */
  const weekWeightDelta = useMemo(() => {
    if (weekWeightBars.length < 2) return null
    const oldest = weekWeightBars[0].weight
    const newest = weekWeightBars[weekWeightBars.length - 1].weight
    if (oldest === undefined || newest === undefined) return null
    return newest - oldest
  }, [weekWeightBars])

  /**
   * v2 块 5 左卡「当前体重」的数值与日期
   *
   * 用「全部体重记录里日期最大的那条」当作当前体重 —— 先排序再取末位，
   * 不用数组末位（云端 created_at DESC、本地缓存是插入顺序，方向不一致，见 pickWindowPoints 注释）。
   */
  const latestWeightPoint = useMemo(() => {
    const all = (weightChartData?.points || [])
      .filter((p) => p.weight !== undefined && p.weight !== null)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
    return all.length > 0 ? all[all.length - 1] : null
  }, [weightChartData])

  /** 当前体重相对窗口内最早一条的变化（不足 2 条 → null，卡片显示「—」而不是假的 0） */
  const latestWeightDelta = useMemo(() => {
    const windowPoints = pickWindowPoints(weightChartData?.points || [], RANGE_WINDOW_DAYS[timeRange])
    if (windowPoints.length < 2) return null
    const oldest = windowPoints[0].weight
    const newest = windowPoints[windowPoints.length - 1].weight
    if (oldest === undefined || newest === undefined) return null
    return newest - oldest
  }, [weightChartData, timeRange])

  /** 当前体重日期 → 「M/D 记录」（本地日历日，避免 UTC 差一天） */
  const latestWeightDateLabel = useMemo(() => {
    if (!latestWeightPoint) return ''
    const parts = latestWeightPoint.date.split('-')
    return parts.length >= 3 ? `${Number(parts[1])}/${Number(parts[2])} 记录` : '最近一次记录'
  }, [latestWeightPoint])

  /** 页头插画 URL（四季节变体；starry / grid 等非四季主题由 seasonalIllustrationUrl 回退默认季） */
  const heroImageUrl = useMemo(() => seasonalIllustrationUrl('grid-report', themeKey), [themeKey])

  /** 页头副标题的「当前对象」：切宠物即变，不给页头挂固定宠物名 */
  const petSubtitle = currentPet?.name ? `${currentPet.name} · 近 30 天` : '近 30 天'

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
    <View className={`pet-trends-page ${themeClass}`}>
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

      <ScrollView
        scrollY
        className='pet-trends__content'
        enhanced
        showScrollbar={false}
        scrollIntoView={scrollTarget}
      >
        {/* 主题化：滚动内容统一加内边距包裹层（webview 渲染模式 scroll-view 不支持 padding，内边距放在内部容器上，见 index.scss） */}
        <View className='pet-trends__content-inner'>
        {storeLoading ? (
          <PageLoading text='加载健康数据中...' />
        ) : error ? (
          <PageError message={error} onRetry={loadTrendData} />
        ) : (
          <View className='pet-trends__chart-area'>
            {/* ===== v2 块 1：宽幅页头（插画 + 页面名） =====
                v2 屏 07 的页头是「插画 + 健康档案 / 趋势·报告·疫苗·慢病」的宽幅卡。
                页头只写页面名，**不挂固定宠物名** —— 本 App 支持多宠物，挂某一只的名字在
                切换宠物后立刻失效（当前对象由上方 PetSwitcher 与副标题承担）。 */}
            <View className='trends-hero'>
              {heroImageUrl ? (
                <Image className='trends-hero__art' src={heroImageUrl} mode='aspectFill' lazyLoad />
              ) : null}
              {/* 遮罩：插画走 aspectFill 铺满，右侧要压字 —— 没有这层的话浅色插画上白字会读不清 */}
              <View className='trends-hero__scrim' />
              <View className='trends-hero__cap'>
                <Text className='trends-hero__title'>健康档案</Text>
                <Text className='trends-hero__subtitle'>{petSubtitle}</Text>
              </View>
            </View>

            {/* ===== AI 月度小结卡 ===== */}
            <View className='trends-ai-card'>
              <View className='trends-ai-card__head'>
                <View className='trends-ai-card__icon'>
                  <Icon name='sparkle' size={18} color='#FFFFFF' />
                </View>
                <Text className='trends-ai-card__title'>AI {monthLabel}月健康小结</Text>
                <View className={`trends-ai-card__badge${hasAbnormal ? ' trends-ai-card__badge--warn' : ''}`}>
                  <View className={`trends-ai-card__badge-dot${hasAbnormal ? ' trends-ai-card__badge-dot--warn' : ''}`} />
                  <Text className='trends-ai-card__badge-text'>{hasAbnormal ? '有异常' : '无异常'}</Text>
                </View>
              </View>
              <Text className='trends-ai-card__text'>{aiSummaryText}</Text>
              {/* 快速跳到本页下方的「健康报告」区块：
                  小结里出现异常时，用户下一件事就是找报告 —— 中间隔着四条趋势卡，
                  没有这个入口就得手动滚半天。 */}
              <View className='trends-ai-card__more' hoverClass='trends-ai-card__more--hover' onClick={handleJumpToReport}>
                <Text className='trends-ai-card__more-text'>查看健康报告</Text>
                <View className='trends-menu__chev' />
              </View>
            </View>

            {/* ===== v2 块 3：体重趋势（近 7 天柱状速览，v2 的「近 7 天 · kg」+「vs 上周」） =====
                为什么单独做一张、而不是改现有的「体重曲线」卡：曲线上那 130 个选择器与
                物种标准区间带、异常标记都验过，重画的风险远大于收益；v2 这张卡要的是
                「本周速览」这一种新信息（7 根柱 + 与上周的差值），两者并存、语义不重复：
                本卡=本周读数，曲线卡=整个所选区间的走势与品种区间对比。 */}
            <View className='trends-week-card'>
              <View className='trends-week-card__head'>
                <Text className='trends-week-card__title'>体重趋势</Text>
                <Text className='trends-week-card__unit'>近 7 天 · kg</Text>
                {weekWeightDelta !== null ? (
                  <Text className={`trends-week-card__delta trends-week-card__delta--${weekWeightDelta > 0 ? 'up' : weekWeightDelta < 0 ? 'down' : 'flat'}`}>
                    {weekWeightDelta > 0 ? '+' : ''}{weekWeightDelta.toFixed(1)} vs 上周
                  </Text>
                ) : (
                  // 不足 2 条记录时如实说明，不拿 0 冒充「持平」
                  <Text className='trends-week-card__delta trends-week-card__delta--muted'>记录不足，暂无对比</Text>
                )}
              </View>
              {weekWeightBars.length > 0 ? (
                <>
                  <View className='trends-week-card__bars'>
                    {weekWeightBars.map((point) => {
                      /*
                       * 柱高按窗口内 min~max 归一化到 22%~100%：
                       * 体重一周内的波动通常只有零点几公斤，若从 0 起算所有柱子一样高、看不出趋势。
                       * 底部留 22% 是为了柱底标签与柱体之间不贴死。
                       */
                      const weights = weekWeightBars.map((p) => p.weight as number)
                      const min = Math.min(...weights)
                      const max = Math.max(...weights)
                      const span = max - min
                      const ratio = span > 0 ? ((point.weight as number) - min) / span : 1
                      const heightPercent = 22 + ratio * 78
                      return (
                        <View key={point.date} className='trends-week-card__bar-item'>
                          <View
                            className={`trends-week-card__bar${point.hasAbnormal ? ' trends-week-card__bar--abnormal' : ''}`}
                            style={{ height: `${heightPercent}%` }}
                          />
                          <Text className='trends-week-card__bar-label'>{formatDateLabel(point.date)}</Text>
                        </View>
                      )
                    })}
                  </View>
                  <View className='trends-week-card__legend'>
                    <Text className='trends-week-card__legend-text'>
                      最低 {Math.min(...weekWeightBars.map((p) => p.weight as number)).toFixed(1)}kg · 最高 {Math.max(...weekWeightBars.map((p) => p.weight as number)).toFixed(1)}kg
                    </Text>
                    {weekWeightBars.some((p) => p.hasAbnormal) ? (
                      <Text className='trends-week-card__legend-warn'>橙色柱 = 当天有异常</Text>
                    ) : null}
                  </View>
                </>
              ) : (
                /*
                 * 空态用独立类名（.trends-week-card__empty），**不复用 .trend-chart__empty**：
                 * 本卡在 DOM 里排在「体重曲线」卡之前，而 index.test.tsx 用
                 * `container.querySelector('.trend-chart__empty-text')` 取字符串做断言（取的是第一个命中），
                 * 复用同一个类名会把那条既有用例的断言值劫持成这里的文案。
                 */
                <View className='trends-week-card__empty'>
                  <Text className='trends-week-card__empty-text'>近 7 天暂无体重记录</Text>
                  <Text className='trends-week-card__empty-hint'>打卡时记录体重即可生成每周速览</Text>
                </View>
              )}
            </View>

            {/* ===== v2 块 5：当前体重 / 连续正常天数 两张数据卡 =====
                两块都是**真实派生值**：当前体重取全部体重记录里日期最新的一条；
                连续正常天数沿用下方食欲卡的 appetiteStreak（已按自然日去重）。 */}
            <View className='trends-metric-pair'>
              <View className='trends-metric-card'>
                <Text className='trends-metric-card__label'>当前体重</Text>
                <View className='trends-metric-card__value-row'>
                  <Text className='trends-metric-card__value'>
                    {latestWeightPoint ? latestWeightPoint.weight!.toFixed(1) : '—'}
                  </Text>
                  <Text className='trends-metric-card__unit'>kg</Text>
                  {latestWeightDelta !== null ? (
                    <Text className={`trends-metric-card__delta trends-metric-card__delta--${latestWeightDelta > 0 ? 'up' : latestWeightDelta < 0 ? 'down' : 'flat'}`}>
                      {latestWeightDelta > 0 ? '+' : ''}{latestWeightDelta.toFixed(1)}
                    </Text>
                  ) : (
                    <Text className='trends-metric-card__delta trends-metric-card__delta--muted'>—</Text>
                  )}
                </View>
                <Text className='trends-metric-card__hint'>
                  {latestWeightPoint ? latestWeightDateLabel : '还没有体重记录'}
                </Text>
              </View>

              <View className='trends-metric-card'>
                <Text className='trends-metric-card__label'>连续正常天数</Text>
                <View className='trends-metric-card__value-row'>
                  <Text className='trends-metric-card__value'>{appetiteStreak > 0 ? appetiteStreak : '—'}</Text>
                  <Text className='trends-metric-card__unit'>天</Text>
                  <Text className={`trends-metric-card__delta trends-metric-card__delta--${appetiteStreak > 0 ? 'flat' : 'muted'}`}>
                    {appetiteStreak > 0 ? '食欲正常' : '暂无'}
                  </Text>
                </View>
                <Text className='trends-metric-card__hint'>
                  {appetiteStreak > 0 ? '按打卡记录的自然日统计' : '还没有连续正常的记录'}
                </Text>
              </View>
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

            {/* ===== v2 块 6：健康报告（区块标题 + 两条真实报告入口） =====
                两条都指向**已注册的真实页面**（pagesPet 分包，见 app.config.ts）：
                  · 周报 → /pagesPet/weekly-report/index
                  · 年报 → /pagesPet/yearly-review/index（v2 的「月报」在本项目对应的是年度回顾，
                    项目里没有"月报"独立页；AI 月度小结已由上方第 2 块的 <trends-ai-card> 承担）
                ⚠️ 不新造路由、不做只有样子的假行 —— 点了就真的能打开对应报告页。 */}
            <View id='trends-report-sec' className='trends-report-sec'>
              <View className='trends-report-sec__head'>
                <View className='trends-report-sec__dot' />
                <Text className='trends-report-sec__title'>健康报告</Text>
              </View>
              <View className='trends-menu'>
                <View
                  className='trends-menu__row'
                  hoverClass='trends-menu__row--hover'
                  onClick={() => handleOpenReportPage('/pagesPet/weekly-report/index')}
                >
                  <View className='trends-menu__icon trends-menu__icon--a'>
                    <Icon name='clipboard-text' size={18} />
                  </View>
                  <Text className='trends-menu__label'>{reportRowLabels.weekLabel}</Text>
                  {/* chevron 用纯 CSS 画（转 45° 的两条边）：不新增图标名、不依赖图标色 */}
                  <View className='trends-menu__chev' />
                </View>
                <View className='trends-menu__divider' />
                <View
                  className='trends-menu__row'
                  hoverClass='trends-menu__row--hover'
                  onClick={() => handleOpenReportPage('/pagesPet/yearly-review/index')}
                >
                  <View className='trends-menu__icon trends-menu__icon--c'>
                    <Icon name='calendar-check' size={18} />
                  </View>
                  <Text className='trends-menu__label'>{reportRowLabels.monthLabel}</Text>
                  <View className='trends-menu__chev' />
                </View>
              </View>

              {/* v2 块 7：两枚并排动作卡 —— 都必须落到**已有能力**上，不做假按钮 */}
              <View className='trends-action-pair'>
                <View
                  className='trends-action-card'
                  hoverClass='trends-action-card--hover'
                  onClick={handleExportReport}
                >
                  <Icon name='share' size={20} tone='primary' className='trends-action-card__icon' />
                  <Text className='trends-action-card__label'>导出 PDF</Text>
                </View>
                <View
                  className='trends-action-card'
                  hoverClass='trends-action-card--hover'
                  onClick={handleShareTrend}
                >
                  <Icon name='share-network' size={20} tone='primary' className='trends-action-card__icon' />
                  <Text className='trends-action-card__label'>分享趋势</Text>
                </View>
              </View>
            </View>

            {/* ===== 健康报告明细：异常记录 + 用药史 =====
                2026-09-12 IA 第 2b 批：pagesPet/health-report 整页并入本页，这两段是它独有的内容
                （它的「健康总览 / 食欲趋势」与本页既有区块重复，未迁；理由见第 2b 批自述）。 */}
            {canViewReportDetail ? (
              <>
                {/* 异常记录：原 health-report 区块 4（近 30 天症状检查，服务端已截到 5 条） */}
                <View className='trends-chart-card'>
                  <View className='trends-chart-card__head'>
                    <View className='trends-chart-card__title-wrap'>
                      <Icon name='warning' size={16} tone='primary' className='trends-chart-card__icon' />
                      <Text className='trends-chart-card__title'>异常记录</Text>
                    </View>
                    <View className='trends-chart-card__metric'>
                      <Text className='trends-chart-card__metric-text'>近30天 {reportAnomalies.length} 条</Text>
                    </View>
                  </View>
                  {reportDetailLoading && !healthReport ? (
                    <View className='trend-chart__empty'>
                      <Text className='trend-chart__empty-text'>正在读取异常记录…</Text>
                    </View>
                  ) : reportAnomalies.length === 0 ? (
                    <View className='trend-chart__empty'>
                      <Text className='trend-chart__empty-text'>近30天没有异常记录</Text>
                      <Text className='trend-chart__empty-hint'>症状检查判为异常时会汇总到这里</Text>
                    </View>
                  ) : (
                    reportAnomalies.map((item, index) => {
                      // 高风险记录用红贴纸，其余用金贴纸（沿用原 health-report 的「较紧急 / 观察中」二分）
                      const urgent = item.urgencyLevel === 'high' || item.urgencyLevel === 'emergency'
                      return (
                        <View key={item.date + '-' + index} className='trends-report-item'>
                          <View className='trends-report-item__head'>
                            <Text className='trends-report-item__date'>{formatDateLabel(item.date)}</Text>
                            <View className={urgent ? 'trends-report-item__tag trends-report-item__tag--danger' : 'trends-report-item__tag trends-report-item__tag--warn'}>
                              <Text className='trends-report-item__tag-text'>{urgent ? '较紧急' : '观察中'}</Text>
                            </View>
                          </View>
                          <Text className='trends-report-item__title'>{item.symptoms.join('、')}</Text>
                          {item.aiAssessment ? (
                            <Text className='trends-report-item__desc'>{item.aiAssessment}</Text>
                          ) : null}
                        </View>
                      )
                    })
                  )}
                </View>

                {/* 用药史：原 health-report 区块 5（疫苗 / 驱虫等接种记录） */}
                <View className='trends-chart-card'>
                  <View className='trends-chart-card__head'>
                    <View className='trends-chart-card__title-wrap'>
                      <Icon name='syringe' size={16} tone='primary' className='trends-chart-card__icon' />
                      <Text className='trends-chart-card__title'>用药史</Text>
                    </View>
                    <View className='trends-chart-card__metric'>
                      <Text className='trends-chart-card__metric-text'>共 {reportMeds.length} 次</Text>
                    </View>
                  </View>
                  {reportDetailLoading && !healthReport ? (
                    <View className='trend-chart__empty'>
                      <Text className='trend-chart__empty-text'>正在读取用药史…</Text>
                    </View>
                  ) : reportMeds.length === 0 ? (
                    <View className='trend-chart__empty'>
                      <Text className='trend-chart__empty-text'>暂无用药记录</Text>
                      <Text className='trend-chart__empty-hint'>疫苗 / 驱虫记录会汇总到这里</Text>
                    </View>
                  ) : (
                    reportMeds.map((item, index) => {
                      // 状态贴纸按 status 取色（done 绿 / pending 金 / overdue 红），未知状态走中性虚线贴纸
                      const tone = MED_STATUS_TONES[item.status]
                      const toneClass = tone
                        ? 'trends-report-item__tag trends-report-item__tag--' + tone
                        : 'trends-report-item__tag'
                      const dateText = item.dateGiven
                        ? formatDateLabel(item.dateGiven) + ' 接种'
                        : item.dateDue
                          ? '计划 ' + formatDateLabel(item.dateDue)
                          : '日期未记录'
                      return (
                        <View key={item.name + '-' + index} className='trends-report-item'>
                          <View className='trends-report-item__head'>
                            <Text className='trends-report-item__date'>{item.name}</Text>
                            <View className={toneClass}>
                              <Text className='trends-report-item__tag-text'>{MED_STATUS_LABELS[item.status] || '已记录'}</Text>
                            </View>
                          </View>
                          <Text className='trends-report-item__desc'>{dateText}</Text>
                        </View>
                      )
                    })
                  )}
                </View>
              </>
            ) : (
              /* 非会员：一张开通引导卡（明细既不渲染也不请求）。
                 不用整页 MemberGate 组件：它是 60vh 的整页引导，塞进本页滚动流会把内容顶开一大截。 */
              <View className='trends-chart-card trends-report-locked'>
                <View className='trends-chart-card__head'>
                  <View className='trends-chart-card__title-wrap'>
                    <Icon name='crown' size={16} tone='primary' className='trends-chart-card__icon' />
                    <Text className='trends-chart-card__title'>异常记录 · 用药史</Text>
                  </View>
                  <View className='trends-chart-card__metric'>
                    <Text className='trends-chart-card__metric-text'>会员专属</Text>
                  </View>
                </View>
                <Text className='trends-report-locked__desc'>
                  近30天的异常记录与用药史是会员权益，开通后可在本页查看
                </Text>
                <View className='trends-report-locked__btn' onClick={handleOpenReportDetail}>
                  <Text className='trends-report-locked__btn-text'>开通会员</Text>
                </View>
              </View>
            )}

            {/* ===== 打卡记录（2026-09-12 第 4 波迁入；第 4b 波收下日记正文与心情筛选）=====
                用户原话：「打卡记录和日记/时光不是一个东西，你塞在一起了」→ 明细搬来本页；
                看完成果后又说：「你的打卡记录怎么全部归类到时光了…我哪有填了那么多时光」→
                **由打卡自动生成的日记正文与心情档位**也搬来本页，跟着各自那条记录显示。
                【每一条都可追溯】渲染的是 checkinService.getCheckins 返回的真实记录，
                字段直接来自 pet_health_entries（没有示例行、没有占位行）；
                日记正文来自 diaryService 的同一份 1:1 映射（按 entry.id 对齐）。
                【来源必须写明】这些句子不是用户写的，所以卡片顶部有一句人话交代来源
                （.trends-checkin-source），不能让用户以为是自己记过的内容。
                【上限如实告知】超过 CHECKIN_RECORD_LIMIT 条时在页脚写明「仅显示最近 30 条（共 M 条）」，
                不让用户以为屏幕上这些就是全部；心情筛选同样只作用于这 30 条（已在筛选行注明范围）。 */}
            <View className='trends-chart-card trends-checkin-card'>
              <View className='trends-chart-card__head'>
                <View className='trends-chart-card__title-wrap'>
                  <Icon name='checkin' size={16} tone='primary' className='trends-chart-card__icon' />
                  <Text className='trends-chart-card__title'>打卡记录</Text>
                </View>
                {checkinRecordsTotal > 0 && (
                  <View className='trends-chart-card__metric'>
                    <Text className='trends-chart-card__metric-text'>共 {checkinRecordsTotal} 条</Text>
                  </View>
                )}
              </View>

              {/* 来源说明：一句人话告诉用户下面这些句子是团团按打卡自动写的。
                  没有记录时不渲染 —— 空态里本来就没有句子可误解。 */}
              {checkinRecordRows.length > 0 && (
                <Text className='trends-checkin-source'>
                  下面每句话都是团团根据这条打卡自动写的，不是你记的内容
                </Text>
              )}

              {/* 心情筛选（第 4b 波从时光页搬入）：筛的就是每条打卡自动生成的心情档位。
                  只在真有记录时渲染 —— 一条记录都没有时摆一排全部失效的胶囊是假控件。 */}
              {checkinRecordRows.length > 0 && (
                <View className='trends-checkin-filter'>
                  <View className='trends-checkin-filter__head'>
                    <Text className='trends-checkin-filter__title'>按心情筛</Text>
                    <Text className='trends-checkin-filter__count'>筛出 {visibleCheckinRows.length} 条</Text>
                  </View>
                  <ScrollView scrollX className='trends-checkin-filter__scroll' showScrollbar={false}>
                    <View className='trends-checkin-filter__list'>
                      {CHECKIN_TONE_FILTERS.map((f) => (
                        <View
                          key={f.key}
                          className={`trends-checkin-chip${checkinToneFilter === f.key ? ' trends-checkin-chip--active' : ''}`}
                          onClick={() => setCheckinToneFilter(f.key)}
                        >
                          <Text className='trends-checkin-chip__text'>{f.label}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                  {/* 口径写在界面上：筛选只覆盖已加载的这几十条，不假装能筛全部历史 */}
                  <Text className='trends-checkin-filter__hint'>
                    心情来自团团给每条打卡自动写的日记，筛选范围是下面列出的这些记录
                  </Text>
                </View>
              )}

              {checkinRecordsLoading ? (
                <View className='trend-chart__empty'>
                  <Text className='trend-chart__empty-text'>正在加载打卡记录…</Text>
                </View>
              ) : checkinRecordRows.length === 0 ? (
                /* 真实空态：一条都没有时给一句人话 + 指路，不显示 0 行表格 */
                <View className='trend-chart__empty'>
                  <Text className='trend-chart__empty-text'>这只毛孩子还没有打卡记录</Text>
                  <Text className='trend-chart__empty-hint'>去「今天」页完成一次打卡，这里会按日期倒序列出</Text>
                </View>
              ) : visibleCheckinRows.length === 0 ? (
                /* 有记录、但当前心情一条都对不上：轻量提示（不重复上面的大空态文案） */
                <View className='trend-chart__empty'>
                  <Text className='trend-chart__empty-text'>这个心情下暂时没有打卡记录</Text>
                  <Text className='trend-chart__empty-hint'>换一个心情标签看看</Text>
                </View>
              ) : (
                <View className='trends-checkin-list'>
                  {visibleCheckinRows.map((row) => (
                    <View key={row.id} className='trends-checkin-item'>
                      <View className='trends-checkin-item__head'>
                        <Text className='trends-checkin-item__date'>{row.date || '日期未知'}</Text>
                        {row.weight !== null && (
                          <View className='trends-checkin-item__weight'>
                            <Text className='trends-checkin-item__weight-text'>{row.weight} kg</Text>
                          </View>
                        )}
                      </View>
                      <View className='trends-checkin-item__tags'>
                        <View className='trends-checkin-tag'>
                          <Text className='trends-checkin-tag__label'>💩 大便</Text>
                          <Text className='trends-checkin-tag__value'>{row.poop}</Text>
                        </View>
                        <View className='trends-checkin-tag'>
                          <Text className='trends-checkin-tag__label'>💧 小便</Text>
                          <Text className='trends-checkin-tag__value'>{row.urine}</Text>
                        </View>
                        <View className='trends-checkin-tag'>
                          <Text className='trends-checkin-tag__label'>🍖 食欲</Text>
                          <Text className='trends-checkin-tag__value'>{row.appetite}</Text>
                        </View>
                        <View className='trends-checkin-tag'>
                          <Text className='trends-checkin-tag__label'>⚡ 精神</Text>
                          <Text className='trends-checkin-tag__value'>{row.spirit}</Text>
                        </View>
                      </View>
                      {row.note ? (
                        <Text className='trends-checkin-item__note'>📝 {row.note}</Text>
                      ) : null}
                      {/* 这条打卡自动生成的日记正文（2026-09-12 第 4b 波从时光页搬入）。
                          它是团团按打卡写的句子、不是用户记的内容 —— 卡片顶部已统一说明来源，
                          这里只负责把句子与它的心情档位挂在**它自己那条记录**下面。
                          没有对应日记时整块不渲染（不编文案、不留空壳）。 */}
                      {row.diaryText ? (
                        <View className='trends-checkin-diary'>
                          <View className='trends-checkin-diary__head'>
                            <Text className='trends-checkin-diary__label'>🐾 团团的日记</Text>
                            {row.diaryTone && (
                              <View
                                className='trends-checkin-diary__mood'
                                style={{ backgroundColor: CHECKIN_TONE_COLORS[row.diaryTone] || '#8C8C8C' }}
                              >
                                <Text className='trends-checkin-diary__mood-text'>
                                  {row.diaryEmoji} {CHECKIN_TONE_LABELS[row.diaryTone] || row.diaryTone}
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text className='trends-checkin-diary__text'>{row.diaryText}</Text>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
              {/* 截断说明：只有真的被截断时才出现（列表没满就不该写这句）。
                  ⚠️ 分子用 checkinRecordRows.length（已加载的行数），不是 visibleCheckinRows ——
                  心情筛选是视图筛选，不该让「仅显示最近 30 条」这句话在切心情时跟着变样。 */}
              {checkinRecordsTotal > checkinRecordRows.length && (
                <Text className='trends-checkin-limit'>仅显示最近 {checkinRecordRows.length} 条（共 {checkinRecordsTotal} 条）</Text>
              )}
            </View>

            {/* ===== 健康报告导出（业务保留） ===== */}
            <View id='trends-export-sec' className='export-section'>
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

        {/* ===== 医疗免责声明 =====
            【2026-09-12 位置修正】原来这块写在 ScrollView **外面**（页面底部），
            而它自己带 margin、高度约 120rpx 固定压在滚动区下沿 —— 滚动内容再长也永远盖在它下面。
            移进滚动流后：① 长内容不再被它遮挡；② 用户滚到底自然会看到免责声明，
            而免责声明本来就该在"读完数据之后"出现，语义也更顺。 */}
        <View className='pet-trends__disclaimer'>
          <Text className='pet-trends__disclaimer-text'>{disclaimerText}</Text>
        </View>
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

    </View>
  )
}
