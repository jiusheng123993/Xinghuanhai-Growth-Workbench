/**
 * 聊天核心 Hook
 * 管理消息列表、流式输出、打字效果、语义意图识别与 Agent 编排
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { sendChatMessage, analyzeChatPhoto, type ChatContext } from '../services/chatService'
import { agentChat, getToolLabel, loadAgentHistory } from '../services/agentService'
import type { CardData, ChatMessage, Message, PetInfo } from '../types/chatTypes'
import { logger } from '../logger'
import { chooseImageWithPrivacy } from '../utils/privacy'

let messageIdCounter = 0

// ========== 语义意图识别：文本归一化 + 正则模式匹配 ==========

/** 归一化文本：去标点、去空格、转小写，用于模糊匹配 */
function normalizeText(text: string): string {
  return text
    .replace(/[，。！？、；：""''「」『』【】（）《》\s\n\r\t]/g, '')
    .toLowerCase()
}

/**
 * 意图模式定义：每个模式包含正则数组和对应的流程动作
 * 正则已归一化（无标点无空格），匹配时对用户输入也做归一化
 */
interface IntentPattern {
  /** 正则模式数组（匹配归一化后的文本） */
  patterns: RegExp[]
  /** 触发动作 */
  action: () => void
}

/**
 * 构建意图匹配器（Layer 1 快捷入口）
 *
 * 设计原则：Layer 1 只拦截"用户明确要开启某个流程"的高精度表达
 * （如"帮我取个名字""打卡""查一下能不能吃"），起到零延迟快捷入口的作用。
 * 其余所有描述性/疑问性的表达一律交还给 LLM agent 回答——
 * LLM 会在需要时通过工具（start_naming / start_checkin / record_memory 等）
 * 触发前端流程（Layer 2），所以收窄正则不会丢失流程能力，只会让对话更智能。
 */
function buildIntentMatcher(handlers: {
  startNaming?: () => void
  startCheckin?: () => void
  startMemory?: () => void
  startSymptom?: () => void
  startFoodQuery?: () => void
  navigateToBreed?: () => void
}): IntentPattern[] {
  return [
    // ===== 取名意图 =====
    {
      patterns: [
        /(?:帮|给|为|替)(?:我|我们|我家|咱|咱们)?(?:宠物|猫|狗|猫咪|狗狗|毛孩子|宝贝|主子|汪星人|喵星人)?(?:取|起|想|推荐|挑|选|改|换)(?:个|什么|啥|一个)?(?:名|名字|名称)/,
        /(?:取|起)(?:个|什么|啥|一个)?(?:名|名字|名称)/,
        /(?:改|换)(?:个|什么|啥)?(?:名|名字|名称)/,
        /(?:有什么|有啥|求|推荐)(?:好|好听|可爱|霸气|特别)?(?:的)?(?:名|名字|名称)/,
        /(?:想不出|不知道|没想好|纠结|没灵感)(?:叫|取|起)?(?:什么|啥)?(?:名|名字|名称)?/,
        /(?:名字|命名)(?:推荐|建议|生成|创造)/,
        /(?:取|起|想)(?:个|什么|啥)?(?:好听|可爱|霸气|特别|洋气|古风|文艺|有趣)?(?:的)?(?:名|名字|名称)/,
      ],
      action: () => handlers.startNaming?.(),
    },
    // ===== 打卡意图 =====
    {
      patterns: [
        /(?:来|要|想|我要|我想)?(?:打卡|签到)(?:一下|啦|吧|吗|了)?/,
        /(?:每日|日常|健康|今日)(?:打卡|记录|签到)/,
        /(?:记录|做|写)(?:一下|个)?(?:今日|今天)?(?:打卡|健康记录)/,
        /(?:开始|做|来)(?:个|一次|下)?(?:健康|每日|日常|今日)?(?:打卡|检查)/,
      ],
      action: () => handlers.startCheckin?.(),
    },
    // ===== 回忆意图 =====
    {
      patterns: [
        /(?:写|记)(?:个|篇|段)?(?:日记|回忆|日志)/,
        /(?:记录|保存|留下|添加)(?:一下|个)?(?:回忆|日记|记忆|时光)/,
        /(?:回忆|日记|瞬间|时光|记忆)(?:记录|录入|添加|保存)/,
        /(?:记录|保存)(?:一下|今天|今日)?(?:我们|我和|和)?(?:宠物|猫|狗|豆豆|宝贝)?(?:的)?(?:故事|回忆|经历)/,
        /(?:记|写)(?:下|录)(?:今天|今日)?(?:的)?(?:事|事情|经历)/,
      ],
      action: () => handlers.startMemory?.(),
    },
    // ===== 症状意图（只保留明确的"帮我看看"类请求，症状描述交给 LLM 调 check_symptom） =====
    {
      patterns: [
        /(?:症状|健康|身体)(?:检查|初筛|评估|分析|筛查)/,
        /(?:帮|给|帮帮)(?:我|我们)?(?:看|看看)(?:一下)?(?:怎么|什么|咋)?(?:了|回事|情况)/,
      ],
      action: () => handlers.startSymptom?.(),
    },
    // ===== 食物查询意图（只保留明确的"查一下"请求，具体食物问题交给 LLM 调 query_food_safety） =====
    {
      patterns: [
        /(?:查|查询|搜索|搜)(?:一下|下)?(?:食物|能不能吃|可不可以吃|安全|毒性)/,
        /(?:食物|饮食|喂养)(?:安全|查询|建议|指南|推荐|禁忌)/,
      ],
      action: () => handlers.startFoodQuery?.(),
    },
    // ===== 品种百科意图（只保留明确的"查品种"导航请求，具体品种问题交给 LLM 调 search_breed_info） =====
    {
      patterns: [
        /(?:查|看|搜|了解|介绍)(?:一下|下)?(?:品种|种类|百科)/,
        /(?:品种|种类)(?:百科|介绍|信息|查询|推荐|大全|列表)/,
      ],
      action: () => handlers.navigateToBreed?.(),
    },
  ]
}

