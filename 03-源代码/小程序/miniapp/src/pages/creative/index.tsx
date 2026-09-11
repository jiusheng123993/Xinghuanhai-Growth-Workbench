import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Image } from '@tarojs/components'
import { usePetStore } from '../../stores/petStore'
import { useAuthStore } from '../../stores/authStore'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import { getTodayCheckin, calcHealthScore } from '../../services/checkinService'
import type { PetHealthEntry } from '../../services/checkinService'
import PetSwitcher from '../../components/PetSwitcher'
import { resolvePetAvatarUrl } from '../../data/homeStyleAvatars'
import type { FillIconName } from '../../components/icons-fill'
import type { GridIllustration } from '../../data/illustrations'
import { useThemeClass } from '../../hooks/useThemeClass'
import { formatPetAge } from '../../utils/date'

import './index.scss'
import { PageBackground, Icon, Illustration, PageHero } from '../../components'

/**
 * 创作 tab 页（2026-09-09 对齐高保真原型 creative-hub-prototype.html 屏1）：
 * 原「家庭」tab 位改为「创作」——宠物主页收敛为创作双入口 + 今日功能保位。
 * - 🎨创作区：形象工坊 / 回忆录馆 两张主题卡承载全部 AIGC 能力
 * - 📋今日区：健康打卡 / AI管家 / 家庭图谱 / 周报 维持原位
 * - 更多区：时光线（原 tab 页收口）+ 疫苗日历
 * 导航栏标题动态为家庭名/宠物名（原型「可乐的家庭」）。
 */

/**
 * 年龄文案已收敛到 utils/date 的 formatPetAge（2026-09-11）
 *
 * 本页原实现是少数"减了日"的正确版本，但格式是 `0岁11月`（不满一岁也带「0岁」前缀）、
 * 且按 UTC 解析。现在统一为「11个月 / 1岁3个月 / 12天」。
 */

/**
 * 「今日」「更多」的方块卡
 *
 * 2026-09-11 第四版（用户第三轮反馈：「还是太丑，能不能做成插画」）。
 *
 * 【为什么前三版都不成立，最后走插画】
 *   前三版一直在"图标怎么做得好看"里打转（纯白卡 → 四色淡底 → 暖白卡+实色图标牌），
 *   但实测几何说明问题不在颜色：卡片 167×116pt 横扁，内容全挤在左上角，
 *   **右侧约 40% 是空的**，看起来像"没做完的占位"。
 *   第四版换成长宽接近的方形卡 + **品牌插画**：插画本身自带画面信息量，
 *   卡片被填满了，而且与同页上方「创作区」三张插画横幅变成同一套语言。
 *
 * 【三个字段各自管什么】
 *   · illustration —— 卡片主视觉（600×600 品牌插画，见 data/illustrations.ts 的 GridIllustration）
 *   · icon         —— **兜底**：插画走网络，加载失败时 <Illustration> 不渲染，
 *                     这时露出底下那枚反白图标牌，卡片不会变成一个空方块
 *                     （与 PetAvatar 的「照片 → 品牌头像 → emoji」是同一套兜底思路）
 *   · hue          —— 图标牌/卡片淡底/描边/投影的唯一色相来源
 */
type MiniHue = 'coral' | 'gold' | 'sage' | 'teal'

type MiniFeature = {
  key: string
  /** 主视觉：品牌插画 key（拼错直接编译不过） */
  illustration: GridIllustration
  /** 兜底图标：插画加载失败时显示（面性图标名，见 components/icons-fill.ts） */
  icon: FillIconName
  /** 色相：同时决定图标牌实色与卡片淡底/描边/投影 */
  hue: MiniHue
  title: string
  desc: string
  /** 目标路由；给 switchTab 时用 tab 跳转 */
  url: string
  tab?: boolean
  /**
   * 是否需要宠物上下文（无宠物时提示先添加）。
   *
   * **必填**，不给默认值：`goWithPet(url, requirePet = true)` 的默认是 true，
   * 而这里原来写的是 `f.requirePet ?? false` —— 同一件事两个相反的默认值，
   * 漏填时行为取决于读的是哪一处，属"不 fail-safe"。改成必填后 6 条各自的取向一目了然。
   */
  requirePet: boolean
}

