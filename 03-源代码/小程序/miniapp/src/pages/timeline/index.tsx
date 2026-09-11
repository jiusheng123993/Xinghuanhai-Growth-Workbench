/**
 * 时光页面
 * 宠物时光线展示与回忆记录（打卡动态 + 真实回忆 pet_moments 合并成一条时间线）
 * 页面结构：固定顶部页头 + 可滚动时间线区域
 *
 * 2026-09-10 调整：回忆录类入口统一收口到「创作 → 回忆录馆」，
 * 本页原有的「回忆精选」三张卡（年度回忆/日常回忆录/纪念Vlog）已整体移除——
 * 后两个与回忆录馆的轻纪念/标准档完全重复，年度回忆则不重复、已迁入回忆录馆。
 * 本页职责收窄为：看时光线 + 记一条回忆。
 *
 * 2026-09-12（IA 第 2c 批）：原独立分包页「宠物日记」（成长日记）已并入本页。
 * 搬入的是 diary 页**独有**的视图 —— diaryEngine 生成的拟人化日记正文 + 6 档心情筛选；
 * 日记正文与页面上的打卡里程碑**共用同一次 checkinService 拉取结果**（见 loadTimelineData ④），
 * 保证同一屏里同一天的数据不会两套口径。
 */
import { View, Text, ScrollView, Image, Textarea, Picker } from '@tarojs/components'
import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { useAnalytics } from '../../hooks/useAnalytics'
import { usePetStore } from '../../stores/petStore'
import { getCheckins } from '../../services/checkinService'
import { timelineService } from '../../services/timelineService'
// 2026-09-12 IA 第 2c 批：diary 页并入本页后，日记正文改由这里生成
// （diaryService → engines/petAvatar/diaryEngine，正是原页面的核心资产）
import { generateDiaryFromEntries, type DiaryRecord } from '../../services/diaryService'
import { resolveAvatarUrl } from '../../services/api'
import { CONFIG } from '../../config'
import { storage } from '../../utils/storage'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { localMonthDay, parseLocalDate, formatPetAge, localDateString } from '../../utils/date'
import { detectPetsInText, toPetTags } from '../../utils/petMatching'
import type { PetProfile } from '../../services/petService'
import type { PetHealthEntry } from '../../memory-body/types/memoryBodyTypes'
import type { PetMoment } from '../../types/familyTypes'
import type { DiaryTone } from '../../types/avatarTypes'
import './index.scss'
import { Icon, EmptyState, PageHero } from '../../components'
import PageBackground from '../../components/PageBackground'
// 自定义 tabBar 的选中态广播 hook（本页 = tabBar 第 2 项，路径写错 tsc 直接报错）
import { useTabBarSelected } from '../../constants/tabBar'
// 【已移除】PetSwitcher：共用回忆录改造后本页不再"按宠物分类"的切换条（2026-09-11）

interface TimelineEvent {
  id: string
  date: string
  title: string
  type: 'milestone' | 'memory' | 'ghost' | 'flashback'
  emoji: string
  photos: string[]
  description: string
  flashbackYear?: number
  /** 对应 pet_moments 表记录 id（仅真实回忆有），用于删除/详情定位 */
  sourceId?: string
  /**
   * 这条记录属于哪只宠物（2026-09-11 共用回忆录改造）
   *
   * 本页从"按当前宠物分开"改成"所有宠物共用一条时间线"之后，
   * 卡片上必须能看出"这是谁的回忆"——否则多宠家庭的列表会分不清归属。
   * 系统生成的里程碑（生日/建档/体重…）与用户手记的回忆都会带上这三个字段。
   */
  petId?: string
  petName?: string
  petEmoji?: string
  /**
   * 这条回忆关联的**全部宠物**（多宠共同回忆，一只以上时有值）
   *
   * 来自服务端写入的 `content.pets`；系统里程碑与单宠回忆只有上面三个单值字段。
   * 卡片按它渲染多枚标签（同一条回忆可以是「🐱 烧鸡」「🐕 烧鸭」共同的）。
   */
  petTags?: { id: string; name: string; emoji: string }[]
}

interface FlashbackMemory {
  title: string
  emoji: string
  description: string
  yearsAgo: number
}

/**
 * 时光线上的「宠物日记」条目（2026-09-12 IA 第 2c 批并入）
 *
 * 复用 diaryService 的 DiaryRecord（日期 + 日记正文 + 来源打卡记录），
 * 额外补上宠物归属三件套 —— 本页是「所有宠物共用一本回忆录」，
 * 卡片上必须能看出这篇日记是谁的（与时间线卡片的宠物标签同一套做法）。
 */
interface TimelineDiaryRecord extends DiaryRecord {
  /** 属于哪只宠物（多宠共用一本时靠它区分归属） */
  petId: string
  petName: string
  petEmoji: string
}

/**
 * 心情色板（随 2026-09-12 并入的 diary 页原样搬入）
 *
 * 这五个色是**心情语义色**（开心/平静/疲惫/不舒服/骄傲），不是主题色：
 * 换主题时心情的颜色本身不该跟着变，所以刻意保留 hex、没有改成 var(--*)。
 */
const TONE_COLORS: Record<string, string> = {
  happy: '#52C41A',
  neutral: '#8C8C8C',
  tired: '#FAAD14',
  sick: '#FF4D4F',
  proud: '#FF8C42',
}

/** 心情中文名（筛选胶囊与卡片角标共用，避免同一套文案两处各写各的） */
const TONE_LABELS: Record<string, string> = {
  happy: '开心',
  neutral: '平静',
  tired: '疲惫',
  sick: '不舒服',
  proud: '骄傲',
}

/**
 * 6 档心情筛选（全部 + 5 种心情）—— diary 页原有能力，原样保留
 *
 * key 用 DiaryTone 收口：diaryEngine 将来新增心情时，这里漏加会被 tsc 直接报出来。
 */
const TONE_FILTERS: { key: DiaryTone | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'happy', label: '开心' },
  { key: 'neutral', label: '平静' },
  { key: 'tired', label: '疲惫' },
  { key: 'sick', label: '不舒服' },
  { key: 'proud', label: '骄傲' },
]

/**
 * 本地日期字符串（YYYY-MM-DD）
 *
 * 2026-09-11 全站口径收口：原实现用 toISOString().slice(0,10) / slice(0,10) 取的是 **UTC 日期** ——
 * 东八区 00:00-08:00 的记录会被算成前一天，于是「打卡天数 / 连续天数 / 去重天数」
 * 在早上齐齐差一天，并与已改用本地日的 checkinService、reportService 口径不一致。
 */
function entryDateStr(entry: PetHealthEntry): string {
  return localDateString(entry.createdAt) ?? ''
}

/**
 * 取「本地时区」的 MM-DD
 *
 * 不能直接 `dateStr.slice(5, 10)`：`pet.createdAt` 是带时间的 ISO 串
 * （如 `2026-09-10T20:00:00.000Z`），slice 拿到的是 **UTC 日期**，
 * 东八区 20:00 之后建档的宠物会被算成前一天 →「N 年前的今天·加入家庭」
 * 会在错误的日子弹横幅（2026-09-11 排查）。统一交给 utils/date 按本地日历日取。
 */
function getMonthDay(dateStr: string): string {
  return localMonthDay(dateStr) ?? ''
}

/**
 * 本地日期字符串（YYYY-MM-DD）
 * 坑点：toISOString() 取的是 UTC 日期，中国时区（UTC+8）晚上 20 点后会比本地日期早一天，
 * 补记日期默认值必须用本地时区，否则用户会"穿越到昨天"
 */
function getLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function findFlashbackMemory(
  pet: PetProfile | null,
  entries: PetHealthEntry[],
): FlashbackMemory | null {
  if (!pet) return null

  const today = new Date()
  const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const currentYear = today.getFullYear()

  const birthday = pet.birthDate
  if (birthday) {
    const birthMD = getMonthDay(birthday)
    if (birthMD === todayMD) {
      const years = currentYear - (parseLocalDate(birthday)?.getFullYear() ?? currentYear)
      if (years >= 1) {
        return {
          title: `${pet.name}的生日`,
          emoji: '🎂',
          description: `${years}年前的今天，${pet.name}来到了这个世界`,
          yearsAgo: years,
        }
      }
    }
  }

  const createdAt = pet.createdAt || ''
  if (createdAt && getMonthDay(createdAt) === todayMD) {
    const adoptYear = parseLocalDate(createdAt)?.getFullYear() ?? currentYear
    const yearsAgo = currentYear - adoptYear
    if (yearsAgo >= 1 && (!birthday || getMonthDay(birthday) !== todayMD)) {
      return {
        title: '加入家庭',
        emoji: '🏠',
        description: `${yearsAgo}年前的今天，${pet.name}成为了家庭的一员`,
        yearsAgo,
      }
    }
  }

  if (entries.length > 0) {
    const sameDayEntries = entries.filter(e => {
      const d = entryDateStr(e)
      const md = getMonthDay(d)
      const year = parseInt(d.slice(0, 4))
      return md === todayMD && year < currentYear
    })

    if (sameDayEntries.length > 0) {
      sameDayEntries.sort((a, b) => entryDateStr(b).localeCompare(entryDateStr(a)))
      const bestEntry = sameDayEntries[0]
      const entryYear = parseInt(entryDateStr(bestEntry).slice(0, 4))
      const yearsAgo = currentYear - entryYear

      if (bestEntry.riskLevel === 'emergency') {
        return {
          title: '渡过难关',
          emoji: '💪',
          description: `${yearsAgo}年前的今天，${pet.name}经历了一次健康预警。现在它很健康，感谢你的悉心照顾。`,
          yearsAgo,
        }
      }

      if (bestEntry.note) {
        return {
          title: '往日时光',
          emoji: '💭',
          description: `${yearsAgo}年前的今天，你记录了：${bestEntry.note.length > 30 ? bestEntry.note.slice(0, 30) + '...' : bestEntry.note}`,
          yearsAgo,
        }
      }

      if (bestEntry.weight !== undefined && bestEntry.weight !== null) {
        return {
          title: '体重记录',
          emoji: '⚖️',
          description: `${yearsAgo}年前的今天，${pet.name}的体重是${bestEntry.weight}kg`,
          yearsAgo,
        }
      }
    }
  }

  return null
}

function generateTimelineFromData(pet: PetProfile | null, entries: PetHealthEntry[]): TimelineEvent[] {
  const events: TimelineEvent[] = []

  if (pet) {
    const birthday = pet.birthDate
    if (birthday) {
      // 年龄文案统一走 utils/date（2026-09-11 审查 P1-1）：
      // 原实现是 `Math.floor(毫秒差 / 365.25天)` 只保留「岁」、且用 new Date('YYYY-MM-DD')（UTC 解析），
      // 结果同一只宠物会出现"时光线说 2 岁、宠物档案说 2岁11个月"——全站最后第二处异口径。
      const ageText = formatPetAge(birthday)
      events.push({
        id: 'milestone-birth',
        date: birthday,
        title: `${pet.name}的生日`,
        type: 'milestone',
        emoji: '🎂',
        photos: [],
        description: `来到这个世界的第一天${ageText ? `，现在已经${ageText}了` : ''}`,
      })
    }

    const createdAt = pet.createdAt || ''
    if (createdAt && (!birthday || createdAt.slice(0, 10) !== pet.birthDate.slice(0, 10))) {
      events.push({
        id: 'milestone-adopt',
        // 只取本地日历日（YYYY-MM-DD）：createdAt 是带时间的 ISO 串，
        // 直接塞进 date 会让卡片上显示成「2024-08-20T02:00:00.000Z」（2026-09-11 出图时发现）。
        // 同时复用 localDateString（本地零点解析），与全站日期口径一致。
        date: localDateString(createdAt) || createdAt.slice(0, 10),
        title: '加入家庭的第1天',
        type: 'milestone',
        emoji: '🏠',
        photos: [],
        description: `欢迎${pet.name}成为家庭的一员`,
      })
    }
  }

  const sortedEntries = [...entries].sort((a, b) => {
    const aDate = entryDateStr(a)
    const bDate = entryDateStr(b)
    return bDate.localeCompare(aDate)
  })

  const recentEntries = sortedEntries.slice(0, 6)
  for (const entry of recentEntries) {
    const dateStr = entryDateStr(entry)
    const note = entry.note || ''

    if (entry.riskLevel === 'emergency') {
      events.push({
        id: `memory-${entry.id}`,
        date: dateStr,
        title: '健康预警',
        type: 'memory',
        emoji: '🚨',
        photos: [],
        description: note || '检测到紧急健康信号，请关注宠物状态',
      })
    } else if (entry.weight !== undefined && entry.weight !== null) {
      events.push({
        id: `memory-${entry.id}`,
        date: dateStr,
        title: `体重记录：${entry.weight}kg`,
        type: 'memory',
        emoji: '⚖️',
        photos: [],
        description: note || '定期体重监测',
      })
    } else if (note) {
      events.push({
        id: `memory-${entry.id}`,
        date: dateStr,
        title: '日常记录',
        type: 'memory',
        emoji: '📝',
        photos: [],
        description: note,
      })
    }
  }

  return events
}

/**
 * 真实回忆（pet_moments）→ 时间线事件
 * 用户手动添加的回忆帖是时光线的核心内容，必须展示（原实现漏加载导致"打不开"）
 * 兼容后端 snake_case 字段（happened_at/created_at）与前端 camelCase（happenedAt/createdAt）
 *
 * 2026-09-11 共用回忆录改造：标题统一为「回忆」，宠物归属改由卡片上的宠物小标签呈现
 * （原先是把宠物名拼进标题「可乐的回忆」，混排后会与标签重复，且没存名字的老数据会显示成"回忆"而丢失归属感）。
 * @param moment - 后端返回的回忆记录
 */
function momentToTimelineEvent(moment: PetMoment): TimelineEvent {
  const raw = moment as PetMoment & Record<string, unknown>
  const content = (moment.content || {}) as {
    description?: string
    petName?: string
    petEmoji?: string
    pets?: { id: string; name: string; emoji: string }[]
  }
  // 补记日期优先取 happened_at（happenedAt），未补记时回退 created_at
  const happened = (raw.happenedAt as string) || (raw.happened_at as string) || ''
  const created = (raw.createdAt as string) || (raw.created_at as string) || ''
  // 只取**本地日历日**：created_at 是带时间的 ISO 串，slice(0,10) 拿到的是 UTC 日期，
  // 东八区 00:00-08:00 记的回忆会被算成前一天（与同页打卡口径 entryDateStr 不一致）。
  // localDateString 内部走 parseLocalDate，同时兼容后端 DATE 型的 'YYYY-MM-DD'。
  const dateStr = localDateString(happened || created) || (happened || created).slice(0, 10)
  const photos = Array.isArray(moment.photos) ? moment.photos : []
  // 多宠共同回忆：服务端写入的 content.pets（老数据没有 → 回退到单值 petName/petEmoji）
  const petTags = Array.isArray(content.pets) && content.pets.length
    ? content.pets.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    : undefined
  return {
    id: `moment-${moment.id}`,
    sourceId: moment.id,
    date: dateStr,
    title: '回忆',
    type: 'memory',
    emoji: petTags?.[0]?.emoji || content.petEmoji || '💭',
    photos,
    description: content.description || (raw.aiSummary as string) || '',
    petId: moment.petId || (raw.pet_id as string) || undefined,
    petName: content.petName || petTags?.[0]?.name,
    petEmoji: content.petEmoji || petTags?.[0]?.emoji,
    petTags,
  }
}

/**
 * 给某只宠物生成的系统事件统一打上「宠物归属」（共用回忆录改造）
 *
 * 【为什么 id 要加宠物前缀】`generateTimelineFromData` 产出的事件 id 是
 * `milestone-birth` / `milestone-adopt` / `memory-<entryId>` 这类**不含宠物**的 id；
 * 多宠合并进同一条时间线后，每只宠物都会有一个 `milestone-birth` ——
 * 直接用会撞 React key（列表错乱），所以统一加上 `${petId}-` 前缀。
 *
 * @param events - 单只宠物的事件
 * @param pet - 该宠物档案（取名字与物种 emoji）
 */
function tagPetEvents(events: TimelineEvent[], pet: PetProfile): TimelineEvent[] {
  const petEmoji = pet.species === 'cat' ? '🐱' : pet.species === 'dog' ? '🐕' : '🐾'
  return events.map((event) => ({
    ...event,
    id: `${pet.id}-${event.id}`,
    petId: pet.id,
    petName: pet.name,
    petEmoji,
  }))
}

