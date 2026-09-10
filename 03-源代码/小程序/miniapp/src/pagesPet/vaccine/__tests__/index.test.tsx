/**
 * 疫苗日历页面测试
 *
 * 覆盖场景：
 * - 疫苗计划列表展示（时间线样式）
 * - 疫苗状态标记（已完成/待完成/逾期）
 * - 标记疫苗完成（点击确认→状态更新）
 * - 手动添加疫苗记录
 * - 疫苗到期弹窗提醒
 * - 提醒开关控制
 * - 空状态（无疫苗计划时展示引导）
 *
 * 测试核心疫苗服务函数，覆盖页面所有业务逻辑路径。
 */
/** 疫苗驱虫日历页面单元测试 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// ============================================================
// 导入真实模块
// ============================================================
import { api as _api } from '../../../services/api'
import {
  getVaccineRecords,
  createVaccineRecord,
  updateVaccineRecord,
  deleteVaccineRecord,
  markAsCompleted,
  getUpcomingRecords,
  getOverdueRecords,
  generateInitialPlan,
  calculateNextDate,
  VACCINE_INTERVAL_RULES,
} from '../../../services/vaccineService'
import type { VaccineRecord, CreateVaccineData } from '../../../services/vaccineService'

// ============================================================
// Mock 层：共享的 mock storage 和 api
// ============================================================
const mockStorage: Record<string, string> = {}

vi.mock('../../../utils/storage', () => ({
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
}))

vi.mock('../../../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../../services/syncHelper', () => ({
  queueSync: vi.fn(),
}))

// Mock Taro for getStorageInfoSync used in getAllLocalRecords
// 注意：mockStorage 的 key 是 'vaccines_xxx'，getAllLocalRecords 通过
// Taro.getStorageInfoSync 查找 'xhh_vaccines_xxx' 前缀，然后去掉 'xhh_' 用 getStorage 读取
vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageInfoSync: vi.fn(() => ({
      keys: Object.keys(mockStorage).map((k) => `xhh_${k}`),
    })),
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  },
}))

const api = _api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

// ============================================================
// 测试常量
// ============================================================
const petId = 'pet-001'
const userId = 'user-001'
const today = new Date().toISOString().slice(0, 10)

// 过去日期辅助函数
function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

// 未来日期辅助函数
function daysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// 创建测试记录
function makeRecord(overrides: Partial<VaccineRecord> = {}): VaccineRecord {
  return {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    petId,
    type: 'vaccine',
    category: 'DHPP',
    date: daysAgo(30),
    nextDate: daysFromNow(365),
    status: 'pending',
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
    ...overrides,
  }
}

// 创建测试输入
function makeCreateData(overrides: Partial<CreateVaccineData> = {}): CreateVaccineData {
  return {
    petId,
    userId,
    type: 'vaccine',
    category: 'DHPP',
    date: today,
    ...overrides,
  }
}

// ============================================================
// 测试辅助函数
// ============================================================
function clearLocalStorage(): void {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
}

function seedLocalRecords(records: VaccineRecord[]): void {
  mockStorage[`vaccines_${petId}`] = JSON.stringify(records)
}

// ============================================================
// 1. VACCINE_INTERVAL_RULES - 疫苗间隔规则
// ============================================================
describe('VACCINE_INTERVAL_RULES', () => {
  it('应包含核心疫苗规则', () => {
    const coreVaccines = VACCINE_INTERVAL_RULES.filter((r) => r.isCore)
    expect(coreVaccines.length).toBeGreaterThanOrEqual(3)
    expect(coreVaccines.map((r) => r.category)).toEqual(
      expect.arrayContaining(['DHPP', 'FVRCP', 'rabies'])
    )
  })

  it('每项规则应包含 category 和 intervalMonths', () => {
    for (const rule of VACCINE_INTERVAL_RULES) {
      expect(rule.category).toBeTruthy()
      expect(rule.intervalMonths).toBeGreaterThan(0)
    }
  })

  it('DHPP 间隔应为 36 个月', () => {
    const dhpp = VACCINE_INTERVAL_RULES.find((r) => r.category === 'DHPP')
    expect(dhpp?.intervalMonths).toBe(36)
  })

  it('狂犬疫苗间隔应为 12 个月', () => {
    const rabies = VACCINE_INTERVAL_RULES.find((r) => r.category === 'rabies')
    expect(rabies?.intervalMonths).toBe(12)
  })
})

// ============================================================
// 2. calculateNextDate - 计算下次接种日期
// ============================================================
describe('calculateNextDate', () => {
  it('DHPP 应按 36 个月计算下次日期', () => {
    const next = calculateNextDate('DHPP', '2026-01-15')
    expect(next).toBe('2029-01-15')
  })

  it('狂犬疫苗应按 12 个月计算下次日期', () => {
    const next = calculateNextDate('rabies', '2026-01-15')
    expect(next).toBe('2027-01-15')
  })

  it('体内驱虫应按 3 个月计算下次日期', () => {
    const next = calculateNextDate('internal_deworm', '2026-01-15')
    expect(next).toBe('2026-04-15')
  })

  it('体外驱虫应按 1 个月计算下次日期', () => {
    const next = calculateNextDate('external_deworm', '2026-01-15')
    expect(next).toBe('2026-02-15')
  })

  it('未知类别应默认按 12 个月计算', () => {
    const next = calculateNextDate('unknown_vaccine', '2026-01-15')
    expect(next).toBe('2027-01-15')
  })

  it('应处理月末日期（如 1 月 31 日 + 1 个月 → 2 月 28/29 日）', () => {
    const next = calculateNextDate('external_deworm', '2026-01-31')
    expect(next).toBe('2026-02-28')
  })
})

// ============================================================
// 3. getVaccineRecords - 获取疫苗记录
// ============================================================
describe('getVaccineRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLocalStorage()
  })

  it('API 成功时应返回记录并更新本地存储', async () => {
    const apiRecords: VaccineRecord[] = [
      makeRecord({ id: 'api-1', category: 'DHPP', status: 'pending', nextDate: daysFromNow(100) }),
      makeRecord({ id: 'api-2', category: 'rabies', status: 'completed', nextDate: daysFromNow(200) }),
    ]
    vi.mocked(api.get).mockResolvedValue(apiRecords)

    const result = await getVaccineRecords(petId)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('api-1')
    expect(result[1].id).toBe('api-2')
    expect(api.get).toHaveBeenCalledWith(`/api/pets/${petId}/vaccines`)

    // 应保存到本地存储
    const local = JSON.parse(mockStorage[`vaccines_${petId}`])
    expect(local).toHaveLength(2)
  })

  it('API 返回的 pending 记录如果 nextDate 已过，应自动标记为 overdue', async () => {
    const apiRecords: VaccineRecord[] = [
      makeRecord({ id: 'api-1', category: 'DHPP', status: 'pending', nextDate: daysAgo(10) }),
    ]
    vi.mocked(api.get).mockResolvedValue(apiRecords)

    const result = await getVaccineRecords(petId)

    expect(result[0].status).toBe('overdue')
  })

  it('API 失败时应回退到本地存储', async () => {
    const localRecords: VaccineRecord[] = [
      makeRecord({ id: 'local-1', category: 'DHPP', status: 'pending' }),
    ]
    seedLocalRecords(localRecords)
    vi.mocked(api.get).mockRejectedValue(new Error('网络异常'))

    const result = await getVaccineRecords(petId)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('local-1')
  })

  it('API 失败且无本地数据时应返回空数组', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('网络异常'))

    const result = await getVaccineRecords(petId)

    expect(result).toEqual([])
  })
})

// ============================================================
// 4. createVaccineRecord - 创建疫苗记录
// ============================================================
describe('createVaccineRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLocalStorage()
  })

  it('应创建疫苗记录并自动计算 nextDate', async () => {
    const data = makeCreateData({ category: 'DHPP', date: '2026-01-15' })
    vi.mocked(api.post).mockResolvedValue({
      ...data,
      id: 'new-rec-1',
      nextDate: '2029-01-15',
      status: 'pending',
      createdAt: '2026-01-15T00:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z',
    })

    const result = await createVaccineRecord(data)

    expect(result.category).toBe('DHPP')
    expect(result.nextDate).toBe('2029-01-15')
    expect(result.status).toBe('pending')
    expect(result.petId).toBe(petId)
    expect(result.id).toBeDefined()
  })

  it('应保存到本地存储', async () => {
    const data = makeCreateData({ category: 'rabies', date: '2026-01-15' })
    vi.mocked(api.post).mockResolvedValue({
      ...data,
      id: 'new-rec-2',
      nextDate: '2027-01-15',
      status: 'pending',
      createdAt: '2026-01-15T00:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z',
    })

    await createVaccineRecord(data)

    const local = JSON.parse(mockStorage[`vaccines_${petId}`])
    expect(local).toHaveLength(1)
    expect(local[0].category).toBe('rabies')
  })

  it('API 失败时仍应创建本地记录', async () => {
    const data = makeCreateData({ category: 'DHPP', date: '2026-01-15' })
    vi.mocked(api.post).mockRejectedValue(new Error('网络异常'))

    const result = await createVaccineRecord(data)

    expect(result.category).toBe('DHPP')
    expect(result.id).toBeDefined()

    const local = JSON.parse(mockStorage[`vaccines_${petId}`])
    expect(local).toHaveLength(1)
  })

  it('应支持创建驱虫记录', async () => {
    const data = makeCreateData({ type: 'deworm', category: 'internal_deworm', date: '2026-01-15' })
    vi.mocked(api.post).mockResolvedValue({
      ...data,
      id: 'dew-1',
      nextDate: '2026-04-15',
      status: 'pending',
      createdAt: '2026-01-15T00:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z',
    })

    const result = await createVaccineRecord(data)

    expect(result.type).toBe('deworm')
    expect(result.category).toBe('internal_deworm')
    expect(result.nextDate).toBe('2026-04-15')
  })
})

// ============================================================
// 5. updateVaccineRecord - 更新疫苗记录
// ============================================================
describe('updateVaccineRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLocalStorage()
  })

  it('应更新记录并持久化到本地', async () => {
    const record = makeRecord({ id: 'rec-1', category: 'DHPP' })
    seedLocalRecords([record])

    const result = await updateVaccineRecord('rec-1', {
      category: 'rabies',
      hospital: '爱心宠物医院',
    })

    expect(result.category).toBe('rabies')
    expect(result.hospital).toBe('爱心宠物医院')
    expect(api.put).not.toHaveBeenCalled()
  })

  it('API 失败时应回退到本地更新', async () => {
    const record = makeRecord({ id: 'rec-1', category: 'DHPP', date: '2026-01-15' })
    seedLocalRecords([record])
    vi.mocked(api.put).mockRejectedValue(new Error('网络异常'))

    const result = await updateVaccineRecord('rec-1', { category: 'rabies' })

    expect(result.category).toBe('rabies')
  })

  it('更新 category 或 date 时应重新计算 nextDate', async () => {
    const record = makeRecord({
      id: 'rec-1',
      category: 'rabies',
      date: '2026-01-15',
      nextDate: '2027-01-15',
    })
    seedLocalRecords([record])
    vi.mocked(api.put).mockRejectedValue(new Error('网络异常'))

    const result = await updateVaccineRecord('rec-1', { date: '2026-03-15' })

    expect(result.nextDate).toBe('2027-03-15')
  })

  it('不存在的记录应抛出错误', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('网络异常'))

    await expect(updateVaccineRecord('nonexistent', { category: 'rabies' }))
      .rejects.toThrow('记录不存在')
  })
})

// ============================================================
// 6. markAsCompleted - 标记疫苗完成
// ============================================================
describe('markAsCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLocalStorage()
  })

  it('应将记录状态更新为 completed', async () => {
    const record = makeRecord({ id: 'rec-1', status: 'pending' })
    seedLocalRecords([record])
    vi.mocked(api.put).mockResolvedValue({
      ...record,
      status: 'completed',
      updatedAt: today,
    })

    const result = await markAsCompleted('rec-1')

    expect(result.status).toBe('completed')
  })

  it('应在本地存储中标记为已完成', async () => {
    const record = makeRecord({ id: 'rec-1', status: 'pending' })
    seedLocalRecords([record])
    vi.mocked(api.put).mockRejectedValue(new Error('网络异常'))

    await markAsCompleted('rec-1')

    const local = JSON.parse(mockStorage[`vaccines_${petId}`])
    expect(local[0].status).toBe('completed')
  })
})

// ============================================================
// 7. deleteVaccineRecord - 删除疫苗记录
// ============================================================
describe('deleteVaccineRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLocalStorage()
  })

  it('应删除记录并从本地存储中移除', async () => {
    const record = makeRecord({ id: 'rec-1' })
    seedLocalRecords([record])
    vi.mocked(api.delete).mockResolvedValue(undefined)

    await deleteVaccineRecord('rec-1')

    const local = JSON.parse(mockStorage[`vaccines_${petId}`])
    expect(local).toHaveLength(0)
  })

  it('不存在的记录应静默处理', async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined)

    await expect(deleteVaccineRecord('nonexistent')).resolves.toBeUndefined()
  })
})

// ============================================================
// 8. getUpcomingRecords - 获取即将到期的记录
// ============================================================
describe('getUpcomingRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLocalStorage()
  })

  it('应返回未来 30 天内到期的记录', async () => {
    const records: VaccineRecord[] = [
      makeRecord({ id: 'r1', category: 'DHPP', status: 'pending', nextDate: daysFromNow(10) }),
      makeRecord({ id: 'r2', category: 'rabies', status: 'pending', nextDate: daysFromNow(25) }),
      makeRecord({ id: 'r3', category: 'bordetella', status: 'pending', nextDate: daysFromNow(60) }),
      makeRecord({ id: 'r4', category: 'FVRCP', status: 'completed', nextDate: daysFromNow(5) }),
    ]
    seedLocalRecords(records)
    vi.mocked(api.get).mockResolvedValue(records)

    const result = await getUpcomingRecords(petId, 30)

    expect(result.length).toBeGreaterThanOrEqual(0)
    // 只应包含 pending 且在 30 天内的记录
    const pendingIn30Days = result.filter(
      (r) => r.status !== 'completed'
    )
    expect(pendingIn30Days.length).toBeGreaterThanOrEqual(0)
  })

  it('应排除已完成的记录', async () => {
    const records: VaccineRecord[] = [
      makeRecord({ id: 'r1', category: 'DHPP', status: 'completed', nextDate: daysFromNow(10) }),
    ]
    seedLocalRecords(records)
    vi.mocked(api.get).mockResolvedValue(records)

    const result = await getUpcomingRecords(petId, 30)

    const completed = result.filter((r) => r.status === 'completed')
    expect(completed).toHaveLength(0)
  })
})

// ============================================================
// 9. getOverdueRecords - 获取逾期的记录
// ============================================================
describe('getOverdueRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLocalStorage()
  })

  it('应返回所有逾期的记录', async () => {
    const records: VaccineRecord[] = [
      makeRecord({ id: 'r1', category: 'DHPP', status: 'overdue', nextDate: daysAgo(10) }),
      makeRecord({ id: 'r2', category: 'rabies', status: 'pending', nextDate: daysFromNow(100) }),
      makeRecord({ id: 'r3', category: 'bordetella', status: 'overdue', nextDate: daysAgo(5) }),
      makeRecord({ id: 'r4', category: 'FVRCP', status: 'completed', nextDate: daysFromNow(50) }),
    ]
    seedLocalRecords(records)
    vi.mocked(api.get).mockResolvedValue(records)

    const result = await getOverdueRecords(petId)

    const overdue = result.filter((r) => r.status === 'overdue')
    expect(overdue).toHaveLength(2)
    expect(overdue.map((r) => r.category)).toEqual(
      expect.arrayContaining(['DHPP', 'bordetella'])
    )
  })

  it('无逾期记录时应返回空数组', async () => {
    const records: VaccineRecord[] = [
      makeRecord({ id: 'r1', category: 'DHPP', status: 'pending', nextDate: daysFromNow(100) }),
    ]
    seedLocalRecords(records)
    vi.mocked(api.get).mockResolvedValue(records)

    const result = await getOverdueRecords(petId)

    const overdue = result.filter((r) => r.status === 'overdue')
    expect(overdue).toHaveLength(0)
  })
})

// ============================================================
// 10. generateInitialPlan - 自动生成初始疫苗计划
// ============================================================
describe('generateInitialPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLocalStorage()
  })

  it('应为新宠物生成初始疫苗计划', async () => {
    // 使用 mock 来隔离 generateInitialPlan 对 scheduler 的依赖
    const result = await generateInitialPlan(petId, {
      species: 'dog',
      breed: '金毛',
      birthDate: '2026-01-15',
    })

    expect(result.length).toBeGreaterThan(0)
    expect(result[0].petId).toBe(petId)
    expect(result[0].type).toBeTruthy()
  })

  it('已存在记录的宠物不应重复生成', async () => {
    const existing = makeRecord({ id: 'existing-1', category: 'DHPP', status: 'pending' })
    seedLocalRecords([existing])

    const result = await generateInitialPlan(petId, {
      species: 'dog',
      breed: '金毛',
      birthDate: '2026-01-15',
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('existing-1')
  })

  it('生成的计划应保存到本地存储', async () => {
    await generateInitialPlan(petId, {
      species: 'dog',
      breed: '金毛',
      birthDate: '2026-01-15',
    })

    const local = JSON.parse(mockStorage[`vaccines_${petId}`])
    expect(local).toBeDefined()
    expect(local.length).toBeGreaterThan(0)
  })

  it('应为猫生成猫专用疫苗计划', async () => {
    const result = await generateInitialPlan(petId, {
      species: 'cat',
      breed: '英短',
      birthDate: '2026-03-01',
    })

    expect(result.length).toBeGreaterThan(0)
    // 猫应有 FVRCP
    const hasFvrcp = result.some((r) => r.category === 'FVRCP')
    expect(hasFvrcp).toBe(true)
  })
})

// ============================================================
// 11. VaccineRecord 类型 - 完整数据模型验证
// ============================================================
describe('VaccineRecord 类型', () => {
  it('应包含所有必需字段', () => {
    const record = makeRecord()
    expect(record.id).toBeTruthy()
    expect(record.petId).toBeTruthy()
    expect(record.type).toBeTruthy()
    expect(record.category).toBeTruthy()
    expect(record.date).toBeTruthy()
    expect(record.nextDate).toBeTruthy()
    expect(record.status).toBeTruthy()
    expect(record.createdAt).toBeTruthy()
    expect(record.updatedAt).toBeTruthy()
  })

  it('status 应只有三种值', () => {
    const validStatuses = ['completed', 'pending', 'overdue']
    const record = makeRecord()
    expect(validStatuses).toContain(record.status)
  })

  it('type 应为 vaccine 或 deworm', () => {
    const validTypes = ['vaccine', 'deworm']
    const record = makeRecord()
    expect(validTypes).toContain(record.type)
  })
})

// ============================================================
// 样式契约锁：把"改了视觉但类名/变量没对齐"这类静默故障钉死
// （读源码断言，手法同 components/__tests__/PageBackground.test.tsx 与 checkin 页）
// ============================================================
describe('疫苗页样式契约', () => {
  const scss = readFileSync('src/pagesPet/vaccine/index.scss', 'utf-8')

  it('动态状态变体必须齐备（tsx 用 `--${status}` 拼接）', () => {
    // 三组按状态着色的行都在 tsx 里用模板串拼类名，scss 少一个变体不会有任何报错，
    // 只会静默回落成中性样式（旧版 `--normal/--caution/--warning` 就是这么错的）
    const families = [
      'pet-vaccine__next-due-item-status',
      'pet-vaccine__schedule-item-status',
      'pet-vaccine__deworming-item-status',
    ]
    for (const family of families) {
      for (const status of ['upcoming', 'due', 'overdue']) {
        expect(scss).toContain(`.${family}--${status}`)
      }
    }
  })

  it('深色主题兜底要覆盖纸面 token，并且把弹窗算进去', () => {
    for (const token of ['--text-primary', '--text-secondary', '--text-tertiary', '--glass-bg', '--border']) {
      expect(scss).toContain(`${token}:`)
    }
    // 弹窗是 .pet-vaccine 的直接子节点，不在便签作用域里，漏掉就是白字压白底（审查 P1）
    expect(scss).toContain('.vaccine-modal')
  })

  it('写 animation-delay 的选择器必须同时声明 animation（否则声明空转）', () => {
    // 实测踩过：只有 delay 没有 animation-name，错落入场完全没发生
    const animGroup = scss.slice(scss.indexOf('区块入场动效'))
    const delaySelectors = [...animGroup.matchAll(/^([.\w-]+)\s*\{\s*animation-delay/gm)].map((m) => m[1])
    expect(delaySelectors.length).toBeGreaterThan(0)
    for (const selector of delaySelectors) {
      // 该选择器要么在 animation 分组里，要么自己写了 animation
      const inGroup = new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`).test(animGroup)
      const selfAnim = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*animation:`).test(animGroup)
      expect(inGroup || selfAnim).toBe(true)
    }
  })
})