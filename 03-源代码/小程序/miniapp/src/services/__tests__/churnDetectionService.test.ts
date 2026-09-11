/**
 * 流失检测服务测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  detectChurn,
  executeRecall,
  checkAndRecall,
  updateLastActiveTime,
  updateLastCheckinDate,
  setMembershipExpiryDate,
  getChurnState,
  getRecallStats,
  clearRecallHistory,
  type ChurnDetectionState,
} from '../churnDetectionService'

const memoryStore: Record<string, string> = {}

const { mockGetStorage, mockSetStorage } = vi.hoisted(() => ({
  mockGetStorage: vi.fn(<T,>(key: string): T | null => {
    const raw = memoryStore[key]
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }),
  mockSetStorage: vi.fn((key: string, value: unknown): void => {
    memoryStore[key] = JSON.stringify(value)
  }),
}))

const { mockSendSubscribeMessage, mockHasAcceptedSubscribe, mockRequestSubscribe } = vi.hoisted(() => ({
  mockSendSubscribeMessage: vi.fn(async () => false),
  mockHasAcceptedSubscribe: vi.fn(() => false),
  mockRequestSubscribe: vi.fn(async () => ({})),
}))

const { mockGetUpcomingRecords } = vi.hoisted(() => ({
  mockGetUpcomingRecords: vi.fn(async () => [] as Array<{ id: string }>),
}))

vi.mock('../../utils/storage', () => ({
  getStorage: mockGetStorage,
  setStorage: mockSetStorage,
}))

vi.mock('../../services/subscribeService', () => ({
  sendSubscribeMessage: mockSendSubscribeMessage,
  hasAcceptedSubscribe: mockHasAcceptedSubscribe,
  requestSubscribe: mockRequestSubscribe,
}))

vi.mock('../../services/vaccineService', () => ({
  getUpcomingRecords: mockGetUpcomingRecords,
}))

vi.mock('../../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    showToast: vi.fn(),
  },
}))

vi.mock('../../constants/templateIds', () => ({
  HEALTH_CHECKIN_TEMPLATE_ID: 'HEALTH_CHECKIN_TEMPLATE_ID_PLACEHOLDER',
  FOLLOWUP_TEMPLATE_ID: 'FOLLOWUP_TEMPLATE_ID_PLACEHOLDER',
  CARE_PLAN_REMINDER_TEMPLATE_ID: 'CARE_PLAN_REMINDER_TEMPLATE_ID_PLACEHOLDER',
}))

function seedChurnState(state: Partial<ChurnDetectionState>): void {
  const full: ChurnDetectionState = {
    lastCheckinDate: null,
    lastAppOpenDate: null,
    membershipExpiryDate: null,
    recallHistory: [],
    ...state,
  }
  memoryStore['churn_detection'] = JSON.stringify(full)
}

function seedPets(pets: { id: string; name: string }[]): void {
  memoryStore['pets'] = JSON.stringify(pets)
}

describe('churnDetectionService', () => {
  beforeEach(() => {
    Object.keys(memoryStore).forEach(k => delete memoryStore[k])
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T10:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('初始状态', () => {
    it('应为 active', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-22', lastAppOpenDate: '2026-07-22' })
      const result = await detectChurn()
      expect(result.level).toBe('active')
      expect(result.shouldRecall).toBe(false)
      expect(result.recallType).toBeNull()
    })

    it('无历史数据时 lastAppOpenDate 为 null 应视为严重流失', async () => {
      const result = await detectChurn()
      expect(result.level).toBe('severe_churn')
      expect(result.daysSinceAppOpen).toBe(999)
    })
  })

  describe('7天未打卡', () => {
    it('应检测为 mild_churn', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-14', lastAppOpenDate: '2026-07-21' })
      const result = await detectChurn()
      expect(result.level).toBe('mild_churn')
      expect(result.shouldRecall).toBe(true)
      expect(result.recallType).toBe('checkin_7d')
      expect(result.daysSinceCheckin).toBe(8)
    })
  })

  describe('14天未打开', () => {
    it('应检测为 moderate_churn', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-14', lastAppOpenDate: '2026-07-07' })
      const result = await detectChurn()
      expect(result.level).toBe('moderate_churn')
      expect(result.shouldRecall).toBe(true)
      expect(result.recallType).toBe('app_14d')
      expect(result.daysSinceAppOpen).toBe(15)
    })

    it('有疫苗到期时应包含疫苗提醒内容', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-14', lastAppOpenDate: '2026-07-07' })
      seedPets([{ id: 'pet-001', name: '咪咪' }])
      mockGetUpcomingRecords.mockResolvedValue([{ id: 'v1' }])
      const result = await detectChurn('pet-001')
      expect(result.recallContent).toContain('疫苗')
    })

    it('无疫苗到期时应使用通用召回内容', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-14', lastAppOpenDate: '2026-07-07' })
      seedPets([{ id: 'pet-001', name: '咪咪' }])
      mockGetUpcomingRecords.mockResolvedValue([])
      const result = await detectChurn('pet-001')
      expect(result.recallContent).toContain('想你了')
    })
  })

  describe('30天未打开', () => {
    it('应检测为 severe_churn', async () => {
      seedChurnState({ lastCheckinDate: '2026-06-20', lastAppOpenDate: '2026-06-21' })
      const result = await detectChurn()
      expect(result.level).toBe('severe_churn')
      expect(result.shouldRecall).toBe(true)
      expect(result.recallType).toBe('app_30d')
      expect(result.daysSinceAppOpen).toBe(31)
    })
  })

  describe('会员到期3天', () => {
    it('应检测为 member_churn', async () => {
      seedChurnState({
        lastCheckinDate: '2026-07-21',
        lastAppOpenDate: '2026-07-22',
        membershipExpiryDate: '2026-07-19',
      })
      const result = await detectChurn()
      expect(result.level).toBe('member_churn')
      expect(result.shouldRecall).toBe(true)
      expect(result.recallType).toBe('member_expired')
    })
  })

  describe('优先级', () => {
    it('member_churn > severe_churn > moderate_churn > mild_churn', async () => {
      seedChurnState({
        lastCheckinDate: '2026-06-20',
        lastAppOpenDate: '2026-06-21',
        membershipExpiryDate: '2026-07-19',
      })
      const result = await detectChurn()
      expect(result.level).toBe('member_churn')
    })

    it('severe_churn > moderate_churn > mild_churn（无会员到期）', async () => {
      seedChurnState({
        lastCheckinDate: '2026-06-20',
        lastAppOpenDate: '2026-06-21',
      })
      const result = await detectChurn()
      expect(result.level).toBe('severe_churn')
    })

    it('moderate_churn > mild_churn（14天未打开且7天未打卡）', async () => {
      seedChurnState({
        lastCheckinDate: '2026-07-14',
        lastAppOpenDate: '2026-07-07',
      })
      const result = await detectChurn()
      expect(result.level).toBe('moderate_churn')
    })
  })

  describe('7天内不重复推送', () => {
    it('7天内已有召回不应重复召回', async () => {
      seedChurnState({
        lastCheckinDate: '2026-07-14',
        lastAppOpenDate: '2026-07-21',
        recallHistory: [
          {
            type: 'checkin_7d',
            triggeredAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
            sentAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
            sentChannel: 'subscribe_message',
            content: 'test',
          },
        ],
      })
      const result = await detectChurn()
      expect(result.shouldRecall).toBe(false)
    })
  })

  describe('每月召回上限3条', () => {
    it('本月已有3条召回时 executeRecall 应返回 false', async () => {
      seedChurnState({
        lastCheckinDate: '2026-07-14',
        lastAppOpenDate: '2026-07-21',
        recallHistory: [
          { type: 'checkin_7d', triggeredAt: Date.now() - 20 * 24 * 60 * 60 * 1000, sentAt: Date.now() - 20 * 24 * 60 * 60 * 1000, sentChannel: 'subscribe_message', content: 'a' },
          { type: 'checkin_7d', triggeredAt: Date.now() - 15 * 24 * 60 * 60 * 1000, sentAt: Date.now() - 15 * 24 * 60 * 60 * 1000, sentChannel: 'subscribe_message', content: 'b' },
          { type: 'app_14d', triggeredAt: Date.now() - 10 * 24 * 60 * 60 * 1000, sentAt: Date.now() - 10 * 24 * 60 * 60 * 1000, sentChannel: 'subscribe_message', content: 'c' },
        ],
      })
      const detection = await detectChurn()
      expect(detection.shouldRecall).toBe(true)
      const sent = await executeRecall(detection)
      expect(sent).toBe(false)
    })
  })

  describe('executeRecall', () => {
    it('member_expired 应使用 in_app 渠道', async () => {
      seedChurnState({
        lastCheckinDate: '2026-07-21',
        lastAppOpenDate: '2026-07-22',
        membershipExpiryDate: '2026-07-19',
      })
      const detection = await detectChurn()
      const sent = await executeRecall(detection)
      expect(sent).toBe(true)
      const state = getChurnState()
      const lastRecord = state.recallHistory[state.recallHistory.length - 1]
      expect(lastRecord.sentChannel).toBe('in_app')
    })

    it('app_30d 应使用 service_notification 渠道', async () => {
      seedChurnState({
        lastCheckinDate: '2026-06-20',
        lastAppOpenDate: '2026-06-21',
      })
      const detection = await detectChurn()
      const sent = await executeRecall(detection)
      expect(sent).toBe(true)
      const state = getChurnState()
      const lastRecord = state.recallHistory[state.recallHistory.length - 1]
      expect(lastRecord.sentChannel).toBe('service_notification')
    })

    it('checkin_7d 订阅已接受时应发送订阅消息', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-14', lastAppOpenDate: '2026-07-21' })
      mockHasAcceptedSubscribe.mockReturnValue(true)
      mockSendSubscribeMessage.mockResolvedValue(true)
      const detection = await detectChurn()
      const sent = await executeRecall(detection)
      expect(sent).toBe(true)
      expect(mockSendSubscribeMessage).toHaveBeenCalled()
      const state = getChurnState()
      const lastRecord = state.recallHistory[state.recallHistory.length - 1]
      expect(lastRecord.sentChannel).toBe('subscribe_message')
    })

    it('checkin_7d 订阅未接受时应降级为 in_app', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-14', lastAppOpenDate: '2026-07-21' })
      mockHasAcceptedSubscribe.mockReturnValue(false)
      mockSendSubscribeMessage.mockResolvedValue(false)
      const detection = await detectChurn()
      const sent = await executeRecall(detection)
      expect(sent).toBe(true)
      const state = getChurnState()
      const lastRecord = state.recallHistory[state.recallHistory.length - 1]
      expect(lastRecord.sentChannel).toBe('in_app')
    })

    it('7天内已有其他召回时应跳过', async () => {
      seedChurnState({
        lastCheckinDate: '2026-07-14',
        lastAppOpenDate: '2026-07-21',
        recallHistory: [
          { type: 'app_14d', triggeredAt: Date.now() - 2 * 24 * 60 * 60 * 1000, sentAt: Date.now() - 2 * 24 * 60 * 60 * 1000, sentChannel: 'subscribe_message', content: 'test' },
        ],
      })
      const detection = await detectChurn()
      const sent = await executeRecall(detection)
      expect(sent).toBe(false)
    })

    it('shouldRecall 为 false 时应返回 false', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-22', lastAppOpenDate: '2026-07-22' })
      const detection = await detectChurn()
      const sent = await executeRecall(detection)
      expect(sent).toBe(false)
    })
  })

  describe('updateLastActiveTime', () => {
    it('应更新 lastAppOpenDate', () => {
      updateLastActiveTime()
      const state = getChurnState()
      expect(state.lastAppOpenDate).toBe('2026-07-22')
    })
  })

  describe('updateLastCheckinDate', () => {
    it('应更新 lastCheckinDate', () => {
      updateLastCheckinDate()
      const state = getChurnState()
      expect(state.lastCheckinDate).toBe('2026-07-22')
    })
  })

  describe('setMembershipExpiryDate', () => {
    it('应更新 membershipExpiryDate', () => {
      setMembershipExpiryDate('2026-08-01')
      const state = getChurnState()
      expect(state.membershipExpiryDate).toBe('2026-08-01')
    })
  })

  describe('checkAndRecall', () => {
    it('不需要召回时应直接返回结果', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-22', lastAppOpenDate: '2026-07-22' })
      const result = await checkAndRecall()
      expect(result.level).toBe('active')
      expect(result.shouldRecall).toBe(false)
    })

    it('需要召回时应执行召回并更新 shouldRecall', async () => {
      seedChurnState({ lastCheckinDate: '2026-07-14', lastAppOpenDate: '2026-07-21' })
      mockHasAcceptedSubscribe.mockReturnValue(false)
      const result = await checkAndRecall()
      expect(result.level).toBe('mild_churn')
      expect(result.shouldRecall).toBe(true)
    })
  })

  describe('getRecallStats', () => {
    it('无召回记录时应返回零值', () => {
      const stats = getRecallStats()
      expect(stats.totalRecalls).toBe(0)
      expect(stats.monthlyRecalls).toBe(0)
      expect(stats.lastRecallAt).toBeNull()
    })

    it('有召回记录时应正确统计', () => {
      seedChurnState({
        lastCheckinDate: null,
        lastAppOpenDate: null,
        recallHistory: [
          { type: 'checkin_7d', triggeredAt: Date.now() - 5 * 24 * 60 * 60 * 1000, sentAt: Date.now() - 5 * 24 * 60 * 60 * 1000, sentChannel: 'subscribe_message', content: 'a' },
          { type: 'app_14d', triggeredAt: Date.now() - 2 * 24 * 60 * 60 * 1000, sentAt: Date.now() - 2 * 24 * 60 * 60 * 1000, sentChannel: 'in_app', content: 'b' },
        ],
      })
      const stats = getRecallStats()
      expect(stats.totalRecalls).toBe(2)
      expect(stats.monthlyRecalls).toBe(2)
      expect(stats.byType['checkin_7d']).toBe(1)
      expect(stats.byType['app_14d']).toBe(1)
    })
  })

  describe('clearRecallHistory', () => {
    it('应清空召回历史', () => {
      seedChurnState({
        lastCheckinDate: null,
        lastAppOpenDate: null,
        recallHistory: [
          { type: 'checkin_7d', triggeredAt: Date.now(), sentAt: Date.now(), sentChannel: 'subscribe_message', content: 'a' },
        ],
      })
      clearRecallHistory()
      const state = getChurnState()
      expect(state.recallHistory).toHaveLength(0)
    })
  })
})
