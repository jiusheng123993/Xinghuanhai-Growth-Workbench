/**
 * 自定义 tabBar（微信小程序底部导航）
 *
 * 【这是什么】底部导航自绘组件。Taro 会把本目录原样编译到 `dist/custom-tab-bar/`，
 * 微信正是靠这个**固定目录名**去找自定义 tabBar 组件，所以它必须放在
 * `src/custom-tab-bar/` 下，不能挪进 `src/components/`。
 *
 * 【为什么必须自定义】`app.config.ts` 把 `tabBar.custom` 置为 true 后，微信不再渲染
 * 原生 tabBar —— 原因很直接：原生 tabBar 做不出「中间凸起的大圆按钮」。
 * 代价是 `Taro.setTabBarStyle` / `Taro.setTabBarItem` 全部失效（调了不报错、只是毫无效果），
 * 于是标签栏的底色、文字色、图标改由本组件按当前主题渲染，本文件里不许再出现这两个 API。
 *
 * 【5 个槽位怎么排】微信 tabBar 上限 5 项，形态取到上限：
 *
 *     今天 | 时光 | [团团] | 创作 | 我的
 *                     ↑ 中心凸起圆钮：AI 入口，**不是 tab 页**，不参与选中态
 *
 * 槽位总数 = TAB_BAR_TABS.length + 1（4 个 tab + 1 个中心按钮），中心按钮固定在
 * TAB_BAR_AI_SLOT（= 2，即第 3 个槽位）。这里不写死 4 或 5，以后增删 tab 只改常量。
 *
 * 【选中态为什么要靠事件】微信给**每个 tab 页各创建一个**自定义 tabBar 实例
 * （官方文档原话：每个 tab 页下的自定义 tabBar 组件实例是不同的），实例建好后**不会**
 * 随 switchTab 重新挂载，React 也不会因路由变化自动重渲染它 —— 所以「现在该高亮第几个」
 * 必须由 tab 页在 useDidShow 里广播进来（TAB_BAR_SELECT_EVENT），组件订阅后 setState。
 * 两条机制分工（缺一不可）：
 *   · 事件广播 = 常态通道：切回一个已存在的 tab 页时，它的实例状态靠这条纠正；
 *   · `resolveInitialSelected()` 路由兜底 = 兜住「某个 tab 页的实例刚被创建、而该页
 *     useDidShow 早于本组件挂载」那一次竞态 —— 少了它，第一次点进某个 tab 可能高亮错位。
 * 主题同理走 themeChange 广播（本仓库硬约定：Taro3 + zustand v3 的 selector 订阅
 * 在页面/组件里不可靠，一律用事件广播 + 本地 state）。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import {
  TAB_BAR_TABS,
  TAB_BAR_AI_SLOT,
  TAB_BAR_AI_PATH,
  TAB_BAR_AI_TEXT,
  TAB_BAR_SELECT_EVENT,
  tabIndexByPath,
} from '../constants/tabBar'
import { useThemeStore, getThemeMeta, getTabBarIconDir } from '../stores/themeStore'
import type { ThemeKey } from '../stores/themeStore'
// 中心圆钮的头像：复用「首页 AI 管家」的同一份品牌资产（2026-09-12 起为真 .jpg），不新增图片
import aiManager from '../assets/ai-avatar/ai-manager.jpg'
import './index.scss'

/** 拿不到路由时的兜底下标：按第一个 tab 高亮（宁可高亮错一个，也不要 5 个全灭） */
const FALLBACK_SELECTED = 0

/**
 * 读当前页面路由，换算成「第几个 tab」
 *
 * 【为什么处处防御】① 自定义 tabBar 组件首次挂载时，路由可能尚未就绪；
 * ② 单测环境（jsdom）里 Taro.getCurrentInstance 根本不存在，不判空会直接抛错。
 * 所以这里用可选调用 + try/catch + 非法值一律退回 0。
 *
 * @returns 0..TAB_BAR_TABS.length-1；不属于 tab 页或拿不到路由时返回 FALLBACK_SELECTED
 */
function resolveInitialSelected(): number {
  try {
    // Taro 的 router.path **带**前导斜杠（'pages/index/index'；见 @tarojs/runtime 的 addLeadingSlash）。
    // tabIndexByPath 两种写法都认，这里保持防御式、不依赖该细节（独立审查纠正过这处注释）。
    const path = Taro.getCurrentInstance?.()?.router?.path
    const index = path ? tabIndexByPath(path) : -1
    return index >= 0 ? index : FALLBACK_SELECTED
  } catch {
    return FALLBACK_SELECTED
  }
}

/**
 * 把主题里的 6 位 hex 颜色转成带透明度的 rgba() 字符串
 *
 * 【为什么要自己转】中心圆钮的投影要跟着主题色走（暖橙 / 嫩绿 / 海蓝 / 冰紫 / 暖金…），
 * 但主题表里存的是不透明 hex，投影若用实色会像一块脏斑，必须带 alpha。
 * 另外小程序 WXSS 不支持 `rgba(var(--x), α)` 这种写法，颜色只能落成字面量 rgba()，
 * 所以换算放在这里做。非法色值原样返回：宁可投影不随主题，也不能让整条样式失效。
 *
 * @param hex 形如 '#FF6B3D' 的主题色
 * @param alpha 透明度 0~1
 * @returns 形如 'rgba(255,107,61,0.32)'
 */
