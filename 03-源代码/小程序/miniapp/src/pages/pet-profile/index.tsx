/**
 * 宠物档案页面（视觉方向 C · 温暖手账）
 *
 * 【本次改版要解决的问题】旧版从上到下是六段等权重白卡（形象卡 / 2×2 健康指标 /
 * 档案详情 7 行 / 品种特征 3 行 / 喜好 / 两组宽按钮），页面像一张纵向排版的表单：
 *  ① 没有主角——宠物形象只占一个 96rpx 的小圆，视觉重量还比不过「编辑档案」大按钮；
 *  ② 信息用 label–value 表格表达，养宠人真正关心的"今天好不好"被埋在字段堆里；
 *  ③ 线性图标与功能性 emoji 同级混排（📷/🪪/🛡️ 与 Icon 组件并存），精致度被拉低；
 *  ④ 无数据时四个格子里两个是「--」，整页像坏了；
 *  ⑤ 编辑按钮全宽、把上下两段功能入口切成两块，节奏被割断。
 *
 * 【方向 C 的主张】这个产品的内核是"给毛孩子留一本回忆录"，所以宠物页应该像一本手账，
 * 而不是一张后台表单。手段全部是可被 WXSS 实现的纯 CSS：
 *  · 纸感底 + 大圆角 + 虚线便签（不用位图素材，不依赖网络）
 *  · 「宠物身份证」：双层描边 + 拍立得照片（白边/胶带/微旋转）+ 编号 + 旋转图章
 *  · 贴纸式数据（三张微旋转、带胶带），空数据仍给下一步动作而不是「--」
 *  · 衬线（宋体族）标题 + 等宽字距编号，制造"纸与墨"的调性
 *
 * 【各小模块都单独做过打磨】页头 / 身份证 / 拍立得 / 图章 / 贴纸数据 / 切换标签 /
 * 备忘便签 / 品种便签 / 喜好便签格 / 功能便签方块 / 次级按钮 / 危险操作——
 * 每个模块有自己的边界、留白与"手感"，不是把同一张白卡复制十一遍。
 *
 * 业务逻辑（登录守卫、健康指标、品种匹配、标记离世、空态、换头像）与方向 A 版本一致，全部保留。
 */