/** 生成唯一消息 ID */
export function genId(): string {
  return `msg_${++messageIdCounter}_${Date.now()}`
}

/** 食物/回忆/取名流程处理器，由主组件注册以打破循环依赖 */
export interface FlowHandlers {
  foodActive: boolean
  selectFood: (text: string) => void | Promise<void>
  memoryActive: boolean
  handleMemoryRecord: (text: string) => void | Promise<void>
  namingTextActive: boolean
  handleNamingText: (text: string) => void | Promise<void>
  /** 启动取名流程 */
  startNaming?: () => void
  /** 启动打卡流程 */
  startCheckin?: () => void
  /** 启动回忆记录流程 */
  startMemory?: () => void
  /** 启动症状初筛流程 */
  startSymptom?: () => void
  /** 启动食物查询流程 */
  startFoodQuery?: () => void
  /** 跳转品种百科 */
  navigateToBreed?: () => void
  /** Agent 工具调用触发的流程动作回调（语义识别第二层）；data 为工具返回的附加数据（如 breedId） */
  onToolAction?: (action: string, data?: Record<string, unknown>) => void
}

export interface UseChatCoreParams {
  petInfo: PetInfo
  /** 输入框当前值 */
  inputValue: string
  /** 清空输入框 */
  setInputValue: (value: string) => void
  /** 关闭加号菜单 */
  setPlusMenuOpen: (open: boolean) => void
  /** 隐藏问候快捷操作 */
  setShowGreetingQuickActions: (show: boolean) => void
}

/**
 * 聊天核心 Hook
 *
 * 管理消息列表、流式输出、打字状态与聊天历史，
 * 并通过 handleSend 编排普通聊天流程与食物/回忆流程的分流。
 */
