/**
 * 应用设置状态管理 - 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useSettingsStore } from '../settingsStore'

const {
  mockGetStorageSync,
  mockSetStorageSync,
  mockClearStorageSync,
  mockRemoveStorageSync,
} = vi.hoisted(() => ({
  mockGetStorageSync: vi.fn(() => ''),
  mockSetStorageSync: vi.fn(),
  mockClearStorageSync: vi.fn(),
  mockRemoveStorageSync: vi.fn(),
}))

const {
  mockClearSubscribeStatus,
} = vi.hoisted(() => ({
  mockClearSubscribeStatus: vi.fn(),
}))

const {
  mockClearMoodEntries,
  mockClearAll,
} = vi.hoisted(() => ({
  mockClearMoodEntries: vi.fn(),
  mockClearAll: vi.fn(),
}))

const {
  mockGetStorageArray,
} = vi.hoisted(() => ({
  mockGetStorageArray: vi.fn<(key: string) => Record<string, unknown>[]>(() => []),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: mockGetStorageSync,
    setStorageSync: mockSetStorageSync,
    clearStorageSync: mockClearStorageSync,
    removeStorageSync: mockRemoveStorageSync,
    reLaunch: vi.fn(),
  },
}))

vi.mock('../../services/subscribeService', () => ({
  clearSubscribeStatus: mockClearSubscribeStatus,
}))

vi.mock('../../memory-body/store/miniProgramMemoryBodyStore', () => {
  function MockMiniProgramMemoryBodyStore(this: { clearHealthEntries: typeof mockClearMoodEntries; clearAll: typeof mockClearAll }) {
    this.clearHealthEntries = mockClearMoodEntries
    this.clearAll = mockClearAll
  }
  return { MiniProgramMemoryBodyStore: MockMiniProgramMemoryBodyStore }
})

vi.mock('../../utils/storage', () => ({
  getStorageArray: mockGetStorageArray,
}))

describe('settingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      notification: {
        checkinReminder: true,
        vaccineReminder: true,
        healthAlert: true,
      },
      isLoading: false,
      error: null,
    })
  })

  describe('初始状态', () => {
    it('默认通知设置全部为 true', () => {
      const state = useSettingsStore.getState()
      expect(state.notification).toEqual({
        checkinReminder: true,
        vaccineReminder: true,
        healthAlert: true,
      })
    })

    it('isLoading 为 false', () => {
      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('error 为 null', () => {
      const state = useSettingsStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('loadSettings', () => {
    it('从 storage 加载设置', () => {
      mockGetStorageSync.mockReturnValue(JSON.stringify({
        checkinReminder: false,
        vaccineReminder: true,
        healthAlert: false,
      }))

      useSettingsStore.getState().loadSettings()

      const state = useSettingsStore.getState()
      expect(state.notification).toEqual({
        checkinReminder: false,
        vaccineReminder: true,
        healthAlert: false,
      })
      expect(mockGetStorageSync).toHaveBeenCalledWith('xhh_notification_settings')
    })

    it('storage 为空时使用默认值', () => {
      mockGetStorageSync.mockReturnValue('')

      useSettingsStore.getState().loadSettings()

      const state = useSettingsStore.getState()
      expect(state.notification).toEqual({
        checkinReminder: true,
        vaccineReminder: true,
        healthAlert: true,
      })
    })

    it('storage 解析失败时使用默认值', () => {
      mockGetStorageSync.mockReturnValue('invalid-json')

      useSettingsStore.getState().loadSettings()

      const state = useSettingsStore.getState()
      expect(state.notification).toEqual({
        checkinReminder: true,
        vaccineReminder: true,
        healthAlert: true,
      })
    })
  })

  describe('updateNotification', () => {
    it('更新单个通知设置', () => {
      useSettingsStore.getState().updateNotification('checkinReminder', false)

      const state = useSettingsStore.getState()
      expect(state.notification.checkinReminder).toBe(false)
      expect(state.notification.vaccineReminder).toBe(true)
      expect(state.notification.healthAlert).toBe(true)
    })

    it('更新后保存到 storage', () => {
      useSettingsStore.getState().updateNotification('vaccineReminder', false)

      expect(mockSetStorageSync).toHaveBeenCalledWith(
        'xhh_notification_settings',
        JSON.stringify({
          checkinReminder: true,
          vaccineReminder: false,
          healthAlert: true,
        }),
      )
    })
  })

  describe('clearCache', () => {
    it('清除缓存并重置通知设置', () => {
      useSettingsStore.setState({
        notification: {
          checkinReminder: false,
          vaccineReminder: false,
          healthAlert: false,
        },
      })

      useSettingsStore.getState().clearCache()

      const state = useSettingsStore.getState()
      expect(mockClearStorageSync).toHaveBeenCalled()
      expect(state.notification).toEqual({
        checkinReminder: true,
        vaccineReminder: true,
        healthAlert: true,
      })
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('清除缓存失败时设置错误', () => {
      mockClearStorageSync.mockImplementation(() => {
        throw new Error('clear failed')
      })

      useSettingsStore.getState().clearCache()

      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('清除缓存失败')
    })
  })

  describe('clearCheckinData', () => {
    it('清除打卡数据', () => {
      useSettingsStore.getState().clearCheckinData()

      expect(mockRemoveStorageSync).toHaveBeenCalledWith('checkin_data')
      expect(mockClearMoodEntries).toHaveBeenCalled()
      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('清除打卡数据失败时设置错误', () => {
      mockClearMoodEntries.mockImplementation(() => {
        throw new Error('clear mood failed')
      })

      useSettingsStore.getState().clearCheckinData()

      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('清除打卡记录失败')
    })
  })

  describe('clearPetData', () => {
    it('清除宠物数据', () => {
      useSettingsStore.getState().clearPetData()

      expect(mockRemoveStorageSync).toHaveBeenCalledWith('pet_data')
      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('removeStorageSync 内部异常被 clearStorageKey 吞掉后仍正常完成', () => {
      mockRemoveStorageSync.mockImplementation(() => {
        throw new Error('remove failed')
      })

      useSettingsStore.getState().clearPetData()

      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('clearAllData', () => {
    it('清除所有数据', () => {
      useSettingsStore.setState({
        notification: {
          checkinReminder: false,
          vaccineReminder: false,
          healthAlert: false,
        },
      })

      useSettingsStore.getState().clearAllData()

      expect(mockRemoveStorageSync).toHaveBeenCalledWith('pet_data')
      expect(mockRemoveStorageSync).toHaveBeenCalledWith('checkin_data')
      expect(mockClearAll).toHaveBeenCalled()
      expect(mockClearSubscribeStatus).toHaveBeenCalled()
      const state = useSettingsStore.getState()
      expect(state.notification).toEqual({
        checkinReminder: true,
        vaccineReminder: true,
        healthAlert: true,
      })
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('清除所有数据失败时设置错误', () => {
      mockClearAll.mockImplementation(() => {
        throw new Error('clear all failed')
      })

      useSettingsStore.getState().clearAllData()

      const state = useSettingsStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('清除所有数据失败')
    })
  })

  describe('exportData', () => {
    it('导出数据为 JSON 字符串', () => {
      mockGetStorageArray.mockReturnValue([])

      const result = useSettingsStore.getState().exportData()

      expect(typeof result).toBe('string')
      expect(() => JSON.parse(result)).not.toThrow()
    })

    it('导出数据包含正确结构', () => {
      const mockCheckinData: Record<string, string>[] = [{ id: 'c1', date: '2025-07-01' }]
      const mockPetData: Record<string, string>[] = [{ id: 'p1', name: '小猫' }]
      mockGetStorageArray
        .mockImplementationOnce(() => mockCheckinData)
        .mockImplementationOnce(() => mockPetData)

      const result = useSettingsStore.getState().exportData()
      const parsed = JSON.parse(result)

      expect(parsed.version).toBe('2.0.0')
      expect(parsed.exportDate).toBeDefined()
      expect(parsed.data.checkinData).toEqual(mockCheckinData)
      expect(parsed.data.petData).toEqual(mockPetData)
      expect(parsed.data.notification).toEqual({
        checkinReminder: true,
        vaccineReminder: true,
        healthAlert: true,
      })
      expect(mockGetStorageArray).toHaveBeenCalledWith('checkin_data')
      expect(mockGetStorageArray).toHaveBeenCalledWith('pet_data')
    })
  })
})
