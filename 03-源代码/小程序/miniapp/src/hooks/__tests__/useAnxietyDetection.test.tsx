/**
 * useAnxietyDetection 测试
 * 验证宠物健康焦虑检测 Hook 的各项检测和消除功能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { useEffect, useRef } from 'react'
import { render, act } from '@testing-library/react'
import type { UseAnxietyDetectionReturn } from '../useAnxietyDetection'

import { useAnxietyDetection } from '../useAnxietyDetection'

const {
  mockGetStorageSync,
  mockSetStorageSync,
  mockCheckinStore,
  mockSymptomStore,
  mockFoodQueryStore,
} = vi.hoisted(() => {
  const getStorageSync = vi.fn<(key: string) => any>(() => null)
  const setStorageSync = vi.fn()

  const checkinStore = {
    stats: null as any,
    fetchStats: vi.fn().mockImplementation(async function (this: any) {}),
    fetchCheckins: vi.fn().mockImplementation(async function (this: any, _petId: string) {}),
    checkins: [] as any[],
  }

  const symptomStore = {
    history: [] as any[],
  }

  const foodQueryStore = {
    stats: { totalQueries: 0 } as any,
  }

  return {
    mockGetStorageSync: getStorageSync,
    mockSetStorageSync: setStorageSync,
    mockCheckinStore: checkinStore,
    mockSymptomStore: symptomStore,
    mockFoodQueryStore: foodQueryStore,
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: mockGetStorageSync,
    setStorageSync: mockSetStorageSync,
  },
}))

vi.mock('../../stores/checkinStore', () => ({
  useCheckinStore: () => mockCheckinStore,
}))

vi.mock('../../stores/symptomStore', () => ({
  useSymptomStore: () => mockSymptomStore,
}))

vi.mock('../../stores/foodQueryStore', () => ({
  useFoodQueryStore: () => mockFoodQueryStore,
}))

/** 生成距今 days 天的 ISO 日期（YYYY-MM-DD），与 hook 的 7 天窗口逻辑保持一致 */
function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

function renderHookWithComponent<T>(hookFn: () => T) {
  let hookResult: T = null as any
  function TestComponent() {
    hookResult = hookFn()
    return null
  }
  const utils = render(<TestComponent />)
  return {
    result: { get current() { return hookResult } },
    rerender: utils.rerender,
    unmount: utils.unmount,
  }
}

