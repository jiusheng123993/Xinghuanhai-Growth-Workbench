/**
 * 宠物档案页面（高保真 v2 · 屏 06「宠物档案」）
 *
 * 【v2 的骨架只有三块】
 *   ① 宽幅页头：hero 插画 + 宠物身份（名字 / 品种 · 年龄 · 已陪伴天数）
 *   ② 第一组 menulist「健康档案」：健康趋势与报告 / 疫苗日历 / 慢病记录 / 喂养记录
 *   ③ 第二组 menulist「关于 {宠物名}」：生日与纪念日 / 形象与头像 / 家庭成员与血缘 / 编辑档案
 *   页头插画走既有的四季插画机制（`page-pet-profile` → 服务器
 *   `/uploads/illustrations/seasonal/pet-profile-<季>-hero.jpg`），按原始比例铺满卡片宽度、
 *   不裁切；宠物身份叠在插画**右侧**那片刻意留出的空白上（四季图的猫狗都画在左侧）。
 *
 * 【为什么推翻 2026-09-11「方向 C」那版手账风】
 *   手账版把「宠物身份证（拍立得 + 证件字段 + 便签 + 图章 + 宫格）」当成页面主体：8 个入口
 *   散落在便签方块与次级按钮里，与 v2 的「宽幅页头 + 两组 menulist」结构完全对不上
 *   （逐块核对：3 块 0 对齐）。本次按 v2 重排，页头成为唯一主角，入口收进两组清单。
 *
 * 【v2 没画、但实现了不能丢的能力 —— 落地位置逐个写在这里】
 *   · 编辑档案      → 第二组清单的「编辑档案」行（`/pagesPet/edit/index`）
 *   · 换头像 / 形象 → 第二组清单的「形象与头像」行（`/pagesPet/avatar-customize/index`）。
 *                     ⚠️ 2026-09-12 收口按 v2 撤掉了页头那枚头像圆钮（v2 页头没画它），
 *                     这个能力**没有丢**，入口就是这一行 —— 别再往回加圆钮。
 *   · 标记离世      → 页尾弱化的一行「标记宠物离世」（原来的两次确认 + 输入宠物名比对照旧）
 *   · 健康指标      → 「健康指标」三格（健康评分 / 连续打卡 / 疫苗覆盖），取数仍走
 *                     getCheckinStats / getLatestCheckin / calcHealthScore / getVaccineRecords
 *   · 品种匹配      → 「品种特征」卡（BREED_LIGHT 匹配遗传病 / 体重区间 / 饮食禁忌）
 *   · 它的小习惯    → getPetFacts() 的「它的小习惯」卡（没有数据时整卡不渲染）
 *   · 基础档案      → 「基础档案」卡（性别 / 生日 / 毛色 / 体重 / 芯片号 / 绝育）
 *   · 登录守卫      → 未登录一律交 utils/authGuard 的 redirectToLoginIfNeeded 收口（照旧）
 *   ⚠️ 这些「v2 之外」的块一律排在两组 menulist **之后**：首屏看到的仍是 v2 的三块结构，
 *      既不丢信息，也不把「今天好不好」再埋回字段堆里。
 *
 * 【2026-09-12 收口：原先三处与 v2 的偏差已全部消掉，别再退回旧写法】
 *   1. 第一组标题右侧补上了 v2 的「全部 ›」，落点 `/pagesPet/trends/index`
 *      （v2 就是这么画的；趋势页除了趋势图还承载健康报告与月报，本组 4 行确实列不下）。
 *   2. 「生日与纪念日」不再是「即将上线」：新增分包页 `pagesPet/anniversary/index`，
 *      页内日期**全部派生**（出生日期 + 建档时间，本仓没有独立的纪念日数据模型），这一行改为真跳转。
 *   3. 本页 8 行**全部**有真实落点，于是把 `PetProfileMenuRow.url` 改成必填，
 *      并删掉「即将上线」胶囊这套机制 —— 没有落点的行以后要用，就连同不可点态一起加回来。
 *
 * 【中文注释约定】本页每个函数 / 副作用都写明「做什么 + 为什么」；改逻辑时请同步改注释。
 */