const TODAY_FEATURES: MiniFeature[] = [
  { key: 'checkin', illustration: 'grid-checkin', icon: 'camera', hue: 'coral', title: '健康打卡', desc: '状态 · 饮食 · 疫苗提醒', url: '/pagesPet/checkin/index', requirePet: true },
  // AI 管家走 switchTab 跳到首页 tab，不使用 petId 参数，因此 requirePet 取 false
  { key: 'agent', illustration: 'grid-agent', icon: 'stethoscope', hue: 'teal', title: 'AI 管家', desc: '有记忆的养宠助手', url: '/pages/index/index', tab: true, requirePet: false },
  // 家庭图谱可在无宠物时进入（页面自带空态引导），保持改动前的行为
  { key: 'lineage', illustration: 'grid-lineage', icon: 'users', hue: 'sage', title: '家庭图谱', desc: '血缘 · 关系 · 邀请', url: '/pagesPet/family/lineage/index', requirePet: false },
  // 同上：周报页面自带空态，保持改动前的行为
  { key: 'weekly', illustration: 'grid-weekly', icon: 'calendar-check', hue: 'gold', title: '周报', desc: '本周健康小结', url: '/pagesPet/weekly-report/index', requirePet: false },
]

const MORE_FEATURES: MiniFeature[] = [
  { key: 'vaccine', illustration: 'grid-vaccine', icon: 'syringe', hue: 'sage', title: '疫苗日历', desc: '接种计划 · 提醒', url: '/pagesPet/vaccine/index', requirePet: true },
  // 2026-09-12 IA 第 2b 批：health-report 页已并入 trends（健康趋势），入口统一改指本页
  { key: 'report', illustration: 'grid-report', icon: 'clipboard-text', hue: 'coral', title: '健康报告', desc: '体检 · 疫苗 · 检查记录', url: '/pagesPet/trends/index', requirePet: true },
]

/**
 * 创作区三大入口（宽幅插画横幅卡）
 *
 * 插画取自品牌插画系统的 header-* 三张 —— 它们是「16:9、主体偏左、右侧留白」的构图，
 * 正是为横幅卡设计的，所以文字统一压在右侧留白处。
 */
const CREATIVE_FEATURES: Array<{
  key: string
  illus: 'header-avatar-studio' | 'header-memoir' | 'header-naming'
  title: string
  desc: string
  tags: string[]
  price: string
  url: string
}> = [
  {
    key: 'studio',
    illus: 'header-avatar-studio',
    title: '形象工坊',
    desc: '把毛孩子变成专属形象',
    tags: ['头像', '趣味变装', '全家福'],
    price: '免费 1 次变装体验',
    url: '/pagesMemoir/studio/index',
  },
  {
    key: 'memoir',
    illus: 'header-memoir',
    title: '回忆录馆',
    desc: '把真实记忆讲成一部小电影',
    tags: ['轻纪念', '标准', '完整'],
    price: '19.9 起',
    url: '/pagesMemoir/memoir-center/index',
  },
  {
    key: 'naming',
    illus: 'header-naming',
    title: 'AI 取名',
    desc: '智能推荐 + 寓意解读',
    tags: ['五行', '星宿', '故事'],
    price: '免费',
    url: '/pagesPet/naming/index',
  },
]

