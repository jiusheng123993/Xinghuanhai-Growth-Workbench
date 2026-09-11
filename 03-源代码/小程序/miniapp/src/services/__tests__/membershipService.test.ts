/**
 * 会员服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { api } from '../api'
import {
  getMembershipStatus,
  isMember,
  getQuotaLimit,
  createPaymentOrder,
  requestWechatPayment,
  pollOrderStatus,
  confirmPayment,
  cancelMembership,
  shouldShowPaywall,
  markPaywallShown,
  checkFeatureAccess,
  restorePurchase,
  getOrders,
} from '../membershipService'
import type { MembershipInfo, PaymentOrder } from '../membershipService'

const mockStorage: Record<string, string> = {}

vi.mock('../../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[`xhh_${key}`]
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[`xhh_${key}`] = JSON.stringify(value)
  }),
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[`xhh_${key}`]
  }),
}))

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getEnv: vi.fn(() => 'WEAPP'),
    requestPayment: vi.fn(),
  },
}))

const userId = 'user-001'

function makeMembershipInfo(overrides: Partial<MembershipInfo> = {}): MembershipInfo {
  return {
    userId,
    tier: 'member',
    plan: 'monthly',
    status: 'active',
    expiresAt: '2025-12-31T00:00:00.000Z',
    startedAt: '2025-01-01T00:00:00.000Z',
    cancelledAt: null,
    paymentOrderId: 'order_001',
    price: 9.9,
    ...overrides,
  }
}

function makePaymentOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order_001',
    userId,
    plan: 'monthly',
    amount: 9.9,
    status: 'pending',
    channel: 'wechat',
    createdAt: '2025-01-01T00:00:00.000Z',
    paidAt: null,
    ...overrides,
  }
}

describe('membershipService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  describe('getMembershipStatus', () => {
    it('should return free status for new user', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const status = await getMembershipStatus(userId)

      expect(status.userId).toBe(userId)
      expect(status.tier).toBe('free')
      expect(status.plan).toBeNull()
      expect(status.status).toBe('none')
      expect(status.expiresAt).toBeNull()
    })

    it('should return membership from API when available', async () => {
      const mockInfo = makeMembershipInfo()
      vi.mocked(api.get).mockResolvedValue(mockInfo)

      const status = await getMembershipStatus(userId)

      expect(status.tier).toBe('member')
      expect(status.status).toBe('active')
      expect(status.plan).toBe('monthly')
      expect(api.get).toHaveBeenCalledWith('/api/membership/status')
    })

    it('should fallback to local storage when API fails', async () => {
      const localInfo = makeMembershipInfo({ tier: 'member', status: 'active', expiresAt: '2099-12-31T00:00:00.000Z' })
      mockStorage[`xhh_membership_${userId}`] = JSON.stringify(localInfo)
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const status = await getMembershipStatus(userId)

      expect(status.tier).toBe('member')
      expect(status.status).toBe('active')
    })

    it('should throw when userId is empty', async () => {
      await expect(getMembershipStatus('')).rejects.toThrow('[MembershipService] userId is required')
    })
  })

  describe('isMember', () => {
    it('should return false for new user', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await isMember(userId)

      expect(result).toBe(false)
    })
  })

  describe('getQuotaLimit', () => {
    it('should return limited quota for free user', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      expect(await getQuotaLimit('checkin', userId)).toBe(5)
      expect(await getQuotaLimit('food_query', userId)).toBe(5)
      expect(await getQuotaLimit('symptom_check', userId)).toBe(2)
      expect(await getQuotaLimit('health_trend', userId)).toBe(7)
    })

    it('should return 0 for unknown feature', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      expect(await getQuotaLimit('unknown_feature', userId)).toBe(0)
    })

    it('should return Infinity for member user', async () => {
      const mockInfo = makeMembershipInfo()
      vi.mocked(api.get).mockResolvedValue(mockInfo)

      expect(await getQuotaLimit('food_query', userId)).toBe(Infinity)
      expect(await getQuotaLimit('symptom_check', userId)).toBe(Infinity)
    })
  })

  describe('createPaymentOrder', () => {
    it('should create order via API and return CreateOrderResult', async () => {
      const mockResult = {
        order_id: 'order_001',
        amount: 990,
        plan: 'monthly',
        payment: {
          appId: 'wx123',
          timeStamp: '1234567890',
          nonceStr: 'abc',
          package: 'prepay_id=xxx',
          signType: 'RSA' as const,
          paySign: 'sign123',
        },
      }
      vi.mocked(api.post).mockResolvedValue(mockResult)

      const result = await createPaymentOrder(userId, 'monthly')

      expect(result.orderId).toBe('order_001')
      expect(result.amount).toBe(990)
      expect(result.channel).toBe('wechat')
      expect(result.paymentParams).toBeDefined()
      expect(result.paymentParams?.appId).toBe('wx123')
      expect(api.post).toHaveBeenCalledWith('/api/payment/membership/order', { plan: 'monthly' })
    })

    it('should throw when userId is empty', async () => {
      await expect(createPaymentOrder('', 'monthly')).rejects.toThrow('[MembershipService] userId is required')
    })
  })

  describe('confirmPayment', () => {
    it('should sync local order and refresh membership after payment', async () => {
      const mockInfo = makeMembershipInfo()
      mockStorage[`xhh_membership_orders_${userId}`] = JSON.stringify([makePaymentOrder()])
      vi.mocked(api.get).mockResolvedValue(mockInfo)

      const info = await confirmPayment(userId, 'order_001')

      expect(info.tier).toBe('member')
      expect(info.status).toBe('active')
      expect(info.plan).toBe('monthly')
      expect(api.get).toHaveBeenCalledWith('/api/membership/status')
      const saved = JSON.parse(mockStorage[`xhh_membership_orders_${userId}`])
      expect(saved[0].status).toBe('paid')
    })

    it('should throw when userId is empty', async () => {
      await expect(confirmPayment('', 'order-1')).rejects.toThrow('[MembershipService] userId is required')
    })
  })

  describe('cancelMembership', () => {
    it('should cancel membership via API when available', async () => {
      const localInfo = makeMembershipInfo({ expiresAt: '2099-12-31T00:00:00.000Z' })
      mockStorage[`xhh_membership_${userId}`] = JSON.stringify(localInfo)
      vi.mocked(api.post).mockResolvedValue({ message: '会员已取消', expiresAt: '2099-12-31T00:00:00.000Z' })

      const info = await cancelMembership(userId)

      expect(info.status).toBe('cancelled')
      expect(info.cancelledAt).not.toBeNull()
      expect(api.post).toHaveBeenCalledWith('/api/membership/cancel', {})
    })

    it('should set status to cancelled locally when API fails', async () => {
      const localInfo = makeMembershipInfo({ expiresAt: '2099-12-31T00:00:00.000Z' })
      mockStorage[`xhh_membership_${userId}`] = JSON.stringify(localInfo)
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))

      const info = await cancelMembership(userId)

      expect(info.cancelledAt).not.toBeNull()
    })

    it('should throw when not a member', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))

      await expect(cancelMembership(userId)).rejects.toThrow('[MembershipService] Not a member')
    })

    it('should throw when userId is empty', async () => {
      await expect(cancelMembership('')).rejects.toThrow('[MembershipService] userId is required')
    })
  })

  describe('restorePurchase', () => {
    it('should restore purchase via API when available', async () => {
      const mockInfo = makeMembershipInfo()
      vi.mocked(api.get).mockResolvedValue(mockInfo)

      const info = await restorePurchase(userId)

      expect(info.tier).toBe('member')
      expect(info.status).toBe('active')
      expect(api.get).toHaveBeenCalledWith('/api/membership/status')
    })

    it('should fallback to local membership when API fails', async () => {
      const localInfo = makeMembershipInfo({ expiresAt: '2099-12-31T00:00:00.000Z' })
      mockStorage[`xhh_membership_${userId}`] = JSON.stringify(localInfo)
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const info = await restorePurchase(userId)

      expect(info.tier).toBe('member')
      expect(info.status).toBe('active')
    })

    it('should return free status when no local record exists', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const info = await restorePurchase(userId)

      expect(info.tier).toBe('free')
      expect(info.status).toBe('none')
    })

    it('should throw when userId is empty', async () => {
      await expect(restorePurchase('')).rejects.toThrow('[MembershipService] userId is required')
    })
  })

  describe('getOrders', () => {
    it('should return local orders', async () => {
      const localOrders = [makePaymentOrder(), makePaymentOrder({ id: 'order_002', plan: 'yearly', amount: 88 })]
      mockStorage[`xhh_membership_orders_${userId}`] = JSON.stringify(localOrders)

      const orders = await getOrders(userId)

      expect(orders).toHaveLength(2)
      expect(orders[0].id).toBe('order_001')
      expect(orders[1].id).toBe('order_002')
    })

    it('should return empty array when no orders exist', async () => {
      const orders = await getOrders(userId)

      expect(orders).toEqual([])
    })

    it('should throw when userId is empty', async () => {
      await expect(getOrders('')).rejects.toThrow('[MembershipService] userId is required')
    })
  })

  describe('shouldShowPaywall', () => {
    it('should return true for free user on first visit', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await shouldShowPaywall(userId, 'food_query')

      expect(result).toBe(true)
    })

    it('should return false for member', async () => {
      const mockInfo = makeMembershipInfo()
      vi.mocked(api.get).mockResolvedValue(mockInfo)

      const result = await shouldShowPaywall(userId, 'food_query')

      expect(result).toBe(false)
    })

    it('should return false when userId is empty', async () => {
      const result = await shouldShowPaywall('', 'food_query')

      expect(result).toBe(false)
    })
  })

  describe('markPaywallShown', () => {
    it('should prevent showing paywall again same day', async () => {
      await markPaywallShown(userId, 'food_query')

      const result = await shouldShowPaywall(userId, 'food_query')

      expect(result).toBe(false)
    })

    it('should not affect different feature', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))
      await markPaywallShown(userId, 'food_query')

      const result = await shouldShowPaywall(userId, 'symptom_check')

      expect(result).toBe(true)
    })
  })

  describe('checkFeatureAccess', () => {
    it('should allow free user within quota', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await checkFeatureAccess(userId, 'food_query')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
      expect(result.isMember).toBe(false)
    })

    it('should deny free user when quota exhausted', async () => {
      const todayKey = new Date().toISOString().slice(0, 10)
      mockStorage[`xhh_quota_food_query_${todayKey}_${userId}`] = JSON.stringify(5)
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await checkFeatureAccess(userId, 'food_query')

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.isMember).toBe(false)
    })

    it('should deny free user for feature with no free quota', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await checkFeatureAccess(userId, 'health_report')

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should always allow member', async () => {
      const mockInfo = makeMembershipInfo({ expiresAt: '2099-12-31T00:00:00.000Z' })
      mockStorage[`xhh_membership_${userId}`] = JSON.stringify(mockInfo)
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await checkFeatureAccess(userId, 'food_query')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(Infinity)
      expect(result.isMember).toBe(true)
    })

    it('should throw when userId is empty', async () => {
      await expect(checkFeatureAccess('', 'food_query')).rejects.toThrow('[MembershipService] userId is required')
    })
  })
})
