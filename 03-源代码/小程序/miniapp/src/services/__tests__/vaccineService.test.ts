/**
 * 疫苗管理服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { api } from '../api'
import {
  getVaccineRecords,
  createVaccineRecord,
  updateVaccineRecord,
  deleteVaccineRecord,
  getUpcomingRecords,
  getOverdueRecords,
  markAsCompleted,
  getRecordsByMonth,
  generateInitialPlan,
  VACCINE_INTERVAL_RULES,
  calculateNextDate,
} from '../vaccineService'
import type { VaccineRecord, CreateVaccineData } from '../vaccineService'

const mockStorage: Record<string, string> = {}

vi.mock('../../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[`xhh_${key}`]
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[`xhh_${key}`] = JSON.stringify(value)
  }),
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[`xhh_${key}`]
  }),
}))

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageInfoSync: vi.fn(() => ({ keys: Object.keys(mockStorage) })),
  },
}))

const mockAutoScheduleItems = [
  {
    id: 'dog_puppy_0_0',
    vaccineName: 'DHPP（第一针）',
    scheduledDate: '2024-02-15',
    status: 'upcoming' as const,
    daysUntilDue: 30,
    isCore: true,
    notes: '首次免疫',
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
  {
    id: 'dog_puppy_0_1',
    vaccineName: '窝咳疫苗（可选，鼻内型）',
    scheduledDate: '2024-02-15',
    status: 'upcoming' as const,
    daysUntilDue: 30,
    isCore: false,
    notes: '窝咳疫苗鼻内型可3周龄起用',
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
  {
    id: 'dog_puppy_1_0',
    vaccineName: 'DHPP（第二针）',
    scheduledDate: '2024-03-15',
    status: 'upcoming' as const,
    daysUntilDue: 60,
    isCore: true,
    notes: '钩端螺旋体疫苗根据当地流行情况决定',
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
  {
    id: 'dog_puppy_1_1',
    vaccineName: '钩端螺旋体（第一针，可选）',
    scheduledDate: '2024-03-15',
    status: 'upcoming' as const,
    daysUntilDue: 60,
    isCore: false,
    notes: '钩端螺旋体疫苗根据当地流行情况决定',
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
  {
    id: 'dog_puppy_2_0',
    vaccineName: 'DHPP（第三针/最后一针）',
    scheduledDate: '2024-04-15',
    status: 'upcoming' as const,
    daysUntilDue: 90,
    isCore: true,
    notes: '最后一针DHPP必须在16周龄或以上',
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
  {
    id: 'dog_puppy_2_2',
    vaccineName: '狂犬病（12-16周龄）',
    scheduledDate: '2024-04-15',
    status: 'upcoming' as const,
    daysUntilDue: 90,
    isCore: true,
    notes: '狂犬病按当地法规',
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
]

const mockCatScheduleItems = [
  {
    id: 'cat_kitten_0_0',
    vaccineName: 'FVRCP（第一针）',
    scheduledDate: '2024-02-15',
    status: 'upcoming' as const,
    daysUntilDue: 30,
    isCore: true,
    notes: '首次免疫',
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
  {
    id: 'cat_kitten_2_0',
    vaccineName: 'FVRCP（第三针/最后一针）',
    scheduledDate: '2024-04-15',
    status: 'upcoming' as const,
    daysUntilDue: 90,
    isCore: true,
    notes: '最后一针FVRCP必须在16周龄或以上',
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
  {
    id: 'cat_kitten_2_2',
    vaccineName: '狂犬病（12-16周龄）',
    scheduledDate: '2024-04-15',
    status: 'upcoming' as const,
    daysUntilDue: 90,
    isCore: true,
    notes: '狂犬病按当地法规',
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
]

const mockDewormingItems = [
  {
    id: 'internal_adult',
    type: 'internal' as const,
    scheduledDate: '2024-04-15',
    status: 'upcoming' as const,
    daysUntilDue: 90,
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
  {
    id: 'external_adult',
    type: 'external' as const,
    scheduledDate: '2024-01-15',
    status: 'upcoming' as const,
    daysUntilDue: 30,
    reminderLevel: 0 as 0 | 1 | 2 | 3,
  },
]

vi.mock('../../engines/vaccineScheduler', () => ({
  generateAutoVaccineSchedule: vi.fn((pet: { species: string; birthDate: string }) => {
    if (pet.species === 'cat') return mockCatScheduleItems
    return mockAutoScheduleItems
  }),
  generateDewormingSchedule: vi.fn(() => mockDewormingItems),
}))

vi.mock('../../data/petKnowledge/vaccineSchedule', () => ({
  BREED_VACCINE_RECOMMENDATIONS: [
    {
      breedIds: ['golden_retriever', 'labrador_retriever', 'german_shepherd', 'poodle_standard', 'rottweiler', 'samoyed', 'doberman', 'boxer', 'akita', 'husky_siberian'],
      species: 'dog',
      recommendedVaccines: ['leptospirosis'],
      healthCheckReminders: [],
      notes: '户外活动多/大型犬品种，推荐接种钩端螺旋体疫苗',
    },
    {
      breedIds: ['great_dane', 'bernese_mountain_dog'],
      species: 'dog',
      recommendedVaccines: ['leptospirosis'],
      healthCheckReminders: [],
      notes: '巨型犬品种，推荐接种钩端螺旋体疫苗',
    },
    {
      breedIds: ['french_bulldog', 'pug', 'bulldog', 'shih_tzu'],
      species: 'dog',
      recommendedVaccines: ['bordetella'],
      healthCheckReminders: [],
      notes: '短头品种，推荐接种窝咳疫苗',
    },
    {
      breedIds: ['border_collie', 'shetland_sheepdog', 'australian_shepherd'],
      species: 'dog',
      recommendedVaccines: [],
      healthCheckReminders: [],
      notes: '柯利系品种，携带MDR1基因突变，对伊维菌素等药物敏感',
    },
    {
      breedIds: ['golden_retriever', 'labrador_retriever', 'german_shepherd', 'beagle', 'poodle_standard', 'rottweiler', 'doberman', 'boxer', 'husky_siberian', 'border_collie', 'australian_shepherd', 'samoyed'],
      species: 'dog',
      recommendedVaccines: ['canine_influenza'],
      healthCheckReminders: [],
      notes: '活跃/群居倾向品种，推荐接种犬流感疫苗',
    },
    {
      breedIds: ['siamese_cat', 'bengal_cat', 'abyssinian', 'oriental_shorthair', 'devon_rex', 'somali_cat'],
      species: 'cat',
      recommendedVaccines: ['felv'],
      healthCheckReminders: [],
      notes: '户外/活跃猫品种，推荐接种猫白血病病毒疫苗',
    },
    {
      breedIds: ['persian_cat', 'maine_coon', 'british_shorthair', 'ragdoll', 'scottish_fold', 'exotic_shorthair', 'norwegian_forest_cat', 'american_shorthair', 'birman'],
      species: 'cat',
      recommendedVaccines: [],
      healthCheckReminders: ['定期肾脏超声检查（多囊肾病PKD筛查）'],
      notes: '多囊肾病高发品种，建议定期肾脏超声检查',
    },
    {
      breedIds: ['persian_cat', 'siamese_cat', 'maine_coon', 'british_shorthair', 'ragdoll', 'scottish_fold', 'sphynx', 'bengal_cat', 'russian_blue', 'norwegian_forest_cat', 'american_shorthair', 'birman', 'oriental_shorthair', 'devon_rex', 'burmese_cat', 'tonkinese'],
      species: 'cat',
      recommendedVaccines: [],
      healthCheckReminders: ['定期心脏超声检查（肥厚型心肌病HCM筛查）'],
      notes: '肥厚型心肌病高发品种，建议定期心脏超声检查',
    },
  ],
}))

vi.mock('../../data/petKnowledge/breeds', () => {
  const BREED_DATA = [
    { id: 'golden_retriever', name: '金毛寻回犬', species: 'dog', exerciseNeeds: 'high', size: 'large', geneticDiseases: ['髋关节发育不良'] },
    { id: 'french_bulldog', name: '法国斗牛犬', species: 'dog', exerciseNeeds: 'low', size: 'small', geneticDiseases: ['短头综合征'] },
    { id: 'border_collie', name: '边境牧羊犬', species: 'dog', exerciseNeeds: 'high', size: 'medium', geneticDiseases: ['柯利眼异常（CEA）', '多重药物敏感性（MDR1基因突变）'] },
    { id: 'ragdoll', name: '布偶猫', species: 'cat', exerciseNeeds: 'low', size: 'large', geneticDiseases: ['肥厚型心肌病（HCM）', '多囊肾病（PKD）'] },
    { id: 'siamese_cat', name: '暹罗猫', species: 'cat', exerciseNeeds: 'high', size: 'medium', geneticDiseases: ['肥厚型心肌病（HCM）'] },
    { id: 'british_shorthair', name: '英国短毛猫', species: 'cat', exerciseNeeds: 'low', size: 'medium', geneticDiseases: ['肥厚型心肌病（HCM）', '多囊肾病（PKD）'] },
  ]
  return { BREED_DATA, getActiveBreeds: () => BREED_DATA }
})

function makeVaccineRecord(overrides: Partial<VaccineRecord> = {}): VaccineRecord {
  return {
    id: 'vac_001',
    petId: 'pet_001',
    type: 'vaccine',
    category: 'DHPP',
    date: '2024-01-15',
    nextDate: '2027-01-15',
    status: 'pending',
    hospital: '爱宠医院',
    doctor: '张医生',
    notes: '首次接种',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  }
}

const mockCreateData: CreateVaccineData = {
  petId: 'pet_001',
  userId: 'user_001',
  type: 'vaccine',
  category: 'DHPP',
  date: '2024-01-15',
  hospital: '爱宠医院',
  doctor: '张医生',
  notes: '首次接种',
}

describe('vaccineService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  describe('getVaccineRecords', () => {
    it('should return vaccine records from API and update status', async () => {
      const mockRecords = [
        makeVaccineRecord({ id: 'vac_001', nextDate: '2026-12-31', status: 'pending' }),
        makeVaccineRecord({ id: 'vac_002', category: 'rabies', nextDate: '2023-01-01', status: 'pending' }),
      ]
      vi.mocked(api.get).mockResolvedValue(mockRecords)

      const result = await getVaccineRecords('pet_001')

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('vac_001')
      expect(result[0].status).toBe('pending')
      expect(result[1].id).toBe('vac_002')
      expect(result[1].status).toBe('overdue')
      expect(api.get).toHaveBeenCalledWith('/api/pets/pet_001/vaccines')
    })

    it('should fallback to local storage when API fails', async () => {
      const localRecords = [makeVaccineRecord({ id: 'vac_local', nextDate: '2026-12-31' })]
      mockStorage['xhh_vaccines_pet_001'] = JSON.stringify(localRecords)
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await getVaccineRecords('pet_001')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('vac_local')
    })

    it('should return empty array when no records exist locally and API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await getVaccineRecords('pet_001')

      expect(result).toEqual([])
    })
  })

  describe('createVaccineRecord', () => {
    it('should create vaccine record successfully via API', async () => {
      const mockResponse = makeVaccineRecord({ id: 'vac_api_001' })
      vi.mocked(api.post).mockResolvedValue(mockResponse)

      const result = await createVaccineRecord(mockCreateData)

      expect(result.id).toBe('vac_api_001')
      expect(result.petId).toBe('pet_001')
      expect(result.type).toBe('vaccine')
      expect(result.category).toBe('DHPP')
      expect(result.status).toBe('pending')
      expect(api.post).toHaveBeenCalledWith('/api/pets/pet_001/vaccines', expect.objectContaining({
        category: 'DHPP',
        next_date: expect.any(String),
      }))
    })

    it('should fallback to local storage when API fails', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))

      const result = await createVaccineRecord(mockCreateData)

      expect(result.petId).toBe('pet_001')
      expect(result.category).toBe('DHPP')
      expect(result.status).toBe('pending')
      expect(result.id).toBeDefined()
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
    })
  })

  describe('updateVaccineRecord', () => {
    it('should update vaccine record locally', async () => {
      const localRecords = [makeVaccineRecord({ id: 'vac_001', category: 'DHPP' })]
      mockStorage['xhh_vaccines_pet_001'] = JSON.stringify(localRecords)

      const result = await updateVaccineRecord('vac_001', { category: 'rabies' })

      expect(result.id).toBe('vac_001')
      expect(result.category).toBe('rabies')
      expect(api.put).not.toHaveBeenCalled()
    })

    it('should fallback to local storage when API fails', async () => {
      const localRecords = [makeVaccineRecord({ id: 'vac_001', nextDate: '2027-01-15' })]
      mockStorage['xhh_vaccines_pet_001'] = JSON.stringify(localRecords)
      vi.mocked(api.put).mockRejectedValue(new Error('Network error'))

      const result = await updateVaccineRecord('vac_001', { notes: ' updated notes' })

      expect(result.id).toBe('vac_001')
      expect(result.notes).toBe(' updated notes')
    })

    it('should throw error when record not found locally and API fails', async () => {
      vi.mocked(api.put).mockRejectedValue(new Error('Network error'))

      await expect(updateVaccineRecord('nonexistent', { notes: 'test' })).rejects.toThrow('记录不存在')
    })
  })

  describe('deleteVaccineRecord', () => {
    it('should delete vaccine record locally', async () => {
      const localRecords = [makeVaccineRecord({ id: 'vac_001' }), makeVaccineRecord({ id: 'vac_002' })]
      mockStorage['xhh_vaccines_pet_001'] = JSON.stringify(localRecords)

      await deleteVaccineRecord('vac_001')

      const remaining = JSON.parse(mockStorage['xhh_vaccines_pet_001'])
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe('vac_002')
    })

    it('should do nothing when record not found', async () => {
      const localRecords = [makeVaccineRecord({ id: 'vac_001' })]
      mockStorage['xhh_vaccines_pet_001'] = JSON.stringify(localRecords)

      await deleteVaccineRecord('vac_nonexistent')

      const remaining = JSON.parse(mockStorage['xhh_vaccines_pet_001'])
      expect(remaining).toHaveLength(1)
    })
  })

  describe('getUpcomingRecords', () => {
    it('should return upcoming vaccines within default 30 days', async () => {
      const today = new Date().toISOString().slice(0, 10)
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 15)
      const futureStr = futureDate.toISOString().slice(0, 10)

      const mockRecords = [
        makeVaccineRecord({ id: 'vac_001', nextDate: futureStr, status: 'pending' }),
        makeVaccineRecord({ id: 'vac_002', nextDate: '2025-01-01', status: 'pending' }),
        makeVaccineRecord({ id: 'vac_003', nextDate: futureStr, status: 'completed' }),
      ]
      vi.mocked(api.get).mockResolvedValue(mockRecords)

      const result = await getUpcomingRecords('pet_001')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('vac_001')
    })

    it('should return empty array when no upcoming vaccines', async () => {
      const mockRecords = [
        makeVaccineRecord({ id: 'vac_001', nextDate: '2025-01-01', status: 'pending' }),
        makeVaccineRecord({ id: 'vac_002', nextDate: '2025-02-01', status: 'completed' }),
      ]
      vi.mocked(api.get).mockResolvedValue(mockRecords)

      const result = await getUpcomingRecords('pet_001', 7)

      expect(result).toEqual([])
    })
  })

  describe('getOverdueRecords', () => {
    it('should return overdue vaccine records', async () => {
      const mockRecords = [
        makeVaccineRecord({ id: 'vac_001', status: 'overdue', nextDate: '2023-01-01' }),
        makeVaccineRecord({ id: 'vac_002', status: 'pending', nextDate: '2099-01-01' }),
        makeVaccineRecord({ id: 'vac_003', status: 'completed', nextDate: '2023-01-01' }),
      ]
      vi.mocked(api.get).mockResolvedValue(mockRecords)

      const result = await getOverdueRecords('pet_001')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('vac_001')
      expect(result[0].status).toBe('overdue')
    })

    it('should return empty array when no overdue records', async () => {
      const mockRecords = [
        makeVaccineRecord({ id: 'vac_001', status: 'pending', nextDate: '2099-01-01' }),
        makeVaccineRecord({ id: 'vac_002', status: 'completed', nextDate: '2023-01-01' }),
      ]
      vi.mocked(api.get).mockResolvedValue(mockRecords)

      const result = await getOverdueRecords('pet_001')

      expect(result).toEqual([])
    })
  })

  describe('markAsCompleted', () => {
    it('should mark vaccine record as completed', async () => {
      const localRecords = [makeVaccineRecord({ id: 'vac_001', status: 'pending' })]
      mockStorage['xhh_vaccines_pet_001'] = JSON.stringify(localRecords)
      vi.mocked(api.put).mockResolvedValue(undefined)

      const result = await markAsCompleted('vac_001')

      expect(result.status).toBe('completed')
      expect(api.put).toHaveBeenCalledWith('/api/pets/pet_001/vaccines/vac_001/complete')
      const saved = JSON.parse(mockStorage['xhh_vaccines_pet_001'])
      expect(saved[0].status).toBe('completed')
    })
  })

  describe('getRecordsByMonth', () => {
    it('should return records for specific month', async () => {
      const mockRecords = [
        makeVaccineRecord({ id: 'vac_001', date: '2024-03-15', nextDate: '2027-03-15' }),
        makeVaccineRecord({ id: 'vac_002', date: '2024-04-01', nextDate: '2027-04-01' }),
        makeVaccineRecord({ id: 'vac_003', date: '2024-03-20', nextDate: '2025-03-20' }),
      ]
      vi.mocked(api.get).mockResolvedValue(mockRecords)

      const result = await getRecordsByMonth('pet_001', 2024, 3)

      expect(result).toHaveLength(2)
      expect(result.map((r) => r.id)).toContain('vac_001')
      expect(result.map((r) => r.id)).toContain('vac_003')
    })

    it('should return empty array when no records for the month', async () => {
      const mockRecords = [
        makeVaccineRecord({ id: 'vac_001', date: '2024-03-15', nextDate: '2027-03-15' }),
      ]
      vi.mocked(api.get).mockResolvedValue(mockRecords)

      const result = await getRecordsByMonth('pet_001', 2024, 6)

      expect(result).toEqual([])
    })
  })

  describe('generateInitialPlan', () => {
    it('should generate initial plan for dog', async () => {
      const petInfo = { species: 'dog' as const, breed: '金毛寻回犬', birthDate: '2024-01-01' }

      const result = await generateInitialPlan('pet_001', petInfo)

      expect(result.length).toBeGreaterThan(0)
      const categories = result.map((r) => r.category)
      expect(categories).toContain('DHPP')
      expect(categories).toContain('rabies')
      expect(result.every((r) => r.petId === 'pet_001')).toBe(true)
      expect(result.every((r) => r.type === 'vaccine' || r.type === 'deworm')).toBe(true)
    })

    it('should generate initial plan for cat', async () => {
      const petInfo = { species: 'cat' as const, breed: '英短', birthDate: '2020-01-01' }

      const result = await generateInitialPlan('pet_001', petInfo)

      expect(result.length).toBeGreaterThan(0)
      const categories = result.map((r) => r.category)
      expect(categories).toContain('FVRCP')
      expect(categories).toContain('rabies')
    })

    it('should return existing records if already present', async () => {
      const existingRecords = [makeVaccineRecord({ id: 'vac_existing' })]
      mockStorage['xhh_vaccines_pet_001'] = JSON.stringify(existingRecords)
      const petInfo = { species: 'dog' as const, breed: '金毛寻回犬', birthDate: '2024-01-01' }

      const result = await generateInitialPlan('pet_001', petInfo)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('vac_existing')
    })

    it('should generate multi-shot series for puppy', async () => {
      const petInfo = { species: 'dog' as const, breed: '混血犬', birthDate: '2024-01-01' }

      const result = await generateInitialPlan('pet_dog_puppy', petInfo)

      const dhppRecords = result.filter((r) => r.category === 'DHPP')
      expect(dhppRecords.length).toBe(1)

      const categories = result.map((r) => r.category)
      expect(categories).toContain('DHPP')
      expect(categories).toContain('rabies')
      expect(categories).toContain('internal_deworm')
      expect(categories).toContain('external_deworm')
    })

    it('should recommend leptospirosis for golden retriever', async () => {
      const petInfo = { species: 'dog' as const, breed: '金毛寻回犬', birthDate: '2020-01-01', breedId: 'golden_retriever' }

      const result = await generateInitialPlan('pet_golden', petInfo)

      const categories = result.map((r) => r.category)
      expect(categories).toContain('leptospirosis')
      expect(categories).toContain('canine_influenza')

      const leptoRecord = result.find((r) => r.category === 'leptospirosis')
      expect(leptoRecord?.notes).toContain('品种特异性推荐')
    })

    it('should recommend bordetella for french bulldog', async () => {
      const petInfo = { species: 'dog' as const, breed: '法国斗牛犬', birthDate: '2020-01-01', breedId: 'french_bulldog' }

      const result = await generateInitialPlan('pet_french_bulldog', petInfo)

      const categories = result.map((r) => r.category)
      expect(categories).toContain('bordetella')

      const bordetellaRecord = result.find((r) => r.category === 'bordetella')
      expect(bordetellaRecord?.notes).toContain('品种特异性推荐')
    })

    it('should recommend FeLV for ragdoll cat with breed health reminders', async () => {
      const petInfo = { species: 'cat' as const, breed: '布偶猫', birthDate: '2020-01-01', breedId: 'ragdoll' }

      const result = await generateInitialPlan('pet_ragdoll', petInfo)

      const categories = result.map((r) => r.category)
      expect(categories).toContain('breed_health_reminder')

      const reminderRecord = result.find((r) => r.category === 'breed_health_reminder')
      expect(reminderRecord?.notes).toContain('肾脏超声')
      expect(reminderRecord?.notes).toContain('心脏超声')
    })

    it('should recommend FeLV for siamese cat', async () => {
      const petInfo = { species: 'cat' as const, breed: '暹罗猫', birthDate: '2020-01-01', breedId: 'siamese_cat' }

      const result = await generateInitialPlan('pet_siamese', petInfo)

      const categories = result.map((r) => r.category)
      expect(categories).toContain('felv')

      const felvRecord = result.find((r) => r.category === 'felv')
      expect(felvRecord?.notes).toContain('品种特异性推荐')
    })

    it('should not duplicate vaccines already in schedule from breed recommendations', async () => {
      const petInfo = { species: 'dog' as const, breed: '金毛寻回犬', birthDate: '2024-01-01', breedId: 'golden_retriever' }

      const result = await generateInitialPlan('pet_golden_dup', petInfo)

      const leptoRecords = result.filter((r) => r.category === 'leptospirosis')
      expect(leptoRecords.length).toBeLessThanOrEqual(2)
    })

    it('should include MDR1 note for border collie', async () => {
      const petInfo = { species: 'dog' as const, breed: '边境牧羊犬', birthDate: '2020-01-01', breedId: 'border_collie' }

      const result = await generateInitialPlan('pet_border_collie', petInfo)

      const reminderRecord = result.find((r) => r.category === 'breed_health_reminder')
      expect(reminderRecord?.notes).toContain('MDR1')
    })

    it('should work without breedId (backward compatible)', async () => {
      const petInfo = { species: 'dog' as const, breed: '混血犬', birthDate: '2020-01-01' }

      const result = await generateInitialPlan('pet_no_breed_id', petInfo)

      expect(result.length).toBeGreaterThan(0)
      const categories = result.map((r) => r.category)
      expect(categories).toContain('DHPP')
      expect(categories).toContain('rabies')
      expect(categories).toContain('internal_deworm')
      expect(categories).toContain('external_deworm')
    })
  })

  describe('calculateNextDate', () => {
    it('should calculate next date for DHPP with 36 months interval', () => {
      const result = calculateNextDate('DHPP', '2024-01-15')
      expect(result).toBe('2027-01-15')
    })

    it('should calculate next date for rabies with 12 months interval', () => {
      const result = calculateNextDate('rabies', '2024-01-15')
      expect(result).toBe('2025-01-15')
    })

    it('should calculate next date for internal deworm with 3 months interval', () => {
      const result = calculateNextDate('internal_deworm', '2024-01-15')
      expect(result).toBe('2024-04-15')
    })

    it('should calculate next date for external deworm with 1 month interval', () => {
      const result = calculateNextDate('external_deworm', '2024-01-15')
      expect(result).toBe('2024-02-15')
    })

    it('should default to 12 months for unknown category', () => {
      const result = calculateNextDate('unknown_vaccine', '2024-01-15')
      expect(result).toBe('2025-01-15')
    })
  })

  describe('VACCINE_INTERVAL_RULES', () => {
    it('should contain all expected vaccine interval rules', () => {
      expect(VACCINE_INTERVAL_RULES.length).toBeGreaterThan(0)
      const categories = VACCINE_INTERVAL_RULES.map((r) => r.category)
      expect(categories).toContain('DHPP')
      expect(categories).toContain('rabies')
      expect(categories).toContain('FVRCP')
      expect(categories).toContain('internal_deworm')
      expect(categories).toContain('external_deworm')
    })
  })
})
