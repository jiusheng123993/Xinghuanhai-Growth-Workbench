/**
 * useUserStats 测试
 * 验证用户数据统计 Hook 的各项计数和天数计算
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useUserStats, getUsageDays, getPetCount, getCheckinCount, getVaccineCount, getSymptomCheckCount, getAllStats } from '../useUserStats'

const {
  mockGetStorageArray,
  mockPetStoreSelector,
  mockCheckinStoreSelector,
  mockPetStoreGetState,
  mockCheckinStoreGetState,
} = vi.hoisted(() => ({
  mockGetStorageArray: vi.fn(),
  mockPetStoreSelector: vi.fn(),
  mockCheckinStoreSelector: vi.fn(),
  mockPetStoreGetState: vi.fn(),
  mockCheckinStoreGetState: vi.fn(),
}))

vi.mock('react', () => {
  const actual = {
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    useEffect: (fn: any) => { fn() },
    useReducer: (reducer: any, initialState: any) => [initialState, vi.fn()],
    useState: (initial: any) => [initial, vi.fn()],
    useRef: (initial: any) => ({ current: initial }),
  }
  return { ...actual, default: actual }
})

vi.mock('../../utils/storage', () => ({
  getStorageArray: mockGetStorageArray,
}))

vi.mock('../../stores/petStore', () => ({
  usePetStore: Object.assign(vi.fn(mockPetStoreSelector), { getState: mockPetStoreGetState }),
}))

vi.mock('../../stores/checkinStore', () => ({
  useCheckinStore: Object.assign(vi.fn(mockCheckinStoreSelector), { getState: mockCheckinStoreGetState }),
}))

describe('useUserStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStorageArray.mockReturnValue([])
    mockPetStoreSelector.mockImplementation((selector: any) => selector({ pets: [] }))
    mockCheckinStoreSelector.mockImplementation((selector: any) => selector({ checkins: [] }))
  })

  it('返回值包含所有预期字段', () => {
    const result = useUserStats()
    expect(result).toHaveProperty('usageDays')
    expect(result).toHaveProperty('petCount')
    expect(result).toHaveProperty('checkinCount')
    expect(result).toHaveProperty('vaccineCount')
    expect(result).toHaveProperty('symptomCheckCount')
  })

  it('无数据时所有计数为 0', () => {
    const result = useUserStats()
    expect(result.usageDays).toBe(0)
    expect(result.petCount).toBe(0)
    expect(result.checkinCount).toBe(0)
    expect(result.vaccineCount).toBe(0)
    expect(result.symptomCheckCount).toBe(0)
  })

  it('petCount 返回宠物数量', () => {
    const pets = [{ id: 'p1' }, { id: 'p2' }] as any[]
    mockPetStoreSelector.mockImplementation((selector: any) => selector({ pets }))
    const result = useUserStats()
    expect(result.petCount).toBe(2)
  })

  it('checkinCount 返回打卡记录数量', () => {
    const checkins = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] as any[]
    mockCheckinStoreSelector.mockImplementation((selector: any) => selector({ checkins }))
    const result = useUserStats()
    expect(result.checkinCount).toBe(3)
  })

  it('vaccineCount 返回疫苗数据数量', () => {
    mockGetStorageArray.mockImplementation((key: string) => {
      if (key === 'vaccine_data') return [{ id: 'v1' }, { id: 'v2' }]
      return []
    })
    const result = useUserStats()
    expect(result.vaccineCount).toBe(2)
  })

  it('symptomCheckCount 返回症状检查数据数量', () => {
    mockGetStorageArray.mockImplementation((key: string) => {
      if (key === 'symptom_data') return [{ id: 's1' }]
      return []
    })
    const result = useUserStats()
    expect(result.symptomCheckCount).toBe(1)
  })

  it('有打卡记录时 usageDays 大于 0', () => {
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 5)
    const checkins = [{ id: 'e1', createdAt: pastDate.toISOString() }] as any[]
    mockCheckinStoreSelector.mockImplementation((selector: any) => selector({ checkins }))
    const result = useUserStats()
    expect(result.usageDays).toBeGreaterThanOrEqual(5)
  })

  it('只有一条打卡记录时 usageDays 至少为 1', () => {
    const now = new Date()
    const checkins = [{ id: 'e1', createdAt: now.toISOString() }] as any[]
    mockCheckinStoreSelector.mockImplementation((selector: any) => selector({ checkins }))
    const result = useUserStats()
    expect(result.usageDays).toBeGreaterThanOrEqual(1)
  })

  it('打卡记录按时间排序后取最早日期计算 usageDays', () => {
    const olderDate = new Date()
    olderDate.setDate(olderDate.getDate() - 10)
    const newerDate = new Date()
    newerDate.setDate(newerDate.getDate() - 3)
    const checkins = [
      { id: 'e2', createdAt: newerDate.toISOString() },
      { id: 'e1', createdAt: olderDate.toISOString() },
    ] as any[]
    mockCheckinStoreSelector.mockImplementation((selector: any) => selector({ checkins }))
    const result = useUserStats()
    expect(result.usageDays).toBeGreaterThanOrEqual(10)
  })
})

describe('getUsageDays', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckinStoreGetState.mockReturnValue({ checkins: [] })
  })

  it('无打卡记录时返回 0', () => {
    expect(getUsageDays()).toBe(0)
  })

  it('有打卡记录时返回天数', () => {
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 7)
    mockCheckinStoreGetState.mockReturnValue({
      checkins: [{ id: 'e1', createdAt: pastDate.toISOString() }],
    })
    expect(getUsageDays()).toBeGreaterThanOrEqual(7)
  })
})

describe('getPetCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPetStoreGetState.mockReturnValue({ pets: [] })
  })

  it('无宠物时返回 0', () => {
    expect(getPetCount()).toBe(0)
  })

  it('有宠物时返回数量', () => {
    mockPetStoreGetState.mockReturnValue({ pets: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] })
    expect(getPetCount()).toBe(3)
  })
})

describe('getCheckinCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckinStoreGetState.mockReturnValue({ checkins: [] })
  })

  it('无打卡记录时返回 0', () => {
    expect(getCheckinCount()).toBe(0)
  })

  it('有打卡记录时返回数量', () => {
    mockCheckinStoreGetState.mockReturnValue({ checkins: [{ id: 'e1' }, { id: 'e2' }] })
    expect(getCheckinCount()).toBe(2)
  })
})

describe('getVaccineCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStorageArray.mockReturnValue([])
  })

  it('无疫苗数据时返回 0', () => {
    mockGetStorageArray.mockImplementation((key: string) => {
      if (key === 'vaccine_data') return []
      return []
    })
    expect(getVaccineCount()).toBe(0)
  })

  it('有疫苗数据时返回数量', () => {
    mockGetStorageArray.mockImplementation((key: string) => {
      if (key === 'vaccine_data') return [{ id: 'v1' }, { id: 'v2' }]
      return []
    })
    expect(getVaccineCount()).toBe(2)
  })
})

describe('getSymptomCheckCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStorageArray.mockReturnValue([])
  })

  it('无症状检查数据时返回 0', () => {
    mockGetStorageArray.mockImplementation((key: string) => {
      if (key === 'symptom_data') return []
      return []
    })
    expect(getSymptomCheckCount()).toBe(0)
  })

  it('有症状检查数据时返回数量', () => {
    mockGetStorageArray.mockImplementation((key: string) => {
      if (key === 'symptom_data') return [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
      return []
    })
    expect(getSymptomCheckCount()).toBe(3)
  })
})

describe('getAllStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPetStoreGetState.mockReturnValue({ pets: [{ id: 'p1' }] })
    mockCheckinStoreGetState.mockReturnValue({ checkins: [{ id: 'e1', createdAt: new Date().toISOString() }] })
    mockGetStorageArray.mockImplementation((key: string) => {
      if (key === 'vaccine_data') return [{ id: 'v1' }]
      if (key === 'symptom_data') return [{ id: 's1' }, { id: 's2' }]
      return []
    })
  })

  it('返回包含所有字段的对象', () => {
    const stats = getAllStats()
    expect(stats).toHaveProperty('usageDays')
    expect(stats).toHaveProperty('petCount')
    expect(stats).toHaveProperty('checkinCount')
    expect(stats).toHaveProperty('vaccineCount')
    expect(stats).toHaveProperty('symptomCheckCount')
  })

  it('各字段值正确', () => {
    const stats = getAllStats()
    expect(stats.petCount).toBe(1)
    expect(stats.checkinCount).toBe(1)
    expect(stats.vaccineCount).toBe(1)
    expect(stats.symptomCheckCount).toBe(2)
    expect(stats.usageDays).toBeGreaterThanOrEqual(1)
  })
})