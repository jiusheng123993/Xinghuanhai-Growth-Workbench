/**
 * 成就服务测试
 *
 * 覆盖生日/连续打卡/疫苗/彩虹桥/节日成就检测逻辑
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  checkBirthdayAchievement,
  checkStreakAchievement,
  checkVaccineCompleteAchievement,
  checkRainbowBridgeAchievement,
  checkHolidayAchievement,
  checkAllAchievements,
} from '../achievementService'

const mockStorage: Record<string, string> = {}

vi.mock('../../utils/storage', () => ({
  getStorageArray: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return []
    try { return JSON.parse(raw) } catch { return [] }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = JSON.stringify(value)
  }),
}))

vi.mock('../../components/AchievementCard', () => ({
  ACHIEVEMENT_DEFS: {
    birthday: { type: 'birthday', title: '生日快乐', icon: '🎂' },
    streak_7: { type: 'streak_7', title: '连续7天', icon: '🔥' },
    streak_30: { type: 'streak_30', title: '连续30天', icon: '🔥' },
    streak_100: { type: 'streak_100', title: '连续100天', icon: '💯' },
    vaccine_complete: { type: 'vaccine_complete', title: '疫苗完成', icon: '💉' },
    rainbow_bridge: { type: 'rainbow_bridge', title: '彩虹桥', icon: '🌈' },
    holiday: { type: 'holiday', title: '节日快乐', icon: '🎊' },
  },
}))

const PET_ID = 'pet-001'

describe('achievementService', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key])
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ============================================================
  // checkBirthdayAchievement
  // ============================================================
  describe('checkBirthdayAchievement', () => {
    it('returns null when birthDate is undefined', () => {
      const result = checkBirthdayAchievement(undefined, PET_ID)
      expect(result).toBeNull()
    })

    it('returns null when today is not birthday', () => {
      vi.setSystemTime(new Date('2024-03-15T10:00:00'))
      const result = checkBirthdayAchievement('2023-06-15', PET_ID)
      expect(result).toBeNull()
    })

    it('returns achievement config when today IS birthday (same month and day)', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      const result = checkBirthdayAchievement('2023-06-15', PET_ID)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('birthday')
      expect(result!.title).toBe('生日快乐')
    })

    it('stores shown record after returning achievement', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      checkBirthdayAchievement('2023-06-15', PET_ID)

      const raw = mockStorage['achievements_shown']
      expect(raw).toBeDefined()
      const records = JSON.parse(raw!)
      expect(records).toHaveLength(1)
      expect(records[0].type).toBe('birthday')
      expect(records[0].petId).toBe(PET_ID)
    })

    it('returns null on second call same day (already shown today)', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))

      const first = checkBirthdayAchievement('2023-06-15', PET_ID)
      expect(first).not.toBeNull()

      const second = checkBirthdayAchievement('2023-06-15', PET_ID)
      expect(second).toBeNull()
    })
  })

  // ============================================================
  // checkStreakAchievement
  // ============================================================
  describe('checkStreakAchievement', () => {
    it('returns null for streakDays not equal to 7, 30, or 100', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      expect(checkStreakAchievement(0, PET_ID)).toBeNull()
      expect(checkStreakAchievement(5, PET_ID)).toBeNull()
      expect(checkStreakAchievement(8, PET_ID)).toBeNull()
      expect(checkStreakAchievement(29, PET_ID)).toBeNull()
      expect(checkStreakAchievement(31, PET_ID)).toBeNull()
      expect(checkStreakAchievement(99, PET_ID)).toBeNull()
      expect(checkStreakAchievement(101, PET_ID)).toBeNull()
    })

    it('returns achievement for streakDays === 7', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      const result = checkStreakAchievement(7, PET_ID)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('streak_7')
      expect(result!.title).toBe('连续7天')
    })

    it('returns achievement for streakDays === 30', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      const result = checkStreakAchievement(30, PET_ID)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('streak_30')
    })

    it('returns achievement for streakDays === 100', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      const result = checkStreakAchievement(100, PET_ID)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('streak_100')
    })

    it('returns null on second call same day', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))

      const first = checkStreakAchievement(7, PET_ID)
      expect(first).not.toBeNull()

      const second = checkStreakAchievement(7, PET_ID)
      expect(second).toBeNull()
    })
  })

  // ============================================================
  // checkVaccineCompleteAchievement
  // ============================================================
  describe('checkVaccineCompleteAchievement', () => {
    it('returns null when allCompleted is false', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      const result = checkVaccineCompleteAchievement(PET_ID, false)
      expect(result).toBeNull()
    })

    it('returns achievement when allCompleted is true', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      const result = checkVaccineCompleteAchievement(PET_ID, true)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('vaccine_complete')
      expect(result!.title).toBe('疫苗完成')
    })

    it('returns null on second call same day', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))

      const first = checkVaccineCompleteAchievement(PET_ID, true)
      expect(first).not.toBeNull()

      const second = checkVaccineCompleteAchievement(PET_ID, true)
      expect(second).toBeNull()
    })
  })

  // ============================================================
  // checkRainbowBridgeAchievement
  // ============================================================
  describe('checkRainbowBridgeAchievement', () => {
    it('returns null when isDeceased is false', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      const result = checkRainbowBridgeAchievement(PET_ID, false)
      expect(result).toBeNull()
    })

    it('returns achievement when isDeceased is true', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      const result = checkRainbowBridgeAchievement(PET_ID, true)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('rainbow_bridge')
      expect(result!.title).toBe('彩虹桥')
    })

    it('returns null on second call same day', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))

      const first = checkRainbowBridgeAchievement(PET_ID, true)
      expect(first).not.toBeNull()

      const second = checkRainbowBridgeAchievement(PET_ID, true)
      expect(second).toBeNull()
    })
  })

  // ============================================================
  // checkHolidayAchievement
  // ============================================================
  describe('checkHolidayAchievement', () => {
    it('returns null when today is not a holiday', () => {
      vi.setSystemTime(new Date('2024-03-15T10:00:00'))
      const result = checkHolidayAchievement(PET_ID)
      expect(result).toBeNull()
    })

    it('returns achievement when today is a holiday (national day: Oct 1)', () => {
      vi.setSystemTime(new Date('2024-10-01T10:00:00'))
      const result = checkHolidayAchievement(PET_ID)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('holiday')
      expect(result!.title).toBe('节日快乐')
    })

    it('returns null on second call same day', () => {
      vi.setSystemTime(new Date('2024-10-01T10:00:00'))

      const first = checkHolidayAchievement(PET_ID)
      expect(first).not.toBeNull()

      const second = checkHolidayAchievement(PET_ID)
      expect(second).toBeNull()
    })
  })

  // ============================================================
  // checkAllAchievements
  // ============================================================
  describe('checkAllAchievements', () => {
    const baseContext = {
      petId: PET_ID,
      streakDays: 5,
      isDeceased: false,
    }

    it('returns birthday achievement first if today is birthday', () => {
      vi.setSystemTime(new Date('2024-06-15T10:00:00'))
      const result = checkAllAchievements({
        ...baseContext,
        birthDate: '2023-06-15',
      })
      expect(result).not.toBeNull()
      expect(result!.type).toBe('birthday')
    })

    it('returns streak achievement if no birthday but streak matches', () => {
      vi.setSystemTime(new Date('2024-03-15T10:00:00'))
      const result = checkAllAchievements({
        ...baseContext,
        birthDate: '2023-06-15',
        streakDays: 7,
      })
      expect(result).not.toBeNull()
      expect(result!.type).toBe('streak_7')
    })

    it('returns rainbow bridge if streak does not match', () => {
      vi.setSystemTime(new Date('2024-03-15T10:00:00'))
      const result = checkAllAchievements({
        ...baseContext,
        streakDays: 5,
        isDeceased: true,
      })
      expect(result).not.toBeNull()
      expect(result!.type).toBe('rainbow_bridge')
    })

    it('returns vaccine complete if applicable (no higher priority match)', () => {
      vi.setSystemTime(new Date('2024-03-15T10:00:00'))
      const result = checkAllAchievements({
        ...baseContext,
        streakDays: 5,
        isDeceased: false,
        allVaccinesCompleted: true,
      })
      expect(result).not.toBeNull()
      expect(result!.type).toBe('vaccine_complete')
    })

    it('returns holiday achievement if it is a holiday (no higher priority match)', () => {
      vi.setSystemTime(new Date('2024-10-01T10:00:00'))
      const result = checkAllAchievements({
        ...baseContext,
        streakDays: 5,
        isDeceased: false,
        allVaccinesCompleted: false,
      })
      expect(result).not.toBeNull()
      expect(result!.type).toBe('holiday')
    })

    it('returns null when nothing matches', () => {
      vi.setSystemTime(new Date('2024-03-15T10:00:00'))
      const result = checkAllAchievements({
        ...baseContext,
        streakDays: 5,
        isDeceased: false,
        allVaccinesCompleted: false,
      })
      expect(result).toBeNull()
    })
  })
})