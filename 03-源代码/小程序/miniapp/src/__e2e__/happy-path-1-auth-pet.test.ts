/**
 * E2E 测试：认证与宠物档案
 * 验证用户登录注册和宠物档案创建流程
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnomalyItem } from '../memory-body/types/memoryBodyTypes'

// ============================================================
// 导入真实模块
// ============================================================
import { useAuthStore } from '../stores/authStore'
import { usePetStore } from '../stores/petStore'
import { api as _api } from '../services/api'
import type { User } from '../types'
import type { PetProfile } from '../services/petService'

// ============================================================
// Mock 层：共享的 mock storage 和 api
// ============================================================
const mockStorage: Record<string, string> = {}

vi.mock('../utils/storage', () => ({
  // 独立函数 — petService / checkinService 使用
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = JSON.stringify(value)
  }),
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[key]
  }),
  getStorageArray: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return []
    try {
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }),
  // storage 对象 — authStore 使用
  storage: {
    getToken: vi.fn(() => {
      try {
        const raw = mockStorage['xhh_token']
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    }),
    setToken: vi.fn((token: string) => {
      mockStorage['xhh_token'] = JSON.stringify(token)
    }),
    removeToken: vi.fn(() => {
      delete mockStorage['xhh_token']
    }),
    getUser: vi.fn(() => {
      try {
        const raw = mockStorage['xhh_user']
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    }),
    setUser: vi.fn((user: unknown) => {
      mockStorage['xhh_user'] = JSON.stringify(user)
    }),
    removeUser: vi.fn(() => {
      delete mockStorage['xhh_user']
    }),
    getRefreshToken: vi.fn(() => {
      try {
        const raw = mockStorage['xhh_refresh_token']
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    }),
    setRefreshToken: vi.fn((token: string) => {
      mockStorage['xhh_refresh_token'] = JSON.stringify(token)
    }),
    removeRefreshToken: vi.fn(() => {
      delete mockStorage['xhh_refresh_token']
    }),
    clear: vi.fn(() => {
      delete mockStorage['xhh_token']
      delete mockStorage['xhh_user']
      delete mockStorage['xhh_refresh_token']
    }),
  },
  setStorageUserId: vi.fn(),
  clearAllStorage: vi.fn(),
}))

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    login: vi.fn(),
    getUser: vi.fn(),
  },
}))

vi.mock('../utils/petOwnership', () => ({
  requirePetOwnership: vi.fn(),
  isPetOwnerLocal: vi.fn(() => true),
}))

vi.mock('../services/syncHelper', () => ({
  queueSync: vi.fn(),
  trySyncAll: vi.fn(),
  trySyncTable: vi.fn(),
}))

const api = _api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  login: ReturnType<typeof vi.fn>
  getUser: ReturnType<typeof vi.fn>
}

// ============================================================
// 测试辅助函数
// ============================================================
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-001',
    nickname: '测试用户',
    avatar: 'https://example.com/avatar.png',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makePetData(overrides: Partial<Omit<PetProfile, 'id' | 'createdAt' | 'updatedAt'>> = {}): Omit<PetProfile, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '小咪',
    species: 'cat',
    breed: '英短',
    breedId: 'british-shorthair',
    gender: 'female',
    birthDate: '2024-03-15',
    weight: 4.5,
    coatColor: '蓝灰色',
    photos: [],
    isNeutered: true,
    microchipId: '',
    notes: '',
    isDeceased: false,
    allergies: [],
    medications: [],
    chronicConditions: [],
    userId: 'user-001',
    avatarPhotoUrl: '',
    ...overrides,
  }
}

function makeSecondPetData(): Omit<PetProfile, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '旺财',
    species: 'dog',
    breed: '金毛寻回犬',
    breedId: 'golden-retriever',
    gender: 'male',
    birthDate: '2022-06-01',
    weight: 30,
    coatColor: '金色',
    photos: [],
    isNeutered: true,
    microchipId: '',
    notes: '很活泼',
    isDeceased: false,
    allergies: [],
    medications: [],
    chronicConditions: [],
    userId: 'user-001',
    avatarPhotoUrl: '',
  }
}

// ============================================================
// 测试套件
// ============================================================
describe('E2E Happy Path 1: 注册登录 → 添加宠物 → 首页展示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])

    // 重置 authStore 到初始状态
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
    })

    // 重置 petStore 到初始状态
    usePetStore.setState({
      userId: null,
      pets: [],
      currentPet: null,
      isLoading: false,
      error: null,
      avatar2DTaskId: null,
      avatar3DTaskId: null,
    })
  })

  describe('步骤 1: 用户未登录 — 验证初始状态', () => {
    it('应该没有 token 和用户信息', () => {
      const state = useAuthStore.getState()
      expect(state.token).toBeNull()
      expect(state.user).toBeNull()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isLoading).toBe(false)
    })

    it('应该没有任何宠物数据', () => {
      const state = usePetStore.getState()
      expect(state.pets).toEqual([])
      expect(state.currentPet).toBeNull()
      expect(state.userId).toBeNull()
    })
  })

  describe('步骤 2: 用户登录 — 验证 token 和用户信息', () => {
    it('登录成功后应该设置 token 和用户信息', async () => {
      const user = makeUser()
      vi.mocked(api.login).mockResolvedValue({
        token: 'login-token-abc123',
        refreshToken: 'refresh-token-xyz789',
        user,
      })

      await useAuthStore.getState().login()

      const state = useAuthStore.getState()
      expect(state.token).toBe('login-token-abc123')
      expect(state.user).toEqual(user)
      expect(state.isAuthenticated).toBe(true)
      expect(state.isLoading).toBe(false)
    })

    it('token 应该持久化到 storage', async () => {
      const user = makeUser()
      vi.mocked(api.login).mockResolvedValue({
        token: 'login-token-abc123',
        refreshToken: 'refresh-token-xyz789',
        user,
      })

      await useAuthStore.getState().login()

      // 验证 token 已写入 mockStorage
      const storedToken = JSON.parse(mockStorage['xhh_token'])
      expect(storedToken).toBe('login-token-abc123')

      const storedUser = JSON.parse(mockStorage['xhh_user'])
      expect(storedUser.id).toBe('user-001')
    })

    it('登录失败不应该设置认证状态', async () => {
      vi.mocked(api.login).mockRejectedValue(new Error('网络异常'))

      try {
        await useAuthStore.getState().login()
      } catch {
        // 预期抛出异常
      }

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.token).toBeNull()
      expect(state.isLoading).toBe(false)
    })
  })

  describe('步骤 3: 添加第一只宠物 "小咪"', () => {
    beforeEach(async () => {
      // 先登录
      const user = makeUser()
      vi.mocked(api.login).mockResolvedValue({
        token: 'login-token-abc123',
        refreshToken: 'refresh-token-xyz789',
        user,
      })
      await useAuthStore.getState().login()

      // 初始化 petStore 的 userId
      usePetStore.getState().initUser('user-001')
    })

    it('应该成功创建宠物并验证所有字段', async () => {
      const petData = makePetData()

      // Mock api.post 返回创建的宠物
      vi.mocked(api.post).mockResolvedValue({
        id: 'pet-001',
        ...petData,
        createdAt: '2026-07-25T10:00:00.000Z',
        updatedAt: '2026-07-25T10:00:00.000Z',
      })

      const pet = await usePetStore.getState().addPet(petData)

      // 验证返回的宠物对象
      expect(pet.id).toBeDefined()
      expect(pet.name).toBe('小咪')
      expect(pet.species).toBe('cat')
      expect(pet.breed).toBe('英短')
      expect(pet.birthDate).toBe('2024-03-15')
      expect(pet.gender).toBe('female')
      expect(pet.weight).toBe(4.5)
      expect(pet.isDeceased).toBe(false)
      expect(pet.createdAt).toBeDefined()
      expect(pet.updatedAt).toBeDefined()

      // 验证 store 状态
      const state = usePetStore.getState()
      expect(state.pets).toHaveLength(1)
      expect(state.pets[0].name).toBe('小咪')
      expect(state.currentPet).not.toBeNull()
      expect(state.currentPet!.name).toBe('小咪')
      expect(state.error).toBeNull()
      expect(state.isLoading).toBe(false)
    })

    it('宠物数据应该持久化到本地 storage', async () => {
      const petData = makePetData()
      vi.mocked(api.post).mockResolvedValue({
        id: 'pet-001',
        ...petData,
        createdAt: '2026-07-25T10:00:00.000Z',
        updatedAt: '2026-07-25T10:00:00.000Z',
      })

      await usePetStore.getState().addPet(petData)

      // 验证本地存储中有宠物数据（key 格式: pets_user-001）
      const storedPets = JSON.parse(mockStorage['pets_user-001'])
      expect(Array.isArray(storedPets)).toBe(true)
      expect(storedPets).toHaveLength(1)
      expect(storedPets[0].name).toBe('小咪')
      expect(storedPets[0].species).toBe('cat')
    })
  })

  describe('步骤 4: 首页展示 — 验证宠物信息', () => {
    beforeEach(async () => {
      // 登录
      const user = makeUser()
      vi.mocked(api.login).mockResolvedValue({
        token: 'login-token-abc123',
        refreshToken: 'refresh-token-xyz789',
        user,
      })
      await useAuthStore.getState().login()
      usePetStore.getState().initUser('user-001')

      // 添加宠物
      const petData = makePetData()
      vi.mocked(api.post).mockResolvedValue({
        id: 'pet-001',
        ...petData,
        createdAt: '2026-07-25T10:00:00.000Z',
        updatedAt: '2026-07-25T10:00:00.000Z',
      })
      await usePetStore.getState().addPet(petData)
    })

    it('首页应该展示当前宠物的名字', () => {
      const state = usePetStore.getState()
      expect(state.currentPet).not.toBeNull()
      expect(state.currentPet!.name).toBe('小咪')
    })

    it('首页应该展示当前宠物的品种', () => {
      const state = usePetStore.getState()
      expect(state.currentPet!.species).toBe('cat')
      expect(state.currentPet!.breed).toBe('英短')
    })

    it('宠物的出生日期应该正确存储（用于年龄计算）', () => {
      const state = usePetStore.getState()
      expect(state.currentPet!.birthDate).toBe('2024-03-15')

      // 验证年龄计算：2026-07-25 - 2024-03-15 ≈ 2 年 4 个月
      const birthDate = new Date(state.currentPet!.birthDate)
      const now = new Date('2026-07-25')
      const ageYears = now.getFullYear() - birthDate.getFullYear()
      const monthDiff = now.getMonth() - birthDate.getMonth()
      const adjustedAge = monthDiff < 0 ? ageYears - 1 : ageYears
      expect(adjustedAge).toBeGreaterThanOrEqual(2)
    })

    it('宠物列表应该包含正确的数量', () => {
      const state = usePetStore.getState()
      expect(state.pets).toHaveLength(1)
    })
  })

  describe('步骤 5: 添加第二只宠物 — 验证多宠物管理', () => {
    beforeEach(async () => {
      // 登录
      const user = makeUser()
      vi.mocked(api.login).mockResolvedValue({
        token: 'login-token-abc123',
        refreshToken: 'refresh-token-xyz789',
        user,
      })
      await useAuthStore.getState().login()
      usePetStore.getState().initUser('user-001')

      // 添加第一只宠物
      const petData1 = makePetData()
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'pet-001',
        ...petData1,
        createdAt: '2026-07-25T10:00:00.000Z',
        updatedAt: '2026-07-25T10:00:00.000Z',
      })
      await usePetStore.getState().addPet(petData1)
    })

    it('添加第二只宠物后，列表应该包含两只宠物', async () => {
      const petData2 = makeSecondPetData()
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'pet-002',
        ...petData2,
        createdAt: '2026-07-25T10:05:00.000Z',
        updatedAt: '2026-07-25T10:05:00.000Z',
      })

      await usePetStore.getState().addPet(petData2)

      const state = usePetStore.getState()
      expect(state.pets).toHaveLength(2)
      expect(state.pets[0].name).toBe('小咪')
      expect(state.pets[1].name).toBe('旺财')
    })

    it('第二只宠物的品种和物种应该正确', async () => {
      const petData2 = makeSecondPetData()
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'pet-002',
        ...petData2,
        createdAt: '2026-07-25T10:05:00.000Z',
        updatedAt: '2026-07-25T10:05:00.000Z',
      })

      await usePetStore.getState().addPet(petData2)

      const state = usePetStore.getState()
      const secondPet = state.pets[1]
      expect(secondPet.name).toBe('旺财')
      expect(secondPet.species).toBe('dog')
      expect(secondPet.breed).toBe('金毛寻回犬')
      expect(secondPet.birthDate).toBe('2022-06-01')
      expect(secondPet.gender).toBe('male')
      expect(secondPet.weight).toBe(30)
    })

    it('currentPet 应该保持为第一只宠物（除非手动切换）', async () => {
      const petData2 = makeSecondPetData()
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'pet-002',
        ...petData2,
        createdAt: '2026-07-25T10:05:00.000Z',
        updatedAt: '2026-07-25T10:05:00.000Z',
      })

      await usePetStore.getState().addPet(petData2)

      const state = usePetStore.getState()
      // addPet 逻辑：如果已有 currentPet 则保持不变
      expect(state.currentPet!.name).toBe('小咪')
    })

    it('本地存储中应该包含两只宠物', async () => {
      const petData2 = makeSecondPetData()
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'pet-002',
        ...petData2,
        createdAt: '2026-07-25T10:05:00.000Z',
        updatedAt: '2026-07-25T10:05:00.000Z',
      })

      await usePetStore.getState().addPet(petData2)

      const storedPets = JSON.parse(mockStorage['pets_user-001'])
      expect(storedPets).toHaveLength(2)
      expect(storedPets.map((p: PetProfile) => p.name)).toEqual(['小咪', '旺财'])
    })
  })

  describe('完整流程：从未登录到双宠物首页', () => {
    it('应该完成完整的端到端流程', async () => {
      // 1. 初始状态：未登录
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(usePetStore.getState().pets).toHaveLength(0)

      // 2. 登录
      const user = makeUser()
      vi.mocked(api.login).mockResolvedValue({
        token: 'login-token-abc123',
        refreshToken: 'refresh-token-xyz789',
        user,
      })
      await useAuthStore.getState().login()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
      expect(useAuthStore.getState().token).toBe('login-token-abc123')

      // 3. 初始化 petStore
      usePetStore.getState().initUser('user-001')

      // 4. 添加第一只宠物
      const petData1 = makePetData()
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'pet-001',
        ...petData1,
        createdAt: '2026-07-25T10:00:00.000Z',
        updatedAt: '2026-07-25T10:00:00.000Z',
      })
      const pet1 = await usePetStore.getState().addPet(petData1)
      expect(pet1.name).toBe('小咪')
      expect(usePetStore.getState().pets).toHaveLength(1)

      // 5. 添加第二只宠物
      const petData2 = makeSecondPetData()
      vi.mocked(api.post).mockResolvedValueOnce({
        id: 'pet-002',
        ...petData2,
        createdAt: '2026-07-25T10:05:00.000Z',
        updatedAt: '2026-07-25T10:05:00.000Z',
      })
      const pet2 = await usePetStore.getState().addPet(petData2)
      expect(pet2.name).toBe('旺财')

      // 6. 最终状态验证
      const finalAuthState = useAuthStore.getState()
      expect(finalAuthState.isAuthenticated).toBe(true)
      expect(finalAuthState.user!.nickname).toBe('测试用户')

      const finalPetState = usePetStore.getState()
      expect(finalPetState.pets).toHaveLength(2)
      expect(finalPetState.pets[0].name).toBe('小咪')
      expect(finalPetState.pets[0].species).toBe('cat')
      expect(finalPetState.pets[1].name).toBe('旺财')
      expect(finalPetState.pets[1].species).toBe('dog')
      expect(finalPetState.currentPet).not.toBeNull()

      // 7. 验证持久化
      const storedToken = JSON.parse(mockStorage['xhh_token'])
      expect(storedToken).toBe('login-token-abc123')

      const storedPets = JSON.parse(mockStorage['pets_user-001'])
      expect(storedPets).toHaveLength(2)
    })
  })
})