function hexToRgba(hex: string, alpha: number): string {
  const matched = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!matched) return hex
  const value = parseInt(matched[1], 16)
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`
}

/**
 * 无障碍标注：给 View 补一个 `aria-label`
 *
 * 【为什么不能直接写 aria-label={...}】Taro 3.6 的 ViewProps 只声明了驼峰版
 * `ariaLabel`（且类型注释标注仅 QQ 端支持），直接写 kebab 形式会 TS 报错；这里用
 * 「小函数 + 展开语法」把 kebab 形式的 `aria-label` 透传下去。
 *
 * ⚠️ **实测结论：微信端确定不生效，这里是"有比没有好"的等价物而已**（2026-09-12 独立审查复核）：
 * 产物 `dist/base.wxml`（68KB）里 `aria` 子串出现 **0 次**，所有 `view`/`image` 模板只绑
 * `hover-* / style / class / id / data-sid`，Taro 的 weapp 平台插件对 `ariaLabel|aria-label`
 * 也是 0 命中 —— 也就是微信端不会产出这个属性。保留它的原因：H5 端（`build:h5`）会落到真实
 * DOM 上、成本为零；同时它是本组件**唯一的无障碍意图标记**，删掉就等于连意图都不留。
 * 结论：**不要以为它提供了微信端无障碍支持** —— tabBar 的读屏可用性目前是空的，
 * 要真正支持得另找方案（自定义组件外层包原生可聚焦元素等），属后续批次决策。
 *
 * @param label 读屏要播报的文案（tab 文案 / 中心按钮文案）
 * @returns 可直接展开到 View 上的属性对象
 */
function ariaLabelProps(label: string): Record<string, string> {
  return { 'aria-label': label }
}

/**
 * 自定义 tabBar 组件
 */
export default function CustomTabBar() {
  // 当前主题：初值取 store 现值，之后由 themeChange 广播推进来（不用 zustand selector）
  const [theme, setTheme] = useState<ThemeKey>(() => useThemeStore.getState().current)
  // 选中态：初值按当前路由反查；组件实例被复用（switchTab 不重挂载）时靠事件纠正
  const [selected, setSelected] = useState<number>(resolveInitialSelected)

  /** 订阅主题变化：换主题后图标目录、文字色、底色都要跟着换 */
  useEffect(() => {
    const onThemeChange = (next: ThemeKey) => setTheme(next)
    Taro.eventCenter.on('themeChange', onThemeChange)
    // 卸载时必须解绑：否则旧实例会一直挂在事件中心（内存泄漏，且旧 handler 会继续收事件）
    return () => {
      Taro.eventCenter.off('themeChange', onThemeChange)
    }
  }, [])

  /** 订阅「当前选中第几个 tab」的广播（tab 页 useDidShow 时发出） */
  useEffect(() => {
    const onTabBarSelect = (index: number) => {
      // 只接受合法下标：负数表示该页面不属于 tabBar，此时保持原高亮更合理
      if (typeof index === 'number' && index >= 0) setSelected(index)
    }
    Taro.eventCenter.on(TAB_BAR_SELECT_EVENT, onTabBarSelect)
    return () => {
      Taro.eventCenter.off(TAB_BAR_SELECT_EVENT, onTabBarSelect)
    }
  }, [])

  const meta = getThemeMeta(theme)
  const iconDir = getTabBarIconDir(theme)

  /**
   * 整条 bar 的内联样式
   * 底色与分隔线颜色都取自主题；SCSS 里只留结构（分隔线宽度固定 1rpx）。
   * tabBarBorderStyle 取 'white'（浅色主题）→ 极浅的深色细线；
   * 取 'black'（星空银河这类深色主题）→ 浅白细线，否则深底上根本看不出分隔。
   * 上投影强度看 meta.dark：浅色底用轻投影就够，深色底必须加重，
   * 否则导航条与深色内容糊成一片（dark 字段在本组件里就用于这一处）。
   */
  const barStyle = {
    backgroundColor: meta.tabBarBg,
    borderTopColor: meta.tabBarBorderStyle === 'white' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.14)',
    boxShadow: meta.dark ? '0 -2rpx 18rpx rgba(0, 0, 0, 0.45)' : '0 -2rpx 12rpx rgba(0, 0, 0, 0.06)',
  }

  /**
   * 中心圆钮的内联样式
   * 外环用「金色 → 主题主色」的渐变（色值全部来自 ThemeMeta 的 palette.gold / primaryColor），
   * 投影用主色加透明度，保证任何主题下都是暖色发光、而不是脏灰块。
   * 白色描边与按下缩放属于结构/动效，放在 SCSS 里。
   */
  const aiStyle = {
    backgroundImage: `linear-gradient(135deg, ${meta.palette.gold} 0%, ${meta.primaryColor} 100%)`,
    boxShadow: `0 6rpx 18rpx ${hexToRgba(meta.primaryColor, 0.32)}`,
  }

  /**
   * 点击某个 tab
   *
   * 【先 setSelected 再跳转】点击立刻给本页实例一个反馈（成本一行）。
   *
   * ⚠️ 别把它当成"防高亮闪烁"的关键 —— 微信给**每个 tab 页各建一个**实例，
   * 切页后可见的是**目标页那个实例**，它的高亮由「目标页 useDidShow 广播」+「挂载时路由兜底」
   * 决定，与本实例无关（独立审查纠正了原先"乐观更新防闪烁"的说法）。
   * switchTab 返回 rejected promise 是跨端常态，故必须 catch 兜住，避免 unhandled rejection。
   *
   * @param index tab 下标（0..TAB_BAR_TABS.length-1）
   */
  function handleTabClick(index: number) {
    setSelected(index)
    Taro.switchTab({ url: TAB_BAR_TABS[index].pagePath }).catch(() => {})
  }

  /**
   * 点击中心「团团」圆钮
   *
   * AI 对话目前仍在首页（首页是 tab 页，走 switchTab）；第 4 批「团团全屏态」上线后
   * TAB_BAR_AI_PATH 会改指一个**非 tab 页**，那时必须走 navigateTo ——
   * switchTab 只能跳 tab 页，跳别的页面会静默失败（不报错、页面不动）。
   * 所以这里按「是不是 tab 页」自动分支，改路径时组件不用动。
   */
  function handleAiClick() {
    const aiIndex = tabIndexByPath(TAB_BAR_AI_PATH)
    if (aiIndex >= 0) {
      Taro.switchTab({ url: TAB_BAR_AI_PATH }).catch(() => {})
    } else {
      Taro.navigateTo({ url: TAB_BAR_AI_PATH }).catch(() => {})
    }
  }

  /**
   * 生成 5 个槽位
   *
   * 槽位总数 = tab 数 + 1（中心按钮占一格）；非中心槽位按序号映射回 tab：
   * 中心槽位之前的原样对应，之后的整体后移一位（因为中间的 AI 按钮占掉了一个格）。
   */
  const slots: ReactNode[] = []
  const totalSlots = TAB_BAR_TABS.length + 1
  for (let slot = 0; slot < totalSlots; slot += 1) {
    if (slot === TAB_BAR_AI_SLOT) {
      slots.push(
        <View key='ai' className='custom-tab-bar__slot custom-tab-bar__slot--ai'>
          <View
            className='custom-tab-bar__ai'
            style={aiStyle}
            // 按下反馈用 weapp 的 hover-class（:active 在小程序里不稳），时长 <=150ms 才跟手
            hoverClass='custom-tab-bar__ai--press'
            hoverStartTime={0}
            hoverStayTime={120}
            onClick={handleAiClick}
            {...ariaLabelProps(TAB_BAR_AI_TEXT)}
          >
            <Image className='custom-tab-bar__ai-avatar' src={aiManager} mode='aspectFit' />
          </View>
        </View>,
      )
      continue
    }

    const tabIndex = slot < TAB_BAR_AI_SLOT ? slot : slot - 1
    const tab = TAB_BAR_TABS[tabIndex]
    const active = tabIndex === selected
    slots.push(
      <View
        key={tab.pagePath}
        className={`custom-tab-bar__slot${active ? ' custom-tab-bar__slot--active' : ''}`}
        onClick={() => handleTabClick(tabIndex)}
        {...ariaLabelProps(tab.text)}
      >
        {/* 选中态靠换图片文件（-active 后缀）实现，不加 CSS 滤镜：滤镜在低端机上有色差。
            选中弹跳走 `custom-tab-bar__icon--active`，**必须定义在组件自己的 scss 里**，两条实测原因：
              ① 全局 `app.wxss` 的**类**选择器对自定义组件不生效（Taro 只给内部 recursive 组件补
                 `addGlobalClass`，用户组件没有）—— 产物里 `custom-tab-bar/index.wxss` 不含任何全局类；
              ② `data-*` 属性不会落进 wxml（image 模板属性是闭集，产物里只有 `data-sid`），
                 所以 `[data-active='true']` 这种选择器永远匹配不到。
            ⚠️ 由此得一条教训：`app.scss` 里那两条 `.xhh-tab-bounce` / `.xhh-tab-ripple` 全局规则
            在微信端**本来就是死代码**，不要再当成"项目既有动效可直接复用"（本次实测确认，
            已改为组件内自绘；那两条全局规则的清理留给后续批次）。 */}
        <Image
          className={`custom-tab-bar__icon${active ? ' custom-tab-bar__icon--active' : ''}`}
          src={`${iconDir}/${tab.icon}${active ? '-active' : ''}.png`}
          mode='aspectFit'
        />
        <Text
          className='custom-tab-bar__label'
          style={{ color: active ? meta.tabBarSelectedColor : meta.tabBarColor }}
        >
          {tab.text}
        </Text>
      </View>,
    )
  }

  return (
    <View className='custom-tab-bar' style={barStyle}>
      {slots}
    </View>
  )
}
