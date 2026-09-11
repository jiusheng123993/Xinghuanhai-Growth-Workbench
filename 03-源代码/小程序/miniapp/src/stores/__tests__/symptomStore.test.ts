/**
 * 症状自查状态管理 - 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useSymptomStore } from '../symptomStore'
import type { SymptomCheckResult, SymptomCategory } from '../../services/symptomService'

const { mockSymptomService } = vi.hoisted(() => {
  return {
    mockSymptomService: {
      getSymptomCategories: vi.fn(),
      analyzeSymptoms: vi.fn(),
      getCheckHistory: vi.fn(),
      getCheckResult: vi.fn(),
      deleteCheckResult: vi.fn(),
    },
  }
})

vi.mock('../../services/symptomService', () => mockSymptomService)

function makeCategory(overrides: Partial<SymptomCategory> = {}): SymptomCategory {
  return {
    id: 'digestive',
    name: '消化系统',
    icon: 'digestive',
    symptoms: [
      { id: 'vomiting', name: '呕吐', description: '宠物出现呕吐现象', species: ['cat', 'dog'] },
      { id: 'diarrhea', name: '腹泻', description: '大便稀溏或水样', species: ['cat', 'dog'] },
    ],
    ...overrides,
  }
}

function makeCheckResult(overrides: Partial<SymptomCheckResult> = {}): SymptomCheckResult {
  return {
    id: 'sym_test_001',
    petId: 'pet-001',
    symptoms: ['vomiting'],
    riskLevel: 'caution',
    possibleConditions: ['胃炎', '食物不耐受'],
    aiAdvice: '💡 注意观察。',
    recommendedActions: ['持续观察宠物状态24小时'],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('symptomStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSymptomStore.setState({
      categories: [],
      selectedSymptoms: [],
      currentResult: null,
      history: [],
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('should have empty categories', () => {
      const state = useSymptomStore.getState()
      expect(state.categories).toEqual([])
    })

    it('should have empty selectedSymptoms', () => {
      const state = useSymptomStore.getState()
      expect(state.selectedSymptoms).toEqual([])
    })

    it('should have null currentResult', () => {
      const state = useSymptomStore.getState()
      expect(state.currentResult).toBeNull()
    })

    it('should have empty history', () => {
      const state = useSymptomStore.getState()
      expect(state.history).toEqual([])
    })

    it('should have isLoading as false', () => {
      const state = useSymptomStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have null error', () => {
      const state = useSymptomStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('fetchCategories', () => {
    it('should load categories', () => {
      const mockCategories = [makeCategory(), makeCategory({ id: 'respiratory', name: '呼吸系统' })]
      mockSymptomService.getSymptomCategories.mockReturnValue(mockCategories)

      useSymptomStore.getState().fetchCategories()

      const state = useSymptomStore.getState()
      expect(state.categories).toHaveLength(2)
      expect(state.categories[0].id).toBe('digestive')
      expect(state.categories[1].id).toBe('respiratory')
    })

    it('should pass species parameter', () => {
      mockSymptomService.getSymptomCategories.mockReturnValue([])

      useSymptomStore.getState().fetchCategories('dog')

      expect(mockSymptomService.getSymptomCategories).toHaveBeenCalledWith('dog')
    })
  })

  describe('selectSymptom', () => {
    it('should add symptom to selection', () => {
      useSymptomStore.getState().selectSymptom('vomiting')

      const state = useSymptomStore.getState()
      expect(state.selectedSymptoms).toContain('vomiting')
      expect(state.selectedSymptoms).toHaveLength(1)
    })

    it('should not add duplicate symptom', () => {
      useSymptomStore.getState().selectSymptom('vomiting')
      useSymptomStore.getState().selectSymptom('vomiting')

      const state = useSymptomStore.getState()
      expect(state.selectedSymptoms).toHaveLength(1)
    })

    it('should allow multiple different symptoms', () => {
      useSymptomStore.getState().selectSymptom('vomiting')
      useSymptomStore.getState().selectSymptom('diarrhea')
      useSymptomStore.getState().selectSymptom('lethargy')

      const state = useSymptomStore.getState()
      expect(state.selectedSymptoms).toHaveLength(3)
      expect(state.selectedSymptoms).toContain('vomiting')
      expect(state.selectedSymptoms).toContain('diarrhea')
      expect(state.selectedSymptoms).toContain('lethargy')
    })
  })

  describe('deselectSymptom', () => {
    it('should remove symptom from selection', () => {
      useSymptomStore.setState({ selectedSymptoms: ['vomiting', 'diarrhea'] })

      useSymptomStore.getState().deselectSymptom('vomiting')

      const state = useSymptomStore.getState()
      expect(state.selectedSymptoms).toHaveLength(1)
      expect(state.selectedSymptoms).toContain('diarrhea')
      expect(state.selectedSymptoms).not.toContain('vomiting')
    })

    it('should handle deselecting non-existent symptom', () => {
      useSymptomStore.setState({ selectedSymptoms: ['vomiting'] })

      useSymptomStore.getState().deselectSymptom('diarrhea')

      const state = useSymptomStore.getState()
      expect(state.selectedSymptoms).toHaveLength(1)
      expect(state.selectedSymptoms).toContain('vomiting')
    })
  })

  describe('analyzeSymptoms', () => {
    it('should analyze symptoms and set result', async () => {
      useSymptomStore.setState({ selectedSymptoms: ['vomiting'] })
      const mockResult = makeCheckResult()
      mockSymptomService.analyzeSymptoms.mockResolvedValue(mockResult)

      const result = await useSymptomStore.getState().analyzeSymptoms('pet-001')

      expect(result.riskLevel).toBe('caution')
      const state = useSymptomStore.getState()
      expect(state.currentResult).not.toBeNull()
      expect(state.currentResult!.id).toBe('sym_test_001')
      expect(state.history).toHaveLength(1)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should throw error when no symptoms selected', async () => {
      await expect(
        useSymptomStore.getState().analyzeSymptoms('pet-001')
      ).rejects.toThrow('请至少选择一个症状')

      const state = useSymptomStore.getState()
      expect(state.error).toBe('请至少选择一个症状')
    })

    it('should set error when analysis fails', async () => {
      useSymptomStore.setState({ selectedSymptoms: ['vomiting'] })
      mockSymptomService.analyzeSymptoms.mockRejectedValue(new Error('Analysis failed'))

      await expect(
        useSymptomStore.getState().analyzeSymptoms('pet-001')
      ).rejects.toThrow('Analysis failed')

      const state = useSymptomStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Analysis failed')
    })

    it('should pass additionalInfo to service', async () => {
      useSymptomStore.setState({ selectedSymptoms: ['vomiting'] })
      const mockResult = makeCheckResult()
      mockSymptomService.analyzeSymptoms.mockResolvedValue(mockResult)

      await useSymptomStore.getState().analyzeSymptoms('pet-001', {
        duration: '1天',
        appetite: 'decreased',
      })

      expect(mockSymptomService.analyzeSymptoms).toHaveBeenCalledWith(
        'pet-001',
        ['vomiting'],
        { duration: '1天', appetite: 'decreased' },
        undefined
      )
    })

    it('should prepend result to history', async () => {
      useSymptomStore.setState({
        selectedSymptoms: ['vomiting'],
        history: [makeCheckResult({ id: 'old_001' })],
      })
      const mockResult = makeCheckResult({ id: 'new_001' })
      mockSymptomService.analyzeSymptoms.mockResolvedValue(mockResult)

      await useSymptomStore.getState().analyzeSymptoms('pet-001')

      const state = useSymptomStore.getState()
      expect(state.history).toHaveLength(2)
      expect(state.history[0].id).toBe('new_001')
      expect(state.history[1].id).toBe('old_001')
    })
  })

  describe('fetchHistory', () => {
    it('should load history', async () => {
      const mockHistory = [makeCheckResult(), makeCheckResult({ id: 'sym_test_002' })]
      mockSymptomService.getCheckHistory.mockResolvedValue(mockHistory)

      await useSymptomStore.getState().fetchHistory('pet-001')

      const state = useSymptomStore.getState()
      expect(state.history).toHaveLength(2)
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should set error when fetch fails', async () => {
      mockSymptomService.getCheckHistory.mockRejectedValue(new Error('Network error'))

      await useSymptomStore.getState().fetchHistory('pet-001')

      const state = useSymptomStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Network error')
    })
  })

  describe('fetchCheckResult', () => {
    it('should load single check result', async () => {
      const mockResult = makeCheckResult()
      mockSymptomService.getCheckResult.mockResolvedValue(mockResult)

      await useSymptomStore.getState().fetchCheckResult('sym_test_001')

      const state = useSymptomStore.getState()
      expect(state.currentResult).not.toBeNull()
      expect(state.currentResult!.id).toBe('sym_test_001')
      expect(state.isLoading).toBe(false)
    })

    it('should set error when result not found', async () => {
      mockSymptomService.getCheckResult.mockResolvedValue(null)

      await useSymptomStore.getState().fetchCheckResult('sym_test_001')

      const state = useSymptomStore.getState()
      expect(state.error).toBe('未找到该检查记录')
    })

    it('should set error when fetch fails', async () => {
      mockSymptomService.getCheckResult.mockRejectedValue(new Error('Network error'))

      await useSymptomStore.getState().fetchCheckResult('sym_test_001')

      const state = useSymptomStore.getState()
      expect(state.error).toBe('Network error')
    })
  })

  describe('removeCheckResult', () => {
    it('should remove check result from history', async () => {
      useSymptomStore.setState({
        history: [
          makeCheckResult({ id: 'sym_001' }),
          makeCheckResult({ id: 'sym_002' }),
        ],
      })
      mockSymptomService.deleteCheckResult.mockResolvedValue(undefined)

      await useSymptomStore.getState().removeCheckResult('sym_001')

      const state = useSymptomStore.getState()
      expect(state.history).toHaveLength(1)
      expect(state.history[0].id).toBe('sym_002')
      expect(state.isLoading).toBe(false)
    })

    it('should clear currentResult if it matches deleted id', async () => {
      useSymptomStore.setState({
        currentResult: makeCheckResult({ id: 'sym_001' }),
        history: [makeCheckResult({ id: 'sym_001' })],
      })
      mockSymptomService.deleteCheckResult.mockResolvedValue(undefined)

      await useSymptomStore.getState().removeCheckResult('sym_001')

      const state = useSymptomStore.getState()
      expect(state.currentResult).toBeNull()
    })

    it('should keep currentResult if different id', async () => {
      useSymptomStore.setState({
        currentResult: makeCheckResult({ id: 'sym_002' }),
        history: [
          makeCheckResult({ id: 'sym_001' }),
          makeCheckResult({ id: 'sym_002' }),
        ],
      })
      mockSymptomService.deleteCheckResult.mockResolvedValue(undefined)

      await useSymptomStore.getState().removeCheckResult('sym_001')

      const state = useSymptomStore.getState()
      expect(state.currentResult).not.toBeNull()
      expect(state.currentResult!.id).toBe('sym_002')
    })

    it('should set error when delete fails', async () => {
      useSymptomStore.setState({
        history: [makeCheckResult({ id: 'sym_001' })],
      })
      mockSymptomService.deleteCheckResult.mockRejectedValue(new Error('Delete failed'))

      await useSymptomStore.getState().removeCheckResult('sym_001')

      const state = useSymptomStore.getState()
      expect(state.error).toBe('Delete failed')
    })
  })

  describe('clearSelection', () => {
    it('should clear selected symptoms and current result', () => {
      useSymptomStore.setState({
        selectedSymptoms: ['vomiting', 'diarrhea'],
        currentResult: makeCheckResult(),
      })

      useSymptomStore.getState().clearSelection()

      const state = useSymptomStore.getState()
      expect(state.selectedSymptoms).toEqual([])
      expect(state.currentResult).toBeNull()
    })
  })

  describe('clearError', () => {
    it('should clear error', () => {
      useSymptomStore.setState({ error: 'Some error' })

      useSymptomStore.getState().clearError()

      const state = useSymptomStore.getState()
      expect(state.error).toBeNull()
    })
  })
})