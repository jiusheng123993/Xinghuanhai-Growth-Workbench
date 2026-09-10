/**
 * 家庭页面
 * 家庭头部 + 成员横滑 + 今日健康摘要 + 家族图谱 + 家庭日历 + 家庭周报 + 家庭动态预览
 */
import { View, Text, ScrollView, Image } from '@tarojs/components'
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
import type { PetMoment } from '../../types/familyTypes'
import type { PetHealthEntry } from '../../services/checkinService'
import { usePolling } from '../../hooks/usePolling'
import { calculateHealthScore } from './utils'
import FamilyPetAvatar from './FamilyPetAvatar'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import './index.scss'
import { Icon, PageHero, Illustration } from '../../components'
import PageBackground from '../../components/PageBackground'

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
  const { pets, fetchPets, switchPet } = usePetStore()
  const { currentFamily, members, users, fetchFamilies, createFamily, loading: familyLoading } = useFamilyStore()
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
   * 后续的 switchTab 也不会执行 —— 用户点一下宠物"什么都没发生"。
   * 失败时明确提示并**不跳转**：否则会跳到"其实没切成功的那只（还是旧宠物）"的档案页，更容易误解。
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
    Taro.switchTab({ url: '/pages/pet-profile/index' })
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
  /** 当前用户是否为家庭创建者（owner） */
  const isFamilyOwner = !!users.find((u) => u.userId === user?.id && u.role === 'owner')

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
      <View className='family-page'>
        <View className='family-loading'>
          <Text>加载中...</Text>
        </View>
      </View>
    )
  }

  // 无家庭：显示创建家庭引导
  if (!currentFamily && !familyLoading) {
    return (
      <View className='family-page'>
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
    <ScrollView className='family-page' scrollY>
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
            onClick={() => Taro.navigateTo({ url: '/pagesPet/family/dashboard/index' })}
          >
            <Icon name='pencil-simple' size={14} tone='primary' className='family-head__edit-icon' />
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

        {/* ===== 2.5 共同养宠（人成员，多成员共同养宠 2026-08-24） ===== */}
        <View className='family-co-care'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Icon name='users' size={14} tone='primary' className='family-card__icon' />
              <Text className='family-card__title'>共同养宠</Text>
            </View>
            <Text className='family-card__meta'>{users.length} 位家人</Text>
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

        {/* ===== 7. 家庭动态墙预览 ===== */}
        <View className='family-card'>
          <View className='family-card__head'>
            <View className='family-card__title-wrap'>
              <Text className='family-card__icon'>✨</Text>
              <Text className='family-card__title'>家庭动态</Text>
            </View>
            <Text className='family-card__meta'>共 {moments.length} 条</Text>
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
              {moments.slice(0, 2).map((moment) => (
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
    </ScrollView>
  )
}
