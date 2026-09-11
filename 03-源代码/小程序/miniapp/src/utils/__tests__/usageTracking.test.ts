import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  incrementFoodQueryCount,
  incrementSymptomCheckCount,
  isNewUser,
  getRecentFoodQueryCount,
  getRecentSymptomCheckCount,
  recordAppOpen,
  getRecentOpenCount,
} from '../usageTracking'

let mockStorage: Record<string, string> = {}

const { mockGetStorageSync, mockSetStorageSync } = vi.hoisted(() => ({
  mockGetStorageSync: vi.fn((key: string): string | null => {
    return mockStorage[key] ?? ''
  }),
  mockSetStorageSync: vi.fn((key: string, value: string): void => {
    mockStorage[key] = value
  }),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: mockGetStorageSync,
    setStorageSync: mockSetStorageSync,
  },
}))

describe('usageTracking', () => {
  beforeEach(() => {
    mockStorage = {}
    vi.clearAllMocks()
  })

  describe('isNewUser', () => {
    it('returns true for first-time user', () => {
      expect(isNewUser()).toBe(true)
      expect(mockSetStorageSync).toHaveBeenCalledWith('xhh_first_seen_at', expect.any(String))
    })

    it('returns true for user within 7 days', () => {
      mockStorage['xhh_first_seen_at'] = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      expect(isNewUser()).toBe(true)
    })

    it('returns false for user older than 7 days', () => {
      mockStorage['xhh_first_seen_at'] = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
      expect(isNewUser()).toBe(false)
    })
  })

  describe('time-windowed counting', () => {
    it('getRecentFoodQueryCount returns count within 7-day window', () => {
      const now = Date.now()
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
      const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000
      mockStorage['xhh_food_query_timestamps'] = JSON.stringify([
        eightDaysAgo,
        sevenDaysAgo + 1000,
        now,
      ])
      expect(getRecentFoodQueryCount()).toBe(2)
    })

    it('getRecentSymptomCheckCount returns count within 7-day window', () => {
      const now = Date.now()
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
      mockStorage['xhh_symptom_check_timestamps'] = JSON.stringify([
        sevenDaysAgo + 1000,
        now,
      ])
      expect(getRecentSymptomCheckCount()).toBe(2)
    })

    it('incrementFoodQueryCount appends timestamp and cleans up old entries', () => {
      const now = Date.now()
      const oldTimestamp = now - 30 * 24 * 60 * 60 * 1000
      mockStorage['xhh_food_query_timestamps'] = JSON.stringify([oldTimestamp])
      incrementFoodQueryCount()
      const stored = JSON.parse(mockStorage['xhh_food_query_timestamps'])
      expect(stored).toHaveLength(1)
      expect(stored[0]).toBeGreaterThan(oldTimestamp)
    })

    it('incrementSymptomCheckCount appends timestamp and cleans up old entries', () => {
      const now = Date.now()
      const oldTimestamp = now - 30 * 24 * 60 * 60 * 1000
      mockStorage['xhh_symptom_check_timestamps'] = JSON.stringify([oldTimestamp])
      incrementSymptomCheckCount()
      const stored = JSON.parse(mockStorage['xhh_symptom_check_timestamps'])
      expect(stored).toHaveLength(1)
      expect(stored[0]).toBeGreaterThan(oldTimestamp)
    })

    it('getRecentFoodQueryCount returns 0 when no data', () => {
      expect(getRecentFoodQueryCount()).toBe(0)
    })

    it('getRecentSymptomCheckCount returns 0 when no data', () => {
      expect(getRecentSymptomCheckCount()).toBe(0)
    })
  })

  describe('user open frequency', () => {
    it('recordAppOpen records timestamp', () => {
      recordAppOpen()
      const stored = JSON.parse(mockStorage['xhh_app_open_timestamps'])
      expect(stored).toHaveLength(1)
    })

    it('getRecentOpenCount returns count within 3-day window', () => {
      const now = Date.now()
      const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000
      const fourDaysAgo = now - 4 * 24 * 60 * 60 * 1000
      mockStorage['xhh_app_open_timestamps'] = JSON.stringify([
        fourDaysAgo,
        threeDaysAgo + 1000,
        now,
      ])
      expect(getRecentOpenCount()).toBe(2)
    })

    it('getRecentOpenCount returns 0 when no data', () => {
      expect(getRecentOpenCount()).toBe(0)
    })

    it('recordAppOpen cleans up old entries beyond 3 days', () => {
      const now = Date.now()
      const oldTimestamp = now - 10 * 24 * 60 * 60 * 1000
      mockStorage['xhh_app_open_timestamps'] = JSON.stringify([oldTimestamp])
      recordAppOpen()
      const stored = JSON.parse(mockStorage['xhh_app_open_timestamps'])
      expect(stored).toHaveLength(1)
      expect(stored[0]).toBeGreaterThan(oldTimestamp)
    })
  })
})
