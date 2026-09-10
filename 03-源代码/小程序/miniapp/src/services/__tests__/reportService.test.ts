/**
 * 报告服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { getCheckinsByDateRange } from '../checkinService'
import { getVaccineRecords } from '../vaccineService'
import { getPetById } from '../petService'
import { generateHealthReport, formatReportAsText } from '../reportService'
import type { HealthReport } from '../reportService'
import type { PetHealthEntry } from '../checkinService'
import type { VaccineRecord } from '../vaccineService'
import type { PetProfile } from '../petService'

vi.mock('../checkinService', () => ({
  getCheckinsByDateRange: vi.fn(),
  getCheckinStats: vi.fn(),
}))

vi.mock('../vaccineService', () => ({
  getVaccineRecords: vi.fn(),
}))

vi.mock('../petService', () => ({
  getPetById: vi.fn(),
}))

vi.mock('../../utils/petOwnership', () => ({
  requirePetOwnership: vi.fn(),
  isPetOwnerLocal: vi.fn(() => true),
}))

const userId = 'user-001'
const petId = 'pet-001'

function makePetProfile(overrides: Partial<PetProfile> = {}): PetProfile {
  return {
    id: petId,
    userId,
    name: '旺财',
    species: 'dog',
    breed: '金毛',
    breedId: 'breed-001',
    gender: 'male',
    birthDate: '2020-06-15',
    weight: 25,
    coatColor: '',
    photos: [],
    isNeutered: false,
    microchipId: '',
    notes: '',
    isDeceased: false,
    allergies: [],
    medications: [],
    chronicConditions: [],
    createdAt: '2020-06-15T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeEntry(overrides: Partial<PetHealthEntry> = {}): PetHealthEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    petId,
    userId,
    poopLevel: 3,
    appetiteLevel: 3,
    spiritLevel: 3,
    exerciseLevel: 2,
    hasAnomaly: false,
    anomalyItems: [],
    riskLevel: 'low',
    createdAt: new Date(),
    ...overrides,
  }
}

function makeVaccineRecord(overrides: Partial<VaccineRecord> = {}): VaccineRecord {
  return {
    id: 'vaccine-001',
    petId,
    type: 'vaccine',
    category: 'DHPP',
    date: '2025-01-10',
    nextDate: '2028-01-10',
    status: 'completed',
    createdAt: '2025-01-10T00:00:00.000Z',
    updatedAt: '2025-01-10T00:00:00.000Z',
    ...overrides,
  }
}

function makeHealthReport(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    title: '旺财 健康报告',
    generatedAt: new Date().toISOString(),
    pet: {
      name: '旺财',
      species: '狗狗',
      breed: '金毛',
      age: '5岁',
      weight: '25kg',
    },
    period: {
      startDate: '2025-05-20',
      endDate: '2025-06-19',
      totalDays: 30,
    },
    checkinStats: {
      totalCheckins: 20,
      checkinRate: '67%',
      normalDays: 18,
      anomalyDays: 2,
      anomalyRate: '10%',
      streakDays: 5,
    },
    healthMetrics: {
      appetite: { normal: 18, decreased: 1, none: 0, increased: 1 },
      spirit: { normal: 19, low: 1, lethargic: 0, high: 0 },
      poop: { normal: 18, soft: 1, diarrhea: 1, constipation: 0, bloody: 0 },
      exercise: { average: 2.0, min: 1, max: 3 },
    },
    anomalies: [],
    vaccines: [],
    riskSummary: {
      emergencyCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      trend: 'stable',
    },
    ...overrides,
  }
}

describe('reportService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateHealthReport', () => {
    /**
     * 同一天补记两条时的天数口径（2026-09-11 新增）
     *
     * 这是本轮 `countUniqueDays` 改动的**回归锁**：旧实现按记录条数算
     * （`normalEntries.length` / `anomalyEntries.length`、`checkinRate = entries.length / days`），
     * 于是"一天补记两条"会让正常+异常天数虚高、打卡率可能超过 100%。
     * 注意既有 24 条用例的 createdAt **互不相同**（条数==天数），新旧实现结果相同，
     * 只有这一条能区分 —— 所以它必须留着。
     */
    it('同一天补记两条时，天数类指标按天去重，打卡率不可能超过 100%', async () => {
      // 构造要点：**同一天有两条"正常"记录** —— 这样"去重前 2 天 / 去重后 1 天"才不同，
      // 用例才真的能区分新旧实现（只有一条时两边都是 1，是无效用例，已用变异验证确认过）。
      // 晚上那条用本地 21:00：东八区按 UTC 口径会被算成次日，正是要防的坑。
      const entries: PetHealthEntry[] = [
        makeEntry({ createdAt: new Date(2026, 5, 20, 9, 0) }),                     // 6/20 正常
        makeEntry({ createdAt: new Date(2026, 5, 20, 21, 0) }),                    // 6/20 第二条正常
        makeEntry({ createdAt: new Date(2026, 5, 21, 10, 0), hasAnomaly: true }),  // 6/21 异常
      ]

      vi.mocked(getPetById).mockResolvedValue(makePetProfile())
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report).not.toBeNull()
      // 「总打卡次数」按次计是 3
      expect(report!.checkinStats.totalCheckins).toBe(3)
      // 但"天数"必须是去重后的：6/20 的两条只算 1 天（旧实现会给出 2）
      expect(report!.checkinStats.normalDays).toBe(1)
      expect(report!.checkinStats.anomalyDays).toBe(1)
      // 打卡天数 2 / 周期 30 天 → 7%（旧实现按 3 条算会得 10%）
      expect(report!.checkinStats.checkinRate).toBe('7%')
    })

    /**
     * 连续打卡按天去重（2026-09-11 新增）
     *
     * 旧实现直接遍历**记录**并维护 expectedDate 游标：同一天补记两条会连续命中两次
     * （第一条 diffDays=0、第二条相对新游标又是 1）→ "连续 2 天"被算成 3 天。
     * 这份数字会写进导出给兽医看的报告，必须钉住。
     */
    it('同一天补记两条时，连续打卡天数按天去重（一天不会被算成两天）', async () => {
      const todayMorning = new Date(); todayMorning.setHours(9, 0, 0, 0)
      const todayNight = new Date(); todayNight.setHours(21, 0, 0, 0)
      const yesterday = new Date(todayMorning.getTime() - 86400000)

      const entries: PetHealthEntry[] = [
        makeEntry({ createdAt: todayMorning }),
        makeEntry({ createdAt: todayNight }),   // 与上一条同一天
        makeEntry({ createdAt: yesterday }),
      ]

      vi.mocked(getPetById).mockResolvedValue(makePetProfile())
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report).not.toBeNull()
      // 今天 + 昨天 = 连续 2 天；旧实现会给出 3
      expect(report!.checkinStats.streakDays).toBe(2)
    })

    it('should generate report with normal data', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = [
        makeEntry({ createdAt: new Date('2025-06-18T10:00:00.000Z') }),
        makeEntry({ createdAt: new Date('2025-06-17T10:00:00.000Z') }),
        makeEntry({ createdAt: new Date('2025-06-16T10:00:00.000Z') }),
      ]
      const vaccines: VaccineRecord[] = [
        makeVaccineRecord(),
      ]

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue(vaccines)

      const report = await generateHealthReport(userId, petId)

      expect(report).not.toBeNull()
      expect(report!.title).toBe('旺财 健康报告')
      expect(report!.pet.name).toBe('旺财')
      expect(report!.pet.species).toBe('狗狗')
      expect(report!.pet.breed).toBe('金毛')
      expect(report!.pet.weight).toBe('25kg')
      expect(report!.checkinStats.totalCheckins).toBe(3)
      expect(report!.checkinStats.normalDays).toBe(3)
      expect(report!.checkinStats.anomalyDays).toBe(0)
      expect(report!.healthMetrics.appetite.normal).toBe(3)
      expect(report!.healthMetrics.spirit.normal).toBe(3)
      expect(report!.healthMetrics.poop.normal).toBe(3)
      expect(report!.vaccines).toHaveLength(1)
      expect(report!.vaccines[0].name).toBe('DHPP')
      expect(report!.vaccines[0].status).toBe('已完成')
      expect(report!.riskSummary.trend).toBe('stable')
      expect(getPetById).toHaveBeenCalledWith(userId, petId)
    })

    it('should return null when pet does not exist', async () => {
      vi.mocked(getPetById).mockResolvedValue(null)

      const report = await generateHealthReport(userId, petId)

      expect(report).toBeNull()
      expect(getPetById).toHaveBeenCalledWith(userId, petId)
      expect(getCheckinsByDateRange).not.toHaveBeenCalled()
      expect(getVaccineRecords).not.toHaveBeenCalled()
    })

    it('should use custom days parameter', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = [
        makeEntry({ createdAt: new Date('2025-06-18T10:00:00.000Z') }),
      ]
      const vaccines: VaccineRecord[] = []

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue(vaccines)

      const report = await generateHealthReport(userId, petId, 7)

      expect(report).not.toBeNull()
      expect(report!.period.totalDays).toBe(7)
      expect(report!.checkinStats.checkinRate).toBe(`${Math.round((1 / 7) * 100)}%`)
      expect(getCheckinsByDateRange).toHaveBeenCalledWith(
        petId,
        userId,
        expect.any(String),
        expect.any(String),
      )
    })

    it('should calculate anomaly stats correctly', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = [
        makeEntry({
          createdAt: new Date('2025-06-18T10:00:00.000Z'),
          hasAnomaly: true,
          anomalyItems: ['poop', 'appetite'],
          riskLevel: 'high',
          poopLevel: 2,
          appetiteLevel: 1,
        }),
        makeEntry({
          createdAt: new Date('2025-06-17T10:00:00.000Z'),
          hasAnomaly: true,
          anomalyItems: ['spirit'],
          riskLevel: 'medium',
          spiritLevel: 1,
        }),
        makeEntry({
          createdAt: new Date('2025-06-16T10:00:00.000Z'),
          hasAnomaly: false,
          anomalyItems: [],
          riskLevel: 'low',
        }),
      ]

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.checkinStats.anomalyDays).toBe(2)
      expect(report!.checkinStats.normalDays).toBe(1)
      expect(report!.anomalies).toHaveLength(2)
      expect(report!.anomalies[0].items).toEqual(['poop', 'appetite'])
      expect(report!.anomalies[0].riskLevel).toBe('high')
      expect(report!.anomalies[1].items).toEqual(['spirit'])
      expect(report!.anomalies[1].riskLevel).toBe('medium')
      expect(report!.riskSummary.highCount).toBe(1)
      expect(report!.riskSummary.mediumCount).toBe(1)
    })

    it('should map cat species correctly', async () => {
      const pet = makePetProfile({ species: 'cat', name: '咪咪', weight: 4.5 })
      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue([])
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.pet.species).toBe('猫咪')
      expect(report!.pet.name).toBe('咪咪')
      expect(report!.pet.weight).toBe('4.5kg')
    })

    it('should handle pet without breed and weight', async () => {
      const pet = makePetProfile({ breed: '', weight: 0, birthDate: '' })
      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue([])
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.pet.breed).toBe('未知')
      expect(report!.pet.weight).toBe('未知')
      expect(report!.pet.age).toBe('未知')
    })

    it('should handle empty checkins', async () => {
      const pet = makePetProfile()
      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue([])
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.checkinStats.totalCheckins).toBe(0)
      expect(report!.checkinStats.checkinRate).toBe('0%')
      expect(report!.checkinStats.anomalyRate).toBe('0%')
      expect(report!.checkinStats.streakDays).toBe(0)
      expect(report!.healthMetrics.exercise.average).toBe(0)
      expect(report!.healthMetrics.exercise.min).toBe(5)
      expect(report!.healthMetrics.exercise.max).toBe(0)
      expect(report!.anomalies).toHaveLength(0)
      expect(report!.riskSummary.trend).toBe('stable')
    })

    it('should map vaccine status correctly', async () => {
      const pet = makePetProfile()
      const vaccines: VaccineRecord[] = [
        makeVaccineRecord({ status: 'completed', category: 'DHPP' }),
        makeVaccineRecord({ status: 'pending', category: 'rabies', id: 'vaccine-002' }),
        makeVaccineRecord({ status: 'overdue', category: 'bordetella', id: 'vaccine-003' }),
      ]

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue([])
      vi.mocked(getVaccineRecords).mockResolvedValue(vaccines)

      const report = await generateHealthReport(userId, petId)

      expect(report!.vaccines).toHaveLength(3)
      expect(report!.vaccines[0].status).toBe('已完成')
      expect(report!.vaccines[1].status).toBe('待接种')
      expect(report!.vaccines[2].status).toBe('已过期')
    })

    it('should limit anomalies and vaccines to 20 items', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = Array.from({ length: 25 }, (_, i) =>
        makeEntry({
          createdAt: new Date(`2025-06-${String(25 - i).padStart(2, '0')}T10:00:00.000Z`),
          hasAnomaly: true,
          anomalyItems: ['poop'],
          riskLevel: 'low',
        }),
      )
      const vaccines: VaccineRecord[] = Array.from({ length: 25 }, (_, i) =>
        makeVaccineRecord({ id: `vaccine-${i}`, category: `Vaccine${i}` }),
      )

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue(vaccines)

      const report = await generateHealthReport(userId, petId)

      expect(report!.anomalies).toHaveLength(20)
      expect(report!.vaccines).toHaveLength(20)
    })

    it('should calculate appetite counts correctly', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = [
        makeEntry({ appetiteLevel: 4, createdAt: new Date('2025-06-18T10:00:00.000Z') }),
        makeEntry({ appetiteLevel: 3, createdAt: new Date('2025-06-17T10:00:00.000Z') }),
        makeEntry({ appetiteLevel: 2, createdAt: new Date('2025-06-16T10:00:00.000Z') }),
        makeEntry({ appetiteLevel: 1, createdAt: new Date('2025-06-15T10:00:00.000Z') }),
        makeEntry({ appetiteLevel: 5, createdAt: new Date('2025-06-14T10:00:00.000Z') }),
      ]

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.healthMetrics.appetite.increased).toBe(2)
      expect(report!.healthMetrics.appetite.normal).toBe(1)
      expect(report!.healthMetrics.appetite.decreased).toBe(1)
      expect(report!.healthMetrics.appetite.none).toBe(1)
    })

    it('should calculate spirit counts correctly', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = [
        makeEntry({ spiritLevel: 4, createdAt: new Date('2025-06-18T10:00:00.000Z') }),
        makeEntry({ spiritLevel: 3, createdAt: new Date('2025-06-17T10:00:00.000Z') }),
        makeEntry({ spiritLevel: 2, createdAt: new Date('2025-06-16T10:00:00.000Z') }),
        makeEntry({ spiritLevel: 1, createdAt: new Date('2025-06-15T10:00:00.000Z') }),
      ]

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.healthMetrics.spirit.high).toBe(1)
      expect(report!.healthMetrics.spirit.normal).toBe(1)
      expect(report!.healthMetrics.spirit.low).toBe(1)
      expect(report!.healthMetrics.spirit.lethargic).toBe(1)
    })

    it('should calculate poop counts correctly', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = [
        makeEntry({ poopLevel: 5, createdAt: new Date('2025-06-18T10:00:00.000Z') }),
        makeEntry({ poopLevel: 4, createdAt: new Date('2025-06-17T10:00:00.000Z') }),
        makeEntry({ poopLevel: 3, createdAt: new Date('2025-06-16T10:00:00.000Z') }),
        makeEntry({ poopLevel: 2, createdAt: new Date('2025-06-15T10:00:00.000Z') }),
        makeEntry({ poopLevel: 1, createdAt: new Date('2025-06-14T10:00:00.000Z') }),
      ]

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.healthMetrics.poop.constipation).toBe(1)
      expect(report!.healthMetrics.poop.soft).toBe(1)
      expect(report!.healthMetrics.poop.normal).toBe(1)
      expect(report!.healthMetrics.poop.diarrhea).toBe(1)
      expect(report!.healthMetrics.poop.bloody).toBe(1)
    })

    it('should calculate exercise stats correctly', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = [
        makeEntry({ exerciseLevel: 3, createdAt: new Date('2025-06-18T10:00:00.000Z') }),
        makeEntry({ exerciseLevel: 1, createdAt: new Date('2025-06-17T10:00:00.000Z') }),
        makeEntry({ exerciseLevel: 2, createdAt: new Date('2025-06-16T10:00:00.000Z') }),
      ]

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.healthMetrics.exercise.average).toBe(2.0)
      expect(report!.healthMetrics.exercise.min).toBe(1)
      expect(report!.healthMetrics.exercise.max).toBe(3)
    })

    it('should calculate risk trend as declining', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = Array.from({ length: 8 }, (_, i) =>
        makeEntry({
          createdAt: new Date(`2025-06-${String(20 - i).padStart(2, '0')}T10:00:00.000Z`),
          hasAnomaly: i < 5,
          anomalyItems: i < 5 ? ['poop'] : [],
          riskLevel: i < 5 ? 'high' : 'low',
        }),
      )

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.riskSummary.trend).toBe('declining')
    })

    it('should calculate risk trend as improving', async () => {
      const pet = makePetProfile()
      const entries: PetHealthEntry[] = Array.from({ length: 8 }, (_, i) =>
        makeEntry({
          createdAt: new Date(`2025-06-${String(20 - i).padStart(2, '0')}T10:00:00.000Z`),
          hasAnomaly: i >= 5,
          anomalyItems: i >= 5 ? ['poop'] : [],
          riskLevel: i >= 5 ? 'medium' : 'low',
        }),
      )

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue(entries)
      vi.mocked(getVaccineRecords).mockResolvedValue([])

      const report = await generateHealthReport(userId, petId)

      expect(report!.riskSummary.trend).toBe('improving')
    })

    it('should include vaccine nextDue when available', async () => {
      const pet = makePetProfile()
      const vaccines: VaccineRecord[] = [
        makeVaccineRecord({ nextDate: '2028-01-10' }),
        makeVaccineRecord({ id: 'vaccine-002', nextDate: '', category: 'rabies' }),
      ]

      vi.mocked(getPetById).mockResolvedValue(pet)
      vi.mocked(getCheckinsByDateRange).mockResolvedValue([])
      vi.mocked(getVaccineRecords).mockResolvedValue(vaccines)

      const report = await generateHealthReport(userId, petId)

      expect(report!.vaccines[0].nextDue).toBe('2028-01-10')
      expect(report!.vaccines[1].nextDue).toBeUndefined()
    })
  })

  describe('formatReportAsText', () => {
    it('should format report as text with basic data', () => {
      const report = makeHealthReport()

      const text = formatReportAsText(report)

      expect(text).toContain('旺财 健康报告')
      expect(text).toContain('宠物名称: 旺财')
      expect(text).toContain('品种: 金毛')
      expect(text).toContain('物种: 狗狗')
      expect(text).toContain('年龄: 5岁')
      expect(text).toContain('体重: 25kg')
      expect(text).toContain('总打卡次数: 20')
      expect(text).toContain('打卡率: 67%')
      expect(text).toContain('正常天数: 18')
      expect(text).toContain('异常天数: 2')
      expect(text).toContain('异常率: 10%')
      expect(text).toContain('连续打卡: 5 天')
      expect(text).toContain('食欲: 正常18次')
      expect(text).toContain('精神: 正常19次')
      expect(text).toContain('便便: 正常18次')
      expect(text).toContain('运动: 平均2分')
      expect(text).toContain('紧急: 0次')
      expect(text).toContain('高风险: 0次')
      expect(text).toContain('中风险: 0次')
      expect(text).toContain('低风险: 0次')
      expect(text).toContain('趋势: 稳定')
      expect(text).toContain('团团 · 星河宠记 AI 宠物管家')
    })

    it('should display anomaly records when present', () => {
      const report = makeHealthReport({
        anomalies: [
          { date: '2025-06-15', items: ['便便异常', '食欲减退'], riskLevel: 'high' },
          { date: '2025-06-10', items: ['精神低落'], riskLevel: 'medium' },
        ],
        riskSummary: {
          emergencyCount: 0,
          highCount: 1,
          mediumCount: 1,
          lowCount: 0,
          trend: 'declining',
        },
      })

      const text = formatReportAsText(report)

      expect(text).toContain('🔍 异常记录')
      expect(text).toContain('2025-06-15: 便便异常、食欲减退 (high)')
      expect(text).toContain('2025-06-10: 精神低落 (medium)')
      expect(text).toContain('高风险: 1次')
      expect(text).toContain('中风险: 1次')
      expect(text).toContain('趋势: 需关注')
    })

    it('should display vaccine records when present', () => {
      const report = makeHealthReport({
        vaccines: [
          { name: 'DHPP', date: '2025-01-10', status: '已完成', nextDue: '2028-01-10' },
          { name: 'rabies', date: '2025-03-15', status: '待接种' },
        ],
      })

      const text = formatReportAsText(report)

      expect(text).toContain('💉 疫苗记录')
      expect(text).toContain('DHPP: 2025-01-10 (已完成) → 下次: 2028-01-10')
      expect(text).toContain('rabies: 2025-03-15 (待接种)')
    })

    it('should not display anomaly section when empty', () => {
      const report = makeHealthReport({ anomalies: [] })

      const text = formatReportAsText(report)

      expect(text).not.toContain('🔍 异常记录')
    })

    it('should not display vaccine section when empty', () => {
      const report = makeHealthReport({ vaccines: [] })

      const text = formatReportAsText(report)

      expect(text).not.toContain('💉 疫苗记录')
    })

    it('should display improving trend label', () => {
      const report = makeHealthReport({
        riskSummary: {
          emergencyCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 1,
          trend: 'improving',
        },
      })

      const text = formatReportAsText(report)

      expect(text).toContain('趋势: 好转中')
    })

    it('should display stable trend label', () => {
      const report = makeHealthReport({
        riskSummary: {
          emergencyCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          trend: 'stable',
        },
      })

      const text = formatReportAsText(report)

      expect(text).toContain('趋势: 稳定')
    })

    it('should display declining trend label', () => {
      const report = makeHealthReport({
        riskSummary: {
          emergencyCount: 1,
          highCount: 2,
          mediumCount: 3,
          lowCount: 4,
          trend: 'declining',
        },
      })

      const text = formatReportAsText(report)

      expect(text).toContain('趋势: 需关注')
      expect(text).toContain('紧急: 1次')
      expect(text).toContain('高风险: 2次')
      expect(text).toContain('中风险: 3次')
      expect(text).toContain('低风险: 4次')
    })
  })
})
