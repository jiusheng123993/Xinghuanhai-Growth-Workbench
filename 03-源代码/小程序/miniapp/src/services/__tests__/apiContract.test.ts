/**
 * 服务层「接口契约」回归测试
 *
 * 【为什么单独立一个文件】
 *   2026-09-11 排查"我的 → 效果追踪"数据异常时，发现一类**系统性缺陷**：
 *   `services/api.ts` 的 `request()` 在 `body.success` 为真时返回的是 **`body.data`（已解包）**，
 *   但多个 service 又按"完整响应体"读了一层 `res.data` → 恒为 undefined。症状各不相同、
 *   还都不报错，靠肉眼极难发现：
 *     · 建议记录 / 意见反馈 / 喂养记录列表**永远是空的**；
 *     · 采纳建议、新增喂养记录、绑定手机号、上传全家福**永远失败**；
 *     · 后端返回 camelCase 而前端按 snake_case 读时，字段全 undefined（宠物显示"未知宠物"、日期 Invalid Date）。
 *   本文件把契约钉死：**api 层给到 service 的永远是"已解包的数据本体"**。
 *   谁再把写法改回 `res.data`，这些用例会立刻变红。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getSuggestionRecords, updateSuggestionAdoption } from '../suggestionRecordsService'
import { getFeedingRecords, addFeedingRecord } from '../feedingRecordsService'
import { getMyFeedbackHistory, submitNpsFeedback } from '../feedbackService'
import { bindPhone } from '../authService'
import { familyService } from '../familyService'

const { mockApiGet, mockApiPost, mockApiPut, mockApiPatch, mockApiDelete } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPut: vi.fn(),
  mockApiPatch: vi.fn(),
  mockApiDelete: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    get: mockApiGet,
    post: mockApiPost,
    put: mockApiPut,
    patch: mockApiPatch,
    delete: mockApiDelete,
  },
}))

// authService 会 import Taro 与本地存储，测试里只需它们不报错
vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    login: vi.fn(),
  },
}))

// familyService 还依赖 mock 模块 / 本地存储 / 全局配置，测试里给最小替身
vi.mock('../mock', () => ({ mockApi: {} }))
vi.mock('../../utils/storage', () => ({ getStorage: vi.fn(() => null), setStorage: vi.fn() }))
vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config')>()
  // 只把 USE_MOCK 钉成 false，其余配置沿用真实值，避免影响其它被测模块
  return { ...actual, CONFIG: { ...actual.CONFIG, USE_MOCK: false } }
})

/** 后端返回的建议记录（camelCase，与 routes/suggestionRecords.ts 的 toCamelCase 一致） */
const SUGGESTION_CAMEL = {
  id: 'sg_1',
  petId: 'pet_1',
  userId: 'user_1',
  type: 'feeding',
  title: '个性化喂养建议',
  content: '建议把每日喂食量从 60g 降到 50g。',
  priority: 'medium',
  adopted: false,
  createdAt: '2026-09-08T10:00:00.000Z',
  adoptedAt: null,
  updatedAt: '2026-09-08T10:00:00.000Z',
}

/** 后端返回的喂养记录（camelCase，与 routes/feedingRecords.ts 的 toCamelCase 一致） */
const FEEDING_CAMEL = {
  id: 'fr_1',
  petId: 'pet_1',
  userId: 'user_1',
  recordDate: '2026-09-08',
  foodType: 'dry',
  brand: '皇家',
  amount: '50.5',
  unit: 'g',
  mealTime: 'morning',
  appetite: 'good',
  stool: 'normal',
  energy: 'high',
  notes: '',
  createdAt: '2026-09-08T10:00:00.000Z',
  updatedAt: '2026-09-08T10:00:00.000Z',
}

