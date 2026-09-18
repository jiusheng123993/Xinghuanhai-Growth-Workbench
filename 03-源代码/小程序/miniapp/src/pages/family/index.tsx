/**
 * 家庭页面
 *
 * 板块：家庭头部 + 成员横滑 + 共同养宠（人）+ 宠物成员管理 + 今日健康摘要
 *      + 家族图谱 + 家庭日历 + 家庭周报 + 全家福（生成/相册）+ 家庭动态预览
 *
 * 2026-09-12（IA 第 3 批）：「家庭看板」pagesPet/family/dashboard 整页并入本页后下线。
 * 并在原则是**搬能力、不搬重复**：
 *   · 搬过来了（dashboard 独有，别处没有）——宠物角色设置、把宠物加入/移出家庭、
 *     全家福 AI 生成（风格/场景/座次 + Canvas 降级 + 保存/分享）、全家福相册（上传/按月分组/删除）；
 *   · 没搬（本页已有或已覆盖）——dashboard 的「今日健康看板」（本页「今日健康摘要」覆盖）、
 *     「家族图谱 / 家庭日历」两张跳转卡（本页第 4、5 块已是同两个入口，再放就是同屏重复）。
 */
import { View, Text, ScrollView, Image, Canvas, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { usePetStore } from '../../stores/petStore'
import { useAuthStore } from '../../stores/authStore'
import { useFamilyStore } from '../../stores/familyStore'
import { getTodayCheckin, getCheckinStats } from '../../services/checkinService'
import { getFamilyMoments, getNewMoments } from '../../services/momentService'
import { getUpcomingRecords } from '../../services/vaccineService'
import { generateWeeklyReport, generateFamilyWeeklySummary, getLatestWeeklyReport } from '../../services/weeklyReportService'
import type { WeeklyReport, BackendWeeklyReport } from '../../services/weeklyReportService'
import {
  buildFamilyPhotoData,
  renderFamilyPhoto,
  saveFamilyPhoto,
  shareFamilyPhoto,
  FAMILY_PHOTO_STYLE_LABELS,
  FAMILY_PHOTO_STYLES,
  FAMILY_PHOTO_SCENE_LABELS,
  FAMILY_PHOTO_SCENE_GROUPS,
  DEFAULT_FAMILY_PHOTO_SCENE,
} from '../../services/familyPhotoService'
import type { FamilyPhotoStyle, FamilyPhotoScene } from '../../services/familyPhotoService'
import type { PetProfile } from '../../services/petService'
import type {
  PetMoment,
  PetFamilyMember,
  FamilyPhoto,
  FamilyUser,
  FamilyUserRelation,
  FamilyUserRelationType,
} from '../../types/familyTypes'
import type { PetHealthEntry } from '../../services/checkinService'
import { usePolling } from '../../hooks/usePolling'
import { useThemeClass } from '../../hooks/useThemeClass'
import {
  calculateHealthScore,
  roleIcon,
  groupPhotosByMonth,
  syncMemberOrder,
  isSameOrder,
  moveInOrder,
  // 家庭成员（人）关系的三处纯逻辑：随 family-tree 下线一并搬来（2026-09-12 舰长裁决方案②）
  USER_REL_META,
  describeUserRelation,
  isFamilyOwnerUser,
} from './utils'
import FamilyPetAvatar from './FamilyPetAvatar'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import './index.scss'
import { Icon, PageHero, Illustration } from '../../components'
import PageBackground from '../../components/PageBackground'

/**
 * 可指派给宠物的家庭角色（与后端自由文本字段兼容；顺序=ActionSheet 展示顺序）
 * 说明：这里**不再叫"邀请"** —— 宠物不是被邀请进来的，"加入家庭"才是实际语义（见 handleAddPetMember）
 */
const ROLE_LIST = ['老大', '团宠', '活力之星', '守护者', '新成员', '乖宝宝']

/**
 * 「家庭动态」卡在页内**预览**几条
 *
 * 为什么要抽成常量：卡头的「共 N 条」文案必须与这里渲染出来的行数对得上
 * （原先卡头按取数上限写"共 5 条"、列表却 slice(0,2)，用户会以为有 3 条没加载出来）。
 * 两处共用同一个常量，以后调条数不会再次写歪。
 */
const FEED_PREVIEW_COUNT = 2

/** 食欲等级文案（1-6） */
const APPETITE_TEXT: Record<number, string> = {
  1: '极差',
  2: '下降',
  3: '正常',
  4: '一般',
  5: '亢进',
  6: '呕吐',
}

/** 精神等级文案（1-5） */
const SPIRIT_TEXT: Record<number, string> = {
  1: '萎靡',
  2: '低落',
  3: '良好',
  4: '活跃',
  5: '非常活跃',
}

interface CalendarEvent {
  id: string
  type: 'vaccine' | 'adoption'
  title: string
  sub: string
  date: string
  color: 'coral' | 'gold'
}

function formatMonthDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return iso.slice(0, 10)
}

/** 从动态 content 提取宠物名（联合类型安全访问） */
function getMomentPetName(moment: PetMoment): string {
  const c = moment.content as Record<string, unknown>
  return typeof c.petName === 'string' ? c.petName : '毛孩子'
}

/** 从动态 content 提取展示文本 */
function getMomentText(moment: PetMoment): string {
  if (moment.aiSummary) return moment.aiSummary
  const c = moment.content as Record<string, unknown>
  const title = typeof c.title === 'string' ? c.title : ''
  const action = typeof c.action === 'string' ? c.action : ''
  const desc = typeof c.description === 'string' ? c.description : ''
  const summary = typeof c.summary === 'string' ? c.summary : ''
  if (moment.type === 'checkin' && action) return ` 完成${action}`
  if (title) return ` ${title}`
  if (action) return ` ${action}`
  if (desc) return ` ${desc}`
  if (summary) return summary
  return ' 更新了动态'
}

