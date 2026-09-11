/**
 * NPS 满意度调查服务测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  checkNpsEligibility,
  getTriggerEvent,
  submitNpsResponse,
  dismissNpsSurvey,
  getNpsStatus,
} from '../npsService'

const memoryStore = new Map<string, unknown>()

const { mockGetStorage, mockSetStorage, mockRemoveStorage } = vi.hoisted(() => ({
  mockGetStorage: vi.fn((key: string) => memoryStore.get(key) ?? ''),
  mockSetStorage: vi.fn((key: string, value: unknown): void => { memoryStore.set(key, value) }),
  mockRemoveStorage: vi.fn((key: string): void => { memoryStore.delete(key) }),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: mockGetStorage,
    setStorageSync: mockSetStorage,
    removeStorageSync: mockRemoveStorage,
    clearStorageSync: vi.fn(),
    request: vi.fn(() => Promise.resolve({ statusCode: 200, data: {} })),
  },
}))

const { mockApiPost } = vi.hoisted(() => ({
  mockApiPost: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    post: mockApiPost,
  },
}))

vi.mock('../../config/supabase', () => ({
  ENV: {
    development: {
      apiBaseUrl: 'http://localhost:3000',
      supabaseUrl: 'http://localhost:54321',
      supabaseKey: 'mock-key',
      useMock: true,
    },
  },
  STORAGE_KEYS: {
    TOKEN: 'xhh_token',
    NPS_STATUS: 'xhh_nps_status',
    NPS_DISMISSED: 'xhh_nps_dismissed_at',
  },
}))

function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

describe('npsService', () => {
  beforeEach(() => {
    memoryStore.clear()
    vi.clearAllMocks()
    mockApiPost.mockResolvedValue({
      id: 'resp-1',
      userId: 'user-123',
      score: 8,
      triggerEvent: 'day_7',
      feedback: 'Great app',
      submittedAt: new Date().toISOString(),
    })
  })

  describe('checkNpsEligibility', () => {
    it('should be eligible when signup >= 7 days and no previous survey', () => {
      const result = checkNpsEligibility('user-123', daysAgo(10))
      expect(result.isEligible).toBe(true)
      expect(result.lastSurveyAt).toBeNull()
    })

    it('should not be eligible when signup < 7 days', () => {
      const result = checkNpsEligibility('user-123', daysAgo(3))
      expect(result.isEligible).toBe(false)
      expect(result.nextSurveyAt).not.toBeNull()
    })

    it('should be eligible after cooldown period', () => {
      const lastSurveyAt = daysAgo(31)
      memoryStore.set('xhh_nps_status', {
        lastSurveyAt,
        lastScore: 7,
        totalSurveys: 1,
      })

      const result = checkNpsEligibility('user-123', daysAgo(60))
      expect(result.isEligible).toBe(true)
    })

    it('should not be eligible during cooldown', () => {
      const lastSurveyAt = daysAgo(10)
      memoryStore.set('xhh_nps_status', {
        lastSurveyAt,
        lastScore: 7,
        totalSurveys: 1,
      })

      const result = checkNpsEligibility('user-123', daysAgo(60))
      expect(result.isEligible).toBe(false)
      expect(result.nextSurveyAt).not.toBeNull()
    })

    it('should be eligible after dismissed cooldown', () => {
      memoryStore.set('xhh_nps_dismissed_at', daysAgo(31))

      const result = checkNpsEligibility('user-123', daysAgo(40))
      expect(result.isEligible).toBe(true)
    })

    it('should not be eligible during dismissed cooldown', () => {
      memoryStore.set('xhh_nps_dismissed_at', daysAgo(10))

      const result = checkNpsEligibility('user-123', daysAgo(40))
      expect(result.isEligible).toBe(false)
      expect(result.nextSurveyAt).not.toBeNull()
    })

    it('should not be eligible after dismissed cooldown if signup < 7 days', () => {
      memoryStore.set('xhh_nps_dismissed_at', daysAgo(31))

      const result = checkNpsEligibility('user-123', daysAgo(3))
      expect(result.isEligible).toBe(false)
    })
  })

  describe('getTriggerEvent', () => {
    it('should return day_7 for 7-29 days', () => {
      expect(getTriggerEvent(daysAgo(7))).toBe('day_7')
      expect(getTriggerEvent(daysAgo(15))).toBe('day_7')
      expect(getTriggerEvent(daysAgo(29))).toBe('day_7')
    })

    it('should return day_30 for 30+ days', () => {
      expect(getTriggerEvent(daysAgo(30))).toBe('day_30')
      expect(getTriggerEvent(daysAgo(60))).toBe('day_30')
    })

    it('should return manual for < 7 days', () => {
      expect(getTriggerEvent(daysAgo(0))).toBe('manual')
      expect(getTriggerEvent(daysAgo(6))).toBe('manual')
    })
  })

  describe('submitNpsResponse', () => {
    it('should reject score < 0', async () => {
      const result = await submitNpsResponse('user-123', -1, 'day_7', 'bad')
      expect(result).toBeNull()
      expect(mockApiPost).not.toHaveBeenCalled()
    })

    it('should reject score > 10', async () => {
      const result = await submitNpsResponse('user-123', 11, 'day_7', 'bad')
      expect(result).toBeNull()
      expect(mockApiPost).not.toHaveBeenCalled()
    })

    it('should submit valid response', async () => {
      const result = await submitNpsResponse('user-123', 8, 'day_7', 'Great app')
      expect(result).not.toBeNull()
      expect(result!.score).toBe(8)
      expect(result!.triggerEvent).toBe('day_7')
      expect(mockApiPost).toHaveBeenCalledWith('/api/feedback/nps', {
        score: 8,
        feedback: 'Great app',
        trigger_event: 'day_7',
      })
    })

    it('should update local status after submit', async () => {
      await submitNpsResponse('user-123', 9, 'day_30', 'Nice')

      const stored = memoryStore.get('xhh_nps_status') as Record<string, unknown>
      expect(stored).toBeDefined()
      expect(stored.lastScore).toBe(9)
      expect(stored.totalSurveys).toBe(1)
      expect(stored.lastSurveyAt).not.toBeNull()
    })

    it('should increment totalSurveys on subsequent submits', async () => {
      memoryStore.set('xhh_nps_status', {
        lastSurveyAt: daysAgo(31),
        lastScore: 7,
        totalSurveys: 1,
      })

      await submitNpsResponse('user-123', 9, 'day_30', 'Nice')

      const stored = memoryStore.get('xhh_nps_status') as Record<string, unknown>
      expect(stored.totalSurveys).toBe(2)
    })

    it('should clear dismissed key after submit', async () => {
      memoryStore.set('xhh_nps_dismissed_at', daysAgo(5))

      await submitNpsResponse('user-123', 8, 'day_7', 'Great')

      expect(memoryStore.has('xhh_nps_dismissed_at')).toBe(false)
      expect(mockRemoveStorage).toHaveBeenCalledWith('xhh_nps_dismissed_at')
    })
  })

  describe('dismissNpsSurvey', () => {
    it('should store dismissed timestamp', () => {
      dismissNpsSurvey()

      const dismissedAt = memoryStore.get('xhh_nps_dismissed_at') as string
      expect(dismissedAt).not.toBeNull()
      expect(new Date(dismissedAt).getTime()).toBeLessThanOrEqual(Date.now())
      expect(mockSetStorage).toHaveBeenCalledWith('xhh_nps_dismissed_at', expect.any(String))
    })
  })

  describe('getNpsStatus', () => {
    it('should return default status when no data', () => {
      const status = getNpsStatus()
      expect(status.lastSurveyAt).toBeNull()
      expect(status.lastScore).toBeNull()
      expect(status.totalSurveys).toBe(0)
      expect(status.nextSurveyAt).toBeNull()
      expect(status.isEligible).toBe(true)
    })

    it('should return stored status', () => {
      memoryStore.set('xhh_nps_status', {
        lastSurveyAt: '2025-01-15T00:00:00.000Z',
        lastScore: 8,
        totalSurveys: 2,
      })

      const status = getNpsStatus()
      expect(status.lastSurveyAt).toBe('2025-01-15T00:00:00.000Z')
      expect(status.lastScore).toBe(8)
      expect(status.totalSurveys).toBe(2)
    })

    it('should not be eligible when dismissed', () => {
      memoryStore.set('xhh_nps_dismissed_at', daysAgo(5))

      const status = getNpsStatus()
      expect(status.isEligible).toBe(false)
    })
  })
})
