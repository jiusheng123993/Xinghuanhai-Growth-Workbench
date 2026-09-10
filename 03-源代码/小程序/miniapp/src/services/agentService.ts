/**
 * 前端 Agent 服务
 *
 * 使用 Taro.request 的 enableChunked 模式模拟 SSE 流式接收
 * 微信小程序不支持标准 EventSource，通过分块传输实现
 */
import Taro from '@tarojs/taro'
import type { ChatMessage } from '../types/chatTypes'
import { CONFIG } from '../config'
import { storage } from '../utils/storage'
import { logger } from '../logger'

// ========== Agent 事件类型 ==========

export interface AgentThinkingEvent {
  type: 'thinking'
  data: { iteration: number }
}

export interface AgentToolCallEvent {
  type: 'tool_call'
  data: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface AgentToolResultEvent {
  type: 'tool_result'
  data: {
    name: string
    success: boolean
    message?: string
    data?: unknown
  }
}

export interface AgentTokenEvent {
  type: 'token'
  data: { text: string }
}

export interface AgentDoneEvent {
  type: 'done'
  data: { content: string; iterations?: number; blocked?: boolean }
}

export interface AgentErrorEvent {
  type: 'error'
  data: { message: string }
}

export type AgentEvent =
  | AgentThinkingEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentTokenEvent
  | AgentDoneEvent
  | AgentErrorEvent

// ========== 工具调用的友好展示名 ==========

const TOOL_LABELS: Record<string, string> = {
  get_pet_profile: '查看宠物档案',
  get_pet_facts: '查看宠物特征',
  get_recent_checkins: '查询近期打卡',
  record_health_checkin: '记录健康打卡',
  query_food_safety: '查询食物安全',
  check_symptom: '症状评估',
  get_vaccine_calendar: '查询疫苗日历',
  get_health_trends: '分析健康趋势',
  search_breed_info: '查询品种百科',
  get_family_pets: '查看家庭宠物',
  record_feeding: '记录喂养',
  search_hospital: '搜索附近医院',
  start_naming: '启动AI取名',
  start_checkin: '启动健康打卡',
  record_memory: '启动回忆记录',
}

export function getToolLabel(name: string): string {
  return TOOL_LABELS[name] || name
}

// ========== 加载服务端持久化历史 ==========

export interface HistoryEntry {
  role: 'user' | 'assistant'
  content: string
}

export async function loadAgentHistory(petId?: string, limit = 20, sessionId?: string): Promise<HistoryEntry[]> {
  const token = storage.getToken()
  if (!token) return []

  try {
    const params: string[] = [`limit=${limit}`]
    if (petId) params.push(`petId=${encodeURIComponent(petId)}`)
    if (sessionId) params.push(`sessionId=${encodeURIComponent(sessionId)}`)

    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/agent/history?${params.join('&')}`,
      method: 'GET',
      header: { Authorization: `Bearer ${token}` },
    })

    if (res.statusCode === 200) {
      const body = res.data as { success: boolean; data: { history: HistoryEntry[] } }
      if (body.success && body.data?.history) {
        return body.data.history
      }
    }
    return []
  } catch {
    return []
  }
}

// ========== 聊天会话（多会话改造 2026-09-10） ==========

/** 会话摘要（后端 /api/agent/sessions 返回） */
export interface ChatSession {
  id: string
  petId: string | null
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

/** 列出当前用户的聊天会话（可按 petId 过滤），按最近活跃倒序 */
export async function listChatSessions(petId?: string): Promise<ChatSession[]> {
  const token = storage.getToken()
  if (!token) return []

  try {
    const qs = petId ? `?petId=${encodeURIComponent(petId)}` : ''
    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/agent/sessions${qs}`,
      method: 'GET',
      header: { Authorization: `Bearer ${token}` },
    })

    if (res.statusCode === 200) {
      const body = res.data as { success: boolean; data: { sessions: ChatSession[] } }
      if (body.success && body.data?.sessions) {
        return body.data.sessions
      }
    }
    return []
  } catch {
    return []
  }
}

/** 新建会话（后端会把该宠物下无会话归属的存量消息归并进新会话） */
export async function createChatSession(petId?: string): Promise<ChatSession | null> {
  const token = storage.getToken()
  if (!token) return null

  try {
    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/agent/sessions`,
      method: 'POST',
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: { petId: petId || undefined },
    })

    if (res.statusCode === 200) {
      const body = res.data as { success: boolean; data: { session: ChatSession } }
      if (body.success && body.data?.session) {
        return body.data.session
      }
    }
    return null
  } catch {
    return null
  }
}

/** 删除会话（级联删除其消息） */
export async function deleteChatSession(sessionId: string): Promise<boolean> {
  const token = storage.getToken()
  if (!token) return false

  try {
    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}`,
      method: 'DELETE',
      header: { Authorization: `Bearer ${token}` },
    })
    return res.statusCode === 200
  } catch {
    return false
  }
}

// ========== Agent 对话请求 ==========

export interface AgentChatParams {
  message: string
  history?: ChatMessage[]
  petId?: string
  /** 会话 id（多会话改造）：消息持久化归入该会话 */
  sessionId?: string
}

/**
 * 发送前对对话历史做安全裁剪，与服务端 agentChatSchema 校验规则保持一致
 * - 只保留 user/assistant 角色（schema 只允许这两种角色）
 * - 最多保留最近 10 条（schema 限制 history 最多 10 条）
 * - 每条内容截断到 1000 字（schema 限制 content 最长 1000）
 * 否则请求会被 400 拦截，前端收不到任何流式事件，导致界面出现空白回复
 * @param history - 原始对话历史（可缺省）
 * @returns 裁剪后的安全历史列表
 */
