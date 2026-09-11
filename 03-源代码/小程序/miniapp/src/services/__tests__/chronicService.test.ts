/**
 * 慢病管理服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  getChronicRecords,
  addChronicRecord,
  updateChronicRecord,
  deleteChronicRecord,
  getChronicStats,
  getUpcomingCheckups,
  getChronicTrendData,
  generateChronicReminderPayload,
} from '../chronicService'
import { getSyncService } from '../syncService'
import type { ChronicRecord } from '../../types/chronicTypes'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStorage: Record<string, string> = {}

vi.mock('../../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = JSON.stringify(value)
  }),
}))

const mockQueueForSync = vi.fn()

vi.mock('../syncService', () => ({
  getSyncService: vi.fn(() => ({
    queueForSync: mockQueueForSync,
  })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'chronic_records'
const FIXED_NOW = new Date('2026-07-25T10:00:00.000Z')

function makeRecord(overrides: Partial<ChronicRecord> = {}): ChronicRecord {
  return {
    id: 'rec_001',
    petId: 'pet-001',
    condition: '糖尿病',
    diagnosedDate: '2025-01-01',
    severity: 'moderate',
    status: 'active',
    medications: ['胰岛素'],
    vetName: '张医生',
    vetContact: '13800138000',
    nextCheckupDate: '2026-08-01',
    notes: '定期复查',
    symptoms: ['多饮多尿'],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeInputData(
  overrides: Partial<Omit<ChronicRecord, 'id' | 'petId' | 'createdAt' | 'updatedAt'>> = {}
): Omit<ChronicRecord, 'id' | 'petId' | 'createdAt' | 'updatedAt'> {
  return {
    condition: '糖尿病',
    diagnosedDate: '2025-01-01',
    severity: 'moderate',
    status: 'active',
    medications: ['胰岛素'],
    vetName: '张医生',
    vetContact: '13800138000',
    nextCheckupDate: '2026-08-01',
    notes: '定期复查',
    symptoms: ['多饮多尿'],
    ...overrides,
  }
}

function seedRecords(petId: string, records: ChronicRecord[]): void {
  const existing = JSON.parse(mockStorage[STORAGE_KEY] || '{}')
  existing[petId] = records
  mockStorage[STORAGE_KEY] = JSON.stringify(existing)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skip('chronicService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  // =========================================================================
  // getChronicRecords
  // =========================================================================
  describe('getChronicRecords', () => {
    it('returns empty array when no records exist', () => {
      const result = getChronicRecords('pet-001', 'user-001')
      expect(result).toEqual([])
    })

    it('returns records for specific petId', () => {
      const r1 = makeRecord({ id: 'r1', petId: 'pet-001' })
      const r2 = makeRecord({ id: 'r2', petId: 'pet-001' })
      seedRecords('pet-001', [r1, r2])

      const result = getChronicRecords('pet-001', 'user-001')

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('r1')
      expect(result[1].id).toBe('r2')
    })

    it('isolates records by petId', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001' })])
      seedRecords('pet-002', [makeRecord({ id: 'r2', petId: 'pet-002' })])

      expect(getChronicRecords('pet-001', 'user-001')).toHaveLength(1)
      expect(getChronicRecords('pet-002', 'user-001')).toHaveLength(1)
      expect(getChronicRecords('pet-003', 'user-001')).toEqual([])
    })
  })

  // =========================================================================
  // addChronicRecord
  // =========================================================================
  describe('addChronicRecord', () => {
    it('creates new record with generated id', () => {
      const data = makeInputData()

      const record = addChronicRecord('pet-001', 'user-001', data)

      expect(record.id).toBeTruthy()
      expect(typeof record.id).toBe('string')
      expect(record.id.length).toBeGreaterThan(0)
    })

    it('sets petId, createdAt, updatedAt automatically', () => {
      const data = makeInputData()

      const record = addChronicRecord('pet-001', 'user-001', data)

      expect(record.petId).toBe('pet-001')
      expect(record.createdAt).toBe(FIXED_NOW.toISOString())
      expect(record.updatedAt).toBe(FIXED_NOW.toISOString())
    })

    it('preserves provided data fields', () => {
      const data = makeInputData({
        condition: '心脏病',
        severity: 'severe',
        status: 'active',
      })

      const record = addChronicRecord('pet-001', 'user-001', data)

      expect(record.condition).toBe('心脏病')
      expect(record.severity).toBe('severe')
      expect(record.status).toBe('active')
      expect(record.medications).toEqual(['胰岛素'])
      expect(record.vetName).toBe('张医生')
    })

    it('prepends to existing records (newest first)', () => {
      seedRecords('pet-001', [makeRecord({ id: 'old_1', petId: 'pet-001' })])

      const record = addChronicRecord('pet-001', 'user-001', makeInputData())

      const all = getChronicRecords('pet-001', 'user-001')
      expect(all).toHaveLength(2)
      expect(all[0].id).toBe(record.id)
      expect(all[1].id).toBe('old_1')
    })

    it('persists to storage', () => {
      addChronicRecord('pet-001', 'user-001', makeInputData())

      const all = getChronicRecords('pet-001', 'user-001')
      expect(all).toHaveLength(1)
    })

    it('queues record for sync', () => {
      const record = addChronicRecord('pet-001', 'user-001', makeInputData())

      expect(mockQueueForSync).toHaveBeenCalledWith(
        'pet_health_entries',
        record.id,
        'insert',
        record
      )
    })
  })

  // =========================================================================
  // updateChronicRecord
  // =========================================================================
  describe('updateChronicRecord', () => {
    it('updates existing record fields', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001', condition: '糖尿病' })])

      const updated = updateChronicRecord('pet-001', 'user-001', 'r1', {
        condition: '心脏病',
        severity: 'severe',
      })

      expect(updated).not.toBeNull()
      expect(updated!.condition).toBe('心脏病')
      expect(updated!.severity).toBe('severe')
      expect(updated!.id).toBe('r1')
      expect(updated!.petId).toBe('pet-001')
    })

    it('updates updatedAt timestamp', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', petId: 'pet-001', updatedAt: '2025-01-01T00:00:00.000Z' }),
      ])

      const updated = updateChronicRecord('pet-001', 'user-001', 'r1', { condition: '心脏病' })

      expect(updated!.updatedAt).toBe(FIXED_NOW.toISOString())
    })

    it('does not modify other fields', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001', vetName: '张医生' })])

      const updated = updateChronicRecord('pet-001', 'user-001', 'r1', { condition: '心脏病' })

      expect(updated!.vetName).toBe('张医生')
      expect(updated!.diagnosedDate).toBe('2025-01-01')
    })

    it('returns null when petId has no records', () => {
      const result = updateChronicRecord('pet-001', 'user-001', 'r1', { condition: '心脏病' })

      expect(result).toBeNull()
    })

    it('returns null when recordId not found', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001' })])

      const result = updateChronicRecord('pet-001', 'user-001', 'nonexistent', { condition: '心脏病' })

      expect(result).toBeNull()
    })

    it('persists update to storage', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001' })])

      updateChronicRecord('pet-001', 'user-001', 'r1', { condition: '心脏病' })

      const all = getChronicRecords('pet-001', 'user-001')
      expect(all[0].condition).toBe('心脏病')
    })

    it('queues record for sync', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001' })])

      const updated = updateChronicRecord('pet-001', 'user-001', 'r1', { condition: '心脏病' })

      expect(mockQueueForSync).toHaveBeenCalledWith(
        'pet_health_entries',
        'r1',
        'update',
        updated
      )
    })
  })

  // =========================================================================
  // deleteChronicRecord
  // =========================================================================
  describe('deleteChronicRecord', () => {
    it('removes record from array', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', petId: 'pet-001' }),
        makeRecord({ id: 'r2', petId: 'pet-001' }),
      ])

      const result = deleteChronicRecord('pet-001', 'user-001', 'r1')

      expect(result).toBe(true)
      const all = getChronicRecords('pet-001', 'user-001')
      expect(all).toHaveLength(1)
      expect(all[0].id).toBe('r2')
    })

    it('returns true on success', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001' })])

      const result = deleteChronicRecord('pet-001', 'user-001', 'r1')

      expect(result).toBe(true)
    })

    it('returns false when petId has no records', () => {
      const result = deleteChronicRecord('pet-001', 'user-001', 'r1')

      expect(result).toBe(false)
    })

    it('returns false when recordId not found', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001' })])

      const result = deleteChronicRecord('pet-001', 'user-001', 'nonexistent')

      expect(result).toBe(false)
    })

    it('does not modify storage when recordId not found', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001' })])

      deleteChronicRecord('pet-001', 'user-001', 'nonexistent')

      const all = getChronicRecords('pet-001', 'user-001')
      expect(all).toHaveLength(1)
    })

    it('queues delete for sync', () => {
      seedRecords('pet-001', [makeRecord({ id: 'r1', petId: 'pet-001' })])

      deleteChronicRecord('pet-001', 'user-001', 'r1')

      expect(mockQueueForSync).toHaveBeenCalledWith(
        'pet_health_entries',
        'r1',
        'delete',
        { id: 'r1' }
      )
    })
  })

  // =========================================================================
  // getChronicStats
  // =========================================================================
  describe('getChronicStats', () => {
    it('returns correct counts for active/managed/resolved', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'active' }),
        makeRecord({ id: 'r2', status: 'active' }),
        makeRecord({ id: 'r3', status: 'managed' }),
        makeRecord({ id: 'r4', status: 'resolved' }),
      ])

      const stats = getChronicStats('pet-001', 'user-001')

      expect(stats.active).toBe(2)
      expect(stats.managed).toBe(1)
      expect(stats.resolved).toBe(1)
      expect(stats.total).toBe(4)
    })

    it('counts overdue checkups (nextCheckupDate < now, status != resolved)', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'active', nextCheckupDate: '2026-07-01' }),
        makeRecord({ id: 'r2', status: 'managed', nextCheckupDate: '2026-06-01' }),
        makeRecord({ id: 'r3', status: 'resolved', nextCheckupDate: '2026-06-01' }),
        makeRecord({ id: 'r4', status: 'active', nextCheckupDate: '2026-09-01' }),
      ])

      const stats = getChronicStats('pet-001', 'user-001')

      expect(stats.overdueCheckups).toBe(2)
    })

    it('excludes records without nextCheckupDate from overdue count', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'active', nextCheckupDate: '' }),
      ])

      const stats = getChronicStats('pet-001', 'user-001')

      expect(stats.overdueCheckups).toBe(0)
    })

    it('returns zeros for empty records', () => {
      const stats = getChronicStats('pet-001', 'user-001')

      expect(stats.active).toBe(0)
      expect(stats.managed).toBe(0)
      expect(stats.resolved).toBe(0)
      expect(stats.total).toBe(0)
      expect(stats.overdueCheckups).toBe(0)
    })
  })

  // =========================================================================
  // getUpcomingCheckups
  // =========================================================================
  describe('getUpcomingCheckups', () => {
    it('returns checkups within daysAhead range', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'active', nextCheckupDate: '2026-07-26' }),
        makeRecord({ id: 'r2', status: 'active', nextCheckupDate: '2026-08-10' }),
      ])

      const result = getUpcomingCheckups('pet-001', 'user-001', 7)

      expect(result).toHaveLength(1)
      expect(result[0].record.id).toBe('r1')
    })

    it('marks overdue when daysUntil < 0', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'active', nextCheckupDate: '2026-07-20' }),
      ])

      const result = getUpcomingCheckups('pet-001', 'user-001', 7)

      expect(result).toHaveLength(1)
      expect(result[0].isOverdue).toBe(true)
      expect(result[0].daysUntil).toBeLessThan(0)
    })

    it('sorts by daysUntil ascending', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'active', nextCheckupDate: '2026-07-30' }),
        makeRecord({ id: 'r2', status: 'active', nextCheckupDate: '2026-07-26' }),
      ])

      const result = getUpcomingCheckups('pet-001', 'user-001', 7)

      expect(result).toHaveLength(2)
      expect(result[0].record.id).toBe('r2')
      expect(result[1].record.id).toBe('r1')
    })

    it('skips resolved records', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'resolved', nextCheckupDate: '2026-07-26' }),
      ])

      const result = getUpcomingCheckups('pet-001', 'user-001', 7)

      expect(result).toHaveLength(0)
    })

    it('skips records without nextCheckupDate', () => {
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'active', nextCheckupDate: '' }),
      ])

      const result = getUpcomingCheckups('pet-001', 'user-001', 7)

      expect(result).toHaveLength(0)
    })

    it('applies daysAhead filter correctly', () => {
      // 2026-07-25 is today; Aug 1 is 7 days ceil away → daysUntil=7, within 7
      // Aug 2 is 8 days ceil away → daysUntil=8, outside 7
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'active', nextCheckupDate: '2026-08-01' }),
        makeRecord({ id: 'r2', status: 'active', nextCheckupDate: '2026-08-02' }),
      ])

      const result = getUpcomingCheckups('pet-001', 'user-001', 7)

      expect(result).toHaveLength(1)
      expect(result[0].record.id).toBe('r1')
    })

    it('returns empty array when no records exist', () => {
      const result = getUpcomingCheckups('pet-001', 'user-001', 7)

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // getChronicTrendData
  // =========================================================================
  describe('getChronicTrendData', () => {
    it('returns array of length = days', () => {
      seedRecords('pet-001', [makeRecord({ status: 'active' })])

      const result = getChronicTrendData('pet-001', 'user-001', 10)

      expect(result).toHaveLength(10)
    })

    it('each entry has date, conditions, severityCounts', () => {
      seedRecords('pet-001', [makeRecord({ status: 'active' })])

      const result = getChronicTrendData('pet-001', 'user-001', 3)

      for (const entry of result) {
        expect(entry).toHaveProperty('date')
        expect(entry).toHaveProperty('conditions')
        expect(entry).toHaveProperty('severityCounts')
        expect(typeof entry.date).toBe('string')
        expect(Array.isArray(entry.conditions)).toBe(true)
        expect(typeof entry.severityCounts).toBe('object')
      }
    })

    it('correctly tracks active conditions on each date', () => {
      // Record diagnosed on 2025-01-01, not resolved → active on all dates
      seedRecords('pet-001', [
        makeRecord({ id: 'r1', status: 'active', diagnosedDate: '2025-01-01', condition: '糖尿病' }),
      ])

      const result = getChronicTrendData('pet-001', 'user-001', 3)

      for (const entry of result) {
        expect(entry.conditions).toContain('糖尿病')
        expect(entry.severityCounts.moderate).toBeGreaterThanOrEqual(1)
      }
    })

    it('excludes resolved records after their resolution date', () => {
      // Resolved on 2026-07-20 → should not appear for dates after that
      seedRecords('pet-001', [
        makeRecord({
          id: 'r1',
          status: 'resolved',
          diagnosedDate: '2025-01-01',
          updatedAt: '2026-07-20T00:00:00.000Z',
          condition: '皮肤病',
        }),
      ])

      const result = getChronicTrendData('pet-001', 'user-001', 30)

      // The last entry should be today (2026-07-25), which is after resolved date
      const lastEntry = result[result.length - 1]
      expect(lastEntry.conditions).not.toContain('皮肤病')
    })

    it('returns empty arrays for conditions when no records', () => {
      const result = getChronicTrendData('pet-001', 'user-001', 5)

      expect(result).toHaveLength(5)
      for (const entry of result) {
        expect(entry.conditions).toEqual([])
        expect(entry.severityCounts).toEqual({ mild: 0, moderate: 0, severe: 0 })
      }
    })

    it('uses default days=30', () => {
      seedRecords('pet-001', [makeRecord({ status: 'active' })])

      const result = getChronicTrendData('pet-001', 'user-001')

      expect(result).toHaveLength(30)
    })
  })

  // =========================================================================
  // generateChronicReminderPayload
  // =========================================================================
  describe('generateChronicReminderPayload', () => {
    it('returns overdue message when daysUntil < 0', () => {
      const record = makeRecord({ condition: '糖尿病' })
      const payload = generateChronicReminderPayload(record, '小白', -3)

      expect(payload.title).toBe('小白 复查已逾期')
      expect(payload.content).toContain('3 天')
      expect(payload.isUrgent).toBe(true)
    })

    it('returns today message when daysUntil === 0', () => {
      const record = makeRecord({ condition: '糖尿病' })
      const payload = generateChronicReminderPayload(record, '小白', 0)

      expect(payload.title).toBe('小白 今天需要复查')
      expect(payload.content).toContain('今天')
      expect(payload.isUrgent).toBe(true)
    })

    it('returns reminder message when daysUntil <= 3', () => {
      const record = makeRecord({ condition: '糖尿病' })
      const payload = generateChronicReminderPayload(record, '小白', 2)

      expect(payload.title).toBe('小白 复查提醒')
      expect(payload.content).toContain('2 天')
      expect(payload.content).toContain('糖尿病')
      expect(payload.isUrgent).toBe(false)
    })

    it('returns normal reminder when daysUntil > 3', () => {
      const record = makeRecord({ condition: '糖尿病', nextCheckupDate: '2026-08-15' })
      const payload = generateChronicReminderPayload(record, '小白', 10)

      expect(payload.title).toBe('小白 复查提醒')
      expect(payload.content).toContain('2026-08-15')
      expect(payload.content).toContain('10 天')
      expect(payload.isUrgent).toBe(false)
    })

    it('isUrgent is true for overdue and today', () => {
      const record = makeRecord({ condition: '糖尿病' })

      expect(generateChronicReminderPayload(record, '小白', -1).isUrgent).toBe(true)
      expect(generateChronicReminderPayload(record, '小白', 0).isUrgent).toBe(true)
      expect(generateChronicReminderPayload(record, '小白', 1).isUrgent).toBe(false)
      expect(generateChronicReminderPayload(record, '小白', 3).isUrgent).toBe(false)
      expect(generateChronicReminderPayload(record, '小白', 7).isUrgent).toBe(false)
    })
  })
})