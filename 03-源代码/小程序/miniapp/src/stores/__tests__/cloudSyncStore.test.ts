/**
 * 云同步状态管理 - 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useCloudSyncStore } from '../cloudSyncStore'

const {
  mockGetSyncService,
  mockSyncAll,
  mockPushTable,
  mockPullTable,
  mockGetAllStatuses,
  mockExportAllData,
  mockImportData,
  mockClearCloudData,
} = vi.hoisted(() => ({
  mockGetSyncService: vi.fn(() => ({
    syncAll: mockSyncAll,
    pushTable: mockPushTable,
    pullTable: mockPullTable,
    getAllStatuses: mockGetAllStatuses,
    exportAllData: mockExportAllData,
    importData: mockImportData,
    clearCloudData: mockClearCloudData,
  })),
  mockSyncAll: vi.fn(() => Promise.resolve({ success: true, pushed: 5, pulled: 3, errors: [] as string[] })),
  mockPushTable: vi.fn(() => Promise.resolve({ pushed: 2, error: null as string | null })),
  mockPullTable: vi.fn(() => Promise.resolve({ pulled: 1, error: null as string | null })),
  mockGetAllStatuses: vi.fn(() => [{ table: 'pet_profiles' as const, lastPushAt: '2026-01-01', lastPullAt: '2026-01-01', pendingCount: 0, error: null }]),
  mockExportAllData: vi.fn(() => Promise.resolve({ pets: [] })),
  mockImportData: vi.fn(() => Promise.resolve({ imported: 5, errors: [] as string[] })),
  mockClearCloudData: vi.fn(() => Promise.resolve({ success: true, error: null as string | null })),
}))

vi.mock('../../services/syncService', () => ({
  getSyncService: mockGetSyncService,
}))

describe('cloudSyncStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockSyncAll.mockImplementation(() => Promise.resolve({ success: true, pushed: 5, pulled: 3, errors: [] as string[] }))
    mockPushTable.mockImplementation(() => Promise.resolve({ pushed: 2, error: null as string | null }))
    mockPullTable.mockImplementation(() => Promise.resolve({ pulled: 1, error: null as string | null }))
    mockGetAllStatuses.mockImplementation(() => [{ table: 'pet_profiles' as const, lastPushAt: '2026-01-01', lastPullAt: '2026-01-01', pendingCount: 0, error: null }])
    mockExportAllData.mockImplementation(() => Promise.resolve({ pets: [] }))
    mockImportData.mockImplementation(() => Promise.resolve({ imported: 5, errors: [] as string[] }))
    mockClearCloudData.mockImplementation(() => Promise.resolve({ success: true, error: null as string | null }))
    useCloudSyncStore.setState({
      syncService: null,
      statuses: [],
      isSyncing: false,
      lastSyncResult: null,
      error: null,
    })
  })

  describe('initial state', () => {
    it('should have null syncService', () => {
      expect(useCloudSyncStore.getState().syncService).toBeNull()
    })

    it('should have empty statuses array', () => {
      expect(useCloudSyncStore.getState().statuses).toEqual([])
    })

    it('should have isSyncing as false', () => {
      expect(useCloudSyncStore.getState().isSyncing).toBe(false)
    })

    it('should have null lastSyncResult', () => {
      expect(useCloudSyncStore.getState().lastSyncResult).toBeNull()
    })

    it('should have null error', () => {
      expect(useCloudSyncStore.getState().error).toBeNull()
    })
  })

  describe('init', () => {
    it('should create syncService and load statuses', () => {
      useCloudSyncStore.getState().init('user_123')

      expect(mockGetSyncService).toHaveBeenCalledWith('user_123')
      expect(useCloudSyncStore.getState().syncService).not.toBeNull()
      expect(mockGetAllStatuses).toHaveBeenCalled()
      expect(useCloudSyncStore.getState().statuses).toEqual([{ table: 'pet_profiles', lastPushAt: '2026-01-01', lastPullAt: '2026-01-01', pendingCount: 0, error: null }])
    })
  })

  describe('syncAll', () => {
    it('should return error when syncService not initialized', async () => {
      const result = await useCloudSyncStore.getState().syncAll()

      expect(result).toEqual({ success: false, pushed: 0, pulled: 0, errors: ['同步服务未初始化'] })
    })

    it('should call syncService.syncAll and update state', async () => {
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().syncAll()

      expect(mockSyncAll).toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.pushed).toBe(5)
      expect(result.pulled).toBe(3)
      expect(useCloudSyncStore.getState().lastSyncResult).toEqual(result)
      expect(useCloudSyncStore.getState().statuses).toEqual([{ table: 'pet_profiles', lastPushAt: '2026-01-01', lastPullAt: '2026-01-01', pendingCount: 0, error: null }])
    })

    it('should set isSyncing during sync', async () => {
      let resolveSync: (value: { success: boolean; pushed: number; pulled: number; errors: string[] }) => void
      const syncPromise = new Promise<{ success: boolean; pushed: number; pulled: number; errors: string[] }>(resolve => { resolveSync = resolve })
      mockSyncAll.mockReturnValue(syncPromise)
      useCloudSyncStore.getState().init('user_123')

      const syncCall = useCloudSyncStore.getState().syncAll()

      expect(useCloudSyncStore.getState().isSyncing).toBe(true)

      resolveSync!({ success: true, pushed: 0, pulled: 0, errors: [] as string[] })
      await syncCall

      expect(useCloudSyncStore.getState().isSyncing).toBe(false)
    })

    it('should set error on failure', async () => {
      mockSyncAll.mockResolvedValue({ success: false, pushed: 0, pulled: 0, errors: ['网络错误', '超时'] })
      useCloudSyncStore.getState().init('user_123')

      await useCloudSyncStore.getState().syncAll()

      expect(useCloudSyncStore.getState().error).toBe('网络错误; 超时')
    })

    it('should set error on exception', async () => {
      mockSyncAll.mockRejectedValue(new Error('Network failure'))
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().syncAll()

      expect(result.success).toBe(false)
      expect(useCloudSyncStore.getState().error).toBe('Network failure')
      expect(useCloudSyncStore.getState().isSyncing).toBe(false)
    })

    it('should handle non-Error exception', async () => {
      mockSyncAll.mockRejectedValue('unknown')
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().syncAll()

      expect(result.success).toBe(false)
      expect(useCloudSyncStore.getState().error).toBe('同步失败')
    })
  })

  describe('syncTable', () => {
    it('should return error when syncService not initialized', async () => {
      const result = await useCloudSyncStore.getState().syncTable('pet_profiles')

      expect(result).toEqual({ pushed: 0, pulled: 0, error: '同步服务未初始化' })
    })

    it('should call pushTable and pullTable', async () => {
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().syncTable('pet_profiles')

      expect(mockPushTable).toHaveBeenCalledWith('pet_profiles')
      expect(mockPullTable).toHaveBeenCalledWith('pet_profiles')
      expect(result.pushed).toBe(2)
      expect(result.pulled).toBe(1)
      expect(result.error).toBeNull()
    })

    it('should update statuses after sync', async () => {
      useCloudSyncStore.getState().init('user_123')

      await useCloudSyncStore.getState().syncTable('pet_profiles')

      expect(mockGetAllStatuses).toHaveBeenCalled()
      expect(useCloudSyncStore.getState().statuses).toEqual([{ table: 'pet_profiles', lastPushAt: '2026-01-01', lastPullAt: '2026-01-01', pendingCount: 0, error: null }])
    })

    it('should set error when pushTable returns error', async () => {
      mockPushTable.mockResolvedValue({ pushed: 0, error: 'push failed' })
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().syncTable('pet_profiles')

      expect(result.error).toBe('push failed')
      expect(useCloudSyncStore.getState().error).toBe('push failed')
    })

    it('should set error when pullTable returns error', async () => {
      mockPullTable.mockResolvedValue({ pulled: 0, error: 'pull failed' })
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().syncTable('pet_profiles')

      expect(result.error).toBe('pull failed')
      expect(useCloudSyncStore.getState().error).toBe('pull failed')
    })

    it('should set error on exception', async () => {
      mockPushTable.mockRejectedValue(new Error('Sync crash'))
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().syncTable('pet_profiles')

      expect(result.error).toBe('Sync crash')
      expect(useCloudSyncStore.getState().isSyncing).toBe(false)
    })

    it('should handle non-Error exception in syncTable', async () => {
      mockPushTable.mockRejectedValue('unknown')
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().syncTable('pet_profiles')

      expect(result.error).toBe('同步失败')
    })
  })

  describe('refreshStatuses', () => {
    it('should update statuses from syncService', () => {
      useCloudSyncStore.getState().init('user_123')
      mockGetAllStatuses.mockReturnValue([{ table: 'pet_profiles' as const, lastPushAt: '2026-07-01', lastPullAt: '2026-07-01', pendingCount: 0, error: null }])

      useCloudSyncStore.getState().refreshStatuses()

      expect(useCloudSyncStore.getState().statuses).toEqual([{ table: 'pet_profiles', lastPushAt: '2026-07-01', lastPullAt: '2026-07-01', pendingCount: 0, error: null }])
    })

    it('should do nothing when syncService is null', () => {
      useCloudSyncStore.setState({ statuses: [] })

      useCloudSyncStore.getState().refreshStatuses()

      expect(useCloudSyncStore.getState().statuses).toEqual([])
    })
  })

  describe('exportData', () => {
    it('should return empty object when syncService not initialized', async () => {
      const result = await useCloudSyncStore.getState().exportData()

      expect(result).toEqual({})
    })

    it('should call exportAllData', async () => {
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().exportData()

      expect(mockExportAllData).toHaveBeenCalled()
      expect(result).toEqual({ pets: [] })
    })
  })

  describe('importData', () => {
    it('should return error when syncService not initialized', async () => {
      const result = await useCloudSyncStore.getState().importData({ pets: [] })

      expect(result).toEqual({ imported: 0, errors: ['同步服务未初始化'] })
    })

    it('should call importData with data', async () => {
      useCloudSyncStore.getState().init('user_123')
      const data = { pets: [{ name: 'Kitty' }] }

      const result = await useCloudSyncStore.getState().importData(data)

      expect(mockImportData).toHaveBeenCalledWith(data)
      expect(result.imported).toBe(5)
    })
  })

  describe('clearCloudData', () => {
    it('should return error when syncService not initialized', async () => {
      const result = await useCloudSyncStore.getState().clearCloudData()

      expect(result).toEqual({ success: false, error: '同步服务未初始化' })
    })

    it('should call clearCloudData', async () => {
      useCloudSyncStore.getState().init('user_123')

      const result = await useCloudSyncStore.getState().clearCloudData()

      expect(mockClearCloudData).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })
  })

  describe('clearError', () => {
    it('should set error to null', () => {
      useCloudSyncStore.setState({ error: 'some error' })

      useCloudSyncStore.getState().clearError()

      expect(useCloudSyncStore.getState().error).toBeNull()
    })
  })
})
