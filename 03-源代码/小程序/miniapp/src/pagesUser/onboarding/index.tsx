/**
 * 新手引导页（按高保真 v2 重做 · 2026-09-12）
 *
 * 【为什么整页重写】旧实现讲的是「3 秒健康打卡 / 食物安全查询 / AI 症状初筛」，
 * 其中**食物查询与症状初筛正是新 IA 要收拢进「团团」的 AI 入口** ——
 * 把它们摆在新手引导里，等于跟 IA 方向对撞（用户第一眼看到的和产品结构是反的）。
 * 高保真 v2 的三屏讲的是另一件事：① 品牌 → ② 你能用它做哪三件事 → ③ 加上第一只宠物。
 *
 * 【参照物】整屏截图 `10/11/12-onboarding-*.png` + 原型 `原型-v2/index.html` 的 screenOnboarding()。
 *
 * 【为什么是「单页 3 步」而不是 3 个页面】
 * 原型里确实是 onboarding1/2/3 三个路由，但原型注释自己写着
 * 「这是**首次启动的流程页（L3）**，不是 tab 页、也不该占一个常驻路由」——
 * 即原型那 3 个路由是**给静态预览切换用的**，不是产品结构。
 * 落到小程序里，拆 3 个页面必须往 `app.config.ts` 的 pagesUser 分包注册 3 条路由，
 * 而 app.config.ts 是共用文件（本批硬约束禁止改），且会多占 2 条路由体积。
 * 所以本页用**单页 3 步**：一个路由、一个 storage 标记、一套返回/跳转语义，
 * 「登录 → 引导 → 首页」这条链的入口/出口都不变。
 *
 * 【链路约束】本页是 `pagesUser/onboarding/index`，登录/绑定资料完成后由
 * `utils/onboardingGate.goAfterAuthEntry()` 进入（那也维护"标记 key + 是否首次"的唯一真相源）；
 * 完成/跳过都写同一个标记并保证能回首页（switchTab），不改 app/authStore/routeGuard。
 *
 * 【文案口径（与 IA 对齐，勿回退）】AI 能力（食物查询 / 症状初筛 / 附近医院）
 * 一律属于「团团」，**不出现在新手引导里**；这里的三件事见下方 THINGS。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageBackground from '../../components/PageBackground'
import Illustration from '../../components/Illustration'
import Icon, { type IconName } from '../../components/Icon'
import { useAnalytics } from '../../hooks/useAnalytics'
import { useThemeClass } from '../../hooks/useThemeClass'
// 出口地址与"写完成标记"这两个动作统一来自 utils/onboardingGate（该文件同时维护
// ONBOARDING_DONE_KEY 这个唯一 key，并在测试里钉死它仍是历史字面量 'onboarding_completed'）；
// 本页不再自己定义 key 字面量 —— 各写一份迟早会出现"引导页写了、判定页读不到 → 老用户被反复引导"
import { HOME_URL, markOnboardingCompleted } from '../../utils/onboardingGate'
import './index.scss'

/** 总步数（= v2 的三屏） */
const STEP_COUNT = 3

/** 三屏各自的埋点标识（与 v2 的 10/11/12-onboarding-*.png 一一对应） */
const STEP_KEYS = ['brand', 'things', 'pet'] as const

/** 添加第一只宠物的落点（v2 第 3 屏主 CTA 的去处） */
const ADD_PET_URL = '/pagesPet/add/index'

/**
 * 第 2 屏「三件事」的卡片数据
 *
 * 三条的取舍依据（对齐 IA，改文案前先读一遍）：
 *  ① 打卡是「今天页」的主体动作；
 *  ② 「有问题就问团团」把**全部 AI 能力**（食物查询 / 症状初筛 / 附近医院 / 记忆问答）
 *     收在一个入口里 —— 所以这里只写「问团团」，不单独列任何一个 AI 子功能；
 *  ③ 回忆录是这个产品的内核（用户为「留一本回忆」而来），必须出现在第一屏教育里。
 *
 * tone 对应 _theme.scss 的主题色板（不写死 hex，深色主题下也不会脱节）：
 *  a = 主色淡调底 + 主色图标 / c = 海盐蓝调底 + teal 图标 / d = 暖金调底 + 深金图标
 */
