/**
 * AI 服务提供者
 *
 * 封装 AI 对话请求、内容安全审核（输入/输出）的 HTTP 客户端
 */
import Taro from '@tarojs/taro'
import type { ChatMessage } from '../types/chatTypes'
import { CONFIG } from '../config'
import { storage } from '../utils/storage'

/** AI 对话请求接口 */
interface ChatRequest {
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  /**
   * 思考模式开关（2026-09-10 新增，服务端 chatMessageSchema 已支持并透传）：
   * Ark/DeepSeek V4 默认开启思考，reasoning_content 会吃满 max_tokens → content 返回空串。
   * 需要完整结构化正文的调用（AI 取名推荐/命理解读/命理详情）必须传 'disabled'，
   * 否则前端只会拿到空内容并静默降级为本地兜底文案。
   */
  thinking?: 'enabled' | 'disabled'
  petId?: string
  /** 服务端持久化历史时使用的用户消息文本（可选）：发图轮前端把"[图片] 文字｜视觉观察：…"
   *  合并文本传给服务端落库，保证与前端 chatHistory 逐字一致——Agent 链路按精确匹配去重，
   *  双侧一致才能命中去重；跨会话重进页面后也能召回视觉观察文本 */
  persistUserContent?: string
  /** 会话 id（多会话改造 2026-09-10）：旧版降级链路也按会话落库 */
  sessionId?: string
}

/**
 * 发送 AI 对话请求
 * @param request - 对话参数（消息列表/温度/最大 token 数等）
 * @returns AI 回复文本
 */
export async function chat(request: ChatRequest): Promise<string> {
  const token = storage.getToken()
  try {
    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/ai/chat`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: request,
    })
    if (res.statusCode === 200) {
      const body = res.data as { success: boolean; data: { content: string } }
      if (body.success && body.data?.content) {
        return body.data.content
      }
      console.warn('[AIProvider] AI 返回非成功状态:', body)
    } else {
      console.error('[AIProvider] AI 请求失败，状态码:', res.statusCode, res.data)
    }
    return 'AI服务暂不可用，请稍后再试'
  } catch (err) {
    console.error('[AIProvider] AI 请求网络异常:', err)
    return '网络异常，请检查网络连接后重试'
  }
}

/** AI 内容安全审核结果 */
export interface GuardResult {
  isHarmful: boolean
  score: number
  isCrisis: boolean
}

/**
 * 用户输入安全审核
 *
 * 2026-09-10 契约修复：服务端 `/api/ai/guard` 返回的是 `{success, data:{isHarmful,score,isCrisis}}`
 * （routes/ai.ts:181），而本函数此前直接 `res.data as GuardResult` → isHarmful 恒为 undefined，
 * namingService/chatService 的 `if (guardResult.isHarmful)` **永远不会触发**，输入安全审核形同虚设。
 * 现按 `data` 解包（并保留对平铺结构的兼容），同时把字段强制成期望类型，避免脏数据穿透。
 * @param text - 用户输入文本
 */
export async function guardCheck(text: string): Promise<GuardResult> {
  const token = storage.getToken()
  const safe: GuardResult = { isHarmful: false, score: 0, isCrisis: false }
  try {
    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/ai/guard`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: { text },
    })
    if (res.statusCode === 200) {
      // 兼容两种结构：`{success,data:{...}}`（当前服务端）与平铺 `{...}`（历史/兜底）
      const body = res.data as { data?: Partial<GuardResult> } & Partial<GuardResult>
      const payload = body?.data ?? body
      const score = Number(payload?.score)
      return {
        isHarmful: payload?.isHarmful === true,
        score: Number.isFinite(score) ? score : 0,
        isCrisis: payload?.isCrisis === true,
      }
    }
    return safe
  } catch {
    return safe
  }
}

/**
 * AI 输出安全审核（医疗建议合规检查）
 *
 * 2026-09-10：与 guardCheck 同源契约问题——服务端 `/api/ai/guard/output` 当前是平铺
 * `{isUnsafeMedicalAdvice}`（routes/ai.ts:198），此处同时兼容包壳结构与平铺结构，
 * 避免接口风格调整后静默恒返回"安全"。
 * @param text - AI 回复文本
 */
export async function guardCheckOutput(text: string): Promise<{ isUnsafeMedicalAdvice: boolean }> {
  const token = storage.getToken()
  try {
    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/ai/guard/output`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: { text },
    })
    if (res.statusCode === 200) {
      const body = res.data as { data?: { isUnsafeMedicalAdvice?: boolean } } & { isUnsafeMedicalAdvice?: boolean }
      const payload = body?.data ?? body
      return { isUnsafeMedicalAdvice: payload?.isUnsafeMedicalAdvice === true }
    }
    return { isUnsafeMedicalAdvice: false }
  } catch {
    return { isUnsafeMedicalAdvice: false }
  }
}
