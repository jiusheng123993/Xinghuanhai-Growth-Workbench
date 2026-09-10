/**
 * 前端 agentService 回归测试（2026-09 P2-4 修复）
 *
 * 背景：服务端 /api/agent/chat 在守卫命中（blocked）时返回**普通 JSON**（非 SSE，无 event:/data: 行）。
 * 前端 agentChat 按 \n\n 切分找 event:/data: 行，命中时产出 0 事件，导致"危机/热线"回复被吞。
 * 修复后：0 事件且 buffer 为 blocked JSON 时，转成 done 事件上屏。
 */
import { describe, it, expect, vi } from 'vitest'

// —— mock 顶层依赖 ——
vi.mock('@tarojs/taro', () => ({
  default: {
    request: vi.fn(),
    arrayBufferToBase64: vi.fn(() => ''),
  },
}))
vi.mock('../../config', () => ({ CONFIG: { API_BASE_URL: 'http://test' } }))
vi.mock('../../utils/storage', () => ({ storage: { getToken: () => 'test-token' } }))
vi.mock('../../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import Taro from '@tarojs/taro'
import { agentChat } from '../agentService'

describe('agentChat 服务端 blocked 兜底（P2-4）', () => {
  /** 投喂单个响应体 chunk，收集 agentChat 产出的全部事件 */
  async function collectEvents(chunk: string) {
    const requestMock = Taro.request as unknown as ReturnType<typeof vi.fn>
    const requestTask = {
      onChunkReceived: (cb: (res: { data: string | ArrayBuffer }) => void) => {
        cb({ data: chunk })
      },
      then: (cb: (v: unknown) => void) => { cb({}); return Promise.resolve() },
      catch: () => {},
    }
    requestMock.mockReturnValue(requestTask)
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    for await (const ev of agentChat({ message: '测试' })) {
      events.push(ev as unknown as { type: string; data: Record<string, unknown> })
    }
    return events
  }

  it('服务端返回 blocked 普通 JSON（无 SSE 事件行）时，yield done 事件上屏 reply（含热线）', async () => {
    const events = await collectEvents(JSON.stringify({
      success: true,
      data: { reply: '请拨打24小时心理援助热线：400-161-9995', blocked: true },
    }))
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('done')
    expect(String(events[0].data.content)).toContain('400-161-9995')
    expect(events[0].data.blocked).toBe(true)
  })

  it('负向：非 blocked JSON（blocked:false）→ 兜底不触发，不 yield done', async () => {
    const events = await collectEvents(JSON.stringify({
      success: true,
      data: { reply: '这是一条普通回复', blocked: false },
    }))
    expect(events).toHaveLength(0)
  })

  it('负向：SSE 已产事件 → 兜底不触发（不追加第二个 done）', async () => {
    const events = await collectEvents(`event: done\ndata: {"content":"正常回复","iterations":2}\n\n`)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('done')
    expect(String(events[0].data.content)).toBe('正常回复')
    expect(events[0].data.blocked).toBeUndefined()
  })

  it('onChunkReceived 失效（微信 enableChunked 分块竞态）时，then 的完整响应兜底解析出全部事件', async () => {
    const sseText = `event: thinking\ndata: {"iteration":1}\n\nevent: token\ndata: {"text":"你好"}\n\nevent: done\ndata: {"content":"你好呀","iterations":1}\n\n`
    const requestMock = Taro.request as unknown as ReturnType<typeof vi.fn>
    const requestTask = {
      // 模拟竞态：onChunkReceived 注册成功但回调从未触发（buffer 始终为空）
      onChunkReceived: (_cb: (res: { data: string | ArrayBuffer }) => void) => {},
      // success（then）携带完整 SSE 文本（responseType:'text'）
      then: (cb: (res: { data: string }) => void) => {
        cb({ data: sseText })
        return Promise.resolve()
      },
      catch: () => {},
    }
    requestMock.mockReturnValue(requestTask)
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    for await (const ev of agentChat({ message: '测试' })) {
      events.push(ev as unknown as { type: string; data: Record<string, unknown> })
    }
    // 兜底后应完整解析出 thinking/token/done，而非 0 事件（否则上层显示"走神"）
    expect(events.map(e => e.type)).toEqual(['thinking', 'token', 'done'])
    expect(String(events[2].data.content)).toBe('你好呀')
  })

  it('onChunkReceived 返回 ArrayBuffer（含中文）时用 atob+escape 解码，不依赖 TextDecoder', async () => {
    // 完整 SSE 文本 `event: done\ndata: {"content":"你好","iterations":1}\n\n` 的 UTF-8 base64
    // （硬编码，避免测试环境引入 Node Buffer 类型）
    const b64 = 'ZXZlbnQ6IGRvbmUKZGF0YTogeyJjb250ZW50Ijoi5L2g5aW9IiwiaXRlcmF0aW9ucyI6MX0KCg=='
    ;(Taro.arrayBufferToBase64 as unknown as ReturnType<typeof vi.fn>).mockReturnValue(b64)

    const requestMock = Taro.request as unknown as ReturnType<typeof vi.fn>
    const requestTask = {
      // res.data 为 ArrayBuffer → 走 else 分支（旧实现用 TextDecoder，微信端会 ReferenceError）
      onChunkReceived: (cb: (res: { data: ArrayBuffer }) => void) => {
        cb({ data: new ArrayBuffer(0) })
      },
      then: (cb: (res: { data?: unknown }) => void) => {
        cb({ data: undefined })
        return Promise.resolve()
      },
      catch: () => {},
    }
    requestMock.mockReturnValue(requestTask)
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    for await (const ev of agentChat({ message: '测试' })) {
      events.push(ev as unknown as { type: string; data: Record<string, unknown> })
    }
    expect(events.map(e => e.type)).toEqual(['done'])
    expect(String(events[0].data.content)).toBe('你好')
  })
})
