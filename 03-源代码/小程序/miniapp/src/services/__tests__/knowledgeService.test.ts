/**
 * 知识图谱服务测试（Phase 3）
 * 覆盖：网络成功切换/网络失败缓存兜底/无缓存保持静态/非法结构忽略/纠错提交 payload
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { api } from '../api'
import { syncKnowledgeGraph, submitKnowledgeFeedback } from '../knowledgeService'
import { getActiveGraph, setActiveGraph, MEDICAL_GRAPH } from '../../data/petKnowledge/medicalGraph'

const mockStorage: Record<string, string> = {}

vi.mock('../../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[`xhh_${key}`]
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[`xhh_${key}`] = JSON.stringify(value)
  }),
}))

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

/** 构造合法的"新版本"图谱（复用静态数据仅改版本，条目校验可通过） */
function hotGraph(version: string) {
  return { ...MEDICAL_GRAPH, version }
}

describe('knowledgeService - 图谱热更新降级路径', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
    setActiveGraph(MEDICAL_GRAPH)
  })

  it('网络成功 → 切换到服务端图谱并缓存', async () => {
    vi.mocked(api.get).mockResolvedValue({ version: '2026-08-23.1', data: hotGraph('2026-08-23.1') })

    const ok = await syncKnowledgeGraph()

    expect(ok).toBe(true)
    expect(getActiveGraph().version).toBe('2026-08-23.1')
    expect(mockStorage['xhh_knowledge_graph']).toBeDefined()
  })

  it('网络失败 + 有缓存 → 用缓存图谱', async () => {
    mockStorage['xhh_knowledge_graph'] = JSON.stringify({ version: 'cached.1', data: hotGraph('cached.1') })
    vi.mocked(api.get).mockRejectedValue(new Error('network down'))

    const ok = await syncKnowledgeGraph()

    expect(ok).toBe(true)
    expect(getActiveGraph().version).toBe('cached.1')
  })

  it('网络失败 + 无缓存 → 返回 false，保持静态兜底', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'))

    const ok = await syncKnowledgeGraph()

    expect(ok).toBe(false)
    expect(getActiveGraph().version).toBe(MEDICAL_GRAPH.version)
  })

  it('非法结构（缺 riskRules）→ 不切换，保持当前图谱', async () => {
    vi.mocked(api.get).mockResolvedValue({ version: 'bad.1', data: { version: 'bad.1' } as never })

    const ok = await syncKnowledgeGraph()

    expect(ok).toBe(false)
    expect(getActiveGraph().version).toBe(MEDICAL_GRAPH.version)
  })

  it('submitKnowledgeFeedback 提交正确 payload（snake_case）', async () => {
    vi.mocked(api.post).mockResolvedValue({})

    await submitKnowledgeFeedback({
      entityType: 'disease',
      entityName: '胃炎',
      suggestion: '建议补充来源',
      checkId: 'check-1',
      petId: 'pet-1',
    })

    expect(api.post).toHaveBeenCalledWith('/knowledge/feedback', {
      entity_type: 'disease',
      entity_name: '胃炎',
      suggestion: '建议补充来源',
      check_id: 'check-1',
      pet_id: 'pet-1',
    })
  })
})