describe('useAnxietyDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStorageSync.mockReturnValue(null)
    mockSetStorageSync.mockReturnValue(undefined)
    mockCheckinStore.fetchStats.mockImplementation(async () => {})
    mockCheckinStore.fetchCheckins.mockImplementation(async () => {})
    mockCheckinStore.stats = null
    mockCheckinStore.checkins = []
    mockSymptomStore.history = []
    mockFoodQueryStore.stats = { totalQueries: 0 }
  })

  it('初始 anxietyState 所有标志为 false 且上下文为 null', () => {
    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    const { anxietyState } = result.current
    expect(anxietyState.showSickAnxiety).toBe(false)
    expect(anxietyState.showNewOwnerAnxiety).toBe(false)
    expect(anxietyState.sickAnxietyContext).toBeNull()
    expect(anxietyState.newOwnerAnxietyContext).toBeNull()
    expect(anxietyState.anxietyLevel).toBeNull()
  })

  it('checkSickAnxiety 今日已检查时提前返回', async () => {
    const today = new Date().toISOString().split('T')[0]
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return today
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkSickAnxiety('pet-1', '旺财')
    })

    expect(mockCheckinStore.fetchCheckins).not.toHaveBeenCalled()
  })

  it('checkSickAnxiety 已被 dismissed 时提前返回', async () => {
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'sick_anxiety_dismissed') return true
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkSickAnxiety('pet-1', '旺财')
    })

    expect(mockCheckinStore.fetchCheckins).not.toHaveBeenCalled()
  })

  it('checkSickAnxiety 连续异常天数 >= 3 时触发 sick anxiety', async () => {
    mockCheckinStore.checkins = [1, 2, 3].map(i => ({
      date: daysAgoISO(i),
      mood: 'sad',
      appetite: 'normal',
      stool: 'normal',
    }))
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'sick_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkSickAnxiety('pet-1', '小白')
    })

    expect(result.current.anxietyState.showSickAnxiety).toBe(true)
    expect(result.current.anxietyState.sickAnxietyContext).toEqual({ petName: '小白', consecutiveAnomalyDays: 3 })
    expect(result.current.anxietyState.anxietyLevel).toBe('mild')
    expect(mockSetStorageSync).toHaveBeenCalledWith('anxiety_last_check', expect.any(String))
  })

  it('checkSickAnxiety 连续异常天数 >= 5 时 anxietyLevel 为 moderate', async () => {
    mockCheckinStore.checkins = Array.from({ length: 5 }, (_, i) => ({
      date: daysAgoISO(i + 1),
      mood: 'sad',
      appetite: 'normal',
      stool: 'normal',
    }))
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'sick_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkSickAnxiety('pet-1', '大黄')
    })

    expect(result.current.anxietyState.anxietyLevel).toBe('moderate')
  })

  it('checkSickAnxiety 连续异常天数 >= 7 时 anxietyLevel 为 severe', async () => {
    // 窗口为 diffDays < 7，故从今天（0）到 6 天前共 7 条都在窗口内
    mockCheckinStore.checkins = Array.from({ length: 7 }, (_, i) => ({
      date: daysAgoISO(i),
      mood: 'sad',
      appetite: 'normal',
      stool: 'normal',
    }))
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'sick_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkSickAnxiety('pet-1', '大黄')
    })

    expect(result.current.anxietyState.anxietyLevel).toBe('severe')
  })

  it('checkSickAnxiety 连续异常天数 < 3 时不触发', async () => {
    mockCheckinStore.checkins = [1, 2].map(i => ({
      date: daysAgoISO(i),
      mood: 'sad',
      appetite: 'normal',
      stool: 'normal',
    }))
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'sick_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkSickAnxiety('pet-1', '小白')
    })

    expect(result.current.anxietyState.showSickAnxiety).toBe(false)
  })

  it('checkSickAnxiety stats 为 null 时不触发', async () => {
    mockCheckinStore.checkins = []
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'sick_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkSickAnxiety('pet-1', '小白')
    })

    expect(result.current.anxietyState.showSickAnxiety).toBe(false)
  })

  it('dismissSickAnxiety 设置 storage 并重置 sick anxiety 状态', async () => {
    mockCheckinStore.checkins = [1, 2, 3, 4].map(i => ({
      date: daysAgoISO(i),
      mood: 'sad',
      appetite: 'normal',
      stool: 'normal',
    }))
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'sick_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())

    await act(async () => {
      await result.current.checkSickAnxiety('pet-1', '旺财')
    })

    expect(result.current.anxietyState.showSickAnxiety).toBe(true)

    act(() => {
      result.current.dismissSickAnxiety()
    })

    expect(mockSetStorageSync).toHaveBeenCalledWith('sick_anxiety_dismissed', true)
    expect(result.current.anxietyState.showSickAnxiety).toBe(false)
    expect(result.current.anxietyState.sickAnxietyContext).toBeNull()
  })

  it('checkNewOwnerAnxiety 食物查询 >= 5 时触发', async () => {
    mockFoodQueryStore.stats = { totalQueries: 5 }
    mockSymptomStore.history = []
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'new_owner_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkNewOwnerAnxiety('pet-1')
    })

    expect(result.current.anxietyState.showNewOwnerAnxiety).toBe(true)
    expect(result.current.anxietyState.newOwnerAnxietyContext).toEqual({ foodQueryCount: 5, symptomCheckCount: 0 })
    expect(result.current.anxietyState.anxietyLevel).toBe('mild')
  })

  it('checkNewOwnerAnxiety 症状检查 >= 3 时触发', async () => {
    mockFoodQueryStore.stats = { totalQueries: 0 }
    mockSymptomStore.history = [{ id: '1' }, { id: '2' }, { id: '3' }]
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'new_owner_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkNewOwnerAnxiety('pet-1')
    })

    expect(result.current.anxietyState.showNewOwnerAnxiety).toBe(true)
    expect(result.current.anxietyState.newOwnerAnxietyContext).toEqual({ foodQueryCount: 0, symptomCheckCount: 3 })
  })

  it('checkNewOwnerAnxiety 总计 >= 8 时 anxietyLevel 为 moderate', async () => {
    mockFoodQueryStore.stats = { totalQueries: 5 }
    mockSymptomStore.history = [{ id: '1' }, { id: '2' }, { id: '3' }]
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'new_owner_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkNewOwnerAnxiety('pet-1')
    })

    expect(result.current.anxietyState.anxietyLevel).toBe('moderate')
  })

  it('checkNewOwnerAnxiety 总计 >= 15 时 anxietyLevel 为 severe', async () => {
    mockFoodQueryStore.stats = { totalQueries: 10 }
    mockSymptomStore.history = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }))
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'new_owner_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkNewOwnerAnxiety('pet-1')
    })

    expect(result.current.anxietyState.anxietyLevel).toBe('severe')
  })

  it('checkNewOwnerAnxiety 食物查询 < 5 且症状检查 < 3 时不触发', async () => {
    mockFoodQueryStore.stats = { totalQueries: 2 }
    mockSymptomStore.history = [{ id: '1' }]
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'new_owner_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkNewOwnerAnxiety('pet-1')
    })

    expect(result.current.anxietyState.showNewOwnerAnxiety).toBe(false)
  })

  it('checkNewOwnerAnxiety 今日已检查时提前返回', async () => {
    const today = new Date().toISOString().split('T')[0]
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return today
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkNewOwnerAnxiety('pet-1')
    })

    expect(result.current.anxietyState.showNewOwnerAnxiety).toBe(false)
  })

  it('checkNewOwnerAnxiety 已被 dismissed 时提前返回', async () => {
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'new_owner_anxiety_dismissed') return true
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkNewOwnerAnxiety('pet-1')
    })

    expect(result.current.anxietyState.showNewOwnerAnxiety).toBe(false)
  })

  it('dismissNewOwnerAnxiety 设置 storage 并重置 new owner anxiety 状态', async () => {
    mockFoodQueryStore.stats = { totalQueries: 6 }
    mockSymptomStore.history = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'new_owner_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())

    await act(async () => {
      await result.current.checkNewOwnerAnxiety('pet-1')
    })

    expect(result.current.anxietyState.showNewOwnerAnxiety).toBe(true)

    act(() => {
      result.current.dismissNewOwnerAnxiety()
    })

    expect(mockSetStorageSync).toHaveBeenCalledWith('new_owner_anxiety_dismissed', true)
    expect(result.current.anxietyState.showNewOwnerAnxiety).toBe(false)
    expect(result.current.anxietyState.newOwnerAnxietyContext).toBeNull()
  })

  it('dismissSickAnxiety 不影响 newOwnerAnxiety 状态', async () => {
    mockFoodQueryStore.stats = { totalQueries: 6 }
    mockSymptomStore.history = []
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'new_owner_anxiety_dismissed') return null
      if (key === 'sick_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkNewOwnerAnxiety('pet-1')
    })

    expect(result.current.anxietyState.showNewOwnerAnxiety).toBe(true)

    act(() => {
      result.current.dismissSickAnxiety()
    })

    expect(result.current.anxietyState.showNewOwnerAnxiety).toBe(true)
  })

  it('dismissNewOwnerAnxiety 不影响 sickAnxiety 状态', async () => {
    mockCheckinStore.checkins = [1, 2, 3, 4].map(i => ({
      date: daysAgoISO(i),
      mood: 'sad',
      appetite: 'normal',
      stool: 'normal',
    }))
    mockGetStorageSync.mockImplementation((key: string) => {
      if (key === 'anxiety_last_check') return null
      if (key === 'new_owner_anxiety_dismissed') return null
      if (key === 'sick_anxiety_dismissed') return null
      return null
    })

    const { result } = renderHookWithComponent(() => useAnxietyDetection())
    await act(async () => {
      await result.current.checkSickAnxiety('pet-1', '旺财')
    })

    expect(result.current.anxietyState.showSickAnxiety).toBe(true)

    act(() => {
      result.current.dismissNewOwnerAnxiety()
    })

    expect(result.current.anxietyState.showSickAnxiety).toBe(true)
  })
})