import { View, Text, ScrollView, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { usePetStore } from '../../stores/petStore'
import { useFamilyStore } from '../../stores/familyStore'
import { formatPetAge } from '../../utils/date'
import PageLoading from '../../components/PageLoading'
import PetAvatar from '../../components/PetAvatar'
import { useThemeClass } from '../../hooks/useThemeClass'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import { getPetFacts, type PetFact } from '../../services/petService'
import { getCheckinStats, getCheckinsByDateRange, getLatestCheckin, calcHealthScore } from '../../services/checkinService'
import { getVaccineRecords } from '../../services/vaccineService'
// 主包体积优化：pet-profile 是主包 tab 页，只用品种的 3 项特征（遗传病/体重/饮食禁忌），
// 引用精简版 breedsLight（45KB）而非全量 breeds（148KB），避免拖爆主包体积
import { BREED_LIGHT } from '../../data/petKnowledge/breedsLight'
// 全站统一头像解析口径：真实照片 > AI 形象 > 品牌小动物头像（拍立得只在有"自己的形象"时才覆盖插画）
import { resolvePetAvatarUrl } from '../../data/homeStyleAvatars'
import type { ExpressionContext } from '../../types/avatarTypes'
import './index.scss'
import { Icon, EmptyState, Illustration } from '../../components'
import PageBackground from '../../components/PageBackground'
import type { FillIconName } from '../../components/Icon'

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
 * 喜好/习惯分类 → 面性图标
 *
 * 旧版这里是 emoji（❤️/💔/🔄/🌟/📝）。按项目既定的 emojiIconMap 口径，
 * 这五个属"功能性"图标位（要能随主题换色、字形统一），统一改成 Icon 组件。
 */
const FACT_ICONS: Record<string, FillIconName> = {
  like: 'heart',
  dislike: 'prohibit',
  habit: 'arrows-clockwise',
  personality: 'star',
  general: 'note-pencil',
}

/**
 * 判断头像地址是不是"品牌头像"（服务器预置的 20 张 home-style 头像，或形象定制页的本地预设）
 *
 * 【现在的用途】**只作为来源标记**，供需要区分"品牌小图 / 用户自己的照片或生成图"的地方使用。
 * **不再**用它决定"要不要把这张图当封面" —— 2026-09-11 用户实测反馈：
 * 用户在形象定制里选的预设形象，小头像位/宠物列表/家庭页都显示它，只有档案页封面被这条判据
 * 顶成一张通用插画，用户原话"我宠物是有头像的，这个不是头像，而是不知道哪来的图"。
 * 256px 小图放大的画质问题，改由封面等比缩放（aspectFit）+ 同图模糊环境层解决。
 *
 * 【判据必须与服务端对齐】服务端 familyPhotoService.isBrandPresetUrl 用的是**路径段**匹配
 * （`/home-style/` 或 `/preset-home/`），刻意不绑定 `/uploads/avatars` 前缀——否则品牌头像
 * 哪天改走 CDN 或换目录，前端就认不出来。
 * 注意两边是两份实现（服务端在 server/src/services/familyPhotoService.ts），
 * 改动任何一边都要同步另一边；这里不做共享导出是为了不把服务端代码引进主包。
 * 两边语义不同：服务端用它筛"全家福参考图"（品牌预设不能当参考），前端只用它做来源标记。
 *
 * @param url - 头像地址（可能是相对路径）
 * @returns true 表示这是品牌预设头像（不是用户自己的照片/生成图）
 */
export function isBrandAvatarUrl(url: string): boolean {
  return url.includes('/home-style/') || url.includes('/preset-home/')
}

/**
 * 封面图地址解析（本页专用 helper，便于单测直接断言）
 *
 * 口径 = 全站统一的 resolvePetAvatarUrl：真实照片 > AI/生成形象 > 品牌小动物头像。
 * 这里不再单独判"是不是品牌头像"，所以这个 helper 与 resolvePetAvatarUrl 结果恒等；
 * 保留它是为了给页面一个可被单测锁定的语义入口（真实逻辑见下方 resolveCoverImage）。
 *
 * @param pet - 宠物档案（species/breed/breedId + 两个头像字段）
 * @returns 可直接用于 <Image> 的绝对 URL（永远非空）
 */
export function resolveCoverImageUrl(pet: {
  species: 'dog' | 'cat'
  breed: string
  breedId: string
  avatarPhotoUrl?: string | null
  avatarCartoonUrl?: string | null
}): string {
  return resolvePetAvatarUrl(pet)
}

/**
 * 封面用「宠物自己的形象」还是退回「品牌插画」——本页唯一判定入口
 *
 * 【为什么以前是"退回插画"】2026-09-11 之前的规则刻意把品牌头像（home-style / 预设形象）
 * 排除在封面之外：那是 256×256 的小图，早期拉满 375px 宽的封面会糊。
 *
 * 【为什么现在改掉（2026-09-11 用户实测反馈）】用户在「形象定制」里选了预设形象
 * （落库形如 /uploads/avatars/home-style/cat/cat-04-calico.png），小头像位、
 * 宠物列表、家庭页全都显示它 —— 只有本页封面不认，硬退回一张通用插画。
 * 用户的原话是"我宠物是有头像的，这个不是头像，而是不知道哪来的图"：
 * 一张"用户自己选的、但被系统判定为不合格"的图，比一张稍糊的真图糟糕得多。
 * 品质问题改由展示方式解决（相纸内改 aspectFit 等比缩放 + 相纸底色渐变托底，
 * 见 index.scss 的 .pf-polaroid-frame / .pf-polaroid-img），而不是靠不显示。
 *
 * 【兜底仍然保留】连品牌头像都没有时（理论上不会发生，品牌头像由品种兜底）才回空串，
 * 这时（以及图片加载失败时）由 <Illustration name='page-pet-profile'> 顶上。
 *
 * 【为什么把 coverFailed 作为入参，而不是在 jsx 里再写一个条件】封面有三个状态：
 * 没图 / 有图 / 图加载失败。三态必须在同一个函数里判定并返回，否则判定入口会分裂成两个
 * —— 首版就是把失败态留在 jsx（`show && !coverFailed`）导致"图片加载失败后既不显示图片、
 * 也不显示插画，照片位剩一块空相纸"，被独立审查（P1）当场抓到。
 *
 * @param coverImageUrl - resolveCoverImageUrl 的结果（空串表示没有任何自有形象）
 * @param coverFailed - 图片 onError 置位：失败时同样退回插画，照片位不允许出现破图或空位
 * @returns show=是否渲染 <Image>；showIllustration=是否显示品牌插画
 */
export function resolveCoverImage(coverImageUrl: string, coverFailed = false): {
  show: boolean
  showIllustration: boolean
} {
  const show = !!coverImageUrl && !coverFailed
  return {
    show,
    // 没有任何形象，或形象加载失败 → 都退回品牌插画（与 PetAvatar 的"头像位永不为空"同口径）
    showIllustration: !show,
  }
}

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
 * 年龄文案 —— 统一走 utils/date 的 formatPetAge（2026-09-11 收敛）
 *
 * 原实现按月相减但**不减「日」**（生日 20 号、今天 5 号会多算一个月），
 * 且用 `new Date('YYYY-MM-DD')`（UTC 解析）；返回格式也与别页不统一（`1岁3月`）。
 * 保留函数名与导出，是因为本页测试与页面内都按 calcAge 引用。
 */
export function calcAge(birthDate: string): string {
  return formatPetAge(birthDate)
}

/** 根据最近打卡计算健康评分（0-100）——已收敛到 checkinService.calcHealthScore（正常档高分，历史 64 分 bug 修复） */

export default function PetProfile() {
  const user = useAuthStore(state => state.user)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const isInitialized = useAuthStore(state => state.isInitialized)
  const { pets, currentPet, fetchPets, switchPet, markPetDeceased } = usePetStore()
  const [pageReady, setPageReady] = useState(false)
  const [facts, setFacts] = useState<PetFact[]>([])
  const themeClass = useThemeClass()
  // 封面图加载失败标记：失败后退回品牌插画，避免封面出现一块破图
  const [coverFailed, setCoverFailed] = useState(false)

  // 健康指标真实数据
  const [healthScore, setHealthScore] = useState<number | null>(null)
  const [streakDays, setStreakDays] = useState(0)
  const [vaccineCoverage, setVaccineCoverage] = useState<number | null>(null)
  const [weekTrend, setWeekTrend] = useState('暂无')
  // 多成员共同养宠：家庭成员（人）列表（hook 必须在所有 early return 之前调用）
  const familyUsers = useFamilyStore((s) => s.users)
  // 家庭成员多于 1 人时宠物视为"家庭共养"（展示标识）
  const isCoCared = familyUsers.length > 1

  const pet = currentPet || (pets.length > 0 ? pets[0] : undefined)
  // 封面图：口径 = 真实照片 > AI/生成形象 > 品牌预设小图（见 resolveCoverImageUrl 注释：
  // 以前把品牌预设小图排除在封面外，导致用户自己选的形象在封面被一张通用插画顶掉）。
  // 提前到这里算，是为了让下面的"失败重试"effect 能按 URL 变化重置状态（hook 必须在 early return 之前）。
  const coverImageUrl = pet ? resolveCoverImageUrl(pet) : ''
  // 封面渲染决策（是否渲染 <Image> / 是否显示品牌插画）：
  // 品牌预设是方图、真实照片比例各异，一律走 aspectFit 等比缩放（不裁主体），
  // 留白交给 .pf-polaroid-ambient 那层同图模糊填色（见 scss）。
  // 传 coverFailed：加载失败时这里会直接判定"退回插画 + 不渲染图片"。
  const cover = resolveCoverImage(coverImageUrl, coverFailed)

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
        // 多成员共同养宠：若已加入家庭，加载家庭成员（人）列表用于"共同养宠"标识
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

  // 当切换宠物时，加载其特征数据
  useEffect(() => {
    if (pet && pageReady) {
      getPetFacts(pet.id).then(setFacts).catch(() => setFacts([]))
    }
  }, [pet?.id, pageReady])

  // 加载健康指标（评分 / 连续打卡 / 疫苗覆盖 / 近7天趋势）
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

  // 封面加载失败后按「URL 变化」重置失败标记（而不是按 pet.id）：
  // pet-profile 是 tab 常驻页，同一只宠物换新形象（形象定制页上传/生成）时 id 不变、只有 URL 变，
  // 若按 id 重置，用户换完头像回到本页会永远停在插画上，只有切宠物或重启才恢复。
  // 口径与 components/PetAvatar.tsx 的 imageFailed 重置一致。
  useEffect(() => {
    setCoverFailed(false)
  }, [coverImageUrl])

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
        {/* 空态改用品牌插画（原来是 🐾 emoji + 两行字，太素） */}
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
  const genderText = activePet.gender === 'male' ? '♂ 公' : activePet.gender === 'female' ? '♀ 母' : '性别未知'
  const ageText = activePet.birthDate ? calcAge(activePet.birthDate) : '年龄未知'
  // 手账页头的日期行：像在日记本顶端写"今天几号、星期几"
  const now = new Date()
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const todayLabel =
    `${now.getFullYear()} · ${String(now.getMonth() + 1).padStart(2, '0')} · ${String(now.getDate()).padStart(2, '0')}` +
    `　${weekNames[now.getDay()]}`
  // 身份证编号：优先用出生日期（用户看得懂的语义，如 PET-2023-0512）；
  // 没填生日时退回 id 后 6 位，保证编号区永远有内容、不会空着半行
  const petNo = activePet.birthDate
    ? `PET-${formatDate(activePet.birthDate).replace(/\//g, '-')}`
    : `PET-${String(activePet.id).slice(-6).toUpperCase()}`

  return (
    <ScrollView className={`profile-page ${themeClass}`} scrollY>
      {/* 全屏动态背景光斑层 */}
      <PageBackground />

      {/* ===================== 页头（手账版） =====================
          只写页面名、不写宠物名 —— 多宠物场景下页头挂某一只的名字，切换宠物后会立刻失效。
          日期小字 + 衬线标题 + 圆形虚线编辑纽：像在一页日记顶端写日期与标题。 */}
      <View className='pf-head'>
        <View className='pf-head-text'>
          <Text className='pf-head-date'>{todayLabel}</Text>
          <Text className='pf-head-title'>宠物档案</Text>
        </View>
        <View className='pf-edit-pill' onClick={() => navigateTo(`/pagesPet/edit/index?id=${activePet.id}`)}>
          <Icon name='pencil-simple' size={14} tone='primary' />
          <Text className='pf-edit-pill-text'>编辑</Text>
        </View>
      </View>

      {/* ===================== 宠物身份证：整页主角 =====================
          拍立得照片（白边相纸 + 胶带 + 微旋转）压住卡片上沿，下面接证件式字段与编号、图章。
          照片位的两级兜底：宠物自己的形象（真实照片/AI 形象/品牌预设小图）→ 品牌插画；
          图片 onError 后 cover.show 变 false、插画同时出现，照片位永远不会是破图或空格。
          缩放一律 aspectFit（等比、不裁主体），两侧留白由下面那层"同图放大模糊"托底。 */}
      <View className='pf-idcard'>
        <View className='pf-polaroid'>
          <View className='pf-polaroid-tape' />
          <View className='pf-polaroid-frame'>
            {/* 兜底层：只在"没有任何自有形象"（或形象加载失败）时出现 */}
            {cover.showIllustration && (
              <Illustration name='page-pet-profile' fill mode='aspectFill' className='pf-polaroid-art' />
            )}
            {/* 【2026-09-11 用户反馈后简化】这里原来还有一层"同图放大 + 高斯模糊"的环境层（pf-polaroid-ambient），
                用来给 aspectFit 的留白补色。用户实机反馈"头像看着是圆的、要方的、就一层"，据此改成：
                主图直接用 aspectFill **铺满整个方框**（证件照式的裁切），留白不存在了 → 环境层随之删除。
                这样头像区只剩一层（插画兜底 or 主图），不再有"圆晕 + 硬接缝"的问题。 */}
            {cover.show && (
              <Image
                className='pf-polaroid-img'
                // data-role 只用于单测定位"封面主图"
                data-role='cover'
                src={coverImageUrl}
                mode='aspectFill'
                onError={() => setCoverFailed(true)}
              />
            )}
          </View>
          {/* 拍立得下沿的留白处写名字，像照片背面随手写的那一笔 */}
          <View className='pf-polaroid-caption'>
            <Text className='pf-polaroid-name'>{activePet.name}</Text>
            <View className='pf-polaroid-shoot' onClick={() => navigateTo('/pagesPet/avatar-customize/index')}>
              {/* 图标跟随同胶囊文字取主色：底色是近白相纸，用 tone='white' 会白底白图看不见 */}
              <Icon name='camera' size={12} tone='primary' />
              <Text className='pf-polaroid-shoot-text'>换头像</Text>
            </View>
          </View>
        </View>

        <View className='pf-idcard-body'>
          <View className='pf-idcard-line'>
            <Text className='pf-idcard-breed'>{activePet.breed || '未知品种'}</Text>
            <Text className='pf-idcard-dot'>·</Text>
            <Text className='pf-idcard-meta'>{genderText}</Text>
            <Text className='pf-idcard-dot'>·</Text>
            <Text className='pf-idcard-meta'>{ageText}</Text>
            {isCoCared && (
              <View className='pf-idcard-badge'>
                <Icon name='users' size={10} tone='primary' />
                <Text className='pf-idcard-badge-text'>家庭共养</Text>
              </View>
            )}
          </View>

          {/* 证件式两列字段：默认值是"还没填"，所以空值一律降权显示，不假装有数据 */}
          <View className='pf-idcard-grid'>
            <View className='pf-field'>
              <Text className='pf-field-label'>生日</Text>
              <Text className='pf-field-value'>{formatDate(activePet.birthDate)}</Text>
            </View>
            <View className='pf-field'>
              <Text className='pf-field-label'>毛色</Text>
              <Text className={`pf-field-value ${activePet.coatColor ? '' : 'pf-field-value--off'}`}>
                {activePet.coatColor || '未记录'}
              </Text>
            </View>
            <View className='pf-field'>
              <Text className='pf-field-label'>体重</Text>
              <Text className={`pf-field-value ${activePet.weight ? '' : 'pf-field-value--off'}`}>
                {activePet.weight ? `${activePet.weight}kg` : '未记录'}
              </Text>
            </View>
            <View className='pf-field'>
              <Text className='pf-field-label'>芯片号</Text>
              <Text className={`pf-field-value ${activePet.microchipId ? '' : 'pf-field-value--off'}`}>
                {activePet.microchipId || '未录入'}
              </Text>
            </View>
          </View>

          <View className='pf-idcard-foot'>
            <Text className='pf-idcard-no'>NO. {petNo}</Text>
            {/* 图章：绝育/离世这类"既成事实"用手写盖章表达，比一行文字更有仪式感 */}
            {activePet.isDeceased ? (
              <View className='pf-stamp pf-stamp--deceased'><Text className='pf-stamp-text'>已回喵星</Text></View>
            ) : activePet.isNeutered ? (
              <View className='pf-stamp'><Text className='pf-stamp-text'>已绝育</Text></View>
            ) : (
              <Text className='pf-idcard-note'>未绝育</Text>
            )}
          </View>
        </View>
      </View>

      {/* ===================== 贴纸数据 =====================
          三张微旋转的贴纸（带胶带），把"今天好不好"提到首屏；
          无数据的贴纸不显示「--」，而是给出下一步动作。 */}
      <View className='pf-stickers'>
        <View className='pf-sticker'>
          <Text className='pf-sticker-label'>健康评分</Text>
          {healthScore !== null ? (
            <Text className='pf-sticker-value pf-sticker-value--primary'>
              {healthScore}
              <Text className='pf-sticker-unit'>分</Text>
            </Text>
          ) : (
            <Text className='pf-sticker-empty'>打卡后生成</Text>
          )}
          {/* 有数据画实心轨道；没数据画虚线空槽（手账里没填的格子），不画 0% 的实心线 */}
          {healthScore !== null ? (
            <View className='pf-sticker-track'>
              <View className='pf-sticker-fill' style={{ width: `${healthScore}%` }} />
            </View>
          ) : (
            <View className='pf-sticker-slot' />
          )}
        </View>
        <View className='pf-sticker'>
          <Text className='pf-sticker-label'>连续打卡</Text>
          <Text className='pf-sticker-value pf-sticker-value--gold'>
            {streakDays}
            <Text className='pf-sticker-unit'>天</Text>
          </Text>
          {/* 无分母可量化（没有"目标天数"这个产品概念），因此这里不画进度条，避免假进度 */}
          <Text className='pf-sticker-foot'>今天记了吗</Text>
        </View>
        <View className='pf-sticker'>
          <Text className='pf-sticker-label'>疫苗覆盖</Text>
          {vaccineCoverage !== null ? (
            <Text className='pf-sticker-value pf-sticker-value--success'>
              {vaccineCoverage}
              <Text className='pf-sticker-unit'>%</Text>
            </Text>
          ) : (
            <Text className='pf-sticker-empty'>暂无记录</Text>
          )}
          {vaccineCoverage !== null ? (
            <View className='pf-sticker-track'>
              <View className='pf-sticker-fill pf-sticker-fill--success' style={{ width: `${vaccineCoverage}%` }} />
            </View>
          ) : (
            <View className='pf-sticker-slot' />
          )}
        </View>
      </View>

      {/* 多宠物切换：用真实头像（照片 > AI 形象 > 品牌小动物头像），不再只显示物种 emoji */}
      {pets.length > 1 && (
        <ScrollView className='pf-switcher' scrollX>
          <View className='pf-switcher-inner'>
            {pets.map(p => (
              <View
                key={p.id}
                className={`pf-switch-chip ${currentPet?.id === p.id ? 'pf-switch-chip--on' : ''}`}
                onClick={() => {
                  // 切换失败给提示（2026-09-11）：petStore.switchPet 失败会 throw，
                  // 直接丢在 onClick 里既是未处理的 Promise rejection，用户也会觉得"点了没反应"
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

      {/* ===================== 健康备忘便签（虚线便签，只留"会出事"的几项） =====================
          基础信息已并入上方身份证卡（生日/毛色/体重/芯片），这里不再重复第二遍。 */}
      <View className='pf-note'>
        <View className='pf-note-head'>
          <Text className='pf-note-title'>健康备忘</Text>
          <Text className='pf-note-hint'>过敏 / 用药 / 慢病</Text>
        </View>
        <View className='pf-row'>
          <View className='pf-row-icon'><Icon name='prohibit' size={15} tone='danger' /></View>
          <Text className='pf-row-label'>过敏史</Text>
          <Text className={`pf-row-value ${activePet.allergies?.length ? '' : 'pf-row-value--off'}`}>
            {activePet.allergies?.length ? activePet.allergies.join('、') : '无'}
          </Text>
        </View>
        <View className='pf-row'>
          <View className='pf-row-icon'><Icon name='pill' size={15} tone='primary' /></View>
          <Text className='pf-row-label'>当前用药</Text>
          <Text className={`pf-row-value ${activePet.medications?.length ? '' : 'pf-row-value--off'}`}>
            {activePet.medications?.length ? activePet.medications.join('、') : '无'}
          </Text>
        </View>
        <View className='pf-row'>
          <View className='pf-row-icon'><Icon name='heartbeat' size={15} tone='primary' /></View>
          <Text className='pf-row-label'>慢性病</Text>
          <Text className={`pf-row-value ${activePet.chronicConditions?.length ? '' : 'pf-row-value--off'}`}>
            {activePet.chronicConditions?.length ? activePet.chronicConditions.join('、') : '无'}
          </Text>
        </View>
        <View className='pf-row pf-row--last'>
          <View className='pf-row-icon'><Icon name='chart-line' size={15} tone='gold-deep' /></View>
          <Text className='pf-row-label'>近 7 天趋势</Text>
          <Text className='pf-row-value'>{weekTrend}</Text>
        </View>
      </View>

      {/* ===================== 品种特征便签 ===================== */}
      <View className='pf-note'>
        <View className='pf-note-head'>
          <Text className='pf-note-title'>品种特征</Text>
          <Text className='pf-note-hint'>{activePet.breed || '未知品种'}</Text>
        </View>
        <View className='pf-row'>
          <View className='pf-row-icon'><Icon name='dna' size={15} tone='primary' /></View>
          <Text className='pf-row-label'>遗传病易感</Text>
          <Text className='pf-row-value'>{breedInfo?.geneticDiseases?.[0] || activePet.notes || '暂无数据'}</Text>
        </View>
        <View className='pf-row'>
          <View className='pf-row-icon'><Icon name='scales' size={15} tone='gold-deep' /></View>
          <Text className='pf-row-label'>体重正常范围</Text>
          <Text className='pf-row-value'>{breedInfo?.weightRangeStr || '暂无数据'}</Text>
        </View>
        <View className='pf-row pf-row--last'>
          <View className='pf-row-icon'><Icon name='bowl-food' size={15} tone='sage' /></View>
          <Text className='pf-row-label'>饮食禁忌</Text>
          <Text className='pf-row-value'>{breedInfo?.dietRestrictions?.[0] || '暂无数据'}</Text>
        </View>
      </View>

      {/* ===================== 它的小习惯（便签格） ===================== */}
      {facts.length > 0 && (
        <View className='pf-note'>
          <View className='pf-note-head'>
            <Text className='pf-note-title'>它的小习惯</Text>
            <Text className='pf-note-hint'>{facts.length} 条</Text>
          </View>
          <View className='pf-facts'>
            {facts.map((fact) => (
              <View key={fact.id} className='pf-fact'>
                <Icon
                  name={FACT_ICONS[fact.category] || 'note-pencil'}
                  size={14}
                  tone={fact.category === 'like' ? 'primary' : fact.category === 'dislike' ? 'muted' : 'gold-deep'}
                />
                <Text className='pf-fact-text'>{fact.fact}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ===================== 功能入口宫格（统一面性图标 + 浅色底方块） ===================== */}
      <View className='pf-grid'>
        <View className='pf-grid-item' onClick={() => navigateTo('/pagesPet/chronic-tracking/index')}>
          <View className='pf-grid-icon pf-grid-icon--coral'><Icon name='stethoscope' size={20} tone='primary' /></View>
          <Text className='pf-grid-text'>慢性病</Text>
        </View>
        <View className='pf-grid-item' onClick={() => navigateTo('/pagesPet/feeding-advice/index')}>
          <View className='pf-grid-icon pf-grid-icon--gold'><Icon name='bowl-food' size={20} tone='gold-deep' /></View>
          <Text className='pf-grid-text'>喂养建议</Text>
        </View>
        {/* 成长日记：原独立分包页「宠物日记」，2026-09-12（IA 第 2c 批）并入时光线页。
            注意必须用 switchTab —— 时光线是 tabBar 页面，navigateTo 打开 tabBar 页在微信端会直接失败。 */}
        <View className='pf-grid-item' onClick={() => Taro.switchTab({ url: '/pages/timeline/index' })}>
          <View className='pf-grid-icon pf-grid-icon--sage'><Icon name='note-pencil' size={20} tone='sage' /></View>
          <Text className='pf-grid-text'>成长日记</Text>
        </View>
        <View className='pf-grid-item' onClick={() => navigateTo('/pagesPet/avatar-customize/index')}>
          <View className='pf-grid-icon pf-grid-icon--teal'><Icon name='palette' size={20} tone='teal' /></View>
          <Text className='pf-grid-text'>形象定制</Text>
        </View>
      </View>

      {/* 次级入口：一行三个，避免再堆两组全宽按钮 */}
      <View className='pf-links'>
        <View className='pf-link' onClick={() => navigateTo('/pagesPet/vaccine/index')}>
          <Icon name='syringe' size={15} tone='primary' />
          <Text className='pf-link-text'>疫苗日历</Text>
        </View>
        <View className='pf-link' onClick={() => navigateTo('/pagesPet/trends/index')}>
          <Icon name='chart-line' size={15} tone='gold-deep' />
          <Text className='pf-link-text'>健康趋势</Text>
        </View>
        {/* 2026-09-12 IA 第 2b 批：health-report 页已并入 trends，这里的入口跟着改指，避免死链 */}
        <View className='pf-link' onClick={() => navigateTo('/pagesPet/trends/index')}>
          <Icon name='clipboard-text' size={15} tone='teal' />
          <Text className='pf-link-text'>健康报告</Text>
        </View>
      </View>

      {/* ===================== 危险操作：降权为一行弱提示，避免误触 ===================== */}
      <View className='pf-danger' onClick={handleMarkDeceased}>
        <Icon name='warning' size={13} tone='muted' />
        <Text className='pf-danger-text'>标记宠物离世</Text>
      </View>

      <View className='profile-bottom-safe' />
    </ScrollView>
  )
}
