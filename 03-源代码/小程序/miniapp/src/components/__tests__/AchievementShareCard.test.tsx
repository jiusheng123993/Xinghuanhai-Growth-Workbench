/**
 * 成就分享卡片组件测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AchievementShareCard from '../AchievementShareCard'

const { mockShowShareMenu, mockShowToast } = vi.hoisted(() => ({
  mockShowShareMenu: vi.fn(),
  mockShowToast: vi.fn(),
}))

vi.mock('@tarojs/components', () => ({
  View: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Text: ({ children, ...props }: any) => <span {...props}>{children}</span>,
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

vi.mock('../../utils/shareCanvasRenderer', () => ({
  renderShareCardToCanvas: vi.fn().mockRejectedValue(new Error('no canvas')),
  saveShareImage: vi.fn(),
}))

describe('AchievementShareCard', () => {
  const defaultProps = {
    petName: '旺财',
    petAvatar: '',
    achievementTitle: '连续7天',
    achievementSubtitle: '一周健康打卡',
    achievementIcon: '⭐',
    achievementColor: '#FFD700',
    achievementType: 'streak_7',
    achievementAvatar: '',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染成就标题和宠物名', () => {
    render(<AchievementShareCard {...defaultProps} />)
    expect(screen.getByText('连续7天')).toBeTruthy()
    expect(screen.getByText('旺财')).toBeTruthy()
  })

  it('渲染保存图片和炫耀按钮', () => {
    render(<AchievementShareCard {...defaultProps} />)
    expect(screen.getByText('保存图片')).toBeTruthy()
    expect(screen.getByText('炫耀一下')).toBeTruthy()
  })

  it('点击炫耀按钮触发 showShareMenu 和 onClose', async () => {
    const onClose = vi.fn()
    render(<AchievementShareCard {...defaultProps} onClose={onClose} />)
    await userEvent.click(screen.getByText('炫耀一下'))
    expect(mockShowShareMenu).toHaveBeenCalledWith({ withShareTicket: true })
    expect(onClose).toHaveBeenCalled()
  })

  it('渲染成就副标题', () => {
    render(<AchievementShareCard {...defaultProps} />)
    expect(screen.getByText('一周健康打卡')).toBeTruthy()
  })
})
