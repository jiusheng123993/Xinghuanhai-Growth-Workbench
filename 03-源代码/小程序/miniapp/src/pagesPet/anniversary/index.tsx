/**
 * 生日与纪念日页面（pagesPet/anniversary）
 *
 * 【为什么会有这一页】宠物档案页第二组的「生日与纪念日」此前没有落点（渲染成不可点的
 * 「即将上线」）。2026-09-12 收口时确认：**本仓没有独立的「纪念日」数据模型**
 * （`memory-body` 的 `PetMilestone` 只承载打卡里程碑、且是本地 storage 缓存，不是纪念日表），
 * 所以本页**只派生真实日期**，一条假数据也不造：
 *   · 出生日期 / 年龄       → `PetProfile.birthDate`（档案里填的那个字段）+ utils/date 的 formatPetAge
 *   · 下一岁生日 / 倒计时    → 由 birthDate 的「月-日」算下一次出现的日期
 *   · 纪念日                → `PetProfile.createdAt`（把它加进星河宠记那天，本仓没有「到家日/领养日」字段）
 *   · 下一个周年 / 已陪伴    → 由 createdAt 派生的周年日 + utils/date 的 daysSinceLocalDate
 * 页内**没有任何写入口**：改生日要走「编辑档案」，这样「档案是唯一事实源」不会被人为打破。
 *
 * 【为什么不用 memory-body/adapters/milestoneAdapter】
 * 它存的 pet_milestones 只有一个自动写入的类型 `first_checkin`（打卡里程碑），既不是用户定义的
 * 纪念日，也没有「生日 / 建档周年」这两类派生事件。拿它渲染本页，用户会以为仓里真有一张纪念日表。
 *
 * 【边界与坑】
 * · 日期一律走 utils/date 的本地零点解析口径 —— `new Date('YYYY-MM-DD')` 是 **UTC** 解析，
 *   在东八区相当于当天 08:00，凌晨看会差一天（那个坑 utils/date 顶部有完整记录）；
 * · 出生日期缺失/非法/在未来 → 生日分区渲染空态，而不是显示「0 天」或负数年龄；
 * · 建档时间缺失 → 纪念日分区渲染提示，不假装算得出；
 * · 宠物已安息 → 日期照留（这些日子值得留着），但不显示「还有 N 天」的倒计时
 *   （对着已经离开的宠物数生日倒计时是不合适的）；
 * · 2 月 29 日的生日遇到平年，由 Date 自然进位到 3 月 1 日 —— 不额外补规则，
 *   免得凭空造出「2 月 29 日」这个当年不存在的日期。
 *
 * 【多宠物】以 store 的 `currentPet` 为准（宠物档案页的切换器已经把选中的宠物写进 store），
 * 本页不重复放切换器。
 *
 * 【中文注释约定】每个导出函数都写明「做什么 + 为什么 + 边界」。
 */
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { usePetStore } from '../../stores/petStore'
import { daysSinceLocalDate, formatPetAge, localDateString, parseLocalDate } from '../../utils/date'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import { useThemeClass } from '../../hooks/useThemeClass'
import PageLoading from '../../components/PageLoading'
import PageBackground from '../../components/PageBackground'
import { EmptyState, Icon, Illustration } from '../../components'
import type { IconName } from '../../components/Icon'
import './index.scss'

/** 星期文案表：下标与 `Date.getDay()` 的 0..6 一一对应 */
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 日期串 → 中文星期（如「周三」）
 * @param date - 'YYYY-MM-DD' 或任何能被 parseLocalDate 解析的日期串
 * @returns 星期文案；无法解析时返回空串，让调用方少拼一段，而不是显示「周NaN」
 */
export function formatWeekday(date: string): string {
  const parsed = parseLocalDate(date)
  if (!parsed) return ''
  return WEEKDAY_LABELS[parsed.getDay()]
}

