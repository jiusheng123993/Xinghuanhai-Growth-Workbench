/**
 * useMembership 测试
 * 验证会员体系 Hook 的订阅、权限校验和会员状态
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useMembershipStore } from '../stores/membershipStore'
import { useMembership } from './useMembership'

const {
  mockSubscribePlan,
  mockCheckAccess,
} = vi.hoisted(() => ({
  mockSubscribePlan: vi.fn(),
  mockCheckAccess: vi.fn(),
}))

vi.mock('react', () => {
  const actual = {
    useCallback: (fn: any) => fn,
    useEffect: (fn: any) => { fn() },
    useMemo: (fn: any) => fn(),
    useReducer: (reducer: any, initialState: any) => [initialState, vi.fn()],
    useState: (initial: any) => [initial, vi.fn()],
    useRef: (initial: any) => ({ current: initial }),
  }
  return { ...actual, default: actual }
})

const defaultMockStore = {
  userId: '',
  membership: null,
  orders: [],
  isLoading: false,
  error: null,
  initUser: vi.fn(),
  fetchMembership: vi.fn(),
  subscribePlan: mockSubscribePlan,
  cancelSubscription: vi.fn(),
  restorePurchaseStatus: vi.fn(),
  fetchOrders: vi.fn(),
  checkAccess: mockCheckAccess,
  shouldShowPaywallForFeature: vi.fn(),
  markPaywallShownForFeature: vi.fn(),
  getPetLimit: vi.fn(),
  clearError: vi.fn(),
}

vi.mock('../stores/membershipStore', () => ({
  useMembershipStore: vi.fn(() => ({ ...defaultMockStore }))
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn(() => ''),
}))

describe('useMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useMembershipStore).mockReturnValue({ ...defaultMockStore })
  })

  it('返回值包含所有预期字段', () => {
    const result = useMembership()
    expect(result).toHaveProperty('membership')
    expect(result).toHaveProperty('orders')
    expect(result).toHaveProperty('isLoading')
    expect(result).toHaveProperty('error')
    expect(result).toHaveProperty('isMember')
    expect(result).toHaveProperty('initUser')
    expect(result).toHaveProperty('subscribePlan')
    expect(result).toHaveProperty('cancelSubscription')
    expect(result).toHaveProperty('restorePurchaseStatus')
    expect(result).toHaveProperty('refreshMembership')
    expect(result).toHaveProperty('checkAccess')
    expect(result).toHaveProperty('shouldShowPaywall')
    expect(result).toHaveProperty('markPaywallShown')
    expect(result).toHaveProperty('getPetLimit')
    expect(result).toHaveProperty('clearError')
  })

  it('subscribePlan 调用 store 的 subscribePlan', () => {
    const result = useMembership()
    const plan = 'monthly'
    result.subscribePlan(plan)
    expect(mockSubscribePlan).toHaveBeenCalledWith(plan)
  })

  it('checkAccess 调用 store 的 checkAccess', () => {
    const result = useMembership()
    result.checkAccess('ai_diagnosis')
    expect(mockCheckAccess).toHaveBeenCalledWith('ai_diagnosis')
  })

  it('会员且活跃时 isMember 为 true', () => {
    vi.mocked(useMembershipStore).mockReturnValue({
      ...defaultMockStore,
      membership: { level: 'member', status: 'active' },
    })
    const result = useMembership()
    expect(result.isMember).toBe(true)
  })

  it('会员但非活跃时 isMember 为 false', () => {
    vi.mocked(useMembershipStore).mockReturnValue({
      ...defaultMockStore,
      membership: { level: 'member', status: 'expired' },
    })
    const result = useMembership()
    expect(result.isMember).toBe(false)
  })

  it('非会员时 isMember 为 false', () => {
    vi.mocked(useMembershipStore).mockReturnValue({
      ...defaultMockStore,
      membership: { level: 'free', status: 'active' },
    })
    const result = useMembership()
    expect(result.isMember).toBe(false)
  })

  it('无 membership 时 isMember 为 false', () => {
    const result = useMembership()
    expect(result.isMember).toBe(false)
  })
})