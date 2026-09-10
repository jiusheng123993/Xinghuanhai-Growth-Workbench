/**
 * 前端 agentService 会话接口测试（多会话改造 2026-09-10）
 *
 * 覆盖：listChatSessions / createChatSession / deleteChatSession 的 URL/方法/参数与降级；
 *       loadAgentHistory 与 agentChat 的 sessionId 透传。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    request: mockRequest,
    arrayBufferToBase64: vi.fn(() => ''),
  },
}))
vi.mock('../../config', () => ({ CONFIG: { API_BASE_URL: 'http://test' } }))
vi.mock('../../utils/storage', () => ({ storage: { getToken: () => 'test-token' } }))
vi.mock('../../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import {
  listChatSessions,
  createChatSession,
  deleteChatSession,
  loadAgentHistory,
  agentChat,
} from '../agentService'

const SESSION = {
  id: 'session-1',
  petId: 'pet-1',
  title: '我家猫最近不吃东西',
  messageCount: 4,
  createdAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-10T01:00:00Z',
}

beforeEach(() => {
  mockRequest.mockReset()
})

describe('聊天会话接口（agentService）', () => {
  it('listChatSessions：GET /api/agent/sessions，petId 过滤并返回会话列表', async () => {
    mockRequest.mockResolvedValue({
      statusCode: 200,
      data: { success: true, data: { sessions: [SESSION] } },
    })

    const sessions = await listChatSessions('pet-1')

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('session-1')
    const opts = mockRequest.mock.calls[0][0] as { url: string; method: string }
    expect(opts.url).toContain('/api/agent/sessions?petId=pet-1')
    expect(opts.method).toBe('GET')
  })

  it('listChatSessions：非 200 或失败降级返回空数组', async () => {
    mockRequest.mockResolvedValue({ statusCode: 500, data: {} })

    const sessions = await listChatSessions()

    expect(sessions).toEqual([])
  })

  it('createChatSession：POST /api/agent/sessions 返回新会话', async () => {
    mockRequest.mockResolvedValue({
      statusCode: 200,
      data: { success: true, data: { session: SESSION } },
    })

    const session = await createChatSession('pet-1')

    expect(session?.id).toBe('session-1')
    const opts = mockRequest.mock.calls[0][0] as { url: string; method: string; data: unknown }
    expect(opts.url).toBe('http://test/api/agent/sessions')
    expect(opts.method).toBe('POST')
    expect(opts.data).toEqual({ petId: 'pet-1' })
  })

  it('createChatSession：失败降级返回 null', async () => {
    mockRequest.mockRejectedValue(new Error('network'))

    const session = await createChatSession('pet-1')

    expect(session).toBeNull()
  })

  it('deleteChatSession：DELETE /api/agent/sessions/:id，200 返回 true', async () => {
    mockRequest.mockResolvedValue({ statusCode: 200, data: { success: true } })

    const ok = await deleteChatSession('session-1')

    expect(ok).toBe(true)
    const opts = mockRequest.mock.calls[0][0] as { url: string; method: string }
    expect(opts.url).toBe('http://test/api/agent/sessions/session-1')
    expect(opts.method).toBe('DELETE')
  })

  it('deleteChatSession：非 200 返回 false', async () => {
    mockRequest.mockResolvedValue({ statusCode: 404, data: {} })

    const ok = await deleteChatSession('session-1')

    expect(ok).toBe(false)
  })

  it('loadAgentHistory：带 sessionId 时 URL 含 sessionId 参数', async () => {
    mockRequest.mockResolvedValue({
      statusCode: 200,
      data: { success: true, data: { history: [{ role: 'user', content: 'hi' }] } },
    })

    const history = await loadAgentHistory('pet-1', 20, 'session-1')

    expect(history).toHaveLength(1)
    const opts = mockRequest.mock.calls[0][0] as { url: string }
    expect(opts.url).toContain('limit=20')
    expect(opts.url).toContain('petId=pet-1')
    expect(opts.url).toContain('sessionId=session-1')
  })

  it('agentChat：data 携带 sessionId 透传给服务端', async () => {
    // 模拟 SSE 单事件完成
    const requestTask = {
      onChunkReceived: (_cb: (res: { data: string }) => void) => {},
      then: (cb: (res: { data?: string }) => void) => {
        cb({ data: 'event: done\ndata: {"content":"ok","iterations":1}\n\n' })
        return Promise.resolve()
      },
      catch: () => {},
    }
    mockRequest.mockReturnValue(requestTask)

    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    for await (const ev of agentChat({ message: 'hi', petId: 'pet-1', sessionId: 'session-1' })) {
      events.push(ev as unknown as { type: string; data: Record<string, unknown> })
    }

    expect(events.map(e => e.type)).toEqual(['done'])
    const opts = mockRequest.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(opts.data.sessionId).toBe('session-1')
    expect(opts.data.message).toBe('hi')
    expect(opts.data.petId).toBe('pet-1')
  })
})
