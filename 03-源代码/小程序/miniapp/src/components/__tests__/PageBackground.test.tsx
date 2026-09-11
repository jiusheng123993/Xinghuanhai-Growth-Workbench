/**
 * PageBackground 组件测试
 *
 * 全站 18 处页面背景都走这个组件，它决定「切背景到底有没有反应」：
 *  - 浅色主题 → 光斑层
 *  - 星空银河（深色）→ 星点层
 *  - 奶油格纹 → 格纹层
 *  - 有壁纸 → 叠加照片层
 * 另外它必须保持 pointer-events: none，否则会挡住整页点击。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const themeState = { value: 'autumn' }
const wallpaperState: { value: string | null } = { value: null }

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style }: any) => (
    <div className={className} style={style}>{children}</div>
  ),
  Image: ({ className, src }: any) => (
    <img className={className} src={src} data-testid='bg-wallpaper-img' />
  ),
}))

vi.mock('../../hooks/useThemeClass', () => ({
  useThemeKey: () => themeState.value,
  usePetWallpaper: () => wallpaperState.value,
}))

// eslint-disable-next-line import/first
import PageBackground from '../PageBackground'
// 样式约定回归锁需要 SCSS 源码文本（vitest 的 cwd = 小程序包根目录）
// eslint-disable-next-line import/first
import { readFileSync } from 'node:fs'

describe('PageBackground', () => {
  beforeEach(() => {
    themeState.value = 'autumn'
    wallpaperState.value = null
  })

  it('始终渲染主题渐变底层', () => {
    const { container } = render(<PageBackground />)
    expect(container.querySelector('.xhh-bg__base')).not.toBeNull()
  })

  it('浅色主题（暖阳米白）渲染光斑层，不渲染星点/格纹', () => {
    const { container } = render(<PageBackground />)
    expect(container.querySelectorAll('.xhh-bg__blob').length).toBeGreaterThan(0)
    expect(container.querySelector('.xhh-bg__stars')).toBeNull()
    expect(container.querySelector('.xhh-bg__grid')).toBeNull()
  })

  it('星空银河主题渲染星点层，且不再渲染光斑', () => {
    themeState.value = 'starry'
    const { container } = render(<PageBackground />)
    expect(container.querySelector('.xhh-bg__stars')).not.toBeNull()
    expect(container.querySelectorAll('.xhh-bg__star').length).toBeGreaterThan(10)
    expect(container.querySelectorAll('.xhh-bg__blob').length).toBe(0)
  })

  it('奶油格纹主题渲染格纹层', () => {
    themeState.value = 'grid'
    const { container } = render(<PageBackground />)
    expect(container.querySelector('.xhh-bg__grid')).not.toBeNull()
    expect(container.querySelector('.xhh-bg__stars')).toBeNull()
  })

  it('未设置壁纸时不渲染照片层', () => {
    const { container } = render(<PageBackground />)
    expect(container.querySelector('.xhh-pet-wallpaper')).toBeNull()
  })

  it('设置壁纸后渲染照片层 + 遮罩（遮罩保证内容可读）', () => {
    wallpaperState.value = 'wxfile://tmp/pet.png'
    const { container, getByTestId } = render(<PageBackground />)
    expect(container.querySelector('.xhh-pet-wallpaper')).not.toBeNull()
    expect(container.querySelector('.xhh-pet-wallpaper__veil')).not.toBeNull()
    expect(getByTestId('bg-wallpaper-img').getAttribute('src')).toBe('wxfile://tmp/pet.png')
  })

  it('壁纸可与任意主题共存（如星空 + 宠物照片）', () => {
    themeState.value = 'starry'
    wallpaperState.value = 'wxfile://tmp/pet.png'
    const { container } = render(<PageBackground />)
    expect(container.querySelector('.xhh-bg__stars')).not.toBeNull()
    expect(container.querySelector('.xhh-pet-wallpaper')).not.toBeNull()
  })

  it('星点位置是确定性的（重渲染不跳动）', () => {
    themeState.value = 'starry'
    const first = render(<PageBackground />)
    const posA = Array.from(first.container.querySelectorAll('.xhh-bg__star')).map(
      (n) => n.getAttribute('style')
    )
    const second = render(<PageBackground />)
    const posB = Array.from(second.container.querySelectorAll('.xhh-bg__star')).map(
      (n) => n.getAttribute('style')
    )
    expect(posA).toEqual(posB)
  })
})

/**
 * 样式约定回归锁（2026-09-10 全站「页面顶部一大片空白」事故）
 *
 * 这层背景现在是**不透明**的（.xhh-bg__base 铺满主题渐变），而按 CSS 绘制顺序，
 * z-index: 0 的 fixed 元素会盖在所有「没有定位、也没有 transform」的静态内容之上
 * ——我的页头像昵称、创作页宠物头排与区块标题就是这样整块消失的。
 * 组件测试渲染出来后只有 DOM 没有层叠计算，锁不住这类问题，所以直接断言 SCSS 文本。
 */
describe('PageBackground 样式约定', () => {
  // 路径相对小程序包根目录（vitest 的 cwd 就是这里）；读不到会直接抛错，不会静默跳过
  const bgScss = readFileSync('src/components/PageBackground.scss', 'utf-8')
  const blockStart = bgScss.indexOf('.xhh-bg {')
  const layerBlock = bgScss.slice(blockStart, bgScss.indexOf('}', blockStart))

  it('背景层必须是 z-index: -1（写成 0 就会盖住静态内容）', () => {
    expect(layerBlock).toContain('z-index: -1')
    expect(layerBlock).not.toMatch(/z-index:\s*0\s*;/)
  })

  it('背景层保持 fixed 全屏 + 不吃点击', () => {
    expect(layerBlock).toContain('position: fixed')
    expect(layerBlock).toContain('pointer-events: none')
  })
})
