/**
 * 用户流失检测与召回服务
 *
 * 检测用户活跃度下降，触发不同级别的召回策略（消息/通知/站内提醒）
 */
import Taro from '@tarojs/taro'
import { getStorage, setStorage } from '../utils/storage'
import { logger } from '../logger'
import { sendSubscribeMessage, hasAcceptedSubscribe, requestSubscribe } from './subscribeService'
import { getUpcomingRecords } from './vaccineService'
import { HEALTH_CHECKIN_TEMPLATE_ID } from '../constants/templateIds'

const CHURN_DETECTION_KEY = 'churn_detection'
const LAST_ACTIVE_KEY = 'last_active_time'

export interface ChurnDetectionState {
  lastCheckinDate: string | null
  lastAppOpenDate: string | null
  membershipExpiryDate: string | null
  recallHistory: RecallRecord[]
}

export interface RecallRecord {
  type: 'checkin_7d' | 'app_14d' | 'app_30d' | 'member_expired'
  triggeredAt: number
  sentAt: number | null
  sentChannel: 'subscribe_message' | 'in_app' | 'service_notification'
  petName?: string
  content: string
}

export type ChurnLevel = 'active' | 'mild_churn' | 'moderate_churn' | 'severe_churn' | 'member_churn'

export interface ChurnDetectionResult {
  level: ChurnLevel
  daysSinceCheckin: number
  daysSinceAppOpen: number
  shouldRecall: boolean
  recallType: RecallRecord['type'] | null
  recallContent: string
}

const RECALL_MESSAGES = {
  checkin_7d: (petName: string) => `${petName || '毛孩子'}今天怎么样？3秒打卡记录健康`,
  // 参数改名 isVaccineDue：原名 hasVaccineDue 遮蔽同模块的 hasVaccineDue() 函数（no-shadow）
  app_14d: (petName: string, isVaccineDue: boolean) =>
    isVaccineDue ? `${petName || '咪咪'}的疫苗快到期了，记得预约` : `${petName || '毛孩子'}想你了，回来看看吧`,
  app_30d: () => '你的宠物健康月报已生成，点击查看',
  member_expired: () => '会员权益即将失效，续费享专属优惠',
}

export function updateLastActiveTime(): void {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  setStorage(LAST_ACTIVE_KEY, dateStr)
  const state = getChurnState()
  state.lastAppOpenDate = dateStr
  saveChurnState(state)
}

export function updateLastCheckinDate(): void {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const state = getChurnState()
  state.lastCheckinDate = dateStr
  saveChurnState(state)
}

export function setMembershipExpiryDate(date: string): void {
  const state = getChurnState()
  state.membershipExpiryDate = date
  saveChurnState(state)
}

export function getChurnState(): ChurnDetectionState {
  return getStorage<ChurnDetectionState>(CHURN_DETECTION_KEY) || {
    lastCheckinDate: null,
    lastAppOpenDate: null,
    membershipExpiryDate: null,
    recallHistory: [],
  }
}

function saveChurnState(state: ChurnDetectionState): void {
  setStorage(CHURN_DETECTION_KEY, state)
}

function daysBetween(dateStr: string | null, referenceDate: Date): number {
  if (!dateStr) return 999
  const date = new Date(dateStr)
  const diffMs = referenceDate.getTime() - date.getTime()
  return Math.floor(diffMs / (24 * 60 * 60 * 1000))
}

function hasRecentRecall(history: RecallRecord[], type: RecallRecord['type'], withinDays: number): boolean {
  const threshold = Date.now() - withinDays * 24 * 60 * 60 * 1000
  return history.some(r => r.type === type && r.triggeredAt > threshold)
}

function hasAnyRecallIn7Days(history: RecallRecord[]): boolean {
  const threshold = Date.now() - 7 * 24 * 60 * 60 * 1000
  return history.some(r => r.triggeredAt > threshold)
}

function getMonthlyRecallCount(history: RecallRecord[]): number {
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000
  return history.filter(r => r.triggeredAt > threshold).length
}

async function hasVaccineDue(petId: string): Promise<boolean> {
  try {
    const upcoming = await getUpcomingRecords(petId, 7)
    return upcoming.length > 0
  } catch {
    return false
  }
}

function getPetName(petId?: string): string {
  if (!petId) return ''
  try {
    const pets = getStorage<Array<{ id: string; name: string }>>('pets')
    return pets?.find(p => p.id === petId)?.name || ''
  } catch {
    return ''
  }
}

