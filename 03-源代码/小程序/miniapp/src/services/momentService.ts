/**
 * 宠物动态服务
 *
 * 宠物家庭动态（打卡/里程碑/照片/回忆）的查询与缓存
 */
import { api } from './api'
import { mockApi } from './mock'
import { CONFIG } from '../config'
import { parseLocalDate } from '../utils/date'
import type { PetMoment } from '../types/familyTypes'

/** 是否启用 Mock 模式（原名 useMock，以 "use" 开头会被 react-hooks 规则误判为 Hook，2026-09-11 改名） */
const isMockMode = () => CONFIG.USE_MOCK

export async function getFamilyMoments(familyId: string, limit?: number): Promise<PetMoment[]> {
  if (isMockMode()) return mockApi.getMoments(familyId, limit)
  const params: Record<string, string> = {}
  if (limit) params.limit = String(limit)
  const data = await api.get<PetMoment[]>(`/api/families/${familyId}/moments`, params)
  return data || []
}

export async function getNewMoments(familyId: string, since: string): Promise<PetMoment[]> {
  if (isMockMode()) return mockApi.getNewMoments(familyId, since)
  const data = await api.get<PetMoment[]>(`/api/families/${familyId}/moments/new`, { since })
  return data || []
}

export function formatMomentTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  if (diffHour < 24) return `${diffHour}小时前`
  if (diffDay < 7) return `${diffDay}天前`
  // 超过 7 天改显示具体日期：必须取**本地日历日**。
  // isoString 是 UTC 串（如 2026-09-10T20:00:00.000Z），直接用 getMonth/getDate
  // 在东八区 20:00 之后会显示成前一天（2026-09-11 排查）。
  const localDay = parseLocalDate(isoString)
  if (!localDay) return ''
  return `${localDay.getMonth() + 1}月${localDay.getDate()}日`
}

export function getMomentTypeInfo(type: string): { icon: string; label: string } {
  switch (type) {
    case 'checkin':
      return { icon: '✅', label: '健康打卡' }
    case 'milestone':
      return { icon: '🎉', label: '里程碑' }
    case 'photo':
      return { icon: '📷', label: '分享照片' }
    case 'memory':
      return { icon: '💭', label: '回忆' }
    case 'ai_summary':
      return { icon: '🤖', label: 'AI周报' }
    default:
      return { icon: '📝', label: '动态' }
  }
}
