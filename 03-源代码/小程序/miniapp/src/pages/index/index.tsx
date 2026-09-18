/**
 * 今天（首页）· 健康管家看板
 *
 * 【IA 第 4 批重做（2026-09-12）】本页从「AI 对话首页」改成「此刻该做什么」的看板。
 * 依据《信息架构重做方案 v1》：今天页只回答「今天要干嘛」；
 * AI 对话（欢迎语 / 消息流 / 输入框 / 会话抽屉 / 快捷能力）整体搬到 `pagesYuantuan/agent`。
 *
 * 【结构】对齐高保真 v2 第 1 屏，自上而下：
 *   ① 顶栏（品牌位 + 通知/设置）  ② 宠物切换卡  ③ 品牌 Hero
 *   ④ 今日健康摘要（+「健康档案 ›」）  ⑤ 健康打卡 CTA
 *   ⑥ 今天还有这些事（疫苗/驱虫待办）  ⑦ 快捷功能
 *
 * 【数据口径 —— 页面上每个数字都必须可追溯，禁止塞假数据】
 *   · 今日健康摘要 ← services/checkinService.getTodayCheckin（今天的打卡记录）
 *   · 健康分       ← services/checkinService.calcHealthScore（便便/食欲/精神三项折算）
 *   · 体重「较上周」← 打卡记录里「距今 ≥7 天的最近一条有体重记录」；没有就不显示这个差值
 *   · 今天还有这些事 ← services/vaccineService 的逾期记录 + 30 天内到期记录；
 *                      一条都没有时**整块不渲染**（宁可少一块，也不显示空壳提醒）
 */
import { View, Text, ScrollView, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useState } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { usePetStore } from '../../stores/petStore'
import { useAuthStore } from '../../stores/authStore'
import { useFamilyStore } from '../../stores/familyStore'
import {
  getTodayCheckin,
  calcHealthScore,
  getCheckins,
} from '../../services/checkinService'
import {
  getOverdueRecords,
  getUpcomingRecords,
  type VaccineRecord,
} from '../../services/vaccineService'
import type { PetHealthEntry } from '../../memory-body/types/memoryBodyTypes'
import HomeSkeleton from '../../components/HomeSkeleton'
import { Icon, Illustration, PetSwitcher } from '../../components'
import type { PetInfo } from '../../types/chatTypes'
// 品牌 IP（新 IP 油画版，与全站插画同一族）：空态主视觉继续沿用它
// 2026-09-12 由旧毡毛版 logo-catdog-felt.jpg 换成油画版 —— 旧版是早期 IP、与全站插画不同族，已弃用。
import catDogHero from '../../assets/logo-catdog-oil.jpg'
import CheckinPopup from '../../components/CheckinPopup'
import { formatPetAge, daysSinceLocalDate, parseLocalDate, greetingByHour } from '../../utils/date'
import { resolvePetAvatarUrl } from '../../data/homeStyleAvatars'
// 自定义 tabBar 的选中态广播 hook（与本页路由一一对应，写错页面路径 tsc 直接报错）
import { useTabBarSelected } from '../../constants/tabBar'
import PageBackground from '../../components/PageBackground'
import './index.scss'

/** 食欲等级 → 文案（与 pagesPet/checkin 的打卡页共用同一套口径） */
const APPETITE_LABEL: Record<number, string> = { 1: '不吃', 2: '少吃', 3: '正常', 4: '多吃', 5: '亢进', 6: '呕吐' }

/** 精神等级 → 文案（同上） */
const SPIRIT_LABEL: Record<number, string> = { 1: '萎靡', 2: '低落', 3: '正常', 4: '活跃', 5: '亢奋' }

/**
 * 便便等级 → 文案
 * ⚠️ 与 `pagesPet/checkin/index.tsx` 里的 POOP_LABELS 必须一字不差（那边没有导出，
 * 本批次又不许改共用文件，只能镜像一份）。两边若将来要改，必须同时改 ——
 * 否则同一天的数据在首页和打卡页会显示成两个词。
 */
const POOP_LABEL: Record<number, string> = { 1: '带血', 2: '腹泻', 3: '正常', 4: '偏软', 5: '便秘' }

/**
 * 疫苗/驱虫分类 → 中文名
 * ⚠️ 与 `components/VaccineRecordCard` 的 CATEGORY_LABELS 同源（那边未导出，故镜像一份）。
 */
const VACCINE_CATEGORY_LABELS: Record<string, string> = {
  DHPP: 'DHPP（犬四联）',
  FVRCP: 'FVRCP（猫三联）',
  rabies: '狂犬疫苗',
  bordetella: '犬窝咳',
  leptospirosis: '钩端螺旋体',
  lyme: '莱姆病',
  felv: '猫白血病',
  internal_deworm: '体内驱虫',
  external_deworm: '体外驱虫',
}

