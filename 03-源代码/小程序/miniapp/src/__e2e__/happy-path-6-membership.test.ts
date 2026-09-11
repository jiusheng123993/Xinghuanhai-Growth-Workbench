/**
 * E2E 测试：会员订阅
 * 验证会员订阅和权益管理流程
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { api } from '../services/api'
import {
  getMembershipStatus,
  isMember,
  getQuotaLimit,
  getPetCountLimit,
  createPaymentOrder,
  confirmPayment,
  checkFeatureAccess,
  getOrders,
  MEMBERSHIP_PLANS,
  MEMBERSHIP_BENEFITS,
} from '../services/membershipService'
import type {
  MembershipInfo,
  PaymentOrder,
} from '../services/membershipService'

// ============================================================
// Happy Path 6: 会员订阅 → 权益验证
// ============================================================

const mockStorage: Record<string, string> = {}
vi.mock('../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = JSON.stringify(value)
  }),
}))

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getEnv: vi.fn(() => 'WEAPP'),
    requestPayment: vi.fn(),
    getStorageSync: vi.fn(),
    setStorageSync: vi.fn(),
  },
}))

const userId = 'user-001'

// ---- helpers ----

function makeMembershipInfo(overrides: Partial<MembershipInfo> = {}): MembershipInfo {
  return {
    userId,
    tier: 'member',
    plan: 'monthly',
    status: 'active',
    expiresAt: '2026-12-31T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    cancelledAt: null,
    paymentOrderId: 'order-001',
    price: 9.9,
    ...overrides,
  }
}

function makePaymentOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-001',
    userId,
    plan: 'monthly',
    amount: 9.9,
    status: 'pending',
    channel: 'wechat',
    createdAt: '2026-01-01T00:00:00.000Z',
    paidAt: null,
    ...overrides,
  }
}

describe('Happy Path 6: 会员订阅 → 权益验证', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  // ---- step 1: 获取免费用户会员状态 ----
  it('step 1: 获取免费用户会员状态 → 验证 tier=free, status=none', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const status = await getMembershipStatus(userId)

    expect(status.userId).toBe(userId)
    expect(status.tier).toBe('free')
    expect(status.plan).toBeNull()
    expect(status.status).toBe('none')
    expect(status.expiresAt).toBeNull()
    expect(status.startedAt).toBeNull()
  })

  // ---- step 2: 验证 isMember 对免费用户返回 false ----
  it('step 2: 验证 isMember 对免费用户返回 false', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const result = await isMember(userId)

    expect(result).toBe(false)
  })

  // ---- step 3: 检查 food_query 功能访问（免费用户） ----
  it('step 3: 检查 food_query 功能访问（免费用户）→ 验证 remaining=5, allowed=true', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const result = await checkFeatureAccess(userId, 'food_query')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(5)
    expect(result.isMember).toBe(false)
  })

  // ---- step 4: 检查 chronic_tracking 功能访问（免费用户） ----
  it('step 4: 检查 chronic_tracking 功能访问（免费用户）→ 验证 allowed=false（仅会员）', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const result = await checkFeatureAccess(userId, 'chronic_tracking')

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.isMember).toBe(false)
  })

  // ---- step 5: 获取 food_query 配额限制（免费用户） ----
  it('step 5: 获取 food_query 配额限制（免费用户）→ 验证为 5', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const limit = await getQuotaLimit('food_query', userId)

    expect(limit).toBe(5)
  })

  // ---- step 6: 获取宠物数量限制（免费用户） ----
  it('step 6: 获取宠物数量限制（免费用户）→ 验证为 2', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const limit = await getPetCountLimit(userId)

    expect(limit).toBe(2)
  })

  // ---- step 7: 创建月度会员支付订单 ----
  it('step 7: 创建月度会员支付订单 → 验证订单已创建', async () => {
    vi.mocked(api.post).mockResolvedValue({
      order_id: 'order-monthly',
      amount: 990,
      plan: 'monthly',
      payment: {
        appId: 'wx123',
        timeStamp: '1234567890',
        nonceStr: 'abc123',
        package: 'prepay_id=xxx',
        signType: 'RSA',
        paySign: 'sign123',
      },
    })

    const result = await createPaymentOrder(userId, 'monthly')

    expect(api.post).toHaveBeenCalledWith('/api/payment/membership/order', { plan: 'monthly' })
    expect(result.orderId).toBe('order-monthly')
    expect(result.amount).toBe(990)
    expect(result.channel).toBe('wechat')
    expect(result.paymentParams).toBeDefined()
    expect(result.paymentParams!.appId).toBe('wx123')
  })

  // ---- step 8: 确认支付 ----
  it('step 8: 确认支付 → 验证会员状态更新为 active member', async () => {
    const activeMembership = makeMembershipInfo({
      tier: 'member',
      status: 'active',
      plan: 'monthly',
      price: 9.9,
      paymentOrderId: 'order-monthly',
    })
    vi.mocked(api.get).mockResolvedValue(activeMembership)

    const info = await confirmPayment(userId, 'order-monthly')

    expect(api.get).toHaveBeenCalledWith('/api/membership/status')
    expect(info.tier).toBe('member')
    expect(info.status).toBe('active')
    expect(info.plan).toBe('monthly')
    expect(info.price).toBe(9.9)
  })

  // ---- step 9: 验证 isMember 返回 true（支付后） ----
  it('step 9: 验证 isMember 返回 true（支付后）', async () => {
    // 模拟 confirmPayment 已将会员信息写入本地存储
    const activeMembership = makeMembershipInfo({
      tier: 'member',
      status: 'active',
      expiresAt: '2026-12-31T00:00:00.000Z',
    })
    mockStorage[`membership_${userId}`] = JSON.stringify(activeMembership)
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const result = await isMember(userId)

    expect(result).toBe(true)
  })

  // ---- step 10: 获取 food_query 配额限制（会员） ----
  it('step 10: 获取 food_query 配额限制（会员）→ 验证为 Infinity', async () => {
    const activeMembership = makeMembershipInfo({
      tier: 'member',
      status: 'active',
      expiresAt: '2026-12-31T00:00:00.000Z',
    })
    mockStorage[`membership_${userId}`] = JSON.stringify(activeMembership)
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const limit = await getQuotaLimit('food_query', userId)

    expect(limit).toBe(Infinity)
  })

  // ---- step 11: 获取宠物数量限制（会员） ----
  it('step 11: 获取宠物数量限制（会员）→ 验证为 5', async () => {
    const activeMembership = makeMembershipInfo({
      tier: 'member',
      status: 'active',
      expiresAt: '2026-12-31T00:00:00.000Z',
    })
    mockStorage[`membership_${userId}`] = JSON.stringify(activeMembership)
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const limit = await getPetCountLimit(userId)

    expect(limit).toBe(5)
  })

  // ---- step 12: 检查 chronic_tracking 功能访问（会员） ----
  it('step 12: 检查 chronic_tracking 功能访问（会员）→ 验证 allowed=true', async () => {
    const activeMembership = makeMembershipInfo({
      tier: 'member',
      status: 'active',
      expiresAt: '2026-12-31T00:00:00.000Z',
    })
    mockStorage[`membership_${userId}`] = JSON.stringify(activeMembership)
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const result = await checkFeatureAccess(userId, 'chronic_tracking')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(Infinity)
    expect(result.isMember).toBe(true)
  })

  // ---- step 13: 获取订单历史 ----
  it('step 13: 获取订单历史 → 验证订单记录', async () => {
    const localOrders = [
      makePaymentOrder({ id: 'order-001', plan: 'monthly', amount: 9.9 }),
      makePaymentOrder({ id: 'order-002', plan: 'quarterly', amount: 25.9 }),
    ]
    mockStorage[`membership_orders_${userId}`] = JSON.stringify(localOrders)
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const orders = await getOrders(userId)

    expect(orders).toHaveLength(2)
    expect(orders[0].id).toBe('order-001')
    expect(orders[0].plan).toBe('monthly')
    expect(orders[0].amount).toBe(9.9)
    expect(orders[1].id).toBe('order-002')
    expect(orders[1].plan).toBe('quarterly')
    expect(orders[1].amount).toBe(25.9)
  })

  // ---- step 14: MEMBERSHIP_PLANS 常量 ----
  it('step 14: MEMBERSHIP_PLANS 常量 → 验证 3 个方案及促销价格', () => {
    expect(MEMBERSHIP_PLANS).toHaveLength(3)

    const monthly = MEMBERSHIP_PLANS.find((p) => p.plan === 'monthly')!
    expect(monthly).toBeDefined()
    expect(monthly.label).toBe('月度会员')
    expect(monthly.price).toBe(9.9)
    expect(monthly.originalPrice).toBe(29.9)
    expect(monthly.discountLabel).toBe('限时3.3折')
    expect(monthly.durationDays).toBe(30)

    const quarterly = MEMBERSHIP_PLANS.find((p) => p.plan === 'quarterly')!
    expect(quarterly).toBeDefined()
    expect(quarterly.label).toBe('季度会员')
    expect(quarterly.price).toBe(25.9)
    expect(quarterly.originalPrice).toBe(79.9)
    expect(quarterly.discountLabel).toBe('限时3.3折')
    expect(quarterly.durationDays).toBe(90)

    const yearly = MEMBERSHIP_PLANS.find((p) => p.plan === 'yearly')!
    expect(yearly).toBeDefined()
    expect(yearly.label).toBe('年度会员')
    expect(yearly.price).toBe(88)
    expect(yearly.originalPrice).toBe(269)
    expect(yearly.discountLabel).toBe('限时3.3折')
    expect(yearly.durationDays).toBe(365)
  })

  // ---- step 15: MEMBERSHIP_BENEFITS 常量 ----
  it('step 15: MEMBERSHIP_BENEFITS 常量 → 验证 9 项权益且结构正确', () => {
    expect(MEMBERSHIP_BENEFITS).toHaveLength(9)

    // 验证特定权益的结构
    const foodQuery = MEMBERSHIP_BENEFITS.find((b) => b.featureKey === 'food_query')!
    expect(foodQuery).toBeDefined()
    expect(foodQuery.featureName).toBe('食物安全查询')
    expect(foodQuery.freeValue).toBe('每日5次')
    expect(foodQuery.memberValue).toBe('不限')
    expect(foodQuery.isHighlight).toBe(true)

    const chronicTracking = MEMBERSHIP_BENEFITS.find((b) => b.featureKey === 'chronic_tracking')!
    expect(chronicTracking).toBeDefined()
    expect(chronicTracking.featureName).toBe('慢性病追踪')
    expect(chronicTracking.freeValue).toBe('❌')
    expect(chronicTracking.memberValue).toBe('✅')
    expect(chronicTracking.isHighlight).toBe(false)

    // 验证所有权益都有必要字段
    for (const benefit of MEMBERSHIP_BENEFITS) {
      expect(benefit.featureKey).toBeTruthy()
      expect(benefit.featureName).toBeTruthy()
      expect(typeof benefit.freeValue).toBe('string')
      expect(typeof benefit.memberValue).toBe('string')
      expect(typeof benefit.isHighlight).toBe('boolean')
    }
  })
})