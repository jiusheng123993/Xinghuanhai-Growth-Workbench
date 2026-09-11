/**
 * useReminder 测试
 * 验证疫苗/驱虫提醒 Hook 的订阅、查询和本地提醒调度
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useReminderStore } from '../../stores/reminderStore'
import { useReminder } from '../useReminder'

const {
  mockFetchSubscriptionStatus,
  mockRequestSubscription,
  mockFetchUpcomingReminders,
  mockFetchOverdueReminders,
  mockToggleSubscription,
  mockClearError,
} = vi.hoisted(() => ({
  mockFetchSubscriptionStatus: vi.fn(),
  mockRequestSubscription: vi.fn(),
  mockFetchUpcomingReminders: vi.fn(),
  mockFetchOverdueReminders: vi.fn(),
  mockToggleSubscription: vi.fn(),
  mockClearError: vi.fn(),
}))

const {
  mockCheckUpcomingReminders,
  mockScheduleLocalReminder,
  mockGetLocalReminders,
  mockMarkReminderTriggered,
  mockClearLocalReminders,
} = vi.hoisted(() => ({
  mockCheckUpcomingReminders: vi.fn(),
  mockScheduleLocalReminder: vi.fn(),
  mockGetLocalReminders: vi.fn(),
  mockMarkReminderTriggered: vi.fn(),
  mockClearLocalReminders: vi.fn(),
}))

vi.mock('react', () => {
  const actual = { useCallback: (fn: any) => fn, useEffect: (fn: any) => fn() }
  return { ...actual, default: actual }
})

const defaultMockStore = {
  subscriptionStatus: false,
  upcomingReminders: [],
  overdueReminders: [],
  isLoading: false,
  error: null,
  fetchSubscriptionStatus: mockFetchSubscriptionStatus,
  requestSubscription: mockRequestSubscription,
  fetchUpcomingReminders: mockFetchUpcomingReminders,
  fetchOverdueReminders: mockFetchOverdueReminders,
  toggleSubscription: mockToggleSubscription,
  clearError: mockClearError,
}

vi.mock('../../stores/reminderStore', () => ({
  useReminderStore: vi.fn(() => ({ ...defaultMockStore }))
}))

vi.mock('../../services/reminderService', () => ({
  checkUpcomingReminders: mockCheckUpcomingReminders,
  scheduleLocalReminder: mockScheduleLocalReminder,
  getLocalReminders: mockGetLocalReminders,
  markReminderTriggered: mockMarkReminderTriggered,
  clearLocalReminders: mockClearLocalReminders,
}))

describe('useReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useReminderStore).mockReturnValue({ ...defaultMockStore })
  })

  it('返回值包含所有预期字段', () => {
    const result = useReminder()
    expect(result).toHaveProperty('subscriptionStatus')
    expect(result).toHaveProperty('upcomingReminders')
    expect(result).toHaveProperty('overdueReminders')
    expect(result).toHaveProperty('isLoading')
    expect(result).toHaveProperty('error')
    expect(result).toHaveProperty('fetchSubscriptionStatus')
    expect(result).toHaveProperty('requestSubscription')
    expect(result).toHaveProperty('fetchUpcomingReminders')
    expect(result).toHaveProperty('fetchOverdueReminders')
    expect(result).toHaveProperty('toggleSubscription')
    expect(result).toHaveProperty('checkReminders')
    expect(result).toHaveProperty('scheduleReminder')
    expect(result).toHaveProperty('getReminders')
    expect(result).toHaveProperty('markTriggered')
    expect(result).toHaveProperty('clearReminders')
    expect(result).toHaveProperty('clearError')
  })

  it('返回 store 中的 subscriptionStatus', () => {
    vi.mocked(useReminderStore).mockReturnValue({ ...defaultMockStore, subscriptionStatus: true })
    const result = useReminder()
    expect(result.subscriptionStatus).toBe(true)
  })

  it('返回 store 中的 upcomingReminders', () => {
    const upcomingReminders = [{ record: { id: 'v1' }, daysUntilDue: 3, isOverdue: false }] as any[]
    vi.mocked(useReminderStore).mockReturnValue({ ...defaultMockStore, upcomingReminders })
    const result = useReminder()
    expect(result.upcomingReminders).toEqual(upcomingReminders)
  })

  it('返回 store 中的 overdueReminders', () => {
    const overdueReminders = [{ record: { id: 'v2' }, daysUntilDue: -2, isOverdue: true }] as any[]
    vi.mocked(useReminderStore).mockReturnValue({ ...defaultMockStore, overdueReminders })
    const result = useReminder()
    expect(result.overdueReminders).toEqual(overdueReminders)
  })

  it('返回 store 中的 isLoading', () => {
    vi.mocked(useReminderStore).mockReturnValue({ ...defaultMockStore, isLoading: true })
    const result = useReminder()
    expect(result.isLoading).toBe(true)
  })

  it('返回 store 中的 error', () => {
    vi.mocked(useReminderStore).mockReturnValue({ ...defaultMockStore, error: '请求失败' })
    const result = useReminder()
    expect(result.error).toBe('请求失败')
  })

  it('fetchSubscriptionStatus 调用 store 的 fetchSubscriptionStatus', () => {
    const result = useReminder()
    result.fetchSubscriptionStatus()
    expect(mockFetchSubscriptionStatus).toHaveBeenCalled()
  })

  it('requestSubscription 调用 store 的 requestSubscription 并返回结果', async () => {
    mockRequestSubscription.mockResolvedValue(true)
    const result = useReminder()
    const returned = await result.requestSubscription()
    expect(mockRequestSubscription).toHaveBeenCalled()
    expect(returned).toBe(true)
  })

  it('requestSubscription 返回 false', async () => {
    mockRequestSubscription.mockResolvedValue(false)
    const result = useReminder()
    const returned = await result.requestSubscription()
    expect(returned).toBe(false)
  })

  it('fetchUpcomingReminders 调用 store 的 fetchUpcomingReminders 不传 days', () => {
    const result = useReminder()
    result.fetchUpcomingReminders('pet-1')
    expect(mockFetchUpcomingReminders).toHaveBeenCalledWith('pet-1', undefined)
  })

  it('fetchUpcomingReminders 调用 store 的 fetchUpcomingReminders 传递 days', () => {
    const result = useReminder()
    result.fetchUpcomingReminders('pet-1', 14)
    expect(mockFetchUpcomingReminders).toHaveBeenCalledWith('pet-1', 14)
  })

  it('fetchOverdueReminders 调用 store 的 fetchOverdueReminders', () => {
    const result = useReminder()
    result.fetchOverdueReminders('pet-1')
    expect(mockFetchOverdueReminders).toHaveBeenCalledWith('pet-1')
  })

  it('toggleSubscription 调用 store 的 toggleSubscription', () => {
    const result = useReminder()
    result.toggleSubscription(true)
    expect(mockToggleSubscription).toHaveBeenCalledWith(true)
  })

  it('toggleSubscription 传递 false', () => {
    const result = useReminder()
    result.toggleSubscription(false)
    expect(mockToggleSubscription).toHaveBeenCalledWith(false)
  })

  it('checkReminders 调用 reminderService 的 checkUpcomingReminders', () => {
    const mockItems = [{ record: { id: 'v1' }, daysUntilDue: 3, isOverdue: false }] as any[]
    mockCheckUpcomingReminders.mockReturnValue(mockItems)
    const result = useReminder()
    const returned = result.checkReminders('pet-1')
    expect(mockCheckUpcomingReminders).toHaveBeenCalledWith('pet-1')
    expect(returned).toEqual(mockItems)
  })

  it('scheduleReminder 调用 reminderService 的 scheduleLocalReminder', () => {
    const mockReminder = { recordId: 'v1', petId: 'p1', category: 'core', nextDate: '2026-01-01', daysBefore: 3, scheduledAt: Date.now(), triggered: false } as any
    mockScheduleLocalReminder.mockReturnValue(mockReminder)
    const record = { id: 'v1', petId: 'p1', name: '狂犬疫苗', date: '2025-01-01', nextDate: '2026-01-01', status: 'pending', category: 'core', createdAt: '2025-01-01' } as any
    const result = useReminder()
    const returned = result.scheduleReminder(record, 3)
    expect(mockScheduleLocalReminder).toHaveBeenCalledWith(record, 3)
    expect(returned).toEqual(mockReminder)
  })

  it('getReminders 调用 reminderService 的 getLocalReminders', () => {
    const mockReminders = [{ recordId: 'v1', petId: 'p1', triggered: false }] as any[]
    mockGetLocalReminders.mockReturnValue(mockReminders)
    const result = useReminder()
    const returned = result.getReminders()
    expect(mockGetLocalReminders).toHaveBeenCalled()
    expect(returned).toEqual(mockReminders)
  })

  it('markTriggered 调用 reminderService 的 markReminderTriggered', () => {
    const result = useReminder()
    result.markTriggered('record-1')
    expect(mockMarkReminderTriggered).toHaveBeenCalledWith('record-1')
  })

  it('clearReminders 调用 reminderService 的 clearLocalReminders', () => {
    const result = useReminder()
    result.clearReminders('pet-1')
    expect(mockClearLocalReminders).toHaveBeenCalledWith('pet-1')
  })

  it('clearError 调用 store 的 clearError', () => {
    const result = useReminder()
    result.clearError()
    expect(mockClearError).toHaveBeenCalled()
  })
})
