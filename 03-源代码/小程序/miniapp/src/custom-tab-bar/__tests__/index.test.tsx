/**
 * 自定义 tabBar 组件测试
 *
 * 逐条锁住坏了用户立刻能看出来的行为：
 *  ① 4 个 tab 文案 + 中心「团团」圆钮同时存在；
 *  ② 中心圆钮在**第 3 个槽位**（断言 DOM 顺序，不是只数数量）；
 *  ③ 点「创作」→ switchTab 到创作页（并乐观高亮）；
 *  ④ tab 页广播 tabBarSelect 时高亮要跟上（组件实例被复用，不能只算一次）；
 *  ⑤ 主题广播 themeChange 后图标目录与未选中文字色要换（自定义 tabBar 的全部配色来源）；
 *  ⑥ 卸载时解绑事件（防泄漏回归）。
 *
 * 【为什么要自己 mock @tarojs/taro】需要 ① 断言 switchTab / navigateTo 的入参
 * ② 手动广播事件来驱动组件，所以用一个能存回调的 eventCenter 替身；
 * 写法沿用 src/stores/__tests__/themeStore.test.ts 的 vi.hoisted（mock 工厂会被提升到
 * 文件顶部，里面引用的变量必须提前初始化）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import React from 'react'

const { handlers, mockSwitchTab, mockNavigateTo, mockOn, mockOff, router } = vi.hoisted(() => {
  /** 事件名 → 组件注册的回调；trigger/手动调用时按名字取出来执行 */
  const eventHandlers: Record<string, (payload: any) => void> = {}
  return {
    handlers: eventHandlers,
    mockSwitchTab: vi.fn((_opts?: any) => Promise.resolve()),
    mockNavigateTo: vi.fn((_opts?: any) => Promise.resolve()),
    mockOn: vi.fn((name: string, fn: (payload: any) => void) => {
      eventHandlers[name] = fn
    }),
    mockOff: vi.fn((name: string) => {
      delete eventHandlers[name]
    }),
    /** 当前路由：Taro 的 router.path **不带**前导斜杠，每个用例可改写 */
    router: { path: 'pages/index/index' },
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    // themeStore 初始化时会读本地存储：mock 成没存过 → 落到默认主题 autumn
    getStorageSync: vi.fn(() => null),
    setStorageSync: vi.fn(),
    setNavigationBarColor: vi.fn(() => Promise.resolve()),
    getCurrentInstance: () => ({ router: { path: router.path } }),
    switchTab: mockSwitchTab,
    navigateTo: mockNavigateTo,
    eventCenter: { on: mockOn, off: mockOff, trigger: vi.fn() },
  },
  // constants/tabBar.ts 会 import { useDidShow }，缺了具名导出会让模块加载直接抛错
  useDidShow: vi.fn(),
}))

// 组件只用 View / Text / Image 三个内置组件，这里映射成原生 DOM 元素；
// Taro 专有属性（hoverClass 等）不往 DOM 上塞，aria-label 则必须透传（要断言无障碍标注）
vi.mock('@tarojs/components', () => {
  /** 只在小程序模板里有意义的属性：透传给 DOM 会让 React 报未知属性，先剔除 */
  const TARO_ONLY_ATTRS = ['hoverClass', 'hoverStartTime', 'hoverStayTime', 'mode']
  const mapTag = (tag: string) => (props: any) => {
    const domProps: Record<string, any> = {}
    Object.keys(props).forEach((key) => {
      if (key !== 'children' && TARO_ONLY_ATTRS.indexOf(key) === -1) domProps[key] = props[key]
    })
    return React.createElement(tag, domProps, props.children)
  }
  return { View: mapTag('div'), Text: mapTag('span'), Image: mapTag('img') }
})

// eslint-disable-next-line import/first
import CustomTabBar from '../index'
// eslint-disable-next-line import/first
import { TAB_BAR_SELECT_EVENT } from '../../constants/tabBar'

/** 取全部槽位（含中心 AI 槽位），顺序即渲染顺序 */
const getSlots = (container: HTMLElement) => Array.from(container.querySelectorAll('.custom-tab-bar__slot'))

/** 取全部 tab 文案节点，顺序即渲染顺序（取 HTMLElement 才能读 .style.color） */
const getLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('.custom-tab-bar__label'))

/**
 * 归一化颜色，便于比较
 * jsdom 会改写颜色写法：'rgba(255,255,255,0.55)' → 'rgba(255, 255, 255, 0.55)'，
 * 而 hex（#FFD068）会被规范化成 'rgb(255, 208, 104)'，所以比较前先去空格转小写。
 */
const normalizeColor = (value: string) => value.replace(/\s+/g, '').toLowerCase()