export interface TodayTodo {
  /** 记录 id（列表 key） */
  id: string
  /** 待办标题（疫苗/驱虫分类的中文名） */
  title: string
  /** 副文案：到期时间 / 上次时间 */
  sub: string
  /** 右上角状态胶囊文案 */
  tag: string
  /** 状态语义：overdue（已逾期，用警示色）/ soon（即将到期，用中性提示色） */
  tone: 'overdue' | 'soon'
}

/**
 * 从真实宠物数据取本页需要的展示字段（不硬编码任何宠物信息）
 * @returns 展示用的宠物信息 + 原始 activePet（给接口调用传 id 用）
 */
function usePetInfo(): PetInfo {
  const pet = usePetStore(s => s.currentPet)
  const pets = usePetStore(s => s.pets)
  const isLoading = usePetStore(s => s.isLoading)
  // currentPet 为空时退回第一只：与全站其它页面（打卡/时光）口径一致
  const activePet = pet ?? pets[0] ?? null
  return {
    name: activePet?.name || '',
    emoji: activePet?.species === 'cat' ? '🐱' : activePet?.species === 'dog' ? '🐕' : '🐾',
    breed: activePet?.breed || '',
    age: activePet?.birthDate ? formatPetAge(activePet.birthDate) : '',
    hasPet: pets.length > 0,
    isLoading,
    activePet,
  }
}

/**
 * 距离某个日期还有几个自然日（今天 = 0，明天 = 1）
 *
 * 为什么不用 `new Date(a) - new Date(b)` 直接算：字符串日期会被按 UTC 解析，
 * 东八区晚上会差一天。这里统一走 utils/date 的本地日历日口径（与 daysSinceLocalDate 同源）。
 * @param dateStr - 目标日期 'YYYY-MM-DD'
 * @returns 天数；日期非法时返回 null（调用方据此不渲染天数）
 */
