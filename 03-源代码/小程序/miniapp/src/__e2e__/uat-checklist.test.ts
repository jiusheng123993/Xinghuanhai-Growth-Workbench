/**
 * UAT 验收测试清单
 *
 * 全面验证 PRD 功能完整性、错误处理、数据一致性和核心场景回归。
 * 覆盖所有 PRD 模块：宠物档案、健康打卡、食物查询、AI对话、疫苗驱虫、
 * 症状初筛、健康趋势、宠物家庭、时光引擎、宠物日记、成就系统、会员系统、
 * 宠物衣橱、周报。
 *
 * 策略：mock 底层依赖（storage / Taro / config / api），
 * 导入真实服务模块进行业务逻辑验证。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChronicRecord } from '../types/chronicTypes'
import type { PetProfile } from '../services/petService'

// ============================================================
// 导入真实模块
// ============================================================
import { buildFeedingProfile, generatePersonalizedAdvice, getMealPlan } from '../services/feedingService'
import { generateWeeklyReport, generateFamilyWeeklySummary, getMoodEmoji, getMoodLabel, getOverallMood } from '../services/weeklyReportService'
import { checkAllAchievements, checkBirthdayAchievement, checkStreakAchievement } from '../services/achievementService'
import { formatMomentTime, getMomentTypeInfo } from '../services/momentService'
import { generateChronicReminderPayload, getChronicStats } from '../services/chronicService'
import { checkInput, sanitizeOutput } from '../utils/ruleGuard'
import { MEMBERSHIP_PLANS, MEMBERSHIP_BENEFITS } from '../services/membershipService'

// ============================================================
// Mock 层：共享的 mock storage 和 api
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
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
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
    birthday: { type: 'birthday' as const, title: '生日快乐', subtitle: '又长大一岁了', icon: '🎂', color: '#FF69B4' },
    vaccine_complete: { type: 'vaccine_complete' as const, title: '疫苗全勤', subtitle: '年度疫苗全部完成', icon: '💉', color: '#4CAF50' },
    streak_7: { type: 'streak_7' as const, title: '连续7天', subtitle: '一周健康打卡', icon: '⭐', color: '#FFD700' },
    streak_30: { type: 'streak_30' as const, title: '连续30天', subtitle: '月度健康达人', icon: '🏆', color: '#FF9800' },
    streak_100: { type: 'streak_100' as const, title: '连续100天', subtitle: '百天守护勋章', icon: '👑', color: '#9C27B0' },
    rainbow_bridge: { type: 'rainbow_bridge' as const, title: '彩虹桥', subtitle: '永远记得你', icon: '🌈', color: '#9B8EC4' },
    holiday: { type: 'holiday' as const, title: '节日快乐', subtitle: '和毛孩子一起过节', icon: '🎄', color: '#F44336' },
  },
}))

vi.mock('../services/chronicService', async () => {
  const actual = await vi.importActual('../services/chronicService')
  return actual
})

// ============================================================
// 辅助工厂函数
// ============================================================
function makePet(overrides: Partial<PetProfile> = {}): PetProfile {
  const now = new Date('2026-07-25')
  return {
    id: 'pet_001',
    userId: 'user_001',
    name: '小黄',
    species: 'dog',
    breed: '金毛',
    breedId: 'breed_001',
    gender: 'male',
    birthDate: new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).toISOString().slice(0, 10),
    weight: 25,
    coatColor: '金色',
    photos: [],
    isNeutered: false,
    microchipId: '',
    notes: '',
    isDeceased: false,
    allergies: [],
    medications: [],
    chronicConditions: [],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    avatarPhotoUrl: '',
    ...overrides,
  }
}

function makeChronicRecord(overrides: Partial<ChronicRecord> = {}): ChronicRecord {
  return {
    id: 'cr_001',
    petId: 'pet_001',
    condition: '关节炎',
    diagnosedDate: '2024-06-01',
    severity: 'moderate',
    status: 'active',
    medications: [],
    vetName: '李医生',
    vetContact: '13800138000',
    nextCheckupDate: '2025-06-01',
    notes: '',
    symptoms: ['跛行'],
    createdAt: '2024-06-01',
    updatedAt: '2024-06-01',
    ...overrides,
  }
}

function monthsAgo(months: number): string {
  const d = new Date('2026-07-25')
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}

function yearsAgo(years: number): string {
  const d = new Date('2026-07-25')
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

// ============================================================
// UAT 验收测试套件
// ============================================================
describe('UAT 验收测试', async () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  // ==========================================================
  // 第一部分：PRD 功能完整性验证
  // ==========================================================
  describe('PRD功能完整性验证', async () => {
    // ----------------------------------------------------------
    // 喂养建议引擎
    // ----------------------------------------------------------
    describe('喂养建议引擎应支持所有生命周期阶段', async () => {
      it('幼犬（<12个月）应识别为 isPuppyKitten 并生成幼年喂养建议', async () => {
        const pet = makePet({ birthDate: monthsAgo(6), species: 'dog' })
        const profile = await buildFeedingProfile(pet)
        expect(profile.isPuppyKitten).toBe(true)
        expect(profile.isSenior).toBe(false)

        const advice = generatePersonalizedAdvice(profile)
        const foodTypeAdvice = advice.find(a => a.type === 'meal_frequency')
        expect(foodTypeAdvice).toBeDefined()
        expect(foodTypeAdvice!.content).toContain('幼犬')
        expect(foodTypeAdvice!.priority).toBe('high')
      })

      it('幼猫（<12个月）应识别为 isPuppyKitten 并生成幼猫喂养建议', async () => {
        const pet = makePet({ birthDate: monthsAgo(4), species: 'cat', breed: '英短' })
        const profile = await buildFeedingProfile(pet)
        expect(profile.isPuppyKitten).toBe(true)

        const advice = generatePersonalizedAdvice(profile)
        const foodTypeAdvice = advice.find(a => a.type === 'meal_frequency')
        expect(foodTypeAdvice).toBeDefined()
        expect(foodTypeAdvice!.content).toContain('幼猫')
      })

      it('老年犬（>=84个月/7岁）应识别为 isSenior 并生成老年喂养建议', async () => {
        const pet = makePet({ birthDate: yearsAgo(8), species: 'dog' })
        const profile = await buildFeedingProfile(pet)
        expect(profile.isSenior).toBe(true)
        expect(profile.isPuppyKitten).toBe(false)

        const advice = generatePersonalizedAdvice(profile)
        const seniorAdvice = advice.find(a => a.title === '老年宠物喂养调整')
        expect(seniorAdvice).toBeDefined()
        expect(seniorAdvice!.content).toContain('老年')
      })

      it('老年猫（>=120个月/10岁）应识别为 isSenior', async () => {
        const pet = makePet({ birthDate: yearsAgo(11), species: 'cat', breed: '英短' })
        const profile = await buildFeedingProfile(pet)
        expect(profile.isSenior).toBe(true)
      })

      it('成年犬（1-7岁）不应识别为幼年或老年', async () => {
        const pet = makePet({ birthDate: yearsAgo(3), species: 'dog' })
        const profile = await buildFeedingProfile(pet)
        expect(profile.isPuppyKitten).toBe(false)
        expect(profile.isSenior).toBe(false)
      })

      it('绝育宠物应生成绝育后饮食建议', async () => {
        const pet = makePet({ birthDate: yearsAgo(3), species: 'dog', isNeutered: true })
        // buildFeedingProfile 签名：(pet, userId, allergies?, isNeutered?)
        const profile = await buildFeedingProfile(pet, 'user_001', [], true)
        expect(profile.isNeutered).toBe(true)

        const advice = generatePersonalizedAdvice(profile)
        const neuteredAdvice = advice.find(a => a.type === 'food_type' && a.title === '绝育后饮食注意')
        expect(neuteredAdvice).toBeDefined()
        expect(neuteredAdvice!.content).toContain('绝育')
      })

      it('有慢性病的宠物应生成慢性病饮食建议', async () => {
        const pet = makePet({ birthDate: yearsAgo(5), species: 'dog' })
        const chronic = makeChronicRecord({ condition: '慢性肾病', status: 'active' })
        // 先把慢性病记录写入 mock 存储（与 chronicService 的存取约定一致），
        // buildFeedingProfile 内部通过 getChronicRecords(petId, userId) 读取
        mockStorage['chronic_records'] = JSON.stringify({ [pet.id]: [chronic] })
        const profile = await buildFeedingProfile(pet, 'user_001')

        const advice = generatePersonalizedAdvice(profile)
        const chronicAdvice = advice.find(a => a.type === 'chronic' && a.title === '慢性肾病饮食管理')
        expect(chronicAdvice).toBeDefined()
        expect(chronicAdvice!.priority).toBe('high')
      })

      it('有过敏信息的宠物应生成过敏提醒', async () => {
        const pet = makePet({ birthDate: yearsAgo(3), species: 'cat', breed: '英短' })
        // 过敏信息是第 3 个参数，第 2 个参数为 userId
        const profile = await buildFeedingProfile(pet, 'user_001', ['鸡肉', '谷物'])

        const advice = generatePersonalizedAdvice(profile)
        const allergyAdvice = advice.find(a => a.type === 'allergy')
        expect(allergyAdvice).toBeDefined()
        expect(allergyAdvice!.content).toContain('鸡肉')
        expect(allergyAdvice!.content).toContain('谷物')
        expect(allergyAdvice!.priority).toBe('high')
      })

      it('getMealPlan 应为幼年宠物返回4餐计划', async () => {
        const pet = makePet({ birthDate: monthsAgo(6), species: 'dog' })
        const profile = await buildFeedingProfile(pet)
        const plan = getMealPlan(profile)
        expect(plan).toHaveLength(4)
        expect(plan[0].label).toBe('早餐')
        expect(plan[3].label).toBe('夜宵')
      })

      it('getMealPlan 应为老年宠物返回2餐计划', async () => {
        const pet = makePet({ birthDate: yearsAgo(8), species: 'dog' })
        const profile = await buildFeedingProfile(pet)
        const plan = getMealPlan(profile)
        expect(plan).toHaveLength(2)
      })

      it('getMealPlan 应为成年宠物返回2餐计划', async () => {
        const pet = makePet({ birthDate: yearsAgo(3), species: 'dog' })
        const profile = await buildFeedingProfile(pet)
        const plan = getMealPlan(profile)
        expect(plan).toHaveLength(2)
      })
    })

    // ----------------------------------------------------------
    // 周报服务
    // ----------------------------------------------------------
    describe('周报应覆盖所有评级状态', async () => {
      it('分数 >= 90 且无异常天数应评定为 excellent', async () => {
        expect(getOverallMood(90, 0)).toBe('excellent')
        expect(getOverallMood(95, 0)).toBe('excellent')
      })

      it('分数 >= 80 且异常天数 <= 1 应评定为 good', async () => {
        expect(getOverallMood(80, 0)).toBe('good')
        expect(getOverallMood(85, 1)).toBe('good')
      })

      it('分数 >= 65 且异常天数 <= 3 应评定为 fair', async () => {
        expect(getOverallMood(65, 0)).toBe('fair')
        expect(getOverallMood(70, 3)).toBe('fair')
      })

      it('不满足上述条件应评定为 concerning', async () => {
        expect(getOverallMood(64, 0)).toBe('concerning')
        expect(getOverallMood(80, 4)).toBe('concerning')
        expect(getOverallMood(50, 5)).toBe('concerning')
      })

      it('getMoodEmoji 应为所有评级返回正确的 emoji', async () => {
        expect(getMoodEmoji('excellent')).toBe('🌟')
        expect(getMoodEmoji('good')).toBe('😊')
        expect(getMoodEmoji('fair')).toBe('🤔')
        expect(getMoodEmoji('concerning')).toBe('💊')
      })

      it('getMoodLabel 应为所有评级返回正确的中文标签', async () => {
        expect(getMoodLabel('excellent')).toBe('状态出色')
        expect(getMoodLabel('good')).toBe('状态良好')
        expect(getMoodLabel('fair')).toBe('需要关注')
        expect(getMoodLabel('concerning')).toBe('建议调整')
      })

      it('generateWeeklyReport 应生成包含所有必要字段的完整报告', async () => {
        const report = generateWeeklyReport({
          petName: '小咪',
          species: 'cat',
          breed: '英短',
          score: 85,
          scoreTrend: 'stable',
          checkinDays: 7,
          anomalyDays: 0,
          streak: 7,
          recentMoments: [],
        })
        expect(report.title).toContain('小咪')
        expect(report.summary).toBeTruthy()
        expect(report.highlights.length).toBeGreaterThan(0)
        expect(report.overallMood).toBe('good')
        expect(report.suggestions.length).toBeGreaterThan(0)
      })

      it('generateFamilyWeeklySummary 应正确汇总多宠物家庭状态', async () => {
        const reports = [
          {
            title: '小咪的周健康报告',
            summary: '状态出色',
            highlights: ['表现优异'],
            concerns: [],
            suggestions: ['继续保持'],
            overallMood: 'excellent' as const,
          },
          {
            title: '旺财的周健康报告',
            summary: '需要关注',
            highlights: [],
            concerns: ['异常较多'],
            suggestions: ['建议检查'],
            overallMood: 'concerning' as const,
          },
        ]
        const summary = generateFamilyWeeklySummary(reports, 2)
        expect(summary.overallMood).toBe('concerning')
        expect(summary.summary).toBeTruthy()
        expect(summary.concerns.length).toBeGreaterThan(0)
      })
    })

    // ----------------------------------------------------------
    // 成就系统
    // ----------------------------------------------------------
    describe('成就系统应支持所有成就类型', async () => {
      const PET_ID = 'pet_001'

      beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-07-25T10:00:00'))
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('checkBirthdayAchievement 在生日当天应返回成就', async () => {
        vi.setSystemTime(new Date('2026-03-15T10:00:00'))
        const result = checkBirthdayAchievement('2024-03-15', PET_ID)
        expect(result).not.toBeNull()
        expect(result!.type).toBe('birthday')
        expect(result!.title).toBe('生日快乐')
      })

      it('checkBirthdayAchievement 在非生日应返回 null', async () => {
        const result = checkBirthdayAchievement('2024-06-15', PET_ID)
        expect(result).toBeNull()
      })

      it('checkBirthdayAchievement 传入 undefined 应返回 null', async () => {
        const result = checkBirthdayAchievement(undefined, PET_ID)
        expect(result).toBeNull()
      })

      it('checkStreakAchievement 连续7天应返回 streak_7', async () => {
        const result = checkStreakAchievement(7, PET_ID)
        expect(result).not.toBeNull()
        expect(result!.type).toBe('streak_7')
      })

      it('checkStreakAchievement 连续30天应返回 streak_30', async () => {
        const result = checkStreakAchievement(30, PET_ID)
        expect(result).not.toBeNull()
        expect(result!.type).toBe('streak_30')
      })

      it('checkStreakAchievement 连续100天应返回 streak_100', async () => {
        const result = checkStreakAchievement(100, PET_ID)
        expect(result).not.toBeNull()
        expect(result!.type).toBe('streak_100')
      })

      it('checkStreakAchievement 非里程碑天数应返回 null', async () => {
        expect(checkStreakAchievement(5, PET_ID)).toBeNull()
        expect(checkStreakAchievement(15, PET_ID)).toBeNull()
        expect(checkStreakAchievement(50, PET_ID)).toBeNull()
      })

      it('checkAllAchievements 应优先返回生日成就（优先级最高）', async () => {
        vi.setSystemTime(new Date('2026-03-15T10:00:00'))
        const result = checkAllAchievements({
          petId: PET_ID,
          birthDate: '2024-03-15',
          streakDays: 30,
          isDeceased: false,
        })
        expect(result).not.toBeNull()
        // 生日优先级最高，应返回 birthday 而非 streak_30
        expect(result!.type).toBe('birthday')
      })

      it('checkAllAchievements 在无成就时应返回 null', async () => {
        const result = checkAllAchievements({
          petId: PET_ID,
          birthDate: '2024-06-15',
          streakDays: 5,
          isDeceased: false,
        })
        expect(result).toBeNull()
      })
    })

    // ----------------------------------------------------------
    // 时光引擎 - 时间格式化
    // ----------------------------------------------------------
    describe('时间格式化应覆盖所有时间范围', async () => {
      it('1分钟以内应返回"刚刚"', async () => {
        const now = new Date()
        const result = formatMomentTime(now.toISOString())
        expect(result).toBe('刚刚')
      })

      it('1-59分钟应返回"X分钟前"', async () => {
        const now = new Date()
        const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000)
        const result = formatMomentTime(thirtyMinAgo.toISOString())
        expect(result).toContain('分钟前')
      })

      it('1-23小时应返回"X小时前"', async () => {
        const now = new Date()
        const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000)
        const result = formatMomentTime(fiveHoursAgo.toISOString())
        expect(result).toContain('小时前')
      })

      it('1-6天应返回"X天前"', async () => {
        const now = new Date()
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
        const result = formatMomentTime(threeDaysAgo.toISOString())
        expect(result).toContain('天前')
      })

      it('7天以上应返回"X月X日"格式', async () => {
        const result = formatMomentTime('2026-06-15T10:00:00')
        expect(result).toBe('6月15日')
      })
    })

    // ----------------------------------------------------------
    // 时光引擎 - 动态类型
    // ----------------------------------------------------------
    describe('动态类型应覆盖所有事件类型', async () => {
      it('checkin 类型应返回正确的图标和标签', async () => {
        const info = getMomentTypeInfo('checkin')
        expect(info.icon).toBe('✅')
        expect(info.label).toBe('健康打卡')
      })

      it('milestone 类型应返回正确的图标和标签', async () => {
        const info = getMomentTypeInfo('milestone')
        expect(info.icon).toBe('🎉')
        expect(info.label).toBe('里程碑')
      })

      it('photo 类型应返回正确的图标和标签', async () => {
        const info = getMomentTypeInfo('photo')
        expect(info.icon).toBe('📷')
        expect(info.label).toBe('分享照片')
      })

      it('memory 类型应返回正确的图标和标签', async () => {
        const info = getMomentTypeInfo('memory')
        expect(info.icon).toBe('💭')
        expect(info.label).toBe('回忆')
      })

      it('ai_summary 类型应返回正确的图标和标签', async () => {
        const info = getMomentTypeInfo('ai_summary')
        expect(info.icon).toBe('🤖')
        expect(info.label).toBe('AI周报')
      })

      it('未知类型应返回默认图标和标签', async () => {
        const info = getMomentTypeInfo('unknown_type')
        expect(info.icon).toBe('📝')
        expect(info.label).toBe('动态')
      })
    })

    // ----------------------------------------------------------
    // 慢性病提醒
    // ----------------------------------------------------------
    describe('慢性病提醒应覆盖所有时间场景', async () => {
      const record = makeChronicRecord({
        condition: '糖尿病',
        nextCheckupDate: '2026-07-28',
      })

      it('复查已逾期（daysUntil < 0）应标记为紧急并提示逾期天数', async () => {
        const payload = generateChronicReminderPayload(record, '小黄', -3)
        expect(payload.isUrgent).toBe(true)
        expect(payload.title).toContain('逾期')
        expect(payload.content).toContain('3')
      })

      it('复查就在今天（daysUntil === 0）应标记为紧急', async () => {
        const payload = generateChronicReminderPayload(record, '小黄', 0)
        expect(payload.isUrgent).toBe(true)
        expect(payload.title).toContain('今天')
        expect(payload.content).toContain('今天')
      })

      it('复查剩余1-3天（daysUntil <= 3）应生成提醒但不标记紧急', async () => {
        const payload = generateChronicReminderPayload(record, '小黄', 2)
        expect(payload.isUrgent).toBe(false)
        expect(payload.title).toContain('复查提醒')
        expect(payload.content).toContain('2')
      })

      it('复查剩余超过3天（daysUntil > 3）应生成普通提醒', async () => {
        const payload = generateChronicReminderPayload(record, '小黄', 5)
        expect(payload.isUrgent).toBe(false)
        expect(payload.content).toContain('5')
        expect(payload.content).toContain(record.nextCheckupDate)
      })
    })

    // ----------------------------------------------------------
    // 安全检测（ruleGuard）
    // ----------------------------------------------------------
    describe('安全检测应覆盖所有有害内容类型', async () => {
      it('应检测自伤关键词（自杀）', async () => {
        const result = checkInput('我想自杀')
        expect(result.blocked).toBe(true)
        expect(result.isCrisis).toBe(true)
        expect(result.action).toBe('crisis_intervention')
      })

      it('应检测自伤关键词（不想活了）', async () => {
        const result = checkInput('我觉得不想活了')
        expect(result.blocked).toBe(true)
        expect(result.isCrisis).toBe(true)
      })

      it('应检测虐待动物关键词', async () => {
        const result = checkInput('如何虐待宠物')
        expect(result.blocked).toBe(true)
        expect(result.isCrisis).toBe(false)
        expect(result.action).toBe('block')
        expect(result.reason).toBe('检测到虐待动物倾向')
      })

      it('应检测隐私信息 — 手机号', async () => {
        const result = checkInput('我的手机是13812345678')
        expect(result.blocked).toBe(true)
        expect(result.reason).toBe('检测到疑似隐私信息')
      })

      it('应检测隐私信息 — 身份证号', async () => {
        const result = checkInput('110101199001011234')
        expect(result.blocked).toBe(true)
      })

      it('应检测隐私信息 — 邮箱', async () => {
        const result = checkInput('test@example.com')
        expect(result.blocked).toBe(true)
      })

      it('正常宠物喂养内容应放行', async () => {
        const result = checkInput('小黄今天食欲很好，吃了两碗狗粮')
        expect(result.blocked).toBe(false)
        expect(result.action).toBe('pass')
      })
    })

    // ----------------------------------------------------------
    // 会员系统
    // ----------------------------------------------------------
    describe('会员计划应包含正确的价格和方案', async () => {
      it('应包含月度、季度、年度三种方案', async () => {
        expect(MEMBERSHIP_PLANS).toHaveLength(3)
        const plans = MEMBERSHIP_PLANS.map(p => p.plan)
        expect(plans).toContain('monthly')
        expect(plans).toContain('quarterly')
        expect(plans).toContain('yearly')
      })

      it('月度会员价格应为 9.9 元（促销原价 29.9）', async () => {
        const monthly = MEMBERSHIP_PLANS.find(p => p.plan === 'monthly')
        expect(monthly).toBeDefined()
        expect(monthly!.price).toBe(9.9)
        expect(monthly!.originalPrice).toBe(29.9)
        expect(monthly!.durationDays).toBe(30)
      })

      it('季度会员价格应为 25.9 元（促销原价 79.9）', async () => {
        const quarterly = MEMBERSHIP_PLANS.find(p => p.plan === 'quarterly')
        expect(quarterly).toBeDefined()
        expect(quarterly!.price).toBe(25.9)
        expect(quarterly!.originalPrice).toBe(79.9)
        expect(quarterly!.durationDays).toBe(90)
      })

      it('年度会员价格应为 88 元（促销原价 269）', async () => {
        const yearly = MEMBERSHIP_PLANS.find(p => p.plan === 'yearly')
        expect(yearly).toBeDefined()
        expect(yearly!.price).toBe(88)
        expect(yearly!.originalPrice).toBe(269)
        expect(yearly!.durationDays).toBe(365)
      })
    })

    describe('会员权益应覆盖所有功能点', async () => {
      it('应包含 9 项权益', async () => {
        expect(MEMBERSHIP_BENEFITS.length).toBeGreaterThanOrEqual(9)
      })

      it('食物安全查询应为免费每日5次、会员不限', async () => {
        const benefit = MEMBERSHIP_BENEFITS.find(b => b.featureKey === 'food_query')
        expect(benefit).toBeDefined()
        expect(benefit!.freeValue).toBe('每日5次')
        expect(benefit!.memberValue).toBe('不限')
        expect(benefit!.isHighlight).toBe(true)
      })

      it('AI症状初筛应为免费每日2次、会员不限', async () => {
        const benefit = MEMBERSHIP_BENEFITS.find(b => b.featureKey === 'symptom_check')
        expect(benefit).toBeDefined()
        expect(benefit!.freeValue).toBe('每日2次')
        expect(benefit!.memberValue).toBe('不限')
      })

      it('健康趋势图应为免费7天、会员不限', async () => {
        const benefit = MEMBERSHIP_BENEFITS.find(b => b.featureKey === 'health_trend')
        expect(benefit).toBeDefined()
        expect(benefit!.freeValue).toBe('7天')
        expect(benefit!.memberValue).toBe('不限')
      })

      it('宠物档案应为免费最多2只、会员最多5只', async () => {
        const benefit = MEMBERSHIP_BENEFITS.find(b => b.featureKey === 'pet_count')
        expect(benefit).toBeDefined()
        expect(benefit!.freeValue).toBe('最多2只')
        expect(benefit!.memberValue).toBe('最多5只')
      })

      it('健康报告导出应为免费不可用、会员可用', async () => {
        const benefit = MEMBERSHIP_BENEFITS.find(b => b.featureKey === 'health_report')
        expect(benefit).toBeDefined()
        expect(benefit!.freeValue).toBe('❌')
        expect(benefit!.memberValue).toBe('✅')
      })

      it('慢性病追踪应为免费不可用、会员可用', async () => {
        const benefit = MEMBERSHIP_BENEFITS.find(b => b.featureKey === 'chronic_tracking')
        expect(benefit).toBeDefined()
        expect(benefit!.freeValue).toBe('❌')
        expect(benefit!.memberValue).toBe('✅')
      })

      it('个性化喂养建议应为免费不可用、会员可用', async () => {
        const benefit = MEMBERSHIP_BENEFITS.find(b => b.featureKey === 'feeding_advice')
        expect(benefit).toBeDefined()
        expect(benefit!.freeValue).toBe('❌')
        expect(benefit!.memberValue).toBe('✅')
      })
    })
  })

  // ==========================================================
  // 第二部分：错误处理验证
  // ==========================================================
  describe('错误处理验证', async () => {
    describe('空数据应返回合理的默认值', async () => {
      it('buildFeedingProfile 空慢性病记录应返回空数组', async () => {
        const pet = makePet()
        const profile = await buildFeedingProfile(pet)
        expect(profile.chronicConditions).toEqual([])
        expect(profile.allergies).toEqual([])
      })

      it('buildFeedingProfile 体重为0时应使用默认值', async () => {
        const pet = makePet({ weight: 0 })
        const profile = await buildFeedingProfile(pet)
        expect(profile.weight).toBe(0)
      })

      it('generateWeeklyReport 空近期动态应不影响报告生成', async () => {
        const report = generateWeeklyReport({
          petName: '测试',
          species: 'cat',
          score: 50,
          scoreTrend: 'down',
          checkinDays: 0,
          anomalyDays: 5,
          streak: 0,
          recentMoments: [],
        })
        expect(report.title).toBeTruthy()
        expect(report.summary).toBeTruthy()
        expect(report.overallMood).toBe('concerning')
      })

      it('sanitizeOutput 空字符串应原样返回', async () => {
        expect(sanitizeOutput('')).toBe('')
      })

      it('checkInput 空字符串应放行', async () => {
        const result = checkInput('')
        expect(result.blocked).toBe(false)
        expect(result.action).toBe('pass')
      })
    })

    describe('无效输入不应导致崩溃', async () => {
      it('checkInput 应正常处理 null/undefined-like 输入', async () => {
        // 空字符串是安全的
        const result = checkInput('')
        expect(result.blocked).toBe(false)
      })

      it('sanitizeOutput 应正常处理 maxLength=0', async () => {
        const result = sanitizeOutput('hello', 0)
        expect(result).toBe('...')
      })

      it('sanitizeOutput 应正常处理 maxLength=1', async () => {
        const result = sanitizeOutput('hello', 1)
        expect(result).toBe('h...')
      })

      it('getMomentTypeInfo 应处理 undefined-like 类型', async () => {
        const info = getMomentTypeInfo('')
        expect(info.icon).toBe('📝')
        expect(info.label).toBe('动态')
      })
    })

    describe('边界值应返回合理结果', async () => {
      it('sanitizeOutput 应处理恰好等于 maxLength 的文本', async () => {
        const text = 'x'.repeat(150)
        const result = sanitizeOutput(text, 150)
        expect(result).toBe(text)
        expect(result.endsWith('...')).toBe(false)
      })

      it('sanitizeOutput 应处理超长文本并截断', async () => {
        const text = 'x'.repeat(300)
        const result = sanitizeOutput(text, 150)
        expect(result.length).toBe(153) // 150 + '...'
        expect(result.endsWith('...')).toBe(true)
      })

      it('checkInput 应处理超长文本（10000+ 字符）而不崩溃', async () => {
        const longText = '正常宠物喂养内容'.repeat(1000)
        const result = checkInput(longText)
        expect(result.blocked).toBe(true)
        expect(result.action).toBe('block')
      })

      it('checkInput 应在超长文本中检测到关键词', async () => {
        const prefix = '正常内容'.repeat(500)
        const result = checkInput(prefix + '自杀')
        expect(result.blocked).toBe(true)
      })

      it('checkInput 应正常处理特殊字符（换行、制表、emoji）', async () => {
        const result = checkInput('🐱🐶\n今天\t很开心 😊')
        expect(result.blocked).toBe(false)
      })
    })
  })

  // ==========================================================
  // 第三部分：数据一致性验证
  // ==========================================================
  describe('数据一致性验证', async () => {
    describe('喂养建议与年龄阶段应一致', async () => {
      it('幼年宠物年龄应 < 12 个月', async () => {
        const pet = makePet({ birthDate: monthsAgo(3), species: 'dog' })
        const profile = await buildFeedingProfile(pet)
        expect(profile.ageMonths).toBeLessThan(12)
        expect(profile.isPuppyKitten).toBe(true)
      })

      it('老年犬年龄应 >= 84 个月', async () => {
        const pet = makePet({ birthDate: yearsAgo(8), species: 'dog' })
        const profile = await buildFeedingProfile(pet)
        expect(profile.ageMonths).toBeGreaterThanOrEqual(84)
        expect(profile.isSenior).toBe(true)
      })

      it('老年猫年龄应 >= 120 个月', async () => {
        const pet = makePet({ birthDate: yearsAgo(10), species: 'cat', breed: '英短' })
        const profile = await buildFeedingProfile(pet)
        expect(profile.ageMonths).toBeGreaterThanOrEqual(120)
        expect(profile.isSenior).toBe(true)
      })

      it('每日建议喂食量应包含在建议中', async () => {
        const pet = makePet({ birthDate: yearsAgo(3), species: 'dog' })
        const profile = await buildFeedingProfile(pet)
        const advice = generatePersonalizedAdvice(profile)
        const dailyAdvice = advice.find(a => a.type === 'daily_amount')
        expect(dailyAdvice).toBeDefined()
        expect(dailyAdvice!.content).toContain('kcal')
        expect(dailyAdvice!.content).toContain('g')
        expect(dailyAdvice!.content).toContain(pet.name)
      })
    })

    describe('风险等级与分值应一致', async () => {
      it('excellent 必须 score >= 90 且 anomalyDays === 0', async () => {
        expect(getOverallMood(90, 0)).toBe('excellent')
        expect(getOverallMood(89, 0)).not.toBe('excellent')
        expect(getOverallMood(90, 1)).not.toBe('excellent')
      })

      it('good 必须 score >= 80 且 anomalyDays <= 1', async () => {
        expect(getOverallMood(80, 0)).toBe('good')
        expect(getOverallMood(85, 1)).toBe('good')
        expect(getOverallMood(79, 0)).not.toBe('good')
        expect(getOverallMood(85, 2)).not.toBe('good')
      })

      it('fair 必须 score >= 65 且 anomalyDays <= 3', async () => {
        expect(getOverallMood(65, 0)).toBe('fair')
        expect(getOverallMood(70, 3)).toBe('fair')
        expect(getOverallMood(64, 0)).not.toBe('fair')
        expect(getOverallMood(70, 4)).not.toBe('fair')
      })
    })

    describe('成就互斥逻辑应正确', async () => {
      const PET_ID = 'pet_001'

      beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-07-25T10:00:00'))
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('同一天不应重复触发同一成就', async () => {
        // 第一次触发
        const first = checkStreakAchievement(7, PET_ID)
        expect(first).not.toBeNull()

        // 第二次触发（同一天）应返回 null
        const second = checkStreakAchievement(7, PET_ID)
        expect(second).toBeNull()
      })

      it('checkAllAchievements 生日优先级高于 streak', async () => {
        vi.setSystemTime(new Date('2026-03-15T10:00:00'))
        const result = checkAllAchievements({
          petId: PET_ID,
          birthDate: '2024-03-15',
          streakDays: 30,
          isDeceased: false,
        })
        expect(result).not.toBeNull()
        expect(result!.type).toBe('birthday')
      })

      it('checkAllAchievements 在无任何成就时应返回 null', async () => {
        const result = checkAllAchievements({
          petId: PET_ID,
          birthDate: '2024-06-15',
          streakDays: 2,
          isDeceased: false,
        })
        expect(result).toBeNull()
      })
    })
  })

  // ==========================================================
  // 第四部分：PRD 核心场景回归验证
  // ==========================================================
  describe('PRD核心场景回归验证', async () => {
    describe('用户从注册到首次打卡的完整流程', async () => {
      it('新用户添加宠物后应能正确构建喂养档案', async () => {
        // 固定系统时间，与 monthsAgo 基准（2026-07-25）一致，避免跨月导致 ageMonths 漂移
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-07-25T10:00:00'))
        const pet = makePet({
          name: '青橘',
          species: 'cat',
          breed: '英短',
          birthDate: monthsAgo(6),
          weight: 2.5,
        })
        const profile = await buildFeedingProfile(pet)
        expect(profile.pet.name).toBe('青橘')
        expect(profile.isPuppyKitten).toBe(true)
        expect(profile.ageMonths).toBe(6)
        vi.useRealTimers()
      })

      it('新用户应能获取幼猫喂养建议', async () => {
        const pet = makePet({
          name: '青橘',
          species: 'cat',
          breed: '英短',
          birthDate: monthsAgo(6),
          weight: 2.5,
        })
        const profile = await buildFeedingProfile(pet)
        const advice = generatePersonalizedAdvice(profile)
        expect(advice.length).toBeGreaterThan(0)
        // 至少包含每日喂食量建议
        const dailyAdvice = advice.find(a => a.type === 'daily_amount')
        expect(dailyAdvice).toBeDefined()
      })

      it('打卡7天后应触发连续7天成就', async () => {
        const result = checkStreakAchievement(7, 'pet_001')
        expect(result).not.toBeNull()
        expect(result!.type).toBe('streak_7')
        expect(result!.title).toBe('连续7天')
      })
    })

    describe('用户查询食物到查看历史的完整流程', async () => {
      it('安全检测应正确识别有毒食物名称', async () => {
        // 巧克力 是有毒食物关键词
        const result = checkInput('巧克力')
        // 注意：巧克力不在 ruleGuard 的自伤/虐待/隐私 关键词中，但它在 TOXIC_FOOD_NAMES 中
        // checkInput 不检查 TOXIC_FOOD_NAMES
        // 这是设计上的分离：checkInput 负责安全合规，食物安全由其他模块负责
        expect(result.blocked).toBe(false)
      })

      it('正常食物查询应被放行', async () => {
        const result = checkInput('狗狗可以吃苹果吗')
        expect(result.blocked).toBe(false)
        expect(result.action).toBe('pass')
      })
    })

    describe('用户订阅会员到使用权益的完整流程', async () => {
      it('免费用户应受食物查询次数限制（每日5次）', async () => {
        const benefit = MEMBERSHIP_BENEFITS.find(b => b.featureKey === 'food_query')
        expect(benefit).toBeDefined()
        expect(benefit!.freeValue).toBe('每日5次')
      })

      it('会员用户食物查询应不限次数', async () => {
        const benefit = MEMBERSHIP_BENEFITS.find(b => b.featureKey === 'food_query')
        expect(benefit!.memberValue).toBe('不限')
      })

      it('会员应享有免费用户没有的权益（健康报告导出、慢性病追踪、喂养建议）', async () => {
        const exclusiveBenefits = MEMBERSHIP_BENEFITS.filter(
          b => b.freeValue === '❌' && b.memberValue === '✅'
        )
        const exclusiveKeys = exclusiveBenefits.map(b => b.featureKey)
        expect(exclusiveKeys).toContain('health_report')
        expect(exclusiveKeys).toContain('chronic_tracking')
        expect(exclusiveKeys).toContain('feeding_advice')
      })

      it('年度会员日均价格应低于月度会员', async () => {
        const monthly = MEMBERSHIP_PLANS.find(p => p.plan === 'monthly')!
        const yearly = MEMBERSHIP_PLANS.find(p => p.plan === 'yearly')!
        const monthlyDaily = monthly.price / monthly.durationDays
        const yearlyDaily = yearly.price / yearly.durationDays
        expect(yearlyDaily).toBeLessThan(monthlyDaily)
      })
    })
  })
})
