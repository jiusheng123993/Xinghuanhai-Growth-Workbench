/**
 * 用户反馈服务
 * NPS 满意度调查提交和历史查询
 */
import { api } from './api'

export interface NpsSubmitParams {
  score: number
  feedback?: string
  trigger_event?: string
}

export interface FeedbackRecord {
  id: string
  feedback_type: string
  score: number | null
  content: string | null
  trigger_event: string | null
  created_at: string
}

/**
 * 提交 NPS 满意度调查
 *
 * ⚠️【2026-09-11 修复】后端 `/api/feedback/nps` 成功时返回的是
 * `{ success: true, message: '感谢您的反馈' }` —— **没有 data 字段**；
 * 而 api 层在 `body.success` 为真时返回的是 `body.data`（也就是 undefined）。
 * 这里原来读 `res.success`，等于读 undefined 的属性 → 直接抛 TypeError 被 catch 吞掉
 * → **即使提交成功也恒返回 false**（调用方会以为用户没提交成功）。
 * 现在以"api 层没有抛错"为成功判据：业务失败时 api 层会 throw（见 services/api.ts 的 request()）。
 */
export async function submitNpsFeedback(params: NpsSubmitParams): Promise<boolean> {
  try {
    await api.post('/api/feedback/nps', {
      score: params.score,
      feedback: params.feedback || '',
      trigger_event: params.trigger_event || '',
    })
    return true
  } catch {
    return false
  }
}

/**
 * 获取用户反馈历史
 *
 * 后端返回 camelCase 包裹 `{ success, data: rows }`，而 api 层已把 data 解包出来，
 * 所以这里拿到的是记录数组本身。原来又读一层 `res.data` → 恒 undefined → **历史永远为空**。
 * （记录字段本就是 snake_case，与 FeedbackRecord 定义一致，无需再做大小写转换）
 */
export async function getMyFeedbackHistory(): Promise<FeedbackRecord[]> {
  try {
    const rows = await api.get<FeedbackRecord[]>('/api/feedback/my')
    return rows || []
  } catch {
    return []
  }
}