describe('custom-tab-bar 自定义底部导航', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(handlers).forEach((name) => delete handlers[name])
    router.path = 'pages/index/index'
    cleanup()
  })

  it('渲染 4 个 tab 文案（今天/时光/创作/我的）与中心圆钮', () => {
    const { container, getByText } = render(<CustomTabBar />)

    for (const text of ['今天', '时光', '创作', '我的']) {
      expect(getByText(text)).toBeDefined()
    }
    // 中心「团团」圆钮存在（它不是 tab 页，所以没有文案节点，只能按类名找）
    expect(container.querySelector('.custom-tab-bar__ai')).not.toBeNull()
    // 共 5 个视觉槽位 = 4 个 tab + 1 个中心按钮
    expect(getSlots(container)).toHaveLength(5)
  })

  it('中心圆钮固定在第 3 个槽位（DOM 顺序断言，不是只数数量）', () => {
    const { container } = render(<CustomTabBar />)
    const slots = getSlots(container)

    expect(slots[0].textContent).toBe('今天')
    expect(slots[1].textContent).toBe('时光')
    expect(slots[2].className).toContain('custom-tab-bar__slot--ai')
    expect(slots[3].textContent).toBe('创作')
    expect(slots[4].textContent).toBe('我的')
  })

  it('每个 tab 带 aria-label（无障碍读屏文案）', () => {
    const { container } = render(<CustomTabBar />)

    expect(getSlots(container)[0].getAttribute('aria-label')).toBe('今天')
    expect(getSlots(container)[2].getAttribute('aria-label')).toBeNull()
    expect(container.querySelector('.custom-tab-bar__ai')?.getAttribute('aria-label')).toBe('团团')
  })

  it('点「创作」→ switchTab 到创作页，并立刻把高亮切过去（乐观更新）', () => {
    const { container, getByText } = render(<CustomTabBar />)

    fireEvent.click(getByText('创作'))

    expect(mockSwitchTab).toHaveBeenCalledTimes(1)
    expect(mockSwitchTab).toHaveBeenCalledWith({ url: '/pages/creative/index' })
    // 不等页面广播就把高亮切走，否则快速连点会闪
    const active = container.querySelectorAll('.custom-tab-bar__slot--active')
    expect(active).toHaveLength(1)
    expect(active[0].textContent).toBe('创作')
  })

  it('收到 tabBarSelect(1) 广播 → 时光 tab 变选中态（组件实例被复用，靠事件纠正）', () => {
    const { container } = render(<CustomTabBar />)
    // 初值：当前路由是首页 → 今天 高亮
    expect(container.querySelector('.custom-tab-bar__slot--active')?.textContent).toBe('今天')

    // 组件确实订阅了事件（否则下面的手动调用不会生效）
    expect(mockOn).toHaveBeenCalledWith(TAB_BAR_SELECT_EVENT, expect.any(Function))
    act(() => {
      handlers[TAB_BAR_SELECT_EVENT](1)
    })

    const active = container.querySelectorAll('.custom-tab-bar__slot--active')
    expect(active).toHaveLength(1)
    expect(active[0].textContent).toBe('时光')

    // 选中弹跳必须挂在**组件自己的类名**上（`--active`）：
    // 微信端全局 app.wxss 的类对自定义组件不生效、`data-*` 也不落 wxml，
    // 所以绝不能退回 `xhh-tab-bounce` + `[data-active='true']` 那种写法（独立审查实证）。
    const icons = Array.from(container.querySelectorAll('.custom-tab-bar__icon'))
    expect(icons[1].className).toContain('custom-tab-bar__icon--active')
    expect(icons[0].className).not.toContain('custom-tab-bar__icon--active')
    expect(icons[0].hasAttribute('data-active')).toBe(false)
  })

  it('收到 themeChange(starry) 广播 → 图标换成 starry 目录，未选中文字色变 starry 的 tabBarColor', () => {
    // 把当前路由设成「时光」：这样首页成为**未选中**态，才能断言非 active 的图标文件
    router.path = 'pages/timeline/index'
    const { container } = render(<CustomTabBar />)

    act(() => {
      handlers.themeChange('starry')
    })

    // 图标目录按主题换（根路径，避免分包页面相对路径图裂）：
    // 未选中的「今天」→ home.png，选中的「时光」→ timeline-active.png
    const icons = Array.from(container.querySelectorAll('.custom-tab-bar__icon'))
    expect(icons[0].getAttribute('src')).toBe('/assets/icons/tabbar/starry/home.png')
    expect(icons[1].getAttribute('src')).toBe('/assets/icons/tabbar/starry/timeline-active.png')
    // 未选中的「今天」用 tabBarColor，选中的「时光」用 tabBarSelectedColor
    const labels = getLabels(container)
    expect(normalizeColor(labels[0].style.color)).toBe('rgba(255,255,255,0.55)')
    expect(normalizeColor(labels[1].style.color)).toBe('rgb(255,208,104)')
    // 整条 bar 的底色也跟着落成 starry 的 tabBarBg
    const bar = container.querySelector('.custom-tab-bar') as HTMLElement
    expect(normalizeColor(bar.style.backgroundColor)).toBe('rgb(35,44,87)')
    // 注：深色主题加重上投影（meta.dark）这条读不到 —— jsdom 的 cssstyle 不认 rpx 长度，
    // box-shadow 会被整条丢弃（rgba/hex 这类颜色值则能读），故此处不做断言，见自述不确定项
  })

  it('选中态初值取自当前路由（拿不到路由时退回第 0 个）', () => {
    router.path = 'pages/creative/index'
    const first = render(<CustomTabBar />)
    expect(first.container.querySelector('.custom-tab-bar__slot--active')?.textContent).toBe('创作')
    first.unmount()

    // 非 tab 页（如宠物档案）反查得 -1 → 退回第 0 个，不能整条导航没有一个高亮
    router.path = 'pages/pet-profile/index'
    const second = render(<CustomTabBar />)
    expect(second.container.querySelector('.custom-tab-bar__slot--active')?.textContent).toBe('今天')
  })

  it('点中心圆钮 → AI 路径当前仍是 tab 页，走 switchTab（不误用 navigateTo）', () => {
    const { container } = render(<CustomTabBar />)

    fireEvent.click(container.querySelector('.custom-tab-bar__ai') as Element)

    expect(mockSwitchTab).toHaveBeenCalledWith({ url: '/pages/index/index' })
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('卸载时解绑 themeChange 与 tabBarSelect（防内存泄漏 / 防旧实例继续收事件）', () => {
    const { unmount } = render(<CustomTabBar />)

    unmount()

    expect(mockOff).toHaveBeenCalledWith('themeChange', expect.any(Function))
    expect(mockOff).toHaveBeenCalledWith(TAB_BAR_SELECT_EVENT, expect.any(Function))
  })
})
