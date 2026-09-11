/**
 * useCheckin 测试
 * 验证健康打卡 Hook 的查询、提交和连续天数追踪
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PetHealthEntry } from '../../memory-body/types/memoryBodyTypes'

import { useCheckinStore } from '../../stores/checkinStore'
import { useCheckin } from '../useCheckin'

const {
  mockInitUser,
  mockFetchCheckins,
  mockDoCheckin,
} = vi.hoisted(() => ({
  mockInitUser: vi.fn(),
  mockFetchCheckins: vi.fn(),
  mockDoCheckin: vi.fn(),
}))

vi.mock('react', () => {
  const actual = { useCallback: (fn: any) => fn, useEffect: (fn: any) => fn() }
  return { ...actual, default: actual }
})

const defaultMockStore = {
  checkins: [] as PetHealthEntry[],
  todayCheckin: null as PetHealthEntry | null,
  streakDays: 0,
  isLoading: false,
  initUser: mockInitUser,
  fetchCheckins: mockFetchCheckins,
  doCheckin: mockDoCheckin,
}

vi.mock('../../stores/checkinStore', () => ({
  useCheckinStore: vi.fn(() => ({ ...defaultMockStore }))
}))

function createMockEntry(overrides: Partial<PetHealthEntry> = {}): PetHealthEntry {
  return {
    id: 'entry-1',
    petId: 'pet-1',
    userId: 'user-1',
    poopLevel: 3 as const,
    appetiteLevel: 3 as const,
    spiritLevel: 3 as const,
    exerciseLevel: 2 as const,
    hasAnomaly: false,
    anomalyItems: [],
    riskLevel: 'low' as const,
    aiFeedback: '',
    createdAt: new Date('2026-07-20'),
    ...overrides,
  }
}

describe('useCheckin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useCheckinStore).mockReturnValue({ ...defaultMockStore })
  })

  it('返回值包含所有预期字段', () => {
    const result = useCheckin()
    expect(result).toHaveProperty('checkins')
    expect(result).toHaveProperty('todayCheckin')
    expect(result).toHaveProperty('streakDays')
    expect(result).toHaveProperty('isLoading')
    expect(result).toHaveProperty('initUser')
    expect(result).toHaveProperty('doCheckin')
    expect(result).toHaveProperty('fetchCheckins')
  })

  it('initUser 调用 store 的 initUser', () => {
    const result = useCheckin()
    result.initUser('user-123')
    expect(mockInitUser).toHaveBeenCalledWith('user-123')
  })

  it('doCheckin 调用 store 的 doCheckin 并返回结果', async () => {
    const mockEntry = createMockEntry()
    mockDoCheckin.mockResolvedValue(mockEntry)
    const result = useCheckin()
    const data: Omit<PetHealthEntry, 'id' | 'createdAt' | 'aiFeedback' | 'riskLevel'> = {
      petId: 'pet-1',
      userId: 'user-1',
      poopLevel: 3 as const,
      appetiteLevel: 3 as const,
      spiritLevel: 3 as const,
      exerciseLevel: 2 as const,
      hasAnomaly: false,
      anomalyItems: [],
    }
    const entry = await result.doCheckin(data)
    expect(mockDoCheckin).toHaveBeenCalledWith(data)
    expect(entry).toEqual(mockEntry)
  })

  it('fetchCheckins 调用 store 的 fetchCheckins', async () => {
    mockFetchCheckins.mockResolvedValue(undefined)
    const result = useCheckin()
    await result.fetchCheckins('pet-1')
    expect(mockFetchCheckins).toHaveBeenCalledWith('pet-1')
  })

  it('返回 store 中的 checkins', () => {
    const mockCheckins = [createMockEntry({ id: 'e1' })]
    vi.mocked(useCheckinStore).mockReturnValue({ ...defaultMockStore, checkins: mockCheckins })
    const result = useCheckin()
    expect(result.checkins).toEqual(mockCheckins)
  })

  it('返回 store 中的 todayCheckin', () => {
    const mockToday = createMockEntry({ id: 'e2' })
    vi.mocked(useCheckinStore).mockReturnValue({ ...defaultMockStore, todayCheckin: mockToday })
    const result = useCheckin()
    expect(result.todayCheckin).toEqual(mockToday)
  })

  it('返回 store 中的 streakDays', () => {
    vi.mocked(useCheckinStore).mockReturnValue({ ...defaultMockStore, streakDays: 5 })
    const result = useCheckin()
    expect(result.streakDays).toBe(5)
  })

  it('返回 store 中的 isLoading', () => {
    vi.mocked(useCheckinStore).mockReturnValue({ ...defaultMockStore, isLoading: true })
    const result = useCheckin()
    expect(result.isLoading).toBe(true)
  })

  it('todayCheckin 为 null 时正确返回', () => {
    const result = useCheckin()
    expect(result.todayCheckin).toBeNull()
  })

  it('streakDays 为 0 时正确返回', () => {
    const result = useCheckin()
    expect(result.streakDays).toBe(0)
  })
})
