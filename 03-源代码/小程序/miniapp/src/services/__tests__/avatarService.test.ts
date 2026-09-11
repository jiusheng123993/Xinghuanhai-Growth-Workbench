/**
 * 头像服务测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  getGenerationCount,
  incrementGenerationCount,
  canGenerateAvatar,
  getAvatarCustomization,
  saveAvatarCustomization,
  generateAvatarImage,
  generateAvatarOptions,
  saveAvatarToLibrary,
  getAvatarLibrary,
  deleteAvatarLibraryItem,
  setMultiviewAsCurrent,
  getPetDiary,
} from '../avatarService'

// 工厂内局部变量改名 store：与解构出的外层 memoryStore 同名会触发 no-shadow
const { memoryStore, mockGeneratePetImage, mockApiPut, mockApiPost, mockApiGet, mockApiDelete } = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    memoryStore: store,
    mockGeneratePetImage: vi.fn(),
    mockApiPut: vi.fn(),
    mockApiPost: vi.fn(),
    mockApiGet: vi.fn(),
    mockApiDelete: vi.fn(),
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn((key: string) => memoryStore.get(key) ?? ''),
    setStorageSync: vi.fn((key: string, value: unknown) => { memoryStore.set(key, value) }),
    removeStorageSync: vi.fn((key: string) => { memoryStore.delete(key) }),
    clearStorageSync: vi.fn(),
    request: vi.fn(() => Promise.resolve({ statusCode: 200, data: {} })),
  },
}))

vi.mock('../api', () => ({
  api: {
    put: mockApiPut,
    post: mockApiPost,
    get: mockApiGet,
    delete: mockApiDelete,
  },
  resolveAvatarUrl: (url: string) => url,
}))

vi.mock('../../engines/petAvatar/seedreamAdapter', () => ({
  seedreamAdapter: {
    generatePetImage: mockGeneratePetImage,
  },
}))

vi.mock('../../constants', () => ({
  AVATAR_FREE_GENERATIONS: 1,
  AVATAR_MEMBER_GENERATIONS: -1,
}))

describe('avatarService', () => {
  beforeEach(() => {
    memoryStore.clear()
    vi.clearAllMocks()
    mockApiPut.mockResolvedValue({})
    mockGeneratePetImage.mockResolvedValue({ success: false, error: 'stub' })
  })

  describe('generateAvatarOptions 参数透传', () => {
    beforeEach(() => {
      mockApiPost.mockReset()
      mockApiPost.mockResolvedValue({
        options: [
          { style: 'q', label: 'Q版萌系', url: 'https://cdn.example.com/q.png' },
          { style: 'japanese', label: '日系治愈', url: 'https://cdn.example.com/j.png' },
        ],
      })
    })

    it('传画风+表情时透传给后端（照片流生成 1 张）', async () => {
      await generateAvatarOptions('pet-1', 'https://e.com/photo.png', 'cartoon', 'q', 'happy')
      expect(mockApiPost).toHaveBeenCalledWith('/api/avatar/generate-options', {
        petId: 'pet-1',
        referenceImageUrl: 'https://e.com/photo.png',
        style: 'cartoon',
        styleKey: 'q',
        expression: 'happy',
      })
    })

    it('不传可选参数时字段为 undefined（服务端按档案自动生成）', async () => {
      await generateAvatarOptions('pet-1')
      expect(mockApiPost).toHaveBeenCalledWith('/api/avatar/generate-options', {
        petId: 'pet-1',
        referenceImageUrl: undefined,
        style: 'cartoon',
        styleKey: undefined,
        expression: undefined,
      })
    })

    it('后端无候选/报错时返回 null（不回退占位图）', async () => {
      mockApiPost.mockResolvedValue({ options: [] })
      expect(await generateAvatarOptions('pet-1')).toBeNull()
      mockApiPost.mockRejectedValue(new Error('network'))
      expect(await generateAvatarOptions('pet-1')).toBeNull()
    })
  })

  describe('形象库 API（保存/查询/删除）', () => {
    beforeEach(() => {
      mockApiPost.mockReset()
      mockApiPost.mockResolvedValue({ id: 'lib-1' })
    })

    it('saveAvatarToLibrary 保存形象（带风格/表情标记，缺省头像类型）', async () => {
      const ok = await saveAvatarToLibrary('pet-1', 'q', 'happy', 'https://cdn.example.com/q.png')
      expect(ok).toBe(true)
      expect(mockApiPost).toHaveBeenCalledWith('/api/avatar/library', {
        petId: 'pet-1',
        style: 'q',
        expression: 'happy',
        imageUrl: 'https://cdn.example.com/q.png',
        viewType: 'headshot',
      })
    })

    it('saveAvatarToLibrary 传 viewType=multiview 保存全方位设定图（迁移 030）', async () => {
      await saveAvatarToLibrary('pet-1', 'q', null, 'https://cdn.example.com/sheet.png', 'multiview')
      expect(mockApiPost).toHaveBeenCalledWith('/api/avatar/library', {
        petId: 'pet-1',
        style: 'q',
        expression: null,
        imageUrl: 'https://cdn.example.com/sheet.png',
        viewType: 'multiview',
      })
    })

    it('saveAvatarToLibrary 失败返回 false', async () => {
      mockApiPost.mockRejectedValue(new Error('network'))
      expect(await saveAvatarToLibrary('pet-1', 'q', null, 'x')).toBe(false)
    })

    it('getAvatarLibrary 把服务端 snake_case 映射为 camelCase（契约回归：页面读 item.imageUrl）', async () => {
      mockApiGet.mockResolvedValue([
        {
          id: 'lib-1',
          pet_id: 'pet-1',
          style: 'q',
          expression: 'happy',
          image_url: 'https://cdn.example.com/q.png',
          view_type: 'headshot',
          created_at: '2026-08-24T00:00:00.000Z',
        },
      ])
      const items = await getAvatarLibrary('pet-1')
      expect(items).toHaveLength(1)
      expect(items[0].imageUrl).toBe('https://cdn.example.com/q.png')
      expect(items[0].petId).toBe('pet-1')
      expect(items[0].viewType).toBe('headshot')
      expect(items[0].createdAt).toBe('2026-08-24T00:00:00.000Z')
    })

    it('getAvatarLibrary view_type=multiview 正确映射；服务端未升级缺省时按 headshot 兜底', async () => {
      mockApiGet.mockResolvedValue([
        { id: 'lib-2', pet_id: 'pet-1', style: 'q', expression: null, image_url: 'u2', view_type: 'multiview', created_at: 't' },
        { id: 'lib-3', pet_id: 'pet-1', style: 'japanese', expression: null, image_url: 'u3', created_at: 't' },
      ])
      const items = await getAvatarLibrary('pet-1')
      expect(items[0].viewType).toBe('multiview')
      expect(items[1].viewType).toBe('headshot')
    })

    it('setMultiviewAsCurrent 只写 avatar_multiview_url（snake_case），不清真实照片/卡通头像', async () => {
      mockApiPut.mockResolvedValue({ id: 'pet-1', avatar_multiview_url: 'https://cdn.example.com/sheet.png' })
      const updated = await setMultiviewAsCurrent('pet-1', 'https://cdn.example.com/sheet.png')
      expect(updated).not.toBeNull()
      // 契约锁：PUT body 必须只有 multiview 一个键——多传 camelCase 或误清 photo 都会破坏全家福参考图优先级
      expect(mockApiPut).toHaveBeenCalledTimes(1)
      const [path, body] = mockApiPut.mock.calls[0]
      expect(path).toBe('/api/pets/pet-1')
      expect(Object.keys(body as Record<string, unknown>)).toEqual(['avatar_multiview_url'])
      expect(body).toEqual({ avatar_multiview_url: 'https://cdn.example.com/sheet.png' })
    })

    it('setMultiviewAsCurrent 失败返回 null（调用方 patch 兜底）', async () => {
      mockApiPut.mockRejectedValue(new Error('network'))
      expect(await setMultiviewAsCurrent('pet-1', 'x')).toBeNull()
    })

    it('getAvatarLibrary 请求失败返回空数组（不抛错）', async () => {
      mockApiGet.mockRejectedValue(new Error('network'))
      expect(await getAvatarLibrary('pet-1')).toEqual([])
    })

    it('deleteAvatarLibraryItem 删除成功返回 true、失败返回 false', async () => {
      mockApiDelete.mockResolvedValue({})
      expect(await deleteAvatarLibraryItem('lib-1')).toBe(true)
      expect(mockApiDelete).toHaveBeenCalledWith('/api/avatar/library/lib-1')
      mockApiDelete.mockRejectedValue(new Error('network'))
      expect(await deleteAvatarLibraryItem('lib-1')).toBe(false)
    })
  })

  describe('getGenerationCount', () => {
    it('returns 0 when no count stored', () => {
      expect(getGenerationCount()).toBe(0)
    })

    it('returns stored count', () => {
      memoryStore.set('xhh_avatar_gen_count', 3)
      expect(getGenerationCount()).toBe(3)
    })
  })

  describe('incrementGenerationCount', () => {
    it('increments from 0 to 1', () => {
      incrementGenerationCount()
      expect(getGenerationCount()).toBe(1)
    })

    it('increments from existing count', () => {
      memoryStore.set('xhh_avatar_gen_count', 2)
      incrementGenerationCount()
      expect(getGenerationCount()).toBe(3)
    })
  })

  describe('canGenerateAvatar', () => {
    it('allows member to generate', () => {
      expect(canGenerateAvatar(true)).toBe(true)
    })

    it('allows free user with 0 generations', () => {
      expect(canGenerateAvatar(false)).toBe(true)
    })

    it('blocks free user after using free quota', () => {
      memoryStore.set('xhh_avatar_gen_count', 1)
      expect(canGenerateAvatar(false)).toBe(false)
    })
  })

  describe('getAvatarCustomization', () => {
    it('returns null when no customization stored', () => {
      expect(getAvatarCustomization()).toBeNull()
    })

    it('returns stored customization', () => {
      const custom = { species: 'dog' as const, style: 'cartoon' as const, baseColor: '#FFD93D' }
      memoryStore.set('xhh_avatar_custom', custom)
      expect(getAvatarCustomization()).toEqual(custom)
    })
  })

  describe('saveAvatarCustomization', () => {
    it('saves to local storage', async () => {
      const custom = {
        species: 'cat' as const,
        style: 'cartoon' as const,
        baseColor: '#FFF8E7',
        generatedAt: '2025-01-01',
        cartoonUrl: 'https://example.com/avatar.png',
      }
      await saveAvatarCustomization(custom)
      expect(memoryStore.get('xhh_avatar_custom')).toEqual(custom)
    })

    it('calls API when pet ID is set in storage', async () => {
      memoryStore.set('xhh_current_pet_id', 'pet-123')
      const custom = {
        species: 'cat' as const,
        style: 'cartoon' as const,
        baseColor: '#FFF8E7',
        generatedAt: '2025-01-01',
        cartoonUrl: 'https://example.com/avatar.png',
      }
      await saveAvatarCustomization(custom)
      // 头像定制按宠物隔离：写 xhh_avatar_custom_{petId}，而不是全局 key
      expect(memoryStore.get('xhh_avatar_custom_pet-123')).toEqual(custom)
      // 服务端契约：snake_case 字段 + 保存卡通时清空 avatar_photo_url（避免照片优先级压住卡通）
      expect(mockApiPut).toHaveBeenCalledWith('/api/pets/pet-123', {
        avatar_style: 'cartoon',
        avatar_cartoon_url: 'https://example.com/avatar.png',
        avatar_photo_url: null,
      })
    })

    it('skips API when no pet ID in storage', async () => {
      const custom = {
        species: 'dog' as const,
        style: 'cartoon' as const,
        baseColor: '#FFD93D',
      }
      await saveAvatarCustomization(custom)
      expect(memoryStore.get('xhh_avatar_custom')).toEqual(custom)
      expect(mockApiPut).not.toHaveBeenCalled()
    })

    it('saves to local storage even when API fails', async () => {
      memoryStore.set('xhh_current_pet_id', 'pet-456')
      mockApiPut.mockRejectedValue(new Error('API error'))
      const custom = {
        species: 'dog' as const,
        style: 'cartoon' as const,
        baseColor: '#FFD93D',
      }
      await saveAvatarCustomization(custom)
      // 头像定制按宠物隔离：写 xhh_avatar_custom_{petId}，而不是全局 key
      expect(memoryStore.get('xhh_avatar_custom_pet-456')).toEqual(custom)
    })
  })

  describe('generateAvatarImage', () => {
    it('generates avatar and returns result on success', async () => {
      mockGeneratePetImage.mockResolvedValue({
        success: true,
        imageUrl: 'data:image/svg+xml,...',
      })
      const result = await generateAvatarImage('test-pet-001', 'dog', '旺财', 'cartoon')
      expect(result).not.toBeNull()
      expect(result!.success).toBe(true)
      expect(mockGeneratePetImage).toHaveBeenCalled()
    })

    it('returns null when generation fails', async () => {
      mockGeneratePetImage.mockResolvedValue({
        success: false,
        error: 'API error',
      })
      const result = await generateAvatarImage('test-pet-001', 'dog', '旺财', 'cartoon')
      expect(result).toBeNull()
    })
  })

  describe('getPetDiary', () => {
    const defaultContext = {
      todayEntry: null,
      hasAnomaly: false,
      anomalyCount: 0,
      riskLevel: null,
      streakDays: 0,
      isBirthday: false,
      isVaccineComplete: false,
      isRecovery: false,
      isDeceased: false,
    }

    it('returns cached diary for today', () => {
      const today = new Date().toISOString().slice(0, 10)
      memoryStore.set('xhh_diary_cache', JSON.stringify({ date: today, text: 'cached diary' }))
      const result = getPetDiary('旺财', defaultContext)
      expect(result).toBe('cached diary')
    })

    it('generates new diary when no cache', () => {
      const result = getPetDiary('旺财', defaultContext)
      expect(result).toContain('旺财')
    })

    it('generates new diary when cache is from different day', () => {
      memoryStore.set('xhh_diary_cache', JSON.stringify({ date: '2020-01-01', text: 'old diary' }))
      const result = getPetDiary('旺财', defaultContext)
      expect(result).toContain('旺财')
      expect(result).not.toBe('old diary')
    })
  })
})