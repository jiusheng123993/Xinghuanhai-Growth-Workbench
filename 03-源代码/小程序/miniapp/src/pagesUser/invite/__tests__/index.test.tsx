/** 邀请好友页面单元测试 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import InvitePage from '../index'

const { mockFetchInviteCode, mockFetchShareStats, mockCheckAndGrantReward, mockSetClipboardData, mockShowToast } = vi.hoisted(() => ({
  mockFetchInviteCode: vi.fn(),
  mockFetchShareStats: vi.fn(),
  mockCheckAndGrantReward: vi.fn(),
  mockSetClipboardData: vi.fn(),
  mockShowToast: vi.fn(),
}))

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, onClick }: any) => (
    <div className={className} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className }: any) => (
    <span className={className}>{children}</span>
  ),
  Button: ({ children, className, onClick, openType }: any) => (
    <button className={className} onClick={onClick} data-opentype={openType}>{children}</button>
  ),
}))

vi.mock('../../../stores/shareStore', () => ({
  useShareStore: () => ({
    inviteCode: 'TEST01',
    shareStats: {
      totalShares: 5,
      foodShares: 2,
      trendShares: 1,
      vaccineShares: 1,
      achievementShares: 1,
      totalInvites: 2,
      successfulInvites: 1,
    },
    fetchInviteCode: mockFetchInviteCode,
    fetchShareStats: mockFetchShareStats,
    checkAndGrantReward: mockCheckAndGrantReward,
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'user-1', nickname: '测试用户' } }),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    setClipboardData: mockSetClipboardData,
    showToast: mockShowToast,
    setStorageSync: vi.fn(),
    getStorageSync: vi.fn(() => null),
    getStorageInfoSync: vi.fn(() => ({ keys: [] })),
    setNavigationBarColor: vi.fn(() => ({ catch: vi.fn() })),
    setTabBarStyle: vi.fn(() => ({ catch: vi.fn() })),
    // 主题切换会顺带换 tabBar 图标（themeStore.applyTabBarIcons），mock 需一并提供
    setTabBarItem: vi.fn(() => ({ catch: vi.fn() })),
    eventCenter: { on: vi.fn(), off: vi.fn(), trigger: vi.fn() },
  },
  useDidShow: vi.fn(),
  useShareAppMessage: vi.fn(),
  useShareTimeline: vi.fn(),
  eventCenter: { on: vi.fn(), off: vi.fn(), trigger: vi.fn() },
}))

vi.mock('../../../components', () => ({
  PageLoading: () => <div>Loading</div>,
  PageError: ({ message, onRetry }: any) => <div>Error: {message}<button onClick={onRetry}>Retry</button></div>,
}))

describe('InvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders invite code', () => {
    render(<InvitePage />)
    expect(screen.getByText('TEST01')).toBeTruthy()
  })

  it('copies invite code on button click', () => {
    mockSetClipboardData.mockImplementation(({ success }: any) => success())
    mockShowToast.mockImplementation(() => {})
    render(<InvitePage />)
    const copyBtn = screen.getByText('复制邀请码')
    fireEvent.click(copyBtn)
    expect(mockSetClipboardData).toHaveBeenCalledWith({
      data: 'TEST01',
      success: expect.any(Function),
    })
  })

  it('checks reward on button click', async () => {
    mockCheckAndGrantReward.mockResolvedValue({
      rewardGranted: true,
      rewardType: 'membership_days',
      rewardValue: 7,
      message: '邀请3位好友，奖励7天会员',
    })
    render(<InvitePage />)
    const checkBtn = screen.getByText('检查奖励')
    fireEvent.click(checkBtn)
    await vi.waitFor(() => {
      expect(mockCheckAndGrantReward).toHaveBeenCalledWith('user-1')
    })
  })

  it('displays share stats', () => {
    render(<InvitePage />)
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('1/3')).toBeTruthy()
  })
})
