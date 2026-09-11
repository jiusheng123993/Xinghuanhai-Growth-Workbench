/**
 * usePet 测试
 * 验证宠物信息管理 Hook 的增删改查和状态管理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { usePetStore } from '../../stores/petStore'
import { usePet } from '../usePet'

const {
  mockInitUser,
  mockFetchPets,
  mockAddPet,
  mockUpdatePet,
  mockRemovePet,
  mockMarkPetDeceased,
  mockSwitchPet,
  mockClearError,
} = vi.hoisted(() => ({
  mockInitUser: vi.fn(),
  mockFetchPets: vi.fn(),
  mockAddPet: vi.fn(),
  mockUpdatePet: vi.fn(),
  mockRemovePet: vi.fn(),
  mockMarkPetDeceased: vi.fn(),
  mockSwitchPet: vi.fn(),
  mockClearError: vi.fn(),
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
  pets: [] as any[],
  currentPet: null as any,
  isLoading: false,
  error: null as string | null,
  initUser: mockInitUser,
  fetchPets: mockFetchPets,
  addPet: mockAddPet,
  updatePet: mockUpdatePet,
  removePet: mockRemovePet,
  markPetDeceased: mockMarkPetDeceased,
  switchPet: mockSwitchPet,
  clearError: mockClearError,
}

vi.mock('../../stores/petStore', () => ({
  usePetStore: vi.fn(() => ({ ...defaultMockStore })),
}))

vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn(() => ''),
}))

describe('usePet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePetStore).mockReturnValue({ ...defaultMockStore })
  })

  it('返回值包含所有预期字段', () => {
    const result = usePet()
    expect(result).toHaveProperty('pets')
    expect(result).toHaveProperty('currentPet')
    expect(result).toHaveProperty('isLoading')
    expect(result).toHaveProperty('error')
    expect(result).toHaveProperty('initUser')
    expect(result).toHaveProperty('addPet')
    expect(result).toHaveProperty('updatePet')
    expect(result).toHaveProperty('removePet')
    expect(result).toHaveProperty('markPetDeceased')
    expect(result).toHaveProperty('switchPet')
    expect(result).toHaveProperty('refreshPets')
    expect(result).toHaveProperty('clearError')
  })

  it('返回 store 中的 pets', () => {
    const pets = [{ id: 'p1', name: 'Kitty' }]
    vi.mocked(usePetStore).mockReturnValue({ ...defaultMockStore, pets })
    const result = usePet()
    expect(result.pets).toEqual(pets)
  })

  it('返回 store 中的 currentPet', () => {
    const currentPet = { id: 'p1', name: 'Kitty' }
    vi.mocked(usePetStore).mockReturnValue({ ...defaultMockStore, currentPet })
    const result = usePet()
    expect(result.currentPet).toEqual(currentPet)
  })

  it('返回 store 中的 isLoading', () => {
    vi.mocked(usePetStore).mockReturnValue({ ...defaultMockStore, isLoading: true })
    const result = usePet()
    expect(result.isLoading).toBe(true)
  })

  it('返回 store 中的 error', () => {
    vi.mocked(usePetStore).mockReturnValue({ ...defaultMockStore, error: 'some error' })
    const result = usePet()
    expect(result.error).toBe('some error')
  })

  it('userId 存在且 pets 为空时自动调用 fetchPets', () => {
    vi.mocked(usePetStore).mockReturnValue({ ...defaultMockStore, userId: 'u1', pets: [] })
    usePet()
    expect(mockFetchPets).toHaveBeenCalled()
  })

  it('userId 存在且 pets 不为空时不调用 fetchPets', () => {
    vi.mocked(usePetStore).mockReturnValue({
      ...defaultMockStore,
      userId: 'u1',
      pets: [{ id: 'p1', name: 'Kitty' }],
    })
    usePet()
    expect(mockFetchPets).not.toHaveBeenCalled()
  })

  it('userId 为空时不调用 fetchPets', () => {
    vi.mocked(usePetStore).mockReturnValue({ ...defaultMockStore, userId: '', pets: [] })
    usePet()
    expect(mockFetchPets).not.toHaveBeenCalled()
  })

  it('initUser 调用 store 的 initUser', async () => {
    mockInitUser.mockResolvedValue(undefined)
    const result = usePet()
    await result.initUser('u1')
    expect(mockInitUser).toHaveBeenCalledWith('u1')
  })

  it('addPet 调用 store 的 addPet 并返回结果', async () => {
    const newPet = { id: 'p1', name: 'Kitty', createdAt: '2024-01-01', updatedAt: '2024-01-01' }
    mockAddPet.mockResolvedValue(newPet)
    const result = usePet()
    const petData = { name: 'Kitty', species: 'cat' as any, breed: '', breedId: '', gender: 'male' as any, birthDate: '', weight: 0, coatColor: '', photos: [], isNeutered: false, microchipId: '', notes: '', isDeceased: false, allergies: [], medications: [], chronicConditions: [], userId: 'u1' }
    const returned = await result.addPet(petData)
    expect(mockAddPet).toHaveBeenCalledWith(petData)
    expect(returned).toEqual(newPet)
  })

  it('updatePet 调用 store 的 updatePet', async () => {
    mockUpdatePet.mockResolvedValue(undefined)
    const result = usePet()
    await result.updatePet('p1', { name: 'NewName' })
    expect(mockUpdatePet).toHaveBeenCalledWith('p1', { name: 'NewName' })
  })

  it('removePet 调用 store 的 removePet', async () => {
    mockRemovePet.mockResolvedValue(undefined)
    const result = usePet()
    await result.removePet('p1')
    expect(mockRemovePet).toHaveBeenCalledWith('p1')
  })

  it('markPetDeceased 调用 store 的 markPetDeceased', async () => {
    mockMarkPetDeceased.mockResolvedValue(undefined)
    const result = usePet()
    await result.markPetDeceased('p1', '2024-06-01')
    expect(mockMarkPetDeceased).toHaveBeenCalledWith('p1', '2024-06-01')
  })

  it('switchPet 调用 store 的 switchPet', async () => {
    mockSwitchPet.mockResolvedValue(undefined)
    const result = usePet()
    await result.switchPet('p2')
    expect(mockSwitchPet).toHaveBeenCalledWith('p2')
  })

  it('refreshPets 调用 store 的 fetchPets', async () => {
    mockFetchPets.mockResolvedValue(undefined)
    vi.mocked(usePetStore).mockReturnValue({ ...defaultMockStore, userId: 'u1' })
    const result = usePet()
    await result.refreshPets()
    expect(mockFetchPets).toHaveBeenCalled()
  })

  it('clearError 调用 store 的 clearError', () => {
    const result = usePet()
    result.clearError()
    expect(mockClearError).toHaveBeenCalled()
  })
})