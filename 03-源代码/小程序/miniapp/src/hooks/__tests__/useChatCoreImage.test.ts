/**
 * 聊天发图带文字流程 Hook 单元测试（2026-09-10 发图带文字改造）
 *
 * 背景：此前选图后立即以硬编码文案发送，用户无法为图片补充说明文字。
 * 改造后：选图 → 待发送附件区（pendingImage）→ 可输入文字 → 点发送图文合并为一条消息。
 * 覆盖：选图挂起不发送、取消清理、有/无文字发送、视觉分析注入与降级、
 *       发送分流（有附件时 handleSend 走图片链路而非 Agent）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { useChatCore } from '../useChatCore'
import type { PetInfo } from '../../types/chatTypes'

const {
  mockChooseImage,
  mockAnalyzeChatPhoto,
  mockSendChatMessage,
  mockAgentChat,
  mockLoadAgentHistory,
  mockListChatSessions,
} = vi.hoisted(() => {
  return {
    mockChooseImage: vi.fn(),
    mockAnalyzeChatPhoto: vi.fn(),
    mockSendChatMessage: vi.fn(),
    mockAgentChat: vi.fn(),
    mockLoadAgentHistory: vi.fn(),
    mockListChatSessions: vi.fn(),
  }
})

vi.mock('../../services/chatService', () => ({
  sendChatMessage: (...args: any[]) => mockSendChatMessage(...args),
  analyzeChatPhoto: (...args: any[]) => mockAnalyzeChatPhoto(...args),
}))

vi.mock('../../services/agentService', () => ({
  agentChat: (...args: any[]) => mockAgentChat(...args),
  getToolLabel: (name: string) => name,
  loadAgentHistory: (...args: any[]) => mockLoadAgentHistory(...args),
  listChatSessions: (...args: any[]) => mockListChatSessions(...args),
  createChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
}))

vi.mock('../../utils/privacy', () => ({
  chooseImageWithPrivacy: (...args: any[]) => mockChooseImage(...args),
}))

vi.mock('../../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const petInfo: PetInfo = {
  name: '旺财',
  emoji: '🐕',
  breed: '金毛',
  age: '2岁',
  hasPet: true,
  isLoading: false,
  activePet: { id: 'pet_1', name: '旺财', species: 'dog' as const } as any,
}

function renderCore() {
  return renderHook(() => useChatCore({
    petInfo,
    inputValue: '',
    setInputValue: vi.fn(),
    setPlusMenuOpen: vi.fn(),
    setShowGreetingQuickActions: vi.fn(),
  }))
}

/** 辅助：先选图挂起附件（模拟用户从相册选了一张图） */
async function chooseImage(hook: { result: { current: any } }, path = 'wxfile://tmp/cat.jpg') {
  mockChooseImage.mockResolvedValue({ tempFilePaths: [path] })
  await act(async () => {
    await hook.result.current.handleChooseImage(['album'])
  })
}

