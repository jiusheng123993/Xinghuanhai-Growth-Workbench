/**
 * AI 服务提供者
 *
 * 封装 AI 对话请求、内容安全审核（输入/输出）的 HTTP 客户端
 */
import Taro from '@tarojs/taro'
import type { ChatMessage, ChatResponse } from '../types/chatTypes'
import { CONFIG } from '../config'
import { storage } from '../utils/storage'

/** AI 对话请求接口 */
interface ChatRequest {
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
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
 * @param text - 用户输入文本
 */
export async function guardCheck(text: string): Promise<GuardResult> {
  const token = storage.getToken()
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
      return res.data as GuardResult
    }
    return { isHarmful: false, score: 0, isCrisis: false }
  } catch {
    return { isHarmful: false, score: 0, isCrisis: false }
  }
}

/**
 * AI 输出安全审核（医疗建议合规检查）
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
      return res.data as { isUnsafeMedicalAdvice: boolean }
    }
    return { isUnsafeMedicalAdvice: false }
  } catch {
    return { isUnsafeMedicalAdvice: false }
  }
}
