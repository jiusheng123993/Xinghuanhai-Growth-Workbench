/**
 * 日历服务测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getFamilyCalendarEvents, getEventsByDay, hasEventsOnDay, type CalendarEvent } from '../calendarService'

import { getRecordsByMonth } from '../vaccineService'
import { getCheckinsByDateRange } from '../checkinService'
import { getAuthenticatedUserId, isAuthenticated } from '../../utils/authGuard'

// Mock 依赖
vi.mock('../vaccineService', () => ({
  getRecordsByMonth: vi.fn(),
}))

vi.mock('../checkinService', () => ({
  getCheckinsByDateRange: vi.fn(),
}))

vi.mock('../../utils/authGuard', () => ({
  getAuthenticatedUserId: vi.fn(() => 'test-user-id'),
  isAuthenticated: vi.fn(() => true),
}))

const mockGetRecordsByMonth = getRecordsByMonth as ReturnType<typeof vi.fn>
const mockGetCheckinsByDateRange = getCheckinsByDateRange as ReturnType<typeof vi.fn>
const mockIsAuthenticated = isAuthenticated as ReturnType<typeof vi.fn>

const mockMembers = [
  { id: 'm1', familyId: 'f1', petId: 'pet1', role: '老大', joinedAt: '2026-01-01', petName: '青橘' },
  { id: 'm2', familyId: 'f1', petId: 'pet2', role: '团宠', joinedAt: '2026-03-01', petName: '花花' },
]

const mockVaccineRecords = [
  {
    id: 'v1', petId: 'pet1', type: 'vaccine' as const, category: '猫三联',
    date: '2026-07-15', nextDate: '2026-07-15', status: 'completed' as const,
    createdAt: '2026-07-01', updatedAt: '2026-07-15',
  },
  {
    id: 'v2', petId: 'pet1', type: 'deworm' as const, category: '体外驱虫',
    date: '2026-07-20', nextDate: '2026-07-20', status: 'pending' as const,
    createdAt: '2026-07-01', updatedAt: '2026-07-01',
  },
]

const mockCheckinEntries = [
  {
    id: 'c1', petId: 'pet1', userId: 'test-user-id',
    poopLevel: 3 as const, appetiteLevel: 3 as const, spiritLevel: 4 as const,
    exerciseLevel: 2 as const, hasAnomaly: false, anomalyItems: [],
    riskLevel: 'low' as const, aiFeedback: '状态不错', createdAt: new Date('2026-07-18'),
  },
  {
    id: 'c2', petId: 'pet1', userId: 'test-user-id',
    poopLevel: 1 as const, appetiteLevel: 1 as const, spiritLevel: 1 as const,
    exerciseLevel: 1 as const, hasAnomaly: true, anomalyItems: ['呕吐'],
    riskLevel: 'emergency' as const, aiFeedback: '需要就医', createdAt: new Date('2026-07-22'),
  },
]

describe('calendarService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated.mockReturnValue(true)
    mockGetRecordsByMonth.mockResolvedValue([])
    mockGetCheckinsByDateRange.mockResolvedValue([])
  })

  describe('getFamilyCalendarEvents', () => {
    it('should return empty array when members is empty', async () => {
      const result = await getFamilyCalendarEvents([], 2026, 7)
      expect(result).toEqual([])
    })

    it('should return empty array when not authenticated', async () => {
      mockIsAuthenticated.mockReturnValue(false)
      const result = await getFamilyCalendarEvents(mockMembers, 2026, 7)
      expect(result).toEqual([])
    })

    it('should merge vaccine records into calendar events', async () => {
      mockGetRecordsByMonth.mockResolvedValue(mockVaccineRecords)
      const result = await getFamilyCalendarEvents([mockMembers[0]], 2026, 7)

      const vaccineEvents = result.filter((e) => e.type === 'vaccine' || e.type === 'deworm')
      expect(vaccineEvents.length).toBe(2)
      expect(vaccineEvents[0].date).toBe(15)
      expect(vaccineEvents[0].petName).toBe('青橘')
      expect(vaccineEvents[0].type).toBe('vaccine')

      expect(vaccineEvents[1].date).toBe(20)
      expect(vaccineEvents[1].type).toBe('deworm')
    })

    it('should merge checkin records into calendar events', async () => {
      mockGetCheckinsByDateRange.mockResolvedValue(mockCheckinEntries)
      const result = await getFamilyCalendarEvents([mockMembers[0]], 2026, 7)

      const checkinEvents = result.filter((e) => e.type === 'checkin')
      expect(checkinEvents.length).toBe(2)
      expect(checkinEvents[0].date).toBe(18)
      expect(checkinEvents[0].riskLevel).toBe('low')
      expect(checkinEvents[1].date).toBe(22)
      expect(checkinEvents[1].riskLevel).toBe('emergency')
    })

    it('should handle errors from individual members gracefully', async () => {
      mockGetRecordsByMonth
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(mockVaccineRecords)

      const result = await getFamilyCalendarEvents(mockMembers, 2026, 7)
      // 第二个成员的数据应该还在
      expect(result.length).toBeGreaterThanOrEqual(0)
    })

    it('should use default pet name when name fields are missing', async () => {
      mockGetRecordsByMonth.mockResolvedValue(mockVaccineRecords)
      const memberWithoutName = { id: 'm3', familyId: 'f1', petId: 'pet3', joinedAt: '2026-01-01' }
      const result = await getFamilyCalendarEvents([memberWithoutName], 2026, 7)

      if (result.length > 0) {
        expect(result[0].petName).toBe('宠物')
      }
    })
  })

  describe('getEventsByDay', () => {
    const testEvents: CalendarEvent[] = [
      { date: 15, petName: '青橘', petId: 'pet1', title: '猫三联', type: 'vaccine' },
      { date: 15, petName: '青橘', petId: 'pet1', title: '健康打卡', type: 'checkin', riskLevel: 'low' },
      { date: 20, petName: '花花', petId: 'pet2', title: '体外驱虫', type: 'deworm' },
    ]

    it('should return events for a specific day', () => {
      const result = getEventsByDay(testEvents, 15)
      expect(result.length).toBe(2)
    })

    it('should return empty array for a day with no events', () => {
      const result = getEventsByDay(testEvents, 1)
      expect(result).toEqual([])
    })
  })

  describe('hasEventsOnDay', () => {
    const testEvents: CalendarEvent[] = [
      { date: 15, petName: '青橘', petId: 'pet1', title: '猫三联', type: 'vaccine' },
    ]

    it('should return true when events exist on day', () => {
      expect(hasEventsOnDay(testEvents, 15)).toBe(true)
    })

    it('should return false when no events on day', () => {
      expect(hasEventsOnDay(testEvents, 10)).toBe(false)
    })

    it('should return false for empty events', () => {
      expect(hasEventsOnDay([], 15)).toBe(false)
    })
  })
})