/**
 * 分享和邀请状态管理 - 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useShareStore } from '../shareStore'

const {
  mockGetOrCreateInviteCode,
  mockGetShareStats,
  mockRecordShare,
  mockGrantShareReward,
} = vi.hoisted(() => ({
  mockGetOrCreateInviteCode: vi.fn(),
  mockGetShareStats: vi.fn(),
  mockRecordShare: vi.fn(),
  mockGrantShareReward: vi.fn(),
}))

vi.mock('../../services/shareService', () => ({
  getOrCreateInviteCode: mockGetOrCreateInviteCode,
  getShareStats: mockGetShareStats,
  recordShare: mockRecordShare,
  grantShareReward: mockGrantShareReward,
}))

describe('shareStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useShareStore.setState({
      inviteCode: '',
      shareStats: null,
      isLoading: false,
      error: null,
    })
  })

  it('初始状态正确', () => {
    const state = useShareStore.getState()
    expect(state.inviteCode).toBe('')
    expect(state.shareStats).toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('fetchInviteCode 成功获取邀请码', async () => {
    mockGetOrCreateInviteCode.mockResolvedValue('ABC123')
    await useShareStore.getState().fetchInviteCode('user-1')
    expect(useShareStore.getState().inviteCode).toBe('ABC123')
    expect(useShareStore.getState().isLoading).toBe(false)
    expect(mockGetOrCreateInviteCode).toHaveBeenCalledWith('user-1')
  })

  it('fetchInviteCode 失败设置 error', async () => {
    mockGetOrCreateInviteCode.mockRejectedValue(new Error('网络错误'))
    await useShareStore.getState().fetchInviteCode('user-1')
    expect(useShareStore.getState().error).toBe('网络错误')
    expect(useShareStore.getState().inviteCode).toBe('')
    expect(useShareStore.getState().isLoading).toBe(false)
  })

  it('fetchShareStats 成功获取统计', async () => {
    const mockStats = {
      totalShares: 5,
      foodShares: 2,
      trendShares: 1,
      vaccineShares: 1,
      achievementShares: 1,
      totalInvites: 3,
      successfulInvites: 1,
    }
    mockGetShareStats.mockResolvedValue(mockStats)
    await useShareStore.getState().fetchShareStats('user-1')
    expect(useShareStore.getState().shareStats).toEqual(mockStats)
    expect(useShareStore.getState().isLoading).toBe(false)
  })

  it('fetchShareStats 失败设置 error', async () => {
    mockGetShareStats.mockRejectedValue(new Error('获取失败'))
    await useShareStore.getState().fetchShareStats('user-1')
    expect(useShareStore.getState().error).toBe('获取失败')
    expect(useShareStore.getState().shareStats).toBeNull()
  })

  it('recordShareAction 成功记录分享并更新统计', async () => {
    useShareStore.setState({
      shareStats: {
        totalShares: 5,
        foodShares: 2,
        trendShares: 1,
        vaccineShares: 1,
        achievementShares: 1,
        totalInvites: 3,
        successfulInvites: 1,
      },
    })
    mockRecordShare.mockResolvedValue({})
    await useShareStore.getState().recordShareAction('user-1', 'food', 'pet-1', 'wechat')
    expect(mockRecordShare).toHaveBeenCalledWith('user-1', 'food', 'pet-1', 'wechat')
    const stats = useShareStore.getState().shareStats!
    expect(stats.totalShares).toBe(6)
    expect(stats.foodShares).toBe(3)
  })

  it('recordShareAction 失败设置 error', async () => {
    mockRecordShare.mockRejectedValue(new Error('记录失败'))
    await useShareStore.getState().recordShareAction('user-1', 'food', 'pet-1', 'wechat')
    expect(useShareStore.getState().error).toBe('记录失败')
  })

  it('checkAndGrantReward 成功邀请数达标时发放奖励', async () => {
    useShareStore.setState({
      shareStats: {
        totalShares: 5,
        foodShares: 2,
        trendShares: 1,
        vaccineShares: 1,
        achievementShares: 1,
        totalInvites: 3,
        successfulInvites: 3,
      },
    })
    mockGrantShareReward.mockResolvedValue({
      rewardGranted: true,
      rewardType: 'membership_days',
      rewardValue: 7,
      message: '邀请3位好友，奖励7天会员',
    })
    const result = await useShareStore.getState().checkAndGrantReward('user-1')
    expect(result?.rewardGranted).toBe(true)
    expect(result?.rewardType).toBe('membership_days')
    expect(mockGrantShareReward).toHaveBeenCalledWith('user-1')
  })

  it('checkAndGrantReward 失败返回 null', async () => {
    mockGrantShareReward.mockRejectedValue(new Error('奖励发放失败'))
    const result = await useShareStore.getState().checkAndGrantReward('user-1')
    expect(result).toBeNull()
    expect(useShareStore.getState().error).toBe('奖励发放失败')
  })

  it('clearError 清除错误', () => {
    useShareStore.setState({ error: 'some error' })
    useShareStore.getState().clearError()
    expect(useShareStore.getState().error).toBeNull()
  })
})
