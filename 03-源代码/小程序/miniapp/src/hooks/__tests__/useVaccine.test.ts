/**
 * useVaccine 测试
 * 验证疫苗管理 Hook 的增删改查和提醒功能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useVaccineStore } from '../../stores/vaccineStore'
import { useVaccine } from '../useVaccine'

const {
  mockFetchRecords,
  mockAddRecord,
  mockUpdateRecord,
  mockRemoveRecord,
  mockMarkCompleted,
  mockFetchUpcoming,
  mockFetchOverdue,
  mockInitPlan,
  mockGetRecordsByMonth,
  mockClearError,
} = vi.hoisted(() => ({
  mockFetchRecords: vi.fn(),
  mockAddRecord: vi.fn(),
  mockUpdateRecord: vi.fn(),
  mockRemoveRecord: vi.fn(),
  mockMarkCompleted: vi.fn(),
  mockFetchUpcoming: vi.fn(),
  mockFetchOverdue: vi.fn(),
  mockInitPlan: vi.fn(),
  mockGetRecordsByMonth: vi.fn(),
  mockClearError: vi.fn(),
}))

vi.mock('react', () => {
  const actual = { useCallback: (fn: any) => fn, useEffect: (fn: any) => fn() }
  return { ...actual, default: actual }
})

const defaultMockStore = {
  records: [],
  upcomingRecords: [],
  overdueRecords: [],
  isLoading: false,
  error: null,
  fetchRecords: mockFetchRecords,
  addRecord: mockAddRecord,
  updateRecord: mockUpdateRecord,
  removeRecord: mockRemoveRecord,
  markCompleted: mockMarkCompleted,
  fetchUpcoming: mockFetchUpcoming,
  fetchOverdue: mockFetchOverdue,
  initPlan: mockInitPlan,
  getRecordsByMonth: mockGetRecordsByMonth,
  clearError: mockClearError,
}

vi.mock('../../stores/vaccineStore', () => ({
  useVaccineStore: vi.fn(() => ({ ...defaultMockStore }))
}))

describe('useVaccine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useVaccineStore).mockReturnValue({ ...defaultMockStore })
  })

  it('返回值包含所有预期字段', () => {
    const result = useVaccine()
    expect(result).toHaveProperty('records')
    expect(result).toHaveProperty('upcomingRecords')
    expect(result).toHaveProperty('overdueRecords')
    expect(result).toHaveProperty('isLoading')
    expect(result).toHaveProperty('error')
    expect(result).toHaveProperty('fetchRecords')
    expect(result).toHaveProperty('addRecord')
    expect(result).toHaveProperty('updateRecord')
    expect(result).toHaveProperty('removeRecord')
    expect(result).toHaveProperty('markCompleted')
    expect(result).toHaveProperty('fetchUpcoming')
    expect(result).toHaveProperty('fetchOverdue')
    expect(result).toHaveProperty('initPlan')
    expect(result).toHaveProperty('getRecordsByMonth')
    expect(result).toHaveProperty('clearError')
  })

  it('返回 store 中的 records', () => {
    const records = [{ id: 'v1', petId: 'p1', name: '狂犬疫苗', date: '2025-01-01', nextDate: '2026-01-01', status: 'pending', category: 'core', createdAt: '2025-01-01' }] as any[]
    vi.mocked(useVaccineStore).mockReturnValue({ ...defaultMockStore, records })
    const result = useVaccine()
    expect(result.records).toEqual(records)
  })

  it('返回 store 中的 upcomingRecords', () => {
    const upcomingRecords = [{ id: 'v2' }] as any[]
    vi.mocked(useVaccineStore).mockReturnValue({ ...defaultMockStore, upcomingRecords })
    const result = useVaccine()
    expect(result.upcomingRecords).toEqual(upcomingRecords)
  })

  it('返回 store 中的 overdueRecords', () => {
    const overdueRecords = [{ id: 'v3' }] as any[]
    vi.mocked(useVaccineStore).mockReturnValue({ ...defaultMockStore, overdueRecords })
    const result = useVaccine()
    expect(result.overdueRecords).toEqual(overdueRecords)
  })

  it('返回 store 中的 isLoading', () => {
    vi.mocked(useVaccineStore).mockReturnValue({ ...defaultMockStore, isLoading: true })
    const result = useVaccine()
    expect(result.isLoading).toBe(true)
  })

  it('返回 store 中的 error', () => {
    vi.mocked(useVaccineStore).mockReturnValue({ ...defaultMockStore, error: '加载失败' })
    const result = useVaccine()
    expect(result.error).toBe('加载失败')
  })

  it('fetchRecords 调用 store 的 fetchRecords', async () => {
    mockFetchRecords.mockResolvedValue(undefined)
    const result = useVaccine()
    await result.fetchRecords('pet-1')
    expect(mockFetchRecords).toHaveBeenCalledWith('pet-1')
  })

  it('addRecord 调用 store 的 addRecord 并返回结果', async () => {
    const newRecord = { id: 'v1', petId: 'p1', name: '狂犬疫苗', date: '2025-01-01', nextDate: '2026-01-01', status: 'pending', category: 'core', createdAt: '2025-01-01' } as any
    mockAddRecord.mockResolvedValue(newRecord)
    const result = useVaccine()
    const data = { petId: 'p1', name: '狂犬疫苗', date: '2025-01-01', nextDate: '2026-01-01', category: 'core' } as any
    const returned = await result.addRecord(data)
    expect(mockAddRecord).toHaveBeenCalledWith(data)
    expect(returned).toEqual(newRecord)
  })

  it('updateRecord 调用 store 的 updateRecord', async () => {
    mockUpdateRecord.mockResolvedValue(undefined)
    const result = useVaccine()
    const data: Partial<Omit<import('../../services/vaccineService').VaccineRecord, 'id' | 'petId' | 'createdAt'>> = { status: 'completed' }
    await result.updateRecord('v1', data)
    expect(mockUpdateRecord).toHaveBeenCalledWith('v1', data)
  })

  it('removeRecord 调用 store 的 removeRecord', async () => {
    mockRemoveRecord.mockResolvedValue(undefined)
    const result = useVaccine()
    await result.removeRecord('v1')
    expect(mockRemoveRecord).toHaveBeenCalledWith('v1')
  })

  it('markCompleted 调用 store 的 markCompleted', async () => {
    mockMarkCompleted.mockResolvedValue(undefined)
    const result = useVaccine()
    await result.markCompleted('v1')
    expect(mockMarkCompleted).toHaveBeenCalledWith('v1')
  })

  it('fetchUpcoming 调用 store 的 fetchUpcoming 不传 days', async () => {
    mockFetchUpcoming.mockResolvedValue(undefined)
    const result = useVaccine()
    await result.fetchUpcoming('pet-1')
    expect(mockFetchUpcoming).toHaveBeenCalledWith('pet-1', undefined)
  })

  it('fetchUpcoming 调用 store 的 fetchUpcoming 传递 days', async () => {
    mockFetchUpcoming.mockResolvedValue(undefined)
    const result = useVaccine()
    await result.fetchUpcoming('pet-1', 60)
    expect(mockFetchUpcoming).toHaveBeenCalledWith('pet-1', 60)
  })

  it('fetchOverdue 调用 store 的 fetchOverdue', async () => {
    mockFetchOverdue.mockResolvedValue(undefined)
    const result = useVaccine()
    await result.fetchOverdue('pet-1')
    expect(mockFetchOverdue).toHaveBeenCalledWith('pet-1')
  })

  it('initPlan 调用 store 的 initPlan', async () => {
    mockInitPlan.mockResolvedValue(undefined)
    const result = useVaccine()
    const petInfo = { species: 'dog' as const, breed: '金毛', birthDate: '2023-01-01' }
    await result.initPlan('pet-1', petInfo)
    expect(mockInitPlan).toHaveBeenCalledWith('pet-1', petInfo)
  })

  it('getRecordsByMonth 调用 store 的 getRecordsByMonth', () => {
    const monthRecords = [{ id: 'v1' }] as any[]
    mockGetRecordsByMonth.mockReturnValue(monthRecords)
    const result = useVaccine()
    const returned = result.getRecordsByMonth(2025, 6)
    expect(mockGetRecordsByMonth).toHaveBeenCalledWith(2025, 6)
    expect(returned).toEqual(monthRecords)
  })

  it('clearError 调用 store 的 clearError', () => {
    const result = useVaccine()
    result.clearError()
    expect(mockClearError).toHaveBeenCalled()
  })
})
