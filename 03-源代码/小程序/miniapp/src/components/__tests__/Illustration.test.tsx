/**
 * Illustration 组件测试（2026-09-12 新增，配合四季插画接入）
 *
 * 锁住两件事：
 *  1. 组件真的把「当前主题」传给了 illustrationUrl —— 季节插画靠这一步才切得动；
 *  2. 主题切换（Taro.eventCenter 的 themeChange 事件）后图会跟着换季 ——
 *     这是四季插画的核心体验，且 pages/family 这类宿主页面自身没有订阅主题，
 *     只能靠组件自己订阅，所以这条链路必须有用例守着。
 *
 * 这里刻意不 mock hooks/useThemeClass：用真实的 useThemeKey() + 自建事件中心跑通全链路。
 * （setup.ts 里全局 mock 的 eventCenter 是 vi.fn()，不会真的回调，验证不了换图。）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'

// 事件中心用真实实现，才能验证「切主题 → 插画换图」
const taro = vi.hoisted(() => {
  const listeners = new Map<string, Array<(payload: any) => void>>()
  return {
    listeners,
    eventCenter: {
      on: (event: string, handler: (payload: any) => void) => {
        const list = listeners.get(event) ?? []
        list.push(handler)
        listeners.set(event, list)
      },
      off: (event: string, handler: (payload: any) => void) => {
        listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== handler))
      },
      trigger: (event: string, payload: any) => {
        const list = listeners.get(event) ?? []
        list.slice().forEach((h) => h(payload))
      },
    },
  }
})

vi.mock('@tarojs/taro', () => ({
  default: { eventCenter: taro.eventCenter },
  useDidShow: () => {},
}))

// 主题 store：useThemeKey() 读 getState().current，并由 themeChange 事件驱动重渲染
const themeState = vi.hoisted(() => ({ current: 'autumn' as string }))
vi.mock('../../stores/themeStore', () => ({
  useThemeStore: {
    getState: () => ({ current: themeState.current, applyNativeBars: () => {} }),
  },
}))

// 只保留「相对路径拼绝对地址」这段真实行为，避免把 services/api 的一长串依赖拖进组件测试
vi.mock('../../services/api', () => ({
  resolveAvatarUrl: (path: string) => `https://api.xinghuanhai.com${path}`,
}))

// eslint-disable-next-line import/first
import Illustration from '../Illustration'

const BASE = 'https://api.xinghuanhai.com/uploads/illustrations'

/** 取渲染出来的 <img> 的 src（setup.ts 把 Taro 的 Image 映射成了原生 <img>） */
function imgSrc(container: HTMLElement): string | null {
  return container.querySelector('img')?.getAttribute('src') ?? null
}

describe('Illustration · 季节插画', () => {
  beforeEach(() => {
    themeState.current = 'autumn'
    taro.listeners.clear()
  })

  it('spring 主题下渲染春季插画（证明主题确实传下去了）', () => {
    themeState.current = 'spring'
    const { container } = render(<Illustration name='grid-checkin' />)
    expect(imgSrc(container)).toBe(`${BASE}/seasonal/checkin-spring.jpg`)
  })

  it('winter 主题下渲染冬季插画（另一季对照，防止源码里写死某一季）', () => {
    themeState.current = 'winter'
    const { container } = render(<Illustration name='header-naming' />)
    expect(imgSrc(container)).toBe(`${BASE}/seasonal/naming-winter-card.jpg`)
  })

  it('切换主题（themeChange 事件）后插画跟着换季', () => {
    themeState.current = 'autumn'
    const { container } = render(<Illustration name='page-mine' />)
    expect(imgSrc(container)).toBe(`${BASE}/seasonal/mine-autumn-hero.jpg`)

    act(() => {
      themeState.current = 'summer'
      taro.eventCenter.trigger('themeChange', 'summer')
    })

    expect(imgSrc(container)).toBe(`${BASE}/seasonal/mine-summer-hero.jpg`)
  })

  it('starry 主题（没有四季插画）回退默认季 autumn', () => {
    themeState.current = 'starry'
    const { container } = render(<Illustration name='grid-checkin' />)
    expect(imgSrc(container)).toBe(`${BASE}/seasonal/checkin-autumn.jpg`)
  })

  it('没有季节版的 key 仍走旧图（优雅回退，不会裂图）', () => {
    themeState.current = 'spring'
    const { container } = render(<Illustration name='share-card-warm' />)
    expect(imgSrc(container)).toBe(`${BASE}/share-card-warm.jpg`)
  })

  it('加载失败仍整块不渲染（沿用原降级策略）', () => {
    const { container } = render(<Illustration name='empty-timeline' />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
  })
})