function sanitizeHistory(history?: ChatMessage[]): ChatMessage[] {
  return (history || [])
    .filter((h): h is ChatMessage => h.role === 'user' || h.role === 'assistant')
    .slice(-10)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 1000) }))
}

/**
 * 发送 Agent 对话请求，返回事件流
 *
 * 微信小程序限制：不支持标准 SSE，通过 enableChunked 接收分块数据
 * 服务端每次 send 一个 SSE 事件，客户端逐块解析
 */
export async function* agentChat(params: AgentChatParams): AsyncGenerator<AgentEvent> {
  const token = storage.getToken()

  let buffer = ''

  try {
    const requestTask = Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/agent/chat`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: {
        message: params.message,
        history: sanitizeHistory(params.history),
        petId: params.petId,
        sessionId: params.sessionId,
      },
      enableChunked: true,
      responseType: 'text',
    })

    // 监听分块数据
    const done = await new Promise<boolean>((resolve, reject) => {
      requestTask.onChunkReceived((res) => {
        try {
          // 微信小程序中 onChunkReceived 的 data 是 ArrayBuffer
          // 微信小程序 enableChunked 模式下：
        // - res.data 为 string 时：已经是文本
        // - res.data 为 ArrayBuffer 时：Taro 自动 base64 编码了，需要解码
        let text: string
        if (typeof res.data === 'string') {
          text = res.data
        } else {
          // ArrayBuffer → base64 → UTF-8 解码。不用 TextDecoder：微信小程序 JSCore 部分
          // 基础库无 TextDecoder（ReferenceError 被下方 catch 静默吞掉 → buffer 空 → 上层
          // 显示"走神"），改用 storage.ts 同款 atob + escape/decodeURIComponent
          // （ES3 全局函数，微信必可用）做 UTF-8 解码
          const b64 = Taro.arrayBufferToBase64(res.data as ArrayBuffer)
          text = decodeURIComponent(escape(atob(b64)))
        }

          buffer += text
        } catch {
          // 忽略解码错误
        }
      })

      // 请求完成：onChunkReceived 偶发收不到完整分块（微信 enableChunked 竞态/环境差异），
      // 用 success 的完整响应兜底 buffer（responseType:'text' 时 res.data 为完整 SSE 文本）。
      // 双保险：正常时 buffer 已被 chunk 填充，此处不动；onChunkReceived 完全失效时用它兜底。
      requestTask.then((res) => {
        if (!buffer) {
          try {
            const data = (res as { data?: string | ArrayBuffer }).data
            if (typeof data === 'string') {
              buffer = data
            } else if (data) {
              // 同 onChunkReceived：用 atob + escape/decodeURIComponent 解码 UTF-8（避开 TextDecoder）
              const b64 = Taro.arrayBufferToBase64(data as ArrayBuffer)
              buffer = decodeURIComponent(escape(atob(b64)))
            }
          } catch {
            // 兜底解码失败则保持空，交由上层降级
          }
        }
        resolve(true)
      }).catch((err) => reject(err))
    })

    // 请求完成后，解析 buffer 中的所有 SSE 事件
    let yieldedAny = false
    const events = buffer.split('\n\n')
    for (const block of events) {
      if (!block.trim()) continue

      const lines = block.split('\n')
      let eventType = ''
      let eventData = ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6).trim()
        }
      }

      if (eventType && eventData) {
        try {
          const data = JSON.parse(eventData)
          yieldedAny = true
          yield { type: eventType as AgentEvent['type'], data } as AgentEvent
        } catch {
          // 解析失败跳过
        }
      }
    }

    // 守卫 blocked 时服务端返回普通 JSON（非 SSE，无 event:/data: 行），前端按 SSE 切分会产出 0
    // 事件，导致"危机/热线"这类 blocked 回复被吞。这里兜底：0 事件且 buffer 为 blocked JSON 时，
    // 转成 done 事件上屏（保留 reply，含心理援助热线）。
    if (!yieldedAny) {
      const trimmed = buffer.trim()
      if (trimmed.startsWith('{')) {
        try {
          const body = JSON.parse(trimmed) as { success?: boolean; data?: { reply?: string; blocked?: boolean } }
          // 仅当确为「blocked」回复时才转 done 上屏（对齐服务端 blocked JSON 契约，避免误把普通 JSON 当回复）
          if (body?.data?.blocked === true && typeof body.data.reply === 'string') {
            yield { type: 'done', data: { content: body.data.reply, blocked: true } } as AgentEvent
          }
        } catch {
          // 非 JSON，忽略，交给上层兜底
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '网络异常'
    logger.error('agentService', 'Agent chat failed', err)
    yield {
      type: 'error',
      data: { message: `连接失败: ${message}` },
    }
  }
}

/**
 * 非流式 Agent 对话（降级方案）
 * 当流式不可用时使用
 */
export async function agentChatFallback(params: AgentChatParams): Promise<{
  reply: string
  blocked: boolean
}> {
  const token = storage.getToken()

  try {
    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/agent/chat`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: {
        message: params.message,
        history: sanitizeHistory(params.history),
        petId: params.petId,
        sessionId: params.sessionId,
      },
    })

    if (res.statusCode === 200) {
      const body = res.data as { success: boolean; data: { reply: string; blocked?: boolean } }
      if (body.success && body.data) {
        return { reply: body.data.reply, blocked: body.data.blocked || false }
      }
    }
    return { reply: 'AI 服务暂不可用，请稍后再试', blocked: false }
  } catch (err) {
    logger.error('agentService', 'Agent chat fallback failed', err)
    return { reply: '网络异常，请检查网络连接后重试', blocked: false }
  }
}
