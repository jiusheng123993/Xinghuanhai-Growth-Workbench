/**
 * E2E 测试：食物安全查询
 * 验证宠物食物安全查询功能
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { api } from '../services/api'
import { isMember, getQuotaLimit } from '../services/membershipService'
import {
  queryFood,
  getQueryHistory,
  getQueryStats,
  getTodayQueryCount,
} from '../services/foodService'

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
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[key]
  }),
}))

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('../services/membershipService', () => ({
  isMember: vi.fn(() => Promise.resolve(false)),
  getQuotaLimit: vi.fn(() => Promise.resolve(5)),
}))

vi.mock('../utils/petOwnership', () => ({
  requirePetOwnership: vi.fn(),
  isPetOwnerLocal: vi.fn(() => true),
}))

const USER_ID = 'user_001'
const PET_ID = 'pet_001'

describe('Happy Path 3: 食物查询 → 安全等级展示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))
    vi.mocked(isMember).mockResolvedValue(false)
    vi.mocked(getQuotaLimit).mockResolvedValue(5)
  })

  it('查询"巧克力"（有毒食物）→ 验证 safetyLevel=toxic，包含 dangerousCompounds', async () => {
    const result = await queryFood(USER_ID, PET_ID, '巧克力', 'dog')

    expect(result.safetyLevel).toBe('toxic')
    expect(result.foodName).toBe('巧克力')
    expect(result.dangerousCompounds).toBeDefined()
    expect(result.dangerousCompounds!.length).toBeGreaterThan(0)
    expect(result.symptoms).toBeDefined()
    expect(result.symptoms!.length).toBeGreaterThan(0)
  })

  it('查询"鸡胸肉"（安全食物）→ 验证 safetyLevel=safe，无 dangerousCompounds', async () => {
    const result = await queryFood(USER_ID, PET_ID, '鸡胸肉', 'dog')

    expect(result.safetyLevel).toBe('safe')
    expect(result.foodName).toBe('鸡胸肉')
    expect(result.dangerousCompounds).toBeDefined()
    expect(result.dangerousCompounds!.length).toBe(0)
  })

  it('查询"葡萄"（有毒食物）→ 验证 safetyLevel=toxic，症状包含肾脏问题', async () => {
    const result = await queryFood(USER_ID, PET_ID, '葡萄', 'dog')

    expect(result.safetyLevel).toBe('toxic')
    expect(result.foodName).toBe('葡萄')
    expect(result.symptoms).toBeDefined()

    const symptoms = result.symptoms || []
    const hasKidneySymptom = symptoms.some(
      (s) => s.includes('肾') || s.includes('尿') || s.includes('衰竭')
    )
    expect(hasKidneySymptom).toBe(true)
  })

  it('查询"苹果"（安全食物，通过 API）→ mock API 返回结果，验证使用了 API 结果', async () => {
    const mockApiResult = {
      id: 'api_apple_001',
      userId: USER_ID,
      foodName: '苹果',
      safetyLevel: 'safe' as const,
      detail: '苹果（去核后）对宠物安全，富含维生素和纤维',
      isMemberQuery: false,
      createdAt: new Date(),
    }
    vi.mocked(api.get).mockResolvedValue(mockApiResult)

    const result = await queryFood(USER_ID, PET_ID, '苹果', 'dog')

    expect(result.foodName).toBe('苹果')
    expect(result.safetyLevel).toBe('safe')
    expect(result.id).toBe('api_apple_001')
    expect(api.get).toHaveBeenCalledWith('/api/food/query', { keyword: '苹果' })
  })

  it('获取查询历史 → 验证历史包含所有查询', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    await queryFood(USER_ID, PET_ID, '巧克力', 'dog')
    await queryFood(USER_ID, PET_ID, '鸡胸肉', 'dog')
    await queryFood(USER_ID, PET_ID, '葡萄', 'dog')
    await queryFood(USER_ID, PET_ID, '苹果', 'dog')

    const history = await getQueryHistory(PET_ID, USER_ID)

    expect(history.length).toBeGreaterThanOrEqual(4)
    const foodNames = history.map((h) => h.foodName)
    expect(foodNames).toContain('巧克力')
    expect(foodNames).toContain('鸡胸肉')
    expect(foodNames).toContain('葡萄')
    expect(foodNames).toContain('苹果')
  })

  it('获取查询统计 → 验证 totalQueries、todayQueries、remainingFree', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))
    vi.mocked(isMember).mockResolvedValue(false)
    vi.mocked(getQuotaLimit).mockResolvedValue(5)

    await queryFood(USER_ID, PET_ID, '巧克力', 'dog')
    await queryFood(USER_ID, PET_ID, '鸡胸肉', 'dog')

    const stats = await getQueryStats(PET_ID, USER_ID)

    expect(stats.totalQueries).toBeGreaterThanOrEqual(2)
    expect(stats.todayQueries).toBeGreaterThanOrEqual(0)
    expect(stats.remainingFree).toBeGreaterThanOrEqual(0)
    expect(stats.isMemberUser).toBe(false)
  })

  it('获取今日查询次数 → 验证计数与今日查询匹配', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    await queryFood(USER_ID, PET_ID, '巧克力', 'dog')
    await queryFood(USER_ID, PET_ID, '鸡胸肉', 'dog')

    const count = await getTodayQueryCount(PET_ID, USER_ID)

    expect(count).toBeGreaterThanOrEqual(2)
    expect(typeof count).toBe('number')
  })
})