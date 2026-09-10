/**
 * 聊天历史加载渲染 + 多会话 Hook 单元测试（修复「聊天记录每次进入都消失」+ 多会话改造）
 *
 * 背景：服务端已按会话持久化对话历史，前端 useChatCore 进入页面时先拉会话列表，
 * 默认打开最近活跃会话并按 sessionId 加载历史渲染到页面消息流。
 * 此前历史只写 chatHistory（AI 上下文）、从不渲染 messages，导致重进页面看不到历史。
 *
 * 覆盖：历史渲染到 messages（role→type 映射）、chatHistory 同步填充、sessionId 透传、
 *       空会话/无宠物/加载失败边界、切换会话。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useChatCore } from '../useChatCore'
import type { PetInfo } from '../../types/chatTypes'

const {
  mockLoadAgentHistory,
  mockListChatSessions,
  mockCreateChatSession,
  mockDeleteChatSession,
} = vi.hoisted(() => ({
  mockLoadAgentHistory: vi.fn(),
  mockListChatSessions: vi.fn(),
  mockCreateChatSession: vi.fn(),
  mockDeleteChatSession: vi.fn(),
}))

vi.mock('../../services/chatService', () => ({
  sendChatMessage: vi.fn(),
  analyzeChatPhoto: vi.fn(),
}))

vi.mock('../../services/agentService', () => ({
  agentChat: vi.fn(),
  getToolLabel: (name: string) => name,
  loadAgentHistory: (...args: any[]) => mockLoadAgentHistory(...args),
  listChatSessions: (...args: any[]) => mockListChatSessions(...args),
  createChatSession: (...args: any[]) => mockCreateChatSession(...args),
  deleteChatSession: (...args: any[]) => mockDeleteChatSession(...args),
}))

vi.mock('../../utils/privacy', () => ({
  chooseImageWithPrivacy: vi.fn(),
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

/** 构造会话摘要（对齐后端 /api/agent/sessions 返回的 camelCase 结构） */
function session(id: string, title: string, messageCount = 0) {
  return {
    id,
    petId: 'pet_1',
    title,
    messageCount,
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T01:00:00Z',
  }
}

type CoreProps = Parameters<typeof useChatCore>[0]

function renderCore(initial: CoreProps) {
  return renderHook((props: CoreProps) => useChatCore(props), { initialProps: initial })
}

function coreProps(info: PetInfo): CoreProps {
  return {
    petInfo: info,
    inputValue: '',
    setInputValue: vi.fn(),
    setPlusMenuOpen: vi.fn(),
    setShowGreetingQuickActions: vi.fn(),
  }
}

describe('useChatCore 历史加载渲染（多会话）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('有会话有历史：默认打开最近会话并把历史渲染到 messages（role→type 映射）', async () => {
    mockListChatSessions.mockResolvedValue([session('session-1', '我家猫最近不吃东西', 4)])
    mockLoadAgentHistory.mockResolvedValue([
      { role: 'user', content: '我家猫最近不吃东西' },
      { role: 'assistant', content: '先观察精神状态，建议记录一下打卡' },
      { role: 'user', content: '好的' },
    ])

    const hook = renderCore(coreProps(petInfo))

    await waitFor(() => {
      expect(hook.result.current.messages).toHaveLength(3)
    })

    const msgs = hook.result.current.messages
    expect(msgs[0].type).toBe('user')
    expect(msgs[0].content).toBe('我家猫最近不吃东西')
    expect(msgs[1].type).toBe('ai')
    expect(msgs[2].type).toBe('user')
    expect(msgs.every((m) => typeof m.id === 'string' && m.id.length > 0)).toBe(true)

    // chatHistory 同步填充（AI 上下文）
    expect(hook.result.current.chatHistory).toHaveLength(3)

    // 当前会话 id 被设为最近会话，且历史按 sessionId 加载
    expect(hook.result.current.sessionId).toBe('session-1')
    expect(mockLoadAgentHistory).toHaveBeenCalledWith('pet_1', 20, 'session-1')
  })

  it('无会话（列表空）：messages 空且不加载历史', async () => {
    mockListChatSessions.mockResolvedValue([])

    const hook = renderCore(coreProps(petInfo))

    await waitFor(() => {
      expect(mockListChatSessions).toHaveBeenCalledTimes(1)
    })
    expect(hook.result.current.sessionId).toBeNull()
    expect(hook.result.current.messages).toHaveLength(0)
    expect(mockLoadAgentHistory).not.toHaveBeenCalled()
  })

  it('无宠物（hasPet=false）：不请求会话列表，消息流为空', () => {
    const noPet: PetInfo = { ...petInfo, hasPet: false, activePet: null }
    renderCore(coreProps(noPet))

    expect(mockListChatSessions).not.toHaveBeenCalled()
    expect(mockLoadAgentHistory).not.toHaveBeenCalled()
  })

  it('加载失败（listChatSessions 抛错）：不崩溃，消息流保持为空', async () => {
    mockListChatSessions.mockRejectedValue(new Error('network'))

    const hook = renderCore(coreProps(petInfo))

    await waitFor(() => {
      expect(mockListChatSessions).toHaveBeenCalledTimes(1)
    })
    expect(hook.result.current.messages).toHaveLength(0)
    expect(hook.result.current.chatHistory).toHaveLength(0)
  })

  it('handleSwitchSession：切换会话后加载新会话历史并清空旧消息', async () => {
    mockListChatSessions.mockResolvedValue([session('session-1', '旧对话', 4)])
    mockLoadAgentHistory.mockResolvedValue([{ role: 'user', content: '旧会话消息' }])

    const hook = renderCore(coreProps(petInfo))
    await waitFor(() => {
      expect(hook.result.current.messages).toHaveLength(1)
    })
    expect(hook.result.current.messages[0].content).toBe('旧会话消息')

    // 切换到另一个会话
    mockLoadAgentHistory.mockResolvedValue([{ role: 'assistant', content: '新会话回复' }])
    await act(async () => {
      await hook.result.current.handleSwitchSession('session-2')
    })

    expect(hook.result.current.sessionId).toBe('session-2')
    expect(hook.result.current.messages).toHaveLength(1)
    expect(hook.result.current.messages[0].content).toBe('新会话回复')
    expect(hook.result.current.messages[0].type).toBe('ai')
    expect(mockLoadAgentHistory).toHaveBeenLastCalledWith('pet_1', 20, 'session-2')
  })

  it('handleNewSession：新建会话后设为当前并清空消息流', async () => {
    mockListChatSessions.mockResolvedValue([session('session-1', '旧对话', 4)])
    mockLoadAgentHistory.mockResolvedValue([{ role: 'user', content: '旧会话消息' }])
    mockCreateChatSession.mockResolvedValue(session('session-new', '新的对话', 0))

    const hook = renderCore(coreProps(petInfo))
    await waitFor(() => {
      expect(hook.result.current.messages).toHaveLength(1)
    })

    await act(async () => {
      await hook.result.current.handleNewSession()
    })

    expect(mockCreateChatSession).toHaveBeenCalledWith('pet_1')
    expect(hook.result.current.sessionId).toBe('session-new')
    expect(hook.result.current.messages).toHaveLength(0)
    expect(hook.result.current.chatHistory).toHaveLength(0)
  })
})