/** 一个「下一次出现」的日子（生日与建档周年共用同一套结构） */
export interface UpcomingDay {
  /** 下一次出现的日期（本地口径 'YYYY-MM-DD'） */
  date: string
  /** 距今天还有几个自然日（0 = 就是今天） */
  daysUntil: number
  /** 第几次：生日 = 满 N 岁，建档 = N 周年；恒 ≥ 1 */
  nth: number
}

/**
 * 算「某个日期的月-日」下一次出现的日子（本页两个派生日期共用的内核）
 *
 * 为什么不直接用 `daysSinceLocalDate`：它回答的是「过去某天到今天过了几天」，
 * 传入未来日期会返回 null（设计如此，避免负天数被当数据用）。本页要的恰恰是**未来**方向的天数，
 * 所以自己算一次；过去方向仍然复用 `daysSinceLocalDate`（下面「已陪伴」就是）。
 *
 * @param source - 起算日期（生日 / 建档时间；'YYYY-MM-DD' 或带时间的 ISO 串都可以）
 * @param now - 参照的「今天」，测试注入固定时刻用
 * @returns 下一次出现的信息；来源日期缺失或非法时返回 null
 */
function nextOccurrence(source: string, now: Date): UpcomingDay | null {
  const start = parseLocalDate(source)
  const today = parseLocalDate(now)
  if (!start || !today) return null

  // 先按「年份差」猜一次，猜小了再 +1：start 必在今天之前，所以年份差 ≥ 0；
  // 下限取 1 是为了兜住「今年才建档 / 今年才出生」：第 0 岁、第 0 周年都没有意义
  let nth = Math.max(1, today.getFullYear() - start.getFullYear())
  // 目标日 = start 的月-日 + nth 年；2/29 遇平年由 Date 自然进位到 3/1（见文件头说明）
  const targetOf = (n: number) => new Date(start.getFullYear() + n, start.getMonth(), start.getDate())
  let target = targetOf(nth)
  if (target.getTime() < today.getTime()) {
    nth += 1
    target = targetOf(nth)
  }

  const date = localDateString(target)
  if (!date) return null
  // 两端都是本地零点，直接相减就是自然日差（中国无夏令时；round 兜住其它时区的 ±1 小时漂移）
  return { date, daysUntil: Math.round((target.getTime() - today.getTime()) / 86400000), nth }
}

/**
 * 下一岁生日（由档案里的出生日期派生）
 * @param birthDate - `PetProfile.birthDate`
 * @param now - 参照的「今天」，默认当前时间（测试注入用）
 * @returns 下一次生日（含满几岁与倒计时天数）；出生日期缺失/非法时返回 null
 */
export function nextBirthday(birthDate: string, now: Date = new Date()): UpcomingDay | null {
  return nextOccurrence(birthDate, now)
}

/**
 * 下一个建档周年纪念日（由「加入星河宠记」的建档时间派生）
 * @param sinceDate - `PetProfile.createdAt`
 * @param now - 参照的「今天」，默认当前时间（测试注入用）
 * @returns 下一次周年（含第几周年与倒计时天数）；建档时间缺失/非法时返回 null
 */
export function nextAnniversary(sinceDate: string, now: Date = new Date()): UpcomingDay | null {
  return nextOccurrence(sinceDate, now)
}

/** 清单行的色系（与 Icon 的 tone 同名，底色与图标同源） */
type RowTone = 'primary' | 'teal' | 'sage' | 'gold-deep'

/** 一行「标签 + 值」；值全部来自档案派生，没有任何写死的数字 */
interface AnnivRow {
  key: string
  icon: IconName
  tone: RowTone
  label: string
  value: string
}