describe('useChatCore 发图带文字（pendingImage 附件流）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadAgentHistory.mockResolvedValue([])
    // 多会话改造后 useChatCore 挂载即拉会话列表；默认无会话（列表空），不触发历史加载
    mockListChatSessions.mockResolvedValue([])
    mockAgentChat.mockImplementation(async function* () {
      // 空生成器：不应被调用（有附件时走图片链路）；若被误调用则产出零事件
    } as any)
  })

  it('选图成功：仅挂起附件不发送（无消息上屏、无接口调用）', async () => {
    const hook = renderCore()
    await chooseImage(hook as any)

    expect(hook.result.current.pendingImage).toBe('wxfile://tmp/cat.jpg')
    // 不应触发任何发送行为
    expect(mockAnalyzeChatPhoto).not.toHaveBeenCalled()
    expect(mockSendChatMessage).not.toHaveBeenCalled()
    expect(hook.result.current.messages).toHaveLength(0)
  })

  it('选图取消（errMsg 含 cancel）：不挂起附件', async () => {
    mockChooseImage.mockRejectedValue({ errMsg: 'chooseImage:fail cancel' })
    const hook = renderCore()
    await act(async () => {
      await hook.result.current.handleChooseImage(['album'])
    })
    expect(hook.result.current.pendingImage).toBeNull()
  })

  it('clearPendingImage：清空附件', async () => {
    const hook = renderCore()
    await chooseImage(hook as any)
    act(() => {
      hook.result.current.clearPendingImage()
    })
    expect(hook.result.current.pendingImage).toBeNull()
  })

  it('sendPendingImage 带文字：图文同气泡、sendChatMessage 收用户文字、历史含补充说明与视觉观察', async () => {
    mockAnalyzeChatPhoto.mockResolvedValue('一只橘色虎斑猫，圆脸，琥珀色眼睛')
    mockSendChatMessage.mockResolvedValue({ reply: '这是一只橘猫', blocked: true })

    const hook = renderCore()
    await chooseImage(hook as any)
    await act(async () => {
      await hook.result.current.sendPendingImage('帮我看看这是什么猫')
    })

    // 上屏消息：图文合并为一条用户消息
    const msgs = hook.result.current.messages
    expect(msgs).toHaveLength(2) // 用户图文消息 + AI 回复
    expect(msgs[0].type).toBe('user')
    expect(msgs[0].imageUrl).toBe('wxfile://tmp/cat.jpg')
    expect(msgs[0].content).toBe('帮我看看这是什么猫')

    // 旧版聊天接口收到的是用户补充文字（而非硬编码文案）
    expect(mockSendChatMessage).toHaveBeenCalledTimes(1)
    const [messageText, context, , options] = mockSendChatMessage.mock.calls[0]
    expect(messageText).toBe('帮我看看这是什么猫')
    expect(context.imageAnalysis).toBe('一只橘色虎斑猫，圆脸，琥珀色眼睛')
    // 服务端持久化用合并文本（与 chatHistory 逐字一致，Agent 链路精确去重可命中）
    expect(options?.persistUserContent).toContain('[图片] 帮我看看这是什么猫')
    expect(options?.persistUserContent).toContain('视觉观察：一只橘色虎斑猫')

    // 历史记录：用户补充文字 + 视觉观察一并保留供追问
    const history = hook.result.current.chatHistory
    const userEntry = history.find((h: any) => h.role === 'user')
    expect(userEntry!.content).toContain('[图片] 帮我看看这是什么猫')
    expect(userEntry!.content).toContain('视觉观察：一只橘色虎斑猫')
    // 附件发送后清空
    expect(hook.result.current.pendingImage).toBeNull()
  })

  it('sendPendingImage 无文字：沿用自动分析引导文案', async () => {
    mockAnalyzeChatPhoto.mockResolvedValue('一只白色的猫')
    mockSendChatMessage.mockResolvedValue({ reply: '好的', blocked: true })

    const hook = renderCore()
    await chooseImage(hook as any)
    await act(async () => {
      await hook.result.current.sendPendingImage()
    })

    const [messageText] = mockSendChatMessage.mock.calls[0]
    expect(messageText).toContain('我上传了一张宠物照片')
    const userEntry = hook.result.current.chatHistory.find((h: any) => h.role === 'user')
    expect(userEntry!.content).toBe('[图片] 视觉观察：一只白色的猫')
  })

  it('视觉分析失败：不注入 imageAnalysis，历史如实标记暂无法分析', async () => {
    mockAnalyzeChatPhoto.mockResolvedValue(null)
    mockSendChatMessage.mockResolvedValue({ reply: 'ok', blocked: true })

    const hook = renderCore()
    await chooseImage(hook as any)
    await act(async () => {
      await hook.result.current.sendPendingImage('看看它')
    })

    const [, context] = mockSendChatMessage.mock.calls[0]
    expect(context.imageAnalysis).toBeUndefined()
    const userEntry = hook.result.current.chatHistory.find((h: any) => h.role === 'user')
    expect(userEntry!.content).toContain('暂无法分析图片内容')
  })

  it('handleSend 有附件时：输入文字作为图片说明走图片链路，不经 Agent', async () => {
    mockAnalyzeChatPhoto.mockResolvedValue('一只橘猫')
    mockSendChatMessage.mockResolvedValue({ reply: 'ok', blocked: true })

    const hook = renderCore()
    await chooseImage(hook as any)
    await act(async () => {
      await hook.result.current.handleSend('这是什么品种')
    })

    expect(mockAgentChat).not.toHaveBeenCalled()
    expect(mockSendChatMessage).toHaveBeenCalledTimes(1)
    const [messageText] = mockSendChatMessage.mock.calls[0]
    expect(messageText).toBe('这是什么品种')
  })

  it('P0 回归：handleSend 无文字 + 附件——走图片链路用兜底文案（发图不带字主路径）', async () => {
    mockAnalyzeChatPhoto.mockResolvedValue('一只白猫')
    mockSendChatMessage.mockResolvedValue({ reply: 'ok', blocked: true })

    const hook = renderCore()
    await chooseImage(hook as any)
    // inputValue 恒为 ''，等价真实 UI 中"选图后不打字直接点发送"
    await act(async () => {
      await hook.result.current.handleSend()
    })

    expect(mockAgentChat).not.toHaveBeenCalled()
    expect(mockSendChatMessage).toHaveBeenCalledTimes(1)
    const [messageText] = mockSendChatMessage.mock.calls[0]
    expect(messageText).toContain('我上传了一张宠物照片')
    expect(hook.result.current.pendingImage).toBeNull()
  })

  it('P1 回归：流程激活时发送——附件清理并提示，文字交给流程，不进图片/Agent 链路', async () => {
    const mockSelectFood = vi.fn()
    const hook = renderCore()
    act(() => {
      hook.result.current.setFlowHandlers({
        foodActive: true,
        selectFood: mockSelectFood,
        memoryActive: false,
        handleMemoryRecord: vi.fn(),
        namingTextActive: false,
        handleNamingText: vi.fn(),
      })
    })
    await chooseImage(hook as any)
    await act(async () => {
      await hook.result.current.handleSend('西瓜能吃吗')
    })

    // 附件被清理（防止流程结束后旧图与新输入误合并）
    expect(hook.result.current.pendingImage).toBeNull()
    expect(Taro.showToast).toHaveBeenCalled()
    // 文字由食物流程消费，不进图片/Agent 链路
    expect(mockSelectFood).toHaveBeenCalledWith('西瓜能吃吗')
    expect(mockSendChatMessage).not.toHaveBeenCalled()
    expect(mockAgentChat).not.toHaveBeenCalled()
  })

  it('blocked:false 走流式分支：占位气泡上屏，打字完成后写入历史', async () => {
    vi.useFakeTimers()
    try {
      mockAnalyzeChatPhoto.mockResolvedValue('一只橘猫')
      mockSendChatMessage.mockResolvedValue({ reply: '这是一只橘猫哦', blocked: false })

      const hook = renderCore()
      await chooseImage(hook as any)
      await act(async () => {
        await hook.result.current.sendPendingImage('看看')
      })

      // 流式占位消息已创建（streamAiReply 同步建占位）
      expect(hook.result.current.streamingId).toBeTruthy()
      // 驱动打字机 interval 跑完 → onDone 写入历史
      await act(async () => {
        vi.runAllTimers()
      })
      const userEntry = hook.result.current.chatHistory.find((h: any) => h.role === 'user')
      expect(userEntry!.content).toContain('[图片] 看看')
      expect(userEntry!.content).toContain('视觉观察：一只橘猫')
      const aiEntry = hook.result.current.chatHistory.find((h: any) => h.role === 'assistant')
      expect(aiEntry!.content).toBe('这是一只橘猫哦')
    } finally {
      vi.useRealTimers()
    }
  })
})
