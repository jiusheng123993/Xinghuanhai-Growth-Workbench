/**
 * 情绪追踪服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  trackEmotionEvent,
  getEmotionScore,
  shouldShowCrisisReferral,
  recordCrisisReferralShown,
  getEmotionTrend,
  getCrisisSeverity,
  recordFollowUp,
} from '../emotionTrackingService'

const mockStorage: Record<string, string> = {}

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn((key: string) => mockStorage[key] || ''),
    setStorageSync: vi.fn((key: string, value: string) => { mockStorage[key] = value }),
  },
}))

const DAY_MS = 86400000
const NOW = new Date('2026-07-25T12:00:00.000Z').getTime()

function makeEvent(
  daysAgo: number,
  severity: 'mild' | 'moderate' | 'severe',
  eventType: 'anomaly_detected' | 'symptom_check' | 'food_query' | 'grief_detected' | 'anxiety_detected' = 'symptom_check',
) {
  return {
    timestamp: NOW - daysAgo * DAY_MS,
    eventType,
    severity,
  }
}

function setEvents(petId: string, events: ReturnType<typeof makeEvent>[]) {
  mockStorage[`emotion_track_${petId}`] = JSON.stringify(events)
}

function setCrisisShown(petId: string, timestamp: number) {
  mockStorage[`crisis_shown_${petId}`] = timestamp.toString()
}

describe('emotionTrackingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    vi.setSystemTime(NOW)
  })

  // ============================================================
  // trackEmotionEvent
  // ============================================================
  describe('trackEmotionEvent', () => {
    it('should add event to storage for a pet', () => {
      trackEmotionEvent('pet-001', 'symptom_check', 'moderate')

      const raw = mockStorage['emotion_track_pet-001']
      expect(raw).toBeDefined()

      const parsed = JSON.parse(raw)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].eventType).toBe('symptom_check')
      expect(parsed[0].severity).toBe('moderate')
      expect(parsed[0].timestamp).toBe(NOW)
    })

    it('should append to existing events', () => {
      setEvents('pet-001', [makeEvent(1, 'mild')])

      trackEmotionEvent('pet-001', 'anxiety_detected', 'severe')

      const parsed = JSON.parse(mockStorage['emotion_track_pet-001'])
      expect(parsed).toHaveLength(2)
      expect(parsed[0].severity).toBe('mild')
      expect(parsed[1].severity).toBe('severe')
    })

    it('should filter out events older than 7 days on save', () => {
      setEvents('pet-001', [
        makeEvent(8, 'severe'),   // 8 days ago — should be removed
        makeEvent(6, 'moderate'), // 6 days ago — should stay
        makeEvent(5, 'mild'),     // 5 days ago — should stay
      ])

      trackEmotionEvent('pet-001', 'food_query', 'mild')

      const parsed = JSON.parse(mockStorage['emotion_track_pet-001'])
      expect(parsed).toHaveLength(3) // 2 old kept + 1 new
      const timestamps = parsed.map((e: { timestamp: number }) => e.timestamp)
      // The 8-day-old event should be filtered out
      expect(timestamps.every((t: number) => (NOW - t) <= 7 * DAY_MS)).toBe(true)
    })
  })

  // ============================================================
  // getEmotionScore
  // ============================================================
  describe('getEmotionScore', () => {
    it('should return 0 when no events', () => {
      const score = getEmotionScore('pet-001')
      expect(score).toBe(0)
    })

    it('should return 0 when all events are older than 7 days', () => {
      setEvents('pet-001', [
        makeEvent(8, 'severe'),
        makeEvent(10, 'severe'),
      ])

      const score = getEmotionScore('pet-001')
      expect(score).toBe(0)
    })

    it('should return higher score for severe events', () => {
      setEvents('pet-001', [makeEvent(0, 'severe')])

      const severeScore = getEmotionScore('pet-001')

      setEvents('pet-002', [makeEvent(0, 'mild')])
      const mildScore = getEmotionScore('pet-002')

      expect(severeScore).toBeGreaterThan(mildScore)
    })

    it('should return higher score for moderate vs mild', () => {
      setEvents('pet-001', [makeEvent(0, 'moderate')])
      const moderateScore = getEmotionScore('pet-001')

      setEvents('pet-002', [makeEvent(0, 'mild')])
      const mildScore = getEmotionScore('pet-002')

      expect(moderateScore).toBeGreaterThan(mildScore)
    })

    it('should return score capped at 100', () => {
      // 7 severe events at day 0 = 7 * 5 * 1.0 = 35, (35/7)*20 = 100
      // But to push beyond, let's add many severe events
      const events = Array.from({ length: 20 }, () => makeEvent(0, 'severe'))
      setEvents('pet-001', events)

      const score = getEmotionScore('pet-001')
      expect(score).toBeLessThanOrEqual(100)
    })

    it('should apply time decay (older events contribute less)', () => {
      // Same severity, different ages
      setEvents('pet-001', [makeEvent(0, 'severe')])
      const freshScore = getEmotionScore('pet-001')

      setEvents('pet-001', [makeEvent(3, 'severe')])
      const olderScore = getEmotionScore('pet-001')

      expect(olderScore).toBeLessThan(freshScore)
    })

    it('should return a score computed via formula', () => {
      // 1 severe event at day 0: weight=5, decay=1.0 => 5
      // score = (5/7)*20 ≈ 14.28 => rounded to 14
      setEvents('pet-001', [makeEvent(0, 'severe')])
      const score = getEmotionScore('pet-001')
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(100)
    })
  })

  // ============================================================
  // shouldShowCrisisReferral
  // ============================================================
  describe('shouldShowCrisisReferral', () => {
    it('should return false when score < 70', () => {
      setEvents('pet-001', [makeEvent(0, 'mild')])
      expect(shouldShowCrisisReferral('pet-001')).toBe(false)
    })

    it('should return true when score >= 70', () => {
      // 1 severe event at day 0: (5/7)*20 ≈ 14 — not enough
      // Need enough events to reach 70
      // 7 severe events at day 0: (35/7)*20 = 100 => >= 70
      const events = [
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
      ]
      setEvents('pet-001', events)
      expect(shouldShowCrisisReferral('pet-001')).toBe(true)
    })

    it('should return false when shown within cooldown period (24h)', () => {
      // Set events that push score >= 70
      const events = [
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
      ]
      setEvents('pet-001', events)
      // Record crisis shown just 1 hour ago
      setCrisisShown('pet-001', NOW - 3600000)

      expect(shouldShowCrisisReferral('pet-001')).toBe(false)
    })

    it('should return true when cooldown has expired', () => {
      const events = [
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
      ]
      setEvents('pet-001', events)
      // Record crisis shown 25 hours ago
      setCrisisShown('pet-001', NOW - 25 * 3600000)

      expect(shouldShowCrisisReferral('pet-001')).toBe(true)
    })
  })

  // ============================================================
  // recordCrisisReferralShown
  // ============================================================
  describe('recordCrisisReferralShown', () => {
    it('should store timestamp in storage', () => {
      recordCrisisReferralShown('pet-001')

      const raw = mockStorage['crisis_shown_pet-001']
      expect(raw).toBeDefined()
      expect(Number(raw)).toBe(NOW)
    })
  })

  // ============================================================
  // getEmotionTrend
  // ============================================================
  describe('getEmotionTrend', () => {
    it('should return stable when less than 2 events', () => {
      setEvents('pet-001', [makeEvent(1, 'mild')])
      expect(getEmotionTrend('pet-001')).toBe('stable')
    })

    it('should return worsening when recent avg > older avg * 1.2', () => {
      // Recent: 1 severe event (day 1) => avg = 5
      // Older: 1 mild event (day 5) => avg = 1
      // ratio = 5/1 = 5 > 1.2 => worsening
      setEvents('pet-001', [
        makeEvent(1, 'severe'),  // recent
        makeEvent(5, 'mild'),    // older
      ])
      expect(getEmotionTrend('pet-001')).toBe('worsening')
    })

    it('should return improving when recent avg < older avg * 0.8', () => {
      // Recent: 1 mild event (day 1) => avg = 1
      // Older: 1 severe event (day 5) => avg = 5
      // ratio = 1/5 = 0.2 < 0.8 => improving
      setEvents('pet-001', [
        makeEvent(1, 'mild'),    // recent
        makeEvent(5, 'severe'),  // older
      ])
      expect(getEmotionTrend('pet-001')).toBe('improving')
    })

    it('should return stable when ratio is between 0.8 and 1.2', () => {
      // Recent: 1 moderate event (day 1) => avg = 3
      // Older: 1 moderate event (day 5) => avg = 3
      // ratio = 3/3 = 1.0 => stable
      setEvents('pet-001', [
        makeEvent(1, 'moderate'),
        makeEvent(5, 'moderate'),
      ])
      expect(getEmotionTrend('pet-001')).toBe('stable')
    })

    it('should return worsening when older events are 0 but recent > 0', () => {
      setEvents('pet-001', [
        makeEvent(1, 'mild'),
        makeEvent(2, 'mild'),
      ])
      expect(getEmotionTrend('pet-001')).toBe('worsening')
    })
  })

  // ============================================================
  // getCrisisSeverity
  // ============================================================
  describe('getCrisisSeverity', () => {
    it('should return severe when score >= 90', () => {
      // Need score >= 90: (weightedSum/7)*20 >= 90 => weightedSum >= 31.5
      // 7 severe events at day 0: 35 => score = 100 => severe
      const events = [
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
      ]
      setEvents('pet-001', events)
      expect(getCrisisSeverity('pet-001')).toBe('severe')
    })

    it('should return moderate when score between 70 and 89', () => {
      // 5 severe events at day 0: weightedSum = 25, score = (25/7)*20 ≈ 71.4
      const events = [
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
        makeEvent(0, 'severe'),
      ]
      setEvents('pet-001', events)
      expect(getCrisisSeverity('pet-001')).toBe('moderate')
    })
  })

  // ============================================================
  // recordFollowUp
  // ============================================================
  describe('recordFollowUp', () => {
    it('should add mild event for okay action', () => {
      recordFollowUp('pet-001', 'okay')

      const parsed = JSON.parse(mockStorage['emotion_track_pet-001'])
      expect(parsed).toHaveLength(1)
      expect(parsed[0].severity).toBe('mild')
      expect(parsed[0].eventType).toBe('anomaly_detected')
    })

    it('should add mild event for contacted action', () => {
      recordFollowUp('pet-001', 'contacted')

      const parsed = JSON.parse(mockStorage['emotion_track_pet-001'])
      expect(parsed).toHaveLength(1)
      expect(parsed[0].severity).toBe('mild')
      expect(parsed[0].eventType).toBe('anxiety_detected')
    })
  })
})