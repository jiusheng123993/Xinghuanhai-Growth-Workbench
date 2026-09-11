/**
 * AI 记忆服务单元测试
 *
 * 覆盖：
 *  - listMemories：正常/带参数/空列表/null 兜底/异常
 *  - updateMemory：正常/无效ID/空内容/超长内容/异常
 *  - 纯函数：getCategoryInfo/getSourceLabel/getStatusLabel/getImportanceStars
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { api as _api } from '../api'
import {
  listMemories,
  updateMemory,
  getCategoryInfo,
  getSourceLabel,
  getStatusLabel,
  getImportanceStars,
} from '../memoryService'
import type { MemoryEntry, MemoryListResponse } from '../../types/memoryTypes'

vi.mock('../api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}))
vi.mock('../mock', () => ({
  mockApi: { listMemories: vi.fn(), updateMemory: vi.fn() },
}))
vi.mock('../../config', () => ({
  CONFIG: { USE_MOCK: false },
}))
const api = _api as any

function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 1,
    userId: 'user-001',
    petId: 'pet-001',
    category: 'health',
    key: 'weight_trend',
    content: '近一个月体重从5kg降到4.5kg',
    importance: 7,
    confidence: 0.8,
    source: 'auto',
    evidence: ['上次体检医生说有点瘦了'],
    decayRate: 0.1,
    status: 'active',
    meta: {},
    ...overrides,
  }
}

describe('memoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ============ listMemories ============
  describe('listMemories', () => {
    it('不带 petId 时调用 GET /api/memory 且不传参数', async () => {
      const list = [makeMemory(), makeMemory({ id: 2, category: 'feeding' })]
      const resp: MemoryListResponse = { list, total: list.length }
      vi.mocked(api.get).mockResolvedValue(resp)

      const result = await listMemories()

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe(1)
      expect(api.get).toHaveBeenCalledWith('/api/memory', {})
    })

    it('带 petId 时传入查询参数', async () => {
      const list = [makeMemory({ petId: 'pet-002' })]
      vi.mocked(api.get).mockResolvedValue({ list, total: 1 })

      const result = await listMemories('pet-002')

      expect(result).toHaveLength(1)
      expect(api.get).toHaveBeenCalledWith('/api/memory', { petId: 'pet-002' })
    })

    it('后端返回 null data 时兜底为空数组', async () => {
      vi.mocked(api.get).mockResolvedValue(null)

      const result = await listMemories()

      expect(result).toEqual([])
    })

    it('后端返回 data.list 为 null 时兜底为空数组', async () => {
      vi.mocked(api.get).mockResolvedValue({ list: null, total: 0 })

      const result = await listMemories()

      expect(result).toEqual([])
    })

    it('网络异常时抛出错误', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('网络异常'))

      await expect(listMemories()).rejects.toThrow('网络异常')
    })
  })

  // ============ updateMemory ============
  describe('updateMemory', () => {
    it('正常修正记忆内容', async () => {
      vi.mocked(api.put).mockResolvedValue({ id: 5, content: '修正后的内容' })

      const result = await updateMemory(5, '修正后的内容')

      expect(result).toEqual({ id: 5, content: '修正后的内容' })
      expect(api.put).toHaveBeenCalledWith('/api/memory/5', { content: '修正后的内容' })
    })

    it('自动 trim 内容前后空白', async () => {
      vi.mocked(api.put).mockResolvedValue({ id: 5, content: '内容' })

      await updateMemory(5, '  内容  ')

      expect(api.put).toHaveBeenCalledWith('/api/memory/5', { content: '内容' })
    })

    it('无效 ID（0）抛错且不调用 API', async () => {
      await expect(updateMemory(0, '内容')).rejects.toThrow('记忆ID格式错误')
      expect(api.put).not.toHaveBeenCalled()
    })

    it('无效 ID（负数）抛错且不调用 API', async () => {
      await expect(updateMemory(-1, '内容')).rejects.toThrow('记忆ID格式错误')
      expect(api.put).not.toHaveBeenCalled()
    })

    it('无效 ID（非整数）抛错且不调用 API', async () => {
      await expect(updateMemory(1.5, '内容')).rejects.toThrow('记忆ID格式错误')
      expect(api.put).not.toHaveBeenCalled()
    })

    it('空内容抛错且不调用 API', async () => {
      await expect(updateMemory(1, '')).rejects.toThrow('记忆内容不能为空')
      expect(api.put).not.toHaveBeenCalled()
    })

    it('纯空白内容抛错且不调用 API', async () => {
      await expect(updateMemory(1, '   ')).rejects.toThrow('记忆内容不能为空')
      expect(api.put).not.toHaveBeenCalled()
    })

    it('超长内容（>2000字）抛错且不调用 API', async () => {
      const long = 'a'.repeat(2001)
      await expect(updateMemory(1, long)).rejects.toThrow('记忆内容过长')
      expect(api.put).not.toHaveBeenCalled()
    })

    it('刚好 2000 字内容可以通过', async () => {
      const content = 'a'.repeat(2000)
      vi.mocked(api.put).mockResolvedValue({ id: 1, content })

      await updateMemory(1, content)

      expect(api.put).toHaveBeenCalledWith('/api/memory/1', { content })
    })

    it('网络异常时抛出错误', async () => {
      vi.mocked(api.put).mockRejectedValue(new Error('保存失败'))

      await expect(updateMemory(1, '内容')).rejects.toThrow('保存失败')
    })
  })

  // ============ getCategoryInfo ============
  describe('getCategoryInfo', () => {
    it('health 返回健康', () => {
      expect(getCategoryInfo('health')).toEqual({ icon: 'heart', label: '健康' })
    })
    it('behavior 返回行为', () => {
      expect(getCategoryInfo('behavior')).toEqual({ icon: 'paw-print', label: '行为' })
    })
    it('habit 返回习惯', () => {
      expect(getCategoryInfo('habit')).toEqual({ icon: 'clock', label: '习惯' })
    })
    it('preference 返回偏好', () => {
      expect(getCategoryInfo('preference')).toEqual({ icon: 'star', label: '偏好' })
    })
    it('event 返回事件', () => {
      expect(getCategoryInfo('event')).toEqual({ icon: 'sparkle', label: '事件' })
    })
    it('feeding 返回喂养', () => {
      expect(getCategoryInfo('feeding')).toEqual({ icon: 'bowl-food', label: '喂养' })
    })
    it('medical 返回医疗', () => {
      expect(getCategoryInfo('medical')).toEqual({ icon: 'pill', label: '医疗' })
    })
    it('contradiction 返回已修正', () => {
      expect(getCategoryInfo('contradiction')).toEqual({ icon: 'arrows-clockwise', label: '已修正' })
    })
    it('general 返回其他', () => {
      expect(getCategoryInfo('general')).toEqual({ icon: 'note-pencil', label: '其他' })
    })
  })

  // ============ getSourceLabel ============
  describe('getSourceLabel', () => {
    it('auto 返回 AI 自动记录', () => {
      expect(getSourceLabel('auto')).toBe('AI 自动记录')
    })
    it('manual 返回用户手动修正', () => {
      expect(getSourceLabel('manual')).toBe('用户手动修正')
    })
    it('contradiction_resolved 返回矛盾已解决', () => {
      expect(getSourceLabel('contradiction_resolved')).toBe('矛盾已解决')
    })
  })

  // ============ getStatusLabel ============
  describe('getStatusLabel', () => {
    it('active 返回生效中', () => {
      expect(getStatusLabel('active')).toBe('生效中')
    })
    it('dormant 返回已休眠', () => {
      expect(getStatusLabel('dormant')).toBe('已休眠')
    })
    it('expired 返回已过期', () => {
      expect(getStatusLabel('expired')).toBe('已过期')
    })
    it('contradicted 返回已被替代', () => {
      expect(getStatusLabel('contradicted')).toBe('已被替代')
    })
  })

  // ============ getImportanceStars ============
  describe('getImportanceStars', () => {
    it('importance 1-2 → 1 星', () => {
      expect(getImportanceStars(1)).toBe('★☆☆☆☆')
      expect(getImportanceStars(2)).toBe('★☆☆☆☆')
    })
    it('importance 3-4 → 2 星', () => {
      expect(getImportanceStars(3)).toBe('★★☆☆☆')
      expect(getImportanceStars(4)).toBe('★★☆☆☆')
    })
    it('importance 5-6 → 3 星', () => {
      expect(getImportanceStars(5)).toBe('★★★☆☆')
      expect(getImportanceStars(6)).toBe('★★★☆☆')
    })
    it('importance 7-8 → 4 星', () => {
      expect(getImportanceStars(7)).toBe('★★★★☆')
      expect(getImportanceStars(8)).toBe('★★★★☆')
    })
    it('importance 9-10 → 5 星', () => {
      expect(getImportanceStars(9)).toBe('★★★★★')
      expect(getImportanceStars(10)).toBe('★★★★★')
    })
    it('importance 0 或负数兜底为 1 星', () => {
      expect(getImportanceStars(0)).toBe('★☆☆☆☆')
      expect(getImportanceStars(-5)).toBe('★☆☆☆☆')
    })
    it('importance 超过 10 兜底为 5 星', () => {
      expect(getImportanceStars(99)).toBe('★★★★★')
    })
  })
})
