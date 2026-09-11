/**
 * 动态服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { api as _api } from '../api'
import { mockApi } from '../mock'
import {
  getFamilyMoments,
  getNewMoments,
  formatMomentTime,
  getMomentTypeInfo,
} from '../momentService'
import type { PetMoment } from '../../types/familyTypes'

vi.mock('../api', () => ({
  api: { get: vi.fn() },
}))
vi.mock('../mock', () => ({
  mockApi: { getMoments: vi.fn(), getNewMoments: vi.fn() },
}))
vi.mock('../../config', () => ({
  CONFIG: { USE_MOCK: false },
}))
const api = _api as any

function makeMoment(overrides: Partial<PetMoment> = {}): PetMoment {
  return {
    id: 'moment_001',
    userId: 'user-001',
    familyId: 'family-001',
    petId: 'pet-001',
    type: 'checkin',
    content: { petName: '小白', petEmoji: '🐱', action: '吃饭', appetite: '正常', mood: '开心' },
    photos: [],
    createdAt: '2024-01-15T10:30:00.000Z',
    ...overrides,
  }
}

describe('momentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getFamilyMoments', () => {
    it('should call API with correct URL and params', async () => {
      const mockMoments = [makeMoment(), makeMoment({ id: 'moment_002' })]
      vi.mocked(api.get).mockResolvedValue(mockMoments)

      const result = await getFamilyMoments('family-001')

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('moment_001')
      expect(api.get).toHaveBeenCalledWith('/api/families/family-001/moments', {})
    })

    it('should return empty array when API returns null', async () => {
      vi.mocked(api.get).mockResolvedValue(null)

      const result = await getFamilyMoments('family-001')

      expect(result).toEqual([])
    })

    it('should pass limit param when provided', async () => {
      const mockMoments = [makeMoment()]
      vi.mocked(api.get).mockResolvedValue(mockMoments)

      await getFamilyMoments('family-001', 10)

      expect(api.get).toHaveBeenCalledWith('/api/families/family-001/moments', { limit: '10' })
    })

    it('should not include limit param when not provided', async () => {
      vi.mocked(api.get).mockResolvedValue([makeMoment()])

      await getFamilyMoments('family-001')

      const callArgs = vi.mocked(api.get).mock.calls[0][1] as Record<string, string>
      expect(callArgs.limit).toBeUndefined()
    })
  })

  describe('getNewMoments', () => {
    it('should call API with correct URL and since param', async () => {
      const mockMoments = [makeMoment({ id: 'moment_003' })]
      vi.mocked(api.get).mockResolvedValue(mockMoments)

      const result = await getNewMoments('family-001', '2024-01-15T00:00:00.000Z')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('moment_003')
      expect(api.get).toHaveBeenCalledWith(
        '/api/families/family-001/moments/new',
        { since: '2024-01-15T00:00:00.000Z' }
      )
    })

    it('should return empty array when API returns null', async () => {
      vi.mocked(api.get).mockResolvedValue(null)

      const result = await getNewMoments('family-001', '2024-01-15T00:00:00.000Z')

      expect(result).toEqual([])
    })
  })

  describe('formatMomentTime', () => {
    const baseTime = new Date('2024-01-15T12:00:00.000Z')

    beforeEach(() => {
      vi.setSystemTime(baseTime)
    })

    it('returns 刚刚 for time < 1 minute ago', () => {
      expect(formatMomentTime('2024-01-15T11:59:30.000Z')).toBe('刚刚')
    })

    it('returns X分钟前 for time < 60 minutes', () => {
      expect(formatMomentTime('2024-01-15T11:55:00.000Z')).toBe('5分钟前')
      expect(formatMomentTime('2024-01-15T11:20:00.000Z')).toBe('40分钟前')
      expect(formatMomentTime('2024-01-15T11:01:00.000Z')).toBe('59分钟前')
    })

    it('returns X小时前 for time < 24 hours', () => {
      expect(formatMomentTime('2024-01-15T11:00:00.000Z')).toBe('1小时前')
      expect(formatMomentTime('2024-01-15T06:00:00.000Z')).toBe('6小时前')
      expect(formatMomentTime('2024-01-14T13:00:00.000Z')).toBe('23小时前')
    })

    it('returns X天前 for time < 7 days', () => {
      expect(formatMomentTime('2024-01-14T12:00:00.000Z')).toBe('1天前')
      expect(formatMomentTime('2024-01-13T12:00:00.000Z')).toBe('2天前')
      expect(formatMomentTime('2024-01-09T12:00:00.000Z')).toBe('6天前')
    })

    it('returns M月D日 for time >= 7 days', () => {
      expect(formatMomentTime('2024-01-08T12:00:00.000Z')).toBe('1月8日')
      expect(formatMomentTime('2024-01-01T12:00:00.000Z')).toBe('1月1日')
      expect(formatMomentTime('2023-12-25T12:00:00.000Z')).toBe('12月25日')
    })

    it('handles date strings correctly', () => {
      vi.setSystemTime(new Date('2024-03-01T12:00:00.000Z'))

      expect(formatMomentTime('2024-02-29T12:00:00.000Z')).toBe('1天前')
      expect(formatMomentTime('2024-02-20T12:00:00.000Z')).toBe('2月20日')
    })
  })

  describe('getMomentTypeInfo', () => {
    it('returns correct icon/label for checkin', () => {
      expect(getMomentTypeInfo('checkin')).toEqual({ icon: '✅', label: '健康打卡' })
    })

    it('returns correct icon/label for milestone', () => {
      expect(getMomentTypeInfo('milestone')).toEqual({ icon: '🎉', label: '里程碑' })
    })

    it('returns correct icon/label for photo', () => {
      expect(getMomentTypeInfo('photo')).toEqual({ icon: '📷', label: '分享照片' })
    })

    it('returns correct icon/label for memory', () => {
      expect(getMomentTypeInfo('memory')).toEqual({ icon: '💭', label: '回忆' })
    })

    it('returns correct icon/label for ai_summary', () => {
      expect(getMomentTypeInfo('ai_summary')).toEqual({ icon: '🤖', label: 'AI周报' })
    })

    it('returns default icon/label for unknown type', () => {
      expect(getMomentTypeInfo('unknown_type')).toEqual({ icon: '📝', label: '动态' })
    })
  })
})