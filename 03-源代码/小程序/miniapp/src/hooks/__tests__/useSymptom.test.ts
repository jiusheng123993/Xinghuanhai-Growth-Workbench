/**
 * useSymptom 测试
 * 验证症状初筛 Hook 的分类查询和 AI 分析功能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useSymptomStore } from '../../stores/symptomStore'
import { useSymptom } from '../useSymptom'

const {
  mockFetchCategories,
  mockSelectSymptom,
  mockDeselectSymptom,
  mockAnalyzeSymptoms,
  mockFetchHistory,
  mockFetchCheckResult,
  mockRemoveCheckResult,
  mockClearSelection,
  mockClearError,
} = vi.hoisted(() => ({
  mockFetchCategories: vi.fn(),
  mockSelectSymptom: vi.fn(),
  mockDeselectSymptom: vi.fn(),
  mockAnalyzeSymptoms: vi.fn(),
  mockFetchHistory: vi.fn(),
  mockFetchCheckResult: vi.fn(),
  mockRemoveCheckResult: vi.fn(),
  mockClearSelection: vi.fn(),
  mockClearError: vi.fn(),
}))

vi.mock('react', () => {
  const actual = { useCallback: (fn: any) => fn, useEffect: (fn: any) => fn() }
  return { ...actual, default: actual }
})

const defaultMockStore = {
  categories: [],
  selectedSymptoms: [],
  currentResult: null,
  history: [],
  isLoading: false,
  error: null,
  fetchCategories: mockFetchCategories,
  selectSymptom: mockSelectSymptom,
  deselectSymptom: mockDeselectSymptom,
  analyzeSymptoms: mockAnalyzeSymptoms,
  fetchHistory: mockFetchHistory,
  fetchCheckResult: mockFetchCheckResult,
  removeCheckResult: mockRemoveCheckResult,
  clearSelection: mockClearSelection,
  clearError: mockClearError,
}

vi.mock('../../stores/symptomStore', () => ({
  useSymptomStore: vi.fn(() => ({ ...defaultMockStore }))
}))

describe('useSymptom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSymptomStore).mockReturnValue({ ...defaultMockStore })
  })

  it('返回值包含所有预期字段', () => {
    const result = useSymptom()
    expect(result).toHaveProperty('categories')
    expect(result).toHaveProperty('selectedSymptoms')
    expect(result).toHaveProperty('currentResult')
    expect(result).toHaveProperty('history')
    expect(result).toHaveProperty('isLoading')
    expect(result).toHaveProperty('error')
    expect(result).toHaveProperty('fetchCategories')
    expect(result).toHaveProperty('selectSymptom')
    expect(result).toHaveProperty('deselectSymptom')
    expect(result).toHaveProperty('analyzeSymptoms')
    expect(result).toHaveProperty('fetchHistory')
    expect(result).toHaveProperty('fetchCheckResult')
    expect(result).toHaveProperty('removeCheckResult')
    expect(result).toHaveProperty('clearSelection')
    expect(result).toHaveProperty('clearError')
  })

  it('返回 store 中的 categories', () => {
    const categories = [{ id: 'cat1', name: '消化系统', symptoms: [] }]
    vi.mocked(useSymptomStore).mockReturnValue({ ...defaultMockStore, categories })
    const result = useSymptom()
    expect(result.categories).toEqual(categories)
  })

  it('返回 store 中的 selectedSymptoms', () => {
    vi.mocked(useSymptomStore).mockReturnValue({ ...defaultMockStore, selectedSymptoms: ['s1', 's2'] })
    const result = useSymptom()
    expect(result.selectedSymptoms).toEqual(['s1', 's2'])
  })

  it('返回 store 中的 currentResult', () => {
    const currentResult = { id: 'r1', petId: 'p1', symptoms: [], possibleDiseases: [], urgencyLevel: 'low', additionalInfo: {} } as any
    vi.mocked(useSymptomStore).mockReturnValue({ ...defaultMockStore, currentResult })
    const result = useSymptom()
    expect(result.currentResult).toEqual(currentResult)
  })

  it('返回 store 中的 history', () => {
    const history = [{ id: 'r1' }] as any[]
    vi.mocked(useSymptomStore).mockReturnValue({ ...defaultMockStore, history })
    const result = useSymptom()
    expect(result.history).toEqual(history)
  })

  it('返回 store 中的 isLoading', () => {
    vi.mocked(useSymptomStore).mockReturnValue({ ...defaultMockStore, isLoading: true })
    const result = useSymptom()
    expect(result.isLoading).toBe(true)
  })

  it('返回 store 中的 error', () => {
    vi.mocked(useSymptomStore).mockReturnValue({ ...defaultMockStore, error: '出错了' })
    const result = useSymptom()
    expect(result.error).toBe('出错了')
  })

  it('fetchCategories 调用 store 的 fetchCategories', () => {
    const result = useSymptom()
    result.fetchCategories('cat')
    expect(mockFetchCategories).toHaveBeenCalledWith('cat')
  })

  it('fetchCategories 不传参数时调用 store 的 fetchCategories', () => {
    const result = useSymptom()
    result.fetchCategories()
    expect(mockFetchCategories).toHaveBeenCalledWith(undefined)
  })

  it('selectSymptom 调用 store 的 selectSymptom', () => {
    const result = useSymptom()
    result.selectSymptom('symptom-1')
    expect(mockSelectSymptom).toHaveBeenCalledWith('symptom-1')
  })

  it('deselectSymptom 调用 store 的 deselectSymptom', () => {
    const result = useSymptom()
    result.deselectSymptom('symptom-1')
    expect(mockDeselectSymptom).toHaveBeenCalledWith('symptom-1')
  })

  it('analyzeSymptoms 调用 store 的 analyzeSymptoms 并返回结果', async () => {
    const mockResult = { id: 'r1', petId: 'p1', symptoms: [], possibleDiseases: [], urgencyLevel: 'low', additionalInfo: {} } as any
    mockAnalyzeSymptoms.mockResolvedValue(mockResult)
    const result = useSymptom()
    const returned = await result.analyzeSymptoms('p1')
    expect(mockAnalyzeSymptoms).toHaveBeenCalledWith('p1', undefined, undefined)
    expect(returned).toEqual(mockResult)
  })

  it('analyzeSymptoms 传递 additionalInfo 和 petProfile', async () => {
    const additionalInfo = { duration: '3天' } as any
    const petProfile = { id: 'p1', name: '小白' } as any
    mockAnalyzeSymptoms.mockResolvedValue({} as any)
    const result = useSymptom()
    await result.analyzeSymptoms('p1', additionalInfo, petProfile)
    expect(mockAnalyzeSymptoms).toHaveBeenCalledWith('p1', additionalInfo, petProfile)
  })

  it('fetchHistory 调用 store 的 fetchHistory', async () => {
    mockFetchHistory.mockResolvedValue(undefined)
    const result = useSymptom()
    await result.fetchHistory('pet-1')
    expect(mockFetchHistory).toHaveBeenCalledWith('pet-1')
  })

  it('fetchCheckResult 调用 store 的 fetchCheckResult', async () => {
    mockFetchCheckResult.mockResolvedValue(undefined)
    const result = useSymptom()
    await result.fetchCheckResult('result-1')
    expect(mockFetchCheckResult).toHaveBeenCalledWith('result-1')
  })

  it('removeCheckResult 调用 store 的 removeCheckResult', async () => {
    mockRemoveCheckResult.mockResolvedValue(undefined)
    const result = useSymptom()
    await result.removeCheckResult('result-1')
    expect(mockRemoveCheckResult).toHaveBeenCalledWith('result-1')
  })

  it('clearSelection 调用 store 的 clearSelection', () => {
    const result = useSymptom()
    result.clearSelection()
    expect(mockClearSelection).toHaveBeenCalled()
  })

  it('clearError 调用 store 的 clearError', () => {
    const result = useSymptom()
    result.clearError()
    expect(mockClearError).toHaveBeenCalled()
  })
})
