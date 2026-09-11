/**
 * 家庭服务测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { api as _api } from '../api'
import { familyService } from '../familyService'
import type { PetFamily, PetFamilyMember, PetLineage, FamilyPhoto } from '../../types/familyTypes'

const mockStorage: Record<string, string> = {}

vi.mock('../../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[`xhh_${key}`]
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[`xhh_${key}`] = JSON.stringify(value)
  }),
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[`xhh_${key}`]
  }),
}))

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock('../mock', () => ({
  mockApi: {
    getFamilies: vi.fn(),
    createFamily: vi.fn(),
    getMembers: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    updateMemberRole: vi.fn(),
    getLineage: vi.fn(),
    addLineage: vi.fn(),
    removeLineage: vi.fn(),
    getFamilyPhotos: vi.fn(),
    saveFamilyPhoto: vi.fn(),
    deleteFamilyPhoto: vi.fn(),
  },
}))
vi.mock('../../config', () => ({
  CONFIG: { USE_MOCK: false },
}))
const api = _api as any

function makeFamily(overrides: Partial<PetFamily> = {}): PetFamily {
  return {
    id: 'family-001',
    userId: 'user-001',
    name: '测试家庭',
    avatarUrl: 'https://example.com/avatar.jpg',
    memberCount: 2,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeMember(overrides: Partial<PetFamilyMember> = {}): PetFamilyMember {
  return {
    id: 'member-001',
    familyId: 'family-001',
    petId: 'pet-001',
    role: 'parent',
    joinedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeLineage(overrides: Partial<PetLineage> = {}): PetLineage {
  return {
    id: 'lineage-001',
    familyId: null,
    parentId: 'pet-001',
    childId: 'pet-002',
    litterDate: '2024-01-01',
    ...overrides,
  }
}

function makePhoto(overrides: Partial<FamilyPhoto> = {}): FamilyPhoto {
  return {
    id: 'photo-001',
    familyId: 'family-001',
    userId: 'user-001',
    photoUrl: 'https://example.com/photo.jpg',
    photoType: 'generated',
    memberCount: 3,
    memberNames: ['小白', '小黑', '小花'],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('familyService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  describe('getFamilies', () => {
    it('calls api.get with /api/families', async () => {
      vi.mocked(api.get).mockResolvedValue([makeFamily()])

      await familyService.getFamilies()

      expect(api.get).toHaveBeenCalledWith('/api/families')
    })

    it('returns empty array when API returns null', async () => {
      vi.mocked(api.get).mockResolvedValue(null)

      const result = await familyService.getFamilies()

      expect(result).toEqual([])
    })

    it('returns families array when API returns data', async () => {
      const families = [makeFamily(), makeFamily({ id: 'family-002', name: '家庭二' })]
      vi.mocked(api.get).mockResolvedValue(families)

      const result = await familyService.getFamilies()

      expect(result).toEqual(families)
      expect(result).toHaveLength(2)
    })
  })

  describe('createFamily', () => {
    it('calls api.post with /api/families and { name }', async () => {
      const newFamily = makeFamily({ name: '新家庭' })
      vi.mocked(api.post).mockResolvedValue(newFamily)

      await familyService.createFamily('新家庭')

      expect(api.post).toHaveBeenCalledWith('/api/families', { name: '新家庭' })
    })

    it('returns created family', async () => {
      const newFamily = makeFamily({ id: 'family-new', name: '新家庭', memberCount: 0 })
      vi.mocked(api.post).mockResolvedValue(newFamily)

      const result = await familyService.createFamily('新家庭')

      expect(result).toEqual(newFamily)
      expect(result.name).toBe('新家庭')
    })
  })

  describe('getMembers', () => {
    it('calls api.get with /api/families/{familyId} detail endpoint', async () => {
      vi.mocked(api.get).mockResolvedValue({ members: [makeMember()] })

      await familyService.getMembers('family-001')

      expect(api.get).toHaveBeenCalledWith('/api/families/family-001')
    })

    it('returns empty array when API returns null', async () => {
      vi.mocked(api.get).mockResolvedValue(null)

      const result = await familyService.getMembers('family-001')

      expect(result).toEqual([])
    })

    it('returns members array when API returns data', async () => {
      const members = [makeMember(), makeMember({ id: 'member-002' })]
      vi.mocked(api.get).mockResolvedValue({ members })

      const result = await familyService.getMembers('family-001')

      expect(result).toEqual(members)
      expect(result).toHaveLength(2)
    })
  })

  describe('addMember', () => {
    it('calls api.post with /api/families/{familyId}/members and { petId, role }', async () => {
      vi.mocked(api.post).mockResolvedValue(undefined)

      await familyService.addMember('family-001', 'pet-001', 'parent')

      expect(api.post).toHaveBeenCalledWith('/api/families/family-001/members', {
        petId: 'pet-001',
        role: 'parent',
      })
    })

    it('sends role as undefined when not provided', async () => {
      vi.mocked(api.post).mockResolvedValue(undefined)

      await familyService.addMember('family-001', 'pet-001')

      expect(api.post).toHaveBeenCalledWith('/api/families/family-001/members', {
        petId: 'pet-001',
        role: undefined,
      })
    })
  })

  describe('removeMember', () => {
    it('calls api.delete with /api/families/{familyId}/members/by-id/{memberId}', async () => {
      vi.mocked(api.delete).mockResolvedValue(undefined)

      await familyService.removeMember('family-001', 'member-001')

      expect(api.delete).toHaveBeenCalledWith('/api/families/family-001/members/by-id/member-001')
    })
  })

  describe('updateMemberRole', () => {
    it('calls api.patch with role', async () => {
      vi.mocked(api.patch).mockResolvedValue(undefined)

      await familyService.updateMemberRole('family-001', 'member-001', 'admin')

      expect(api.patch).toHaveBeenCalledWith('/api/families/family-001/members/member-001/role', {
        role: 'admin',
      })
    })
  })

  describe('getLineage', () => {
    it('calls api.get with /api/families/{familyId}/lineage/{petId}', async () => {
      vi.mocked(api.get).mockResolvedValue({
        pet: { id: 'pet-001', name: '小白', avatar_url: null, species: 'cat' },
        parents: [],
        children: [],
        siblings: [],
        mates: [],
      })

      await familyService.getLineage('pet-001', 'family-001')

      expect(api.get).toHaveBeenCalledWith('/api/families/family-001/lineage/pet-001')
    })

    it('returns default structure when API returns null', async () => {
      vi.mocked(api.get).mockResolvedValue(null)

      const result = await familyService.getLineage('pet-001', 'family-001')

      expect(result.pet.id).toBe('pet-001')
      expect(result.parents).toEqual([])
      expect(result.children).toEqual([])
      expect(result.siblings).toEqual([])
      expect(result.mates).toEqual([])
    })

    it('returns lineage when API returns data (snake_case → camelCase)', async () => {
      const rawData = {
        pet: { id: 'pet-001', name: '小白', avatar_url: null, species: 'cat' },
        parents: [{ id: 'l-001', family_id: null, parent_id: 'pet-p1', child_id: 'pet-001', litter_date: '2024-01-01', created_at: null, pet_id: 'pet-p1', pet_name: '大黑', pet_avatar_url: null, pet_species: 'dog' }],
        children: [{ id: 'l-002', family_id: null, parent_id: 'pet-001', child_id: 'pet-c1', litter_date: null, created_at: null, pet_id: 'pet-c1', pet_name: '小花', pet_avatar_url: null, pet_species: 'cat' }],
        siblings: [],
        mates: [],
      }
      vi.mocked(api.get).mockResolvedValue(rawData)

      const result = await familyService.getLineage('pet-001', 'family-001')

      expect(result.pet.name).toBe('小白')
      expect(result.parents).toHaveLength(1)
      expect(result.parents[0].parentId).toBe('pet-p1')
      expect(result.parents[0].petName).toBe('大黑')
      expect(result.children).toHaveLength(1)
      expect(result.children[0].childId).toBe('pet-c1')
      expect(result.children[0].petName).toBe('小花')
    })
  })

  describe('addLineage', () => {
    it('calls api.post with correct params including litter_date', async () => {
      vi.mocked(api.post).mockResolvedValue(undefined)

      await familyService.addLineage('pet-001', 'pet-002', 'family-001', '2024-01-01')

      expect(api.post).toHaveBeenCalledWith('/api/families/family-001/lineage', {
        parent_id: 'pet-001',
        child_id: 'pet-002',
        litter_date: '2024-01-01',
      })
    })

    it('sends litter_date as undefined when not provided', async () => {
      vi.mocked(api.post).mockResolvedValue(undefined)

      await familyService.addLineage('pet-001', 'pet-002', 'family-001')

      expect(api.post).toHaveBeenCalledWith('/api/families/family-001/lineage', {
        parent_id: 'pet-001',
        child_id: 'pet-002',
        litter_date: undefined,
      })
    })
  })

  describe('removeLineage', () => {
    it('calls api.delete with /api/families/{familyId}/lineage/{lineageId}', async () => {
      vi.mocked(api.delete).mockResolvedValue(undefined)

      await familyService.removeLineage('lineage-001', 'family-001')

      expect(api.delete).toHaveBeenCalledWith('/api/families/family-001/lineage/lineage-001')
    })
  })

  describe('getFamilyPhotos', () => {
    it('returns empty array when no local photos exist', async () => {
      const result = await familyService.getFamilyPhotos('family-001')

      expect(result).toEqual([])
    })

    it('returns local photos filtered by familyId', async () => {
      mockStorage['xhh_family_photos_all'] = JSON.stringify([
        makePhoto(),
        makePhoto({ id: 'photo-002', familyId: 'family-002' }),
      ])

      const result = await familyService.getFamilyPhotos('family-001')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('photo-001')
    })
  })

  describe('generateFamilyPhoto', () => {
    it('calls api.post with /api/families/{familyId}/photos and style', async () => {
      vi.mocked(api.post).mockResolvedValue({ id: 'photo-new', photoUrl: 'https://example.com/ai-photo.jpg' })

      const result = await familyService.generateFamilyPhoto('family-001', 'pixar')

      expect(api.post).toHaveBeenCalledWith('/api/families/family-001/photos', { style: 'pixar' })
      expect(result.id).toBe('photo-new')
      expect(result.photoUrl).toBe('https://example.com/ai-photo.jpg')
    })

    it('成员排位透传 memberOrder（顺序=画面从左到右）；单人不发排位字段', async () => {
      vi.mocked(api.post).mockResolvedValue({ id: 'photo-new', photoUrl: 'https://example.com/ai-photo.jpg' })

      await familyService.generateFamilyPhoto('family-001', 'pixar', undefined, undefined, ['pet-b', 'pet-a'])
      expect(api.post).toHaveBeenLastCalledWith('/api/families/family-001/photos', {
        style: 'pixar',
        memberOrder: ['pet-b', 'pet-a'],
      })

      // 排位数组长度 ≤1 视为无意义，不携带
      await familyService.generateFamilyPhoto('family-001', 'pixar', undefined, undefined, ['pet-a'])
      expect(api.post).toHaveBeenLastCalledWith('/api/families/family-001/photos', { style: 'pixar' })
    })

    it('falls back to local storage when API fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

      mockStorage['xhh_family_photos_all'] = JSON.stringify([
        makePhoto({ id: 'photo-001', familyId: 'family-001' }),
        makePhoto({ id: 'photo-002', familyId: 'family-002' }),
      ])

      const result = await familyService.getFamilyPhotos('family-001')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('photo-001')
    })
  })

  describe('deleteFamilyPhoto', () => {
    it('calls api.delete with /api/families/{familyId}/photos/{photoId}', async () => {
      vi.mocked(api.delete).mockResolvedValue(undefined)

      await familyService.deleteFamilyPhoto('family-001', 'photo-001')

      expect(api.delete).toHaveBeenCalledWith('/api/families/family-001/photos/photo-001')
    })

    it('falls back to local storage when API fails', async () => {
      vi.mocked(api.delete).mockRejectedValue(new Error('Network error'))
      mockStorage['xhh_family_photos_all'] = JSON.stringify([
        makePhoto({ id: 'photo-001' }),
        makePhoto({ id: 'photo-002' }),
      ])

      await familyService.deleteFamilyPhoto('family-001', 'photo-001')

      const photos = await familyService.getFamilyPhotos('family-001')
      expect(photos).toHaveLength(1)
      expect(photos[0].id).toBe('photo-002')
    })
  })
})