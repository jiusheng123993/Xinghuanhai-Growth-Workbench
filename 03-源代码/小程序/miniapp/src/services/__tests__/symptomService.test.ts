/**
 * 症状查询服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { api } from '../api'
import {
  analyzeSymptoms,
  getCheckHistory,
  getCheckResult,
  getSymptomCategories,
  getSymptomsByCategory,
  searchSymptoms,
} from '../symptomService'
import type { SymptomCheckResult } from '../symptomService'
import type { PetProfile } from '../petService'

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

function makeSymptomCheckResult(overrides: Partial<SymptomCheckResult> = {}): SymptomCheckResult {
  return {
    id: 'sym_001',
    petId: 'pet_001',
    symptoms: ['cough'],
    riskLevel: 'caution',
    possibleConditions: ['呼吸道感染'],
    aiAdvice: '建议观察',
    recommendedActions: ['持续观察'],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makePetProfile(overrides: Partial<PetProfile> = {}): PetProfile {
  return {
    id: 'pet_001',
    userId: 'user_001',
    name: '旺财',
    species: 'dog',
    breed: '金毛寻回犬',
    breedId: 'golden_retriever',
    gender: 'male',
    birthDate: '2020-01-01',
    weight: 30,
    coatColor: '金色',
    photos: [],
    isNeutered: false,
    microchipId: '',
    notes: '',
    isDeceased: false,
    allergies: [],
    medications: [],
    chronicConditions: [],
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('symptomService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  describe('analyzeSymptoms', () => {
    it('should return result and save locally when API succeeds', async () => {
      const mockResult = makeSymptomCheckResult({
        id: 'sym_api_001',
        symptoms: ['cough'],
        riskLevel: 'caution',
      })
      vi.mocked(api.post).mockResolvedValue(mockResult)

      const result = await analyzeSymptoms('pet_001', ['cough'])

      expect(result.riskLevel).toBe('caution')
      expect(result.symptoms).toEqual(['cough'])
      expect(api.post).toHaveBeenCalledWith('/api/pets/pet_001/symptom-check', expect.any(Object))
    })

    it('should fallback to local engine when API fails', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))

      const result = await analyzeSymptoms('pet_001', ['cough'])

      expect(result.riskLevel).toBe('caution')
      expect(result.symptoms).toEqual(['cough'])
      expect(result.id).toBeDefined()
      expect(result.createdAt).toBeDefined()
    })

    it('should return emergency level for critical symptoms like dyspnea', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))

      const result = await analyzeSymptoms('pet_001', ['dyspnea'])

      expect(result.riskLevel).toBe('emergency')
      expect(result.aiAdvice).toContain('紧急')
    })

    it('should return normal level for minor symptoms', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))

      const result = await analyzeSymptoms('pet_001', ['nystagmus'])

      expect(result.riskLevel).toBe('normal')
    })

    it('should upgrade to emergency for vomiting + diarrhea combo', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))

      const result = await analyzeSymptoms('pet_001', ['vomiting', 'diarrhea'])

      expect(result.riskLevel).toBe('emergency')
      expect(result.aiAdvice).toContain('紧急')
    })
  })

  describe('getCheckHistory', () => {
    it('should return history list when API succeeds', async () => {
      const mockHistory = [
        makeSymptomCheckResult({ id: 'sym_001', symptoms: ['cough'] }),
        makeSymptomCheckResult({ id: 'sym_002', symptoms: ['sneeze'] }),
      ]
      vi.mocked(api.get).mockResolvedValue({ list: mockHistory, total: 2, page: 1, pageSize: 20 })

      const result = await getCheckHistory('pet_001')

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('sym_001')
      expect(result[1].id).toBe('sym_002')
      expect(api.get).toHaveBeenCalledWith('/api/pets/pet_001/symptom-check/history', { page: '1', page_size: '50' })
    })

    it('should fallback to local storage when API fails', async () => {
      const localHistory = [
        makeSymptomCheckResult({ id: 'sym_local_001', symptoms: ['cough'] }),
      ]
      mockStorage['xhh_symptom_checks_pet_001'] = JSON.stringify(localHistory)
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await getCheckHistory('pet_001')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('sym_local_001')
    })

    it('should return empty array when no history exists', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      const result = await getCheckHistory('pet_001')

      expect(result).toEqual([])
    })
  })

  describe('getCheckResult', () => {
    it('should return result when API succeeds', async () => {
      const mockResult = makeSymptomCheckResult({ id: 'sym_001' })
      vi.mocked(api.get).mockResolvedValue(mockResult)

      const result = await getCheckResult('sym_001')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('sym_001')
      expect(api.get).toHaveBeenCalledWith('/api/symptom-checks/sym_001')
    })

    it('should return null when API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Not found'))

      const result = await getCheckResult('sym_nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('getSymptomCategories', () => {
    it('should return all categories when no species filter', () => {
      const result = getSymptomCategories()

      expect(result.length).toBeGreaterThan(0)
      expect(result[0].symptoms.length).toBeGreaterThan(0)
    })

    it('should filter categories by species', () => {
      const result = getSymptomCategories('cat')

      expect(result.length).toBeGreaterThan(0)
      for (const cat of result) {
        for (const symptom of cat.symptoms) {
          expect(symptom.species).toContain('cat')
        }
      }
    })
  })

  describe('getSymptomsByCategory', () => {
    it('should return symptoms for existing category', () => {
      const result = getSymptomsByCategory('digestive')

      expect(result.length).toBeGreaterThan(0)
      expect(result.some((s) => s.id === 'vomiting')).toBe(true)
    })

    it('should return empty array for non-existent category', () => {
      const result = getSymptomsByCategory('nonexistent')

      expect(result).toEqual([])
    })
  })

  describe('searchSymptoms', () => {
    it('should find symptoms by keyword', () => {
      const result = searchSymptoms('呕吐')

      expect(result.length).toBeGreaterThan(0)
      expect(result.some((s) => s.id === 'vomiting')).toBe(true)
    })

    it('should filter by species', () => {
      const result = searchSymptoms('咳嗽', 'dog')

      expect(result.some((s) => s.id === 'cough')).toBe(true)
    })

    it('should return empty array for unmatched keyword', () => {
      const result = searchSymptoms('xyz_nonexistent')

      expect(result).toEqual([])
    })
  })

  describe('personalized insights - genetic disease', () => {
    it('should generate breed_disease_risk insight when golden retriever has cough', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ breed: '金毛寻回犬', species: 'dog' })

      const result = await analyzeSymptoms('pet_001', ['cough'], undefined, petProfile)

      const geneticInsight = result.personalizedInsights?.find(
        (i) => i.type === 'breed_disease_risk' && i.title === '品种遗传疾病关联'
      )
      expect(geneticInsight).toBeDefined()
      expect(geneticInsight!.message).toContain('金毛寻回犬')
    })

    it('should not generate genetic disease insight when breed has no matching genetic diseases', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ breed: '金毛寻回犬', species: 'dog' })

      const result = await analyzeSymptoms('pet_001', ['constipation'], undefined, petProfile)

      const geneticInsight = result.personalizedInsights?.find(
        (i) => i.type === 'breed_disease_risk' && i.title === '品种遗传疾病关联'
      )
      expect(geneticInsight).toBeUndefined()
    })
  })

  describe('personalized insights - allergy warning', () => {
    it('should generate allergy_warning insight when pet has skin allergy and itching symptom', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ allergies: ['皮肤过敏'] })

      const result = await analyzeSymptoms('pet_001', ['itching', 'rash'], undefined, petProfile)

      const allergyInsight = result.personalizedInsights?.find(
        (i) => i.type === 'allergy_warning'
      )
      expect(allergyInsight).toBeDefined()
      expect(allergyInsight!.message).toContain('过敏')
    })

    it('should generate allergy_warning insight when pet has food allergy and digestive symptoms', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ allergies: ['食物过敏'] })

      const result = await analyzeSymptoms('pet_001', ['vomiting', 'diarrhea'], undefined, petProfile)

      const allergyInsight = result.personalizedInsights?.find(
        (i) => i.type === 'allergy_warning'
      )
      expect(allergyInsight).toBeDefined()
      expect(allergyInsight!.message).toContain('过敏')
    })

    it('should not generate allergy_warning when pet has no allergies', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ allergies: [] })

      const result = await analyzeSymptoms('pet_001', ['itching'], undefined, petProfile)

      const allergyInsight = result.personalizedInsights?.find(
        (i) => i.type === 'allergy_warning'
      )
      expect(allergyInsight).toBeUndefined()
    })
  })

  describe('personalized insights - medication side effect', () => {
    it('should generate medication_side_effect insight when pet on antibiotics has vomiting', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ medications: ['抗生素阿莫西林'] })

      const result = await analyzeSymptoms('pet_001', ['vomiting', 'diarrhea'], undefined, petProfile)

      const medInsight = result.personalizedInsights?.find(
        (i) => i.type === 'medication_side_effect'
      )
      expect(medInsight).toBeDefined()
      expect(medInsight!.message).toContain('药物副作用')
    })

    it('should generate medication_side_effect insight when pet on heart medication has cough', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ medications: ['心脏病药'] })

      const result = await analyzeSymptoms('pet_001', ['cough', 'lethargy'], undefined, petProfile)

      const medInsight = result.personalizedInsights?.find(
        (i) => i.type === 'medication_side_effect'
      )
      expect(medInsight).toBeDefined()
      expect(medInsight!.message).toContain('药物副作用')
    })

    it('should not generate medication_side_effect when pet has no medications', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ medications: [] })

      const result = await analyzeSymptoms('pet_001', ['vomiting'], undefined, petProfile)

      const medInsight = result.personalizedInsights?.find(
        (i) => i.type === 'medication_side_effect'
      )
      expect(medInsight).toBeUndefined()
    })
  })

  describe('personalized insights - chronic condition alert', () => {
    it('should generate chronic_condition_alert insight when pet with kidney disease has vomiting', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ chronicConditions: ['慢性肾病'] })

      const result = await analyzeSymptoms('pet_001', ['vomiting', 'appetite_loss'], undefined, petProfile)

      const chronicInsight = result.personalizedInsights?.find(
        (i) => i.type === 'chronic_condition_alert'
      )
      expect(chronicInsight).toBeDefined()
      expect(chronicInsight!.message).toContain('慢性病')
    })

    it('should generate chronic_condition_alert insight when pet with heart disease has cough', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ chronicConditions: ['心脏病'] })

      const result = await analyzeSymptoms('pet_001', ['cough', 'dyspnea'], undefined, petProfile)

      const chronicInsight = result.personalizedInsights?.find(
        (i) => i.type === 'chronic_condition_alert'
      )
      expect(chronicInsight).toBeDefined()
      expect(chronicInsight!.message).toContain('慢性病')
    })

    it('should not generate chronic_condition_alert when pet has no chronic conditions', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ chronicConditions: [] })

      const result = await analyzeSymptoms('pet_001', ['vomiting'], undefined, petProfile)

      const chronicInsight = result.personalizedInsights?.find(
        (i) => i.type === 'chronic_condition_alert'
      )
      expect(chronicInsight).toBeUndefined()
    })
  })

  describe('personalized insights - no extra insights without memory', () => {
    it('should not generate allergy/medication/chronic insights when pet has no memory fields', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({
        allergies: [],
        medications: [],
        chronicConditions: [],
      })

      const result = await analyzeSymptoms('pet_001', ['vomiting', 'itching'], undefined, petProfile)

      const allergyInsight = result.personalizedInsights?.find((i) => i.type === 'allergy_warning')
      const medInsight = result.personalizedInsights?.find((i) => i.type === 'medication_side_effect')
      const chronicInsight = result.personalizedInsights?.find((i) => i.type === 'chronic_condition_alert')
      expect(allergyInsight).toBeUndefined()
      expect(medInsight).toBeUndefined()
      expect(chronicInsight).toBeUndefined()
    })
  })

  describe('personalized insights - multiple dimensions', () => {
    it('should generate multiple insights when allergy, medication, and chronic conditions all match', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({
        allergies: ['皮肤过敏'],
        medications: ['抗生素'],
        chronicConditions: ['慢性肾病'],
      })

      const result = await analyzeSymptoms('pet_001', ['vomiting', 'itching', 'lethargy'], undefined, petProfile)

      const allergyInsight = result.personalizedInsights?.find((i) => i.type === 'allergy_warning')
      const medInsight = result.personalizedInsights?.find((i) => i.type === 'medication_side_effect')
      const chronicInsight = result.personalizedInsights?.find((i) => i.type === 'chronic_condition_alert')
      expect(allergyInsight).toBeDefined()
      expect(medInsight).toBeDefined()
      expect(chronicInsight).toBeDefined()
    })
  })

  describe('personalized advice - enhanced tips', () => {
    it('should include allergy tip in advice when pet has allergies and skin/digestive symptoms', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ allergies: ['皮肤过敏'] })

      const result = await analyzeSymptoms('pet_001', ['itching'], undefined, petProfile)

      expect(result.aiAdvice).toContain('过敏')
    })

    it('should include chronic condition tip in advice when pet has chronic conditions with related symptoms', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ chronicConditions: ['慢性肾病'] })

      const result = await analyzeSymptoms('pet_001', ['vomiting'], undefined, petProfile)

      expect(result.aiAdvice).toContain('慢性病')
    })

    it('should include medication side effect tip in advice when pet on medication with side effect symptoms', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'))
      const petProfile = makePetProfile({ medications: ['抗生素'] })

      const result = await analyzeSymptoms('pet_001', ['vomiting'], undefined, petProfile)

      expect(result.aiAdvice).toContain('药物副作用')
    })
  })
})