export async function detectChurn(petId?: string): Promise<ChurnDetectionResult> {
  const state = getChurnState()
  const now = new Date()
  const daysSinceCheckin = daysBetween(state.lastCheckinDate, now)
  const daysSinceAppOpen = daysBetween(state.lastAppOpenDate, now)

  if (state.membershipExpiryDate) {
    const expiryDate = new Date(state.membershipExpiryDate)
    const daysSinceExpiry = Math.floor((now.getTime() - expiryDate.getTime()) / (24 * 60 * 60 * 1000))
    if (daysSinceExpiry >= 3 && !hasRecentRecall(state.recallHistory, 'member_expired', 7)) {
      return {
        level: 'member_churn',
        daysSinceCheckin,
        daysSinceAppOpen,
        shouldRecall: true,
        recallType: 'member_expired',
        recallContent: RECALL_MESSAGES.member_expired(),
      }
    }
  }

  if (daysSinceAppOpen >= 30 && !hasRecentRecall(state.recallHistory, 'app_30d', 30)) {
    return {
      level: 'severe_churn',
      daysSinceCheckin,
      daysSinceAppOpen,
      shouldRecall: true,
      recallType: 'app_30d',
      recallContent: RECALL_MESSAGES.app_30d(),
    }
  }

  if (daysSinceAppOpen >= 14 && !hasRecentRecall(state.recallHistory, 'app_14d', 14)) {
    const vaccineDue = petId ? await hasVaccineDue(petId) : false
    const petName = getPetName(petId)
    return {
      level: 'moderate_churn',
      daysSinceCheckin,
      daysSinceAppOpen,
      shouldRecall: true,
      recallType: 'app_14d',
      recallContent: RECALL_MESSAGES.app_14d(petName, vaccineDue),
    }
  }

  if (daysSinceCheckin >= 7 && !hasRecentRecall(state.recallHistory, 'checkin_7d', 7)) {
    const petName = getPetName(petId)
    return {
      level: 'mild_churn',
      daysSinceCheckin,
      daysSinceAppOpen,
      shouldRecall: true,
      recallType: 'checkin_7d',
      recallContent: RECALL_MESSAGES.checkin_7d(petName),
    }
  }

  return {
    level: 'active',
    daysSinceCheckin,
    daysSinceAppOpen,
    shouldRecall: false,
    recallType: null,
    recallContent: '',
  }
}

export async function executeRecall(result: ChurnDetectionResult, petId?: string): Promise<boolean> {
  if (!result.shouldRecall || !result.recallType) return false

  const state = getChurnState()

  if (hasAnyRecallIn7Days(state.recallHistory)) {
    logger.info('churnDetection', '7天内已有召回，跳过')
    return false
  }

  if (getMonthlyRecallCount(state.recallHistory) >= 3) {
    logger.info('churnDetection', '本月召回已达3条上限，跳过')
    return false
  }

  const record: RecallRecord = {
    type: result.recallType,
    triggeredAt: Date.now(),
    sentAt: null,
    sentChannel: 'subscribe_message',
    petName: getPetName(petId),
    content: result.recallContent,
  }

  if (result.recallType === 'member_expired') {
    record.sentChannel = 'in_app'
    record.sentAt = Date.now()
    state.recallHistory.push(record)
    saveChurnState(state)
    return true
  }

  if (result.recallType === 'app_30d') {
    record.sentChannel = 'service_notification'
    record.sentAt = Date.now()
    state.recallHistory.push(record)
    saveChurnState(state)
    return true
  }

  const subscribeAccepted = hasAcceptedSubscribe(HEALTH_CHECKIN_TEMPLATE_ID)
  if (subscribeAccepted) {
    const data = {
      thing1: { value: result.recallContent.slice(0, 20) },
      time2: { value: new Date().toISOString().slice(0, 16).replace('T', ' ') },
      thing3: { value: '点击查看详情' },
    }
    const page = result.recallType === 'checkin_7d'
      ? '/pagesPet/checkin/index'
      : '/pages/index/index'

    const sent = await sendSubscribeMessage(HEALTH_CHECKIN_TEMPLATE_ID, data, page)
    if (sent) {
      record.sentAt = Date.now()
      record.sentChannel = 'subscribe_message'
      state.recallHistory.push(record)
      saveChurnState(state)
      return true
    }
  }

  try {
    await requestSubscribe([HEALTH_CHECKIN_TEMPLATE_ID])
  } catch {}

  record.sentChannel = 'in_app'
  record.sentAt = Date.now()
  state.recallHistory.push(record)
  saveChurnState(state)

  Taro.showToast({ title: result.recallContent, icon: 'none', duration: 3000 })
  return true
}

export async function checkAndRecall(petId?: string): Promise<ChurnDetectionResult> {
  const result = await detectChurn(petId)
  if (result.shouldRecall) {
    const sent = await executeRecall(result, petId)
    return { ...result, shouldRecall: sent }
  }
  return result
}

export function getRecallStats(): {
  totalRecalls: number
  monthlyRecalls: number
  lastRecallAt: number | null
  byType: Record<string, number>
} {
  const state = getChurnState()
  const monthlyThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000
  const monthly = state.recallHistory.filter(r => r.triggeredAt > monthlyThreshold)
  const byType: Record<string, number> = {}
  state.recallHistory.forEach(r => {
    byType[r.type] = (byType[r.type] || 0) + 1
  })
  return {
    totalRecalls: state.recallHistory.length,
    monthlyRecalls: monthly.length,
    lastRecallAt: state.recallHistory.length > 0
      ? state.recallHistory[state.recallHistory.length - 1].triggeredAt
      : null,
    byType,
  }
}

export function clearRecallHistory(): void {
  const state = getChurnState()
  state.recallHistory = []
  saveChurnState(state)
}
