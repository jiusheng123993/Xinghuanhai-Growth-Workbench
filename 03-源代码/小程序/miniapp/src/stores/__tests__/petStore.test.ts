/**
 * 宠物资料状态管理 - 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { usePetStore } from '../petStore'
import type { PetProfile } from '../../services/petService'

const { mockPetService } = vi.hoisted(() => {
  return {
    mockPetService: {
      getPets: vi.fn(),
      createPet: vi.fn(),
      updatePet: vi.fn(),
      deletePet: vi.fn(),
      markDeceased: vi.fn(),
      setCurrentPet: vi.fn(),
      getCurrentPet: vi.fn(),
    },
  }
})

vi.mock('../../services/petService', () => mockPetService)

function makePet(overrides: Partial<PetProfile> = {}): PetProfile {
  return {
    id: 'pet_001',
    name: '旺财',
    species: 'dog',
    breed: '金毛寻回犬',
    breedId: 'golden-retriever',
    gender: 'male',
    birthDate: '2022-01-15',
    weight: 30,
    coatColor: '',
    avatarPhotoUrl: '',
    photos: [],
    isNeutered: true,
    microchipId: '',
    notes: '很活泼',
    isDeceased: false,
    allergies: [],
    medications: [],
    chronicConditions: [],
    userId: 'user_001',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makePetData(): Omit<PetProfile, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '旺财',
    species: 'dog',
    breed: '金毛寻回犬',
    breedId: 'golden-retriever',
    gender: 'male',
    birthDate: '2022-01-15',
    weight: 30,
    coatColor: '',
    avatarPhotoUrl: '',
    photos: [],
    isNeutered: true,
    microchipId: '',
    notes: '很活泼',
    isDeceased: false,
    allergies: [],
    medications: [],
    chronicConditions: [],
    userId: 'user_001',
  }
}

describe('petStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePetStore.setState({
      userId: 'test_user',
      pets: [],
      currentPet: null,
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('should have empty pets list', () => {
      const state = usePetStore.getState()
      expect(state.pets).toEqual([])
    })

    it('should have null currentPet', () => {
      const state = usePetStore.getState()
      expect(state.currentPet).toBeNull()
    })

    it('should have isLoading as false', () => {
      const state = usePetStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have null error', () => {
      const state = usePetStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('fetchPets', () => {
    it('should load pet list', async () => {
      const mockPets = [makePet(), makePet({ id: 'pet_002', name: '咪咪' })]
      const mockCurrentPet = makePet()
      mockPetService.getPets.mockResolvedValue(mockPets)
      mockPetService.getCurrentPet.mockResolvedValue(mockCurrentPet)

      await usePetStore.getState().fetchPets('test-user-id')

      const state = usePetStore.getState()
      expect(state.pets).toHaveLength(2)
      expect(state.pets[0].name).toBe('旺财')
      expect(state.pets[1].name).toBe('咪咪')
      expect(state.currentPet).not.toBeNull()
      expect(state.currentPet!.id).toBe('pet_001')
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('should set error when fetch fails', async () => {
      mockPetService.getPets.mockRejectedValue(new Error('Network error'))

      await usePetStore.getState().fetchPets('test-user-id')

      const state = usePetStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('Network error')
    })

    it('should record userId so switchPet works after direct fetchPets', async () => {
      // 回归测试：宠物档案等页面只调用 fetchPets 不调用 initUser，
      // fetchPets 必须把 userId 写入 store，否则 switchPet 会抛“用户未登录”
      usePetStore.setState({ userId: null })
      const pet1 = makePet()
      const pet2 = makePet({ id: 'pet_002', name: '咪咪' })
      mockPetService.getPets.mockResolvedValue([pet1, pet2])
      mockPetService.setCurrentPet.mockResolvedValue(undefined)

      await usePetStore.getState().fetchPets('user_after_login')

      const state = usePetStore.getState()
      expect(state.userId).toBe('user_after_login')

      // 模拟点击第二个宠物标签进行切换，不应再抛“用户未登录”
      await usePetStore.getState().switchPet('pet_002')
      expect(usePetStore.getState().currentPet!.id).toBe('pet_002')
      expect(mockPetService.setCurrentPet).toHaveBeenCalledWith('user_after_login', 'pet_002')
    })
  })

  describe('addPet', () => {
    it('should add pet and update list', async () => {
      const newPet = makePet()
      mockPetService.createPet.mockResolvedValue(newPet)

      const result = await usePetStore.getState().addPet(makePetData())

      expect(result.id).toBe('pet_001')
      expect(result.name).toBe('旺财')

      const state = usePetStore.getState()
      expect(state.pets).toHaveLength(1)
      expect(state.pets[0].name).toBe('旺财')
      expect(state.isLoading).toBe(false)
    })

    it('should set error when add fails', async () => {
      mockPetService.createPet.mockRejectedValue(new Error('Create failed'))

      await expect(usePetStore.getState().addPet(makePetData())).rejects.toThrow('Create failed')

      const state = usePetStore.getState()
      expect(state.error).toBe('Create failed')
    })
  })

  describe('updatePet', () => {
    it('should update pet info', async () => {
      usePetStore.setState({ pets: [makePet()], currentPet: makePet() })
      const updated = makePet({ name: '旺财2', weight: 32 })
      mockPetService.updatePet.mockResolvedValue(updated)

      await usePetStore.getState().updatePet('pet_001', { name: '旺财2', weight: 32 })

      const state = usePetStore.getState()
      expect(state.pets[0].name).toBe('旺财2')
      expect(state.pets[0].weight).toBe(32)
      expect(state.currentPet!.name).toBe('旺财2')
      expect(state.isLoading).toBe(false)
    })

    it('should set error when update fails', async () => {
      usePetStore.setState({ pets: [makePet()] })
      mockPetService.updatePet.mockRejectedValue(new Error('Update failed'))

      await expect(usePetStore.getState().updatePet('pet_001', { name: 'test' })).rejects.toThrow('Update failed')

      const state = usePetStore.getState()
      expect(state.error).toBe('Update failed')
    })
  })

  describe('removePet', () => {
    it('should remove pet from list', async () => {
      usePetStore.setState({
        pets: [makePet(), makePet({ id: 'pet_002', name: '咪咪' })],
        currentPet: makePet(),
      })
      mockPetService.deletePet.mockResolvedValue(undefined)

      await usePetStore.getState().removePet('pet_001')

      const state = usePetStore.getState()
      expect(state.pets).toHaveLength(1)
      expect(state.pets[0].id).toBe('pet_002')
      expect(state.currentPet).not.toBeNull()
      expect(state.currentPet!.id).toBe('pet_002')
      expect(state.isLoading).toBe(false)
    })

    it('should set error when remove fails', async () => {
      usePetStore.setState({ pets: [makePet()] })
      mockPetService.deletePet.mockRejectedValue(new Error('Delete failed'))

      await expect(usePetStore.getState().removePet('pet_001')).rejects.toThrow('Delete failed')

      const state = usePetStore.getState()
      expect(state.error).toBe('Delete failed')
    })
  })

  describe('markPetDeceased', () => {
    it('should mark pet as deceased', async () => {
      usePetStore.setState({ pets: [makePet()], currentPet: makePet() })
      const deceased = makePet({ isDeceased: true, deceasedDate: '2024-06-01' })
      mockPetService.markDeceased.mockResolvedValue(deceased)

      await usePetStore.getState().markPetDeceased('pet_001', '2024-06-01')

      const state = usePetStore.getState()
      expect(state.pets[0].isDeceased).toBe(true)
      expect(state.pets[0].deceasedDate).toBe('2024-06-01')
      expect(state.currentPet!.isDeceased).toBe(true)
      expect(state.isLoading).toBe(false)
    })

    it('should set error when markDeceased fails', async () => {
      usePetStore.setState({ pets: [makePet()] })
      mockPetService.markDeceased.mockRejectedValue(new Error('Mark failed'))

      await expect(usePetStore.getState().markPetDeceased('pet_001', '2024-06-01')).rejects.toThrow('Mark failed')

      const state = usePetStore.getState()
      expect(state.error).toBe('Mark failed')
    })
  })

  describe('switchPet', () => {
    it('should switch current pet', async () => {
      const pet1 = makePet()
      const pet2 = makePet({ id: 'pet_002', name: '咪咪' })
      usePetStore.setState({ pets: [pet1, pet2], currentPet: pet1 })
      mockPetService.setCurrentPet.mockResolvedValue(undefined)

      await usePetStore.getState().switchPet('pet_002')

      const state = usePetStore.getState()
      expect(state.currentPet).not.toBeNull()
      expect(state.currentPet!.id).toBe('pet_002')
      expect(state.currentPet!.name).toBe('咪咪')
      expect(state.isLoading).toBe(false)
      expect(mockPetService.setCurrentPet).toHaveBeenCalledWith('test_user', 'pet_002')
    })

    it('should set error when switch fails', async () => {
      usePetStore.setState({ pets: [makePet()] })
      mockPetService.setCurrentPet.mockRejectedValue(new Error('Switch failed'))

      await expect(usePetStore.getState().switchPet('pet_001')).rejects.toThrow('Switch failed')

      const state = usePetStore.getState()
      expect(state.error).toBe('Switch failed')
    })
  })

  describe('clearError', () => {
    it('should clear error', () => {
      usePetStore.setState({ error: 'Some error' })

      usePetStore.getState().clearError()

      const state = usePetStore.getState()
      expect(state.error).toBeNull()
    })
  })
})
