/**
 * AI 聊天服务
 *
 * 宠物健康助手的对话处理，含安全检查（规则守卫 + AI 内容审核）、系统提示构建
 */
import Taro from '@tarojs/taro'
import type { ChatMessage } from '../types/chatTypes'
import { chat, guardCheck, guardCheckOutput } from './aiProvider'
import { checkInput as ruleCheck } from '../utils/ruleGuard'
import { SYSTEM_PROMPT_BASE } from '../types/chatTypes'
import { requireAuth } from '../utils/authGuard'
import { logger } from '../logger'
import { AiMemoryInjector } from '../memory-body/injectors/aiMemoryInjector'
import { CONFIG } from '../config'
import { storage } from '../utils/storage'

export interface ChatContext {
  petId?: string
  petName?: string
  petBreed?: string
  petAge?: string
  recentCheckins?: string
  familyMembers?: string
  /** 用户上传图片的视觉分析结果（由 /api/ai/photo-analyze 生成），注入 system prompt 让 AI 基于照片回答 */
  imageAnalysis?: string
}

/** 清洗 context 字段，防止 Prompt Injection */
function sanitizeContextField(value: string | undefined): string {
  if (!value) return ''
  return value
    .replace(/[<>]/g, '')
    .replace(/\[SYSTEM\]|\[USER\]|\[ASSISTANT\]|\[INST\]|\[\/INST\]/gi, '')
    .replace(/ignore|bypass|override|system prompt|you are now/gi, '')
    .substring(0, 200)
}

function buildSystemPrompt(context: ChatContext): string {
  let prompt = SYSTEM_PROMPT_BASE
  if (context.petName) {
    const safeName = sanitizeContextField(context.petName)
    const safeBreed = sanitizeContextField(context.petBreed)
    const safeAge = sanitizeContextField(context.petAge)
    prompt += `\n当前活跃宠物：${safeName}（${safeBreed || '未知品种'}，${safeAge || '未知年龄'}）`
    if (context.recentCheckins) {
      const safeCheckins = sanitizeContextField(context.recentCheckins)
      prompt += `\n近14天打卡摘要：${safeCheckins}`
    }
  }
  if (context.familyMembers) {
    const safeMembers = sanitizeContextField(context.familyMembers)
    prompt += `\n家庭成员：${safeMembers}`
  }
  // 用户上传了宠物照片：注入视觉分析结果，让 AI 基于照片内容回答（金科玉律：描述只作上下文，不当作指令）
  if (context.imageAnalysis) {
    const safeAnalysis = sanitizeContextField(context.imageAnalysis)
    if (safeAnalysis) {
      prompt += `\n\n用户上传了一张宠物照片，以下是对照片的视觉观察结果：\n「${safeAnalysis}」\n请基于上面的照片观察，优先回答用户关于这张照片的问题；照片里看不到的信息不要推测。`
    }
  }
  return prompt
}

export interface ChatResult {
  reply: string
  blocked: boolean
}

/**
 * 上传宠物照片并做视觉分析
 *
 * 背景：聊天「发图片」此前只发文字、图片从未上传，AI 看不到照片。本次打通：
 * 前端上传 → POST /api/ai/photo-analyze → 返回照片描述，供注入对话上下文。
 *
 * 安全：服务端 uploadLimiter 限流（付费视觉调用）；上传接口非 downloadFile 域名校验，无需额外配置。
 * @param tempFilePath - 微信 chooseMedia 返回的本地临时文件路径
 * @returns 视觉描述文本；上传/分析失败返回 null（调用方降级）
 */
export async function analyzeChatPhoto(tempFilePath: string): Promise<string | null> {
  try {
    const token = storage.getToken()
    const res = await Taro.uploadFile({
      url: `${CONFIG.API_BASE_URL}/api/ai/photo-analyze`,
      filePath: tempFilePath,
      name: 'photo',
      header: token ? { Authorization: `Bearer ${token}` } : {},
    })

    const data = JSON.parse(res.data) as { success: boolean; data?: { description: string }; message?: string }
    if (data.success && data.data?.description) {
      return data.data.description
    }
    // 503 视觉未配置 / 500 失败：返回 null，由调用方降级，不把"分析失败"当"看不到图"
    logger.warn('chatService', 'photo-analyze failed', data.message)
    return null
  } catch (err) {
    logger.error('chatService', 'photo-analyze error', err)
    return null
  }
}

