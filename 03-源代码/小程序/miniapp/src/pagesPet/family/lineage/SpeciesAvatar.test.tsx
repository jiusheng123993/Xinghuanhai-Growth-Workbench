/**
 * SpeciesAvatar 多物种头像组件测试
 * 覆盖：猫狗显示小动物头像、非猫狗显示 emoji、照片优先、失败回退 emoji、未知物种兜底
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import SpeciesAvatar from './SpeciesAvatar'

// Mock Taro 组件（Image 保留 src/onError 供断言）
vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
  Image: ({ src, className, style, onError, lazyLoad }: any) => (
    // 测试桩：用原生 <img> 替代 Taro Image，故意不写 alt（本项目未安装 eslint-plugin-jsx-a11y，
    // 原先的 eslint-disable-next-line jsx-a11y/alt-text 指向不存在的规则，反而报"规则未定义"，2026-09-11 移除）
    <img
      src={src}
      className={className}
      style={style}
      onError={onError}
      data-lazy={lazyLoad ? 'true' : 'false'}
    />
  ),
}))

// Mock 头像映射模块（隔离网络/URL 拼接逻辑）
vi.mock('../../../data/homeStyleAvatars', () => ({
  getHomeStyleAvatarUrl: (pet: { species: string; breed?: string; breedId?: string }) =>
    `https://mock.example.com/avatars/${pet.species}-${pet.breed || 'default'}.webp`,
  getSpeciesKind: (species: string | null | undefined): 'cat' | 'dog' | 'other' => {
    const s = (species || '').trim().toLowerCase()
    if (s === 'cat' || s === '猫') return 'cat'
    if (s === 'dog' || s === '狗') return 'dog'
    return 'other'
  },
}))

describe('SpeciesAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('猫：显示品种匹配的小动物头像（带 lazyLoad）', () => {
    render(<SpeciesAvatar pet={{ id: 'p1', species: 'cat', breed: '橘猫' }} imgClass='img' emojiClass='em' />)
    const img = document.querySelector('.img') as HTMLImageElement
    expect(img).toBeDefined()
    expect(decodeURIComponent(img.src)).toContain('/avatars/cat-橘猫.webp')
    expect(img.getAttribute('data-lazy')).toBe('true')
  })

  it('狗：显示品种匹配的小动物头像', () => {
    render(<SpeciesAvatar pet={{ id: 'p2', species: 'dog', breed: '金毛' }} imgClass='img' emojiClass='em' />)
    const img = document.querySelector('.img') as HTMLImageElement
    expect(decodeURIComponent(img.src)).toContain('/avatars/dog-金毛.webp')
  })

  it('非猫狗物种（兔子）：显示物种 emoji，不渲染图片', () => {
    render(<SpeciesAvatar pet={{ id: 'p3', species: 'rabbit' }} imgClass='img' emojiClass='em' />)
    expect(document.querySelector('.img')).toBeNull()
    const em = document.querySelector('.em')
    expect(em?.textContent).toBe('🐰')
  })

  it('未知物种：兜底 🐾 emoji', () => {
    render(<SpeciesAvatar pet={{ id: 'p4', species: 'unknown_thing' }} imgClass='img' emojiClass='em' />)
    const em = document.querySelector('.em')
    expect(em?.textContent).toBe('🐾')
  })

  it('物种为空/undefined：兜底 🐾 emoji', () => {
    render(<SpeciesAvatar pet={{ id: 'p5' }} imgClass='img' emojiClass='em' />)
    const em = document.querySelector('.em')
    expect(em?.textContent).toBe('🐾')
  })

  it('照片优先：有 avatarPhotoUrl 时显示照片（不匹配品种）', () => {
    render(
      <SpeciesAvatar
        pet={{ id: 'p6', species: 'cat', breed: '橘猫', avatarPhotoUrl: 'https://real.example.com/photo.jpg' }}
        imgClass='img'
        emojiClass='em'
      />,
    )
    const img = document.querySelector('.img') as HTMLImageElement
    expect(img.src).toBe('https://real.example.com/photo.jpg')
  })

  it('avatarUrl（动态/图谱数据字段）同样照片优先', () => {
    render(
      <SpeciesAvatar
        pet={{ id: 'p7', species: 'dog', avatarUrl: 'https://real.example.com/dog.jpg' }}
        imgClass='img'
        emojiClass='em'
      />,
    )
    const img = document.querySelector('.img') as HTMLImageElement
    expect(img.src).toBe('https://real.example.com/dog.jpg')
  })

  it('卡通形象（avatarCartoonUrl）跟随档案：无照片时显示形象定制保存的图', () => {
    render(
      <SpeciesAvatar
        pet={{ id: 'p7b', species: 'cat', breed: '橘猫', avatarCartoonUrl: 'https://real.example.com/cartoon.png' }}
        imgClass='img'
        emojiClass='em'
      />,
    )
    const img = document.querySelector('.img') as HTMLImageElement
    expect(img.src).toBe('https://real.example.com/cartoon.png')
  })

  it('图片加载失败：猫回退 🐱、狗回退 🐕', () => {
    const { rerender } = render(
      <SpeciesAvatar pet={{ id: 'p8', species: 'cat' }} imgClass='img' emojiClass='em' />,
    )
    fireEvent.error(document.querySelector('.img') as HTMLImageElement)
    expect(document.querySelector('.em')?.textContent).toBe('🐱')
    // 同一组件实例宠物切换后失败状态应重置（src 变化）
    rerender(<SpeciesAvatar pet={{ id: 'p9', species: 'dog' }} imgClass='img' emojiClass='em' />)
    expect(document.querySelector('.img')).toBeDefined()
  })

  it('非猫狗且有照片：照片失败回退 🐾', () => {
    render(
      <SpeciesAvatar
        pet={{ id: 'p10', species: 'bird', avatarUrl: 'https://real.example.com/bird.jpg' }}
        imgClass='img'
        emojiClass='em'
      />,
    )
    fireEvent.error(document.querySelector('.img') as HTMLImageElement)
    expect(document.querySelector('.em')?.textContent).toBe('🐾')
  })

  it('中文脏数据物种："猫"/"狗" 也能识别为猫狗', () => {
    render(<SpeciesAvatar pet={{ id: 'p11', species: '猫' }} imgClass='img' emojiClass='em' />)
    expect(document.querySelector('.img')).toBeDefined()
    render(<SpeciesAvatar pet={{ id: 'p12', species: '狗' }} imgClass='img' emojiClass='em' />)
    expect(document.querySelectorAll('.img').length).toBe(2)
  })
})
