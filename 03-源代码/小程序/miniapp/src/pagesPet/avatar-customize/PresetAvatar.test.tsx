/**
 * PresetAvatar 预设形象头像组件测试
 * 覆盖：正常显示图片、图片加载失败回退物种 emoji、切换图片后失败状态重置
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import PresetAvatar from './PresetAvatar'

// Mock Taro 组件（Image 保留 src/onError 供断言）
vi.mock('@tarojs/components', () => ({
  View: ({ children, className }: any) => <div className={className}>{children}</div>,
  Text: ({ children, className }: any) => <span className={className}>{children}</span>,
  Image: ({ src, className, onError, lazyLoad }: any) => (
    // 测试桩：用原生 <img> 替代 Taro Image，故意不写 alt（本项目未安装 eslint-plugin-jsx-a11y，
    // 原先的 eslint-disable-next-line jsx-a11y/alt-text 指向不存在的规则，反而报"规则未定义"，2026-09-11 移除）
    <img src={src} className={className} onError={onError} data-lazy={lazyLoad ? 'true' : 'false'} />
  ),
}))

describe('PresetAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('正常渲染品牌头像图片（带 lazyLoad）', () => {
    render(
      <PresetAvatar
        src='https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01.png'
        species='cat'
        imgClass='avatar-preset__img'
        fallbackClass='avatar-preset__fallback'
      />,
    )
    const img = document.querySelector('.avatar-preset__img') as HTMLImageElement
    expect(img).toBeDefined()
    expect(img.src).toContain('/uploads/avatars/home-style/cat/cat-01.png')
    expect(img.getAttribute('data-lazy')).toBe('true')
    // 未失败时不应显示 fallback
    expect(document.querySelector('.avatar-preset__fallback')).toBeNull()
  })

  it('图片加载失败：猫回退 🐱 emoji', () => {
    render(
      <PresetAvatar
        src='https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01.png'
        species='cat'
        imgClass='avatar-preset__img'
        fallbackClass='avatar-preset__fallback'
      />,
    )
    fireEvent.error(document.querySelector('.avatar-preset__img') as HTMLImageElement)
    const fallback = document.querySelector('.avatar-preset__fallback')
    expect(fallback).toBeDefined()
    expect(fallback?.textContent).toBe('🐱')
  })

  it('图片加载失败：狗回退 🐶 emoji', () => {
    render(
      <PresetAvatar
        src='https://api.xinghuanhai.com/uploads/avatars/home-style/dog/dog-01.png'
        species='dog'
        imgClass='avatar-preset__img'
        fallbackClass='avatar-preset__fallback'
      />,
    )
    fireEvent.error(document.querySelector('.avatar-preset__img') as HTMLImageElement)
    const fallback = document.querySelector('.avatar-preset__fallback')
    expect(fallback?.textContent).toBe('🐶')
  })

  it('切换 src 后失败状态重置（不再卡在 emoji）', () => {
    const { rerender } = render(
      <PresetAvatar
        src='https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01.png'
        species='cat'
        imgClass='avatar-preset__img'
        fallbackClass='avatar-preset__fallback'
      />,
    )
    fireEvent.error(document.querySelector('.avatar-preset__img') as HTMLImageElement)
    expect(document.querySelector('.avatar-preset__fallback')).toBeDefined()
    // 切换另一张图（src 变化）→ 应重新显示 Image
    rerender(
      <PresetAvatar
        src='https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-02.png'
        species='cat'
        imgClass='avatar-preset__img'
        fallbackClass='avatar-preset__fallback'
      />,
    )
    expect(document.querySelector('.avatar-preset__img')).toBeDefined()
    expect(document.querySelector('.avatar-preset__fallback')).toBeNull()
  })
})