import { View, Text, ScrollView, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { usePetStore } from '../../stores/petStore'
import { useFamilyStore } from '../../stores/familyStore'
import { daysSinceLocalDate, formatPetAge } from '../../utils/date'
import PageLoading from '../../components/PageLoading'
import PetAvatar from '../../components/PetAvatar'
import { useThemeClass, useThemeKey } from '../../hooks/useThemeClass'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import { getPetFacts, type PetFact } from '../../services/petService'
import { getCheckinStats, getCheckinsByDateRange, getLatestCheckin, calcHealthScore } from '../../services/checkinService'
import { getVaccineRecords } from '../../services/vaccineService'
// 主包体积优化：本页只用品种的 3 项特征（遗传病 / 体重 / 饮食禁忌），
// 引用精简版 breedsLight（45KB）而非全量 breeds（148KB），避免拖爆主包体积
import { BREED_LIGHT } from '../../data/petKnowledge/breedsLight'
// 页头插画的 URL 仍走 data/illustrations.ts 这套服务器 URL 机制（不新增图片资源）。
// 为什么不用 <Illustration>：该组件只支持 aspectFit / aspectFill，而方形插画用 aspectFill 会裁掉
// 猫狗头顶与笔记本、用 aspectFit 又会在左右留出与底色接不上的空条 —— 页头需要 widthFix（按原图比例）。
import { illustrationUrl } from '../../data/illustrations'
import type { ExpressionContext } from '../../types/avatarTypes'
import './index.scss'
import { Icon, EmptyState } from '../../components'
import PageBackground from '../../components/PageBackground'
import type { FillIconName, IconName } from '../../components/Icon'

/**
 * 宠物头像用的表情上下文
 *
 * 本页只需要 PetAvatar 有一个稳定的表情（不做情绪动画），所以给一份全 false 的默认上下文。
 * 抽成模块常量而不是写在 JSX 里：对象字面量每次渲染都是新引用，会让 PetAvatar 内部的 useMemo 失效。
 */
const defaultExpressionContext: ExpressionContext = {
  todayEntry: null,
  hasAnomaly: false,
  anomalyCount: 0,
  riskLevel: null,
  streakDays: 0,
  isBirthday: false,
  isVaccineComplete: false,
  isRecovery: false,
  isDeceased: false,
}

/**
 * 喜好 / 习惯分类 → 面性图标
 *
 * 这五个是功能性图标位（要能随主题换色、字形统一），统一走 Icon 组件而不是 emoji。
 */
const FACT_ICONS: Record<string, FillIconName> = {
  like: 'heart',
  dislike: 'prohibit',
  habit: 'arrows-clockwise',
  personality: 'star',
  general: 'note-pencil',
}

/** 清单行的色系（底色与图标同源，组内一致、组间区分） */
type MenuTone = 'primary' | 'teal' | 'sage' | 'gold-deep'

/**
 * 一组 menulist 里的一行
 *
 * url 是**必填**的：2026-09-12 收口后本页 8 行全部有真实页面（`/pagesPet/anniversary/index`
 * 补齐了最后一处），原来那套「url 可空 → 渲染成不可点的即将上线态」的机制随之删掉。
 * 将来真要加「暂无页面」的行，请连同不可点态与它的样式一起加回来，别让这一行冒充真入口。
 */
interface PetProfileMenuRow {
  /** 行 key（列表渲染用；不用 label 是为了将来改文案不影响 diff） */
  key: string
  icon: IconName
  tone: MenuTone
  label: string
  /** 目标路由（逐条落点见下面两张表的注释） */
  url: string
}

/**
 * 第一组「健康档案」的 4 行
 *
 * 逐条对照 `src/app.config.ts` 的注册表（2026-09-12 核对）：
 *   · 健康趋势与报告 → pagesPet/trends/index（页面名「健康趋势」；IA 第 2b 批已把 health-report 并入本页）
 *   · 疫苗日历       → pagesPet/vaccine/index
 *   · 慢病记录       → pagesPet/chronic-tracking/index（页面名「慢性病追踪」）
 *   · 喂养记录       → pagesPet/feeding-advice/index（2026-09-12 起该页导航标题也统一成「喂养记录」，
 *                      与本行文案一致；数据来自 services/feedingRecordsService）
 */
const HEALTH_MENU: PetProfileMenuRow[] = [
  { key: 'trends', icon: 'chart-line', tone: 'primary', label: '健康趋势与报告', url: '/pagesPet/trends/index' },
  { key: 'vaccine', icon: 'syringe', tone: 'teal', label: '疫苗日历', url: '/pagesPet/vaccine/index' },
  { key: 'chronic', icon: 'pill', tone: 'sage', label: '慢病记录', url: '/pagesPet/chronic-tracking/index' },
  { key: 'feeding', icon: 'bowl-food', tone: 'gold-deep', label: '喂养记录', url: '/pagesPet/feeding-advice/index' },
]

/**
 * 第二组「关于 {宠物名}」的 4 行（标题里的宠物名由页面动态拼）
 *
 * 逐条对照注册表（2026-09-12 收口后）：
 *   · 生日与纪念日     → pagesPet/anniversary/index（新增页面：生日 / 下一岁生日倒计时 / 建档周年，
 *                       全部由 birthDate 与 createdAt 派生，那页没有任何写入口）
 *   · 形象与头像       → pagesPet/avatar-customize/index（换头像 / 换形象 / 上传照片都在这一页）
 *   · 家庭成员与血缘   → pagesPet/family/lineage/index（家族图谱：成员关系 + 血缘）
 *   · 编辑档案         → pagesPet/edit/index（出生日期等全部档案字段都在这里改）
 */
const ABOUT_MENU: PetProfileMenuRow[] = [
  { key: 'birthday', icon: 'calendar-check', tone: 'primary', label: '生日与纪念日', url: '/pagesPet/anniversary/index' },
  { key: 'avatar', icon: 'image', tone: 'teal', label: '形象与头像', url: '/pagesPet/avatar-customize/index' },
  { key: 'family', icon: 'users', tone: 'sage', label: '家庭成员与血缘', url: '/pagesPet/family/lineage/index' },
  { key: 'edit', icon: 'pencil-simple', tone: 'gold-deep', label: '编辑档案', url: '/pagesPet/edit/index' },
]

/** 格式化出生日期 → YYYY-MM-DD */
export function formatDate(value: string): string {
  if (!value) return '未设置'
  const d = new Date(value)
  // Number.isNaN 替代全局 isNaN（eslint no-restricted-globals 要求，避免隐式类型转换误判）
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 年龄文案 —— 统一走 utils/date 的 formatPetAge
 *
 * 原实现按月相减但**不减「日」**（生日 20 号、今天 5 号会多算一个月），且用
 * `new Date('YYYY-MM-DD')`（UTC 解析）；返回格式也与别页不统一（`1岁3月`）。
 * 保留函数名与导出，是因为本页测试与页面内都按 calcAge 引用。
 */
export function calcAge(birthDate: string): string {
  return formatPetAge(birthDate)
}

export default function PetProfile() {
  const user = useAuthStore(state => state.user)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const isInitialized = useAuthStore(state => state.isInitialized)
  const { pets, currentPet, fetchPets, switchPet, markPetDeceased } = usePetStore()
  const [pageReady, setPageReady] = useState(false)
  const [facts, setFacts] = useState<PetFact[]>([])
  const themeClass = useThemeClass()
  // 当前主题 key：只给页头插画拼 URL 用（四季插画随主题换图）
  const themeKey = useThemeKey()
  // 页头插画加载失败标记：失败后不再渲染 <Image>（避免留一块破图），
  // 页头仍有自己的暖色底 + 文字层，不会塌成空白
  const [heroFailed, setHeroFailed] = useState(false)

  // 健康指标真实数据
  const [healthScore, setHealthScore] = useState<number | null>(null)
  const [streakDays, setStreakDays] = useState(0)
  const [vaccineCoverage, setVaccineCoverage] = useState<number | null>(null)
  const [weekTrend, setWeekTrend] = useState('暂无')
  // 多成员共同养宠：家庭成员（人）列表（hook 必须在所有 early return 之前调用）
  const familyUsers = useFamilyStore((s) => s.users)
  // 家庭成员多于 1 人时宠物视为「家庭共养」（展示标识）
  const isCoCared = familyUsers.length > 1

  const pet = currentPet || (pets.length > 0 ? pets[0] : undefined)

  useEffect(() => {
    if (!isInitialized) return
    if (!isAuthenticated || !user) {
      // 未登录统一走收口守卫：已是登录页时不再 reLaunch（避免路由竞态报 routeDone not found）
      redirectToLoginIfNeeded()
      return
    }
    const loadData = async () => {
      try {
        await fetchPets(user.id)
        // 多成员共同养宠：若已加入家庭，加载家庭成员（人）列表用于「共同养宠」标识
        if (useFamilyStore.getState().currentFamily) {
          await useFamilyStore.getState().fetchUsers()
        }
      } catch (err) {
        // 静默处理错误，页面有错误状态展示
      }
      setPageReady(true)
    }
    loadData()
  }, [isInitialized, isAuthenticated, user])

  // 当切换宠物时，加载其特征数据（它的小习惯）
  useEffect(() => {
    if (pet && pageReady) {
      getPetFacts(pet.id).then(setFacts).catch(() => setFacts([]))
    }
  }, [pet?.id, pageReady])

  // 加载健康指标（评分 / 连续打卡 / 疫苗覆盖 / 近 7 天趋势）
  useEffect(() => {
    if (!pet || !user?.id) return
    let cancelled = false

    const loadMetrics = async () => {
      try {
        const stats = await getCheckinStats(pet.id, user.id)
        if (cancelled) return
        setStreakDays(stats.streak)

        const latest = await getLatestCheckin(pet.id, user.id)
        if (cancelled) return
        if (latest) {
          setHealthScore(calcHealthScore(latest.poopLevel, latest.appetiteLevel, latest.spiritLevel))
        } else {
          setHealthScore(null)
        }

        const today = new Date()
        const weekAgo = new Date(today.getTime() - 6 * 86400000)
        const fmt = (d: Date) => d.toISOString().slice(0, 10)
        const weekEntries = await getCheckinsByDateRange(pet.id, user.id, fmt(weekAgo), fmt(today))
        if (cancelled) return
        if (weekEntries.length >= 5) setWeekTrend('稳定')
        else if (weekEntries.length > 0) setWeekTrend('观察')
        else setWeekTrend('暂无')
      } catch {
        if (cancelled) return
        setHealthScore(null)
        setStreakDays(0)
        setWeekTrend('暂无')
      }
    }

    const loadVaccine = async () => {
      try {
        const records = await getVaccineRecords(pet.id)
        if (cancelled || records.length === 0) {
          if (!cancelled) setVaccineCoverage(null)
          return
        }
        const completed = records.filter(r => r.status === 'completed').length
        if (!cancelled) setVaccineCoverage(Math.round((completed / records.length) * 100))
      } catch {
        if (!cancelled) setVaccineCoverage(null)
      }
    }

    loadMetrics()
    loadVaccine()
    return () => {
      cancelled = true
    }
  }, [pet?.id, user?.id])

  // 页头插画 URL：换主题就换一张（四季图），URL 变了要重置失败标记，
  // 否则一次瞬断会让页头永远停在「没有插画」的状态
  const heroUrl = illustrationUrl('page-pet-profile', themeKey)
  useEffect(() => {
    setHeroFailed(false)
  }, [heroUrl])

  const navigateTo = (url: string) => {
    Taro.navigateTo({ url })
  }

  const handleMarkDeceased = () => {
    if (!pet) return
    Taro.showModal({
      title: '标记宠物离世',
      content: `你正在将「${pet.name}」标记为已离世。\n\n宠物的所有回忆、健康记录、日记和照片将被永久保留在「时光」中，你可以随时回顾与它的点点滴滴。\n\n此操作不可撤销，是否继续？`,
      confirmText: '温柔告别',
      confirmColor: '#6B5B7B',
      cancelText: '取消',
      success: (firstRes) => {
        if (firstRes.confirm) {
          Taro.showModal({
            title: '最后的确认',
            content: `请输入「${pet.name}」以确认标记离世：`,
            editable: true as boolean,
            placeholderText: `输入「${pet.name}」确认`,
            confirmText: '确认标记',
            confirmColor: '#6B5B7B',
            cancelText: '取消',
            success: async (secondRes) => {
              if (secondRes.confirm && (secondRes as unknown as Record<string, unknown>).content === pet.name) {
                try {
                  const today = new Date().toISOString().slice(0, 10)
                  await markPetDeceased(pet.id, today)
                  Taro.showToast({ title: `${pet.name}已安息`, icon: 'none' })
                  if (user) await fetchPets(user.id)
                  setPageReady(true)
                } catch {
                  Taro.showToast({ title: '操作失败，请重试', icon: 'none' })
                }
              } else if (secondRes.confirm) {
                Taro.showToast({ title: '输入不正确，操作已取消', icon: 'none' })
              }
            },
          } as Parameters<typeof Taro.showModal>[0])
        }
      },
    })
  }

  // 根据宠物品种匹配品种特征（遗传病 / 体重范围 / 饮食禁忌）
  const breedInfo = useMemo(() => {
    if (!pet?.breed) return null
    const matched = BREED_LIGHT.find(
      b => b.name === pet.breed || b.aliases.includes(pet.breed) || pet.breed.includes(b.name)
    )
    return matched ?? null
  }, [pet?.breed])

  if (!pageReady) {
    return <PageLoading />
  }

  if (pets.length === 0) {
    return (
      <View className={`profile-page ${themeClass}`}>
        {/* 空态用品牌插画（原来是 🐾 emoji + 两行字，太素） */}
        <EmptyState
          illustration='empty-pet'
          title='还没有添加宠物'
          desc='添加你的毛孩子，开始记录健康数据'
          actionText='添加宠物'
          onAction={() => navigateTo('/pagesPet/add/index')}
          className='profile-empty'
        />
      </View>
    )
  }

  const activePet = pet!
  const genderText = activePet.gender === 'male' ? '公' : activePet.gender === 'female' ? '母' : '未记录'
  const ageText = activePet.birthDate ? calcAge(activePet.birthDate) : '年龄未知'
  // 陪伴天数：起算点用**建档时间**（用户把 TA 加进星河宠记那天），口径与 pages/mine 的「养宠时长」一致
  // —— 服务端没有「领养日」字段，用生日算出来的其实是「出生天数」，不能叫陪伴。
  // 取不到（没有 createdAt / 时间非法）时返回 null，此时页头少一段文案，而不是显示「0 天」。
  const companionDays = daysSinceLocalDate(activePet.createdAt)
  // 页头身份行，按 v2 的三段式：品种 · 年龄 · 已陪伴 N 天（缺哪段就少哪段，不留空圆点）
  const heroMeta = [
    activePet.breed || (activePet.species === 'cat' ? '猫' : '狗'),
    ageText,
    companionDays && companionDays > 0 ? `已陪伴 ${companionDays} 天` : '',
  ].filter(Boolean).join(' · ')

  /**
   * 渲染一组 menulist 里的一行
   *
   * @param row - 行定义（url 必填，见 PetProfileMenuRow 的注释）
   * @param isLast - 是否本组最后一行（最后一行去掉底部分隔线）
   * @returns 行 JSX
   */
  const renderMenuRow = (row: PetProfileMenuRow, isLast: boolean) => (
    <View
      key={row.key}
      className={`pf-menu__item ${isLast ? 'pf-menu__item--last' : ''}`}
      onClick={() => navigateTo(row.url)}
    >
      <View className={`pf-menu__icon pf-menu__icon--${row.tone}`}>
        <Icon name={row.icon} size={18} tone={row.tone} />
      </View>
      <Text className='pf-menu__label'>{row.label}</Text>
      {/* 箭头走线形 arrow-right（面性图标表里没有它，Icon 会自动落到线形那一套） */}
      <Icon name='arrow-right' size={15} tone='muted' className='pf-menu__arrow' />
    </View>
  )

  return (
    <ScrollView className={`profile-page ${themeClass}`} scrollY>
      {/* 全屏动态背景光斑层 */}
      <PageBackground />

      {/* ===================== ① 宽幅页头（v2 第 1 块） =====================
          插画按**原始比例**铺满卡片宽度（widthFix）：v2 的四季图里，秋 / 春 / 冬是 1254×1254 方图、
          夏是 1536×1024 宽图，硬铺成同一高度必然裁掉主体，所以高度交给图片自己算。
          文字叠在右侧 46% 的留白上（四季图的猫狗都画在左侧，右侧是干净留白）。 */}
      <View className='pf-hero'>
        {!heroFailed && (
          <Image
            className='pf-hero__art'
            src={heroUrl}
            mode='widthFix'
            onError={() => setHeroFailed(true)}
          />
        )}
        {/* 叠字承托层：v2 原图没有蒙版，实机复核时「浅色插画 + 深棕小字」被视觉复核判为可读性偏弱
            （冬图的雪花纹理尤其花）。这里加一层只覆盖右半张、最淡处仍透出插画的白蒙版；
            色相取自 v2 透明度体系里「文字压图承载层」（--g86）那一档，但浓度远低于 0.86。 */}
        <View className='pf-hero__scrim' />
        <View className='pf-hero__cap'>
          {/* 2026-09-12 收口：按 v2 撤掉了页头那枚头像圆钮（v2 页头只有名字 + 身份行）。
              换头像 / 形象的能力没丢 —— 入口在第二组「形象与头像」行
              （/pagesPet/avatar-customize/index）。 */}
          <Text className='pf-hero__name'>{activePet.name}</Text>
          <Text className='pf-hero__meta'>{heroMeta}</Text>
          {/* 已离世：原来盖一枚旋转图章，这里降级成一枚小徽章 —— 状态照样看得见，不再抢页头主角 */}
          {activePet.isDeceased && (
            <View className='pf-hero__badge'><Text className='pf-hero__badge-text'>已安息</Text></View>
          )}
          {/* 家庭共养标识（多成员家庭才有） */}
          {isCoCared && (
            <View className='pf-hero__badge pf-hero__badge--co'>
              <Icon name='users' size={11} tone='primary' />
              <Text className='pf-hero__badge-text pf-hero__badge-text--co'>家庭共养</Text>
            </View>
          )}
        </View>
      </View>

      {/* ===================== 多宠物切换（v2 没画，多宠时必须保留） =====================
          两只以上才渲染；头像走 PetAvatar（真实照片 > AI 形象 > 品牌小动物头像）。 */}
      {pets.length > 1 && (
        <ScrollView className='pf-switcher' scrollX>
          <View className='pf-switcher__inner'>
            {pets.map(p => (
              <View
                key={p.id}
                className={`pf-switch-chip ${currentPet?.id === p.id ? 'pf-switch-chip--on' : ''}`}
                onClick={() => {
                  // 切换失败给提示：petStore.switchPet 失败会 throw，
                  // 直接丢在 onClick 里既是未处理的 Promise rejection，用户也会觉得「点了没反应」
                  switchPet(p.id).catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : ''
                    Taro.showToast({ title: msg || usePetStore.getState().error || '切换失败，请重试', icon: 'none' })
                  })
                }}
              >
                <PetAvatar
                  species={p.species}
                  petName={p.name}
                  expressionContext={defaultExpressionContext}
                  pet={p}
                  size={28}
                  className='pf-switch-avatar'
                />
                <Text className='pf-switch-name'>{p.name}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {/* ===================== ② 第一组 menulist「健康档案」（v2 第 2 块） ===================== */}
      <View className='pf-sec'>
        <View className='pf-sec__head'>
          <View className='pf-sec__dot' />
          <Text className='pf-sec__title'>健康档案</Text>
          {/* v2 组头右侧的「全部 ›」：落点就是本组第一条的趋势页
              （该页除了趋势图还承载健康报告与月报，本组 4 行确实列不下）。
              「›」写成字面量而不是箭头图标 —— v2 原型就是字面量，pages/mine、pages/creative
              的组头引导字也一律用字面量，图标只在行尾 .pf-menu__arrow 那处用。 */}
          <View
            className='pf-sec__more'
            hoverClass='pf-sec__more--hover'
            onClick={() => navigateTo('/pagesPet/trends/index')}
          >
            <Text className='pf-sec__more-text'>全部 ›</Text>
          </View>
        </View>
        <View className='pf-menu'>
          {HEALTH_MENU.map((row, i) => renderMenuRow(row, i === HEALTH_MENU.length - 1))}
        </View>
      </View>

      {/* ===================== ③ 第二组 menulist「关于 {宠物名}」（v2 第 3 块） =====================
          v2 的标题是「关于可乐」（关于 + 宠物名）；本页支持多宠物，所以名字从当前宠物取。 */}
      <View className='pf-sec'>
        <View className='pf-sec__head'>
          <View className='pf-sec__dot' />
          <Text className='pf-sec__title'>关于{activePet.name}</Text>
        </View>
        <View className='pf-menu'>
          {ABOUT_MENU.map((row, i) => renderMenuRow(row, i === ABOUT_MENU.length - 1))}
        </View>
      </View>

      {/* ===================== 健康指标（v2 没画；getCheckinStats / calcHealthScore / getVaccineRecords 的真实产物） =====================
          数据取不到时给「下一步动作」或「暂无记录」，不显示「--」，也不画 0% 的假进度条。 */}
      <View className='pf-sec'>
        <View className='pf-sec__head'>
          <View className='pf-sec__dot' />
          <Text className='pf-sec__title'>健康指标</Text>
          <Text className='pf-sec__hint'>近 7 天趋势 · {weekTrend}</Text>
        </View>
        <View className='pf-metrics'>
          <View className='pf-metric'>
            <Text className='pf-metric__label'>健康评分</Text>
            {healthScore !== null ? (
              <Text className='pf-metric__value pf-metric__value--primary'>
                {healthScore}<Text className='pf-metric__unit'>分</Text>
              </Text>
            ) : (
              <Text className='pf-metric__empty'>打卡后生成</Text>
            )}
          </View>
          <View className='pf-metric'>
            <Text className='pf-metric__label'>连续打卡</Text>
            <Text className='pf-metric__value pf-metric__value--gold'>
              {streakDays}<Text className='pf-metric__unit'>天</Text>
            </Text>
          </View>
          <View className='pf-metric'>
            <Text className='pf-metric__label'>疫苗覆盖</Text>
            {vaccineCoverage !== null ? (
              <Text className='pf-metric__value pf-metric__value--sage'>
                {vaccineCoverage}<Text className='pf-metric__unit'>%</Text>
              </Text>
            ) : (
              <Text className='pf-metric__empty'>暂无记录</Text>
            )}
          </View>
        </View>
      </View>

      {/* ===================== 基础档案（v2 没画；原来在「宠物身份证」卡里，卡片被 v2 页头取代后挪到这里） =====================
          默认值是「还没填」，所以空值一律降权显示，不假装有数据。 */}
      <View className='pf-sec'>
        <View className='pf-sec__head'>
          <View className='pf-sec__dot' />
          <Text className='pf-sec__title'>基础档案</Text>
          <Text className='pf-sec__hint'>点「编辑档案」可修改</Text>
        </View>
        <View className='pf-fields'>
          <View className='pf-field'>
            <Text className='pf-field__label'>性别</Text>
            <Text className={`pf-field__value ${activePet.gender ? '' : 'pf-field__value--off'}`}>{genderText}</Text>
          </View>
          <View className='pf-field'>
            <Text className='pf-field__label'>生日</Text>
            <Text className={`pf-field__value ${activePet.birthDate ? '' : 'pf-field__value--off'}`}>
              {formatDate(activePet.birthDate)}
            </Text>
          </View>
          <View className='pf-field'>
            <Text className='pf-field__label'>毛色</Text>
            <Text className={`pf-field__value ${activePet.coatColor ? '' : 'pf-field__value--off'}`}>
              {activePet.coatColor || '未记录'}
            </Text>
          </View>
          <View className='pf-field'>
            <Text className='pf-field__label'>体重</Text>
            <Text className={`pf-field__value ${activePet.weight ? '' : 'pf-field__value--off'}`}>
              {activePet.weight ? `${activePet.weight}kg` : '未记录'}
            </Text>
          </View>
          <View className='pf-field'>
            <Text className='pf-field__label'>芯片号</Text>
            <Text className={`pf-field__value ${activePet.microchipId ? '' : 'pf-field__value--off'}`}>
              {activePet.microchipId || '未录入'}
            </Text>
          </View>
          <View className='pf-field'>
            <Text className='pf-field__label'>绝育</Text>
            <Text className='pf-field__value'>{activePet.isNeutered ? '已绝育' : '未绝育'}</Text>
          </View>
        </View>
      </View>

      {/* ===================== 健康备忘（v2 没画；过敏 / 用药 / 慢病三行是养宠人真正会查的东西） ===================== */}
      <View className='pf-sec'>
        <View className='pf-sec__head'>
          <View className='pf-sec__dot' />
          <Text className='pf-sec__title'>健康备忘</Text>
          <Text className='pf-sec__hint'>过敏 / 用药 / 慢病</Text>
        </View>
        <View className='pf-menu'>
          <View className='pf-menu__item pf-menu__item--static'>
            <View className='pf-menu__icon pf-menu__icon--danger'><Icon name='prohibit' size={15} tone='danger' /></View>
            <Text className='pf-menu__label'>过敏史</Text>
            <Text className={`pf-menu__value ${activePet.allergies?.length ? '' : 'pf-menu__value--off'}`}>
              {activePet.allergies?.length ? activePet.allergies.join('、') : '无'}
            </Text>
          </View>
          <View className='pf-menu__item pf-menu__item--static'>
            <View className='pf-menu__icon pf-menu__icon--primary'><Icon name='pill' size={15} tone='primary' /></View>
            <Text className='pf-menu__label'>当前用药</Text>
            <Text className={`pf-menu__value ${activePet.medications?.length ? '' : 'pf-menu__value--off'}`}>
              {activePet.medications?.length ? activePet.medications.join('、') : '无'}
            </Text>
          </View>
          <View className='pf-menu__item pf-menu__item--static pf-menu__item--last'>
            <View className='pf-menu__icon pf-menu__icon--sage'><Icon name='heartbeat' size={15} tone='sage' /></View>
            <Text className='pf-menu__label'>慢性病</Text>
            <Text className={`pf-menu__value ${activePet.chronicConditions?.length ? '' : 'pf-menu__value--off'}`}>
              {activePet.chronicConditions?.length ? activePet.chronicConditions.join('、') : '无'}
            </Text>
          </View>
        </View>
      </View>

      {/* ===================== 品种特征（v2 没画；BREED_LIGHT 的真实匹配结果） ===================== */}
      <View className='pf-sec'>
        <View className='pf-sec__head'>
          <View className='pf-sec__dot' />
          <Text className='pf-sec__title'>品种特征</Text>
          <Text className='pf-sec__hint'>{activePet.breed || '未知品种'}</Text>
        </View>
        <View className='pf-menu'>
          <View className='pf-menu__item pf-menu__item--static'>
            <View className='pf-menu__icon pf-menu__icon--primary'><Icon name='dna' size={15} tone='primary' /></View>
            <Text className='pf-menu__label'>遗传病易感</Text>
            <Text className='pf-menu__value'>{breedInfo?.geneticDiseases?.[0] || activePet.notes || '暂无数据'}</Text>
          </View>
          <View className='pf-menu__item pf-menu__item--static'>
            <View className='pf-menu__icon pf-menu__icon--gold-deep'><Icon name='scales' size={15} tone='gold-deep' /></View>
            <Text className='pf-menu__label'>体重正常范围</Text>
            <Text className='pf-menu__value'>{breedInfo?.weightRangeStr || '暂无数据'}</Text>
          </View>
          <View className='pf-menu__item pf-menu__item--static pf-menu__item--last'>
            <View className='pf-menu__icon pf-menu__icon--sage'><Icon name='bowl-food' size={15} tone='sage' /></View>
            <Text className='pf-menu__label'>饮食禁忌</Text>
            <Text className='pf-menu__value'>{breedInfo?.dietRestrictions?.[0] || '暂无数据'}</Text>
          </View>
        </View>
      </View>

      {/* ===================== 它的小习惯（v2 没画；getPetFacts() 的真实数据，没有时整卡不渲染） ===================== */}
      {facts.length > 0 && (
        <View className='pf-sec'>
          <View className='pf-sec__head'>
            <View className='pf-sec__dot' />
            <Text className='pf-sec__title'>它的小习惯</Text>
            <Text className='pf-sec__hint'>{facts.length} 条</Text>
          </View>
          <View className='pf-facts'>
            {facts.map((fact) => (
              <View key={fact.id} className='pf-fact'>
                <Icon
                  name={FACT_ICONS[fact.category] || 'note-pencil'}
                  size={14}
                  tone={fact.category === 'like' ? 'primary' : fact.category === 'dislike' ? 'muted' : 'gold-deep'}
                />
                <Text className='pf-fact__text'>{fact.fact}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ===================== 危险操作：降权为一行弱提示，避免误触（v2 没画，但这是必须保住的能力） ===================== */}
      <View className='pf-danger' onClick={handleMarkDeceased}>
        <Icon name='warning' size={13} tone='muted' />
        <Text className='pf-danger__text'>标记宠物离世</Text>
      </View>

      <View className='profile-bottom-safe' />
    </ScrollView>
  )
}
