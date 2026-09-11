/**
 * 提醒服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import Taro from '@tarojs/taro'
import {
  checkUpcomingReminders,
  requestSubscribeMessage,
  saveSubscriptionStatus,
  getSubscriptionStatus,
  scheduleLocalReminder,
  getOverdueReminders,
  getUpcomingReminders,
  getLocalReminders,
  markReminderTriggered,
  clearLocalReminders,
  VACCINE_REMINDER_TEMPLATE_ID,
} from '../reminderService'
import type { VaccineRecord } from '../vaccineService'

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
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    requestSubscribeMessage: vi.fn(),
    getStorageSync: vi.fn(),
    setStorageSync: vi.fn(),
  },
}))

const today = new Date().toISOString().split('T')[0]

function makeRecord(overrides: Partial<VaccineRecord> = {}): VaccineRecord {
  return {
    id: 'rec_001',
    petId: 'pet-001',
    type: 'vaccine',
    category: 'rabies',
    date: today,
    nextDate: '2026-07-18',
    status: 'pending',
    createdAt: '2025-07-18T00:00:00.000Z',
    updatedAt: '2025-07-18T00:00:00.000Z',
    ...overrides,
  }
}

function seedVaccineRecords(petId: string, records: VaccineRecord[]): void {
  mockStorage[`xhh_vaccines_${petId}`] = JSON.stringify(records)
}

describe('reminderService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  describe('VACCINE_REMINDER_TEMPLATE_ID', () => {
    it('should have placeholder template id', () => {
      expect(VACCINE_REMINDER_TEMPLATE_ID).toBe('VACCINE_REMINDER_TEMPLATE_ID_PLACEHOLDER')
    })
  })

  describe('saveSubscriptionStatus / getSubscriptionStatus', () => {
    it('should save and retrieve subscription status', () => {
      saveSubscriptionStatus(true)
      expect(getSubscriptionStatus()).toBe(true)
    })

    it('should return false when no subscription status saved', () => {
      expect(getSubscriptionStatus()).toBe(false)
    })

    it('should overwrite previous subscription status', () => {
      saveSubscriptionStatus(true)
      expect(getSubscriptionStatus()).toBe(true)
      saveSubscriptionStatus(false)
      expect(getSubscriptionStatus()).toBe(false)
    })
  })

  describe('requestSubscribeMessage', () => {
    it('should return true when user accepts subscription', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [VACCINE_REMINDER_TEMPLATE_ID]: 'accept',
      } as unknown as Awaited<ReturnType<typeof Taro.requestSubscribeMessage>>)

      const result = await requestSubscribeMessage()

      expect(result).toBe(true)
      expect(getSubscriptionStatus()).toBe(true)
    })

    it('should return false when user rejects subscription', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [VACCINE_REMINDER_TEMPLATE_ID]: 'reject',
      } as unknown as Awaited<ReturnType<typeof Taro.requestSubscribeMessage>>)

      const result = await requestSubscribeMessage()

      expect(result).toBe(false)
      expect(getSubscriptionStatus()).toBe(false)
    })

    it('should return false when request throws error', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockRejectedValue(new Error('User denied'))

      const result = await requestSubscribeMessage()

      expect(result).toBe(false)
    })

    it('should call Taro.requestSubscribeMessage with correct template id', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof Taro.requestSubscribeMessage>>)

      await requestSubscribeMessage()

      expect(Taro.requestSubscribeMessage).toHaveBeenCalledWith({
        tmplIds: [VACCINE_REMINDER_TEMPLATE_ID],
      } as Parameters<typeof Taro.requestSubscribeMessage>[0])
    })
  })

  describe('checkUpcomingReminders', () => {
    it('should return overdue records as reminders', () => {
      const overdueRecord = makeRecord({ nextDate: '2023-01-01', status: 'overdue' })
      seedVaccineRecords('pet-001', [overdueRecord])

      const result = checkUpcomingReminders('pet-001')

      expect(result).toHaveLength(1)
      expect(result[0].record.id).toBe('rec_001')
      expect(result[0].isOverdue).toBe(true)
      expect(result[0].daysUntilDue).toBeLessThan(0)
    })

    it('should not return completed records', () => {
      const completedRecord = makeRecord({ status: 'completed', nextDate: '2023-01-01' })
      seedVaccineRecords('pet-001', [completedRecord])

      const result = checkUpcomingReminders('pet-001')

      expect(result).toHaveLength(0)
    })

    it('should not return future pending records', () => {
      const futureRecord = makeRecord({ nextDate: '2099-12-31', status: 'pending' })
      seedVaccineRecords('pet-001', [futureRecord])

      const result = checkUpcomingReminders('pet-001')

      expect(result).toHaveLength(0)
    })

    it('should return empty array when no records exist', () => {
      const result = checkUpcomingReminders('pet-001')

      expect(result).toEqual([])
    })
  })

  describe('getOverdueReminders', () => {
    it('should return only overdue reminders', () => {
      const overdueRecord = makeRecord({ id: 'r1', nextDate: '2023-01-01', status: 'overdue' })
      const futureRecord = makeRecord({ id: 'r2', nextDate: '2099-12-31', status: 'pending' })
      const completedRecord = makeRecord({ id: 'r3', status: 'completed', nextDate: '2023-01-01' })
      seedVaccineRecords('pet-001', [overdueRecord, futureRecord, completedRecord])

      const result = getOverdueReminders('pet-001')

      expect(result).toHaveLength(1)
      expect(result[0].record.id).toBe('r1')
      expect(result[0].isOverdue).toBe(true)
    })

    it('should return empty array when no overdue records', () => {
      const futureRecord = makeRecord({ nextDate: '2099-12-31', status: 'pending' })
      seedVaccineRecords('pet-001', [futureRecord])

      const result = getOverdueReminders('pet-001')

      expect(result).toHaveLength(0)
    })

    it('should return empty array when no records exist', () => {
      const result = getOverdueReminders('pet-001')

      expect(result).toEqual([])
    })
  })

  describe('getUpcomingReminders', () => {
    it('should return reminders within specified days', () => {
      const nearFuture = new Date()
      nearFuture.setDate(nearFuture.getDate() + 3)
      const nearFutureStr = nearFuture.toISOString().split('T')[0]

      const nearRecord = makeRecord({ id: 'r1', nextDate: nearFutureStr, status: 'pending' })
      const farRecord = makeRecord({ id: 'r2', nextDate: '2099-12-31', status: 'pending' })
      seedVaccineRecords('pet-001', [nearRecord, farRecord])

      const result = getUpcomingReminders('pet-001', 7)

      expect(result).toHaveLength(1)
      expect(result[0].record.id).toBe('r1')
      expect(result[0].isOverdue).toBe(false)
      expect(result[0].daysUntilDue).toBeLessThanOrEqual(7)
    })

    it('should not return overdue records', () => {
      const overdueRecord = makeRecord({ nextDate: '2023-01-01', status: 'overdue' })
      seedVaccineRecords('pet-001', [overdueRecord])

      const result = getUpcomingReminders('pet-001', 30)

      expect(result).toHaveLength(0)
    })

    it('should not return completed records', () => {
      const nearFuture = new Date()
      nearFuture.setDate(nearFuture.getDate() + 3)
      const nearFutureStr = nearFuture.toISOString().split('T')[0]

      const completedRecord = makeRecord({ status: 'completed', nextDate: nearFutureStr })
      seedVaccineRecords('pet-001', [completedRecord])

      const result = getUpcomingReminders('pet-001', 7)

      expect(result).toHaveLength(0)
    })

    it('should return empty array when no records exist', () => {
      const result = getUpcomingReminders('pet-001', 7)

      expect(result).toEqual([])
    })

    it('should use default days parameter', () => {
      const nearFuture = new Date()
      nearFuture.setDate(nearFuture.getDate() + 5)
      const nearFutureStr = nearFuture.toISOString().split('T')[0]

      const record = makeRecord({ nextDate: nearFutureStr, status: 'pending' })
      seedVaccineRecords('pet-001', [record])

      const result = getUpcomingReminders('pet-001', 7)

      expect(result).toHaveLength(1)
    })
  })

  describe('scheduleLocalReminder', () => {
    it('should create a new local reminder', () => {
      const record = makeRecord()
      const reminder = scheduleLocalReminder(record, 3)

      expect(reminder.recordId).toBe('rec_001')
      expect(reminder.petId).toBe('pet-001')
      expect(reminder.category).toBe('rabies')
      expect(reminder.daysBefore).toBe(3)
      expect(reminder.triggered).toBe(false)
      expect(reminder.scheduledAt).toBeGreaterThan(0)
    })

    it('should update existing reminder for same record and daysBefore', () => {
      const record = makeRecord()
      const first = scheduleLocalReminder(record, 3)
      const second = scheduleLocalReminder(record, 3)

      const reminders = getLocalReminders()
      expect(reminders).toHaveLength(1)
      expect(second.scheduledAt).toBeGreaterThanOrEqual(first.scheduledAt)
    })

    it('should allow different daysBefore for same record', () => {
      const record = makeRecord()
      scheduleLocalReminder(record, 3)
      scheduleLocalReminder(record, 7)

      const reminders = getLocalReminders()
      expect(reminders).toHaveLength(2)
    })
  })

  describe('getLocalReminders', () => {
    it('should return empty array when no reminders', () => {
      expect(getLocalReminders()).toEqual([])
    })

    it('should return all saved reminders', () => {
      const record = makeRecord()
      scheduleLocalReminder(record, 3)
      scheduleLocalReminder(record, 7)

      const reminders = getLocalReminders()
      expect(reminders).toHaveLength(2)
    })
  })

  describe('markReminderTriggered', () => {
    it('should mark reminder as triggered', () => {
      const record = makeRecord()
      scheduleLocalReminder(record, 3)

      markReminderTriggered('rec_001')

      const reminders = getLocalReminders()
      expect(reminders[0].triggered).toBe(true)
    })

    it('should not throw when reminder not found', () => {
      expect(() => markReminderTriggered('nonexistent')).not.toThrow()
    })
  })

  describe('clearLocalReminders', () => {
    it('should clear reminders for specific pet', () => {
      const record1 = makeRecord({ petId: 'pet-001' })
      const record2 = makeRecord({ id: 'rec_002', petId: 'pet-002' })
      scheduleLocalReminder(record1, 3)
      scheduleLocalReminder(record2, 3)

      clearLocalReminders('pet-001')

      const reminders = getLocalReminders()
      expect(reminders).toHaveLength(1)
      expect(reminders[0].petId).toBe('pet-002')
    })

    it('should not affect other pets reminders', () => {
      const record1 = makeRecord({ petId: 'pet-001' })
      const record2 = makeRecord({ id: 'rec_002', petId: 'pet-002' })
      scheduleLocalReminder(record1, 3)
      scheduleLocalReminder(record2, 7)

      clearLocalReminders('pet-001')

      const reminders = getLocalReminders()
      expect(reminders).toHaveLength(1)
      expect(reminders[0].petId).toBe('pet-002')
      expect(reminders[0].daysBefore).toBe(7)
    })
  })
})
