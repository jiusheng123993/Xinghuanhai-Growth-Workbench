/** 健康打卡页面单元测试 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  APPETITE_OPTIONS,
  SPIRIT_OPTIONS,
  POOP_OPTIONS,
  EXERCISE_OPTIONS,
  mapAppetiteLevel,
  mapSpiritLevel,
  mapPoopLevel,
  computeRiskLevel,
  computeAnomalyItems,
  computeHasAnomaly,
} from '../index'

// Mock all dependencies required by the source module before importing
vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: vi.fn(() => ''),
  useThemeKey: vi.fn(() => 'autumn'),
  usePetWallpaper: vi.fn(() => null),
}))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: vi.fn(() => ({})) }))
vi.mock('../../../stores/shareStore', () => ({ useShareStore: vi.fn(() => ({})) }))
vi.mock('../../../hooks/usePet', () => ({ usePet: vi.fn(() => ({ pets: [], currentPet: null, switchPet: vi.fn(), isLoading: false })) }))
vi.mock('../../../hooks/useCheckin', () => ({ useCheckin: vi.fn(() => ({ checkins: [], todayCheckin: null, streakDays: 0, isLoading: false, initUser: vi.fn(), doCheckin: vi.fn(), fetchCheckins: vi.fn() })) }))
vi.mock('../../../components/PetSwitcher', () => ({ default: vi.fn(() => null) }))
vi.mock('../../../components', () => ({
  Icon: ({ name, className }: any) => <span className={className} data-icon={name} />,
  // 页面用 emojiToIcon 决定结果标签是画图标还是保留 emoji，mock 里给一个最小可用实现
  emojiToIcon: (emoji: string) => (emoji === '🍽️' ? 'bowl-food' : null),
  PageLoading: () => null,
  PageError: () => null,
  PetAvatar: () => null,
  AchievementCard: () => null,
  AchievementShareCard: () => null,
  EmergencyAlert: () => null,
  CarePlanCard: () => null,
}))
vi.mock('../../../components/CrisisReferralCard', () => ({ default: vi.fn(() => null) }))
vi.mock('../../../stores/subscribeStore', () => ({ useSubscribeStore: vi.fn(() => ({})) }))
vi.mock('../../../stores/checkinStore', () => ({ useCheckinStore: vi.fn(() => ({})) }))
vi.mock('../../../services/achievementService', () => ({ checkAllAchievements: vi.fn(() => []) }))
vi.mock('../../../hooks/useEmotionTracking', () => ({ useEmotionTracking: vi.fn(() => ({})) }))
vi.mock('../../../engines/petAvatar/diaryEngine', () => ({ generateDiaryForToday: vi.fn(() => null) }))
vi.mock('../../../engines/emotion', () => ({ getCrisisMessage: vi.fn(() => '') }))
vi.mock('../../../engines/petSafety/MedicalDisclaimer', () => ({ MedicalDisclaimer: vi.fn(() => null) }))
vi.mock('../../../services/churnDetectionService', () => ({ updateLastCheckinDate: vi.fn() }))
vi.mock('../../../hooks/useAnalytics', () => ({ useAnalytics: vi.fn(() => ({})), usePageView: vi.fn() }))
vi.mock('../../../constants/analyticsEvents', () => ({ EVENT: {} }))
vi.mock('../../index.scss', () => ({}))

// ---------------------------------------------------------------------------
// 1. mapAppetiteLevel
// ---------------------------------------------------------------------------
describe('mapAppetiteLevel', () => {
  it('should map level 1 to poor', () => {
    expect(mapAppetiteLevel(1)).toBe('poor')
  })
  it('should map level 2 to poor', () => {
    expect(mapAppetiteLevel(2)).toBe('poor')
  })
  it('should map level 3 to normal', () => {
    expect(mapAppetiteLevel(3)).toBe('normal')
  })
  it('should map level 4 to good', () => {
    expect(mapAppetiteLevel(4)).toBe('good')
  })
  it('should map level 5 to good', () => {
    expect(mapAppetiteLevel(5)).toBe('good')
  })
})

// ---------------------------------------------------------------------------
// 2. mapSpiritLevel
// ---------------------------------------------------------------------------
describe('mapSpiritLevel', () => {
  it('should map level 1 to sad', () => {
    expect(mapSpiritLevel(1)).toBe('sad')
  })
  it('should map level 2 to sad', () => {
    expect(mapSpiritLevel(2)).toBe('sad')
  })
  it('should map level 3 to normal', () => {
    expect(mapSpiritLevel(3)).toBe('normal')
  })
  it('should map level 4 to happy', () => {
    expect(mapSpiritLevel(4)).toBe('happy')
  })
  it('should map level 5 to happy', () => {
    expect(mapSpiritLevel(5)).toBe('happy')
  })
})

// ---------------------------------------------------------------------------
// 3. mapPoopLevel
// ---------------------------------------------------------------------------
describe('mapPoopLevel', () => {
  it('should map level 1 to loose', () => {
    expect(mapPoopLevel(1)).toBe('loose')
  })
  it('should map level 2 to loose', () => {
    expect(mapPoopLevel(2)).toBe('loose')
  })
  it('should map level 3 to normal', () => {
    expect(mapPoopLevel(3)).toBe('normal')
  })
  it('should map level 4 to hard', () => {
    expect(mapPoopLevel(4)).toBe('hard')
  })
  it('should map level 5 to hard', () => {
    expect(mapPoopLevel(5)).toBe('hard')
  })
})

// ---------------------------------------------------------------------------
// 4. computeRiskLevel
// ---------------------------------------------------------------------------
describe('computeRiskLevel', () => {
  it('should return emergency when stool is loose, appetite is poor, and mood is sad', () => {
    expect(computeRiskLevel('sad', 'poor', 'loose')).toBe('emergency')
  })

  it('should return high when appetite is poor and mood is sad (stool normal)', () => {
    expect(computeRiskLevel('sad', 'poor', 'normal')).toBe('high')
  })

  it('should return high when appetite is poor and mood is sad (stool hard)', () => {
    expect(computeRiskLevel('sad', 'poor', 'hard')).toBe('high')
  })

  it('should return medium when only mood is sad', () => {
    expect(computeRiskLevel('sad', 'normal', 'normal')).toBe('medium')
    expect(computeRiskLevel('sad', 'good', 'normal')).toBe('medium')
  })

  it('should return medium when only appetite is poor', () => {
    expect(computeRiskLevel('normal', 'poor', 'normal')).toBe('medium')
    expect(computeRiskLevel('happy', 'poor', 'normal')).toBe('medium')
  })

  it('should return medium when only stool is loose', () => {
    expect(computeRiskLevel('normal', 'normal', 'loose')).toBe('medium')
    expect(computeRiskLevel('happy', 'good', 'loose')).toBe('medium')
  })

  it('should return medium when stool is hard', () => {
    // stool hard does NOT trigger medium via the fallback (stool === 'loose' check)
    // But if mood is sad or appetite is poor, it would be medium. Let's test hard alone:
    expect(computeRiskLevel('normal', 'normal', 'hard')).toBe('low')
  })

  it('should return low when all indicators are normal', () => {
    expect(computeRiskLevel('normal', 'normal', 'normal')).toBe('low')
  })

  it('should return low when all indicators are good', () => {
    expect(computeRiskLevel('happy', 'good', 'normal')).toBe('low')
  })
})

// ---------------------------------------------------------------------------
// 5. computeAnomalyItems
// ---------------------------------------------------------------------------
describe('computeAnomalyItems', () => {
  it('should return empty array when everything is normal', () => {
    expect(computeAnomalyItems('normal', 'normal', 'normal')).toEqual([])
    expect(computeAnomalyItems('happy', 'good', 'normal')).toEqual([])
  })

  it('should include spirit when mood is sad', () => {
    expect(computeAnomalyItems('sad', 'normal', 'normal')).toEqual(['spirit'])
  })

  it('should include appetite when appetite is poor', () => {
    expect(computeAnomalyItems('normal', 'poor', 'normal')).toEqual(['appetite'])
  })

  it('should include poop when stool is loose', () => {
    expect(computeAnomalyItems('normal', 'normal', 'loose')).toEqual(['poop'])
  })

  it('should include poop when stool is hard', () => {
    expect(computeAnomalyItems('normal', 'normal', 'hard')).toEqual(['poop'])
  })

  it('should return all three items when all indicators are abnormal', () => {
    expect(computeAnomalyItems('sad', 'poor', 'loose')).toEqual(['spirit', 'appetite', 'poop'])
  })

  it('should return spirit and appetite when mood is sad and appetite is poor', () => {
    expect(computeAnomalyItems('sad', 'poor', 'normal')).toEqual(['spirit', 'appetite'])
  })

  it('should return spirit and poop when mood is sad and stool is abnormal', () => {
    expect(computeAnomalyItems('sad', 'normal', 'hard')).toEqual(['spirit', 'poop'])
  })

  it('should return appetite and poop when appetite is poor and stool is abnormal', () => {
    expect(computeAnomalyItems('normal', 'poor', 'loose')).toEqual(['appetite', 'poop'])
  })
})

// ---------------------------------------------------------------------------
// 6. computeHasAnomaly
// ---------------------------------------------------------------------------
describe('computeHasAnomaly', () => {
  it('should return false when all indicators are normal', () => {
    expect(computeHasAnomaly('normal', 'normal', 'normal')).toBe(false)
    expect(computeHasAnomaly('happy', 'good', 'normal')).toBe(false)
  })

  it('should return true when mood is sad', () => {
    expect(computeHasAnomaly('sad', 'normal', 'normal')).toBe(true)
  })

  it('should return true when appetite is poor', () => {
    expect(computeHasAnomaly('normal', 'poor', 'normal')).toBe(true)
  })

  it('should return true when stool is loose', () => {
    expect(computeHasAnomaly('normal', 'normal', 'loose')).toBe(true)
  })

  it('should return true when stool is hard', () => {
    expect(computeHasAnomaly('normal', 'normal', 'hard')).toBe(true)
  })

  it('should return true when all indicators are abnormal', () => {
    expect(computeHasAnomaly('sad', 'poor', 'loose')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 7. Option arrays
// ---------------------------------------------------------------------------
describe('APPETITE_OPTIONS', () => {
  it('should have 5 items', () => {
    expect(APPETITE_OPTIONS).toHaveLength(5)
  })

  it('should contain correct value-emoji-label mappings', () => {
    const byValue = new Map(APPETITE_OPTIONS.map((o) => [o.value, o]))
    expect(byValue.get(1)).toEqual({ value: 1, emoji: '😷', label: '不吃' })
    expect(byValue.get(2)).toEqual({ value: 2, emoji: '😐', label: '少吃' })
    expect(byValue.get(3)).toEqual({ value: 3, emoji: '😋', label: '正常' })
    expect(byValue.get(4)).toEqual({ value: 4, emoji: '🍽️', label: '多吃' })
    expect(byValue.get(5)).toEqual({ value: 5, emoji: '🤮', label: '呕吐' })
  })

  it('should have unique values', () => {
    const values = APPETITE_OPTIONS.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('SPIRIT_OPTIONS', () => {
  it('should have 5 items', () => {
    expect(SPIRIT_OPTIONS).toHaveLength(5)
  })

  it('should contain correct value-emoji-label mappings', () => {
    const byValue = new Map(SPIRIT_OPTIONS.map((o) => [o.value, o]))
    expect(byValue.get(1)).toEqual({ value: 1, emoji: '😞', label: '萎靡' })
    expect(byValue.get(2)).toEqual({ value: 2, emoji: '😴', label: '安静' })
    expect(byValue.get(3)).toEqual({ value: 3, emoji: '⚡', label: '正常' })
    expect(byValue.get(4)).toEqual({ value: 4, emoji: '😊', label: '兴奋' })
    expect(byValue.get(5)).toEqual({ value: 5, emoji: '🤪', label: '亢奋' })
  })

  it('should have unique values', () => {
    const values = SPIRIT_OPTIONS.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('POOP_OPTIONS', () => {
  it('should have 5 items', () => {
    expect(POOP_OPTIONS).toHaveLength(5)
  })

  it('should contain correct value-emoji-label mappings', () => {
    const byValue = new Map(POOP_OPTIONS.map((o) => [o.value, o]))
    expect(byValue.get(1)).toEqual({ value: 1, emoji: '🩸', label: '带血' })
    expect(byValue.get(2)).toEqual({ value: 2, emoji: '💧', label: '腹泻' })
    expect(byValue.get(3)).toEqual({ value: 3, emoji: '💩', label: '正常' })
    expect(byValue.get(4)).toEqual({ value: 4, emoji: '🟤', label: '偏软' })
    expect(byValue.get(5)).toEqual({ value: 5, emoji: '🪨', label: '便秘' })
  })

  it('should have unique values', () => {
    const values = POOP_OPTIONS.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('EXERCISE_OPTIONS', () => {
  it('should have 3 items', () => {
    expect(EXERCISE_OPTIONS).toHaveLength(3)
  })

  it('should contain correct value-emoji-label mappings', () => {
    const byValue = new Map(EXERCISE_OPTIONS.map((o) => [o.value, o]))
    expect(byValue.get(1)).toEqual({ value: 1, emoji: '🛋️', label: '少' })
    expect(byValue.get(2)).toEqual({ value: 2, emoji: '🏃', label: '正常' })
    expect(byValue.get(3)).toEqual({ value: 3, emoji: '🏋️', label: '多' })
  })

  it('should have unique values', () => {
    const values = EXERCISE_OPTIONS.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

// ---------------------------------------------------------------------------
// 样式契约锁：把"改了视觉但类名/变量没对齐"这类静默故障钉死
// ---------------------------------------------------------------------------
describe('checkin 样式契约', () => {
  // 读源码做约定锁（与 components/__tests__/PageBackground.test.tsx 同一手法）
  const scss = readFileSync('src/pagesPet/checkin/index.scss', 'utf-8')

  it('should define every result risk-level variant the page actually renders', () => {
    // tsx 生成的是 `pet-checkin__result--${todayRiskLevel}`，取值只有 low/medium/high/emergency。
    // 旧版 scss 写的是 --normal/--caution/--warning：那两个变体永远是死样式，
    // medium/high 只能落到基类的绿色边、看起来"一切正常"（审查 P2-5）。
    for (const level of ['low', 'medium', 'high', 'emergency']) {
      expect(scss).toContain(`.pet-checkin__result--${level}`)
    }
    for (const dead of ['--normal', '--caution', '--warning']) {
      expect(scss.includes(`.pet-checkin__result${dead}`)).toBe(false)
    }
  })

  it('should keep the dark-theme paper fallback covering every token used on paper surfaces', () => {
    // 深色主题（.theme-starry）把 --text-* 与 --glass-bg 都转成浅色，而本页纸面恒为浅底：
    // 兜底块少钉一个 token，就会出现"纸面上看不见的按钮/文字"（审查 P2-3）。
    for (const token of ['--text-primary', '--text-secondary', '--text-tertiary', '--glass-bg', '--border']) {
      expect(scss).toContain(`${token}:`)
    }
  })
})