/**
 * 打卡状态管理 - 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useCheckinStore } from '../checkinStore'
import type { Checkin } from '../../types'
// 日期 fixture 必须用「本地日历日」（与实现同口径）：原来用 toISOString() 取的是 UTC 日期，
// 东八区 08:00 之前会与本地「今天」差一天，用例就成了在复述旧 bug（2026-09-11 修复）
import { localDateString } from '../../utils/date'

const { mockApi } = vi.hoisted(() => {
  return {
    mockApi: {
      getCheckins: vi.fn(),
      createCheckin: vi.fn(),
    },
  }
})

vi.mock('../../services/api', () => ({
  api: mockApi,
}))

function makeCheckin(overrides: Partial<Checkin> = {}): Checkin {
  return {
    id: 'checkin_001',
    petId: 'pet_001',
    userId: 'user_001',
    date: localDateString(new Date())!,
    mood: 'happy',
    appetite: 'good',
    stool: 'normal',
    weight: 30,
    note: '',
    createdAt: '2024-06-01T10:00:00.000Z',
    ...overrides,
  }
}

describe('checkinStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCheckinStore.setState({
      checkins: [],
      todayCheckin: null,
      streakDays: 0,
      isLoading: false,
    })
  })

  describe('initial state', () => {
    it('should have empty checkins', () => {
      const state = useCheckinStore.getState()
      expect(state.checkins).toEqual([])
    })

    it('should have null todayCheckin', () => {
      const state = useCheckinStore.getState()
      expect(state.todayCheckin).toBeNull()
    })

    it('should have streakDays as 0', () => {
      const state = useCheckinStore.getState()
      expect(state.streakDays).toBe(0)
    })

    it('should have isLoading as false', () => {
      const state = useCheckinStore.getState()
      expect(state.isLoading).toBe(false)
    })
  })

  describe('initUser', () => {
    it('should set userId', async () => {
      await useCheckinStore.getState().initUser('user_123')
    })
  })

  describe('fetchCheckins', () => {
    it('should load checkins and set isLoading correctly', async () => {
      const mockCheckins = [makeCheckin(), makeCheckin({ id: 'checkin_002' })]
      mockApi.getCheckins.mockResolvedValue(mockCheckins)

      await useCheckinStore.getState().fetchCheckins('pet_001')

      const state = useCheckinStore.getState()
      expect(state.checkins).toHaveLength(2)
      expect(state.checkins[0].id).toBe('checkin_001')
      expect(state.checkins[1].id).toBe('checkin_002')
      expect(state.isLoading).toBe(false)
      expect(mockApi.getCheckins).toHaveBeenCalledWith('pet_001')
    })

    it('should set todayCheckin when today has a checkin', async () => {
      const today = localDateString(new Date())!
      const mockCheckins = [makeCheckin({ date: today })]
      mockApi.getCheckins.mockResolvedValue(mockCheckins)

      await useCheckinStore.getState().fetchCheckins('pet_001')

      const state = useCheckinStore.getState()
      expect(state.todayCheckin).not.toBeNull()
      expect(state.todayCheckin!.id).toBe('checkin_001')
    })

    it('should set todayCheckin to null when no today checkin', async () => {
      const mockCheckins = [makeCheckin({ date: '2020-01-01' })]
      mockApi.getCheckins.mockResolvedValue(mockCheckins)

      await useCheckinStore.getState().fetchCheckins('pet_001')

      const state = useCheckinStore.getState()
      expect(state.todayCheckin).toBeNull()
    })

    it('should set isLoading to false on failure', async () => {
      mockApi.getCheckins.mockRejectedValue(new Error('Network error'))

      await useCheckinStore.getState().fetchCheckins('pet_001')

      const state = useCheckinStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should set isLoading to true during fetch and false after', async () => {
      let resolveFetch!: (value: Checkin[]) => void
      mockApi.getCheckins.mockReturnValue(
        new Promise<Checkin[]>((resolve) => {
          resolveFetch = resolve
        })
      )

      const fetchPromise = useCheckinStore.getState().fetchCheckins('pet_001')
      expect(useCheckinStore.getState().isLoading).toBe(true)

      resolveFetch([])
      await fetchPromise

      expect(useCheckinStore.getState().isLoading).toBe(false)
    })
  })

  describe('doCheckin', () => {
    it('should add checkin to list and set todayCheckin', async () => {
      const newCheckin = makeCheckin()
      mockApi.createCheckin.mockResolvedValue(newCheckin)

      const result = await useCheckinStore.getState().doCheckin({ petId: 'pet_001' })

      expect(result.id).toBe('checkin_001')
      const state = useCheckinStore.getState()
      expect(state.checkins).toHaveLength(1)
      expect(state.checkins[0].id).toBe('checkin_001')
      expect(state.todayCheckin).not.toBeNull()
      expect(state.todayCheckin!.id).toBe('checkin_001')
      expect(state.streakDays).toBe(1)
    })

    it('should prepend new checkin to existing checkins', async () => {
      useCheckinStore.setState({
        checkins: [makeCheckin()],
        streakDays: 1,
      })
      const newCheckin = makeCheckin({ id: 'checkin_002' })
      mockApi.createCheckin.mockResolvedValue(newCheckin)

      await useCheckinStore.getState().doCheckin({ petId: 'pet_001' })

      const state = useCheckinStore.getState()
      expect(state.checkins).toHaveLength(2)
      expect(state.checkins[0].id).toBe('checkin_002')
      expect(state.streakDays).toBe(2)
    })
  })
})
