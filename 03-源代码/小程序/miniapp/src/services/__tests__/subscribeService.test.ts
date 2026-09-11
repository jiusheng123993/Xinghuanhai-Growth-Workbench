/**
 * 订阅消息服务测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import Taro from '@tarojs/taro'
import { checkFrequency, recordSend } from '../frequencyControlService'
import {
  FOLLOWUP_TEMPLATE_ID,
  CARE_PLAN_REMINDER_TEMPLATE_ID,
  HEALTH_CHECKIN_TEMPLATE_ID,
  TEMPLATE_IDS,
  TEMPLATE_CONFIGS,
  requestSubscribe,
  requestFollowupSubscribe,
  requestCarePlanSubscribe,
  requestAllSubscribes,
  updateSubscribeStatus,
  getSubscribeStatus,
  hasAcceptedSubscribe,
  getAllSubscribeStatus,
  recordTemplateUsage,
  clearSubscribeStatus,
  sendSubscribeMessage,
} from '../subscribeService'
import type { SubscribeStatus } from '../subscribeService'

const mockStorage: Record<string, string> = {}

vi.mock('../../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[`xhh_${key}`]
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[`xhh_${key}`] = JSON.stringify(value)
  }),
  // sendSubscribeMessage 依赖 storage 命名导出（utils/storage.ts 的 storage 对象）
  storage: {
    getToken: vi.fn(() => 'test-token'),
    setToken: vi.fn(),
    removeToken: vi.fn(),
    getUser: vi.fn(() => null),
    setUser: vi.fn(),
    removeUser: vi.fn(),
    getRefreshToken: vi.fn(() => null),
    setRefreshToken: vi.fn(),
    removeRefreshToken: vi.fn(),
    clear: vi.fn(),
  },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    requestSubscribeMessage: vi.fn(),
    getStorageSync: vi.fn(() => 'test-token'),
    setStorageSync: vi.fn(),
    request: vi.fn(),
  },
}))

vi.mock('../frequencyControlService', () => ({
  checkFrequency: vi.fn(() => ({ allowed: true })),
  recordSend: vi.fn(),
}))

describe('subscribeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    vi.mocked(checkFrequency).mockReturnValue({ allowed: true })
  })

  describe('template ID constants', () => {
    it('FOLLOWUP_TEMPLATE_ID should have correct fallback value', () => {
      expect(FOLLOWUP_TEMPLATE_ID).toBe('FOLLOWUP_TEMPLATE_ID_PLACEHOLDER')
    })

    it('CARE_PLAN_REMINDER_TEMPLATE_ID should have correct fallback value', () => {
      expect(CARE_PLAN_REMINDER_TEMPLATE_ID).toBe('CARE_PLAN_REMINDER_TEMPLATE_ID_PLACEHOLDER')
    })

    it('HEALTH_CHECKIN_TEMPLATE_ID should have correct fallback value', () => {
      expect(HEALTH_CHECKIN_TEMPLATE_ID).toBe('HEALTH_CHECKIN_TEMPLATE_ID_PLACEHOLDER')
    })
  })

  describe('TEMPLATE_IDS', () => {
    it('should contain all three template IDs', () => {
      expect(TEMPLATE_IDS.FOLLOWUP).toBe(FOLLOWUP_TEMPLATE_ID)
      expect(TEMPLATE_IDS.CARE_PLAN_REMINDER).toBe(CARE_PLAN_REMINDER_TEMPLATE_ID)
      expect(TEMPLATE_IDS.HEALTH_CHECKIN).toBe(HEALTH_CHECKIN_TEMPLATE_ID)
    })
  })

  describe('TEMPLATE_CONFIGS', () => {
    it('should have entries for all template IDs', () => {
      expect(TEMPLATE_CONFIGS[FOLLOWUP_TEMPLATE_ID]).toBeDefined()
      expect(TEMPLATE_CONFIGS[CARE_PLAN_REMINDER_TEMPLATE_ID]).toBeDefined()
      expect(TEMPLATE_CONFIGS[HEALTH_CHECKIN_TEMPLATE_ID]).toBeDefined()
    })

    it('each config should have id, name, description and requiredFields', () => {
      const configs = Object.values(TEMPLATE_CONFIGS)
      configs.forEach((config) => {
        expect(config.id).toBeDefined()
        expect(config.name).toBeDefined()
        expect(config.description).toBeDefined()
        expect(Array.isArray(config.requiredFields)).toBe(true)
        expect(config.requiredFields.length).toBeGreaterThan(0)
      })
    })
  })

  describe('requestSubscribe', () => {
    it('should return accepted status when user accepts', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [FOLLOWUP_TEMPLATE_ID]: 'accept',
        errMsg: 'requestSubscribeMessage:ok',
      } as any)

      const result = await requestSubscribe([FOLLOWUP_TEMPLATE_ID])

      expect(result[FOLLOWUP_TEMPLATE_ID]).toBe(true)
      expect(Taro.requestSubscribeMessage).toHaveBeenCalledWith({
        tmplIds: [FOLLOWUP_TEMPLATE_ID],
        entityIds: [],
      })
    })

    it('should return rejected status when user rejects', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [FOLLOWUP_TEMPLATE_ID]: 'reject',
      } as any)

      const result = await requestSubscribe([FOLLOWUP_TEMPLATE_ID])

      expect(result[FOLLOWUP_TEMPLATE_ID]).toBe(false)
    })

    it('should return all false when requestSubscribeMessage throws', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockRejectedValue(new Error('User denied'))

      const result = await requestSubscribe([FOLLOWUP_TEMPLATE_ID, CARE_PLAN_REMINDER_TEMPLATE_ID])

      expect(result[FOLLOWUP_TEMPLATE_ID]).toBe(false)
      expect(result[CARE_PLAN_REMINDER_TEMPLATE_ID]).toBe(false)
    })

    it('should update subscribe status for each template', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [FOLLOWUP_TEMPLATE_ID]: 'accept',
        [CARE_PLAN_REMINDER_TEMPLATE_ID]: 'reject',
      } as any)

      await requestSubscribe([FOLLOWUP_TEMPLATE_ID, CARE_PLAN_REMINDER_TEMPLATE_ID])

      const statusList = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      const followup = statusList.find((s) => s.templateId === FOLLOWUP_TEMPLATE_ID)
      const carePlan = statusList.find((s) => s.templateId === CARE_PLAN_REMINDER_TEMPLATE_ID)
      expect(followup?.accepted).toBe(true)
      expect(carePlan?.accepted).toBe(false)
    })
  })

  describe('requestFollowupSubscribe', () => {
    it('should delegate to requestSubscribe with followup template ID', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [FOLLOWUP_TEMPLATE_ID]: 'accept',
      } as any)

      const result = await requestFollowupSubscribe()

      expect(result).toBe(true)
      expect(Taro.requestSubscribeMessage).toHaveBeenCalledWith({
        tmplIds: [FOLLOWUP_TEMPLATE_ID],
        entityIds: [],
      })
    })

    it('should return false when user rejects', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [FOLLOWUP_TEMPLATE_ID]: 'reject',
      } as any)

      const result = await requestFollowupSubscribe()

      expect(result).toBe(false)
    })
  })

  describe('requestCarePlanSubscribe', () => {
    it('should delegate to requestSubscribe with care plan template ID', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [CARE_PLAN_REMINDER_TEMPLATE_ID]: 'accept',
      } as any)

      const result = await requestCarePlanSubscribe()

      expect(result).toBe(true)
      expect(Taro.requestSubscribeMessage).toHaveBeenCalledWith({
        tmplIds: [CARE_PLAN_REMINDER_TEMPLATE_ID],
        entityIds: [],
      })
    })

    it('should return false when user rejects', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [CARE_PLAN_REMINDER_TEMPLATE_ID]: 'reject',
      } as any)

      const result = await requestCarePlanSubscribe()

      expect(result).toBe(false)
    })
  })

  describe('requestAllSubscribes', () => {
    it('should request all three templates', async () => {
      vi.mocked(Taro.requestSubscribeMessage).mockResolvedValue({
        [FOLLOWUP_TEMPLATE_ID]: 'accept',
        [CARE_PLAN_REMINDER_TEMPLATE_ID]: 'accept',
        [HEALTH_CHECKIN_TEMPLATE_ID]: 'reject',
      } as any)

      const result = await requestAllSubscribes()

      expect(result[FOLLOWUP_TEMPLATE_ID]).toBe(true)
      expect(result[CARE_PLAN_REMINDER_TEMPLATE_ID]).toBe(true)
      expect(result[HEALTH_CHECKIN_TEMPLATE_ID]).toBe(false)
      expect(Taro.requestSubscribeMessage).toHaveBeenCalledWith({
        tmplIds: [FOLLOWUP_TEMPLATE_ID, CARE_PLAN_REMINDER_TEMPLATE_ID, HEALTH_CHECKIN_TEMPLATE_ID],
        entityIds: [],
      })
    })
  })

  describe('updateSubscribeStatus', () => {
    it('should create new entry when template ID does not exist', () => {
      updateSubscribeStatus('template-1', true)

      const statusList = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      expect(statusList).toHaveLength(1)
      expect(statusList[0].templateId).toBe('template-1')
      expect(statusList[0].accepted).toBe(true)
      expect(statusList[0].acceptedAt).toBeDefined()
      expect(statusList[0].usageCount).toBe(0)
    })

    it('should update existing entry preserving usageCount', () => {
      const existing: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: false, usageCount: 5, lastUsedAt: 1000 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(existing)

      updateSubscribeStatus('template-1', true)

      const statusList = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      expect(statusList).toHaveLength(1)
      expect(statusList[0].accepted).toBe(true)
      expect(statusList[0].usageCount).toBe(5)
      expect(statusList[0].acceptedAt).toBeDefined()
    })

    it('should clear acceptedAt when setting accepted to false', () => {
      const existing: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: true, acceptedAt: 1000, usageCount: 3 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(existing)

      updateSubscribeStatus('template-1', false)

      const statusList = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      expect(statusList[0].accepted).toBe(false)
      expect(statusList[0].acceptedAt).toBeUndefined()
      expect(statusList[0].usageCount).toBe(3)
    })

    it('should set acceptedAt when updating from rejected to accepted', () => {
      const existing: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: false, usageCount: 2 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(existing)

      updateSubscribeStatus('template-1', true)

      const statusList = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      expect(statusList[0].acceptedAt).toBeDefined()
      expect(typeof statusList[0].acceptedAt).toBe('number')
    })
  })

  describe('getSubscribeStatus', () => {
    it('should return status for existing template ID', () => {
      const statusList: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: true, acceptedAt: 1000, usageCount: 3 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      const status = getSubscribeStatus('template-1')

      expect(status).not.toBeNull()
      expect(status!.templateId).toBe('template-1')
      expect(status!.accepted).toBe(true)
    })

    it('should return null when template ID not found', () => {
      const statusList: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: true, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      const status = getSubscribeStatus('template-999')

      expect(status).toBeNull()
    })

    it('should return null when no statuses exist', () => {
      const status = getSubscribeStatus('template-1')

      expect(status).toBeNull()
    })
  })

  describe('hasAcceptedSubscribe', () => {
    it('should return true when template is accepted', () => {
      const statusList: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: true, acceptedAt: 1000, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      expect(hasAcceptedSubscribe('template-1')).toBe(true)
    })

    it('should return false when template is not accepted', () => {
      const statusList: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: false, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      expect(hasAcceptedSubscribe('template-1')).toBe(false)
    })

    it('should return false when template ID not found', () => {
      expect(hasAcceptedSubscribe('template-999')).toBe(false)
    })
  })

  describe('getAllSubscribeStatus', () => {
    it('should return all statuses', () => {
      const statusList: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: true, usageCount: 1 },
        { templateId: 'template-2', accepted: false, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      const result = getAllSubscribeStatus()

      expect(result).toHaveLength(2)
      expect(result[0].templateId).toBe('template-1')
      expect(result[1].templateId).toBe('template-2')
    })

    it('should return empty array when no statuses exist', () => {
      const result = getAllSubscribeStatus()

      expect(result).toEqual([])
    })
  })

  describe('recordTemplateUsage', () => {
    it('should increment usageCount and set lastUsedAt', () => {
      const statusList: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: true, usageCount: 2 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      recordTemplateUsage('template-1')

      const updated = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      expect(updated[0].usageCount).toBe(3)
      expect(updated[0].lastUsedAt).toBeDefined()
      expect(typeof updated[0].lastUsedAt).toBe('number')
    })

    it('should do nothing for non-existent template ID', () => {
      const statusList: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: true, usageCount: 2 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      recordTemplateUsage('template-999')

      const updated = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      expect(updated).toHaveLength(1)
      expect(updated[0].usageCount).toBe(2)
    })

    it('should increment multiple times correctly', () => {
      const statusList: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: true, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      recordTemplateUsage('template-1')
      recordTemplateUsage('template-1')
      recordTemplateUsage('template-1')

      const updated = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      expect(updated[0].usageCount).toBe(3)
    })
  })

  describe('clearSubscribeStatus', () => {
    it('should clear all subscribe statuses', () => {
      const statusList: SubscribeStatus[] = [
        { templateId: 'template-1', accepted: true, usageCount: 5 },
        { templateId: 'template-2', accepted: false, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      clearSubscribeStatus()

      const updated = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      expect(updated).toEqual([])
    })
  })

  describe('sendSubscribeMessage', () => {
    const realTemplateId = 'real_template_id'
    const placeholderTemplateId = 'SOME_PLACEHOLDER_ID'
    const messageData = { thing1: { value: 'test' }, time2: { value: '10:00' } }

    it('should return false if user has not accepted subscribe', async () => {
      const statusList: SubscribeStatus[] = [
        { templateId: realTemplateId, accepted: false, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      const result = await sendSubscribeMessage(realTemplateId, messageData)

      expect(result).toBe(false)
      expect(Taro.request).not.toHaveBeenCalled()
    })

    it('should return false if no subscribe status exists', async () => {
      const result = await sendSubscribeMessage(realTemplateId, messageData)

      expect(result).toBe(false)
      expect(Taro.request).not.toHaveBeenCalled()
    })

    it('should return false for placeholder template IDs', async () => {
      const statusList: SubscribeStatus[] = [
        { templateId: placeholderTemplateId, accepted: true, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)

      const result = await sendSubscribeMessage(placeholderTemplateId, messageData)

      expect(result).toBe(false)
      expect(Taro.request).not.toHaveBeenCalled()
    })

    it('should return false when frequency check fails', async () => {
      const statusList: SubscribeStatus[] = [
        { templateId: realTemplateId, accepted: true, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)
      vi.mocked(checkFrequency).mockReturnValue({ allowed: false, reason: '发送过于频繁' })

      const result = await sendSubscribeMessage(realTemplateId, messageData)

      expect(result).toBe(false)
      expect(Taro.request).not.toHaveBeenCalled()
    })

    it('should call API and return true on success', async () => {
      const statusList: SubscribeStatus[] = [
        { templateId: realTemplateId, accepted: true, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)
      vi.mocked(Taro.request).mockResolvedValue({ statusCode: 200, data: {}, header: {}, errMsg: 'request:ok' } as any)

      const result = await sendSubscribeMessage(realTemplateId, messageData, '/pages/index')

      expect(result).toBe(true)
      expect(Taro.request).toHaveBeenCalledTimes(1)
      const callArg = vi.mocked(Taro.request).mock.calls[0][0] as unknown as Record<string, unknown>
      expect(callArg.url).toContain('subscribe/send')
      expect(callArg.method).toBe('POST')
      expect(callArg.data).toEqual({ templateId: realTemplateId, data: messageData, page: '/pages/index' })
      expect(callArg.header).toEqual({
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      })
    })

    it('should record template usage on successful send', async () => {
      const statusList: SubscribeStatus[] = [
        { templateId: realTemplateId, accepted: true, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)
      vi.mocked(Taro.request).mockResolvedValue({ statusCode: 200, data: {}, header: {}, errMsg: 'request:ok' } as any)

      await sendSubscribeMessage(realTemplateId, messageData)

      const updated = JSON.parse(mockStorage['xhh_subscribe_status']) as SubscribeStatus[]
      expect(updated[0].usageCount).toBe(1)
      expect(updated[0].lastUsedAt).toBeDefined()
      expect(recordSend).toHaveBeenCalledWith(realTemplateId, true)
    })

    it('should return false when API returns non-200 status', async () => {
      const statusList: SubscribeStatus[] = [
        { templateId: realTemplateId, accepted: true, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)
      vi.mocked(Taro.request).mockResolvedValue({ statusCode: 500, data: {}, header: {}, errMsg: 'request:ok' } as any)

      const result = await sendSubscribeMessage(realTemplateId, messageData)

      expect(result).toBe(false)
      expect(recordSend).toHaveBeenCalledWith(realTemplateId, false)
    })

    it('should return false when API throws error', async () => {
      const statusList: SubscribeStatus[] = [
        { templateId: realTemplateId, accepted: true, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)
      vi.mocked(Taro.request).mockRejectedValue(new Error('Network error'))

      const result = await sendSubscribeMessage(realTemplateId, messageData)

      expect(result).toBe(false)
      expect(recordSend).toHaveBeenCalledWith(realTemplateId, false)
    })

    it('should work without page parameter', async () => {
      const statusList: SubscribeStatus[] = [
        { templateId: realTemplateId, accepted: true, usageCount: 0 },
      ]
      mockStorage['xhh_subscribe_status'] = JSON.stringify(statusList)
      vi.mocked(Taro.request).mockResolvedValue({ statusCode: 200, data: {}, header: {}, errMsg: 'request:ok' } as any)

      await sendSubscribeMessage(realTemplateId, messageData)

      expect(Taro.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { templateId: realTemplateId, data: messageData, page: undefined },
        }),
      )
    })
  })
})