const CreativeHub = () => {
  const currentPet = usePetStore((s) => s.currentPet)
  const pets = usePetStore((s) => s.pets)
  const switchPet = usePetStore((s) => s.switchPet)
  /**
   * 主题类名：**必须挂在页面自己的根节点上**（2026-09-11 修复用户反馈「创作页没有跟随主题变化」）
   *
   * 为什么 app.js 那层不管用：`src/app.js` 确实把 `theme-{key}` 挂在了 `.app-root` 上，
   * 但那只在 **H5** 端成立 —— Taro 在 H5 里把 app 组件当成了页面的外壳。
   * **小程序端每个页面是独立渲染的，app 组件的 JSX 并不包裹页面节点**，
   * 所以 `.theme-starry` 这类类名的 CSS 变量根本传不到页面里。
   * 这也正是全站另外 7 个主页面各自调一次 useThemeClass() 的原因
   * （timeline / mine / index / pet-profile / product / ad-admin 都是这个写法）。
   *
   * 教训：主题相关改动**不能用 H5 渲染验证代替**，H5 的 app-root 会把问题盖住。
   */
  const themeClass = useThemeClass()
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const [todayCheckin, setTodayCheckin] = useState<PetHealthEntry | null>(null)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const petId = currentPet?.id || ''
  const petName = currentPet?.name || '毛孩子'

  // 页面级未登录守卫：与其他 tab 页（mine/family/pet-profile）对齐——
  // 未登录进入创作页时统一走 redirectToLoginIfNeeded 收口跳登录页，
  // 避免创作页裸渲染出「毛孩子」空占位却不引导登录（2026-09-11 修复）。
  useEffect(() => {
    if (!isInitialized) return
    if (!isAuthenticated || !user) {
      redirectToLoginIfNeeded()
      return
    }
  }, [isInitialized, isAuthenticated, user])

  // 导航栏标题：家庭名优先（原型「可乐的家庭」），无家庭回退宠物名
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: `${petName}的家庭` })
  }, [petName])

  // 今日打卡态 + 健康分
  useEffect(() => {
    if (!petId || !user?.id) {
      setTodayCheckin(null)
      return
    }
    let cancelled = false
    getTodayCheckin(petId, user.id).then((r) => {
      if (!cancelled) setTodayCheckin(r)
    }).catch(() => {
      if (!cancelled) setTodayCheckin(null)
    })
    return () => { cancelled = true }
  }, [petId, user?.id])

  const healthScore = todayCheckin ? calcHealthScore(todayCheckin.poopLevel, todayCheckin.appetiteLevel, todayCheckin.spiritLevel) : null

  /** 头像走全站统一口径：真实照片 > AI 形象 > 按品种匹配的品牌小动物头像
   *  （未设过头像的新宠物也显示小动物头像，不再退化成一个空圆/裸 emoji） */
  const avatarUrl = currentPet ? resolvePetAvatarUrl(currentPet) : ''
  const petEmoji = currentPet?.species === 'cat' ? '🐱' : '🐶'

  /** 路由封装：无宠物时打卡/管家/时光线等需要宠物上下文的入口先校验 */
  const goWithPet = (url: string, requirePet = true) => {
    if (requirePet && !petId) {
      Taro.showToast({ title: '请先添加宠物', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: `${url}${petId ? `?petId=${petId}` : ''}` })
  }

  const goSwitchTab = (url: string) => {
    Taro.switchTab({ url })
  }

  /**
   * 渲染一片功能宫格（「今日」与「更多」两处共用）
   *
   * 两片的 DOM 与点击逻辑逐字相同，只有数据源不同；写成函数而不是复制两遍 JSX，
   * 避免以后改卡片结构时只改一处（本文件历史上就出现过"只挪了卡片没挪切换器"的漏改）。
   *
   * @param list 这一天区要渲染的入口列表（TODAY_FEATURES / MORE_FEATURES）
   * @returns 宫格节点
   */
  const renderMiniGrid = (list: MiniFeature[]) => (
    <View className='cve-grid2'>
      {list.map((f) => (
        <View
          key={f.key}
          className={`cve-mini cve-mini--${f.hue}`}
          hoverClass='cve-mini--hover'
          onClick={() => (f.tab ? goSwitchTab(f.url) : goWithPet(f.url, f.requirePet))}
        >
          {/* 主视觉：品牌插画在上、反白图标牌在底。
              Illustration 加载失败时组件自己返回 null（不留破图），于是露出底下的图标牌兜底 ——
              所以这里是「插画优先、图标保底」，而不是二选一。 */}
          <View className='cve-mini__pic'>
            <Icon name={f.icon} size={30} tone='white' />
            <Illustration
              name={f.illustration}
              fill
              mode='aspectFill'
              className='cve-mini__illus'
            />
          </View>
          <Text className='cve-mini__title'>{f.title}</Text>
          <Text className='cve-mini__desc'>{f.desc}</Text>
        </View>
      ))}
    </View>
  )

  return (
    <View className={`cve ${themeClass}`}>
      <PageBackground />

      {/* ===== 页面头图：品牌插画横幅（始终可见，不受"有没有数据"影响）
          与「我的 / 家庭 / 宠物档案」三个主 tab 页保持同一套页头语言 ===== */}
      <PageHero illustration='page-creative' title='创作' subtitle='把和毛孩子的日子做成作品' />

      {/* ===== 🎨 创作（宽幅插画横幅卡） =====
          改造要点（2026-09-11）：
          ① 原来是 2 列小方块 + JSX 内联硬编码渐变，3 张卡高度参差、第 3 张孤零零占半行；
          ② 现改为整宽横幅，用品牌插画当背景（header-* 三张本就是「主体偏左、右侧留标题位」的构图）；
          ③ 插画/配色统一，不再有内联 style。 */}
      <View className='cve-sectitle'><View className='cve-sectitle__bar' /><Text className='cve-sectitle__text'>🎨 创作</Text></View>
      <View className='cve-feats'>
        {CREATIVE_FEATURES.map((f) => (
          <View
            key={f.key}
            className='cve-feat'
            hoverClass='cve-feat--hover'
            onClick={() => goWithPet(f.url, false)}
          >
            <Illustration name={f.illus} fill mode='aspectFill' className='cve-feat__bg' />
            {/* 右侧压一层由透明到暖白的渐变，保证叠在上面的文字始终清晰 */}
            <View className='cve-feat__scrim' />
            <View className='cve-feat__body'>
              <Text className='cve-feat__title'>{f.title}</Text>
              <Text className='cve-feat__desc'>{f.desc}</Text>
              <View className='cve-feat__tags'>
                {f.tags.map((t) => (
                  <Text key={t} className='cve-feat__tag'>{t}</Text>
                ))}
              </View>
              <Text className='cve-feat__price'>{f.price}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* ===== 📋 今日 ===== */}
      <View className='cve-sectitle'><View className='cve-sectitle__bar' /><Text className='cve-sectitle__text'>📋 今日</Text></View>

      {/* ===== 宠物切换器 + 宠物主卡：整块一起放在「今日」区 =====
          2026-09-11 从页面顶部整块移来。原因：这两块讲的都是"当前这只宠物今天怎么样"
          （切换器换宠物、主卡显示今日健康分与打卡状态），属"今日"内容；
          挂在「创作」页最顶上语义不对位（用户反馈「挪到今日下面 不然真的太奇怪了」+「这个怎么不挪」）。
          放在一起也符合交互：切换器是主卡的控制器，两者应当相邻。 */}
      {pets.length > 1 && (
        <PetSwitcher
          pets={pets}
          currentPetId={currentPet?.id || null}
          onSwitch={(id) => {
            setAvatarFailed(false)
            // 切换失败必须给反馈（2026-09-11 审查 P2-6）：原来是空 catch，
            // 用户点另一只宠物完全没反应，同时还冒一个未处理的 Promise rejection。
            switchPet(id).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : ''
              Taro.showToast({ title: msg || usePetStore.getState().error || '切换失败，请重试', icon: 'none' })
            })
          }}
        />
      )}

      {/* ===== 宠物主卡 =====
          保留它的整卡设计：头像带白环 + 名称/品种年龄/打卡状态 + 右侧健康分。 */}
      <View className='cve-hero'>
        <View className='cve-hero__avatar-wrap'>
          {avatarUrl && !avatarFailed ? (
            <Image
              className='cve-hero__avatar'
              src={avatarUrl}
              mode='aspectFill'
              lazyLoad
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <Text className='cve-hero__avatar-emoji'>{petEmoji}</Text>
          )}
        </View>

        <View className='cve-hero__info'>
          <Text className='cve-hero__name'>{petName}</Text>
          <Text className='cve-hero__sub'>
            {currentPet?.breed || (currentPet?.species === 'cat' ? '猫咪' : '狗狗')}
            {currentPet?.birthDate ? ` · ${formatPetAge(currentPet.birthDate)}` : ''}
          </Text>
          <View className='cve-hero__chip'>
            <Text className='cve-hero__chip-text'>
              {todayCheckin ? '✓ 今日已打卡' : '今日还没打卡'}
            </Text>
          </View>
        </View>

        {/* 2026-09-12 IA 第 2b 批：今日健康分改指并合后的健康趋势页（health-report 已并入） */}
        <View className='cve-hero__score' onClick={() => goWithPet('/pagesPet/trends/index')}>
          <Text className='cve-hero__score-label'>今日健康分</Text>
          <Text
            className={`cve-hero__score-value${healthScore !== null ? ' cve-hero__score-value--ok' : ''}`}
          >
            {healthScore !== null ? healthScore : '--'}
          </Text>
        </View>
      </View>

      {renderMiniGrid(TODAY_FEATURES)}

      {/* ===== ✨ 更多（原 tab 页功能收口 / 高频养宠工具） ===== */}
      <View className='cve-sectitle'><View className='cve-sectitle__bar' /><Text className='cve-sectitle__text'>✨ 更多</Text></View>
      {renderMiniGrid(MORE_FEATURES)}
    </View>
  )
}

export default CreativeHub