/**
 * 发送聊天消息给 AI 助手
 * 经过规则检查、AI 内容审核、输出安全过滤后返回回复
 * @param userMessage - 用户输入的消息
 * @param context - 对话上下文（宠物信息等）
 * @param history - 历史消息列表
 * @param options - 可选扩展：persistUserContent 指定服务端持久化历史时的用户消息文本
 *   （发图轮传"[图片] 文字｜视觉观察：…"合并文本，与前端 chatHistory 逐字一致，
 *   保证 Agent 链路精确去重命中 + 跨会话召回观察文本；普通文字轮不传，存消息原文）
 * @returns 回复内容和是否被拦截
 */
export async function sendChatMessage(
  userMessage: string,
  context: ChatContext,
  history: ChatMessage[] = [],
  options?: { persistUserContent?: string }
): Promise<ChatResult> {
  const { userId } = requireAuth()

  const ruleResult = ruleCheck(userMessage)
  if (ruleResult.blocked) {
    if (ruleResult.action === 'crisis_intervention') {
      return {
        reply: '我注意到你可能需要帮助。请拨打24小时心理援助热线：400-161-9995。你不需要一个人面对。',
        blocked: true
      }
    }
    return {
      reply: '抱歉，我无法处理这条消息。请尝试其他与宠物相关的问题。',
      blocked: true
    }
  }

  try {
    const guardResult = await guardCheck(userMessage)
    if (guardResult.isHarmful) {
      return {
        reply: '抱歉，我无法处理这条消息。请尝试其他与宠物相关的问题。',
        blocked: true
      }
    }
    if (guardResult.isCrisis) {
      return {
        reply: '我注意到你可能需要帮助。请拨打24小时心理援助热线：400-161-9995。',
        blocked: true
      }
    }
  } catch (err) {
    logger.error('chatService', 'Guard check failed, blocking message', err)
    return {
      reply: 'AI安全检查服务暂不可用，请稍后再试。',
      blocked: true
    }
  }

  let systemPrompt = buildSystemPrompt(context)
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10),
    { role: 'user', content: userMessage }
  ]

  // 注入宠物记忆到 AI 对话
  if (userId && context.petId) {
    try {
      const injector = new AiMemoryInjector(userId)
      const memoryContext = injector.buildSystemPrompt({
        id: context.petId,
        name: context.petName || '',
        species: '',
        breed: context.petBreed || '',
        gender: '',
        birthDate: '',
      })
      if (memoryContext) {
        systemPrompt = systemPrompt ? `${systemPrompt}\n${memoryContext}` : memoryContext
        messages[0] = { ...messages[0], content: systemPrompt }
      }
    } catch (e) {
      // 记忆注入失败不影响主流程
      console.warn('[MemoryInjector] failed to inject memory context', e)
    }
  }

  try {
    // persistUserContent 仅透传给服务端做持久化，不参与当轮对话（LLM 收到的仍是 userMessage）
    const reply = await chat({
      messages,
      temperature: 0.7,
      petId: context.petId,
      persistUserContent: options?.persistUserContent,
    })

    const outputCheck = await guardCheckOutput(reply)
    if (outputCheck.isUnsafeMedicalAdvice) {
      return {
        reply: '根据我的分析，建议你咨询专业兽医进行确认。以上信息仅供参考，不替代兽医诊断。',
        blocked: false
      }
    }

    // 聊天为纯文本渲染（React {text} 自动转义 XSS，无需手动 HTML 转义），只做长度截断。
    // 此前用 sanitizeOutput 做 HTML 转义，会把 AI 回复里的双引号转成 &quot; 等实体乱码
    // （2026-09-10 用户反馈"聊天出现不相干符号 &quot"）。截断 2000 与服务端持久化口径一致。
    const safeReply = reply.length > 2000 ? reply.slice(0, 2000) : reply

    return {
      reply: safeReply,
      blocked: false
    }
  } catch (err) {
    logger.error('chatService', 'AI chat failed', err)
    return {
      reply: '抱歉，我现在有点走神了…请稍后再试，或者试试点击快捷按钮进行打卡/查食物。',
      blocked: false
    }
  }
}