export default function TimelinePage() {
  const [showBanner, setShowBanner] = useState(true)
  const [dynamicEvents, setDynamicEvents] = useState<TimelineEvent[]>([])
  // 真实回忆事件（pet_moments），与打卡生成的动态事件分开维护，便于局部刷新
  const [momentEvents, setMomentEvents] = useState<TimelineEvent[]>([])
  /**
   * 宠物日记（2026-09-12 IA 第 2c 批并入）
   *
   * 与 dynamicEvents **同源不同粒度**：dynamicEvents 只取每只宠物最近 6 条打卡做记录/里程碑，
   * 日记则是**每条打卡一篇**（diaryService 1:1 映射）。
   * 两者由同一次 loadTimelineData 一起写入 —— 这正是把 diary 并进来的意义：
   * 同一屏里「打卡了几次」和「有几篇日记」不可能再出现两套数字。
   */
  const [diaryRecords, setDiaryRecords] = useState<TimelineDiaryRecord[]>([])
  /**
   * 心情筛选当前值（6 档：all + 5 种心情）
   *
   * 与既有筛选的关系：本页此前**没有任何筛选控件**（时间线是全量倒序展示），
   * 所以这里不需要做互斥/联动，只作用在日记分区，不会改变时光足迹的显示。
   */
  const [toneFilter, setToneFilter] = useState<DiaryTone | 'all'>('all')
  const [flashback, setFlashback] = useState<FlashbackMemory | null>(null)
  const [flashbackAdded, setFlashbackAdded] = useState(false)
  const themeClass = useThemeClass()
  /**
   * 广播「当前选中的是第 2 个 tab」给自定义 tabBar 组件（时光 = 下标 1）。
   *
   * 【为什么必须由页面主动广播】微信给**每个 tab 页各创建一个**自定义 tabBar 实例
   * （官方文档原话：每个 tab 页下的自定义 tabBar 组件实例是不同的），实例建好后就不随
   * `switchTab` 重新挂载，React 也不会因路由变化自动重渲染它 —— 选中态只能由 tab 页在
   * `useDidShow` 时推进来。
   * 本页下方另有一个自己的 `useDidShow`（刷数据用），两者各挂各的回调、互不影响：
   * 那个回调里有 `isFirstShowRef` 提前 return，若把广播并进去，首次进入本页就不会广播高亮。
   *
   * 位置要求：组件函数体顶层、与其它 hook 同级（无条件调用）。
   */
  useTabBarSelected('/pages/timeline/index')
  /** 埋点：日记卡的「分享这篇日记」沿用 diary 页原有的 share_diary 事件，不另造事件名 */
  const { trackEvent } = useAnalytics()
  const currentPet = usePetStore((s) => s.currentPet)
  const userId = usePetStore((s) => s.userId)
  // 【本页的宠物归属口径（2026-09-11 两轮反复后的最终结论）】
  //   第一轮："多宠物场景不能只固定一只" → 加宠物切换条，整页（列表 + 数字）跟着选中那只变。
  //   第二轮：用户否掉第一轮 —— "时光页面 所有宠物应该共用一个回忆录吧 你怎么做分类了？？"
  //           → 切换条整体移除，回忆与打卡动态合并成**一条共用时间线**，每条卡片上标注是哪只宠物；
  //             速览数字改成全宠口径。
  //   因此这里只保留宠物列表本身，用途收窄为：①冷启动时兜底加载 ②新增回忆时选归属宠物。
  const pets = usePetStore((s) => s.pets)
  const fetchPets = usePetStore((s) => s.fetchPets)
  /**
   * 宠物 id 拼串：既是 loadTimelineData 的依赖（值语义，避免数组引用抖动引发后台白跑），
   * 也是"增删宠物后要不要重新加载"的判据。
   */
  const petsKey = pets.map((p) => p.id).join(',')

  // 新增回忆弹窗状态
  const [showAddMemoryModal, setShowAddMemoryModal] = useState(false)
  const [memoryText, setMemoryText] = useState('')
  /**
   * 这条新回忆记给**哪些**宠物（多选，2026-09-11 多宠共同回忆改造）
   *
   * · 默认当前宠物；第一只即"主宠物"（落库到 pet_moments.pet_id，兼容所有旧读取路径）。
   * · 弹窗里可多选（"两只一起打闹"这类共同回忆不必拆成两条）。
   * · 切换条移除后本页没有"当前宠物"入口，所以归属必须能在弹窗里自己选/自己改。
   */
  const [memoryPetIds, setMemoryPetIds] = useState<string[]>([])
  // 多图支持：本地临时路径数组（最多 9 张），与后端 photos 上限对齐
  const [memoryPhotoPaths, setMemoryPhotoPaths] = useState<string[]>([])
  // 补记日期（YYYY-MM-DD），默认今天，可手动选过去任意一天
  const [memoryDate, setMemoryDate] = useState(() => getLocalDateString())
  const [isMemorySubmitting, setIsMemorySubmitting] = useState(false)
  // AI 生成/润色 loading（防止重复点击）
  const [isAiDescribeLoading, setIsAiDescribeLoading] = useState(false)
  const [isAiPolishLoading, setIsAiPolishLoading] = useState(false)

  // 回忆详情弹窗状态：点击时间线条目时打开
  const [detailEvent, setDetailEvent] = useState<TimelineEvent | null>(null)
  // 【已移除】moments 原始记录状态：全程只写不读（详情用的是 detailEvent、删除用的是 detailEvent.sourceId），
  // 属重构后遗留的只写状态，本次一并清掉（2026-09-11）。

  // 宠物对象的最新引用：回调里读它拿名字/出生日期等展示字段（比把对象塞进依赖更稳）
  const currentPetRef = useRef(currentPet)
  currentPetRef.current = currentPet
  /**
   * 请求序号：丢弃过期响应。
   * 切回本页的瞬间可能同时有两个请求在飞（切走前那个 + 新触发的），
   * 若旧响应（不含刚记的回忆）晚到，就会把新快照覆盖掉——"看不到新记录"当场复现一次
   * （2026-09-11 双 Agent 审查 P1-2）。
   */
  const loadSeqRef = useRef(0)
  /** 是否成功加载过一次：决定加载失败时"保留旧列表"还是"降级为空态" */
  const hasLoadedRef = useRef(false)
  /**
   * 上一次加载时的账号 id。
   * 【为什么要它】hasLoadedRef 的"失败时保留旧列表"只对**同一个账号**成立：
   * 换账号后若回忆接口恰好失败，旧账号的回忆会留在屏幕上（2026-09-11 审查 P3-6）。
   * 账号一变就把标志清零并清空列表，从根上避免跨账号串数据。
   */
  const lastUserIdRef = useRef<string | null>(null)
  // 【已删除】loadedPetIdRef：它原本用来判断"屏幕上这份列表属于哪只宠物"，
  // 以便换宠物后的首次失败要清空、同一只的刷新失败可保留旧列表。
  // 共用回忆录改造后列表是"全账号"的，不存在"列表属于某只宠物"这回事，该 ref 一并移除。

  /**
   * 加载时光线数据：**所有宠物共用的回忆录**（真实回忆 pet_moments + 打卡动态 + 旧时光提醒）
   *
   * 【2026-09-11 改造：从"按当前宠物分开"改为"一本共用回忆录"】
   *   用户原话："时光页面 所有宠物应该共用一个回忆录吧 你怎么做分类了？？"
   *   改前：`getMoments(当前宠物id)` + `getCheckins(当前宠物id)` → 列表与数字都只属于选中那只，
   *         顶部还有宠物切换条（那就是用户说的"分类"）。
   *   改后：回忆一次性拉**本账号下全部**（不传 petId 即为全量），打卡里程碑逐只生成后合并，
   *         每个事件都带宠物归属（卡片上显示"谁的回忆"）——见 tagPetEvents / momentToTimelineEvent。
   *
   * 抽成 useCallback 是为了让「首次进入」与「切回本页」共用同一份加载逻辑（见下方 useDidShow）。
   *
   * 依赖用 pets 的 id 拼串而不是数组引用（2026-09-11 审查 P1-2 的延伸）：
   *   petStore.fetchPets 每次都用服务端新数组重建对象引用，「我的」等 tab 页每次 show 都会 fetchPets，
   *   依赖引用就会让本页在**不可见的后台**白跑一遍全部请求；用 id 串后语义不变、请求数不增。
   */
  const loadTimelineData = useCallback(async () => {
    const seq = ++loadSeqRef.current
    /** 本次请求是否已被更新的请求取代（取代则丢弃结果，不写状态） */
    const isStale = () => seq !== loadSeqRef.current
    // 账号切换（登录/退出/换号）：清空上一账号的列表与"已加载"标志，
    // 否则接口失败时"保留旧列表"会把别人的回忆留在屏幕上（审查 P3-6）
    if (lastUserIdRef.current !== (userId ?? null)) {
      lastUserIdRef.current = userId ?? null
      hasLoadedRef.current = false
      setMomentEvents([])
      setDynamicEvents([])
      // 日记同属上一账号的数据，必须一起清（否则换号后日记分区会残留别人的记录）
      setDiaryRecords([])
      setFlashback(null)
    }
    // 宠物列表以 store 为准；冷启动时 store 可能还没加载，用 currentPet 兜底成"只有一只"
    const storePets = usePetStore.getState().pets
    const petsList = storePets.length ? storePets : (currentPetRef.current ? [currentPetRef.current] : [])
    try {
      if (userId && petsList.length) {
        /* ① 回忆：不传 petId = 拉本账号下**所有宠物**的回忆（共用一本回忆录的关键一行）。
         *
         * 回忆与里程碑**各自兜错**（这是 2026-09-11 改造时特意分开的）：
         * 回忆接口挂掉时，打卡/生日/建档这些里程碑仍然应该照常显示，
         * 不能因为一个接口失败就把整条时间线降级成"只有当前宠物的里程碑"。
         */
        let fetchedMoments: PetMoment[] = []
        let momentsFailed = false
        try {
          fetchedMoments = await timelineService.getMoments()
        } catch {
          momentsFailed = true
        }
        if (isStale()) return
        if (momentsFailed) {
          // 刷新失败：**绝不把已经显示出来的回忆清空**（2026-09-11 审查 P2-1 事故）。
          // 本函数每次切回都会跑，若"失败即置空"，一次网络抖动就会让用户看到
          // "还没有时光记录"——那比"看不到新记录"更严重（数据其实在库里）。
          if (hasLoadedRef.current) {
            Taro.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
          } else {
            setMomentEvents([])
          }
        } else {
          setMomentEvents(fetchedMoments.map(momentToTimelineEvent))
        }

        // ② 打卡动态/里程碑：逐只宠物拉打卡记录生成后合并（宠物数量通常 ≤4，并发拉取）
        //    单只失败不拖垮整页：该只退化为"仅宠物里程碑"（生日/建档），其余照常展示。
        const perPetEvents = await Promise.all(
          petsList.map(async (pet) => {
            try {
              const entries = await getCheckins(pet.id, userId)
              return { pet, entries }
            } catch {
              return { pet, entries: [] as PetHealthEntry[] }
            }
          }),
        )
        if (isStale()) return
        const merged = perPetEvents.flatMap(({ pet, entries }) =>
          tagPetEvents(generateTimelineFromData(pet, entries), pet),
        )
        setDynamicEvents(merged)

        /**
         * ④ 宠物日记（2026-09-12 IA 第 2c 批并入）：用**本次刚拉到的那批打卡记录**生成
         *
         * 【数据源统一决策：跟本页的 service 走，不用 useCheckinStore】
         *   ① 同屏不自相矛盾（本页合并的初衷）——日记与上面的打卡里程碑吃的是同一个
         *      `perPetEvents.entries` 数组、同一次请求，不存在「里程碑 3 条、日记 5 篇」这种两套口径；
         *      也不会出现「接口刷新了、store 还是旧的」导致的半屏新半屏旧。
         *   ② 类型正确 —— PetHealthEntry 正是 generateDiaryFromEntries 的入参类型；
         *      原 diary 页因为 store 里存的是视图态 Checkin，只能 `as any` 硬塞，
         *      一旦服务端字段变了就会静默退化成「一切正常」的文案（checkinStore.ts 注释里记着这个坑）。
         *   ③ 归属正确 —— store 只有「当前宠物」那一只（checkinsPetId），而本页已改成
         *      「所有宠物共用一本回忆录」；用 store 会让日记只剩一只宠物，与页面定位直接冲突。
         *   ④ 失败语义一致 —— 某只宠物打卡拉取失败时 entries 为空数组，
         *      于是它既没有打卡里程碑也没有日记，两边同时缺席而不是一边有一边没有。
         */
        const diaryList = perPetEvents
          .flatMap(({ pet, entries }) =>
            generateDiaryFromEntries(entries, pet.birthDate).map((record) => ({
              ...record,
              petId: pet.id,
              petName: pet.name,
              petEmoji: pet.species === 'cat' ? '🐱' : pet.species === 'dog' ? '🐕' : '🐾',
            })),
          )
          // 多宠混排后必须整体重排：最近的在最上面，与「时光足迹」同一阅读方向
          .sort((a, b) => b.date.localeCompare(a.date))
        setDiaryRecords(diaryList)

        // ③ 旧时光提醒：扫全部宠物，取第一只有"往年今天"的（横幅文案里已含宠物名）
        let memory: FlashbackMemory | null = null
        for (const { pet, entries } of perPetEvents) {
          memory = findFlashbackMemory(pet, entries)
          if (memory) break
        }
        setFlashback(memory)

        hasLoadedRef.current = true
      } else if (currentPetRef.current) {
        // 账号信息还没到位（极少见）：退化为"仅当前宠物的里程碑"，至少不是纯空白
        const pet = currentPetRef.current
        setDynamicEvents(tagPetEvents(generateTimelineFromData(pet, []), pet))
        setMomentEvents([])
        // 这一支连账号都还没有，没拉过打卡 → 日记同步置空，别让上一轮的日记留在屏幕上
        setDiaryRecords([])
        setFlashback(findFlashbackMemory(pet, []))
        hasLoadedRef.current = true
      }
    } catch {
      if (isStale()) return
      // 兜底（正常不会走到：上面两条链路都已各自 try/catch）：
      // 保留旧列表并提示，绝不把用户已经看到的回忆清空。
      // （列表是"全账号共用"的，不再有"保留的旧列表属于别的宠物"那种串号问题，
      //   原先按宠物核对归属的 loadedPetIdRef 判断随之删除。）
      if (hasLoadedRef.current) {
        Taro.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
        return
      }
      if (currentPetRef.current) {
        const pet = currentPetRef.current
        setDynamicEvents(tagPetEvents(generateTimelineFromData(pet, []), pet))
        setMomentEvents([])
        // 同上一支：这里只会在「从未加载成功过」时走到，日记也一并为空
        setDiaryRecords([])
        setFlashback(findFlashbackMemory(pet, []))
      }
    }
    // pets 用 id 串做依赖（值语义）：换宠物/增删宠物都会重载，而数组引用抖动不会
    // （pets 本身从 store 闭包读，不在依赖里，故 eslint 需要这行豁免）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petsKey, userId])

  // 首次进入本页 / 宠物列表变化 / 账号切换时加载
  // 「旧时光提醒 → 添加到时光线」的重置放在这里、而不是放进 loadTimelineData：
  // 该函数现在每次切回都会跑，重置写在里面会让用户刚添加的旧时光条目在切一次 tab 后凭空消失，
  // 而横幅此刻已被关闭（showBanner=false）→ 本页再也点不出这个入口（2026-09-11 审查 P2-2）。
  useEffect(() => {
    setFlashbackAdded(false)
    // 关掉两个弹窗并清空草稿：
    // 「时光」是 tabBar 页、切走再切回**不重挂载**，而原生 tabBar 由客户端渲染在页面
    // fixed 遮罩之上 —— 用户可以开着「新增回忆」弹窗去别的页面（比如宠物档案）换选中宠物再回来。
    // 共用回忆录改造后，回忆的归属由弹窗里自己选的宠物决定（memoryPetIds，可多选），
    // 所以这个 effect 只负责"别把上一轮的草稿留在屏幕上"，不再需要处理归属串号。
    setShowAddMemoryModal(false)
    setMemoryText('')
    setMemoryPhotoPaths([])
    setDetailEvent(null)
    void loadTimelineData()
  }, [loadTimelineData])

  /**
   * 切回本页时重新拉取（2026-09-11 修复「AI 里记了回忆，时光里看不到新记录」）
   *
   * 坑点：「时光」是 tabBar 页面，微信小程序切走再切回**不会重新挂载页面实例**，
   * 上面的 useEffect 不会再执行，列表就永远停在切走前的快照——用户在 AI 页记完回忆
   * 再点「时光」，新记录一直不出现。生产实测证据：2026-09-11 04:11:04 保存回忆
   * 返回 200，之后到 04:15 该用户没有任何 GET /api/timeline/moments 请求，
   * 即页面从未重新加载。onShow（useDidShow）是唯一可靠的「回到本页」时机。
   *
   * 首次 show 与上面的 useEffect 时机重叠，用 ref 跳过，避免刚进页面就连发两次请求。
   */
  const isFirstShowRef = useRef(true)
  useDidShow(() => {
    // 宠物列表兜底加载（仅在列表为空时）：共用回忆录需要"全部宠物的 id"才能拉全量回忆与里程碑，
    // 而 store 里的列表依赖「先进过首页/档案页」，用户若直接从「时光」tab 冷启动就会是空的
    // → 会退化成"只按 currentPet 兜底"的残缺列表。
    //
    // ⚠️ 不能每次 show 都无脑 fetchPets：petStore.fetchPets 会用服务端返回的新数组
    // 重建 currentPet **对象引用**（`pets.find(...)`），本页多处展示字段都吃这个对象；
    // 而列表已有数据时本页并不需要它——交给其它页面（我的/宠物档案）去刷新即可。
    // （loadTimelineData 的依赖是 petsKey 值，引用抖动不会再触发无谓重载。）
    if (userId && pets.length === 0) void fetchPets(userId)

    if (isFirstShowRef.current) {
      isFirstShowRef.current = false
      return
    }
    void loadTimelineData()
  })

  /**
   * 页面分享（2026-09-12 IA 第 2c 批）
   *
   * 【为什么要在这里注册】本页是**被删掉的「宠物日记」页的分享落地页**：
   * 原日记页注册了 useShareAppMessage/useShareTimeline，其 path 硬编码指向它自己那条路由
   * （全仓唯一一条指向被删路由的硬编码分享 path）。路由删掉后那条 path 就是死链，因此：
   *   · path 改指本页 /pages/timeline/index；
   *   · 标题从「宠物日记」改为「时光线」，与页头文案一致。
   * ⚠️ 已经发出去的旧分享卡片仍指向**已删除的日记页路由**，微信小程序分享卡片 **path 无法重定向**，
   *   只能失效 —— 这项取舍在交付自述里单独交代（清单原本建议留 20 行 redirect 页，本批按任务书
   *   硬约束「删目录」执行，未留 redirect）。
   * ⚠️ 不注册 share hook 的话，右上角「转发」会被小程序隐藏，日记卡上的「分享这篇日记」也就彻底没用了。
   */
  useShareAppMessage(() => ({
    title: '星河宠记 - 时光线',
    path: '/pages/timeline/index',
  }))
  useShareTimeline(() => ({
    title: '星河宠记 - 时光线',
  }))

  const timelineEvents = useMemo(() => {
    const allEvents: TimelineEvent[] = []

    if (flashback && flashbackAdded) {
      allEvents.push({
        id: 'flashback-auto',
        date: `${flashback.yearsAgo}年前`,
        title: flashback.title,
        type: 'flashback',
        emoji: flashback.emoji,
        photos: [],
        description: flashback.description,
        flashbackYear: flashback.yearsAgo,
      })
    }

    // 真实回忆优先展示（用户主动记录的内容），再叠加打卡生成事件
    const sorted = [...momentEvents, ...dynamicEvents].sort((a, b) => b.date.localeCompare(a.date))
    allEvents.push(...sorted)

    return allEvents
  }, [dynamicEvents, momentEvents, flashback, flashbackAdded])

  /**
   * 心情筛选后的日记（照搬 diary 页的 filteredRecords）
   *
   * 只作用于日记分区，与上面的 timelineEvents 互不影响：
   * 本页没有第二套筛选控件，所以不存在两个筛选状态打架的问题
   * （如果要给时光足迹也加筛选，才需要设计联动，本批不做）。
   */
  const filteredDiary = useMemo(
    () => (toneFilter === 'all' ? diaryRecords : diaryRecords.filter((r) => r.diary.tone === toneFilter)),
    [diaryRecords, toneFilter],
  )

  /**
   * 从回忆正文里**自动认宠物**（2026-09-11 新增，用户点名要的能力）
   *
   * 实现抽到 utils/petMatching（AI 对话页记回忆也要用同一套规则，避免两处口径分叉）。
   * 这里只做一层包装：把本地宠物列表与当前宠物传进去。
   */
  const detectPets = (text: string) =>
    detectPetsInText(text, pets, currentPet?.id)

  /**
   * 正文变化时刷新"记给谁"的默认值（统一的入口，onInput 与 AI 生成/润色都要走它）
   *
   * 【为什么要抽出来】AI 生成描述 / AI 润色是**程序化** setMemoryText，
   * 不会触发 Textarea 的 onInput —— 只挂在 onInput 上时，"先写今天去公园（默认可乐）、
   * 再点润色得到含「布丁」的文案"这条真实路径归属会错（2026-09-11 审查 P2-3）。
   */
  const applyAutoPetSelection = (text: string) => {
    if (petSelectionTouchedRef.current) return
    const detected = detectPets(text)
    if (detected.length) setMemoryPetIds(detected)
  }

  /**
   * 用户是否**手动改过**"记给谁"
   *
   * 手动改过之后就不再被正文自动识别覆盖 —— 否则用户选好归属、回头补一句"烧鸡也在旁边"，
   * 选择会被悄悄改掉（这正是"AI 自动选宠物"最容易惹人烦的地方）。
   */
  const petSelectionTouchedRef = useRef(false)

  /**
   * 打开「新增回忆」弹窗
   *
   * 共用回忆录改造后不再依赖"当前宠物"是否已选：只要账号下有宠物就能记，
   * 归属由弹窗里选的宠物决定（默认当前宠物；正文里提到谁就先默认给谁，用户可改）。
   *
   * ⚠️ 冷启动兜底（2026-09-11 审查 P2-4）：用户直接从「时光」tab 冷启动时，
   * store 里的宠物列表可能还没到位（其它页面负责刷新，本页只在列表为空时补拉一次，
   * 而补拉是异步的）——此时若直接判定"没有宠物"会误报"请先添加宠物"。
   * 所以这里先等一次补拉，再决定是否拦截。
   */
  const handleAddMemory = async () => {
    let list = pets
    if (!list.length && userId) {
      await fetchPets(userId)
      list = usePetStore.getState().pets
    }
    if (!list.length) {
      Taro.showToast({ title: '请先添加宠物', icon: 'none' })
      return
    }
    // 每次打开弹窗重置表单：清空文字/照片，日期默认今天，归属默认当前宠物
    setMemoryText('')
    setMemoryPhotoPaths([])
    setMemoryDate(getLocalDateString())
    petSelectionTouchedRef.current = false
    setMemoryPetIds([currentPet?.id && list.some((p) => p.id === currentPet.id) ? currentPet.id : list[0].id])
    setShowAddMemoryModal(true)
  }

  /** 选择回忆照片（支持多选，最多 9 张，与后端 photos 上限一致） */
  const handleAddMemoryPhoto = async () => {
    try {
      const remaining = 9 - memoryPhotoPaths.length
      if (remaining <= 0) {
        Taro.showToast({ title: '最多上传 9 张照片', icon: 'none' })
        return
      }
      const res = await chooseImageWithPrivacy({
        count: remaining,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      if (!res.tempFilePaths.length) return
      setMemoryPhotoPaths((prev) => [...prev, ...res.tempFilePaths].slice(0, 9))
    } catch (err) {
      if ((err as { errMsg?: string }).errMsg?.includes('cancel')) return
      Taro.showToast({ title: '选择照片失败', icon: 'none' })
    }
  }

  /** 移除已选照片（多图编辑） */
  const handleRemoveMemoryPhoto = (index: number) => {
    setMemoryPhotoPaths((prev) => prev.filter((_, i) => i !== index))
  }

  /**
   * AI 生成回忆描述：取第一张照片上传 → 视觉模型生成温暖文案
   * 生成的文案填入输入框（用户可编辑后再保存）
   */
  const handleAiDescribe = async () => {
    if (isAiDescribeLoading) return
    if (!memoryPhotoPaths.length) {
      Taro.showToast({ title: '请先上传照片', icon: 'none' })
      return
    }
    setIsAiDescribeLoading(true)
    try {
      const description = await timelineService.aiDescribe(memoryPhotoPaths[0])
      if (description) {
        setMemoryText(description)
        // AI 写出来的文案同样要认一遍宠物（程序化赋值不会触发 onInput）
        applyAutoPetSelection(description)
        Taro.showToast({ title: 'AI 已生成描述，可编辑', icon: 'success' })
      } else {
        Taro.showToast({ title: 'AI 生成失败，请重试', icon: 'none' })
      }
    } catch {
      Taro.showToast({ title: 'AI 生成失败，请重试', icon: 'none' })
    } finally {
      setIsAiDescribeLoading(false)
    }
  }

  /** AI 润色回忆文案：把用户写的草稿扩写成温暖文案 */
  const handleAiPolish = async () => {
    if (isAiPolishLoading) return
    const text = memoryText.trim()
    if (!text) {
      Taro.showToast({ title: '请先选择宠物', icon: 'none' })
      return
    }
    setIsAiPolishLoading(true)
    try {
      const polished = await timelineService.aiPolish(text)
      if (polished) {
        setMemoryText(polished)
        // 润色后的文案可能提到了别的宠物（"布丁也在旁边"）→ 同样重新识别一次
        applyAutoPetSelection(polished)
        Taro.showToast({ title: 'AI 已润色', icon: 'success' })
      } else {
        Taro.showToast({ title: 'AI 润色失败，请重试', icon: 'none' })
      }
    } catch {
      Taro.showToast({ title: 'AI 润色失败，请重试', icon: 'none' })
    } finally {
      setIsAiPolishLoading(false)
    }
  }

  /**
   * 提交回忆：逐张上传照片 → 携带补记日期（happenedAt）保存
   * 保存成功后刷新本地回忆列表（不用整页重拉，避免闪烁）
   *
   * 归属宠物＝弹窗里选中的那些（memoryPetIds，可多选），不再取全局 currentPet ——
   * 共用回忆录里"当前宠物"未必是用户想记的那只（本页也再无切换当前宠物的入口）。
   */
  const handleAddMemorySubmit = async () => {
    const text = memoryText.trim()
    if (!text) {
      Taro.showToast({ title: '请写一段回忆描述', icon: 'none' })
      return
    }
    /**
     * 归属宠物＝弹窗里明确选中的那些（memoryPetIds，可多选）。
     *
     * ⚠️ 不做静默兜底（2026-09-11 审查 P2-5）：如果用户选中的宠物已经不在列表里
     * （例如刚在别的页面删掉了它），原先的 `|| currentPet || pets[0]` 会把这条回忆
     * **悄悄记到另一只名下**——用户看不出来，数据归属就错了。宁可拦下来让用户重选。
     */
    const targetPets = memoryPetIds
      .map((id) => pets.find((p) => p.id === id))
      .filter((p): p is PetProfile => !!p)
    if (!targetPets.length) {
      Taro.showToast({ title: '宠物信息已变化，请重新选择', icon: 'none' })
      return
    }
    if (!userId) return

    setIsMemorySubmitting(true)
    try {
      // 逐张上传照片，收集服务器返回的 URL（相对路径，展示时再补全）
      const photoUrls: string[] = []
      const token = storage.getToken()
      for (const filePath of memoryPhotoPaths) {
        const uploadRes = await Taro.uploadFile({
          url: `${CONFIG.API_BASE_URL}/api/timeline/photo/upload`,
          filePath,
          name: 'photo',
          header: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const uploadData = JSON.parse(uploadRes.data) as { success: boolean; data?: { url: string } }
        if (uploadData.success && uploadData.data?.url) {
          photoUrls.push(uploadData.data.url)
        }
      }

      /**
       * 提交：petId = 第一只（主宠物，落库到 pet_moments.pet_id，兼容旧读取路径），
       * petIds = 全部选中的宠物 → 服务端校验归属后用库里的权威名字写入 content.pets。
       * 前端这里的 content.petName/petEmoji 只是"服务端不上报时"的兜底，服务端会覆盖成权威值。
       */
      const primary = targetPets[0]
      const saved = await timelineService.addMoment({
        userId,
        petId: primary.id,
        petIds: targetPets.map((p) => p.id),
        type: 'memory',
        content: {
          petName: primary.name,
          petEmoji: primary.species === 'cat' ? '🐱' : primary.species === 'dog' ? '🐕' : '🐾',
          description: text,
        },
        photos: photoUrls,
        // 补记日期：直接传 YYYY-MM-DD 纯日期（不拼本地时间，避免跨时区偏移），
        // 服务端按日解析存储，前端展示时 slice(0,10) 与所选日期完全一致
        happenedAt: memoryDate || undefined,
      })

      setShowAddMemoryModal(false)
      Taro.showToast({ title: '回忆已保存 ✦', icon: 'success' })

      // 本地插入新回忆，避免整页重拉。
      // 用服务端返回的 saved（含 content.pets）；若服务端没回这一段（旧版本/离线），
      // 就地补上本地已知的宠物标签，保证新记录立刻显示归属。
      const savedMoment = (saved && typeof saved === 'object')
        ? {
            ...saved,
            content: {
              ...(saved.content || {}),
              pets: (saved.content as { pets?: unknown })?.pets || toPetTags(targetPets),
            },
          } as PetMoment
        : null
      if (savedMoment) {
        setMomentEvents((prev) => [momentToTimelineEvent(savedMoment), ...prev])
      }
    } catch {
      Taro.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      setIsMemorySubmitting(false)
    }
  }

  /** 点击时间线条目：统一点开详情弹窗——生日/体重/日常记录等系统生成条目同样有完整
   * 标题/日期/描述，此前只弹"查看"toast 是打不开的死胡同；删除按钮仅对有 sourceId
   * 的真实回忆显示（归属校验在 handleDeleteMoment 内），查看权限与删除权限分离 */
  const handleEventClick = (event: TimelineEvent) => {
    setDetailEvent(event)
  }

  /**
   * 分享某篇日记（原 diary 页的「分享这篇日记」，2026-09-12 随页面并入）
   *
   * 与原来一致：只埋点 + 打开转发菜单（微信不支持程序化唤起分享面板，
   * 转发卡片走本页注册的 useShareAppMessage，path = /pages/timeline/index）。
   * ⚠️ 既有问题如实记录：这个按钮点击后**不会**立刻弹出分享面板，用户需要再点右上角转发
   * —— 原 diary 页就是这样（属假按钮问题），本批只搬不改，留给后续统一治理。
   */
  const handleDiaryShare = useCallback(
    (record: TimelineDiaryRecord) => {
      trackEvent('share_diary', { date: record.date, tone: record.diary.tone })
      Taro.showShareMenu({ withShareTicket: true })
    },
    [trackEvent],
  )

  /** 预览大图：支持单张/多张轮播 */
  const handlePreviewPhotos = (urls: string[], current: string) => {
    if (!urls.length) return
    Taro.previewImage({ urls, current })
  }

  /** 删除回忆：确认后调接口，成功后从本地列表移除 */
  const handleDeleteMoment = async () => {
    if (!detailEvent?.sourceId) return
    const confirm = await new Promise<boolean>((resolve) => {
      Taro.showModal({
        title: '删除这条回忆？',
        content: '删除后不可恢复',
        confirmText: '删除',
        confirmColor: '#FF4D4F',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirm) return

    try {
      await timelineService.deleteMoment(detailEvent.sourceId)
      // 本地移除，保持界面即时响应
      setMomentEvents((prev) => prev.filter((e) => e.sourceId !== detailEvent.sourceId))
      setDetailEvent(null)
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch {
      Taro.showToast({ title: '删除失败，请重试', icon: 'none' })
    }
  }

  const handleFlashbackAction = () => {
    if (flashback && !flashbackAdded) {
      setFlashbackAdded(true)
      setShowBanner(false)
      Taro.showToast({ title: `已添加到时光线`, icon: 'success' })
    }
  }

  /**
   * 【2026-09-11 已撤掉「相伴天数」】
   *
   * 原来这一格显示"最早建档那只至今"的天数（副行 N 只毛孩子）。用户看完直接否掉：
   *   "把相伴天数删掉 换成其他的"。
   * 原因也站得住：它算的是**建档口径**（老用户往往先养了几年才建档），
   * 却被读成"陪了它多少天"——一个数字同时暗示两种含义，怎么标注都会有人误读。
   * 现在这一格换成**不带歧义的纯计数**：毛孩子 N 只（见下方速览区）。
   * 注意：`pets` 仍是"增删宠物后要不要重新加载"的判据（petsKey），别因为撤掉数字就删它。
   */

  /** 时光线里累计珍藏的照片张数 */
  const photoCount = useMemo(
    () => timelineEvents.reduce((sum, e) => sum + e.photos.length, 0),
    [timelineEvents],
  )

  return (
    <View className={`timeline-page ${themeClass}`}>
      {/* 全屏动态背景光斑层 */}
      <PageBackground />

      {/* 宠物切换条已移除（2026-09-11 共用回忆录改造）：
          用户要求"所有宠物共用一个回忆录"，顶部那条"可乐/布丁/…"的切换条就是他说的"分类"。 */}

      {/* ===== 固定顶部：合并后的唯一页头 =====
          原先这里是「{宠物名}的时光线 + 记录按钮」，滚动区里又有一个 PageHero，
          两套标题叠在一起重复（用户反馈「冲突了 融合一下」）。
          现在统一由 PageHero 承担：插画 + 页面名 + 说明 + 记录按钮，只此一处。
          标题**不再挂具体宠物名** —— 本 App 支持多宠物，挂某一只的名字在切换宠物后会立刻失效。 */}
      <View className='timeline-fixed-top'>
        <PageHero
          illustration='page-timeline'
          title='时光线'
          subtitle='一路走来的每一个瞬间'
          actionText='记录'
          onAction={handleAddMemory}
        />
      </View>

      {/* ===== 可滚动区域：速览 + 横幅 + 时间线 ===== */}
      <ScrollView className='timeline-scroll' scrollY>
        {/* 时光速览：用真实数据撑起页面（原「回忆精选」撤掉后留下的空间，
            换成对用户有信息量的数字，而不是拿装饰硬填） */}
        <View className='timeline-overview'>
          {/* 第一格：毛孩子 N 只（2026-09-11 替换掉原「相伴天数」）
              用户原话："把相伴天数删掉 换成其他的" —— 那个数字是建档口径却容易被读成"陪了它多久"，
              换成不带歧义的纯计数；也与本页"所有宠物共用一本回忆录"的定位对得上（家有几只，一眼可见）。 */}
          {pets.length > 0 && (
            <>
              <View className='timeline-overview-item'>
                <Icon name='paw-print' size={18} tone='primary' />
                <Text className='timeline-overview-value'>{pets.length}</Text>
                <Text className='timeline-overview-label'>毛孩子</Text>
              </View>
              <View className='timeline-overview-divider' />
            </>
          )}
          <View className='timeline-overview-item'>
            <Icon name='note-pencil' size={18} tone='primary' />
            <Text className='timeline-overview-value'>{timelineEvents.length}</Text>
            <Text className='timeline-overview-label'>时光记录</Text>
          </View>
          <View className='timeline-overview-divider' />
          <View className='timeline-overview-item'>
            <Icon name='image' size={18} tone='primary' />
            <Text className='timeline-overview-value'>{photoCount}</Text>
            <Text className='timeline-overview-label'>珍藏照片</Text>
          </View>
        </View>

        {showBanner && (
          <View className='timeline-banner'>
            <View className={`timeline-banner-inner ${flashback ? 'timeline-banner-inner--flashback' : ''}`}>
              <View className='timeline-banner-glow' />
              <View className='timeline-banner-content'>
                <Text className='timeline-banner-icon'>
                  {flashback ? flashback.emoji : '💫'}
                </Text>
                <View className='timeline-banner-text-wrap'>
                  <Text className='timeline-banner-title'>
                    {flashback ? flashback.title : '旧时光提醒'}
                  </Text>
                  <Text className='timeline-banner-desc'>
                    {flashback
                      ? flashback.description
                      : '坚持打卡，把每一天留在时光里'
                    }
                  </Text>
                </View>
                {flashback && (
                  <View className='timeline-banner-action' onClick={handleFlashbackAction}>
                    <Text className='timeline-banner-action-text'>添加到时光线</Text>
                  </View>
                )}
              </View>
              <View className='timeline-banner-close' onClick={() => setShowBanner(false)}>
                <Text>✕</Text>
              </View>
            </View>
          </View>
        )}

        <View className='timeline-list'>
          <Text className='timeline-list-title'>时光足迹</Text>
          {timelineEvents.length > 0 ? (
            timelineEvents.map((event, index) => (
            <View key={event.id} className='timeline-item' onClick={() => handleEventClick(event)}>
              <View className='timeline-line-col'>
                <View className={`timeline-dot timeline-dot--${event.type}`}>
                  <Text className='timeline-dot-emoji'>{event.emoji}</Text>
                </View>
                {index < timelineEvents.length - 1 && (
                  <View className='timeline-line' />
                )}
              </View>
              <View className={`timeline-card timeline-card--${event.type}`}>
                <View className='timeline-card-date'>
                  <Text className='timeline-date-text'>{event.date}</Text>
                  {/* 宠物标签：共用回忆录里每张卡都要能看出"这是谁的回忆"。
                      多宠共同回忆（content.pets 有 2 只以上）→ 渲染多枚标签；
                      单宠回忆/系统里程碑 → 用单值 petName；旧数据缺名字时不渲染。 */}
                  {(event.petTags?.length ? event.petTags : (event.petName ? [{ id: event.petId || 'p', name: event.petName, emoji: event.petEmoji || '🐾' }] : []))
                    .map((tag) => (
                      <View key={tag.id} className='timeline-pet-tag'>
                        <Text className='timeline-pet-tag-text'>{tag.emoji || '🐾'} {tag.name}</Text>
                      </View>
                    ))}
                  {event.type === 'milestone' && (
                    <View className='timeline-milestone-badge'>
                      <Text className='timeline-milestone-badge-text'>里程碑</Text>
                    </View>
                  )}
                  {event.type === 'memory' && (
                    <View className='timeline-memory-badge'>
                      <Text className='timeline-memory-badge-text'>回忆</Text>
                    </View>
                  )}
                  {event.type === 'flashback' && (
                    <View className='timeline-flashback-badge'>
                      <Text className='timeline-flashback-badge-text'>旧时光</Text>
                    </View>
                  )}
                </View>
                <Text className='timeline-card-title'>{event.title}</Text>
                <Text className='timeline-card-desc'>{event.description}</Text>
                {event.photos.length > 0 ? (
                  <View className='timeline-photo-grid'>
                    {event.photos.map((photo, pi) => (
                      // 真实照片展示（原实现只有占位符，无法看到照片内容）
                      <Image
                        key={pi}
                        className='timeline-photo-img'
                        src={resolveAvatarUrl(photo)}
                        mode='aspectFill'
                        onClick={() => handlePreviewPhotos(event.photos.map(resolveAvatarUrl), resolveAvatarUrl(photo))}
                      />
                    ))}
                  </View>
                ) : (
                  // 原先是「+ 添加照片」的虚线按钮样式，但整张卡片点击只会打开详情、
                  // 并不支持给这条记录补照片 —— 是个点不出预期结果的假按钮。
                  // 改成不带按钮感的纯提示，不再误导用户去点。
                  <View className='timeline-photo-empty'>
                    <Icon name='camera' size={14} tone='muted' />
                    <Text className='timeline-photo-empty-text'>这条记录还没有照片</Text>
                  </View>
                )}
              </View>
            </View>
          ))) : (
            <EmptyState
              illustration='empty-timeline'
              title='还没有时光记录'
              desc='点右上角「记录」，写下第一个珍贵瞬间'
            />
          )}
        </View>

        {/* ===== 宠物日记（2026-09-12 IA 第 2c 批：原「宠物日记」页并入本页） =====
            【搬的是什么】diary 页**独有**的视图：diaryEngine 生成的拟人化日记正文 + 6 档心情筛选。
            时光足迹是「最近 6 条打卡 + 全部回忆」，日记分区是「每条打卡一篇日记」——
            粒度不同，所以两段都保留（本页合并的不是重复页，而是把日记视图搬过来）。
            【视觉】完全沿用本页已有的时间线写法（timeline-item / timeline-line-col /
            timeline-card / timeline-pet-chip），不引入第二套设计语言。 */}
        <View className='timeline-diary'>
          <View className='timeline-diary-head'>
            <Text className='timeline-diary-title'>宠物日记</Text>
            <Text className='timeline-diary-count'>共 {filteredDiary.length} 篇</Text>
          </View>

          {/* 6 档心情筛选（照搬 diary 页）：横滑 + 贴纸胶囊，与弹窗里的宠物胶囊同一套样式 */}
          <ScrollView scrollX className='timeline-diary-filter-scroll' showScrollbar={false}>
            <View className='timeline-diary-filter-list'>
              {TONE_FILTERS.map((f) => (
                <View
                  key={f.key}
                  className={`timeline-pet-chip${toneFilter === f.key ? ' timeline-pet-chip--active' : ''}`}
                  onClick={() => setToneFilter(f.key)}
                >
                  <Text className='timeline-pet-chip-text'>{f.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          {diaryRecords.length === 0 ? (
            /* 空态沿用 diary 页的原文案（同一套说法），但只做轻量提示：
               本页上方已经可能有一个大插画空态，同屏再放第二个插画会抢注意力 */
            <View className='timeline-diary-empty'>
              <Text className='timeline-diary-empty-text'>还没有日记哦~</Text>
              <Text className='timeline-diary-empty-hint'>每天打卡后会自动生成一篇日记</Text>
            </View>
          ) : filteredDiary.length === 0 ? (
            <View className='timeline-diary-empty'>
              <Text className='timeline-diary-empty-text'>该心情下暂无日记</Text>
              <Text className='timeline-diary-empty-hint'>换一个心情标签看看</Text>
            </View>
          ) : (
            filteredDiary.map((record, index) => (
              <View key={`${record.petId}-${record.entry.id}`} className='timeline-item'>
                <View className='timeline-line-col'>
                  {/* 圆点底色跟随心情（语义色），与卡片上的心情角标同源 */}
                  <View
                    className='timeline-dot timeline-dot--diary'
                    style={{ backgroundColor: TONE_COLORS[record.diary.tone] || '#8C8C8C' }}
                  >
                    <Text className='timeline-dot-emoji'>{record.diary.emoji}</Text>
                  </View>
                  {index < filteredDiary.length - 1 && <View className='timeline-line' />}
                </View>
                <View className='timeline-card timeline-card--diary'>
                  <View className='timeline-card-date'>
                    <Text className='timeline-date-text'>{record.date}</Text>
                    <View
                      className='timeline-diary-mood'
                      style={{ backgroundColor: TONE_COLORS[record.diary.tone] || '#8C8C8C' }}
                    >
                      <Text className='timeline-diary-mood-text'>
                        {record.diary.emoji} {TONE_LABELS[record.diary.tone] || record.diary.tone}
                      </Text>
                    </View>
                    {/* 宠物归属标签：与时光足迹卡片同一套写法（共用一本时每张卡都要能看出是谁的） */}
                    <View className='timeline-pet-tag'>
                      <Text className='timeline-pet-tag-text'>{record.petEmoji} {record.petName}</Text>
                    </View>
                  </View>
                  <Text className='timeline-diary-text'>{record.diary.text}</Text>
                  {record.entry.note ? (
                    <View className='timeline-diary-note'>
                      <Text className='timeline-diary-note-label'>📝 备注</Text>
                      <Text className='timeline-diary-note-text'>{record.entry.note}</Text>
                    </View>
                  ) : null}
                  <View className='timeline-diary-actions'>
                    <View className='timeline-diary-share' onClick={() => handleDiaryShare(record)}>
                      <Text className='timeline-diary-share-text'>📤 分享这篇日记</Text>
                    </View>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        {/* ===== 添加时光记录按钮（原型对齐） ===== */}
        <View className='timeline-add-main-btn' onClick={handleAddMemory}>
          <Text className='timeline-add-main-icon'>+</Text>
          <Text className='timeline-add-main-text'>添加时光记录</Text>
        </View>

        <View className='timeline-bottom-safe' />
      </ScrollView>

      {/* ===== 新增回忆弹窗（日期补记 + 多图 + AI 辅助） ===== */}
      {showAddMemoryModal && (
        <View className='timeline-review-overlay' onClick={() => setShowAddMemoryModal(false)}>
          <View className='timeline-add-memory-modal' onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}>
            <View className='timeline-review-header'>
              <Text className='timeline-review-header-title'>新增回忆 ✦</Text>
              <View className='timeline-review-header-close' onClick={() => setShowAddMemoryModal(false)}>
                <Text>✕</Text>
              </View>
            </View>
            <View className='timeline-add-memory-body'>
              {/* 归属宠物（**多选**，2026-09-11）：共用回忆录里"这条回忆是谁的"由这里决定。
                  · 默认当前宠物；正文里提到某只宠物名时，提交时会自动把默认值换成那只（用户可改）
                  · 可多选（"两只一起晒太阳"这种共同回忆不必拆两条）
                  · 多宠家庭才渲染这一行；只有一只宠物时少一行噪音 */}
              {pets.length > 1 && (
                <View className='timeline-add-memory-pet-row'>
                  <View className='timeline-add-memory-pet-head'>
                    <Text className='timeline-add-memory-date-label'>🐾 记给谁</Text>
                    <Text className='timeline-add-memory-pet-hint'>可多选</Text>
                  </View>
                  <ScrollView className='timeline-add-memory-pet-scroll' scrollX showScrollbar={false}>
                    <View className='timeline-add-memory-pet-list'>
                      {pets.map((pet) => (
                        <View
                          key={pet.id}
                          className={`timeline-pet-chip ${memoryPetIds.includes(pet.id) ? 'timeline-pet-chip--active' : ''}`}
                          onClick={() => {
                            setMemoryPetIds((prev) => {
                              // 已选中：取消它（但至少保留一只 —— 全不选没法落库）
                              if (prev.includes(pet.id)) {
                                // 只有一只时是静默无操作 —— 此时**不置位** touched，
                                // 否则"首次点击=替换"的机会会被这一次无效点击悄悄消费掉（审查 P3）
                                if (prev.length <= 1) return prev
                                petSelectionTouchedRef.current = true
                                return prev.filter((id) => id !== pet.id)
                              }
                              /**
                               * 未选中的两种情况：
                               * · **第一次**手动点选且当前只有一只（那只是默认/自动识别的）→ **替换**它。
                               *   这样"记给另一只"仍然是一次点击，与改前的单选手感一致；
                               * · 其余情况 → 追加（多宠共同回忆）。
                               */
                              const wasTouched = petSelectionTouchedRef.current
                              petSelectionTouchedRef.current = true
                              if (!wasTouched && prev.length === 1) return [pet.id]
                              return [...prev, pet.id]
                            })
                          }}
                        >
                          <Text className='timeline-pet-chip-emoji'>
                            {pet.species === 'cat' ? '🐱' : pet.species === 'dog' ? '🐕' : '🐾'}
                          </Text>
                          <Text className='timeline-pet-chip-text'>{pet.name}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

              {/* 补记日期：默认今天，可手动选择过去任意一天 */}
              <View className='timeline-add-memory-date-row'>
                <Text className='timeline-add-memory-date-label'>📅 回忆日期</Text>
                <Picker mode='date' value={memoryDate} end={getLocalDateString()} onChange={(e) => setMemoryDate(e.detail.value)}>
                  <View className='timeline-add-memory-date-value'>
                    <Text>{memoryDate}</Text>
                    <Text className='timeline-add-memory-date-arrow'>▾</Text>
                  </View>
                </Picker>
              </View>

              <Textarea
                className='timeline-add-memory-textarea'
                placeholder='写下这个值得记住的瞬间...'
                value={memoryText}
                onInput={(e: { detail: { value: string } }) => {
                  const next = e.detail.value
                  setMemoryText(next)
                  // 正文里提到谁就自动把"记给谁"切到谁（用户手动改过之后不再覆盖，避免抢用户的选择）
                  applyAutoPetSelection(next)
                }}
                maxlength={500}
                autoHeight
              />

              {/* AI 辅助：生成描述 / 润色文案 */}
              <View className='timeline-add-memory-ai-row'>
                <View
                  className={`timeline-ai-btn ${isAiDescribeLoading || !memoryPhotoPaths.length ? 'timeline-ai-btn--disabled' : ''}`}
                  onClick={memoryPhotoPaths.length && !isAiDescribeLoading ? handleAiDescribe : undefined}
                >
                  <Text className='timeline-ai-btn-text'>{isAiDescribeLoading ? '✨ 生成中...' : '✨ AI 写描述'}</Text>
                </View>
                <View
                  className={`timeline-ai-btn ${isAiPolishLoading || !memoryText.trim() ? 'timeline-ai-btn--disabled' : ''}`}
                  onClick={memoryText.trim() && !isAiPolishLoading ? handleAiPolish : undefined}
                >
                  <Text className='timeline-ai-btn-text'>{isAiPolishLoading ? '✨ 润色中...' : '✨ AI 润色'}</Text>
                </View>
              </View>

              {/* 多图上传：九宫格预览，可删除单张 */}
              <View className='timeline-add-memory-photo-grid'>
                {memoryPhotoPaths.map((photoPath, pi) => (
                  <View key={pi} className='timeline-add-memory-photo-item'>
                    <Image className='timeline-add-memory-photo-img' src={photoPath} mode='aspectFill' />
                    <View className='timeline-add-memory-photo-remove' onClick={() => handleRemoveMemoryPhoto(pi)}>
                      <Text>✕</Text>
                    </View>
                  </View>
                ))}
                {memoryPhotoPaths.length < 9 && (
                  <View className='timeline-add-memory-photo-add' onClick={handleAddMemoryPhoto}>
                    <Icon name='camera' size={18} tone='primary' className='timeline-add-memory-photo-icon' />
                    <Text className='timeline-add-memory-photo-label'>{memoryPhotoPaths.length ? '继续添加' : '拍照/上传照片'}</Text>
                  </View>
                )}
              </View>
              <Text className='timeline-add-memory-photo-tip'>最多 9 张 · AI 描述基于第一张照片</Text>
            </View>
            <View className='timeline-review-actions'>
              <View
                className={`timeline-review-btn timeline-review-btn--primary ${isMemorySubmitting ? 'timeline-review-btn--disabled' : ''}`}
                onClick={isMemorySubmitting ? undefined : handleAddMemorySubmit}
              >
                <Text className='timeline-review-btn-text'>
                  {isMemorySubmitting ? '保存中...' : '💾 保存回忆'}
                </Text>
              </View>
              <View className='timeline-review-btn timeline-review-btn--outline' onClick={() => setShowAddMemoryModal(false)}>
                <Text className='timeline-review-btn-text'>取消</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ===== 回忆详情弹窗（大图 + 完整文案 + 删除） ===== */}
      {detailEvent && (
        <View className='timeline-review-overlay' onClick={() => setDetailEvent(null)}>
          <View className='timeline-detail-modal' onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}>
            <View className='timeline-review-header'>
              <Text className='timeline-review-header-title'>{detailEvent.emoji} {detailEvent.title}</Text>
              <View className='timeline-review-header-close' onClick={() => setDetailEvent(null)}>
                <Text>✕</Text>
              </View>
            </View>
            <View className='timeline-detail-body'>
              <Text className='timeline-detail-date'>📅 {detailEvent.date}</Text>
              {detailEvent.photos.length > 0 ? (
                <ScrollView className='timeline-detail-photos' scrollX showScrollbar={false}>
                  <View className='timeline-detail-photos-row'>
                    {detailEvent.photos.map((photo, pi) => (
                      <Image
                        key={pi}
                        className='timeline-detail-photo'
                        src={resolveAvatarUrl(photo)}
                        mode='aspectFill'
                        onClick={() => handlePreviewPhotos(detailEvent.photos.map(resolveAvatarUrl), resolveAvatarUrl(photo))}
                      />
                    ))}
                  </View>
                </ScrollView>
              ) : null}
              <Text className='timeline-detail-desc'>{detailEvent.description || '这是一条没有文字说明的回忆。'}</Text>
            </View>
            {detailEvent.sourceId && (
              <View className='timeline-review-actions'>
                <View className='timeline-review-btn timeline-review-btn--danger' onClick={handleDeleteMoment}>
                  <Text className='timeline-review-btn-text'>🗑 删除这条回忆</Text>
                </View>
                <View className='timeline-review-btn timeline-review-btn--outline' onClick={() => setDetailEvent(null)}>
                  <Text className='timeline-review-btn-text'>关闭</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  )
}