function daysUntilLocalDate(dateStr: string): number | null {
  const target = parseLocalDate(dateStr)
  const today = parseLocalDate(new Date())
  if (!target || !today) return null
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

/** 格式化日期为「8 月 14 日」 */
function formatMonthDay(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  if (!d) return dateStr
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}
/**
 * 由疫苗/驱虫记录拼出待办列表
 *
 * 为什么放在模块级而不是组件内：纯函数（不依赖任何 props/state），
 * 放组件内会让 `useEffect` 的依赖数组出现"每次渲染都变的函数"，触发 react-hooks 告警。
 * @param overdue - 已逾期记录
 * @param upcoming - 30 天内到期记录
 * @returns 待办列表：逾期在前，两类各取 2 条，最多 4 条
 */
function buildTodos(overdue: VaccineRecord[], upcoming: VaccineRecord[]): TodayTodo[] {
  /**
   * 单条记录 → 待办项
   * @param r - 疫苗/驱虫记录
   * @param tone - overdue=已逾期 / soon=30 天内到期
   * @returns 待办项
   */
  const mapRecord = (r: VaccineRecord, tone: 'overdue' | 'soon'): TodayTodo => {
    // 分类名优先取中文表；表里没有的（后端新增分类）原样显示分类码，避免出现空白标题
    const title = VACCINE_CATEGORY_LABELS[r.category] || r.category
    if (tone === 'overdue') {
      return {
        id: r.id,
        title,
        // 逾期项给出「上次日期」，用户据此判断该不该补
        sub: r.date ? `上次 ${formatMonthDay(r.date)} · 已逾期` : '已逾期，建议尽快补上',
        tag: '该做了',
        tone: 'overdue',
      }
    }
    const days = daysUntilLocalDate(r.nextDate)
    return {
      id: r.id,
      title,
      sub: days === null ? `${formatMonthDay(r.nextDate)} 到期` : `还有 ${days} 天到期`,
      tag: '提前提醒',
      tone: 'soon',
    }
  }

  return [
    ...overdue.slice(0, 2).map(r => mapRecord(r, 'overdue')),
    ...upcoming.slice(0, 2).map(r => mapRecord(r, 'soon')),
  ]
}

/**
 * 今天（首页）看板
 * @returns 页面 JSX
 */
export default function Index() {
  const themeClass = useThemeClass()
  /**
   * 广播「当前选中的是第 1 个 tab」给自定义 tabBar 组件（今天 = 下标 0）。
   *
   * 【为什么必须由页面主动广播】微信给**每个 tab 页各创建一个**自定义 tabBar 实例
   * （官方文档原话：每个 tab 页下的自定义 tabBar 组件实例是不同的），实例建好后就不随
   * `switchTab` 重新挂载，React 也不会因为路由变化自动重渲染它 —— 所以「现在选中第几个」
   * 只能由 tab 页在 `useDidShow` 时推进来。不接这一行，症状就是「点了 tab、页面确实切了，
   * 但底部高亮还停在上一个」。
   *
   * 位置要求：必须放在组件函数体顶层、与其它 hook 同级（hook 内部挂的是 useDidShow，
   * 放进条件分支/循环会让 hook 调用顺序在渲染间漂移）。
   */
  useTabBarSelected('/pages/index/index')

  const petInfo = usePetInfo()
  const user = useAuthStore(s => s.user)
  const pets = usePetStore(s => s.pets)
  const switchPet = usePetStore(s => s.switchPet)
  const activePet = petInfo.activePet

  // ===== 今日健康摘要 =====
  const [todayHealth, setTodayHealth] = useState<PetHealthEntry | null>(null)
  /**
   * 今日摘要**取数失败**标记
   *
   * 【为什么必须有】`todayHealth === null` 同时代表「今天没打卡」和「请求失败了」两种情况。
   * 不区分就会出现：网络抖动时，**已经打过卡的用户看到「今天还没打卡，记一笔吧」** ——
   * 这是会诱导重复打卡的错误提示（本项目历史上就有「同天同宠重复入库」的老问题）。
   * 所以失败要单独记一个标记，让提示文案说实话。
   */
  const [todayHealthFailed, setTodayHealthFailed] = useState(false)
  // 体重「较上周」的差值：null = 没有可比对的上一周记录（此时不渲染这一段，不拿 0 冒充）
  const [weightDelta, setWeightDelta] = useState<number | null>(null)

  // ===== 待办提醒（疫苗/驱虫）=====
  const [todos, setTodos] = useState<TodayTodo[]>([])

  // ===== 宠物切换器 / 打卡弹窗 =====
  const [petSwitcherOpen, setPetSwitcherOpen] = useState(false)
  const [checkinOpen, setCheckinOpen] = useState(false)

  // ===== 宠物卡头像 =====
  // 头像走全站统一口径（真实照片 > AI 形象 > 品种品牌头像），未设过头像的新宠物也显示小动物头像；
  // 仅加载失败时退回物种 emoji
  const homeAvatarUrl = activePet ? resolvePetAvatarUrl(activePet) : ''
  const [homeAvatarFailed, setHomeAvatarFailed] = useState(false)

  // 头像地址变化（切换宠物 / 换了形象 / 失败地址被替换）时重置失败标记，允许新地址重试
  useEffect(() => {
    setHomeAvatarFailed(false)
  }, [homeAvatarUrl])

  /**
   * 加载今日健康打卡数据（健康摘要卡的唯一数据源）
   * 抽成 refreshTodayHealth：打卡弹窗完成后也要手动刷新一次
   * activePet 提升到回调外，依赖对象引用（eslint exhaustive-deps 口径）
   */
  const refreshTodayHealth = useCallback(() => {
    if (!activePet || !user?.id) {
      setTodayHealth(null)
      setTodayHealthFailed(false)
      return
    }
    getTodayCheckin(activePet.id, user.id)
      .then(entry => {
        setTodayHealth(entry)
        setTodayHealthFailed(false)
      })
      .catch(() => {
        // 取数失败：清空数据，但**留下失败标记** —— 否则下面的提示会谎报「今天还没打卡」，
        // 把已经打过卡的用户引去再打一次（详见 todayHealthFailed 的注释）
        setTodayHealth(null)
        setTodayHealthFailed(true)
      })
  }, [activePet, user?.id])

  useEffect(() => {
    refreshTodayHealth()
  }, [refreshTodayHealth])

  /**
   * 加载「体重较上周」差值
   *
   * 口径：在所有打卡记录里找**最近一条有体重**的记录当基准值，再找一条「比它早 ≥7 天、
   * 且也有体重」的记录当参照值，两者相减。找不到参照记录就置 null（前端不渲染这段文案）。
   * 为什么不用平均值/线性回归：这一块的语义是「比上周涨了还是掉了」，用最近两段可比数据
   * 最接近用户直觉，也不会因为补记造成失真。
   */
  useEffect(() => {
    if (!activePet || !user?.id) {
      setWeightDelta(null)
      return
    }
    let cancelled = false
    getCheckins(activePet.id, user.id)
      .then(entries => {
        if (cancelled) return
        // 只保留有体重的记录，并按日期升序（本地日历日，避免时区错位）
        const withWeight = entries
          .filter(e => typeof e.weight === 'number' && e.weight > 0)
          .map(e => ({ weight: e.weight as number, at: parseLocalDate(e.createdAt) }))
          .filter(item => item.at !== null)
          .sort((a, b) => (a.at as Date).getTime() - (b.at as Date).getTime())
        if (withWeight.length < 2) {
          setWeightDelta(null)
          return
        }
        const latest = withWeight[withWeight.length - 1]
        const latestTime = (latest.at as Date).getTime()
        // 从后往前找「至少早 7 天」的那条作为参照（最近的一条可比数据）
        const baseline = [...withWeight]
          .reverse()
          .find(item => latestTime - (item.at as Date).getTime() >= 7 * 86400000)
        if (!baseline) {
          setWeightDelta(null)
          return
        }
        // 保留 1 位小数：体重差值给到 0.1kg 精度就够，多了反而像噪声
        setWeightDelta(Math.round((latest.weight - baseline.weight) * 10) / 10)
      })
      .catch(() => {
        if (!cancelled) setWeightDelta(null)
      })
    // 卸载/切换宠物后不再写入 state，避免"已经换了一只宠物、数字却是上一只的"
    return () => { cancelled = true }
  }, [activePet, user?.id])

  /**
   * 加载「今天还有这些事」待办
   *
   * 数据源：vaccineService 的逾期记录 + 未来 30 天内到期的记录（疫苗与驱虫都在同一张表里，
   * 靠 type 字段区分）。**没有记录就保持空数组，前端整块不渲染** —— 绝不补假条目。
   * 逾期排前面（更紧急），各取最多 2 条，最多显示 4 条，避免这块把首屏顶下去。
   */
  useEffect(() => {
    if (!activePet) {
      setTodos([])
      return
    }
    let cancelled = false
    Promise.all([
      getOverdueRecords(activePet.id),
      getUpcomingRecords(activePet.id, 30),
    ])
      .then(([overdue, upcoming]) => {
        if (cancelled) return
        setTodos(buildTodos(overdue, upcoming))
      })
      .catch(() => {
        if (!cancelled) setTodos([])
      })
    return () => { cancelled = true }
  }, [activePet])


  // ===== 多成员共同养宠：家庭成员（人）列表，用于「邀请 TA 一起养宠」引导 =====
  const familyUsers = useFamilyStore((s) => s.users)
  const [showCoCareTip, setShowCoCareTip] = useState(true)

  // 进入首页若有家庭，加载家庭成员（人）列表（用于"邀请 TA 一起养宠"引导判断）
  useEffect(() => {
    if (useFamilyStore.getState().currentFamily) {
      useFamilyStore.getState().fetchUsers().catch(() => {})
    }
  }, [])

  /** 所有打卡入口统一走这里（健康摘要卡 / 打卡 CTA / 空态） */
  const openCheckin = useCallback(() => setCheckinOpen(true), [])

  /** 打卡完成回调：只需刷新健康摘要 —— 本页已经没有聊天流可追加消息（AI 在团团页） */
  const handleCheckinComplete = useCallback(() => {
    refreshTodayHealth()
  }, [refreshTodayHealth])

  /** 切换当前宠物：交给 store（内部会写 storage），并收起切换器 */
  const handleSwitchPet = useCallback((petId: string) => {
    switchPet(petId).catch(() => {})
    setPetSwitcherOpen(false)
  }, [switchPet])

  // ===== 跳转入口（全部用 navigateTo / switchTab，注意 tab 页只能用 switchTab） =====
  /**
   * 去宠物档案
   * 说明：健康摘要右上角的「健康档案 ›」按第 4 批施工口径也指向这里
   * （IA 把 pet-profile 定为「宠物与健康数据的唯一归处」）。
   */
  const goPetProfile = () => Taro.navigateTo({ url: '/pages/pet-profile/index' })
  /** 去设置页：全站唯一设置页（原 profile 页已并入） */
  const goSettings = () => Taro.navigateTo({ url: '/pagesUser/settings/index' })
  /**
   * 顶栏通知铃铛
   * ⚠️ 全站暂时**没有**消息中心页；这里落到唯一真实的「提醒」归处 —— 疫苗/驱虫日历。
   * 等有消息中心后再改指向（改动前请先确认新页面已注册）。
   */
  const goNotice = () => Taro.navigateTo({ url: '/pagesPet/vaccine/index' })
  /** 健康趋势（原「健康报告」入口本就指向 trends） */
  const goTrends = () => Taro.navigateTo({ url: '/pagesPet/trends/index' })
  /** 时光线是 tab 页：只能 switchTab，用 navigateTo 会静默失败 */
  const goTimeline = () => Taro.switchTab({ url: '/pages/timeline/index' })
  /** 回忆录馆（创作板块） */
  const goMemoir = () => Taro.navigateTo({ url: '/pagesMemoir/memoir-center/index' })

  // ===== 派生展示值 =====
  /** 宠物副信息：品种 · 年龄 · 已陪伴 N 天（取不到的字段直接跳过，不留「 · 」空档） */
  const petMeta = [
    petInfo.breed,
    petInfo.age,
    (() => {
      const days = activePet ? daysSinceLocalDate(activePet.createdAt) : null
      return days === null ? '' : `已陪伴 ${days} 天`
    })(),
  ].filter(Boolean).join(' · ')

  /**
   * 顶栏问候语：时段问候 + 用户名（取不到昵称就只留问候，不出现「早上好，」这种半截话）
   *
   * 为什么顶栏放问候语而不是品牌名：微信原生导航栏的标题已经是「星河宠记」，
   * 顶栏再写一遍就是同一屏两次同样的字（用户隔着截图都能看出来）。
   * 时段分档只有一处实现，见 `utils/date.ts` 的 `greetingByHour`。
   */
  const greetingText = (() => {
    const hello = greetingByHour()
    const name = (user && user.nickname) ? String(user.nickname).trim() : ''
    return name ? `${hello}，${name}` : hello
  })()

  /** 健康分：只有今天打过卡才有分（用真实三项折算，不编造） */
  const healthScore = todayHealth
    ? calcHealthScore(todayHealth.poopLevel, todayHealth.appetiteLevel, todayHealth.spiritLevel)
    : null

  /**
   * 健康分光环的底色（conic-gradient 画进度环）
   * 无分数时画 0%（只剩轨道色），配合中心的「--」表示"今天还没打卡"。
   * 颜色走带通道的主题变量（`--primary-rgb`），切主题会跟着变。
   */
  const ringBackground = `conic-gradient(from -90deg, rgba(var(--primary-rgb, 255, 107, 61), 1) 0% ${healthScore ?? 0}%, rgba(var(--primary-rgb, 255, 107, 61), 0.14) ${healthScore ?? 0}% 100%)`

  return (
    <View className={`today-page ${themeClass}`}>

      {/* 全屏动态背景光斑层（全站统一，切主题一起变） */}
      <PageBackground />

      {petInfo.isLoading && !petInfo.hasPet ? (
        /* 加载中：骨架屏 */
        <HomeSkeleton />
      ) : !petInfo.hasPet ? (
        /* 空状态：引导添加宠物（与团团页同一套空态主视觉与文案） */
        <View className='chat-empty'>
          <View className='chat-empty-mascot'>
            <View className='chat-empty-mascot__halo' />
            <View className='chat-empty-mascot__ring' />
            <Image className='chat-empty-mascot__img' src={catDogHero} mode='aspectFit' />
          </View>

          <View className='chat-empty-slogan'>
            <Icon name='sparkle' size={16} tone='primary' className='chat-empty-slogan__star' />
            <Text className='chat-empty-slogan__text'>
              它的可爱 要一颗一颗收进<Text className='chat-empty-slogan__accent'>星河</Text>里
            </Text>
            <Icon name='sparkle' size={16} tone='primary' className='chat-empty-slogan__star' />
          </View>

          <Text className='chat-empty-title'>欢迎来到星河宠记</Text>
          <Text className='chat-empty-desc'>添加你的第一位宠物伙伴，{'\n'}开始记录温馨的每一天</Text>

          <View className='chat-empty-btn' onClick={() => Taro.navigateTo({ url: '/pagesPet/add/index' })}>
            <Icon name='plus' size={16} tone='white' />
            <Text className='chat-empty-btn-text'>添加宠物</Text>
          </View>
        </View>
      ) : (
        <>
          {/* ===== ① 顶栏：**时段问候** + 通知/设置 =====
              【为什么不再写品牌名】原顶栏是「星河宠记 / 懂 TA 的一生」，而微信原生导航栏
              的标题本来就是「星河宠记」→ **同一屏出现两次同样的四个字**（用户隔着截图都能看出来），
              同时违反"一个页面只应有一个页头"这条设计原则。
              品牌名归原生导航栏；这行改成与人有关的问候语（时段问候 + 用户昵称），
              通知/设置两个**有真落点**的按钮照旧保留 —— 这一行因此从"重复的品牌条"变成有用的一行。 */}
          <View className='today-topbar'>
            <View className='today-topbar__greet'>
              <Text className='today-topbar__hello'>{greetingText}</Text>
            </View>
            <View className='today-topbar__actions'>
              <View className='today-icon-btn' hoverClass='today-icon-btn--hover' onClick={goNotice}>
                <Icon name='bell' size={17} tone='muted' />
              </View>
              <View className='today-icon-btn' hoverClass='today-icon-btn--hover' onClick={goSettings}>
                <Icon name='gear' size={17} tone='muted' />
              </View>
            </View>
          </View>

          <ScrollView className='today-scroll' scrollY>
            <View className='today-scroll__inner'>

              {/* ===== ② 「{宠物名} 的今天」：插画 + 压在画上的身份条（一张卡，不是两张） =====
                  【为什么把原来的「宠物卡」和「品牌 Hero」合成一张】原来它们上下叠着：
                  一张只写宠物名的白卡 + 一整块方插画配一句口号 —— 用户评价"布局僵硬、看起来像广告"
                  （方图 + 大标题 + 没有可操作的东西 = 广告位的观感）。
                  合成一张后：插画成为这张卡的**背景**，宠物头像/名字/年龄压在它下沿，
                  卡本身可点（展开宠物切换器）→ 图有了归属、也不再像广告位。
                  【为什么口号那行删掉】「把它的可爱，一颗一颗收进星河里」在**新手引导页**已经有了
                  （那句话是引导语的职责）；今天页是"此刻该做什么"的看板，同一句口号出现在两个地方
                  只会让人觉得这块是宣传位。 */}
              <View
                className='today-hero'
                hoverClass='today-hero--hover'
                onClick={() => setPetSwitcherOpen(v => !v)}
              >
                {/* 插画铺满整张卡：`aspectFill` 而不是 `aspectFit`
                    【为什么】容器已改成「按宽度撑出的 1:1 比例盒」（详见 index.scss 的 `.today-hero` 注释），
                    而本槽位资产 `today-brand-*`（五季版本）2026-09-12 逐张实测均为 **1254×1254（1:1）**，
                    框与图等比例 → `aspectFill` = 铺满且**零裁切**；改用 `aspectFit` 则会在框与图
                    有任何微小差异（卡片 1rpx 边框让内区是 684×686）时**重新漏出白带** ——
                    用户这次投诉的正是白带（"这个图片要放满整个控件"），所以这里不能再用会留白的 mode。
                    ⚠️ 若将来把该槽位换成非 1:1 的素材，必须改成"按原比例取景"的写法
                    （容器 padding-top 跟着资产比例走，或改用 mode='heightFix'/'widthFix'），
                    **不能**继续用「1:1 比例盒 + aspectFill」，否则会按最大边裁切、把主体切掉。 */}
                <Illustration name='page-home' fill mode='aspectFill' className='today-hero__art' />

                {/* 身份条：压在插画下沿。类名沿用 `today-petcard*`（原来那张独立白卡的类名），
                    这样既省得全站重命名，也保住既有单测对这几个选择器的断言 */}
                <View className='today-petcard'>
                  <View className='today-petcard__avatar'>
                    {homeAvatarUrl && !homeAvatarFailed ? (
                      <Image
                        className='today-petcard__avatar-img'
                        src={homeAvatarUrl}
                        mode='aspectFill'
                        lazyLoad
                        onError={() => setHomeAvatarFailed(true)}
                      />
                    ) : (
                      <Text className='today-petcard__avatar-emoji'>{petInfo.emoji || '🐾'}</Text>
                    )}
                  </View>
                  <View className='today-petcard__info'>
                    <Text className='today-petcard__name'>{petInfo.name || '我的毛孩子'}</Text>
                    {petMeta ? <Text className='today-petcard__meta'>{petMeta}</Text> : null}
                  </View>
                  {/* 下拉箭头：展开/收起切换器（展开时旋转 180°，让状态可见）。
                      tone 用 white 而不是 muted：它压在插画的深色遮罩上，muted 的灰在这层底色上看不清 */}
                  <Icon
                    name='caret-down'
                    size={16}
                    tone='white'
                    className={`today-petcard__chev ${petSwitcherOpen ? 'today-petcard__chev--open' : ''}`}
                  />
                </View>
              </View>

              {/* 切换器：复用既有 components/PetSwitcher（横向滚动 + 头像口径与档案页一致），不另造轮子 */}
              {petSwitcherOpen && (
                <View className='today-petswitch'>
                  <PetSwitcher
                    pets={pets}
                    currentPetId={activePet?.id ?? null}
                    onSwitch={handleSwitchPet}
                    onAdd={() => Taro.navigateTo({ url: '/pagesPet/add/index' })}
                  />
                </View>
              )}

              {/* 多成员共同养宠的「邀请 TA 一起养宠」横幅**不在首屏**：
                  它原先紧跟在宠物卡下面，把 v2 首屏的「今日健康摘要」整块挤出第一屏
                  （v2 `screenToday` 的首屏顺序是 宠物卡 → 品牌 Hero → 今日健康摘要 → 打卡 CTA）。
                  移到打卡 CTA 之后：功能一个没少，首屏组成恢复 v2。
                  2026-09-12 起宠物卡与品牌 Hero 已合成上面那一张卡，首屏因此更短。 */}

              {/* ③ 品牌 Hero 已并入上面的「{宠物名} 的今天」卡（插画 + 身份条合成一张）——
                  原来独立的 Hero 卡与它的口号文案块在此处删除，不要再恢复。 */}

              {/* ===== ④ 今日健康摘要（IA：健康数据的唯一归处是宠物档案，右上角直达） ===== */}
              <View className='today-sec'>
                <View className='today-sec__head'>
                  <View className='today-sec__dot' />
                  <Text className='today-sec__title'>今日健康摘要</Text>
                  <View className='today-sec__more' onClick={goPetProfile} hoverClass='today-sec__more--hover'>
                    <Text className='today-sec__more-text'>健康档案</Text>
                    <Icon name='caret-right' size={12} tone='muted' />
                  </View>
                </View>

                <View className='today-health' hoverClass='today-health--hover' onClick={goPetProfile}>
                  {/* 健康分光环：数值 + 环（0 分时环只剩轨道色） */}
                  <View className='today-health__ring' style={{ background: ringBackground }}>
                    <View className='today-health__ring-inner'>
                      <Text className='today-health__score'>{healthScore === null ? '--' : healthScore}</Text>
                    </View>
                  </View>

                  <View className='today-health__list'>
                    <View className='today-health__row'>
                      <Text className='today-health__label'>便便</Text>
                      <Text className='today-health__val'>{todayHealth ? `${todayHealth.poopLevel}/5 次` : '--'}</Text>
                      {todayHealth && (
                        <Text className='today-health__tag'>{POOP_LABEL[todayHealth.poopLevel] ?? ''}</Text>
                      )}
                    </View>
                    <View className='today-health__row'>
                      <Text className='today-health__label'>食欲</Text>
                      <Text className='today-health__val'>{todayHealth ? (APPETITE_LABEL[todayHealth.appetiteLevel] ?? '--') : '--'}</Text>
                      <Text className='today-health__sep'>·</Text>
                      <Text className='today-health__label'>精神</Text>
                      <Text className='today-health__val'>{todayHealth ? (SPIRIT_LABEL[todayHealth.spiritLevel] ?? '--') : '--'}</Text>
                    </View>
                    <View className='today-health__row'>
                      <Text className='today-health__label'>体重</Text>
                      <Text className='today-health__val'>
                        {todayHealth && typeof todayHealth.weight === 'number' && todayHealth.weight > 0
                          ? `${todayHealth.weight} kg`
                          : '--'}
                      </Text>
                      {/* 「较上周」只在真的有两段可比数据**且本次真的显示了体重值**时才渲染。
                          ⚠️ 必须带上 todayHealth 有体重的条件：差值来自 getCheckins（历史记录），
                          而体重值来自 getTodayCheckin（今日打卡）—— 今天没打卡但历史上有两段 ≥7 天的
                          体重记录时，只判 weightDelta 会渲染出「体重 -- 较上周 +1」这种自相矛盾的行
                          （独立审查实测复现：PROBE 体重行 = "体重--较上周+1"）。 */}
                      {weightDelta !== null && todayHealth && typeof todayHealth.weight === 'number' && todayHealth.weight > 0 && (
                        <>
                          <Text className='today-health__sep'>较上周</Text>
                          <Text className={`today-health__delta ${weightDelta > 0 ? 'today-health__delta--up' : ''}`}>
                            {weightDelta > 0 ? `+${weightDelta}` : `${weightDelta}`}
                          </Text>
                        </>
                      )}
                    </View>
                  </View>
                </View>

                {/* 今天还没打卡时给一句引导（指向下面的打卡 CTA，不伪造数据）；
                    取数失败时换一句话 —— 不能把"请求失败"说成"今天还没打卡" */}
                {!todayHealth && !todayHealthFailed && (
                  <Text className='today-health__hint'>今天还没打卡，用下面的「健康打卡」记一笔吧</Text>
                )}
                {!todayHealth && todayHealthFailed && (
                  <Text className='today-health__hint'>今日摘要暂时取不到，稍后重试（下面仍可打卡）</Text>
                )}
              </View>

              {/* ===== ⑤ 健康打卡：IA 定的全站唯一入口（原「快速打卡弹窗」与打卡页并成这一条） ===== */}
              <View className='today-cta' hoverClass='today-cta--hover' onClick={openCheckin}>
                <View className='today-cta__icon'>
                  <Icon name='paw-print' size={20} tone='white' />
                </View>
                <View className='today-cta__texts'>
                  <Text className='today-cta__title'>健康打卡</Text>
                  {/* ⚠️ 副文案必须与 `components/CheckinPopup/index.tsx` 的**实际步骤**一致
                      （独立审查查出过一版写「食欲·便便·精神·呕吐，四步搞定」：既写了流程里根本没有的
                      「呕吐」（该文件注释明写 5=呕吐 本流程不涉及），又漏了小便与体重、步数也错。
                      当前流程 5 步：大便情况 → 小便情况 → 食欲状况 → 精神 → 体重）
                      ⚠️ 分隔符**不写空格**：写成「 · 」时整行 27 个字宽、在「去打卡」按钮旁只剩约 500rpx，
                      会折行且把末尾「搞定」两个字单独留在一行（验收取图实测）。去掉 4 个分隔符的 8 个空格
                      后是 19 个字宽，稳稳一行。改文案时请一并复算这个宽度。 */}
                  <Text className='today-cta__sub'>便便·小便·食欲·精神·体重，五步搞定</Text>
                </View>
                <View className='today-cta__go'>
                  <Text className='today-cta__go-text'>去打卡</Text>
                </View>
              </View>

              {/* ===== 共同养宠引导横幅：有宠物但家庭只有自己时，提示邀请 TA =====
                   位置刻意放在打卡 CTA **之后**：它原先紧贴宠物卡，把 v2 首屏的「今日健康摘要」
                   整块挤出第一屏。v2 `screenToday()` 的首屏顺序是
                   宠物卡 → 品牌 Hero → 今日健康摘要 → 打卡 CTA，这里把横幅排在它们之后即恢复该组成，
                   功能一点没少（关闭态仍然只在本次会话内记住，不写 storage）。 */}
              {showCoCareTip && familyUsers.length <= 1 && (
                <View className='home-co-care-tip' onClick={() => Taro.navigateTo({ url: '/pages/family/index' })}>
                  <Icon name='users' size={15} tone='primary' className='home-co-care-tip__icon' />
                  <Text className='home-co-care-tip__text'>邀请 TA 一起养宠，共同记录毛孩子的每一天</Text>
                  <Text className='home-co-care-tip__close' onClick={(e) => { e.stopPropagation(); setShowCoCareTip(false) }}>✕</Text>
                </View>
              )}

              {/* ===== ⑥ 今天还有这些事：数据全部来自疫苗/驱虫记录，没有记录时整块不渲染 ===== */}
              {todos.length > 0 && (
                <View className='today-sec'>
                  <View className='today-sec__head'>
                    <View className='today-sec__dot' />
                    <Text className='today-sec__title'>今天还有这些事</Text>
                  </View>

                  {todos.map(todo => (
                    <View
                      key={todo.id}
                      className='today-todo'
                      hoverClass='today-todo--hover'
                      onClick={goNotice}
                    >
                      <View className={`today-todo__icon ${todo.tone === 'overdue' ? 'today-todo__icon--overdue' : ''}`}>
                        <Icon
                          name={todo.tone === 'overdue' ? 'pill' : 'syringe'}
                          size={18}
                          tone={todo.tone === 'overdue' ? 'gold-deep' : 'primary'}
                        />
                      </View>
                      <View className='today-todo__info'>
                        <Text className='today-todo__title'>{todo.title}</Text>
                        <Text className='today-todo__sub'>{todo.sub}</Text>
                      </View>
                      <Text className={`today-todo__tag ${todo.tone === 'overdue' ? 'today-todo__tag--overdue' : ''}`}>
                        {todo.tag}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* ===== ⑦ 快捷功能：只留**非 AI** 的日常动作（AI 能力全在团团页） ===== */}
              <View className='today-sec'>
                <View className='today-sec__head'>
                  <View className='today-sec__dot' />
                  <Text className='today-sec__title'>快捷功能</Text>
                  <Text className='today-sec__note'>AI 的都收进团团了</Text>
                </View>

                {/* 两列宫格（高保真原型 v2 的 .grid）：图标底走原型的 tone-a/b/c/d 四色，
                    **底与图标必须成对**（底 rgba(var(--x-rgb),α) + 图标同色系 tone），否则切换
                    主题后会出现「底变色、图标不变」的违和 —— 见 index.scss 第 ⑦ 节注释。
                    四色的分配沿用各格原有的图标 tone，故顺序是 a→d→b→c，与原型不同。 */}
                <View className='today-grid'>
                  <View className='today-grid__item' hoverClass='today-grid__item--hover' onClick={goTrends}>
                    <View className='today-grid__icon'>
                      <Icon name='chart-line' size={20} tone='primary' />
                    </View>
                    <View className='today-grid__texts'>
                      <Text className='today-grid__title'>健康趋势</Text>
                      <Text className='today-grid__desc'>趋势 / 报告 / 疫苗</Text>
                    </View>
                  </View>

                  <View className='today-grid__item' hoverClass='today-grid__item--hover' onClick={goPetProfile}>
                    <View className='today-grid__icon today-grid__icon--gold'>
                      <Icon name='clipboard-text' size={20} tone='gold-deep' />
                    </View>
                    <View className='today-grid__texts'>
                      <Text className='today-grid__title'>宠物档案</Text>
                      <Text className='today-grid__desc'>生日 / 血缘 / 形象</Text>
                    </View>
                  </View>

                  <View className='today-grid__item' hoverClass='today-grid__item--hover' onClick={goTimeline}>
                    <View className='today-grid__icon today-grid__icon--sage'>
                      <Icon name='clock' size={20} tone='sage' />
                    </View>
                    <View className='today-grid__texts'>
                      <Text className='today-grid__title'>时光</Text>
                      <Text className='today-grid__desc'>翻翻过去的记录</Text>
                    </View>
                  </View>

                  <View className='today-grid__item' hoverClass='today-grid__item--hover' onClick={goMemoir}>
                    <View className='today-grid__icon today-grid__icon--teal'>
                      <Icon name='film-strip' size={20} tone='teal' />
                    </View>
                    <View className='today-grid__texts'>
                      <Text className='today-grid__title'>做回忆录</Text>
                      <Text className='today-grid__desc'>一张照片一支片</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* 底部让位由 .today-scroll__inner 的 padding-bottom 承担（见 scss 注释） */}
            </View>
          </ScrollView>
        </>
      )}

      {/* 健康打卡弹窗卡片：全流程在卡内完成；完成后只刷新健康摘要 */}
      <CheckinPopup
        open={checkinOpen}
        onClose={() => setCheckinOpen(false)}
        onComplete={handleCheckinComplete}
      />
    </View>
  )
}