interface ThingItem {
  key: string
  /** 图标名（Phosphor 面性，见 components/icons-fill.ts） */
  icon: IconName
  /** 图标底色档位 */
  tone: 'a' | 'c' | 'd'
  /** 卡片主标题 */
  title: string
  /** 卡片副文案 */
  desc: string
}

const THINGS: ThingItem[] = [
  {
    key: 'checkin',
    icon: 'paw-print',
    tone: 'a',
    title: '3 秒健康打卡',
    desc: '食欲 · 便便 · 精神 · 呕吐，异常自动标出来',
  },
  {
    key: 'yuantuan',
    icon: 'brain',
    tone: 'c',
    title: '有问题就问团团',
    desc: '它记得这只宠物的全部档案，随时点底部中间的按钮',
  },
  {
    key: 'memoir',
    icon: 'film-strip',
    tone: 'd',
    title: '把记录变成回忆录',
    desc: '攒下的照片，一键做成一支属于它的片子',
  },
]

/**
 * 每一步底部主按钮的内容（v2 三屏各一套）
 * 结构与 v2 的 `.cta` 一致：左图标 + 主标题/副文案 + 右侧胶囊动作字。
 */
interface CtaConfig {
  icon: IconName
  title: string
  sub: string
  /** 右侧胶囊里的小字（第 3 屏是「开始」） */
  go: string
}

const CTAS: CtaConfig[] = [
  { icon: 'paw-print', title: '开始了解', sub: '看看它能帮你做什么', go: '下一步' },
  { icon: 'sparkle', title: '我知道了', sub: '最后一步：加上你的宠物', go: '下一步' },
  { icon: 'plus', title: '添加我的宠物', sub: '大约需要 30 秒', go: '开始' },
]

/**
 * 右上角弱化按钮的文案
 * v2：前两屏是「跳过」，最后一屏语义变成「先逛逛」（此时再叫跳过就说不通了 ——
 * 用户已经看完引导，只是暂时不想添加宠物）。
 */
const SKIP_LABEL = ['跳过', '跳过', '先逛逛'] as const

/**
 * 第 3 屏白色选项卡片的两个入口
 * 两行都落到 `pagesPet/add/index`（该页同时提供「拍照识别品种」与完整手填表单）；
 * 这里不传 mode 参数 —— 添加页没有对应的入参，传了也不会被消费，属于自欺欺人。
 */
const PET_ENTRIES: Array<{ key: string; icon: IconName; tone: 'a' | 'c'; label: string }> = [
  { key: 'photo', icon: 'camera', tone: 'a', label: '拍一张照片 AI 识品种' },
  { key: 'manual', icon: 'note-pencil', tone: 'c', label: '手动填写' },
]

// ============================================
// 自定义导航栏的「胶囊避让」（2026-09-12 修）
// ============================================
/**
 * 【为什么这个页面必须自己做避让】
 * `index.config.ts` 里是 `navigationStyle: 'custom'` —— 页面**从屏幕最顶端开始渲染**，
 * 没有原生导航栏把「状态栏 + 右上角胶囊（••• ⊙）」那一条占掉。
 * 而微信胶囊是**固定悬浮在右上角、画在页面内容之上**的一层：页面内容不会自动让位，
 * 谁先占了那一块谁就被压住。
 *
 * 【不避让会怎样（真机实测到的缺陷）】
 * 顶部若按「从 0 开始」排版，右上角那颗「跳过」正好落进状态栏/胶囊那一条里，
 * 真机上被盖住 —— 新用户第一眼既看不清、也不容易点到。所以顶部内容必须自己让开。
 *
 * 【怎么算】`Taro.getMenuButtonBoundingClientRect()` 给出胶囊的真实矩形，
 * 取它的 `bottom` 作为内容起点（本页把它作为 `.onb-topbar` 的 padding-top，
 * 也就是整块顶部区域的起点）。
 * ⚠️ 该 API 的返回值单位是 **px**（不是 rpx）：内联 style 里直接写 px；
 * 当 rpx 用会被 750 设计稿换算放大一倍，顶部白空一大块。
 */