export function useChatCore(params: UseChatCoreParams) {
  const { petInfo, inputValue, setInputValue, setPlusMenuOpen, setShowGreetingQuickActions } = params

  const [messages, setMessages] = useState<Message[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [agentToolStatus, setAgentToolStatus] = useState<string | null>(null)
  // 待发送图片附件（2026-09-10 发图带文字）：选图后先入附件区不发送，用户可继续输入
  // 补充文字，点发送后图文合并为一条消息发出（对齐微信 IM 习惯）
  const [pendingImage, setPendingImage] = useState<string | null>(null)

  const streamRef = useRef<{
    timer: ReturnType<typeof setInterval> | null
    fullContent: string
    id: string
  } | null>(null)

  // Agent 流式跳过标记
  const agentSkipRef = useRef(false)

  const scrollRef = useRef<any>(null)

  /** 食物/回忆/取名流程处理器引用，由主组件通过 setFlowHandlers 注册 */
  const flowHandlersRef = useRef<FlowHandlers>({
    foodActive: false,
    selectFood: () => {},
    memoryActive: false,
    handleMemoryRecord: () => {},
    namingTextActive: false,
    handleNamingText: () => {},
  })

  /** 注册食物/回忆流程处理器 */
  const setFlowHandlers = useCallback((handlers: FlowHandlers) => {
    flowHandlersRef.current = handlers
  }, [])

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 999999
      }
    }, 100)
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, scrollToBottom])

  // 加载服务端持久化对话历史
  useEffect(() => {
    if (!petInfo.hasPet) return
    loadAgentHistory(petInfo.activePet?.id, 20)
      .then((history) => {
        if (history.length > 0) {
          setChatHistory(
            history.map((h) => ({
              role: h.role,
              content: h.content,
            }))
          )
          logger.info('useChatCore', `Loaded ${history.length} history entries from server`)
        }
      })
      .catch(() => {})
  }, [petInfo.activePet?.id, petInfo.hasPet])

  const addMessage = useCallback((msg: Omit<Message, 'id'>): string => {
    const id = genId()
    const newMsg: Message = { ...msg, id }
    setMessages(prev => [...prev, newMsg])
    return id
  }, [])

  /** 更新指定消息的 card 数据（用于"换一批"等场景） */
  const updateMessageCard = useCallback((msgId: string, card: CardData) => {
    setMessages(prev =>
      prev.map(m => (m.id === msgId ? { ...m, card } : m))
    )
  }, [])

  const addAiMsg = useCallback(
    (content: string, options?: string[]) => {
      addMessage({ type: 'ai', content, options })
    },
    [addMessage]
  )

  const addUserMsg = useCallback(
    (content: string) => {
      addMessage({ type: 'user', content })
    },
    [addMessage]
  )

  /** 打字机效果逐字输出 AI 回复 */
  const streamAiReply = useCallback((fullContent: string, onDone?: () => void) => {
    const id = genId()
    setMessages(prev => [...prev, { id, type: 'ai', content: '' }])
    setStreamingId(id)

    const chars = Array.from(fullContent)
    let idx = 0

    streamRef.current = { timer: null, fullContent, id }
    streamRef.current.timer = setInterval(() => {
      idx += 2
      if (idx >= chars.length) {
        setMessages(prev =>
          prev.map(m => (m.id === id ? { ...m, content: fullContent } : m))
        )
        if (streamRef.current?.timer) clearInterval(streamRef.current.timer)
        streamRef.current = null
        setStreamingId(null)
        onDone?.()
        return
      }
      setMessages(prev =>
        prev.map(m => (m.id === id ? { ...m, content: chars.slice(0, idx).join('') } : m))
      )
    }, 25)
  }, [])

  /** 跳过流式，立即显示完整内容 */
  const skipStream = useCallback(() => {
    // 旧版流式（timer 模式）
    if (streamRef.current) {
      if (streamRef.current.timer) clearInterval(streamRef.current.timer)
      const { fullContent, id } = streamRef.current
      setMessages(prev =>
        prev.map(m => (m.id === id ? { ...m, content: fullContent } : m))
      )
      streamRef.current = null
      setStreamingId(null)
    }
    // Agent 流式模式
    agentSkipRef.current = true
    setAgentToolStatus(null)
  }, [])

  // 组件卸载时清理流式定时器
  useEffect(() => {
    return () => {
      if (streamRef.current?.timer) clearInterval(streamRef.current.timer)
    }
  }, [])

  /** 发送图片消息 */
  const addImageMsg = useCallback(
    (imageUrl: string, content?: string) => {
      addMessage({ type: 'user', content: content || '', imageUrl })
    },
    [addMessage]
  )

  /**
   * 从相册/相机选择图片（sourceType 可指定图片来源，默认两者）
   *
   * 2026-09-10 发图带文字改造：选图后不再直接发送，而是进入输入框上方的待发送
   * 附件区，用户可补充文字后点发送（sendPendingImage），或点 × 取消（clearPendingImage）。
   */
  const handleChooseImage = useCallback(async (sourceType?: ('album' | 'camera')[]) => {
    try {
      const res = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: sourceType ?? ['album', 'camera'],
      })
      if (!res.tempFilePaths.length) return

      // 仅挂起附件；清空输入框历史遗留文字，避免把无关草稿误当图片说明发出
      setPendingImage(res.tempFilePaths[0])
    } catch (err) {
      const errMsg = (err as { errMsg?: string }).errMsg || ''
      if (errMsg.includes('cancel')) {
        return
      }
      // chooseImageWithPrivacy 已对 errno 112 / privacy 拒绝 / 其他失败做过针对性提示
      // （modal/toast），此处不再重复 toast——微信 toast 单例会互相覆盖针对性提示，
      // 仅记录日志（P2 审查项：提示责任收敛于 privacy.ts）
      logger.error('index', 'chooseImage failed', err)
    }
  }, [])

  /** 清空待发送图片附件（用户在附件条点 × 取消） */
  const clearPendingImage = useCallback(() => {
    setPendingImage(null)
  }, [])

  /**
   * 发送待发送图片（可带用户补充文字）
   * @param text - 用户为图片补充的说明文字，可为空（空则沿用自动分析引导文案）
   * @remarks 调用契约：本函数不清空输入框，UI 侧必须经 handleSend 的附件分流调用
   * （由 handleSend 统一清空 inputValue）；请勿绕过 handleSend 直接调用。
   *
   * 链路与原"选图即发"一致：图片先上屏（图文同气泡）→ 上传视觉分析 → 旧版聊天
   * 接口生成回复（分析结果注入 context）→ 历史记录保留视觉观察供本会话追问。
   */
  const sendPendingImage = useCallback(async (text?: string) => {
    const imageUrl = pendingImage
    if (!imageUrl) return
    const caption = (text ?? '').trim()
    // 发送即清附件（无论后续成功失败，图已上屏，附件条不应残留）
    setPendingImage(null)

    addImageMsg(imageUrl, caption)

    const context: ChatContext = {
      petId: petInfo.activePet?.id,
      petName: petInfo.name,
      petBreed: petInfo.breed,
      petAge: petInfo.age,
    }

    // 先上传照片并做视觉分析，把"照片里能看到什么"注入对话上下文，AI 才能基于图片回答。
    // 此前这里是占位桩：图片从未上传、AI 只收到一句文字 → 表现为"发图后 AI 说收不到照片"。
    setIsTyping(true)
    const description = await analyzeChatPhoto(imageUrl)
    // 视觉分析成功：注入上下文；失败：降级为普通文字问答（如实说明"暂无法分析图片"，不再谎称看不到）
    if (description) {
      context.imageAnalysis = description
    }

    // 历史里把用户补充文字 + 视觉观察一并存下，用户在本会话继续追问时 AI 保有"照片
    // 看到什么 + 用户说了什么"的完整上下文。观察文本截断到 200 字，与 chatService
    // sanitizeContextField 的注入口径一致：防止长描述抬高 token 成本、避免 Agent 链路
    // 1000 字截断切在句子中段。
    const observationText = description ? description.slice(0, 200) : ''
    const observationPart = observationText ? `视觉观察：${observationText}` : '（暂无法分析图片内容）'
    const userHistoryContent = caption
      ? `[图片] ${caption}｜${observationPart}`
      : `[图片] ${observationPart}`

    try {
      const result = await sendChatMessage(
        caption || (description
          ? '我上传了一张宠物照片，请帮我看看这张照片里的宠物并给出一些建议。'
          : '我上传了一张宠物照片，请帮我看看并给出一些建议。'),
        context,
        chatHistory,
        // 服务端持久化用合并文本：与下方 chatHistory 存储逐字一致，Agent 链路精确
        // 去重才能命中；跨会话重进页面后 Agent 也能从持久化历史召回视觉观察
        { persistUserContent: userHistoryContent }
      )
      setIsTyping(false)

      if (result.blocked) {
        addAiMsg(result.reply)
        setChatHistory(prev => [
          ...prev.slice(-18),
          { role: 'user', content: userHistoryContent },
          { role: 'assistant', content: result.reply },
        ])
      } else {
        streamAiReply(result.reply, () => {
          setChatHistory(prev => [
            ...prev.slice(-18),
            { role: 'user', content: userHistoryContent },
            { role: 'assistant', content: result.reply },
          ])
        })
      }
    } catch (err) {
      setIsTyping(false)
      logger.error('index', 'AI image chat failed', err)
      // 分析成功但回复生成失败：如实说明是"回复"失败，而不是误导为"照片分析失败"
      addAiMsg(description ? '回复生成失败，请稍后再试。' : '图片已收到！虽然我现在无法分析图片内容，但你可以描述一下想了解什么～')
    }
  }, [pendingImage, petInfo, chatHistory, addImageMsg, addAiMsg, streamAiReply])

  /** Agent 模式的发送逻辑（textOverride：外部注入的发送文本，如语音识别结果，优先于 inputValue） */
  const handleSend = async (textOverride?: string) => {
    const text = (textOverride ?? inputValue).trim()
    // 空守卫：无文字且无待发送附件才忽略——此前"选图后不打字直接点发送"被静默吞掉（P0）
    if (!text && !pendingImage) return
    setInputValue('')
    setPlusMenuOpen(false)
    setShowGreetingQuickActions(false)

    const handlers = flowHandlersRef.current

    // ========== 流程分流：进行中的食物/回忆/取名流程优先消费文字输入 ==========
    if (handlers.foodActive || handlers.memoryActive || handlers.namingTextActive) {
      // 流程只接受文字答案，图片附件无法与流程输入合并：清理附件并提示，
      // 防止流程结束后滞留的旧图与下一次输入误合并发送（P1）
      if (pendingImage) {
        clearPendingImage()
        Taro.showToast({ title: '流程进行中，图片已取消', icon: 'none' })
      }
      // 流程中的空文字无处消费（附件已清理），直接结束
      if (!text) return
      if (handlers.foodActive) {
        handlers.selectFood(text)
      } else if (handlers.memoryActive) {
        handlers.handleMemoryRecord(text)
      } else {
        handlers.handleNamingText(text)
      }
      return
    }

    // 待发送图片附件优先于纯文字发送：输入框文字（可为空，空则走自动分析引导文案）
    // 作为图片说明，图文合并为一条消息。顺序在流程分流之后——进行中的流程不被打断。
    if (pendingImage) {
      await sendPendingImage(text)
      return
    }

    addUserMsg(text)

    // ========== Layer 1: 语义意图识别 - 正则模式匹配（零延迟） ==========
    // 只拦截明确的流程开启指令（如"帮我取个名字""打卡"），
    // 其余描述/疑问（如"豆豆今天有点蔫"）交还给 LLM agent，由工具调用兜底触发流程。
    const normalized = normalizeText(text)
    const intentMatchers = buildIntentMatcher({
      startNaming: handlers.startNaming,
      startCheckin: handlers.startCheckin,
      startMemory: handlers.startMemory,
      startSymptom: handlers.startSymptom,
      startFoodQuery: handlers.startFoodQuery,
      navigateToBreed: handlers.navigateToBreed,
    })

    for (const matcher of intentMatchers) {
      if (matcher.patterns.some(p => p.test(normalized))) {
        matcher.action()
        return
      }
    }

    // 构建上下文（用于降级方案）
    const context: ChatContext = {
      petId: petInfo.activePet?.id,
      petName: petInfo.name,
      petBreed: petInfo.breed,
      petAge: petInfo.age,
    }

    setIsTyping(true)
    setAgentToolStatus(null)
    agentSkipRef.current = false

    // 创建占位 AI 消息用于流式输出
    const aiMsgId = genId()
    setMessages(prev => [...prev, { id: aiMsgId, type: 'ai', content: '' }])
    setStreamingId(aiMsgId)

    let fullContent = ''
    // Layer 2: Agent 工具调用触发的流程动作（如 start_checkin → checkin_flow）及附加数据（如 breed_flow → breedId）
    let pendingFlowAction: string | null = null
    let pendingFlowData: Record<string, unknown> | null = null

    try {
      for await (const event of agentChat({
        message: text,
        history: chatHistory,
        petId: context.petId,
      })) {
        // 如果用户点击了跳过，直接显示完整内容
        if (agentSkipRef.current) continue

        switch (event.type) {
          case 'thinking':
            setAgentToolStatus('🤔 正在思考...')
            break

          case 'tool_call':
            setAgentToolStatus(`🔍 ${getToolLabel(event.data.name)}...`)
            break

          case 'tool_result': {
            // ========== Layer 2: 检查工具结果是否包含流程触发动作 ==========
            const toolData = event.data.data as Record<string, unknown> | undefined
            if (toolData?.action && typeof toolData.action === 'string') {
              pendingFlowAction = toolData.action
              pendingFlowData = toolData
              if (event.data.message) {
                fullContent = event.data.message
              }
              // 跳过后续事件，不再等待 Agent 的文字回复
              agentSkipRef.current = true
              continue
            }
            if (event.data.success) {
              setAgentToolStatus(`✅ ${getToolLabel(event.data.name)} 完成`)
            } else {
              setAgentToolStatus(null)
            }
            break
          }

          case 'token':
            fullContent += event.data.text
            setMessages(prev =>
              prev.map(m => m.id === aiMsgId ? { ...m, content: fullContent } : m)
            )
            break

          case 'done':
            setIsTyping(false)
            setAgentToolStatus(null)
            setStreamingId(null)
            if (!fullContent && event.data.content) {
              fullContent = event.data.content as string
              setMessages(prev =>
                prev.map(m => m.id === aiMsgId ? { ...m, content: fullContent } : m)
              )
            }
            setChatHistory(prev => [
              ...prev.slice(-18),
              { role: 'user', content: text },
              { role: 'assistant', content: fullContent },
            ])
            return

          case 'error':
            setIsTyping(false)
            setAgentToolStatus(null)
            setStreamingId(null)
            // Agent 失败时降级到旧版 chatService
            logger.warn('index', 'Agent failed, falling back to legacy chat', event.data)
            try {
              const result = await sendChatMessage(text, context, chatHistory)
              setMessages(prev =>
                prev.map(m => m.id === aiMsgId
                  ? { ...m, content: result.reply }
                  : m
                )
              )
              setChatHistory(prev => [
                ...prev.slice(-18),
                { role: 'user', content: text },
                { role: 'assistant', content: result.reply },
              ])
            } catch {
              setMessages(prev =>
                prev.map(m => m.id === aiMsgId
                  ? { ...m, content: '抱歉，AI 服务暂时不可用，请稍后再试。' }
                  : m
                )
              )
            }
            return
        }
      }

      // ========== 循环结束后处理：Layer 2 流程触发 ==========
      if (pendingFlowAction) {
        // 更新 AI 消息为工具返回的提示语
        setMessages(prev =>
          prev.map(m => m.id === aiMsgId ? { ...m, content: fullContent || '好的' } : m)
        )
        setIsTyping(false)
        setAgentToolStatus(null)
        setStreamingId(null)
        setChatHistory(prev => [
          ...prev.slice(-18),
          { role: 'user', content: text },
          { role: 'assistant', content: fullContent },
        ])
        // 触发前端流程
        flowHandlersRef.current.onToolAction?.(pendingFlowAction, pendingFlowData ?? undefined)
        return
      }
    } catch (err) {
      setIsTyping(false)
      setAgentToolStatus(null)
      setStreamingId(null)
      logger.error('index', 'Agent chat failed', err)
      setMessages(prev =>
        prev.map(m => m.id === aiMsgId
          ? { ...m, content: '抱歉，我现在有点走神了…请稍后再试。' }
          : m
        )
      )
    }

    // 正常结束（无 done 事件的情况，兜底）
    // 排查「为什么不能吃 → 空白气泡」：Agent 事件流若因分块/断开丢失了 done/token，
    // 循环会提前出栈落到这里，而占位 AI 消息 content 仍是 ''（空白气泡）。
    // 修复：把已累积的 fullContent 或兜底文案写入占位消息，保证气泡永远有内容。
    const fallbackContent = fullContent || '抱歉，我刚走神了，请再问一次。'
    setMessages(prev =>
      prev.map(m => m.id === aiMsgId ? { ...m, content: fallbackContent } : m)
    )
    // 同步写入会话上下文（与 done 正常路径一致），保证后续追问能带上本次回复语境
    setChatHistory(prev => [
      ...prev.slice(-18),
      { role: 'user', content: text },
      { role: 'assistant', content: fallbackContent },
    ])
    setIsTyping(false)
    setAgentToolStatus(null)
    setStreamingId(null)
  }

  return {
    messages,
    isTyping,
    setIsTyping,
    chatHistory,
    setChatHistory,
    streamingId,
    scrollRef,
    addMessage,
    addAiMsg,
    addUserMsg,
    addImageMsg,
    streamAiReply,
    skipStream,
    scrollToBottom,
    handleSend,
    handleChooseImage,
    pendingImage,
    clearPendingImage,
    sendPendingImage,
    setFlowHandlers,
    updateMessageCard,
    agentToolStatus,
  }
}

export type UseChatCoreReturn = ReturnType<typeof useChatCore>
