/**
 * 食物安全分享卡片组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import FoodShareCard from './FoodShareCard'

const mockShowShareMenu = vi.hoisted(() => vi.fn())
const mockShowToast = vi.hoisted(() => vi.fn())

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
  Image: ({ src, className, mode }: any) => (
    <img className={className} src={src} alt='' data-mode={mode} />
  ),
  Canvas: (props: any) => <canvas {...props} />,
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    showShareMenu: mockShowShareMenu,
    showToast: mockShowToast,
    createSelectorQuery: vi.fn(),
    canvasToTempFilePath: vi.fn(),
    saveImageToPhotosAlbum: vi.fn(),
  },
}))

vi.mock('../utils/shareCanvasRenderer', () => ({
  renderShareCardToCanvas: vi.fn().mockRejectedValue(new Error('no canvas')),
  saveShareImage: vi.fn(),
}))

describe('FoodShareCard', () => {
  const baseProps = {
    foodName: '巧克力',
    safetyLevel: 'toxic' as const,
    petName: '旺财',
    petAvatar: 'https://example.com/dog.png',
    dangerousCompounds: ['可可碱', '咖啡因'],
    symptoms: ['呕吐', '腹泻', '心跳加速', '抽搐', '昏迷'],
    detail: '巧克力对狗狗有剧毒，请立即就医',
    onShare: vi.fn(),
  }

  it('正确渲染食物名称和安全等级徽章', () => {
    render(<FoodShareCard {...baseProps} />)

    expect(screen.getByText('巧克力')).toBeDefined()
    expect(screen.getByText('有毒')).toBeDefined()
  })

  it('安全等级颜色映射正确', () => {
    const levels = [
      { level: 'safe' as const, label: '安全' },
      { level: 'caution' as const, label: '注意' },
      { level: 'dangerous' as const, label: '危险' },
      { level: 'toxic' as const, label: '有毒' },
    ]

    levels.forEach(({ level, label }) => {
      const { unmount } = render(
        <FoodShareCard {...baseProps} safetyLevel={level} />
      )
      expect(screen.getByText(label)).toBeDefined()
      unmount()
    })
  })

  it('危险成分和症状标签正确显示', () => {
    render(<FoodShareCard {...baseProps} />)

    expect(screen.getByText('可可碱')).toBeDefined()
    expect(screen.getByText('咖啡因')).toBeDefined()
    expect(screen.getByText('呕吐')).toBeDefined()
    expect(screen.getByText('腹泻')).toBeDefined()
    expect(screen.getByText('心跳加速')).toBeDefined()
    expect(screen.getByText('+2')).toBeDefined()
  })

  it('点击分享按钮触发 showShareMenu 和 onShare', () => {
    const onShare = vi.fn()
    render(<FoodShareCard {...baseProps} onShare={onShare} />)

    const shareBtn = screen.getByText('分享给好友').closest('div')
    fireEvent.click(shareBtn!)

    expect(mockShowShareMenu).toHaveBeenCalledWith({ withShareTicket: true })
    expect(onShare).toHaveBeenCalledTimes(1)
  })

  it('宠物头像和名字正确显示', () => {
    render(<FoodShareCard {...baseProps} />)

    expect(screen.getByText('旺财')).toBeDefined()
    const img = screen.getByAltText('')
    expect(img.getAttribute('src')).toBe('https://example.com/dog.png')
  })

  it('无头像时显示默认emoji', () => {
    render(<FoodShareCard {...baseProps} petAvatar={undefined} />)

    expect(screen.getByText('🐾')).toBeDefined()
  })

  it('渲染保存图片按钮', () => {
    render(<FoodShareCard {...baseProps} />)
    expect(screen.getByText('保存图片')).toBeDefined()
  })
})
