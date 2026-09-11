import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  checkFrequency,
  recordSend,
  getFrequencyRule,
  setFrequencyRule,
  getSendStats,
  setDoNotDisturb,
  getDoNotDisturbSetting,
  clearSendHistory,
  resetToDefaultRules,
} from '../../services/frequencyControlService'

const memoryStore = new Map<string, unknown>()

const { mockGetStorage, mockSetStorage } = vi.hoisted(() => ({
  mockGetStorage: vi.fn(<T,>(key: string): T | null => {
    return (memoryStore.get(key) as T) ?? null
  }),
  mockSetStorage: vi.fn((key: string, value: unknown): void => {
    memoryStore.set(key, value)
  }),
}))

vi.mock('../../utils/storage', () => ({
  getStorage: mockGetStorage,
  setStorage: mockSetStorage,
}))

describe('frequencyControlService', () => {
  beforeEach(() => {
    memoryStore.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T10:00:00'))
    resetToDefaultRules()
    setDoNotDisturb({ enabled: false, startHour: 22, startMinute: 0, endHour: 8, endMinute: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow first send', () => {
    const result = checkFrequency('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    expect(result.allowed).toBe(true)
    expect(result.remainingToday).toBeGreaterThan(0)
  })

  it('should block send within min interval', () => {
    recordSend('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER', true)
    const result = checkFrequency('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('频繁')
  })

  it('should allow send after min interval', () => {
    recordSend('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER', true)
    vi.advanceTimersByTime(61 * 60 * 1000)
    const result = checkFrequency('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    expect(result.allowed).toBe(true)
  })

  it('should block when daily limit reached', () => {
    const rule = getFrequencyRule('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    for (let i = 0; i < rule.dailyLimit; i++) {
      recordSend('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER', true)
      vi.advanceTimersByTime(61 * 60 * 1000)
    }
    const result = checkFrequency('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('今日')
  })

  it('should block during do not disturb', () => {
    setDoNotDisturb({ enabled: true, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59 })
    const result = checkFrequency('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('免打扰')
  })

  it('should get correct send stats', () => {
    recordSend('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER', true)
    vi.advanceTimersByTime(61 * 60 * 1000)
    recordSend('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER', true)
    const stats = getSendStats('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    expect(stats.today).toBe(2)
    expect(stats.total).toBe(2)
  })

  it('should update frequency rule', () => {
    setFrequencyRule('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER', { dailyLimit: 5 })
    const rule = getFrequencyRule('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    expect(rule.dailyLimit).toBe(5)
  })

  it('should respect disabled rule', () => {
    setFrequencyRule('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER', { enabled: false })
    const result = checkFrequency('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('禁用')
  })
})