export default function FamilyPage() {
  /**
   * 主题类名：**必须挂在页面自己的根节点上**（本页有三个渲染分支，逐个都挂）
   *
   * 为什么：小程序端每个页面是独立渲染的，app 组件的 JSX 并不包裹页面节点，
   * 挂在 app 那层的 `.theme-*` 传不到页面里（那只在 H5 端成立，H5 还会把问题盖住）。
   * 不挂的后果是本页永远吃 styles/_theme.scss 里 `page{}` 的秋季基线变量，用户切主题无效。
   * 口径与 pages/creative、pages/mine、pages/pet-profile 一致。
   */
  const themeClass = useThemeClass()
  const { pets, fetchPets, switchPet } = usePetStore()
  const {
    currentFamily,
    members,
    users,
    relations,
    photos,
    photosLoading,
    loading: familyLoading,
    fetchFamilies,
    createFamily,
    addMember,
    removeMember,
    updateMemberRole,
    fetchRelations,
    createRelation,
    removeRelation,
    fetchPhotos,
    savePhoto,
    deletePhoto,
    generateAiPhoto,
  } = useFamilyStore()
  const user = useAuthStore(s => s.user)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const isInitialized = useAuthStore(s => s.isInitialized)
  const [pageReady, setPageReady] = useState(false)
  const [creating, setCreating] = useState(false)
  const [todayCheckins, setTodayCheckins] = useState<Record<string, PetHealthEntry | null>>({})
  const [moments, setMoments] = useState<PetMoment[]>([])
  const [newMomentsCount, setNewMomentsCount] = useState(0)
  const [showNewMoments, setShowNewMoments] = useState(false)
  const lastMomentTimeRef = useRef<string>('')
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [weeklyReport, setWeeklyReport] = useState<{
    summary: string
    overallMood: WeeklyReport['overallMood']
    highlights: string[]
    concerns: string[]
    reports: { petName: string; score: number; overallMood: WeeklyReport['overallMood']; summary: string }[]
  } | null>(null)

  // ===== 以下为「家庭看板」并入本页带来的状态（2026-09-12）=====
  /** 全家福：AI 生成结果预览图（空串=未生成） */
  const [photoUrl, setPhotoUrl] = useState('')
  /** 生成中（AI 与 Canvas 降级共用一把锁，避免两条路径并发写同一张预览） */
  const [photoGenerating, setPhotoGenerating] = useState(false)
  const [showPhotoPreview, setShowPhotoPreview] = useState(false)
  /** 仅在 Canvas 降级绘制期间挂载画布（微信要求画布节点可被 selectQuery 命中） */
  const [canvasVisible, setCanvasVisible] = useState(false)
  const [uploading, setUploading] = useState(false)
  /** 新照片入册后短暂高亮相册区（给"保存到相册"一个可见反馈） */
  const [albumHighlight, setAlbumHighlight] = useState(false)
  const [selectedStyle, setSelectedStyle] = useState<FamilyPhotoStyle>('pixar')
  /** 场景：预设 key 或 'custom'（自定义描述）；默认温馨客厅 */
  const [selectedScene, setSelectedScene] = useState<FamilyPhotoScene | 'custom'>(DEFAULT_FAMILY_PHOTO_SCENE)
  /** 当前展开的场景主题分组（22 个场景一屏铺满会看不到按钮，按五大主题分页） */
  const [activeSceneGroup, setActiveSceneGroup] = useState(0)
  const [customSceneText, setCustomSceneText] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiProgressText, setAiProgressText] = useState('')
  /** 合影座次（petId 有序数组，排在前面=画面靠左） */
  const [memberOrder, setMemberOrder] = useState<string[]>([])

  // ===== 家庭成员（人）关系（随 family-tree 下线搬进本页，2026-09-12 舰长裁决方案②）=====
  /** 关系管理面板是否打开 */
  const [showUserRel, setShowUserRel] = useState(false)
  /** 新建关系的表单（成员 A / 成员 B / 关系类型） */
  const [userRelForm, setUserRelForm] = useState<{
    userIdA: string
    userIdB: string
    relationType: FamilyUserRelationType
  }>({ userIdA: '', userIdB: '', relationType: 'couple' })

  useEffect(() => {
    if (!isInitialized) return
    if (!isAuthenticated || !user) {
      // 未登录统一走收口守卫：已是登录页时不再 reLaunch（避免路由竞态报 routeDone not found）
      redirectToLoginIfNeeded()
      return
    }
    const loadData = async () => {
      await fetchFamilies()
      // 多成员共同养宠：加载家庭成员（人）列表
      await useFamilyStore.getState().fetchUsers()
      await fetchPets(user.id)
      const fetchedPets = usePetStore.getState().pets

      // 今日打卡状态与健康摘要
      const checkinMap: Record<string, PetHealthEntry | null> = {}
      for (const pet of fetchedPets) {
        try {
          checkinMap[pet.id] = await getTodayCheckin(pet.id, user.id)
        } catch {
          checkinMap[pet.id] = null
        }
      }
      setTodayCheckins(checkinMap)

      // 家庭周报（后端优先，失败降级模板）
      const petReports: { petName: string; score: number; overallMood: WeeklyReport['overallMood']; summary: string }[] = []
      for (const pet of fetchedPets) {
        try {
          const stats = await getCheckinStats(pet.id, user.id)
          const score = calculateHealthScore(stats)
          const report = generateWeeklyReport({
            petName: pet.name,
            species: pet.species,
            breed: pet.breed,
            score,
            scoreTrend: 'stable',
            // 口径对齐（2026-09-11）：`checkinDays` 要的是**天数**，必须传按日期去重的
            // `weeklyDays`。原来传的是 `weeklyCount`（打卡次数）—— 一天补记两次就会
            // 让后端印出「本周坚持了 8 天打卡」这种虚高数字（本项目一周只有 7 天）。
            checkinDays: stats.weeklyDays,
            // anomalyDays 保持条数：后端那条文案已改成「本周有 N 次异常记录」，与条数一致
            anomalyDays: stats.totalAnomalyDays,
            streak: stats.streak,
            recentMoments: [],
          })
          petReports.push({ petName: pet.name, score, overallMood: report.overallMood, summary: report.summary })
        } catch {
          // 跳过单宠统计失败
        }
      }

      const familyId = useFamilyStore.getState().currentFamily?.id
      if (familyId) {
        try {
          const backendReport = await getLatestWeeklyReport(familyId)
          if (backendReport) {
            setWeeklyReport({
              summary: backendReport.summary,
              overallMood: backendReport.overallMood,
              highlights: backendReport.highlights || [],
              concerns: backendReport.concerns || [],
              reports: (backendReport.petReports || []).map(r => ({
                petName: r.petName,
                score: r.score,
                overallMood: r.mood as WeeklyReport['overallMood'],
                summary: r.summary,
              })),
            })
          } else if (petReports.length > 0) {
            const familySummary = generateFamilyWeeklySummary(
              petReports.map(r => ({
                title: '',
                summary: r.summary,
                overallMood: r.overallMood,
                highlights: [],
                concerns: [],
                suggestions: [],
              })),
              fetchedPets.length
            )
            setWeeklyReport({
              summary: familySummary.summary,
              overallMood: familySummary.overallMood,
              highlights: familySummary.highlights,
              concerns: familySummary.concerns,
              reports: petReports,
            })
          }
        } catch {
          if (petReports.length > 0) {
            const familySummary = generateFamilyWeeklySummary(
              petReports.map(r => ({
                title: '',
                summary: r.summary,
                overallMood: r.overallMood,
                highlights: [],
                concerns: [],
                suggestions: [],
              })),
              fetchedPets.length
            )
            setWeeklyReport({
              summary: familySummary.summary,
              overallMood: familySummary.overallMood,
              highlights: familySummary.highlights,
              concerns: familySummary.concerns,
              reports: petReports,
            })
          }
        }
      } else if (petReports.length > 0) {
        const familySummary = generateFamilyWeeklySummary(
          petReports.map(r => ({
            title: '',
            summary: r.summary,
            overallMood: r.overallMood,
            highlights: [],
            concerns: [],
            suggestions: [],
          })),
          fetchedPets.length
        )
        setWeeklyReport({
          summary: familySummary.summary,
          overallMood: familySummary.overallMood,
          highlights: familySummary.highlights,
          concerns: familySummary.concerns,
          reports: petReports,
        })
      }

      // 家庭动态
      try {
        const familyId2 = useFamilyStore.getState().currentFamily?.id || 'fam_001'
        const familyMoments = await getFamilyMoments(familyId2, 5)
        setMoments(familyMoments)
        if (familyMoments.length > 0) {
          lastMomentTimeRef.current = familyMoments[0].createdAt
        }
      } catch {
        setMoments([])
      }

      setPageReady(true)
    }
    loadData()
  }, [isInitialized, isAuthenticated, user])

  // ===== 全家福相册：家庭就绪后拉一次（并入 dashboard 时带来，2026-09-12）=====
  // 依赖 currentFamily（切家庭要换相册），不能依赖整个 store 对象（每次 set 都会换引用 → 无限请求）
  useEffect(() => {
    if (currentFamily) {
      void fetchPhotos()
    }
  }, [currentFamily, fetchPhotos])

  // 家庭成员（人）关系：家庭就绪后拉一次（family-tree 下线后由本页承载，2026-09-12）
  // 同样只依赖 currentFamily —— fetchRelations 内部失败静默（后端未部署关系表时不阻塞本页）
  useEffect(() => {
    if (currentFamily) {
      void fetchRelations().catch(() => {})
    }
  }, [currentFamily, fetchRelations])

  /** 家庭成员（宠物）+ 对应的真实档案：dashboard 用 members 拉宠档案，本页沿用同一口径 */
  const familyPets = useMemo(() => {
    const petMap = new Map(pets.map((p: PetProfile) => [p.id, p]))
    return members
      .map((member: PetFamilyMember) => ({ member, pet: petMap.get(member.petId) }))
      .filter((item): item is { member: PetFamilyMember; pet: PetProfile } => !!item.pet)
  }, [members, pets])

  // 座次与当前家庭成员对齐：保留用户已排的相对次序、剔除已移出的、新成员追加到末尾
  // （不能每次都用 familyPets 顺序覆盖，否则用户排完座次一点生成又被重置 —— 见 utils.syncMemberOrder）
  // 内容一致时返回原引用，避免每次 familyPets 变化都触发一次无意义的重渲染（见 utils.isSameOrder）
  useEffect(() => {
    setMemberOrder(prev => {
      const next = syncMemberOrder(prev, familyPets.map(fp => fp.member.petId))
      return isSameOrder(prev, next) ? prev : next
    })
  }, [familyPets])

  /** 还没加入当前家庭的宠物（用于「加入家庭」区；来源于 dashboard 的 unassignedPets） */
  const unassignedPets = useMemo(() => {
    const assignedIds = new Set(members.map((m: PetFamilyMember) => m.petId))
    return pets.filter((p: PetProfile) => !assignedIds.has(p.id))
  }, [pets, members])

  /** 相册按月分组（新的在前） */
  const photoGroups = useMemo(() => groupPhotosByMonth(photos), [photos])
  /** 家庭日历事件：本月疫苗到期 */
  const loadCalendarEvents = useCallback(async () => {
    const events: CalendarEvent[] = []
    const now = new Date()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    for (const pet of pets) {
      try {
        const upcoming = await getUpcomingRecords(pet.id, 30)
        for (const rec of upcoming) {
          const dueStr = rec.nextDate || rec.date
          const due = new Date(dueStr + 'T00:00:00')
          if (due >= now && due <= monthEnd) {
            events.push({
              id: `${pet.id}-${rec.id}`,
              type: 'vaccine',
              title: `${pet.name} · ${rec.category}疫苗`,
              sub: rec.status === 'overdue' ? '已到期' : '即将到期',
              date: formatMonthDay(dueStr),
              color: 'coral',
            })
          }
        }
      } catch {
        // 跳过单宠疫苗加载失败
      }
    }
    setCalendarEvents(events.slice(0, 3))
  }, [pets])

  useEffect(() => {
    if (pageReady && pets.length > 0) {
      loadCalendarEvents()
    }
  }, [pageReady, pets, loadCalendarEvents])

  const pollNewMoments = useCallback(async () => {
    const familyId = useFamilyStore.getState().currentFamily?.id || 'fam_001'
    const since = lastMomentTimeRef.current
    if (!since) return
    try {
      const newMoments = await getNewMoments(familyId, since)
      if (newMoments.length > 0) {
        setNewMomentsCount(prev => prev + newMoments.length)
        setShowNewMoments(true)
      }
    } catch {
      // 静默失败，轮询不打断用户
    }
  }, [])

  usePolling(pollNewMoments, {
    intervalMs: 30000,
    enabled: pageReady,
    immediateOnResume: true,
  })

  const handleLoadNewMoments = useCallback(async () => {
    const familyId = useFamilyStore.getState().currentFamily?.id || 'fam_001'
    try {
      const latestMoments = await getFamilyMoments(familyId, 5)
      setMoments(latestMoments)
      if (latestMoments.length > 0) {
        lastMomentTimeRef.current = latestMoments[0].createdAt
      }
      setNewMomentsCount(0)
      setShowNewMoments(false)
    } catch {
      // 静默处理
    }
  }, [])

  /**
   * 点家庭里的宠物 → 切成当前宠物并跳到它的档案页
   *
   * 2026-09-11 补失败兜底：petStore.switchPet 失败时会 throw，原来这里既不接错、
   * 后续的跳转也不会执行 —— 用户点一下宠物"什么都没发生"。
   * 失败时明确提示并**不跳转**：否则会跳到"其实没切成功的那只（还是旧宠物）"的档案页，更容易误解。
   *
   * 2026-09-12（IA 第 3 批·自定义 tabBar）：宠物档案 pages/pet-profile/index 已退出 tabBar，成为普通页面，
   * 所以这里必须用 navigateTo —— 微信只允许 switchTab 打开 tabBar.list 里的页面，
   * 对已退出 tabBar 的页面调 switchTab 会**静默失败**（不抛异常、不报错，用户点了完全没反应）。
   * 日后宠物档案若重新回到 tabBar，这里要改回 switchTab。
   */
  const handlePetClick = async (petId: string) => {
    try {
      await switchPet(petId)
    } catch (err) {
      // 优先用本次捕获的异常：store.error 可能是上一次无关操作留下的旧消息（审查 P2-5）
      const msg = err instanceof Error ? err.message : ''
      Taro.showToast({ title: msg || usePetStore.getState().error || '切换失败，请重试', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: '/pages/pet-profile/index' })
  }

  const handleAddPet = () => {
    Taro.navigateTo({ url: '/pagesPet/add/index' })
  }

  const handleCreateFamily = async () => {
    if (creating) return
    setCreating(true)
    try {
      await createFamily('星澜小筑')
      Taro.showToast({ title: '家庭创建成功', icon: 'success' })
      await fetchFamilies()
      if (user) {
        await fetchPets(user.id)
      }
      setPageReady(true)
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '创建失败', icon: 'none' })
    } finally {
      setCreating(false)
    }
  }

  /** 加入中状态标记：防止输入弹窗重复拉起/重复提交 */
  const [joining, setJoining] = useState(false)

  /**
   * 凭邀请码加入家庭（被邀请方入口，补全"生成邀请码 → 对方凭码加入"闭环）
   * 流程：官方 editable 输入框（基础库 2.17.1+，免自建弹层）→ store.joinFamily
   * （内部已刷新家庭列表、选中新家庭、拉宠物成员）→ 补拉人成员列表 → toast 反馈；
   * 失败透传服务端原因（如「邀请码无效或已过期」），不静默。
   */
  const handleJoinByCode = async () => {
    if (joining) return
    try {
      // editable 输入框为微信原生能力（基础库 2.17.1+），但 Taro 3.6 类型表未收录
      // editable/placeholderText/content（同 showNicknameAccessory 先例），展开透传绕过
      const res = await Taro.showModal({
        title: '凭邀请码加入',
        ...({ editable: true, placeholderText: '输入 TA 发给你的 6 位邀请码' } as object),
        confirmText: '加入',
        cancelText: '取消',
      } as Taro.showModal.Option)
      if (!res.confirm) return
      // 邀请码服务端统一按大写比对（generateInviteCode 只出大写），这里归一化容错小写输入
      const code = ((res as { content?: string }).content || '').trim().toUpperCase()
      if (!code) {
        Taro.showToast({ title: '请先输入邀请码', icon: 'none' })
        return
      }
      setJoining(true)
      await useFamilyStore.getState().joinFamily(code)
      // joinFamily 未覆盖人成员列表（共同养宠区展示用），单独补拉；失败不打扰主流程
      await useFamilyStore.getState().fetchUsers().catch(() => {})
      Taro.showToast({ title: '加入成功', icon: 'success' })
    } catch (err) {
      const error = err as { message?: string }
      console.error('[Family] 凭邀请码加入失败:', err)
      Taro.showToast({ title: error.message || '加入失败，请检查邀请码', icon: 'none' })
    } finally {
      setJoining(false)
    }
  }

  /** 成员角色映射（petId -> role） */
  const memberRoleMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of members) {
      if (m.petId && m.role) map[m.petId] = m.role
    }
    return map
  }, [members])

  // ===== 多成员共同养宠：人成员管理（2026-08-24） =====
  /**
   * 当前用户是否为家庭创建者（owner）
   * 判据下沉到 utils.isFamilyOwnerUser（可单测，且与「人关系」面板共用同一口径，避免两处判据漂移）；
   * 语义不变：非 owner 不能移除成员、不能增删家人关系
   */
  const isFamilyOwner = isFamilyOwnerUser(users, user?.id)

  /**
   * 复制邀请码到剪贴板（统一入口，成功/失败都有用户可见反馈）
   * 坑点：剪贴板属微信隐私接口，后台《用户隐私保护指引》未声明时真机/体验版
   * 会 fail errno 112（开发者工具不校验）——失败禁止静默，引导用户长按弹窗里的邀请码手动复制。
   * @param code 邀请码文本
   */
  const copyInviteCode = (code: string) => {
    Taro.setClipboardData({
      data: code,
      success: () => Taro.showToast({ title: '邀请码已复制', icon: 'success' }),
      fail: (e) => {
        // errno 112 = 隐私协议未声明「剪贴板」权限；弹窗 content 已含完整邀请码，手动复制也能完成流程
        console.error('[Family] 复制邀请码到剪贴板失败:', e)
        Taro.showToast({ title: '自动复制失败，请长按邀请码手动复制', icon: 'none' })
      },
    })
  }

  /** 生成邀请码并弹窗展示（仅 owner），可复制发给 TA */
  const handleInvite = async () => {
    try {
      const code = await useFamilyStore.getState().createInvite()
      console.log('[Family] 邀请码生成成功:', code)
      Taro.showModal({
        title: '邀请 TA 一起养宠',
        // 指引写明具体入口位置，避免对方拿到码后找不到输入处
        content: `邀请码：${code}，7 天内有效。发给 TA 后，TA 在「家庭」页「共同养宠」区点「凭码加入」输入即可`,
        // 坑点：微信 showModal 按钮文案上限 4 个字符，超长直接 fail 且弹窗不渲染
        // （此前「复制邀请码」5 字 → 点邀请卡完全无反应的根因，2026-08-24 修复）
        confirmText: '复制',
        cancelText: '取消',
        // 弹窗展示失败时降级：尝试自动复制邀请码，保证用户一定有反馈
        fail: () => copyInviteCode(code),
        success: (res) => {
          if (res.confirm) {
            copyInviteCode(code)
          }
        },
      })
    } catch (err) {
      const error = err as { message?: string }
      console.error('[Family] 生成邀请码失败:', err)
      Taro.showToast({ title: error.message || '生成邀请码失败', icon: 'none' })
    }
  }

  /** 移除家庭成员（仅 owner） */
  const handleRemoveUser = (userId: string, nickname: string) => {
    Taro.showModal({
      title: '移除成员',
      content: `确定移除 ${nickname || '该成员'} 吗？移除后 TA 将无法查看家庭宠物与记录`,
      confirmText: '移除',
      confirmColor: '#FF5A5F',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await useFamilyStore.getState().removeUser(userId)
          Taro.showToast({ title: '已移除', icon: 'success' })
        } catch {
          Taro.showToast({ title: '移除失败，请重试', icon: 'none' })
        }
      },
    })
  }

  const checkedCount = useMemo(
    () => Object.values(todayCheckins).filter((c) => !!c).length,
    [todayCheckins]
  )

  // ============================================================
  // 家庭成员（人）关系管理 —— 由 pagesPet/family-tree 整体搬来（2026-09-12 舰长裁决方案②）
  //
  // 【为什么归口到本页】这份「人关系」（8 种：情侣/父女/母子…，后端 family_user_relations 表）
  // 全仓只有 family-tree 一处承载，而 family-tree 与 family/lineage 导航标题逐字相同的重复问题要收口。
  // IA 口径「家庭 = 家庭相关一切的归处」正好落在这里，故搬进本页后 family-tree 才可下线。
  //
  // 【与「共同养宠」区的关系】users 是"谁在这个家里"，relations 是"家里人之间是什么关系"，
  // 两者放在同一张卡里（列表 + 设置关系入口），不另起一张卡。
  // ============================================================

  /**
   * 选择关系中的一名成员（ActionSheet 按昵称选，沿用 family-tree 的交互）
   * 少于两人时直接给出原因，而不是弹一个只有一项的选择器
   * @param field 写入表单的哪个字段
   */
  const pickUser = (field: 'userIdA' | 'userIdB') => {
    const names = users.map((u) => u.nickname || '成员')
    if (names.length < 2) {
      Taro.showToast({ title: '至少需要两名家庭成员', icon: 'none' })
      return
    }
    Taro.showActionSheet({
      itemList: names,
      success: (res) => setUserRelForm((f) => ({ ...f, [field]: users[res.tapIndex].userId })),
    })
  }

  /**
   * 创建人关系（仅 owner；失败透传服务端原因，如「两人之间已存在关系」）
   * 两个校验必须在请求前拦：自己跟自己设关系是后端会拒的无效请求
   */
  const doCreateUserRelation = async () => {
    if (!currentFamily) return
    if (!userRelForm.userIdA || !userRelForm.userIdB) {
      Taro.showToast({ title: '请选择两名成员', icon: 'none' })
      return
    }
    if (userRelForm.userIdA === userRelForm.userIdB) {
      Taro.showToast({ title: '不能给自己设置关系', icon: 'none' })
      return
    }
    try {
      await createRelation(userRelForm.userIdA, userRelForm.userIdB, userRelForm.relationType)
      Taro.showToast({ title: '关系已添加', icon: 'success' })
      setShowUserRel(false)
      setUserRelForm({ userIdA: '', userIdB: '', relationType: 'couple' })
    } catch (err) {
      const message = (err as { message?: string }).message || '添加失败'
      Taro.showToast({ title: message, icon: 'none' })
    }
  }

  /**
   * 删除人关系（仅 owner；二次确认）
   * @param relationId 关系记录 id
   */
  const handleRemoveUserRelation = (relationId: string) => {
    Taro.showModal({
      title: '删除关系',
      content: '确定删除这条成员关系吗？',
      confirmText: '删除',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await removeRelation(relationId)
          Taro.showToast({ title: '已删除', icon: 'success' })
        } catch {
          Taro.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  }

  // ============================================================
  // 宠物成员管理（原 dashboard「家庭成员 / 可邀请的毛孩子」两区能力，2026-09-12 并入）
  // 区分清楚两类成员：本页「共同养宠」区管的是**人**（users），这里管的是**宠物**（members）
  // ============================================================

  /**
   * 把一只宠物加入当前家庭
   * 409（该宠物已在家庭中）时刷新成员列表，保证 UI 与后端一致 —— 原 dashboard 的行为，保留
   */
  const handleAddPetMember = async (pet: PetProfile) => {
    if (!currentFamily) return
    try {
      await addMember(pet.id)
      Taro.showToast({ title: `${pet.name}已加入家庭`, icon: 'success' })
    } catch (err) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '添加失败', icon: 'none' })
      if (error.message === '该宠物已在家庭中') {
        await fetchFamilies()
      }
    }
  }

  /**
   * 把宠物移出家庭（二次确认；**只解除家庭归属，不删宠物档案** —— 文案里必须说清，否则用户不敢点）
   * @param memberId 家庭成员关系 id（不是 petId）
   */
  const handleRemovePetMember = (memberId: string, petName: string) => {
    if (!currentFamily) return
    Taro.showModal({
      title: '移出家庭',
      content: `确认将${petName}移出家庭吗？宠物数据会被保留。`,
      confirmText: '确认移出',
      // 微信 showModal 文案上限 4 字，超长会 fail 且弹窗不渲染
      confirmColor: '#E0856B',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await removeMember(memberId)
          Taro.showToast({ title: `${petName}已移出家庭`, icon: 'success' })
        } catch {
          Taro.showToast({ title: '操作失败', icon: 'none' })
        }
      },
    })
  }

  /**
   * 给宠物指派家庭角色（老大/团宠/…）
   * 用 ActionSheet 而不是自建弹层：6 个选项是固定短列表，原生选择器更稳（且不占包体）
   */
  const handleAssignRole = (member: PetFamilyMember, petName: string) => {
    Taro.showActionSheet({
      itemList: ROLE_LIST,
      success: async (res) => {
        const chosen = ROLE_LIST[res.tapIndex]
        try {
          await updateMemberRole(member.id, chosen)
          Taro.showToast({ title: `${petName}已成为${chosen}`, icon: 'success' })
        } catch {
          Taro.showToast({ title: '设置失败', icon: 'none' })
        }
      },
    })
  }

  // ============================================================
  // 全家福（原 dashboard「全家福 + 全家福相册」两区能力，2026-09-12 并入）
  // 生成链路：选风格 → （可选）排座次 + 选场景 → AI 生成 → 失败降级 Canvas 本地绘制
  // ============================================================

  /**
   * 带场景参数的生成函数最新引用。
   * 为什么需要它（原 dashboard 的审查 P1 修复，并入时原样保留）：
   * handleGeneratePhoto 弹出的 ActionSheet 是异步系统弹窗，其 success 回调触发时机晚于本次渲染；
   * 若直接在 deps 里引 handleGenerateWithStyle 会形成先声明后引用的 TDZ 问题，而漏加依赖又会让
   * 回调捕获旧渲染的 selectedScene/customSceneText —— 表现为"用户刚改选了海边日落，首次点击生成却仍用上一次的场景"。
   * 用 ref 中转，每次渲染把最新函数写入 ref，弹窗回调经 ref 调用，永远拿到最新闭包。
   */
  const generateWithStyleRef = useRef<((style: FamilyPhotoStyle) => Promise<void>) | null>(null)

  /** 第一步：弹出风格选择器（6 种画风） */
  const handleGeneratePhoto = useCallback(async () => {
    if (photoGenerating || aiGenerating || !currentFamily || familyPets.length === 0) return
    Taro.showActionSheet({
      itemList: FAMILY_PHOTO_STYLES.map(s => `${FAMILY_PHOTO_STYLE_LABELS[s].emoji} ${FAMILY_PHOTO_STYLE_LABELS[s].label}`),
      success: (res) => {
        const chosen = FAMILY_PHOTO_STYLES[res.tapIndex]
        setSelectedStyle(chosen)
        // 经 ref 调用最新闭包（见 generateWithStyleRef 注释），确保带上用户刚选的场景
        void generateWithStyleRef.current?.(chosen)
      },
    })
  }, [photoGenerating, aiGenerating, currentFamily, familyPets])

  /** 第二步：按选定风格生成；AI 不可用时降级 Canvas 手绘 */
  const handleGenerateWithStyle = useCallback(async (style: FamilyPhotoStyle) => {
    if (!currentFamily) return

    // 自定义场景必须先写描述（空描述会被后端 schema 拒收，提前拦截给明确提示）
    if (selectedScene === 'custom' && !customSceneText.trim()) {
      Taro.showToast({ title: '请先描述你想要的场景', icon: 'none' })
      return
    }

    setAiGenerating(true)
    setPhotoGenerating(true)
    setShowPhotoPreview(false)
    setAiProgressText('正在分析家庭成员...')

    // 进度文案轮播：AI 全家福单次约 20~40s，没有任何进度反馈时用户会以为卡死
    const progressTimer = setInterval(() => {
      setAiProgressText((prev) => {
        const texts = [
          '正在分析家庭成员...',
          '正在构建家庭合影...',
          'AI 正在绘制全家福...',
          '正在润色细节...',
          '即将完成...',
        ]
        const idx = texts.indexOf(prev)
        return idx >= 0 && idx < texts.length - 1 ? texts[idx + 1] : texts[0]
      })
    }, 2000)

    try {
      const result = await generateAiPhoto(
        style,
        selectedScene === 'custom' ? undefined : selectedScene,
        selectedScene === 'custom' ? customSceneText.trim() : undefined,
        // 成员排位：按用户排的左右座次生成（后端翻译成"从左到右依次是"的外貌列表）
        memberOrder.length > 1 ? memberOrder : undefined,
      )
      clearInterval(progressTimer)

      if (result.success && result.photoUrl) {
        setPhotoUrl(result.photoUrl)
        setShowPhotoPreview(true)
        setAiGenerating(false)
        setPhotoGenerating(false)
        setCanvasVisible(false)
        return
      }

      // 分级引导：成员只有"默认头像/无真实形象"时，AI 全家福不能按真实样子生成 ——
      // 引导用户先去上传照片/生成专属形象，不降级 Canvas（手绘占位不是真实全家福）
      // 注：progressTimer 已在 await generateAiPhoto 后统一清理，这里无需重复 clear
      if (result.code === 'MEMBER_NO_REAL_IMAGE') {
        setAiGenerating(false)
        setPhotoGenerating(false)
        setAiProgressText('')
        const names = (result.missingMembers || []).map((m) => m.name).join('、')
        Taro.showModal({
          title: '先为毛孩子生成真实形象',
          content: `「${names}」还没有真实形象。上传照片或生成专属形象后，全家福才能用它的真实样子。现在去生成？`,
          confirmText: '去生成',
          cancelText: '稍后再说',
          success: (r) => {
            if (!r.confirm) return
            // 切到第一只缺形象的宠物，形象定制页默认用它（无需用户手动切换）
            // switchPet 是网络调用，失败静默（页面仍可手动切宠物），不让未处理拒绝冒泡
            const firstMissing = result.missingMembers?.[0]
            if (firstMissing) {
              const targetPet = familyPets.find((fp) => fp.member.petId === firstMissing.petId)?.pet
              if (targetPet) {
                void switchPet(targetPet.id).catch(() => {})
              }
            }
            Taro.navigateTo({ url: '/pagesPet/avatar-customize/index' })
          },
        })
        return
      }

      // AI 失败，提示用户并降级到 Canvas
      Taro.showToast({ title: result.message || 'AI 生成失败，切换为手绘风格', icon: 'none', duration: 2000 })
    } catch {
      clearInterval(progressTimer)
      Taro.showToast({ title: 'AI 服务暂不可用，切换为手绘风格', icon: 'none', duration: 2000 })
    }

    // 降级：Canvas 本地绘制（画布是本页固定挂在 DOM 里的隐藏节点，这里只是让它可见再截图）
    setAiGenerating(false)
    setCanvasVisible(true)
    setAiProgressText('')

    // 等一帧：画布从 display:none 变可见后节点才可被 selectQuery 命中
    await new Promise(resolve => setTimeout(resolve, 300))

    try {
      const roleMap: Record<string, string> = {}
      members.forEach((m: PetFamilyMember) => { roleMap[m.petId] = m.role || '' })

      const photoPets = familyPets.map((fp) => fp.pet)
      const photoData = buildFamilyPhotoData(currentFamily.name, photoPets, roleMap)
      const result = await renderFamilyPhoto(photoData, { canvasId: 'family-photo-canvas', pixelRatio: 2 })
      setPhotoUrl(result.tempFilePath)
      setShowPhotoPreview(true)
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '生成失败，请重试', icon: 'none' })
    } finally {
      setPhotoGenerating(false)
      setCanvasVisible(false)
    }
  }, [currentFamily, familyPets, members, generateAiPhoto, switchPet, selectedScene, customSceneText, memberOrder])

  // 每次渲染把最新版生成函数写入 ref，供 handleGeneratePhoto 的弹窗回调使用（见上方注释）
  generateWithStyleRef.current = handleGenerateWithStyle

  /**
   * 保存合影：**先存系统相册、再入家庭相册**
   * 顺序不能反 —— 系统相册失败（用户拒授权等）时抛错，不应该已经把记录写进家庭相册
   */
  const handleSavePhoto = useCallback(async () => {
    if (!photoUrl) return
    try {
      await saveFamilyPhoto(photoUrl)
      const memberNames = familyPets.map((fp) => fp.pet.name)
      await savePhoto(photoUrl, familyPets.length, memberNames)
      setAlbumHighlight(true)
      setTimeout(() => setAlbumHighlight(false), 2000)
      Taro.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '保存失败', icon: 'none' })
    }
  }, [photoUrl, familyPets, savePhoto])

  /** 分享合影（showShareImageMenu 不可用时由 service 内部降级为预览） */
  const handleSharePhoto = useCallback(async () => {
    if (!photoUrl) return
    await shareFamilyPhoto(photoUrl)
  }, [photoUrl])

  /**
   * 上传本地照片入家庭相册（photoType='uploaded'）
   * 用户取消选择时 chooseMedia 会 reject，且 errMsg 含 'cancel' —— 这种不算失败，不能弹错
   */
  const handleUploadPhoto = useCallback(async () => {
    if (!currentFamily || uploading) return
    setUploading(true)
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      })
      const tempFilePath = res.tempFiles[0].tempFilePath
      const memberNames = familyPets.map((fp) => fp.pet.name)
      await savePhoto(tempFilePath, memberNames.length, memberNames, 'uploaded')
      Taro.showToast({ title: '已上传到家庭相册', icon: 'success' })
    } catch (err: unknown) {
      const error = err as { message?: string }
      if (error.message && !error.message.includes('cancel')) {
        Taro.showToast({ title: error.message || '上传失败', icon: 'none' })
      }
    } finally {
      setUploading(false)
    }
  }, [currentFamily, uploading, familyPets, savePhoto])

  /** 删除相册里的合影记录（二次确认；只删记录与文件，不影响宠物档案） */
  const handleDeletePhoto = (photoId: string) => {
    Taro.showModal({
      title: '删除照片',
      content: '确认删除这张全家福记录吗？',
      confirmColor: '#E0856B',
      success: (res) => {
        if (res.confirm) void deletePhoto(photoId)
      },
    })
  }

  const familyName = currentFamily?.name || '我的家庭'
  const today = new Date()
  const todayLabel = `${today.getMonth() + 1}月${today.getDate()}日`

  const appetiteClass = (lv: number | undefined): string => {
    if (lv === undefined) return 'good'
    if (lv <= 2 || lv >= 5) return 'warn'
    return 'good'
  }

  const spiritClass = (lv: number | undefined): string => {
    if (lv === undefined) return 'good'
    if (lv <= 2) return 'warn'
    return 'good'
  }

  const poopClass = (lv: number | undefined): string => {
    if (lv === undefined) return 'good'
    if (lv <= 2) return 'warn'
    return 'good'
  }

  if (!pageReady) {
    return (
      <View className={`family-page ${themeClass}`}>
        <View className='family-loading'>
          <Text>加载中...</Text>
        </View>
      </View>
    )
  }

  // 无家庭：显示创建家庭引导
  if (!currentFamily && !familyLoading) {
    return (
      <View className={`family-page ${themeClass}`}>
        <PageBackground />
        <View className='family-empty-state'>
          {/* 空态主视觉改用品牌插画（原来是一个 house 图标，太素） */}
          <Illustration name='empty-family' size={140} className='family-empty-illus' />
          <Text className='family-empty-title'>欢迎来到星澜小筑</Text>
          <Text className='family-empty-desc'>创建您的宠物家庭，管理毛孩子们的日常、健康与温馨回忆</Text>
          <View className='family-empty-features'>
            <View className='family-empty-feature'>
              <Icon name='dna' size={24} tone='primary' className='family-empty-feature-icon' />
              <Text className='family-empty-feature-label'>家族图谱</Text>
            </View>
            <View className='family-empty-feature'>
              <Icon name='camera' size={24} tone='primary' className='family-empty-feature-icon' />
              <Text className='family-empty-feature-label'>全家福</Text>
            </View>
            <View className='family-empty-feature'>
              <Icon name='calendar-check' size={24} tone='primary' className='family-empty-feature-icon' />
              <Text className='family-empty-feature-label'>家庭日历</Text>
            </View>
          </View>
          <View
            className='family-create-btn'
            style={{ opacity: creating ? 0.6 : 1 }}
            onClick={handleCreateFamily}
          >
            <Text>{creating ? '创建中...' : '✨ 创建我的家庭'}</Text>
          </View>
          {/* 次级入口：被邀请方凭 TA 发的邀请码加入家庭（补全邀请闭环 2026-08-24） */}
          <View className='family-join-btn' onClick={handleJoinByCode}>
            <Text>🎟️ 凭邀请码加入</Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <ScrollView className={`family-page ${themeClass}`} scrollY>
      {/* 全屏动态背景层（统一走 PageBackground 组件，才能响应背景自定义） */}
      <PageBackground />

      <View className='family-content'>
        {/* ===== 页面头图：品牌插画横幅（始终可见） =====
            标题只写页面名、不写具体家庭名 —— 下方 family-head 已经展示家庭名 + 编辑入口，
            页头再写一遍就重复了（与时光页「两套标题冲突」是同一类问题；
            且多家庭场景下页头挂某个家庭名也会失效）。 */}
        <PageHero
          illustration='page-family'
          title='宠物家庭'
          subtitle='和家人一起，记录毛孩子的每一天'
        />

        {/* ===== 1. 家庭头部 ===== */}
        <View className='family-head'>
          <View className='family-head__avatar'>
            <Icon name='paw-print' size={20} tone='primary' className='family-head__avatar-icon' />
          </View>
          <View className='family-head__info'>
            <Text className='family-head__name'>{familyName}</Text>
            <Text className='family-head__sub'>{pets.length} 位成员 · {checkedCount} 位已打卡</Text>
          </View>
          <View
            className='family-head__edit'
            onClick={() => Taro.navigateTo({ url: '/pagesPet/family/calendar/index' })}
          >
            <Icon name='calendar-check' size={14} tone='primary' className='family-head__edit-icon' />
          </View>
        </View>

        {/* ===== 2. 成员宠物横滑条 ===== */}
        <ScrollView scrollX className='family-member-strip' enhanced showScrollbar={false}>
          <View className='family-member-strip__inner'>
            {pets.map((pet, index) => {
              const checked = !!todayCheckins[pet.id]
              const role = memberRoleMap[pet.id]
              const borderColor = index % 3 === 0 ? '#FF6B3D' : index % 3 === 1 ? '#FFB020' : '#8B6E58'
              return (
                <View
                  key={pet.id}
                  className='family-member-card'
                  onClick={() => handlePetClick(pet.id)}
                >
                  <View className='family-member-card__avatar-wrap'>
                    <View className='family-member-card__avatar' style={{ borderColor }}>
                      <FamilyPetAvatar
                        pet={pet}
                        imgClass='family-member-card__avatar-img'
                        emojiClass='family-member-card__avatar-emoji'
                      />
                    </View>
                    <View className={`family-member-card__dot${checked ? ' family-member-card__dot--on' : ''}`} />
                  </View>
                  <Text className='family-member-card__name'>{pet.name}</Text>
                  <Text className='family-member-card__status'>{checked ? '已打卡' : '未打卡'}</Text>
                  {role && (
                    <View className='family-member-card__role'>
                      <Text className='family-member-card__role-text'>{role}</Text>
                    </View>
                  )}
                </View>
              )
            })}
            <View className='family-member-card' onClick={handleAddPet}>
              <View className='family-member-card__avatar family-member-card__avatar--add'>
                <Text className='family-member-card__avatar-emoji'>＋</Text>
              </View>
              <Text className='family-member-card__name'>添加宠物</Text>
            </View>
          </View>
        </ScrollView>

        {/* ===== 2.5 共同养宠（人成员，多成员共同养宠 2026-08-24） =====
            2026-09-12：本卡增补「人关系」—— 谁和谁是什么关系（情侣/父女/母子…8 种），
            这份能力原本只存在于 pagesPet/family-tree（该页本轮下线）。卡片右上角由「N 位家人」
            换成「设置关系」入口；关系列表贴在成员横滑条下方，不再另起一张卡。 */}
        <View className='family-co-care'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Icon name='users' size={14} tone='primary' className='family-card__icon' />
              <Text className='family-card__title'>共同养宠</Text>
            </View>
            {/* 设置关系入口：全员可见（非 owner 打开后是只读面板，增删按钮不渲染） */}
            <View className='family-rel__entry' data-testid='family-rel-entry' onClick={() => setShowUserRel(true)}>
              <Icon name='share-network' size={12} tone='primary' className='family-rel__entry-icon' />
              <Text className='family-rel__entry-text'>设置关系</Text>
              {relations.length > 0 && <Text className='family-rel__entry-count'>{relations.length}</Text>}
            </View>
          </View>
          <ScrollView scrollX className='family-user-strip' enhanced showScrollbar={false}>
            <View className='family-user-strip__inner'>
              {users.map((u) => (
                <View key={u.userId} className='family-user-card'>
                  <View className='family-user-card__avatar-wrap'>
                    {u.avatarUrl ? (
                      <Image className='family-user-card__avatar' src={u.avatarUrl} mode='aspectFill' />
                    ) : (
                      <View className='family-user-card__avatar family-user-card__avatar--fallback'>
                        <Icon name='paw-print' size={22} tone='primary' className='family-user-card__avatar-emoji' />
                      </View>
                    )}
                  </View>
                  <Text className='family-user-card__name'>{u.nickname || (u.role === 'owner' ? '我' : '家人')}</Text>
                  <Text className={`family-user-card__role family-user-card__role--${u.role}`}>
                    {u.role === 'owner' ? '创建者' : '成员'}
                  </Text>
                  {isFamilyOwner && u.role !== 'owner' && (
                    <View className='family-user-card__remove' onClick={() => handleRemoveUser(u.userId, u.nickname || '')}>
                      <Text className='family-user-card__remove-text'>移除</Text>
                    </View>
                  )}
                </View>
              ))}
              {/* 凭码加入：手里有别的家庭发的邀请码时，从这里输入加入（全员可见，2026-08-24） */}
              <View className='family-user-card' onClick={handleJoinByCode}>
                <View className='family-user-card__avatar-wrap'>
                  <View className='family-user-card__avatar family-user-card__avatar--add'>
                    <Text className='family-user-card__avatar-emoji'>🎟️</Text>
                  </View>
                </View>
                <Text className='family-user-card__name'>凭码加入</Text>
                <Text className='family-user-card__role family-user-card__role--member'>输邀请码</Text>
              </View>
              {isFamilyOwner && (
                <View className='family-user-card' onClick={handleInvite}>
                  <View className='family-user-card__avatar-wrap'>
                    <View className='family-user-card__avatar family-user-card__avatar--add'>
                      <Text className='family-user-card__avatar-emoji'>＋</Text>
                    </View>
                  </View>
                  <Text className='family-user-card__name'>邀请 TA</Text>
                  <Text className='family-user-card__role family-user-card__role--member'>一起养宠</Text>
                </View>
              )}
            </View>
          </ScrollView>

          {/* 关系列表（原 family-tree 的「人关系列表」） */}
          {relations.length > 0 && (
            <View className='family-rel__list' data-testid='family-rel-list'>
              {relations.map((r) => (
                <View key={r.id} className='family-rel__row' data-testid='family-rel-row'>
                  <Text className='family-rel__emoji'>{USER_REL_META[r.relationType]?.emoji || '💞'}</Text>
                  <Text className='family-rel__text'>{describeUserRelation(r)}</Text>
                  {isFamilyOwner && (
                    <View className='family-rel__remove' onClick={() => handleRemoveUserRelation(r.id)}>
                      <Text className='family-rel__remove-text'>✕</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ===== 2.6 宠物成员管理（原「家庭看板」的家庭成员 + 可加入的毛孩子，2026-09-12 并入） =====
            为什么并入后仍然只列 familyPets（家庭成员）而不是全部 pets：
            本卡的三个动作（设角色 / 移出家庭）都作用在"家庭 ↔ 宠物"这层关系上，
            用 members 才与后端一致；没进家庭的宠物在下方「加入家庭」区，不会被误当成已入册成员。 */}
        <View className='family-card'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Icon name='paw-print' size={14} tone='primary' className='family-card__icon' />
              <Text className='family-card__title'>成员宠物</Text>
            </View>
            <Text className='family-card__meta'>{familyPets.length} 位已入家庭</Text>
          </View>

          {familyPets.length > 0 ? (
            <View className='family-pet-grid'>
              {familyPets.map(({ member, pet }) => (
                <View key={member.petId} className='family-pet-card'>
                  <View className='family-pet-card__top'>
                    <View className='family-pet-card__avatar-wrap'>
                      <FamilyPetAvatar
                        pet={pet}
                        imgClass='family-pet-card__avatar-img'
                        emojiClass='family-pet-card__avatar-emoji'
                      />
                    </View>
                    <View className='family-pet-card__role-btn' onClick={() => handleAssignRole(member, pet.name)}>
                      <Text className='family-pet-card__role-btn-text'>角色</Text>
                    </View>
                  </View>
                  <Text className='family-pet-card__name'>{pet.name}</Text>
                  <Text className='family-pet-card__role'>
                    {member.role ? `${roleIcon(member.role)} ${member.role}`.trim() : '未设角色'}
                  </Text>
                  <Text className='family-pet-card__breed'>{pet.breed || '未知品种'}</Text>
                  <View className='family-pet-card__remove' onClick={() => handleRemovePetMember(member.id, pet.name)}>
                    <Text className='family-pet-card__remove-text'>移出家庭</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className='family-pet-empty'>
              <Text className='family-pet-empty__text'>
                还没有宠物加入这个家庭，从下方「加入家庭」把毛孩子接进来吧
              </Text>
            </View>
          )}

          {/* 还没进家庭的宠物：一键加入（原 dashboard 的「可邀请的毛孩子」区） */}
          {unassignedPets.length > 0 && (
            <View className='family-pet-invite'>
              <View className='family-pet-invite__head'>
                <Text className='family-pet-invite__title'>加入家庭</Text>
                <Text className='family-pet-invite__count'>{unassignedPets.length} 位待加入</Text>
              </View>
              {unassignedPets.map((pet) => (
                <View key={pet.id} className='family-pet-invite__row'>
                  <View className='family-pet-invite__avatar'>
                    <FamilyPetAvatar
                      pet={pet}
                      imgClass='family-pet-invite__avatar-img'
                      emojiClass='family-pet-invite__avatar-emoji'
                    />
                  </View>
                  <View className='family-pet-invite__info'>
                    <Text className='family-pet-invite__name'>{pet.name}</Text>
                    <Text className='family-pet-invite__breed'>{pet.breed || '未知品种'}</Text>
                  </View>
                  <View className='family-pet-invite__btn' onClick={() => handleAddPetMember(pet)}>
                    <Text className='family-pet-invite__btn-text'>+ 加入</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ===== 3. 今日健康摘要卡 ===== */}
        <View className='family-card'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Icon name='heart' size={14} tone='primary' className='family-card__icon' />
              <Text className='family-card__title'>今日健康摘要</Text>
            </View>
            <Text className='family-card__meta'>{todayLabel} · {checkedCount}/{pets.length}打卡</Text>
          </View>
          <View className='family-summary__list'>
            {pets.map((pet) => {
              const checkin = todayCheckins[pet.id]
              if (!checkin) {
                return (
                  <View key={pet.id} className='family-summary__row'>
                    <View className='family-summary__avatar'>
                      <FamilyPetAvatar
                        pet={pet}
                        imgClass='family-summary__avatar-img'
                        emojiClass='family-summary__avatar-emoji'
                      />
                    </View>
                    <Text className='family-summary__name'>{pet.name}</Text>
                    <View className='family-summary__chip family-summary__chip--uncheck'>
                      <Text className='family-summary__chip-text'>🕐 今日未打卡</Text>
                    </View>
                  </View>
                )
              }
              return (
                <View key={pet.id} className='family-summary__row'>
                  <View className='family-summary__avatar'>
                    <FamilyPetAvatar
                      pet={pet}
                      imgClass='family-summary__avatar-img'
                      emojiClass='family-summary__avatar-emoji'
                    />
                  </View>
                  <Text className='family-summary__name'>{pet.name}</Text>
                  <View className='family-summary__chips'>
                    <View className='family-summary__chip'>
                      <Text className='family-summary__chip-label'>便便</Text>
                      <Text className={`family-summary__chip-value family-summary__chip-value--${poopClass(checkin.poopLevel)}`}>
                        {checkin.poopLevel}/5
                      </Text>
                    </View>
                    <View className='family-summary__chip'>
                      <Text className='family-summary__chip-label'>食欲</Text>
                      <Text className={`family-summary__chip-value family-summary__chip-value--${appetiteClass(checkin.appetiteLevel)}`}>
                        {APPETITE_TEXT[checkin.appetiteLevel] || '正常'}
                      </Text>
                    </View>
                    <View className='family-summary__chip'>
                      <Text className='family-summary__chip-label'>精神</Text>
                      <Text className={`family-summary__chip-value family-summary__chip-value--${spiritClass(checkin.spiritLevel)}`}>
                        {SPIRIT_TEXT[checkin.spiritLevel] || '良好'}
                      </Text>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        {/* ===== 4. 家族图谱缩略入口卡 ===== */}
        <View className='family-card'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Text className='family-card__icon'>🔗</Text>
              <Text className='family-card__title'>家族图谱</Text>
            </View>
            <Text className='family-card__meta'>{pets.length} 位成员</Text>
          </View>
          <View className='family-graph__preview'>
            {pets.slice(0, 3).map((pet, index) => (
              <View key={pet.id} className='family-graph__node'>
                <View
                  className='family-graph__avatar'
                  style={{ borderColor: index % 3 === 0 ? '#FF6B3D' : index % 3 === 1 ? '#FFB020' : '#8B6E58' }}
                >
                  <FamilyPetAvatar
                    pet={pet}
                    imgClass='family-graph__avatar-img'
                    emojiClass='family-graph__avatar-emoji'
                  />
                </View>
                <Text className='family-graph__name'>{pet.name}</Text>
              </View>
            ))}
            {pets.length > 3 && (
              <>
                <View className='family-graph__line' />
                <View className='family-graph__node'>
                  <View className='family-graph__avatar family-graph__avatar--more'>
                    <Text className='family-graph__avatar-emoji'>+{pets.length - 3}</Text>
                  </View>
                  <Text className='family-graph__name'>更多</Text>
                </View>
              </>
            )}
          </View>
          <View
            className='family-graph__btn'
            onClick={() => Taro.navigateTo({ url: '/pagesPet/family/lineage/index' })}
          >
            <Text className='family-graph__btn-text'>查看家族图谱</Text>
          </View>
        </View>

        {/* ===== 5. 家庭日历要点卡 ===== */}
        <View className='family-card'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Icon name='calendar-check' size={14} tone='primary' className='family-card__icon' />
              <Text className='family-card__title'>家庭日历</Text>
            </View>
            <Text className='family-card__meta'>本月 {calendarEvents.length} 件事</Text>
          </View>
          {calendarEvents.length > 0 ? (
            <View className='family-calendar__list'>
              {calendarEvents.map((event) => (
                <View key={event.id} className='family-calendar__item'>
                  <View className='family-calendar__dot' />
                  <View className={`family-calendar__icon family-calendar__icon--${event.color}`}>
                    <Text className='family-calendar__icon-text'>{event.type === 'vaccine' ? '💉' : '🎁'}</Text>
                  </View>
                  <View className='family-calendar__info'>
                    <Text className='family-calendar__title'>{event.title}</Text>
                    <Text className='family-calendar__sub'>{event.sub}</Text>
                  </View>
                  <Text className='family-calendar__date'>{event.date}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View className='family-calendar__empty'>
              <Text className='family-calendar__empty-text'>本月暂无安排，去给毛孩子添加疫苗或纪念日吧</Text>
            </View>
          )}
        </View>

        {/* ===== 6. 家庭周报入口卡 ===== */}
        <View
          className='family-card family-report-entry'
          onClick={() => Taro.navigateTo({ url: '/pagesPet/weekly-report/index' })}
        >
          <View className='family-report-entry__icon'>
            <Icon name='clipboard-text' size={20} tone='primary' className='family-report-entry__icon-text' />
          </View>
          <View className='family-report-entry__info'>
            <Text className='family-report-entry__title'>家庭周报</Text>
            <Text className='family-report-entry__sub'>AI 总结本周全家动态</Text>
          </View>
          <View className='family-report-entry__badge'>
            <Text className='family-report-entry__badge-text'>✨ AI 周报</Text>
          </View>
          <Text className='family-report-entry__arrow'>›</Text>
        </View>

        {/* ===== 6.5 全家福（生成 + 相册）—— 原「家庭看板」的核心能力，2026-09-12 并入 =====
            为什么单独给「全家福」一张卡而不是塞进「家族图谱」卡：
            生成动作需要 22 个场景 + 6 种画风的完整选择器，塞进已有卡片会把图谱入口挤到屏外。 */}
        <View className='family-card'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Icon name='camera' size={14} tone='primary' className='family-card__icon' />
              <Text className='family-card__title'>全家福</Text>
            </View>
            <Text className='family-card__meta'>{familyPets.length} 位毛孩子</Text>
          </View>

          {familyPets.length === 0 ? (
            <View className='family-photo__empty'>
              <Illustration name='empty-family' size={120} className='family-photo__empty-illus' />
              <Text className='family-photo__empty-text'>先让毛孩子加入家庭，再一起拍张全家福吧</Text>
            </View>
          ) : showPhotoPreview && photoUrl ? (
            /* 生成完成：预览 + 存相册 + 分享 + 重新生成 */
            <View className='family-photo__preview'>
              <View
                className='family-photo__preview-img-wrap'
                onClick={() => Taro.previewImage({ urls: [photoUrl], current: photoUrl })}
              >
                <View className='family-photo__preview-img' style={{ backgroundImage: `url(${photoUrl})` }} />
                <View className='family-photo__preview-tap'>
                  <Text>点击查看大图</Text>
                </View>
              </View>
              <View className='family-photo__preview-actions'>
                <View className='family-photo__btn family-photo__btn--outline' onClick={handleSavePhoto}>
                  <Text className='family-photo__btn-text'>💾 保存到相册</Text>
                </View>
                <View className='family-photo__btn family-photo__btn--primary' onClick={handleSharePhoto}>
                  <Text className='family-photo__btn-text'>📤 分享给家人</Text>
                </View>
              </View>
              <View className='family-photo__regenerate' onClick={handleGeneratePhoto}>
                <Text className='family-photo__regenerate-text'>🔄 重新生成</Text>
              </View>
            </View>
          ) : aiGenerating ? (
            /* AI 生成中：轮播进度文案（约 20~40s，无反馈会被当成卡死） */
            <View className='family-photo__generating'>
              <View className='family-photo__generating-spinner' />
              <Text className='family-photo__generating-text'>{aiProgressText}</Text>
              <Text className='family-photo__generating-style'>
                场景：{selectedScene === 'custom'
                  ? `✏️ ${customSceneText.trim().slice(0, 8) || '自定义'}`
                  : `${FAMILY_PHOTO_SCENE_LABELS[selectedScene].emoji} ${FAMILY_PHOTO_SCENE_LABELS[selectedScene].label}`}
                {' · '}风格：{FAMILY_PHOTO_STYLE_LABELS[selectedStyle].emoji} {FAMILY_PHOTO_STYLE_LABELS[selectedStyle].label}
              </Text>
              <Text className='family-photo__generating-hint'>AI 正在为您生成全家福，请耐心等待...</Text>
            </View>
          ) : (
            /* 未生成：成员预览 + 座次 + 场景 + 生成按钮 */
            <View className='family-photo__setup'>
              <View className='family-photo__members'>
                {familyPets.slice(0, 6).map(({ pet }) => (
                  <View key={pet.id} className='family-photo__member'>
                    <FamilyPetAvatar
                      pet={pet}
                      imgClass='family-photo__member-img'
                      emojiClass='family-photo__member-emoji'
                    />
                  </View>
                ))}
                {familyPets.length > 6 && (
                  <View className='family-photo__member family-photo__member--more'>
                    <Text className='family-photo__member-more'>+{familyPets.length - 6}</Text>
                  </View>
                )}
              </View>
              <Text className='family-photo__desc'>选好场景和画风，AI 为全家合成一张精美的合影</Text>

              {/* 成员座次：排在前面的=画面里靠左边（名字只在这里显示，不进 AI 提示词） */}
              {familyPets.length > 1 && (
                <View className='family-photo__order'>
                  <Text className='family-photo__order-title'>🪑 排个座次</Text>
                  <Text className='family-photo__order-hint'>排在前面 = 合影里靠左边；名字不会发给 AI，AI 认毛色</Text>
                  <ScrollView scrollX className='family-photo__order-scroll' enhanced showScrollbar={false}>
                    <View className='family-photo__order-row'>
                      {memberOrder.map((petId, idx) => {
                        const fp = familyPets.find(f => f.member.petId === petId)
                        if (!fp) return null
                        return (
                          <View key={petId} className='family-photo__order-item'>
                            <Text className='family-photo__order-pos'>{idx + 1}</Text>
                            <Image
                              className='family-photo__order-avatar'
                              src={fp.pet.avatarPhotoUrl || fp.pet.avatarCartoonUrl || ''}
                              mode='aspectFill'
                              lazyLoad
                            />
                            <Text className='family-photo__order-name'>{fp.pet.name}</Text>
                            <View className='family-photo__order-btns'>
                              <View
                                className={`family-photo__order-btn${idx === 0 ? ' family-photo__order-btn--disabled' : ''}`}
                                onClick={() => setMemberOrder(prev => moveInOrder(prev, petId, -1))}
                              >
                                <Text className='family-photo__order-btn-text'>‹</Text>
                              </View>
                              <View
                                className={`family-photo__order-btn${idx === memberOrder.length - 1 ? ' family-photo__order-btn--disabled' : ''}`}
                                onClick={() => setMemberOrder(prev => moveInOrder(prev, petId, 1))}
                              >
                                <Text className='family-photo__order-btn-text'>›</Text>
                              </View>
                            </View>
                          </View>
                        )
                      })}
                    </View>
                  </ScrollView>
                </View>
              )}

              {/* 场景选择：五大主题分组 + 自定义描述（22 个场景分页，避免一屏铺满看不到按钮） */}
              <View className='family-photo__scene'>
                <View className='family-photo__scene-tabs'>
                  {FAMILY_PHOTO_SCENE_GROUPS.map((group, idx) => (
                    <View
                      key={group.key}
                      className={`family-photo__scene-tab${idx === activeSceneGroup ? ' family-photo__scene-tab--active' : ''}`}
                      onClick={() => setActiveSceneGroup(idx)}
                    >
                      <Text className='family-photo__scene-tab-text'>{group.emoji} {group.label}</Text>
                    </View>
                  ))}
                </View>
                <View className='family-photo__scene-grid'>
                  {FAMILY_PHOTO_SCENE_GROUPS[activeSceneGroup].scenes.map((sceneKey) => {
                    const meta = FAMILY_PHOTO_SCENE_LABELS[sceneKey]
                    return (
                      <View
                        key={sceneKey}
                        className={`family-photo__scene-chip${selectedScene === sceneKey ? ' family-photo__scene-chip--active' : ''}`}
                        onClick={() => setSelectedScene(sceneKey)}
                      >
                        <Text className='family-photo__scene-emoji'>{meta.emoji}</Text>
                        <Text className='family-photo__scene-label'>{meta.label}</Text>
                      </View>
                    )
                  })}
                  <View
                    className={`family-photo__scene-chip family-photo__scene-chip--custom${selectedScene === 'custom' ? ' family-photo__scene-chip--active' : ''}`}
                    onClick={() => setSelectedScene('custom')}
                  >
                    <Text className='family-photo__scene-emoji'>✏️</Text>
                    <Text className='family-photo__scene-label'>自定义</Text>
                  </View>
                </View>
                {selectedScene === 'custom' && (
                  <Textarea
                    className='family-photo__scene-input'
                    value={customSceneText}
                    maxlength={60}
                    placeholder='用一句话描述你想要的场景，如：在我家的院子里晒太阳'
                    onInput={(e) => setCustomSceneText(e.detail.value)}
                  />
                )}
              </View>

              <View
                className={`family-photo__generate-btn${photoGenerating ? ' family-photo__generate-btn--loading' : ''}`}
                onClick={handleGeneratePhoto}
              >
                <Text className='family-photo__generate-btn-text'>
                  {photoGenerating ? '⏳ 生成中...' : '✨ 生成全家福'}
                </Text>
              </View>
            </View>
          )}

          {/* Canvas 降级绘制用画布：常驻挂载、固定 0×0 且留在视口内
              （canvas 节点必须先存在才能被 Taro.createSelectorQuery 命中）
              ⚠️ 不能用 left:-9999px 把它推出视口 —— 那是 dashboard 当年的写法，属于既知风险：
                 节点移出视口后部分基础库下 createSelectorQuery().fields({node:true}) 拿不到 node，
                 降级路径会直接报 "Canvas context not found"。舰长 2026-09-12 批准改为
                 0×0 屏内节点（不需要画布可见面积，绘制与导出走 node 而非布局尺寸）。 */}
          <Canvas
            className='family-photo__canvas'
            canvasId='family-photo-canvas'
            id='family-photo-canvas'
            style={{
              display: canvasVisible ? 'block' : 'none',
              position: 'fixed',
              left: '0px',
              top: '0px',
              width: '0px',
              height: '0px',
            }}
            type='2d'
          />
        </View>

        {/* ===== 6.6 全家福相册（原「家庭看板」的相册区，2026-09-12 并入） ===== */}
        <View className='family-card'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Icon name='image' size={14} tone='primary' className='family-card__icon' />
              <Text className='family-card__title'>全家福相册</Text>
              {albumHighlight && <Text className='family-album__new'>NEW</Text>}
            </View>
            <View className='family-album__upload' onClick={handleUploadPhoto}>
              <Text className='family-album__upload-text'>{uploading ? '⏳' : '📤'} 上传照片</Text>
            </View>
          </View>

          {photosLoading ? (
            <View className='family-album__loading'>
              <Text className='family-album__loading-text'>加载相册中...</Text>
            </View>
          ) : photos.length === 0 ? (
            <View className='family-album__empty'>
              <Text className='family-album__empty-title'>珍藏每一刻</Text>
              <Text className='family-album__empty-text'>
                生成全家福后点「保存到相册」，或点上方「上传照片」分享精彩瞬间
              </Text>
            </View>
          ) : (
            <View className={`family-album__list${albumHighlight ? ' family-album__list--highlight' : ''}`}>
              {photoGroups.map((group) => (
                <View key={group.label} className='family-album__group'>
                  <View className='family-album__group-head'>
                    <Text className='family-album__group-label'>{group.label}</Text>
                    <Text className='family-album__group-count'>{group.photos.length} 张</Text>
                  </View>
                  <View className='family-album__grid'>
                    {group.photos.map((photo: FamilyPhoto) => (
                      <View
                        key={photo.id}
                        className={`family-album__item${photo.photoType === 'uploaded' ? ' family-album__item--uploaded' : ''}`}
                      >
                        <View
                          className='family-album__item-img'
                          onClick={() => photo.photoUrl
                            ? Taro.previewImage({ urls: [photo.photoUrl], current: photo.photoUrl })
                            : undefined}
                        >
                          {photo.photoUrl ? (
                            /* 后端返回的是真实图片地址时直接显示缩略图（原 dashboard 只画占位图标，
                               有图却显示 🏡 会让用户以为照片没存上） */
                            <Image className='family-album__item-photo' src={photo.photoUrl} mode='aspectFill' lazyLoad />
                          ) : (
                            <View className='family-album__item-placeholder'>
                              <Text className='family-album__item-emoji'>
                                {photo.photoType === 'uploaded' ? '🖼️' : '🏡'}
                              </Text>
                            </View>
                          )}
                          {photo.photoType === 'uploaded' && (
                            <View className='family-album__item-badge'>
                              <Text className='family-album__item-badge-text'>用户上传</Text>
                            </View>
                          )}
                        </View>
                        <View className='family-album__item-body'>
                          <View className='family-album__item-head'>
                            <Text className='family-album__item-date'>
                              {photo.createdAt ? photo.createdAt.slice(0, 10) : ''}
                            </Text>
                            {/* AI 生成的照片带场景标签（上传/手绘照片无 scene 字段时不显示） */}
                            {(photo.photoType === 'ai_generated' || photo.photoType === 'generated')
                              && photo.scene
                              && FAMILY_PHOTO_SCENE_LABELS[photo.scene as FamilyPhotoScene] && (
                              <Text className='family-album__item-scene'>
                                {FAMILY_PHOTO_SCENE_LABELS[photo.scene as FamilyPhotoScene].emoji}
                                {FAMILY_PHOTO_SCENE_LABELS[photo.scene as FamilyPhotoScene].label}
                              </Text>
                            )}
                          </View>
                          <View className='family-album__item-foot'>
                            <Text className='family-album__item-count'>{photo.memberCount} 位成员</Text>
                            <View className='family-album__item-del' onClick={() => handleDeletePhoto(photo.id)}>
                              <Text className='family-album__item-del-text'>删除</Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ===== 7. 家庭动态墙预览 ===== */}
        <View className='family-card'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Text className='family-card__icon'>✨</Text>
              <Text className='family-card__title'>家庭动态</Text>
            </View>
            {/* ⚠️ 这个数字必须与下面**真正渲染出来的条数**对得上。
                原先写的是 `共 {moments.length} 条`（取数时最多取 5 条），而列表是
                `moments.slice(0, 2)` —— 于是卡片头上写着"共 5 条"、下面只有 2 行，
                卡内又没有任何"查看全部"入口，用户会以为剩下 3 条**没加载出来**
                （28 号 复核取图时发现）。这里不新造路由（家庭动态目前没有"全部"页），
                改为在截断时**如实说明**，数字与可见行数一致。 */}
            <Text className='family-card__meta'>
              {moments.length > FEED_PREVIEW_COUNT
                ? `共 ${moments.length} 条 · 显示最近 ${FEED_PREVIEW_COUNT} 条`
                : `共 ${moments.length} 条`}
            </Text>
          </View>

          {showNewMoments && newMomentsCount > 0 && (
            <View className='family-new-moments-bar' onClick={handleLoadNewMoments}>
              <View className='family-new-moments-dot' />
              <Text className='family-new-moments-text'>{newMomentsCount}条新动态</Text>
              <Text className='family-new-moments-arrow'>查看 ▸</Text>
            </View>
          )}

          {moments.length > 0 ? (
            <View className='family-feed__list'>
              {moments.slice(0, FEED_PREVIEW_COUNT).map((moment) => (
                <View key={moment.id} className='family-feed__item'>
                  <View className='family-feed__avatar'>
                    <Icon name='paw-print' size={16} tone='primary' className='family-feed__avatar-emoji' />
                  </View>
                  <Text className='family-feed__text'>
                    <Text className='family-feed__text-bold'>{getMomentPetName(moment)}</Text>
                    {getMomentText(moment)}
                  </Text>
                  <Text className='family-feed__time'>{formatRelativeTime(moment.createdAt)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View className='family-feed__empty'>
              <Text className='family-feed__empty-text'>还没有动态，快去记录毛孩子的日常吧</Text>
            </View>
          )}
        </View>

        <View className='family-bottom-safe' />
      </View>

      {/* ===== 设置关系面板（原 family-tree 的「添加成员（人）关系面板」，2026-09-12 搬来）=====
          放在 ScrollView 之后而不是内容流里：它是盖在页面上的浮层（overlay + 底部面板），
          放内容流里会被 ScrollView 的滚动容器裁切。
          非 owner 打开时只显示已存在的关系（只读），底部"确认添加"不渲染 —— 权限没有放宽。 */}
      {showUserRel && (
        <>
          <View className='family-rel-overlay' onClick={() => setShowUserRel(false)} />
          <View className='family-rel-panel' data-testid='family-rel-panel'>
            <View className='family-rel-panel__head'>
              <Text className='family-rel-panel__title'>设置家人关系</Text>
              <Text className='family-rel-panel__close' onClick={() => setShowUserRel(false)}>✕</Text>
            </View>
            <View className='family-rel-panel__body'>
              {isFamilyOwner ? (
                <>
                  <View className='family-rel-form__field'>
                    <Text className='family-rel-form__label'>成员 A</Text>
                    <View className='family-rel-form__picker' onClick={() => pickUser('userIdA')}>
                      <Text className={userRelForm.userIdA ? '' : 'family-rel-form__placeholder'}>
                        {userRelForm.userIdA
                          ? users.find(u => u.userId === userRelForm.userIdA)?.nickname || '已选择'
                          : '请选择成员 A'}
                      </Text>
                      <Text>›</Text>
                    </View>
                  </View>
                  <View className='family-rel-form__field'>
                    <Text className='family-rel-form__label'>成员 B</Text>
                    <View className='family-rel-form__picker' onClick={() => pickUser('userIdB')}>
                      <Text className={userRelForm.userIdB ? '' : 'family-rel-form__placeholder'}>
                        {userRelForm.userIdB
                          ? users.find(u => u.userId === userRelForm.userIdB)?.nickname || '已选择'
                          : '请选择成员 B'}
                      </Text>
                      <Text>›</Text>
                    </View>
                  </View>
                  <View className='family-rel-form__field'>
                    <Text className='family-rel-form__label'>关系类型</Text>
                    <View className='family-rel-form__types'>
                      {(Object.keys(USER_REL_META) as FamilyUserRelationType[]).map(t => (
                        <View
                          key={t}
                          className={`family-rel-form__type${userRelForm.relationType === t ? ' family-rel-form__type--active' : ''}`}
                          onClick={() => setUserRelForm(f => ({ ...f, relationType: t }))}
                        >
                          <Text className='family-rel-form__type-text'>
                            {USER_REL_META[t].emoji} {USER_REL_META[t].label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <View className='family-rel-form__submit' onClick={doCreateUserRelation}>
                    <Text className='family-rel-form__submit-text'>确认添加</Text>
                  </View>
                </>
              ) : (
                /* 非 owner：只读面板。说明为什么不能改，而不是给一个点了没反应的按钮 */
                <View className='family-rel-panel__readonly'>
                  <Text className='family-rel-panel__readonly-text'>
                    只有家庭创建者可以添加或删除家人关系。当前已记录 {relations.length} 条关系。
                  </Text>
                </View>
              )}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  )
}
