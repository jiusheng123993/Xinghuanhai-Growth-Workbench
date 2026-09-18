/**
 * 底部导航（自定义 tabBar）的唯一配置源
 *
 * 【为什么单独抽一个文件】
 * tab 的顺序、路由、图标名原本散在三处：`app.config.ts` 的 `tabBar.list`、
 * `stores/themeStore.ts` 的 `TAB_BAR_ICON_NAMES`、以及各 tab 页面里硬编码的下标。
 * 三处一旦漂移，症状是「点第 3 个 tab 却高亮了第 4 个」这类只有真机能看出来的错位。
 * 现在统一到这里，并由 `src/constants/__tests__/tabBar.test.ts` 断言它与
 * `app.config.ts` 的 `tabBar.list` 严格一致（顺序、数量、文案都不许漂）。
 *
 * 【视觉形态：4 tab + 1 中心按钮】
 * 共 5 个视觉槽位：`今天 | 时光 | [团团] | 创作 | 我的`
 *  · 微信 tabBar 上限 5 项，「4 tab + 中心 AI 按钮」已是能塞进上限的极限形态；
 *  · 中间的「团团」**不是 tab 页**（微信 `tabBar.list` 只能放页面路径），
 *    它是自定义 tabBar 组件里自绘的凸起圆钮，这也是必须开 `custom: true` 的根本原因
 *    ——原生 tabBar 做不出中间凸起。
 */
import Taro, { useDidShow } from '@tarojs/taro'

/**
 * tab 页路由的字面量联合类型
 *
 * 【为什么不用 string】`:TabBarPagePath` 让「传错页面路径」在编译期就报错，
 * 而不是等到真机上点了没反应才发现（tabBar 页面写错路径不会抛异常，只会静默不动）。
 */
export type TabBarPagePath =
  | '/pages/index/index'
  | '/pages/timeline/index'
  | '/pages/creative/index'
  | '/pages/mine/index'

/** 单个 tab 的静态配置 */
export interface TabBarTab {
  /** 页面绝对路径（`Taro.switchTab` 用，必须与 app.config.ts 的 pagePath 一致） */
  pagePath: TabBarPagePath
  /** tab 文案（必须与 app.config.ts 的 text 一致） */
  text: string
  /** 图标文件名前缀：对应 `assets/icons[/tabbar/<主题>]/<icon>[-active].png` */
  icon: string
}

/**
 * 4 个 tab，顺序 = 从左到右（不含中心 AI 按钮）
 *
 * 顺序取自《星河宠记-信息架构重做方案v1》定稿的「今天·时光｜团团｜创作·我的」。
 */
export const TAB_BAR_TABS: readonly TabBarTab[] = [
  { pagePath: '/pages/index/index', text: '今天', icon: 'home' },
  { pagePath: '/pages/timeline/index', text: '时光', icon: 'timeline' },
  { pagePath: '/pages/creative/index', text: '创作', icon: 'creative' },
  { pagePath: '/pages/mine/index', text: '我的', icon: 'mine' },
]

/** 中心「团团」AI 按钮在 5 个视觉槽位里的下标（0 起）＝第 3 个槽位 */
export const TAB_BAR_AI_SLOT = 2

/**
 * 中心 AI 按钮指向的页面
 *
 * 【2026-09-12 IA 第 4 批已改指团团全屏页】此前指向 `/pages/index/index`（AI 对话当时挂在首页 tab）。
 * 现在 AI 对话整体搬到 `pagesYuantuan/agent`，中心按钮 `navigateTo` 打开它 —— 这也是「团团 = 全站
 * AI 能力唯一入口」这条 IA 口径的落点。**它不再是 tab 页**，所以组件会走 navigateTo 分支
 * （`custom-tab-bar/index.tsx` 按「是不是 tab 页」自动选 API，改路径不用改组件）。
 */
export const TAB_BAR_AI_PATH = '/pagesYuantuan/agent/index'

/** 中心 AI 按钮的文案（给读屏/hover 提示用；注意微信端 `aria-label` 实测不生效，见组件内说明） */
export const TAB_BAR_AI_TEXT = '团团'

/** 选中态广播事件名：tab 页 useDidShow 里发，自定义 tabBar 组件订阅 */
export const TAB_BAR_SELECT_EVENT = 'tabBarSelect'

/**
 * 由路由路径反查 tab 下标
 *
 * @param path 形如 `/pages/index/index` 或 `pages/index/index` —— Taro 的 `router.path` **带**前导
 *   斜杠（见 @tarojs/runtime 的 addLeadingSlash，独立审查纠正过这里的旧注释），这里两种都兼容
 * @returns `0..TAB_BAR_TABS.length-1`；不属于 tab 页时返回 `-1`
 */
export function tabIndexByPath(path: string): number {
  if (!path) return -1
  const normalized = path.startsWith('/') ? path : `/${path}`
  return TAB_BAR_TABS.findIndex(t => t.pagePath === normalized)
}

/**
 * 广播「当前选中的是第几个 tab」
 *
 * 【为什么必须用事件，而不是让组件自己算】
 * 微信会给**每个 tab 页各建一个**自定义 tabBar 实例（官方文档：每个 tab 页下的自定义
 * tabBar 组件实例是不同的），实例一旦建好就不随 `switchTab` 重新挂载，React 也不会因为
 * 路由变化自动重渲染它 —— 所以选中态必须由外部推进来。
 * 这里沿用 `themeStore` 已验证的 `Taro.eventCenter` 通道（zustand 的 selector 订阅在
 * Taro3 + zustand v3 下不可靠，项目里已有先例）。
 *
 * @param index tab 下标；传负数（例如页面不属于 tabBar）时什么都不做
 */
export function syncTabBarSelected(index: number): void {
  if (index < 0) return
  Taro.eventCenter.trigger(TAB_BAR_SELECT_EVENT, index)
}

/**
 * tab 页专用 hook：在 `useDidShow` 时把「我是第几个 tab」广播给自定义 tabBar
 *
 * 用法（4 个 tab 页面各自加一行，页面 path 由类型钉死，写错即编译不过）：
 * ```ts
 * useTabBarSelected('/pages/timeline/index')
 * ```
 *
 * @param pagePath 本页路由，必须是 `TabBarPagePath` 之一
 */
export function useTabBarSelected(pagePath: TabBarPagePath): void {
  useDidShow(() => {
    syncTabBarSelected(tabIndexByPath(pagePath))
  })
}
