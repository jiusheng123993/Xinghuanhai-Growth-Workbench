/**
 * 数据隐私服务测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  exportAllUserData,
  deleteUserData,
  generateDeletionConfirmCode,
  verifyDeletionConfirmCode,
  requestAccountDeletion,
  cancelAccountDeletion,
  getDataPrivacyStatus,
} from '../dataPrivacyService'

const memoryStore = new Map<string, unknown>()

const { mockGetStorage, mockSetStorage } = vi.hoisted(() => ({
  mockGetStorage: vi.fn(<T,>(key: string): T | null => (memoryStore.get(key) as T) ?? null),
  mockSetStorage: vi.fn((key: string, value: unknown): void => { memoryStore.set(key, value) }),
}))

vi.mock('../../utils/storage', () => ({
  getStorage: mockGetStorage,
  setStorage: mockSetStorage,
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn((key: string) => memoryStore.get(key) ?? ''),
    clearStorageSync: vi.fn(),
    request: vi.fn(() => Promise.resolve({ statusCode: 200, data: {} })),
  },
}))

vi.mock('../supabaseClient', () => ({
  supabaseClient: {
    select: vi.fn(() => Promise.resolve({ data: [], error: null, status: 200 })),
    delete: vi.fn(() => Promise.resolve({ data: null, error: null, status: 200 })),
    isMock: true,
  },
}))

vi.mock('../../config', () => ({
  CONFIG: {
    API_BASE_URL: 'http://localhost:3000',
    USE_MOCK: true,
    STORAGE_KEYS: {
      TOKEN: 'xhh_token',
      USER: 'xhh_user',
      REFRESH_TOKEN: 'xhh_refresh_token',
    },
  },
}))

vi.mock('../mock', () => ({
  mockApi: {
    getTrendSummary: vi.fn(() => ({})),
    getMonthlyReport: vi.fn(() => ({})),
    getTrendData: vi.fn(() => ({})),
    getHealthCheckinsByDateRange: vi.fn(() => ({})),
    login: vi.fn(() => ({})),
    getUser: vi.fn(() => ({})),
    getPets: vi.fn(() => []),
    getPet: vi.fn(() => null),
    createPet: vi.fn(() => ({})),
    updatePet: vi.fn(() => ({})),
    deletePet: vi.fn(),
    getCheckins: vi.fn(() => []),
    createCheckin: vi.fn(() => ({})),
    getMembership: vi.fn(() => null),
  },
}))

describe('dataPrivacyService', () => {
  beforeEach(() => {
    memoryStore.clear()
  })

  describe('generateDeletionConfirmCode', () => {
    it('should generate a 6-character code', () => {
      const code = generateDeletionConfirmCode()
      expect(code).toHaveLength(6)
      expect(code).toMatch(/^[A-Z0-9]+$/)
    })
  })

  describe('verifyDeletionConfirmCode', () => {
    it('should verify correct code', () => {
      const code = generateDeletionConfirmCode()
      expect(verifyDeletionConfirmCode(code)).toBe(true)
    })

    it('should reject incorrect code', () => {
      generateDeletionConfirmCode()
      expect(verifyDeletionConfirmCode('WRONG')).toBe(false)
    })
  })

  describe('exportAllUserData', () => {
    it('should export data successfully', async () => {
      const result = await exportAllUserData('user-123')
      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.tables).toContain('pet_profiles')
      expect(result.totalRecords).toBeGreaterThanOrEqual(0)
    })
  })

  describe('deleteUserData', () => {
    it('should delete data successfully', async () => {
      const result = await deleteUserData('user-123')
      expect(result.success).toBe(true)
      expect(result.deletedTables.length).toBeGreaterThan(0)
    })

    it('should delete specific tables', async () => {
      const result = await deleteUserData('user-123', ['pet_profiles'])
      expect(result.success).toBe(true)
      expect(result.deletedTables).toContain('pet_profiles')
    })
  })

  describe('requestAccountDeletion', () => {
    it('should reject with wrong confirm code', async () => {
      generateDeletionConfirmCode()
      const result = await requestAccountDeletion('user-123', {
        reason: 'no_longer_needed',
        confirmCode: 'WRONG',
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('确认码')
    })

    it('should succeed with correct confirm code', async () => {
      const code = generateDeletionConfirmCode()
      const result = await requestAccountDeletion('user-123', {
        reason: 'privacy_concern',
        confirmCode: code,
      })
      expect(result.success).toBe(true)
      expect(result.scheduledDeletionAt).toBeDefined()
      expect(result.gracePeriodDays).toBe(30)
    })
  })

  describe('cancelAccountDeletion', () => {
    it('should cancel deletion successfully', async () => {
      const code = generateDeletionConfirmCode()
      await requestAccountDeletion('user-123', {
        reason: 'no_longer_needed',
        confirmCode: code,
      })

      const result = await cancelAccountDeletion('user-123')
      expect(result).toBe(true)

      const status = getDataPrivacyStatus()
      expect(status.accountDeletionRequested).toBe(false)
    })
  })

  describe('getDataPrivacyStatus', () => {
    it('should return default status when no data', () => {
      const status = getDataPrivacyStatus()
      expect(status.lastExportAt).toBeNull()
      expect(status.accountDeletionRequested).toBe(false)
    })
  })
})
