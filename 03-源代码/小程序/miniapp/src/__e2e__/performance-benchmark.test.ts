/**
 * 性能基准测试
 *
 * 测量关键操作的执行时间，验证是否满足性能阈值。
 * 测试类别：
 * 1. 纯函数性能（< 5ms）
 * 2. 存储操作性能（< 10ms）
 * 3. 批量操作性能（< 50ms）
 */
/**
 * E2E 测试：性能基准
 * 验证应用性能基准，包含启动时间、API 响应和渲染性能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// 导入真实模块
// ============================================================
import { buildFeedingProfile, generatePersonalizedAdvice, getMealPlan } from '../services/feedingService'
import { getEmotionScore, getEmotionTrend, trackEmotionEvent } from '../services/emotionTrackingService'
import { checkAllAchievements } from '../services/achievementService'
import { checkFrequency, resetToDefaultRules } from '../services/frequencyControlService'
import { formatMomentTime, getMomentTypeInfo } from '../services/momentService'
import { generateChronicReminderPayload } from '../services/chronicService'
import { generateWeeklyReport, getMoodEmoji, getMoodLabel } from '../services/weeklyReportService'
import { checkInput, sanitizeOutput } from '../utils/ruleGuard'
import { calculateConsecutiveAnomalyDays } from '../services/checkinService'
import { generateDiaryFromEntries } from '../services/diaryService'
import { getStorage, setStorage } from '../utils/storage'
import type { PetProfile } from '../services/petService'
import type { ChronicRecord } from '../types/chronicTypes'
import type { PetMoment } from '../types/familyTypes'
import type { PetHealthEntry } from '../memory-body/types/memoryBodyTypes'

// ============================================================
// Mock 层：共享的 mock storage
// ============================================================
const mockStorage: Record<string, string> = {}

vi.mock('../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = JSON.stringify(value)
  }),
  getStorageArray: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return []
    try { return JSON.parse(raw) } catch { return [] }
  }),
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[key]
  }),
}))

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn((key: string) => {
      const raw = mockStorage[key]
      if (!raw) return ''
      return raw
    }),
    setStorageSync: vi.fn((key: string, value: string) => {
      mockStorage[key] = value
    }),
    removeStorageSync: vi.fn((key: string) => {
      delete mockStorage[key]
    }),
    navigateTo: vi.fn(),
    request: vi.fn(),
  },
}))

vi.mock('../config', () => ({
  CONFIG: {
    STORAGE_KEYS: { TOKEN: 'xhh_token', REFRESH_TOKEN: 'xhh_refresh_token', USER: 'xhh_user' },
    API_BASE_URL: 'https://api.test.com',
    USE_MOCK: false,
  },
}))

vi.mock('../constants/templateIds', () => ({
  FOLLOWUP_TEMPLATE_ID: 'tmpl_followup',
  CARE_PLAN_REMINDER_TEMPLATE_ID: 'tmpl_care_plan',
  HEALTH_CHECKIN_TEMPLATE_ID: 'tmpl_health_checkin',
}))

vi.mock('../components/AchievementCard', () => ({
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

vi.mock('../services/syncService', () => ({
  getSyncService: vi.fn(() => ({
    queueForSync: vi.fn(),
  })),
}))

vi.mock('../services/syncHelper', () => ({
  queueSync: vi.fn(),
}))

vi.mock('../utils/petOwnership', () => ({
  requirePetOwnership: vi.fn(),
}))

vi.mock('../engines/petAvatar/diaryEngine', () => ({
  generateDiaryEntry: vi.fn((_entry: unknown, _streak: number, _isBirthday: boolean, _isRecovery: boolean) => ({
    text: '今天一切正常~',
    tone: 'happy',
    emoji: '😊',
  })),
}))

// ============================================================
// 测试辅助函数
// ============================================================

function measureTime(fn: () => void, iterations: number = 100): number {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    fn()
  }
  return (performance.now() - start) / iterations
}

async function measureTimeAsync(fn: () => Promise<void>, iterations: number = 100): Promise<number> {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    await fn()
  }
  return (performance.now() - start) / iterations
}

function makePetProfile(overrides: Partial<PetProfile> = {}): PetProfile {
  return {
    id: 'pet-001',
    userId: 'user-001',
    name: '旺财',
    species: 'dog',
    breed: '金毛',
    breedId: 'golden_retriever',
    gender: 'male',
    birthDate: '2023-06-15',
    weight: 25,
    coatColor: '金色',
    photos: [],
    isNeutered: true,
    microchipId: '',
    notes: '',
    isDeceased: false,
    allergies: [],
    medications: [],
    chronicConditions: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeChronicRecord(overrides: Partial<ChronicRecord> = {}): ChronicRecord {
  return {
    id: 'cr-001',
    petId: 'pet-001',
    condition: '关节炎',
    diagnosedDate: '2024-03-01',
    severity: 'moderate',
    status: 'active',
    medications: ['葡萄糖胺'],
    vetName: '李医生',
    vetContact: '13800001111',
    nextCheckupDate: '2026-08-01',
    notes: '定期复查',
    symptoms: ['跛行', '活动减少'],
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeHealthEntry(overrides: Partial<PetHealthEntry> = {}): PetHealthEntry {
  return {
    id: 'entry-001',
    petId: 'pet-001',
    userId: 'user-001',
    poopLevel: 4,
    appetiteLevel: 4,
    spiritLevel: 4,
    exerciseLevel: 2,
    weight: 25,
    hasAnomaly: false,
    anomalyItems: [],
    aiFeedback: '✅ 状态不错',
    riskLevel: 'low',
    createdAt: new Date('2026-07-25'),
    ...overrides,
  }
}

// ============================================================
// 测试
// ============================================================

describe('性能基准测试', () => {
  beforeEach(() => {
    // 清空共享 mockStorage
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
  })

  // ==========================================================
  // 纯函数性能（< 5ms）
  // ==========================================================
  describe('纯函数性能', () => {
    const THRESHOLD_MS = 5

    it('buildFeedingProfile 应在 5ms 内完成', async () => {
      const pet = makePetProfile()

      const avgTime = await measureTimeAsync(async () => {
        await buildFeedingProfile(pet, ['鸡肉'], true)
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('generatePersonalizedAdvice 应在 5ms 内完成', async () => {
      const pet = makePetProfile()
      const chronicRecords = [makeChronicRecord()]
      const profile = await buildFeedingProfile(pet, ['鸡肉'], true)

      const avgTime = measureTime(() => {
        generatePersonalizedAdvice(profile, 'poor', 'loose')
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('getEmotionScore 应在 5ms 内完成', () => {
      const petId = 'pet-emo-001'
      // 预填充一些情绪事件数据
      const events = [
        { timestamp: Date.now() - 3600000, eventType: 'anomaly_detected' as const, severity: 'moderate' as const },
        { timestamp: Date.now() - 7200000, eventType: 'symptom_check' as const, severity: 'mild' as const },
        { timestamp: Date.now() - 86400000, eventType: 'food_query' as const, severity: 'mild' as const },
      ]
      mockStorage[`emotion_track_${petId}`] = JSON.stringify(events)

      const avgTime = measureTime(() => {
        getEmotionScore(petId)
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('getEmotionTrend 应在 5ms 内完成', () => {
      const petId = 'pet-trend-001'
      const now = Date.now()
      const events = [
        { timestamp: now - 86400000, eventType: 'anomaly_detected' as const, severity: 'severe' as const },
        { timestamp: now - 172800000, eventType: 'symptom_check' as const, severity: 'moderate' as const },
        { timestamp: now - 259200000, eventType: 'grief_detected' as const, severity: 'mild' as const },
        { timestamp: now - 345600000, eventType: 'anxiety_detected' as const, severity: 'mild' as const },
      ]
      mockStorage[`emotion_track_${petId}`] = JSON.stringify(events)

      const avgTime = measureTime(() => {
        getEmotionTrend(petId)
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('calculateConsecutiveAnomalyDays 应在 5ms 内完成', () => {
      const entries: PetHealthEntry[] = [
        makeHealthEntry({ id: 'e1', hasAnomaly: true, createdAt: new Date('2026-07-25') }),
        makeHealthEntry({ id: 'e2', hasAnomaly: true, createdAt: new Date('2026-07-24') }),
        makeHealthEntry({ id: 'e3', hasAnomaly: true, createdAt: new Date('2026-07-23') }),
        makeHealthEntry({ id: 'e4', hasAnomaly: false, createdAt: new Date('2026-07-22') }),
        makeHealthEntry({ id: 'e5', hasAnomaly: true, createdAt: new Date('2026-07-21') }),
      ]

      const avgTime = measureTime(() => {
        calculateConsecutiveAnomalyDays(entries)
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('generateDiaryFromEntries 应在 5ms 内完成', () => {
      const entries: PetHealthEntry[] = Array.from({ length: 10 }, (_, i) =>
        makeHealthEntry({
          id: `diary-${i}`,
          createdAt: new Date(2026, 6, 25 - i),
          hasAnomaly: i % 2 === 0,
          anomalyItems: i % 2 === 0 ? ['appetite'] : [],
        }),
      )

      const avgTime = measureTime(() => {
        generateDiaryFromEntries(entries, '2023-06-15')
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('generateWeeklyReport 应在 5ms 内完成', () => {
      const data = {
        petName: '旺财',
        species: 'dog',
        breed: '金毛',
        score: 85,
        scoreTrend: 'stable' as const,
        checkinDays: 6,
        anomalyDays: 1,
        streak: 7,
        recentMoments: [] as PetMoment[],
      }

      const avgTime = measureTime(() => {
        generateWeeklyReport(data)
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('checkAllAchievements 应在 5ms 内完成', () => {
      const context = {
        petId: 'pet-ach-001',
        birthDate: '2023-06-15',
        streakDays: 30,
        isDeceased: false,
        allVaccinesCompleted: true,
      }

      const avgTime = measureTime(() => {
        checkAllAchievements(context)
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('checkFrequency 应在 5ms 内完成', () => {
      resetToDefaultRules()

      const avgTime = measureTime(() => {
        checkFrequency('tmpl_followup')
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('formatMomentTime 应在 5ms 内完成', () => {
      const now = new Date()
      const isoString = new Date(now.getTime() - 3600000).toISOString()

      const avgTime = measureTime(() => {
        formatMomentTime(isoString)
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('getMomentTypeInfo 应在 5ms 内完成', () => {
      const avgTime = measureTime(() => {
        getMomentTypeInfo('checkin')
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('generateChronicReminderPayload 应在 5ms 内完成', () => {
      const record = makeChronicRecord()
      const petName = '旺财'
      const daysUntil = -2

      const avgTime = measureTime(() => {
        generateChronicReminderPayload(record, petName, daysUntil)
      })

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })
  })

  // ==========================================================
  // 存储操作性能（< 10ms）
  // ==========================================================
  describe('存储操作性能', () => {
    const THRESHOLD_MS = 10

    it('写入 100 条记录应在 10ms 内完成', () => {
      const avgTime = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          setStorage(`perf_write_${i}`, { id: i, value: `item-${i}`, timestamp: Date.now() })
        }
      }, 1)

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('读取 100 条记录应在 10ms 内完成', () => {
      // 先写入 100 条
      for (let i = 0; i < 100; i++) {
        setStorage(`perf_read_${i}`, { id: i, value: `item-${i}` })
      }

      const avgTime = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          getStorage(`perf_read_${i}`)
        }
      }, 1)

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('写入后读取 50 条记录应在 10ms 内完成', () => {
      const avgTime = measureTime(() => {
        for (let i = 0; i < 50; i++) {
          setStorage(`perf_rw_${i}`, { id: i, value: `item-${i}` })
          getStorage(`perf_rw_${i}`)
        }
      }, 1)

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })
  })

  // ==========================================================
  // 批量操作性能（< 50ms）
  // ==========================================================
  describe('批量操作性能', () => {
    const THRESHOLD_MS = 50

    it('100 次 checkInput 应在 50ms 内完成', () => {
      const inputs = [
        '今天宠物状态很好，精神不错',
        '食欲正常，排便也正常',
        '需要给宠物买新的狗粮了',
        '最近天气太热了，要注意防暑',
        '给宠物预约了下周的打疫苗',
      ]

      const avgTime = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          checkInput(inputs[i % inputs.length])
        }
      }, 1)

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('100 次 sanitizeOutput 应在 50ms 内完成', () => {
      const longText = '这是一段很长的文本，用于测试输出清理函数的性能表现。' +
        '我们需要确保即使文本很长，函数也能在规定时间内完成处理。' +
        '宠物的健康管理需要持续的关注和记录，每天的打卡都很有意义。'

      const avgTime = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          sanitizeOutput(longText, 150)
        }
      }, 1)

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('100 次 getMomentTypeInfo 应在 50ms 内完成', () => {
      const types = ['checkin', 'milestone', 'photo', 'memory', 'ai_summary', 'unknown']

      const avgTime = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          getMomentTypeInfo(types[i % types.length])
        }
      }, 1)

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })

    it('100 次 getMoodEmoji 应在 50ms 内完成', () => {
      const moods: Array<'excellent' | 'good' | 'fair' | 'concerning'> = [
        'excellent', 'good', 'fair', 'concerning',
      ]

      const avgTime = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          getMoodEmoji(moods[i % moods.length])
        }
      }, 1)

      expect(avgTime).toBeLessThan(THRESHOLD_MS)
    })
  })
})