export default function PetAnniversary() {
  const themeClass = useThemeClass()
  const user = useAuthStore(state => state.user)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const isInitialized = useAuthStore(state => state.isInitialized)
  const { pets, currentPet, fetchPets } = usePetStore()
  const [pageReady, setPageReady] = useState(false)

  // 当前宠物：优先 store 里选中的那只（档案页切换器写进去的），否则退到列表第一只
  const pet = currentPet || (pets.length > 0 ? pets[0] : undefined)

  // 登录守卫 + 取宠物列表：与宠物档案页同一套收口
  // （未登录一律交 utils/authGuard，避免各页各写一个 reLaunch 造成路由竞态）
  useEffect(() => {
    if (!isInitialized) return
    if (!isAuthenticated || !user) {
      redirectToLoginIfNeeded()
      return
    }
    const load = async () => {
      try {
        await fetchPets(user.id)
      } catch {
        // 取数失败不卡住页面：下面按「还没有添加宠物」的空态渲染，用户仍能点「添加宠物」自救
      }
      setPageReady(true)
    }
    load()
  }, [isInitialized, isAuthenticated, user])

  /** 页面内跳转统一收口（本页只有三个落点：编辑档案 ×2、添加宠物） */
  const navigateTo = (url: string) => {
    Taro.navigateTo({ url })
  }

  if (!pageReady) {
    return <PageLoading />
  }

  if (pets.length === 0 || !pet) {
    return (
      <View className={`anniv-page ${themeClass}`}>
        <PageBackground />
        <View className='anniv-card anniv-card--empty'>
          <EmptyState
            illustration='empty-pet'
            title='还没有添加宠物'
            desc='添加宠物后，这里会自动算出它的生日与纪念日'
            actionText='添加宠物'
            onAction={() => navigateTo('/pagesPet/add/index')}
          />
        </View>
      </View>
    )
  }

  // ===== 以下全部是派生值：每一项都能追到档案里的某个字段，没有一处是写死的 =====
  const activePet = pet
  // 出生日期（档案里的 birthDate）——本仓没有独立的「纪念日」表，生日是唯一的人工事实源
  const birthYmd = localDateString(activePet.birthDate)
  const upcomingBirthday = nextBirthday(activePet.birthDate)
  // 建档时间（createdAt = 把它加进星河宠记那天）；本仓没有「到家日 / 领养日」字段
  const joinedYmd = localDateString(activePet.createdAt)
  const upcomingAnniversary = nextAnniversary(activePet.createdAt)
  // 已陪伴天数：与档案页页头同一口径（起算点是建档时间，不是生日）
  const companionDays = daysSinceLocalDate(activePet.createdAt)
  // 已安息：日期照留，但不显示「还有 N 天」倒计时（见文件头说明）
  const showCountdown = !activePet.isDeceased

  const birthRows: AnnivRow[] = []
  if (birthYmd) {
    birthRows.push({ key: 'birth', icon: 'calendar-check', tone: 'primary', label: '出生日期', value: birthYmd })
    // 年龄统一走 utils/date 的 formatPetAge（全站一个口径）；取不到时显示「未记录」而不是空值
    birthRows.push({
      key: 'age',
      icon: 'paw-print',
      tone: 'sage',
      label: '现在年龄',
      value: formatPetAge(activePet.birthDate, { fallback: '未记录' }),
    })
  }
  if (upcomingBirthday) {
    birthRows.push({
      key: 'next-birthday',
      icon: 'clock',
      tone: 'gold-deep',
      label: '下一岁生日',
      value: `${upcomingBirthday.date} ${formatWeekday(upcomingBirthday.date)}`.trim(),
    })
    if (showCountdown) {
      birthRows.push({
        key: 'birthday-countdown',
        icon: 'sparkle',
        tone: 'primary',
        label: '距离生日',
        value: upcomingBirthday.daysUntil === 0
          ? `今天就是它的 ${upcomingBirthday.nth} 岁生日`
          : `还有 ${upcomingBirthday.daysUntil} 天`,
      })
    }
  }

  const annivRows: AnnivRow[] = []
  if (joinedYmd && upcomingAnniversary) {
    annivRows.push({
      key: 'joined',
      icon: 'house',
      tone: 'teal',
      label: '加入星河宠记',
      value: `${joinedYmd} ${formatWeekday(joinedYmd)}`.trim(),
    })
    // 陪伴 0 天（今天刚建档）时不出这一行，避免「已陪伴 0 天」这种没信息量的展示
    if (companionDays !== null && companionDays > 0) {
      annivRows.push({
        key: 'companion',
        icon: 'heart',
        tone: 'primary',
        label: '已陪伴',
        value: `${companionDays} 天`,
      })
    }
    annivRows.push({
      key: 'next-anniversary',
      icon: 'star',
      tone: 'gold-deep',
      label: '下一个周年',
      value: `第 ${upcomingAnniversary.nth} 周年 · ${upcomingAnniversary.date}`,
    })
    if (showCountdown) {
      annivRows.push({
        key: 'anniversary-countdown',
        icon: 'sparkle',
        tone: 'primary',
        label: '距离纪念日',
        value: upcomingAnniversary.daysUntil === 0 ? '就是今天' : `还有 ${upcomingAnniversary.daysUntil} 天`,
      })
    }
  }

  /**
   * 渲染一个日期清单（生日 / 纪念日共用）
   * @param rows - 行定义；值已在上面派生好，这里只负责排版
   * @returns 卡片 JSX
   */
  const renderRows = (rows: AnnivRow[]) => (
    <View className='anniv-card'>
      {rows.map((row, i) => (
        <View key={row.key} className={`anniv-row ${i === rows.length - 1 ? 'anniv-row--last' : ''}`}>
          <View className={`anniv-row__icon anniv-row__icon--${row.tone}`}>
            <Icon name={row.icon} size={16} tone={row.tone} />
          </View>
          <Text className='anniv-row__label'>{row.label}</Text>
          <Text className='anniv-row__value'>{row.value}</Text>
        </View>
      ))}
    </View>
  )

  return (
    <ScrollView className={`anniv-page ${themeClass}`} scrollY>
      {/* 全屏动态背景光斑层（与档案页一致，主题切换时一起变） */}
      <PageBackground />

      {/* ===== 页头：宠物名 + 数据来源一句话（本页不存任何自己造的数据） =====
          右侧插画用 `moment-anniversary`：这是全站唯一「周年纪念」语义的插画 key
          （原始 36 key 体系里的旧图，构图为「上方留白 + 下方双宠捧着心」的暖橙毡毛风，
          与秋季主题「暖阳珊瑚橙」（2026-09-12 前的默认主题）同色系）。
          【为什么放右侧而不是当整条背景】该图是 600×600 方图且**上方约四成是留白**，
          铺成横幅会把留白放大成一条空白带；放在标题右侧的方形容器里，
          留白正好变成主体头顶的呼吸空间。
          【为什么这里能安全接线】22 号 2026-09-12 逐控件核过：`moment-*` 这批图
          在 `SEASONAL_SLOT` 里没有季节版（走 `ILLUSTRATION_DIR` 旧图），
          所以四季主题切换时它不换图 —— 本页也不依赖它换图。 */}
      <View className='anniv-hero'>
        <View className='anniv-hero__main'>
          <Text className='anniv-hero__name'>{activePet.name} 的重要日子</Text>
          <Text className='anniv-hero__desc'>生日与纪念日都由档案里的日期自动算出</Text>
          {activePet.isDeceased && (
            <View className='anniv-hero__badge'>
              <Icon name='heart' size={11} tone='primary' />
              <Text className='anniv-hero__badge-text'>已安息 · 这些日子都留着</Text>
            </View>
          )}
        </View>
        <Illustration name='moment-anniversary' fill mode='aspectFill' className='anniv-hero__art' />
      </View>

      {/* ===== 生日（全部由 birthDate 派生） ===== */}
      <View className='anniv-sec'>
        <View className='anniv-sec__head'>
          <View className='anniv-sec__dot' />
          <Text className='anniv-sec__title'>生日</Text>
          {/* 右侧小字：把「满几岁」放在这里，省掉单独一行只有两个字的行 */}
          {upcomingBirthday && (
            <Text className='anniv-sec__hint'>下一个生日满 {upcomingBirthday.nth} 岁</Text>
          )}
        </View>
        {birthRows.length > 0 ? renderRows(birthRows) : (
          <View className='anniv-card anniv-card--empty'>
            {/* 空态按任务书口径写清「生日在档案里填」：本页没有写入口，也绝不编一个日期出来。
                【插画】改用 `moment-birthday`，不再用 `calendar-check` 图标兜底：
                全站 37 个 key 里只有这一张画的是「生日」这件事本身
                （猫狗围着一个插着蜡烛的小蛋糕），而它此前**全站零引用**；
                `EmptyState` 的契约本来就是"有对应插画用 illustration、没有才退回 icon"。
                ⚠️ 该 key 在 `SEASONAL_SLOT` 里没有季节版，走 `ILLUSTRATION_DIR` 旧图，
                   所以四季主题切换时它**不换图** —— 与上面 hero 那张 `moment-anniversary` 同一口径。
                形状 600×600（主体居中偏下、上方留白），服务器实测 HEAD 200
                （`/uploads/illustrations/moment-birthday.jpg`，51846 B）。
                【为什么这一格能放 132px 的"上方留白"构图】`moment-*` 这批图是给"文字在上"的
                版式画的（主体偏下、上方留白放字）；放这里文字在**下**方，那截留白就变成主体头顶的
                呼吸空间，132px 下读起来与 `empty-*` 那批「主体居中、四周留白」没有观感落差。
                （同样的图放 32px 的成就小格里就不行了 —— 留白会占掉可见高度的大半，所以时光页
                 成就格用的是 `empty-achievement` 而不是 moment 这批，两处取舍口径不同、理由在此。）
                【同页一致性】下面「纪念日」空态仍用 `clock` 图标：没有任何一张插画的语义是
                「还算不出纪念日」（缺建档时间），硬套会误导；且 `createdAt` 由后端在创建宠物时写入，
                那条分支基本只在脏数据时出现，同页同时看到两种空态的概率极低。 */}
            <EmptyState
              illustration='moment-birthday'
              title='还没有记录生日'
              desc='宠物的生日在档案里填，这里会自动算出纪念日'
              actionText='去填写生日'
              onAction={() => navigateTo('/pagesPet/edit/index')}
            />
          </View>
        )}
      </View>

      {/* ===== 纪念日（全部由 createdAt 派生） ===== */}
      <View className='anniv-sec'>
        <View className='anniv-sec__head'>
          <View className='anniv-sec__dot' />
          <Text className='anniv-sec__title'>纪念日</Text>
        </View>
        {annivRows.length > 0 ? renderRows(annivRows) : (
          <View className='anniv-card anniv-card--empty'>
            <EmptyState
              icon='clock'
              title='还算不出纪念日'
              desc='缺少建档时间（把它加进星河宠记的那天），补上档案后这里会自动算出'
              actionText='去完善档案'
              onAction={() => navigateTo('/pagesPet/edit/index')}
            />
          </View>
        )}
      </View>

      {/* ===== 说明 + 编辑入口：本页只读，改日期一律回「编辑档案」，保证档案是唯一事实源 ===== */}
      <View className='anniv-note'>
        <View className='anniv-note__icon'>
          <Icon name='info' size={14} tone='muted' />
        </View>
        {/* 文案保持单行：<Text> 里的换行不会渲染，写多行反而会多出一个空格 */}
        <Text className='anniv-note__text'>本页不单独保存纪念日：生日取自档案里的「出生日期」，纪念日取自把它加进星河宠记的那天。</Text>
      </View>
      <View className='anniv-edit' hoverClass='anniv-edit--hover' onClick={() => navigateTo('/pagesPet/edit/index')}>
        <Icon name='pencil-simple' size={15} tone='white' />
        <Text className='anniv-edit__text'>编辑档案</Text>
      </View>

      {/* 底部呼吸位 + 全面屏安全区（本页是分包普通页面，没有自定义 tabBar 覆盖层要让位） */}
      <View className='anniv-bottom-safe' />
    </ScrollView>
  )
}
