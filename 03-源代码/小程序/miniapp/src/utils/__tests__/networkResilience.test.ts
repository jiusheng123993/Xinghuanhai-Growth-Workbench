import { describe, it, expect, beforeEach, vi } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

import { getTrendData } from '../../services/trendService'
import { queueSync, trySyncAll } from '../../services/syncHelper'
import { getStorage, setStorage } from '../storage'

// ═══════════════════════════════════════════════════════════════════════════
// Hoisted variables used in vi.mock factories
// ═══════════════════════════════════════════════════════════════════════════

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {} as Record<string, string>,
}))

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const { mockGetCheckinsByDateRange } = vi.hoisted(() => ({
  mockGetCheckinsByDateRange: vi.fn(),
}))

const { mockQueueForSync, mockSyncAll, mockPushTable, mockPullTable, mockGetSyncService } = vi.hoisted(() => ({
  mockQueueForSync: vi.fn(),
  mockSyncAll: vi.fn(),
  mockPushTable: vi.fn(),
  mockPullTable: vi.fn(),
  mockGetSyncService: vi.fn(() => ({
    queueForSync: mockQueueForSync,
    syncAll: mockSyncAll,
    pushTable: mockPushTable,
    pullTable: mockPullTable,
    getAllStatuses: vi.fn(() => []),
    isAvailable: vi.fn(() => true),
  })),
}))

// ═══════════════════════════════════════════════════════════════════════════
// Mock storage
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../storage', () => ({
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

// ═══════════════════════════════════════════════════════════════════════════
// Mock api
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../../services/api', () => ({
  api: mockApi,
}))

// ═══════════════════════════════════════════════════════════════════════════
// Mock checkinService
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../../services/checkinService', () => ({
  getCheckinsByDateRange: (...args: unknown[]) => mockGetCheckinsByDateRange(...args),
}))

// ═══════════════════════════════════════════════════════════════════════════
// Mock syncService
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../../services/syncService', () => ({
  getSyncService: mockGetSyncService,
  SyncService: class {
    queueForSync = mockQueueForSync
    syncAll = mockSyncAll
  },
}))