describe('服务层接口契约：api 层给到 service 的是已解包的数据本体', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('suggestionRecordsService（效果追踪）', () => {
    it('列表：直接把数组当成返回值处理（旧写法 res.data 会得到 undefined → 列表恒空）', async () => {
      mockApiGet.mockResolvedValue([SUGGESTION_CAMEL])

      const rows = await getSuggestionRecords('pet_1')

      expect(rows).not.toBeNull()
      expect(rows).toHaveLength(1)
      expect(rows![0].title).toBe('个性化喂养建议')
    })

    it('列表：字段按 camelCase 映射（旧写法读 pet_id/created_at → 宠物显示"未知宠物"、日期 Invalid Date）', async () => {
      mockApiGet.mockResolvedValue([SUGGESTION_CAMEL])

      const rows = await getSuggestionRecords('pet_1')

      expect(rows![0].petId).toBe('pet_1')
      expect(rows![0].createdAt).toBe('2026-09-08T10:00:00.000Z')
      expect(Number.isNaN(new Date(rows![0].createdAt).getTime())).toBe(false)
    })

    it('列表：兼容历史 snake_case 返回（api.ts 的既有约定）', async () => {
      mockApiGet.mockResolvedValue([
        { id: 'sg_2', pet_id: 'pet_2', user_id: 'user_1', type: 'symptom', title: 't', content: 'c', priority: 'low', adopted: true, created_at: '2026-09-05T08:30:00.000Z', adopted_at: null, updated_at: '2026-09-05T08:30:00.000Z' },
      ])

      const rows = await getSuggestionRecords('pet_2')

      expect(rows![0].petId).toBe('pet_2')
      expect(rows![0].createdAt).toBe('2026-09-05T08:30:00.000Z')
    })

    it('列表：请求失败返回 null（调用方据此显示"加载失败"，而不是伪装成空态）', async () => {
      mockApiGet.mockRejectedValue(new Error('网络异常'))

      await expect(getSuggestionRecords('pet_1')).resolves.toBeNull()
    })

    it('采纳：返回解析后的记录（旧写法 toCamelRecord(undefined) 会抛错 → 用户侧"操作失败"）', async () => {
      mockApiPatch.mockResolvedValue({ ...SUGGESTION_CAMEL, adopted: true })

      const record = await updateSuggestionAdoption('pet_1', 'sg_1', true)

      expect(record).not.toBeNull()
      expect(record!.adopted).toBe(true)
    })
  })

  describe('feedingRecordsService（喂养记录）', () => {
    it('列表：返回数组且字段为 camelCase', async () => {
      mockApiGet.mockResolvedValue([FEEDING_CAMEL])

      const rows = await getFeedingRecords('pet_1')

      expect(rows).toHaveLength(1)
      expect(rows[0].petId).toBe('pet_1')
      expect(rows[0].recordDate).toBe('2026-09-08')
      expect(rows[0].foodType).toBe('dry')
    })

    it('列表：amount 由字符串转成数字（后端 numeric 返回字符串）', async () => {
      mockApiGet.mockResolvedValue([FEEDING_CAMEL])

      const rows = await getFeedingRecords('pet_1')

      expect(rows[0].amount).toBe(50.5)
    })

    it('新增：直接使用返回值构造记录（旧写法 res.data 为 undefined → 新增恒返回 null）', async () => {
      mockApiPost.mockResolvedValue(FEEDING_CAMEL)

      const record = await addFeedingRecord('pet_1', {
        recordDate: '2026-09-08',
        foodType: 'dry',
        amount: 50.5,
      })

      expect(record).not.toBeNull()
      expect(record!.petId).toBe('pet_1')
      expect(record!.amount).toBe(50.5)
    })

    it('新增：请求体用后端要的 date 字段（旧写法发 record_date → 后端 zod 报「date 不能为空」→ 400，用户恒见"记录失败"）', async () => {
      mockApiPost.mockResolvedValue(FEEDING_CAMEL)

      await addFeedingRecord('pet_1', {
        recordDate: '2026-09-08',
        foodType: 'dry',
        amount: 50.5,
      })

      const body = mockApiPost.mock.calls[0][1] as Record<string, unknown>
      expect(body.date).toBe('2026-09-08')
      expect(body.food_type).toBe('dry')
      expect(body.amount).toBe(50.5)
      // 不能把前端字段名直接透传出去（后端 schema 会剥离未知键、并因缺 date 直接 400）
      expect(body.record_date).toBeUndefined()
      expect(body.recordDate).toBeUndefined()
    })

    it('列表：兼容历史 snake_case 返回', async () => {
      mockApiGet.mockResolvedValue([
        {
          id: 'fr_2', pet_id: 'pet_1', user_id: 'user_1', record_date: '2026-09-01',
          food_type: 'wet', amount: 30, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
        },
      ])

      const rows = await getFeedingRecords('pet_1')

      expect(rows[0].petId).toBe('pet_1')
      expect(rows[0].recordDate).toBe('2026-09-01')
      expect(rows[0].amount).toBe(30)
    })

    it('列表：amount 的边界值（缺失 / null / "0" / 非法字符串）都归零，不产生 NaN', async () => {
      mockApiGet.mockResolvedValue([
        { id: 'a', amount: undefined },
        { id: 'b', amount: null },
        { id: 'c', amount: '0' },
        { id: 'd', amount: 'abc' },
      ])

      const rows = await getFeedingRecords('pet_1')

      expect(rows.map(r => r.amount)).toEqual([0, 0, 0, 0])
    })
  })

  describe('feedbackService（意见反馈）', () => {
    it('历史列表：返回记录数组（旧写法 res.data → 历史永远为空）', async () => {
      mockApiGet.mockResolvedValue([
        { id: 'fb_1', feedback_type: 'nps', score: 9, content: '很好用', trigger_event: 'checkin', created_at: '2026-09-08T10:00:00.000Z' },
      ])

      const rows = await getMyFeedbackHistory()

      expect(rows).toHaveLength(1)
      expect(rows[0].score).toBe(9)
    })

    it('提交 NPS：后端成功响应没有 data 字段，也必须返回 true（旧写法读 res.success 会抛错 → 恒 false）', async () => {
      // 与 routes/feedback.ts 一致：{ success: true, message: '感谢您的反馈' } → api 层解包后是 undefined
      mockApiPost.mockResolvedValue(undefined)

      await expect(submitNpsFeedback({ score: 9, feedback: '很好用' })).resolves.toBe(true)
    })

    it('提交 NPS：业务/网络失败返回 false', async () => {
      mockApiPost.mockRejectedValue(new Error('请求失败'))

      await expect(submitNpsFeedback({ score: 9 })).resolves.toBe(false)
    })
  })

  describe('authService（绑定手机号）', () => {
    it('成功：api 层返回的 { phone } 直接可用（旧写法读 result.success → 恒为 undefined → 永远报失败）', async () => {
      mockApiPost.mockResolvedValue({ phone: '1234' })

      await expect(bindPhone('wx_code')).resolves.toEqual({ success: true, phone: '1234' })
    })

    it('失败：api 层抛错时返回 success=false', async () => {
      mockApiPost.mockRejectedValue(new Error('授权码无效'))

      await expect(bindPhone('bad_code')).resolves.toEqual({ success: false })
    })

    it('成功但响应里没有 phone：仍算成功（旧写法把这种情况报成失败）', async () => {
      // 后端已确认真实返回 data:{phone}，这里防的是"响应结构变化时不要把成功报成失败"
      mockApiPost.mockResolvedValue(undefined)

      await expect(bindPhone('wx_code')).resolves.toEqual({ success: true })
    })
  })

  describe('familyService（家庭相册上传）', () => {
    it('上传成功返回后端给的 id（旧写法 result.data → 恒 undefined，调用方拿不到 id）', async () => {
      mockApiPost.mockResolvedValue({ id: 'photo_1' })

      const result = await familyService.uploadFamilyPhoto('fam_1', {
        photoUrl: 'https://example.com/a.png',
        photoType: 'uploaded',
        memberCount: 2,
        memberNames: ['可乐', '布丁'],
      })

      expect(result).toEqual({ id: 'photo_1' })
    })

    it('上传失败向上抛错（由调用方处理），不得返回伪造的 id', async () => {
      mockApiPost.mockRejectedValue(new Error('保存全家福失败'))

      await expect(
        familyService.uploadFamilyPhoto('fam_1', {
          photoUrl: 'https://example.com/a.png',
          memberCount: 1,
          memberNames: ['可乐'],
        }),
      ).rejects.toThrow('保存全家福失败')
    })
  })
})