/** 内容起点与胶囊底边之间留的呼吸位（px）：贴得够近，又不会视觉粘连 */
const CAPSULE_GAP_PX = 8

/**
 * 取不到胶囊位置时的兜底内容起点（px）
 *
 * 88 不是随手拍的数，是按最坏情况推出来的：
 * iPhone 全面屏状态栏高 44px，微信胶囊距状态栏底 4px、自身高 32px
 * → 胶囊底边 ≈ 44 + 4 + 32 = 80px，再加 8px 呼吸位 = 88px。
 * 所以兜底值本身就满足「在 iPhone 上也不压胶囊」，且比任何一台真机的胶囊底边都低
 * （非全面屏机型状态栏更矮，只会更安全）。
 */
const FALLBACK_CONTENT_TOP_PX = 88

/**
 * 计算顶部内容的安全起点（px）
 *
 * 正常路径：胶囊底边 + 8px；异常路径（老基础库没这个 API、H5 端、
 * 或返回了 bottom ≤ 0 的无效矩形）一律回落到兜底值 88px。
 * 全程 try/catch：**取失败绝不能让引导页白屏** —— 这是新用户看到的第一屏，
 * 宁可顶部多留一点空间，也不能崩。
 *
 * @returns 内容起点的像素值，已含呼吸位，可直接当 padding-top 用
 */
function resolveContentTopPx(): number {
  try {
    // 老基础库 / 非微信端可能压根没挂这个 API，先判存在再调用
    if (typeof Taro.getMenuButtonBoundingClientRect === 'function') {
      const rect = Taro.getMenuButtonBoundingClientRect()
      // bottom ≤ 0（或字段缺失）说明拿到的是无效矩形：不能拿它当起点，否则顶部会贴回屏幕上沿、又被压住
      if (rect && typeof rect.bottom === 'number' && rect.bottom > 0) {
        return rect.bottom + CAPSULE_GAP_PX
      }
    }
  } catch {
    // 静默降级：胶囊信息取不到只影响顶部留白，不影响三屏内容与出口跳转
  }
  return FALLBACK_CONTENT_TOP_PX
}

