/**
 * 频次控制服务测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  getFrequencyRule,
  setFrequencyRule,
  recordSend,
  checkFrequency,
  getSendStats,
  setDoNotDisturb,
  getDoNotDisturbSetting,
  clearSendHistory,
  resetToDefaultRules,
} from '../frequencyControlService'

const mockStorage: Record<string, string> = {}

vi.mock('../../utils/storage', () => ({
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
}))

vi.mock('../../constants/templateIds', () => ({
  FOLLOWUP_TEMPLATE_ID: 'tmpl_followup',
  CARE_PLAN_REMINDER_TEMPLATE_ID: 'tmpl_care_plan',
  HEALTH_CHECKIN_TEMPLATE_ID: 'tmpl_health_checkin',
}))

const FOLLOWUP = 'tmpl_followup'
const CARE_PLAN = 'tmpl_care_plan'
const HEALTH_CHECKIN = 'tmpl_health_checkin'

describe('frequencyControlService', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T10:00:00'))
    resetToDefaultRules()
    setDoNotDisturb({
      enabled: false,
      startHour: 22,
      startMinute: 0,
      endHour: 8,
      endMinute: 0,
      timezone: 'Asia/Shanghai',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ============================================================
  // getFrequencyRule
  // ============================================================
  describe('getFrequencyRule', () => {
    it('should return default FOLLOWUP rule when no user rules set', () => {
      const rule = getFrequencyRule(FOLLOWUP)
      expect(rule.templateId).toBe(FOLLOWUP)
      expect(rule.minInterval).toBe(60)
      expect(rule.dailyLimit).toBe(3)
      expect(rule.weeklyLimit).toBe(7)
      expect(rule.monthlyLimit).toBe(20)
      expect(rule.enabled).toBe(true)
    })

    it('should return default CARE_PLAN rule when no user rules set', () => {
      const rule = getFrequencyRule(CARE_PLAN)
      expect(rule.templateId).toBe(CARE_PLAN)
      expect(rule.minInterval).toBe(30)
      expect(rule.dailyLimit).toBe(5)
      expect(rule.weeklyLimit).toBe(15)
      expect(rule.monthlyLimit).toBe(50)
      expect(rule.enabled).toBe(true)
    })

    it('should return default HEALTH_CHECKIN rule when no user rules set', () => {
      const rule = getFrequencyRule(HEALTH_CHECKIN)
      expect(rule.templateId).toBe(HEALTH_CHECKIN)
      expect(rule.minInterval).toBe(120)
      expect(rule.dailyLimit).toBe(2)
      expect(rule.weeklyLimit).toBe(7)
      expect(rule.monthlyLimit).toBe(30)
      expect(rule.enabled).toBe(true)
    })

    it('should return user rule when custom rule is set', () => {
      setFrequencyRule(FOLLOWUP, { dailyLimit: 10, minInterval: 15 })
      const rule = getFrequencyRule(FOLLOWUP)
      expect(rule.dailyLimit).toBe(10)
      expect(rule.minInterval).toBe(15)
      expect(rule.templateId).toBe(FOLLOWUP)
    })

    it('should return default rule (first default) for unknown templateId', () => {
      const rule = getFrequencyRule('unknown_template')
      expect(rule.templateId).toBe(FOLLOWUP)
      expect(rule.minInterval).toBe(60)
      expect(rule.dailyLimit).toBe(3)
    })
  })

  // ============================================================
  // setFrequencyRule
  // ============================================================
  describe('setFrequencyRule', () => {
    it('should set custom rule for a template', () => {
      setFrequencyRule(FOLLOWUP, { dailyLimit: 5, minInterval: 10, weeklyLimit: 20, monthlyLimit: 100, enabled: false })
      const rule = getFrequencyRule(FOLLOWUP)
      expect(rule.dailyLimit).toBe(5)
      expect(rule.minInterval).toBe(10)
      expect(rule.weeklyLimit).toBe(20)
      expect(rule.monthlyLimit).toBe(100)
      expect(rule.enabled).toBe(false)
      expect(rule.templateId).toBe(FOLLOWUP)
    })

    it('should merge with existing user rule (partial update)', () => {
      setFrequencyRule(FOLLOWUP, { dailyLimit: 8 })
      setFrequencyRule(FOLLOWUP, { weeklyLimit: 25 })

      const rule = getFrequencyRule(FOLLOWUP)
      expect(rule.dailyLimit).toBe(8)
      expect(rule.weeklyLimit).toBe(25)
      expect(rule.minInterval).toBe(60)
      expect(rule.monthlyLimit).toBe(20)
      expect(rule.enabled).toBe(true)
      expect(rule.templateId).toBe(FOLLOWUP)
    })

    it('should merge with default rule when no user rule exists yet', () => {
      setFrequencyRule(CARE_PLAN, { dailyLimit: 99 })
      const rule = getFrequencyRule(CARE_PLAN)
      expect(rule.dailyLimit).toBe(99)
      expect(rule.minInterval).toBe(30)
      expect(rule.weeklyLimit).toBe(15)
      expect(rule.monthlyLimit).toBe(50)
      expect(rule.enabled).toBe(true)
    })
  })

  // ============================================================
  // recordSend
  // ============================================================
  describe('recordSend', () => {
    it('should add send record to history', () => {
      recordSend(FOLLOWUP, true)
      const stats = getSendStats(FOLLOWUP)
      expect(stats.total).toBe(1)
      expect(stats.today).toBe(1)
    })

    it('should add multiple send records', () => {
      recordSend(FOLLOWUP, true)
      recordSend(FOLLOWUP, false)
      recordSend(CARE_PLAN, true)
      const stats = getSendStats()
      expect(stats.total).toBe(3)
    })

    it('should filter out records older than 90 days', () => {
      recordSend(FOLLOWUP, true)

      vi.advanceTimersByTime(91 * 24 * 60 * 60 * 1000)

      recordSend(FOLLOWUP, true)
      const stats = getSendStats(FOLLOWUP)
      expect(stats.total).toBe(1)
    })

    it('should keep records within 90 days', () => {
      recordSend(FOLLOWUP, true)

      vi.advanceTimersByTime(89 * 24 * 60 * 60 * 1000)

      recordSend(FOLLOWUP, true)
      const stats = getSendStats(FOLLOWUP)
      expect(stats.total).toBe(2)
    })
  })

  // ============================================================
  // checkFrequency
  // ============================================================
  describe('checkFrequency', () => {
    it('should return allowed=true when no limits exceeded', () => {
      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(true)
      expect(result.remainingToday).toBeGreaterThan(0)
      expect(result.remainingThisWeek).toBeGreaterThan(0)
    })

    it('should return remainingToday and remainingThisWeek when allowed', () => {
      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(true)
      expect(result.remainingToday).toBe(2)
      expect(result.remainingThisWeek).toBe(6)
    })

    it('should return allowed=false during do-not-disturb period', () => {
      vi.setSystemTime(new Date('2026-07-20T23:00:00'))
      setDoNotDisturb({ enabled: true, startHour: 22, startMinute: 0, endHour: 8, endMinute: 0 })

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('免打扰')
      expect(result.nextAllowedAt).toBeDefined()
    })

    it('should return allowed=false when rule is disabled', () => {
      setFrequencyRule(FOLLOWUP, { enabled: false })

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('禁用')
    })

    it('should return allowed=false when minInterval not met', () => {
      recordSend(FOLLOWUP, true)

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('频繁')
      expect(result.reason).toContain('60')
      expect(result.nextAllowedAt).toBeDefined()
    })

    it('should allow send after minInterval passes', () => {
      recordSend(FOLLOWUP, true)

      vi.advanceTimersByTime(61 * 60 * 1000)

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(true)
    })

    it('should return allowed=false when daily limit reached', () => {
      const rule = getFrequencyRule(FOLLOWUP)
      for (let i = 0; i < rule.dailyLimit; i++) {
        recordSend(FOLLOWUP, true)
        vi.advanceTimersByTime(61 * 60 * 1000)
      }

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('今日')
      expect(result.reason).toContain(String(rule.dailyLimit))
      expect(result.remainingToday).toBe(0)
      expect(result.nextAllowedAt).toBeDefined()
    })

    it('should return allowed=false when weekly limit reached', () => {
      setFrequencyRule(FOLLOWUP, { dailyLimit: 100 })
      const rule = getFrequencyRule(FOLLOWUP)
      for (let i = 0; i < rule.weeklyLimit; i++) {
        recordSend(FOLLOWUP, true)
        vi.advanceTimersByTime(61 * 60 * 1000)
      }
      vi.advanceTimersByTime(61 * 60 * 1000)

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('本周')
      expect(result.reason).toContain(String(rule.weeklyLimit))
      expect(result.remainingThisWeek).toBe(0)
      expect(result.nextAllowedAt).toBeDefined()
    })

    it('should return allowed=false when global daily limit reached', () => {
      setFrequencyRule(FOLLOWUP, { dailyLimit: 100 })
      setFrequencyRule(CARE_PLAN, { dailyLimit: 100 })
      setFrequencyRule(HEALTH_CHECKIN, { dailyLimit: 100 })
      for (let i = 0; i < 10; i++) {
        const tmpl = [FOLLOWUP, CARE_PLAN, HEALTH_CHECKIN][i % 3]
        recordSend(tmpl, true)
        vi.advanceTimersByTime(2 * 60 * 1000)
      }
      vi.advanceTimersByTime(61 * 60 * 1000)

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('总消息数')
      expect(result.reason).toContain('10')
      expect(result.nextAllowedAt).toBeDefined()
    })

    it('should return allowed=false when global weekly limit reached', () => {
      setFrequencyRule(FOLLOWUP, { dailyLimit: 100, weeklyLimit: 100 })
      setFrequencyRule(CARE_PLAN, { dailyLimit: 100, weeklyLimit: 100 })
      setFrequencyRule(HEALTH_CHECKIN, { dailyLimit: 100, weeklyLimit: 100 })

      for (let day = 0; day < 6; day++) {
        for (let i = 0; i < 5; i++) {
          const tmpl = [FOLLOWUP, CARE_PLAN, HEALTH_CHECKIN][i % 3]
          recordSend(tmpl, true)
          vi.advanceTimersByTime(2 * 60 * 1000)
        }
        vi.advanceTimersByTime(24 * 60 * 60 * 1000)
      }
      vi.advanceTimersByTime(61 * 60 * 1000)

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('总消息数')
      expect(result.reason).toContain('30')
      expect(result.nextAllowedAt).toBeDefined()
    })

    it('should not be in DND when doNotDisturb is disabled', () => {
      vi.setSystemTime(new Date('2026-07-20T23:00:00'))
      setDoNotDisturb({ enabled: false })

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(true)
    })

    it('should not be in DND when outside DND hours', () => {
      vi.setSystemTime(new Date('2026-07-20T10:00:00'))
      setDoNotDisturb({ enabled: true, startHour: 22, startMinute: 0, endHour: 8, endMinute: 0 })

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(true)
    })

    it('should handle cross-midnight DND (start > end)', () => {
      vi.setSystemTime(new Date('2026-07-20T02:00:00'))
      setDoNotDisturb({ enabled: true, startHour: 22, startMinute: 0, endHour: 8, endMinute: 0 })

      const result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('免打扰')
    })
  })

  // ============================================================
  // getSendStats
  // ============================================================
  describe('getSendStats', () => {
    it('should return correct stats for specific template', () => {
      recordSend(FOLLOWUP, true)
      vi.advanceTimersByTime(61 * 60 * 1000)
      recordSend(FOLLOWUP, true)

      const stats = getSendStats(FOLLOWUP)
      expect(stats.today).toBe(2)
      expect(stats.thisWeek).toBe(2)
      expect(stats.thisMonth).toBe(2)
      expect(stats.total).toBe(2)
    })

    it('should return correct stats for all templates', () => {
      recordSend(FOLLOWUP, true)
      vi.advanceTimersByTime(61 * 60 * 1000)
      recordSend(CARE_PLAN, true)
      vi.advanceTimersByTime(31 * 60 * 1000)
      recordSend(HEALTH_CHECKIN, true)

      const stats = getSendStats()
      expect(stats.today).toBe(3)
      expect(stats.thisWeek).toBe(3)
      expect(stats.thisMonth).toBe(3)
      expect(stats.total).toBe(3)
    })

    it('should return zeros when no history', () => {
      const stats = getSendStats()
      expect(stats.today).toBe(0)
      expect(stats.thisWeek).toBe(0)
      expect(stats.thisMonth).toBe(0)
      expect(stats.total).toBe(0)
    })

    it('should return zeros for template with no history', () => {
      recordSend(FOLLOWUP, true)
      const stats = getSendStats(CARE_PLAN)
      expect(stats.today).toBe(0)
      expect(stats.thisWeek).toBe(0)
      expect(stats.thisMonth).toBe(0)
      expect(stats.total).toBe(0)
    })
  })

  // ============================================================
  // setDoNotDisturb / getDoNotDisturbSetting
  // ============================================================
  describe('setDoNotDisturb / getDoNotDisturbSetting', () => {
    it('should return default settings initially', () => {
      const setting = getDoNotDisturbSetting()
      expect(setting.enabled).toBe(false)
      expect(setting.startHour).toBe(22)
      expect(setting.startMinute).toBe(0)
      expect(setting.endHour).toBe(8)
      expect(setting.endMinute).toBe(0)
    })

    it('should update do-not-disturb settings', () => {
      setDoNotDisturb({
        enabled: true,
        startHour: 21,
        startMinute: 30,
        endHour: 7,
        endMinute: 0,
        timezone: 'Asia/Shanghai',
      })

      const setting = getDoNotDisturbSetting()
      expect(setting.enabled).toBe(true)
      expect(setting.startHour).toBe(21)
      expect(setting.startMinute).toBe(30)
      expect(setting.endHour).toBe(7)
      expect(setting.endMinute).toBe(0)
      expect(setting.timezone).toBe('Asia/Shanghai')
    })

    it('should partially update do-not-disturb settings', () => {
      setDoNotDisturb({ enabled: true })
      setDoNotDisturb({ startHour: 23 })

      const setting = getDoNotDisturbSetting()
      expect(setting.enabled).toBe(true)
      expect(setting.startHour).toBe(23)
      expect(setting.startMinute).toBe(0)
      expect(setting.endHour).toBe(8)
    })

    it('should return updated settings after modification', () => {
      setDoNotDisturb({ enabled: true, startHour: 20, endHour: 6 })
      const setting = getDoNotDisturbSetting()
      expect(setting.enabled).toBe(true)
      expect(setting.startHour).toBe(20)
      expect(setting.endHour).toBe(6)
    })
  })

  // ============================================================
  // clearSendHistory
  // ============================================================
  describe('clearSendHistory', () => {
    it('should clear all send history', () => {
      recordSend(FOLLOWUP, true)
      recordSend(CARE_PLAN, true)
      recordSend(HEALTH_CHECKIN, true)

      expect(getSendStats().total).toBe(3)

      clearSendHistory()

      const stats = getSendStats()
      expect(stats.today).toBe(0)
      expect(stats.thisWeek).toBe(0)
      expect(stats.thisMonth).toBe(0)
      expect(stats.total).toBe(0)
    })

    it('should not affect frequency rules', () => {
      setFrequencyRule(FOLLOWUP, { dailyLimit: 99 })
      recordSend(FOLLOWUP, true)

      clearSendHistory()

      const rule = getFrequencyRule(FOLLOWUP)
      expect(rule.dailyLimit).toBe(99)
    })
  })

  // ============================================================
  // resetToDefaultRules
  // ============================================================
  describe('resetToDefaultRules', () => {
    it('should clear user rules and history', () => {
      setFrequencyRule(FOLLOWUP, { dailyLimit: 99 })
      recordSend(FOLLOWUP, true)
      recordSend(CARE_PLAN, true)

      resetToDefaultRules()

      const rule = getFrequencyRule(FOLLOWUP)
      expect(rule.dailyLimit).toBe(3)

      const stats = getSendStats()
      expect(stats.total).toBe(0)
    })

    it('should restore default rules after reset', () => {
      setFrequencyRule(FOLLOWUP, { dailyLimit: 99, enabled: false })
      resetToDefaultRules()

      const rule = getFrequencyRule(FOLLOWUP)
      expect(rule.dailyLimit).toBe(3)
      expect(rule.enabled).toBe(true)
      expect(rule.minInterval).toBe(60)
    })

    it('should allow new sends after reset', () => {
      const rule = getFrequencyRule(FOLLOWUP)
      for (let i = 0; i < rule.dailyLimit; i++) {
        recordSend(FOLLOWUP, true)
        vi.advanceTimersByTime(61 * 60 * 1000)
      }

      let result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(false)

      resetToDefaultRules()

      result = checkFrequency(FOLLOWUP)
      expect(result.allowed).toBe(true)
    })
  })
})