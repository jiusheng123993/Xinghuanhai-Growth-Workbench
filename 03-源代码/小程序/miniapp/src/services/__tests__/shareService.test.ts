/**
 * 分享服务测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  getOrCreateInviteCode,
  recordShare,
  getShareStats,
  processReferral,
  processPendingReferral,
  getLocalShareHistory,
  clearLocalShareHistory,
} from '../shareService'

const memoryStore = new Map<string, unknown>()

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn((key: string) => memoryStore.get(key) ?? ''),
    setStorageSync: vi.fn((key: string, value: unknown) => { memoryStore.set(key, value) }),
    removeStorageSync: vi.fn((key: string) => { memoryStore.delete(key) }),
    request: vi.fn(() => Promise.resolve({ statusCode: 200, data: {} })),
  },
}))

vi.mock('../api', () => ({
  api: {
    get: mockApiGet,
    post: mockApiPost,
  },
}))

vi.mock('../constants', () => ({
  INVITE_CODE_LENGTH: 6,
  INVITE_CODE_MAX_USE: 50,
  SHARE_REWARD_INVITES: 3,
}))

describe('shareService', () => {
  beforeEach(() => {
    memoryStore.clear()
    mockApiGet.mockReset()
    mockApiPost.mockReset()
  })

  describe('getOrCreateInviteCode', () => {
    it('returns cached code when available', async () => {
      memoryStore.set('xhh_invite_code', 'ABC123')
      const code = await getOrCreateInviteCode('user-1')
      expect(code).toBe('ABC123')
      expect(mockApiGet).not.toHaveBeenCalled()
    })

    it('creates new code when none cached and API returns no code', async () => {
      // api.get returns a result without .code, so it falls through to local generation
      mockApiGet.mockResolvedValue({})
      const code = await getOrCreateInviteCode('user-1')
      expect(code).toHaveLength(6)
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/)
      expect(mockApiGet).toHaveBeenCalledWith('/api/invite-code')
      expect(memoryStore.get('xhh_invite_code')).toBe(code)
    })

    it('returns existing code from API when none cached', async () => {
      mockApiGet.mockResolvedValue({ code: 'XYZ789' })
      const code = await getOrCreateInviteCode('user-1')
      expect(code).toBe('XYZ789')
      expect(mockApiGet).toHaveBeenCalledWith('/api/invite-code')
      expect(memoryStore.get('xhh_invite_code')).toBe('XYZ789')
    })

    it('falls back to local generation when API call fails', async () => {
      mockApiGet.mockRejectedValue(new Error('Network error'))
      const code = await getOrCreateInviteCode('user-1')
      expect(code).toHaveLength(6)
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/)
      expect(memoryStore.get('xhh_invite_code')).toBe(code)
    })
  })

  describe('recordShare', () => {
    it('records share and returns record', async () => {
      const shareRecord = {
        id: 'rec-1',
        userId: 'user-1',
        cardType: 'food',
        petId: 'pet-1',
        sharedAt: '2025-01-01T00:00:00Z',
        platform: 'wechat',
        inviteCode: 'ABC123',
      }
      memoryStore.set('xhh_invite_code', 'ABC123')
      mockApiPost.mockResolvedValue(shareRecord)

      const result = await recordShare('user-1', 'food', 'pet-1', 'wechat')
      expect(result).toEqual(shareRecord)
      expect(mockApiPost).toHaveBeenCalledWith('/api/shares', {
        user_id: 'user-1',
        card_type: 'food',
        pet_id: 'pet-1',
        platform: 'wechat',
        invite_code: 'ABC123',
      })
      const history = memoryStore.get('xhh_share_history') as unknown[]
      expect(history).toHaveLength(1)
    })

    it('returns null on failure', async () => {
      memoryStore.set('xhh_invite_code', 'ABC123')
      mockApiPost.mockRejectedValue(new Error('insert failed'))

      const result = await recordShare('user-1', 'food', 'pet-1', 'wechat')
      expect(result).toBeNull()
    })
  })

  describe('getShareStats', () => {
    it('returns stats from local history and API referrals', async () => {
      memoryStore.set('xhh_share_history', [
        { id: '1', userId: 'user-1', cardType: 'food', petId: 'pet-1', sharedAt: '2025-01-01', platform: 'wechat', inviteCode: 'ABC' },
        { id: '2', userId: 'user-1', cardType: 'food', petId: 'pet-1', sharedAt: '2025-01-02', platform: 'wechat', inviteCode: 'ABC' },
        { id: '3', userId: 'user-1', cardType: 'health_trend', petId: 'pet-1', sharedAt: '2025-01-03', platform: 'wechat', inviteCode: 'ABC' },
        { id: '4', userId: 'user-1', cardType: 'vaccine', petId: 'pet-1', sharedAt: '2025-01-04', platform: 'wechat', inviteCode: 'ABC' },
      ])
      mockApiGet.mockResolvedValue([
        { id: 'r1', inviterId: 'user-1', inviteeId: 'user-2', inviteCode: 'ABC', registeredAt: '2025-01-05', rewardGranted: true },
        { id: 'r2', inviterId: 'user-1', inviteeId: 'user-3', inviteCode: 'ABC', registeredAt: '2025-01-06', rewardGranted: false },
      ])

      const stats = await getShareStats('user-1')
      expect(stats.totalShares).toBe(4)
      expect(stats.foodShares).toBe(2)
      expect(stats.trendShares).toBe(1)
      expect(stats.vaccineShares).toBe(1)
      expect(stats.achievementShares).toBe(0)
      expect(stats.totalInvites).toBe(2)
      expect(stats.successfulInvites).toBe(1)
    })

    it('returns zero invites when API call fails', async () => {
      memoryStore.set('xhh_share_history', [
        { id: '1', userId: 'user-1', cardType: 'food', petId: 'pet-1', sharedAt: '2025-01-01', platform: 'wechat', inviteCode: 'ABC' },
      ])
      mockApiGet.mockRejectedValue(new Error('Network error'))

      const stats = await getShareStats('user-1')
      expect(stats.totalShares).toBe(1)
      expect(stats.totalInvites).toBe(0)
      expect(stats.successfulInvites).toBe(0)
    })
  })

  describe('processReferral', () => {
    it('succeeds when API returns successfully', async () => {
      mockApiPost.mockResolvedValue({ success: true })

      const result = await processReferral('ABC123', 'new-user-1')
      expect(result).toBe(true)
      expect(mockApiPost).toHaveBeenCalledWith('/api/referrals/process', {
        invite_code: 'ABC123',
        invitee_id: 'new-user-1',
      })
    })

    it('fails when API call fails', async () => {
      mockApiPost.mockRejectedValue(new Error('Server error'))

      const result = await processReferral('ABC123', 'new-user-1')
      expect(result).toBe(false)
    })
  })

  describe('getLocalShareHistory', () => {
    it('returns empty array when no history', () => {
      const history = getLocalShareHistory()
      expect(history).toEqual([])
    })

    it('returns stored history', () => {
      const records = [
        { id: '1', userId: 'user-1', cardType: 'food', petId: 'pet-1', sharedAt: '2025-01-01', platform: 'wechat', inviteCode: 'ABC' },
      ]
      memoryStore.set('xhh_share_history', records)
      const history = getLocalShareHistory()
      expect(history).toEqual(records)
    })
  })

  describe('clearLocalShareHistory', () => {
    it('clears history', () => {
      memoryStore.set('xhh_share_history', [
        { id: '1', userId: 'user-1', cardType: 'food', petId: 'pet-1', sharedAt: '2025-01-01', platform: 'wechat', inviteCode: 'ABC' },
      ])
      clearLocalShareHistory()
      expect(memoryStore.has('xhh_share_history')).toBe(false)
      expect(getLocalShareHistory()).toEqual([])
    })
  })

  describe('processPendingReferral', () => {
    it('存在待处理邀请码时调用 processReferral 并清除', async () => {
      memoryStore.set('xhh_pending_invite_code', 'ABC123')
      mockApiPost.mockResolvedValue({})

      await processPendingReferral('user-1')

      expect(mockApiPost).toHaveBeenCalledWith('/api/referrals/process', {
        invite_code: 'ABC123',
        invitee_id: 'user-1',
      })
      expect(memoryStore.get('xhh_pending_invite_code')).toBeUndefined()
    })

    it('无待处理邀请码时不发起请求', async () => {
      await processPendingReferral('user-1')
      expect(mockApiPost).not.toHaveBeenCalled()
    })

    it('处理失败时保留邀请码供下次重试', async () => {
      memoryStore.set('xhh_pending_invite_code', 'ABC123')
      mockApiPost.mockRejectedValue(new Error('network error'))

      await processPendingReferral('user-1')

      expect(memoryStore.get('xhh_pending_invite_code')).toBe('ABC123')
    })
  })
})