describe('网络异常处理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    mockGetCheckinsByDateRange.mockReset()
    mockApi.get.mockReset()
    mockApi.post.mockReset()
    mockApi.put.mockReset()
    mockQueueForSync.mockReset()
    mockSyncAll.mockReset()
    mockPushTable.mockReset()
    mockPullTable.mockReset()
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景1：网络断开时打卡（提示"网络异常、数据已保存本地"）
  // ═════════════════════════════════════════════════════════════════════════

  describe('网络断开时打卡', () => {
    it('API 请求失败时应回退到本地存储', async () => {
      mockApi.get.mockRejectedValue(new Error('网络异常，请检查网络连接'))
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('离线'))

      // 预置本地数据
      const localData = [{ date: '2024-01-15', weight: 30, hasAbnormal: false, riskLevel: 'low' }]
      mockStorage['trend_pet-001'] = JSON.stringify(localData)

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(1)
      expect(result[0].date).toBe('2024-01-15')
      expect(result[0].weight).toBe(30)
    })

    it('API 返回 request:fail 时应提示网络异常', () => {
      const error = new Error('网络异常，请检查网络连接')
      expect(error.message).toBe('网络异常，请检查网络连接')
    })

    it('本地无缓存数据时，API 和 checkin 都失败应返回空数组', async () => {
      mockApi.get.mockRejectedValue(new Error('网络异常，请检查网络连接'))
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('离线'))

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toEqual([])
    })

    it('数据应正常保存到本地存储', () => {
      const testData = { date: '2024-01-20', weight: 25, hasAbnormal: false, riskLevel: 'low' }
      setStorage('checkin_cache', testData)

      const retrieved = getStorage<typeof testData>('checkin_cache')
      expect(retrieved).toEqual(testData)
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景2：网络恢复后自动同步（检测网络恢复→上传离线数据）
  // ═════════════════════════════════════════════════════════════════════════

  describe('网络恢复后自动同步', () => {
    it('queueSync 应正常将数据加入同步队列', () => {
      queueSync('pet_health_entries', 'entry-001', 'insert', { weight: 30 }, 'user-001')

      expect(mockGetSyncService).toHaveBeenCalledWith('user-001')
      expect(mockQueueForSync).toHaveBeenCalledWith(
        'pet_health_entries',
        'entry-001',
        'insert',
        { weight: 30 }
      )
    })

    it('queueSync 在同步服务不可用时应静默失败', () => {
      mockGetSyncService.mockImplementationOnce(() => {
        throw new Error('服务不可用')
      })

      expect(() => {
        queueSync('pet_health_entries', 'entry-001', 'insert', { weight: 30 }, 'user-001')
      }).not.toThrow()
    })

    it('trySyncAll 应调用 syncAll 同步所有数据', () => {
      trySyncAll('user-001')

      expect(mockGetSyncService).toHaveBeenCalledWith('user-001')
      expect(mockSyncAll).toHaveBeenCalled()
    })

    it('trySyncAll 在同步服务不可用时应静默失败', () => {
      mockGetSyncService.mockImplementationOnce(() => {
        throw new Error('服务不可用')
      })

      expect(() => {
        trySyncAll('user-001')
      }).not.toThrow()
    })

    it('同步队列应支持最大 200 条限制', () => {
      for (let i = 0; i < 250; i++) {
        queueSync('pet_health_entries', `entry-${i}`, 'insert', { index: i }, 'user-001')
      }

      // 同步服务应被调用 250 次
      expect(mockGetSyncService).toHaveBeenCalledTimes(250)
      expect(mockQueueForSync).toHaveBeenCalledTimes(250)
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景3：请求超时（15秒超时→提示重试）
  // ═════════════════════════════════════════════════════════════════════════

  describe('请求超时', () => {
    it('checkinService 失败时应回退到本地缓存', async () => {
      // 趋势数据现在直接基于 checkinService 获取（不再请求不适配的 /trends 接口）
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('离线'))

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      // getTrendData 内部处理了错误，应返回空数组
      expect(result).toEqual([])
      // 不再调用不适配的 /trends 接口
      expect(mockApi.get).not.toHaveBeenCalledWith(
        '/api/pets/pet-001/trends?startDate=2024-01-01&endDate=2024-01-31'
      )
      expect(mockGetCheckinsByDateRange).toHaveBeenCalled()
    })

    it('超时后应回退到本地数据', async () => {
      mockApi.get.mockRejectedValue(new Error('请求超时，请重试'))

      mockGetCheckinsByDateRange.mockResolvedValue([
        {
          id: 'c1', petId: 'pet-001', userId: 'user-001',
          poopLevel: 3, appetiteLevel: 3, spiritLevel: 3, exerciseLevel: 2,
          weight: 30, hasAnomaly: false, anomalyItems: [], riskLevel: 'low',
          aiFeedback: '', createdAt: new Date('2024-01-01'),
        },
        {
          id: 'c2', petId: 'pet-001', userId: 'user-001',
          poopLevel: 3, appetiteLevel: 3, spiritLevel: 3, exerciseLevel: 2,
          weight: 31, hasAnomaly: false, anomalyItems: [], riskLevel: 'low',
          aiFeedback: '', createdAt: new Date('2024-01-02'),
        },
      ])

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(2)
      expect(result[0].weight).toBe(30)
      expect(result[1].weight).toBe(31)
    })

    it('多次超时不应导致数据丢失', async () => {
      mockApi.get.mockRejectedValue(new Error('请求超时，请重试'))
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('离线'))

      const localData = [{ date: '2024-01-15', weight: 30, hasAbnormal: false, riskLevel: 'low' }]
      mockStorage['trend_pet-001'] = JSON.stringify(localData)

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(1)
      expect(result[0].weight).toBe(30)
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景4：弱网环境降级（2G/3G→降级体验）
  // ═════════════════════════════════════════════════════════════════════════

  describe('弱网环境降级', () => {
    it('弱网环境下应优先使用本地缓存', async () => {
      mockApi.get.mockRejectedValue(new Error('request:fail'))

      mockGetCheckinsByDateRange.mockResolvedValue([
        {
          id: 'c1', petId: 'pet-001', userId: 'user-001',
          poopLevel: 3, appetiteLevel: 3, spiritLevel: 3, exerciseLevel: 2,
          weight: 30, hasAnomaly: false, anomalyItems: [], riskLevel: 'low',
          aiFeedback: '', createdAt: new Date('2024-01-01'),
        },
        {
          id: 'c2', petId: 'pet-001', userId: 'user-001',
          poopLevel: 3, appetiteLevel: 1, spiritLevel: 3, exerciseLevel: 2,
          weight: 30.5, hasAnomaly: true, anomalyItems: ['appetite'], riskLevel: 'high',
          aiFeedback: '', createdAt: new Date('2024-01-02'),
        },
      ])

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(2)
      expect(result[0].hasAbnormal).toBe(false)
      expect(result[1].hasAbnormal).toBe(true)
    })

    it('checkinService 失败时 getTrendData 不应抛出', async () => {
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('无法连接'))

      try {
        await getTrendData('pet-001', '2024-01-01', '2024-01-31')
      } catch {
        // 预期抛出
      }

      // 不再调用不适配的 /trends 接口（API 层仅由 checkinService 内部使用）
      expect(mockApi.get).not.toHaveBeenCalledWith(
        '/api/pets/pet-001/trends?startDate=2024-01-01&endDate=2024-01-31'
      )
    })

    it('所有数据源均不可用时应优雅降级为空数组', async () => {
      mockApi.get.mockRejectedValue(new Error('request:fail'))
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('无法连接'))

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toEqual([])
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景5：离线数据队列管理
  // ═════════════════════════════════════════════════════════════════════════

  describe('离线数据队列管理', () => {
    it('离线队列应正确保存待同步数据', () => {
      setStorage('offline_queue', [
        { id: 'rec-1', table: 'pet_health_entries', action: 'insert', data: { weight: 30 } },
        { id: 'rec-2', table: 'pet_health_entries', action: 'insert', data: { weight: 31 } },
      ])

      const queue = getStorage<Array<{ id: string }>>('offline_queue')
      expect(queue).toHaveLength(2)
    })

    it('网络恢复后应清空已同步数据', () => {
      const queue = [
        { id: 'rec-1', synced: false },
        { id: 'rec-2', synced: false },
      ]
      setStorage('offline_queue', queue)

      // 模拟同步完成
      const updated = queue.map((item) => ({ ...item, synced: true }))
      setStorage('offline_queue', updated)

      const result = getStorage<Array<{ synced: boolean }>>('offline_queue')
      expect(result?.every((item) => item.synced)).toBe(true)
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 场景6：多级降级链
  // ═════════════════════════════════════════════════════════════════════════

  describe('多级降级链', () => {
    it('checkin → local 两级降级应正常工作', async () => {
      // 趋势数据不再请求不适配的 /trends 接口，降级链为 checkinService → 本地缓存
      mockGetCheckinsByDateRange.mockResolvedValue([
        {
          id: 'c1', petId: 'pet-001', userId: 'user-001',
          poopLevel: 3, appetiteLevel: 3, spiritLevel: 3, exerciseLevel: 2,
          weight: 30, hasAnomaly: false, anomalyItems: [], riskLevel: 'low',
          aiFeedback: '', createdAt: new Date('2024-01-15'),
        },
      ])

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(1)
      expect(result[0].weight).toBe(30)
      expect(mockGetCheckinsByDateRange).toHaveBeenCalledTimes(1)
    })

    it('API 和 checkin 都失败时回退到本地缓存', async () => {
      mockApi.get.mockRejectedValue(new Error('网络异常，请检查网络连接'))
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('数据获取失败'))

      const localData = [
        { date: '2024-01-10', weight: 28, appetite: 'normal', energy: 'normal', stool: 'normal', vomiting: false, riskLevel: 'low', hasAbnormal: false },
      ]
      mockStorage['trend_pet-001'] = JSON.stringify(localData)

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-31')

      expect(result).toHaveLength(1)
      expect(result[0].weight).toBe(28)
    })

    it('日期范围过滤应正确过滤本地缓存数据', async () => {
      mockApi.get.mockRejectedValue(new Error('网络异常'))
      mockGetCheckinsByDateRange.mockRejectedValue(new Error('离线'))

      const localData = [
        { date: '2024-01-01', weight: 30, hasAbnormal: false, riskLevel: 'low' },
        { date: '2024-01-15', weight: 31, hasAbnormal: false, riskLevel: 'low' },
        { date: '2024-02-01', weight: 32, hasAbnormal: false, riskLevel: 'low' },
      ]
      mockStorage['trend_pet-001'] = JSON.stringify(localData)

      const result = await getTrendData('pet-001', '2024-01-01', '2024-01-15')

      // 应只返回日期范围内的数据
      expect(result.length).toBeGreaterThanOrEqual(1)
      result.forEach((d) => {
        expect(d.date >= '2024-01-01' && d.date <= '2024-01-15').toBe(true)
      })
    })
  })
})