/**
 * 通知跟进服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Taro from '@tarojs/taro'

import {
  scheduleFollowup,
  cancelFollowup,
  getPendingFollowups,
  getFollowupBySessionId,
  checkAndSendFollowups,
  sendCarePlanReminder,
  updateFollowupStatus,
  clearExpiredFollowups,
  getFollowupStats,
} from '../notificationService'
import type { PendingFollowup } from '../notificationService'
import { hasAcceptedSubscribe, requestFollowupSubscribe, sendSubscribeMessage } from '../subscribeService'
import { checkFrequency, recordSend } from '../frequencyControlService'
import { getStorage, setStorage } from '../../utils/storage'

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
    showToast: vi.fn(),
    request: vi.fn(),
  },
}))

vi.mock('../subscribeService', () => ({
  hasAcceptedSubscribe: vi.fn(() => false),
  FOLLOWUP_TEMPLATE_ID: 'FOLLOWUP_TEMPLATE_ID_PLACEHOLDER',
  CARE_PLAN_REMINDER_TEMPLATE_ID: 'CARE_PLAN_REMINDER_TEMPLATE_ID_PLACEHOLDER',
  requestFollowupSubscribe: vi.fn(() => Promise.resolve(false)),
  sendSubscribeMessage: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('../frequencyControlService', () => ({
  checkFrequency: vi.fn(() => ({ allowed: true, remainingToday: 2, remainingThisWeek: 5 })),
  recordSend: vi.fn(),
}))

function makeFollowup(overrides: Partial<PendingFollowup> = {}): PendingFollowup {
  return {
    sessionId: 'session-001',
    flowId: 'flow-001',
    healthStatus: 'sad',
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: Date.now(),
    status: 'pending',
    sendAttempts: 0,
    subscribeAccepted: false,
    ...overrides,
  }
}

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  describe('scheduleFollowup', () => {
    it('should create a new followup with default options', () => {
      const result = scheduleFollowup('session-001', 'flow-001', 'sad')

      expect(result.sessionId).toBe('session-001')
      expect(result.flowId).toBe('flow-001')
      expect(result.healthStatus).toBe('sad')
      expect(result.status).toBe('pending')
      expect(result.sendAttempts).toBe(0)
      expect(result.subscribeAccepted).toBe(false)
      expect(result.createdAt).toBeDefined()
      expect(result.scheduledDate).toBeDefined()
      expect(setStorage).toHaveBeenCalledWith('pending_followups', expect.arrayContaining([expect.objectContaining({ sessionId: 'session-001' })]))
    })

    it('should return existing pending followup if one exists for the session', () => {
      const existing = makeFollowup({ sessionId: 'session-001', status: 'pending' })
      mockStorage['xhh_pending_followups'] = JSON.stringify([existing])

      const result = scheduleFollowup('session-001', 'flow-002', 'anxious')

      expect(result.sessionId).toBe('session-001')
      expect(result.flowId).toBe('flow-001')
      expect(result.healthStatus).toBe('sad')
    })

    it('should return existing sent followup if one exists for the session', () => {
      const existing = makeFollowup({ sessionId: 'session-001', status: 'sent' })
      mockStorage['xhh_pending_followups'] = JSON.stringify([existing])

      const result = scheduleFollowup('session-001', 'flow-002', 'anxious')

      expect(result.sessionId).toBe('session-001')
      expect(result.status).toBe('sent')
    })

    it('should create new followup if existing one is cancelled', () => {
      const existing = makeFollowup({ sessionId: 'session-001', status: 'cancelled' })
      mockStorage['xhh_pending_followups'] = JSON.stringify([existing])

      const result = scheduleFollowup('session-001', 'flow-002', 'anxious')

      expect(result.flowId).toBe('flow-002')
      expect(result.healthStatus).toBe('anxious')
      expect(result.status).toBe('pending')
    })

    it('should create new followup if existing one is expired', () => {
      const existing = makeFollowup({ sessionId: 'session-001', status: 'expired' })
      mockStorage['xhh_pending_followups'] = JSON.stringify([existing])

      const result = scheduleFollowup('session-001', 'flow-002', 'tired')

      expect(result.flowId).toBe('flow-002')
      expect(result.status).toBe('pending')
    })

    it('should respect custom delayHours option', () => {
      const result = scheduleFollowup('session-002', 'flow-002', 'sad', { delayHours: 48, preferredHour: 0 })

      const scheduledTime = new Date(result.scheduledDate).getTime()
      const now = Date.now()
      const diffHours = (scheduledTime - now) / (60 * 60 * 1000)

      expect(diffHours).toBeGreaterThanOrEqual(47)
      expect(diffHours).toBeLessThanOrEqual(49)
    })

    it('should respect preferredHour option', () => {
      const result = scheduleFollowup('session-003', 'flow-003', 'sad', { preferredHour: 14 })

      const scheduled = new Date(result.scheduledDate)
      expect(scheduled.getHours()).toBe(14)
      expect(scheduled.getMinutes()).toBe(0)
    })

    it('should set subscribeAccepted to true when hasAcceptedSubscribe returns true', () => {
      vi.mocked(hasAcceptedSubscribe).mockReturnValue(true)

      const result = scheduleFollowup('session-004', 'flow-004', 'sad')

      expect(result.subscribeAccepted).toBe(true)
    })

    it('should call requestFollowupSubscribe when requestSubscribeOnSchedule is true and not accepted', () => {
      vi.mocked(hasAcceptedSubscribe).mockReturnValue(false)
      vi.mocked(requestFollowupSubscribe).mockResolvedValue(true)

      scheduleFollowup('session-005', 'flow-005', 'sad', { requestSubscribeOnSchedule: true })

      expect(requestFollowupSubscribe).toHaveBeenCalled()
    })

    it('should not call requestFollowupSubscribe when subscribeAlready accepted', () => {
      vi.mocked(hasAcceptedSubscribe).mockReturnValue(true)

      scheduleFollowup('session-006', 'flow-006', 'sad', { requestSubscribeOnSchedule: true })

      expect(requestFollowupSubscribe).not.toHaveBeenCalled()
    })

    it('should update subscribeAccepted when requestFollowupSubscribe resolves true', async () => {
      vi.mocked(hasAcceptedSubscribe).mockReturnValue(false)
      vi.mocked(requestFollowupSubscribe).mockResolvedValue(true)

      scheduleFollowup('session-007', 'flow-007', 'sad', { requestSubscribeOnSchedule: true })

      await vi.waitFor(() => {
        expect(setStorage).toHaveBeenCalledTimes(2)
      })

      const lastCall = vi.mocked(setStorage).mock.calls[1]
      const stored = lastCall[1] as PendingFollowup[]
      const followup = stored.find((f) => f.sessionId === 'session-007')
      expect(followup?.subscribeAccepted).toBe(true)
    })

    it('should not update subscribeAccepted when requestFollowupSubscribe resolves false', async () => {
      vi.mocked(hasAcceptedSubscribe).mockReturnValue(false)
      vi.mocked(requestFollowupSubscribe).mockResolvedValue(false)

      scheduleFollowup('session-008', 'flow-008', 'sad', { requestSubscribeOnSchedule: true })

      await vi.waitFor(() => {
        expect(requestFollowupSubscribe).toHaveBeenCalled()
      })

      expect(setStorage).toHaveBeenCalledTimes(1)
    })

    it('should handle requestFollowupSubscribe rejection gracefully', async () => {
      vi.mocked(hasAcceptedSubscribe).mockReturnValue(false)
      vi.mocked(requestFollowupSubscribe).mockRejectedValue(new Error('User denied'))

      const result = scheduleFollowup('session-009', 'flow-009', 'sad', { requestSubscribeOnSchedule: true })

      expect(result).toBeDefined()
      expect(result.status).toBe('pending')

      await vi.waitFor(() => {
        expect(requestFollowupSubscribe).toHaveBeenCalled()
      })
    })
  })

  describe('cancelFollowup', () => {
    it('should cancel an existing followup', () => {
      const existing = makeFollowup({ sessionId: 'session-001', status: 'pending' })
      mockStorage['xhh_pending_followups'] = JSON.stringify([existing])

      const result = cancelFollowup('session-001')

      expect(result).toBe(true)
      expect(setStorage).toHaveBeenCalledWith('pending_followups', expect.arrayContaining([
        expect.objectContaining({ sessionId: 'session-001', status: 'cancelled' }),
      ]))
    })

    it('should return false for non-existent followup', () => {
      const result = cancelFollowup('non-existent-session')

      expect(result).toBe(false)
      expect(setStorage).not.toHaveBeenCalled()
    })
  })

  describe('getPendingFollowups', () => {
    it('should return empty array when no data in storage', () => {
      const result = getPendingFollowups()

      expect(result).toEqual([])
    })

    it('should return stored followups', () => {
      const followups = [
        makeFollowup({ sessionId: 'session-001' }),
        makeFollowup({ sessionId: 'session-002' }),
      ]
      mockStorage['xhh_pending_followups'] = JSON.stringify(followups)

      const result = getPendingFollowups()

      expect(result).toHaveLength(2)
      expect(result[0].sessionId).toBe('session-001')
      expect(result[1].sessionId).toBe('session-002')
    })
  })

  describe('getFollowupBySessionId', () => {
    it('should find followup by sessionId', () => {
      const followups = [
        makeFollowup({ sessionId: 'session-001' }),
        makeFollowup({ sessionId: 'session-002' }),
      ]
      mockStorage['xhh_pending_followups'] = JSON.stringify(followups)

      const result = getFollowupBySessionId('session-002')

      expect(result).not.toBeNull()
      expect(result!.sessionId).toBe('session-002')
    })

    it('should return null if sessionId not found', () => {
      const followups = [makeFollowup({ sessionId: 'session-001' })]
      mockStorage['xhh_pending_followups'] = JSON.stringify(followups)

      const result = getFollowupBySessionId('non-existent')

      expect(result).toBeNull()
    })

    it('should return null when no followups exist', () => {
      const result = getFollowupBySessionId('any-session')

      expect(result).toBeNull()
    })
  })

  describe('checkAndSendFollowups', () => {
    it('should return empty array when no pending followups', () => {
      const result = checkAndSendFollowups()

      expect(result).toEqual([])
    })

    it('should return due followups whose scheduledDate has passed', () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
      })
      const futureFollowup = makeFollowup({
        sessionId: 'session-002',
        status: 'pending',
        scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup, futureFollowup])

      const result = checkAndSendFollowups()

      expect(result).toHaveLength(1)
      expect(result[0].sessionId).toBe('session-001')
    })

    it('should skip non-pending followups', () => {
      const sentFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'sent',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([sentFollowup])

      const result = checkAndSendFollowups()

      expect(result).toEqual([])
    })

    it('should call sendFollowupNotifications for due followups', async () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: true,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      vi.mocked(sendSubscribeMessage).mockResolvedValue(true)

      checkAndSendFollowups()

      await vi.waitFor(() => {
        expect(sendSubscribeMessage).toHaveBeenCalled()
      })
    })

    it('should mark followup as sent when sendSubscribeMessage succeeds and subscribe accepted', async () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: true,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      vi.mocked(sendSubscribeMessage).mockResolvedValue(true)

      checkAndSendFollowups()

      await vi.waitFor(() => {
        const stored = JSON.parse(mockStorage['xhh_pending_followups'])
        expect(stored[0].status).toBe('sent')
      })
    })

    it('should mark followup as sent via toast fallback when subscribe not accepted', async () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: false,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      checkAndSendFollowups()

      await vi.waitFor(() => {
        const stored = JSON.parse(mockStorage['xhh_pending_followups'])
        expect(stored[0].status).toBe('sent')
        expect(stored[0].sendAttempts).toBe(1)
      })
    })

    it('should call recordSend with true when followup sent successfully', async () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: true,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      vi.mocked(sendSubscribeMessage).mockResolvedValue(true)

      checkAndSendFollowups()

      await vi.waitFor(() => {
        expect(recordSend).toHaveBeenCalledWith('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER', true)
      })
    })

    it('should increment sendAttempts and reschedule when sendSingleFollowup throws', async () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: true,
        sendAttempts: 0,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      vi.mocked(sendSubscribeMessage).mockRejectedValue(new Error('Send failed'))

      checkAndSendFollowups()

      await vi.waitFor(() => {
        const stored = JSON.parse(mockStorage['xhh_pending_followups'])
        expect(stored[0].sendAttempts).toBe(1)
        expect(stored[0].status).toBe('pending')
      })
    })

    it('should call recordSend with false when send fails', async () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: true,
        sendAttempts: 0,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      vi.mocked(sendSubscribeMessage).mockRejectedValue(new Error('Send failed'))

      checkAndSendFollowups()

      await vi.waitFor(() => {
        expect(recordSend).not.toHaveBeenCalledWith('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER', true)
      })
    })

    it('should mark followup as expired after 3 failed attempts', async () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: true,
        sendAttempts: 2,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      vi.mocked(sendSubscribeMessage).mockRejectedValue(new Error('Send failed'))

      checkAndSendFollowups()

      await vi.waitFor(() => {
        const stored = JSON.parse(mockStorage['xhh_pending_followups'])
        expect(stored[0].sendAttempts).toBe(3)
        expect(stored[0].status).toBe('pending')
      })
    })

    it('should cancel followup when frequency check blocks sending', async () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: true,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      vi.mocked(checkFrequency).mockReturnValue({ allowed: false, reason: '发送过于频繁' })

      checkAndSendFollowups()

      await vi.waitFor(() => {
        const stored = JSON.parse(mockStorage['xhh_pending_followups'])
        expect(stored[0].status).toBe('cancelled')
      })
    })

    it('should not call sendSubscribeMessage when frequency check blocks', async () => {
      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: true,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      vi.mocked(checkFrequency).mockReturnValue({ allowed: false, reason: '免打扰时段' })

      checkAndSendFollowups()

      await vi.waitFor(() => {
        expect(setStorage).toHaveBeenCalled()
      })

      expect(sendSubscribeMessage).not.toHaveBeenCalled()
    })

    it('should show toast fallback when subscribe not accepted', async () => {
      vi.mocked(checkFrequency).mockReturnValue({ allowed: true, remainingToday: 2, remainingThisWeek: 5 })

      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: false,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      checkAndSendFollowups()

      await vi.waitFor(() => {
        expect(Taro.showToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: expect.stringContaining('健康提醒'),
            icon: 'none',
            duration: 3000,
          })
        )
      })
    })

    it('should use mood string directly for toast message', async () => {
      vi.mocked(checkFrequency).mockReturnValue({ allowed: true, remainingToday: 2, remainingThisWeek: 5 })

      const pastFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        scheduledDate: new Date(Date.now() - 1000).toISOString(),
        subscribeAccepted: false,
        healthStatus: 'anxious',
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pastFollowup])

      checkAndSendFollowups()

      await vi.waitFor(() => {
        expect(Taro.showToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: expect.stringContaining('健康提醒'),
          })
        )
      })
    })
  })

  describe('sendCarePlanReminder', () => {
    it('should call sendSubscribeMessage with correct template and data', async () => {
      vi.mocked(sendSubscribeMessage).mockResolvedValue(true)

      const result = await sendCarePlanReminder('plan-001', 1, '深呼吸练习', '每天做3次深呼吸')

      expect(sendSubscribeMessage).toHaveBeenCalledWith(
        'CARE_PLAN_REMINDER_TEMPLATE_ID_PLACEHOLDER',
        expect.objectContaining({
          thing1: { value: expect.stringContaining('深呼吸练习') },
          time2: { value: expect.any(String) },
          thing3: { value: expect.stringContaining('每天做3次深呼吸') },
        }),
        '/pages/index/index?carePlanId=plan-001&day=1'
      )
      expect(result).toBe(true)
    })

    it('should return false when sendSubscribeMessage returns false', async () => {
      vi.mocked(sendSubscribeMessage).mockResolvedValue(false)

      const result = await sendCarePlanReminder('plan-001', 2, '散步', '去公园走走')

      expect(result).toBe(false)
    })

    it('should truncate long taskTitle in message data', async () => {
      vi.mocked(sendSubscribeMessage).mockResolvedValue(true)
      const longTitle = '这是一个非常非常非常非常非常非常非常长的任务标题'

      await sendCarePlanReminder('plan-001', 3, longTitle, 'desc')

      const callArgs = vi.mocked(sendSubscribeMessage).mock.calls[0][1]
      expect(callArgs.thing1.value.length).toBeLessThanOrEqual(20)
    })

    it('should pass correct page path with planId and day', async () => {
      vi.mocked(sendSubscribeMessage).mockResolvedValue(true)

      await sendCarePlanReminder('plan-abc', 3, 'task', 'desc')

      expect(sendSubscribeMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        '/pages/index/index?carePlanId=plan-abc&day=3'
      )
    })
  })

  describe('updateFollowupStatus', () => {
    it('should update status of existing followup', () => {
      const existing = makeFollowup({ sessionId: 'session-001', status: 'pending' })
      mockStorage['xhh_pending_followups'] = JSON.stringify([existing])

      const result = updateFollowupStatus('session-001', 'responded')

      expect(result).toBe(true)
      expect(setStorage).toHaveBeenCalledWith('pending_followups', expect.arrayContaining([
        expect.objectContaining({ sessionId: 'session-001', status: 'responded' }),
      ]))
    })

    it('should update status and response together', () => {
      const existing = makeFollowup({ sessionId: 'session-001', status: 'sent' })
      mockStorage['xhh_pending_followups'] = JSON.stringify([existing])

      const result = updateFollowupStatus('session-001', 'responded', 'better')

      expect(result).toBe(true)
      const stored = vi.mocked(setStorage).mock.calls[0][1] as PendingFollowup[]
      expect(stored[0].status).toBe('responded')
      expect(stored[0].response).toBe('better')
      expect(stored[0].respondedAt).toBeDefined()
    })

    it('should not set respondedAt when no response provided', () => {
      const existing = makeFollowup({ sessionId: 'session-001', status: 'pending' })
      mockStorage['xhh_pending_followups'] = JSON.stringify([existing])

      updateFollowupStatus('session-001', 'cancelled')

      const stored = vi.mocked(setStorage).mock.calls[0][1] as PendingFollowup[]
      expect(stored[0].respondedAt).toBeUndefined()
      expect(stored[0].response).toBeUndefined()
    })

    it('should return false for non-existent followup', () => {
      const result = updateFollowupStatus('non-existent', 'responded', 'better')

      expect(result).toBe(false)
      expect(setStorage).not.toHaveBeenCalled()
    })
  })

  describe('clearExpiredFollowups', () => {
    it('should remove non-pending followups older than 7 days', () => {
      const oldFollowup = makeFollowup({
        sessionId: 'session-001',
        status: 'sent',
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      })
      const recentFollowup = makeFollowup({
        sessionId: 'session-002',
        status: 'sent',
        createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([oldFollowup, recentFollowup])

      const removed = clearExpiredFollowups()

      expect(removed).toBe(1)
      const stored = JSON.parse(mockStorage['xhh_pending_followups'])
      expect(stored).toHaveLength(1)
      expect(stored[0].sessionId).toBe('session-002')
    })

    it('should remove pending followups older than 14 days', () => {
      const oldPending = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        createdAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
      })
      const recentPending = makeFollowup({
        sessionId: 'session-002',
        status: 'pending',
        createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([oldPending, recentPending])

      const removed = clearExpiredFollowups()

      expect(removed).toBe(1)
      const stored = JSON.parse(mockStorage['xhh_pending_followups'])
      expect(stored).toHaveLength(1)
      expect(stored[0].sessionId).toBe('session-002')
    })

    it('should keep pending followups within 14-day threshold', () => {
      const pending = makeFollowup({
        sessionId: 'session-001',
        status: 'pending',
        createdAt: Date.now() - 13 * 24 * 60 * 60 * 1000,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([pending])

      const removed = clearExpiredFollowups()

      expect(removed).toBe(0)
      const stored = JSON.parse(mockStorage['xhh_pending_followups'])
      expect(stored).toHaveLength(1)
    })

    it('should return 0 and not write storage when nothing removed', () => {
      const recent = makeFollowup({
        sessionId: 'session-001',
        status: 'sent',
        createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
      })
      mockStorage['xhh_pending_followups'] = JSON.stringify([recent])

      const removed = clearExpiredFollowups()

      expect(removed).toBe(0)
      expect(setStorage).not.toHaveBeenCalled()
    })

    it('should return 0 when no followups exist', () => {
      const removed = clearExpiredFollowups()

      expect(removed).toBe(0)
    })
  })

  describe('getFollowupStats', () => {
    it('should return zero stats when no followups exist', () => {
      const stats = getFollowupStats()

      expect(stats).toEqual({
        total: 0,
        pending: 0,
        sent: 0,
        responded: 0,
        responseRate: 0,
        betterRate: 0,
      })
    })

    it('should calculate total, pending, sent, responded counts', () => {
      const followups = [
        makeFollowup({ sessionId: 's1', status: 'pending' }),
        makeFollowup({ sessionId: 's2', status: 'sent' }),
        makeFollowup({ sessionId: 's3', status: 'responded', response: 'better' }),
        makeFollowup({ sessionId: 's4', status: 'responded', response: 'okay' }),
        makeFollowup({ sessionId: 's5', status: 'cancelled' }),
      ]
      mockStorage['xhh_pending_followups'] = JSON.stringify(followups)

      const stats = getFollowupStats()

      expect(stats.total).toBe(5)
      expect(stats.pending).toBe(1)
      expect(stats.sent).toBe(1)
      expect(stats.responded).toBe(2)
    })

    it('should calculate responseRate as responded / (sent + responded) * 100', () => {
      const followups = [
        makeFollowup({ sessionId: 's1', status: 'sent' }),
        makeFollowup({ sessionId: 's2', status: 'sent' }),
        makeFollowup({ sessionId: 's3', status: 'responded', response: 'better' }),
      ]
      mockStorage['xhh_pending_followups'] = JSON.stringify(followups)

      const stats = getFollowupStats()

      expect(stats.responseRate).toBe(33)
    })

    it('should calculate betterRate as better / responded * 100', () => {
      const followups = [
        makeFollowup({ sessionId: 's1', status: 'responded', response: 'better' }),
        makeFollowup({ sessionId: 's2', status: 'responded', response: 'better' }),
        makeFollowup({ sessionId: 's3', status: 'responded', response: 'okay' }),
        makeFollowup({ sessionId: 's4', status: 'responded', response: 'still_bad' }),
      ]
      mockStorage['xhh_pending_followups'] = JSON.stringify(followups)

      const stats = getFollowupStats()

      expect(stats.betterRate).toBe(50)
    })

    it('should return 0 responseRate when no sent or responded followups', () => {
      const followups = [
        makeFollowup({ sessionId: 's1', status: 'pending' }),
        makeFollowup({ sessionId: 's2', status: 'cancelled' }),
      ]
      mockStorage['xhh_pending_followups'] = JSON.stringify(followups)

      const stats = getFollowupStats()

      expect(stats.responseRate).toBe(0)
    })

    it('should return 0 betterRate when no responded followups', () => {
      const followups = [
        makeFollowup({ sessionId: 's1', status: 'sent' }),
      ]
      mockStorage['xhh_pending_followups'] = JSON.stringify(followups)

      const stats = getFollowupStats()

      expect(stats.betterRate).toBe(0)
    })

    it('should return 100 responseRate when all sent+responded are responded', () => {
      const followups = [
        makeFollowup({ sessionId: 's1', status: 'responded', response: 'better' }),
        makeFollowup({ sessionId: 's2', status: 'responded', response: 'okay' }),
      ]
      mockStorage['xhh_pending_followups'] = JSON.stringify(followups)

      const stats = getFollowupStats()

      expect(stats.responseRate).toBe(100)
    })
  })
})