export default function OnboardingPage() {
  /** 当前步（0 基） */
  const [step, setStep] = useState(0)
  const { trackPageView, trackEvent } = useAnalytics()
  const themeClass = useThemeClass()

  // 顶部内容起点（px）：只在挂载时算一次 —— 一屏之内胶囊位置不会变，
  // 没必要每次渲染都过一次原生 API（小程序里这是跨线程序列化调用，能省则省）
  const contentTopPx = useMemo(() => resolveContentTopPx(), [])

  // 进来只上报一次页面浏览。
  // trackPageView 每次渲染都是新函数引用，所以这里刻意不把它放进依赖（否则每渲染一次就上报一次）。
  useEffect(() => {
    trackPageView('onboarding')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 每一步都上报一次浏览，用于看漏斗在第几步流失
  useEffect(() => {
    trackEvent('onboarding_step_view', { step: step + 1, stepKey: STEP_KEYS[step] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  /**
   * 记住"引导已完成"
   * 完成与跳过都要写：否则用户下次进来又会被重新引导一遍。
   * 写 storage 的动作统一走 utils/onboardingGate.markOnboardingCompleted()
   * （那里带 try/catch：storage 在各端行为不同，写失败不能中断引导出口的跳转）。
   */
  const markDone = useCallback(() => {
    markOnboardingCompleted()
  }, [])

  /** 底部主按钮：前两屏翻页，最后一屏进「添加宠物」 */
  const handlePrimary = useCallback(() => {
    if (step < STEP_COUNT - 1) {
      setStep(step + 1)
      return
    }
    markDone()
    trackEvent('onboarding_complete')
    // 用 navigateTo（不是 redirectTo）：添加完宠物后用户可能想返回引导页再看一眼，
    // 且添加页顶部有返回键，留一层栈比直接替换掉更符合预期
    Taro.navigateTo({ url: ADD_PET_URL })
  }, [step, markDone, trackEvent])

  /**
   * 跳过 / 先逛逛
   * 老实现就是 switchTab 回首页，这里保持同一出口，确保「引导 → 首页」断不了。
   */
  const handleSkip = useCallback(() => {
    markDone()
    trackEvent('onboarding_skip', { step: step + 1 })
    Taro.switchTab({ url: HOME_URL })
  }, [step, markDone, trackEvent])

  /**
   * 上一步（第 2 屏起才出现，第 1 屏没有"上一步"可退）
   *
   * 【为什么 v2 没有这一颗也要加】三屏是单页状态机，**系统返回键在这个页面等于退出小程序**，
   * 用户想回看上一屏就没有任何出路（v2 是静态预览，三屏各是一个地址，没暴露这个缺口）。
   * 所以补一颗弱化按钮，样式与右上角「跳过」同源，放在左上角与它对称，不抢主 CTA 的注意力。
   */
  const handleBack = useCallback(() => {
    if (step === 0) return
    trackEvent('onboarding_step_back', { from: step + 1 })
    setStep(step - 1)
  }, [step, trackEvent])

  /** 第 3 屏两个入口：与主 CTA 同一去向，单独埋点以便看用户偏好哪种填法 */
  const handlePetEntry = useCallback(
    (source: string) => {
      markDone()
      trackEvent('onboarding_complete', { entry: source })
      Taro.navigateTo({ url: ADD_PET_URL })
    },
    [markDone, trackEvent]
  )

  const cta = CTAS[step]

  return (
    <ScrollView className={`onboarding-page ${themeClass}`} scrollY>
      {/* 全屏主题背景（渐变 + 光斑/星点/格纹），fixed 定位，滚动时不跟着走 */}
      <PageBackground />

      <View className='onboarding-page__inner'>
        {/* ===== 顶部：左上「上一步」+ 右上「跳过/先逛逛」（切步时位置不变，只有文案变） =====
            自定义导航栏没有原生标题栏占位，所以这一行自己让开胶囊：
            paddingTop 由 resolveContentTopPx() 给出（胶囊底边 + 8px，异常时兜底 88px），单位 px。
            下一行的品牌名「星河宠记」在这一行之下居中，跟着整体下移但**保持水平居中** ——
            与胶囊是「垂直错开」的关系，不做左右方向的偏移（往左挤才会把它挪歪）。 */}
        <View className='onb-topbar' style={{ paddingTop: `${contentTopPx}px` }}>
          {step > 0 ? (
            <View className='onb-topbar__hit' onClick={handleBack}>
              <Text className='onb-topbar__label'>上一步</Text>
            </View>
          ) : (
            /* 第 1 屏留一个等宽空位，保证「跳过」在三屏里都停在同一个位置 */
            <View className='onb-topbar__hit' />
          )}
          <View className='onb-topbar__hit' onClick={handleSkip}>
            <Text className='onb-topbar__label'>{SKIP_LABEL[step]}</Text>
          </View>
        </View>

        {/* ===== 第 1 屏：认识品牌 =====
            三屏各自带一个不同的 key → 切步时 React 视为不同元素，整块重新挂载，
            .onb-step 上的入场动画随之重放（同一步内重渲染不会重放，不会闪） */}
        {step === 0 && (
          <View className='onb-step' key='step-brand'>
            <View className='onb-brand'>
              <Text className='onb-brand__name'>星河宠记</Text>
              <Text className='onb-brand__sub'>AI 宠物管家 · 懂 TA 的一生</Text>
            </View>

            {/* 品牌画布：v2 用的是 today-brand（= 本仓 data/illustrations.ts 的 page-home 槽位）。
                源图是 1254×1254 正方形，所以画框也做成正方形并用 aspectFill —— 零裁切、零留白。 */}
            <View className='onb-art onb-art--brand'>
              <Illustration name='page-home' fill mode='aspectFill' className='onb-art__img' />
            </View>

            <View className='onb-copy'>
              {/* <Text> 里的 \n 不换行（本仓实测过的坑），所以逐行拆成独立 Text */}
              <Text className='onb-copy__lead'>它的可爱</Text>
              <Text className='onb-copy__lead'>要一颗一颗收进星河里</Text>
              <Text className='onb-copy__sub onb-copy__sub--gap'>每天 3 秒记一笔，</Text>
              <Text className='onb-copy__sub'>时间会替你攒成一部回忆录</Text>
            </View>

            <View className='onb-grow' />
          </View>
        )}

        {/* ===== 第 2 屏：你能用它做哪三件事 ===== */}
        {step === 1 && (
          <View className='onb-step' key='step-things'>
            <View className='onb-grow' />

            <View className='onb-head'>
              <Text className='onb-head__line'>三件事，</Text>
              <Text className='onb-head__line'>就能陪它过好每一天</Text>
            </View>

            <View className='onb-tiles'>
              {THINGS.map((t) => (
                <View className='onb-tile' key={t.key}>
                  <View className={`onb-tile__icon onb-tile__icon--${t.tone}`}>
                    <Icon name={t.icon} size={22} tone={t.tone === 'a' ? 'primary' : t.tone === 'c' ? 'teal' : 'gold-deep'} />
                  </View>
                  <View className='onb-tile__body'>
                    <Text className='onb-tile__title'>{t.title}</Text>
                    <Text className='onb-tile__desc'>{t.desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View className='onb-grow' />
          </View>
        )}

        {/* ===== 第 3 屏：加上第一只宠物 ===== */}
        {step === 2 && (
          <View className='onb-step' key='step-pet'>
            {/* 画框刻意比第 1 屏小且居中：源图同样是正方形，缩小方形画框可以做到
                不裁切、也不留白；v2 那张 1.57:1 的宽幅画框是拿方图硬铺出来的，
                按 1.57 裁会切掉狗头顶和笔记本下半部（已用看图工具核实过构图）。 */}
            <View className='onb-art onb-art--pet'>
              <Illustration name='page-pet-profile' fill mode='aspectFill' className='onb-art__img' />
            </View>

            <View className='onb-copy'>
              <Text className='onb-copy__title'>先告诉我，它是谁？</Text>
              <Text className='onb-copy__sub onb-copy__sub--gap'>品种、生日、一张照片就够了。</Text>
              <Text className='onb-copy__sub'>剩下的团团会慢慢替你记住。</Text>
            </View>

            <View className='onb-menu'>
              {PET_ENTRIES.map((e) => (
                <View className='onb-menu__row' key={e.key} onClick={() => handlePetEntry(e.key)}>
                  <View className={`onb-menu__icon onb-menu__icon--${e.tone}`}>
                    <Icon name={e.icon} size={15} tone={e.tone === 'a' ? 'primary' : 'teal'} />
                  </View>
                  <Text className='onb-menu__label'>{e.label}</Text>
                  <Icon name='caret-right' size={15} tone='muted' className='onb-menu__chev' />
                </View>
              ))}
            </View>

            <View className='onb-grow' />
          </View>
        )}

        {/* ===== 底部：步骤点 + 主按钮（+ 第 3 屏尾注） ===== */}
        <View className='onb-bottom'>
          <View className='onb-dots'>
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <View key={i} className={`onb-dots__dot ${i === step ? 'onb-dots__dot--on' : ''}`} />
            ))}
          </View>

          <View className='onb-cta' onClick={handlePrimary}>
            <View className='onb-cta__ico'>
              <Icon name={cta.icon} size={22} tone='white' />
            </View>
            <View className='onb-cta__txt'>
              <Text className='onb-cta__title'>{cta.title}</Text>
              <Text className='onb-cta__sub'>{cta.sub}</Text>
            </View>
            <Text className='onb-cta__go'>{cta.go}</Text>
          </View>

          {/* v2 原句是「我们会先给你一份『新手任务』，做完就有第一枚成就」——
              本仓两处都不成立：NewbieTaskCard 组件虽然存在但**没有任何页面渲染它**，
              成就体系（achievementService）里也没有「加宠物 / 完成任务」这一类成就。
              承诺一个不存在的权益违反硬约束，所以换成一句真实且有用的话。 */}
          {step === STEP_COUNT - 1 && (
            <Text className='onb-footnote'>品种和生日之后都能在「宠物档案」里改</Text>
          )}
        </View>
      </View>
    </ScrollView>
  )
}
