/**
 * 宠物资料状态管理
 * 管理宠物列表、当前宠物选择、CRUD 操作和头像生成任务追踪
 */
import Taro from '@tarojs/taro'
import create from 'zustand'
import {
  getPets,
  createPet,
  updatePet,
  deletePet,
  markDeceased,
  setCurrentPet,
  type PetProfile,
} from '../services/petService'

/** 宠物状态定义 */
interface PetState {
  userId: string | null
  pets: PetProfile[]
  currentPet: PetProfile | null
  isLoading: boolean
  error: string | null
  initUser: (userId: string) => Promise<void>
  fetchPets: (userId: string) => Promise<void>
  addPet: (data: Omit<PetProfile, 'id' | 'createdAt' | 'updatedAt'>) => Promise<PetProfile>
  updatePet: (id: string, data: Partial<PetProfile>) => Promise<void>
  removePet: (id: string) => Promise<void>
  markPetDeceased: (id: string, date: string) => Promise<void>
  switchPet: (id: string) => Promise<void>
  clearError: () => void
  avatar2DTaskId: string | null
  avatar3DTaskId: string | null
  setAvatar2DTaskId: (taskId: string | null) => void
  setAvatar3DTaskId: (taskId: string | null) => void
}

export const usePetStore = create<PetState>((set, get) => ({
  userId: null,
  pets: [],
  currentPet: null,
  isLoading: false,
  error: null,
  avatar2DTaskId: null,
  avatar3DTaskId: null,

  /**
   * 初始化用户并加载宠物列表
   * @param userId - 用户 ID
   */
  initUser: async (userId: string) => {
    set({ userId })
    await get().fetchPets(userId)
  },

  /**
   * 获取宠物列表，自动选中第一个宠物
   * @param userId - 用户 ID
   */
  fetchPets: async (userId: string) => {
    // 这里必须同步记录 userId：部分页面（如宠物档案）直接调用 fetchPets 而不是 initUser，
    // 如果不写 userId，后续 switchPet / addPet 等操作会因 store.userId 为空而抛“用户未登录”
    set({ userId, isLoading: true, error: null })
    try {
      const pets = await getPets(userId)
      const { currentPet } = get()
      set({
        pets,
        isLoading: false,
        currentPet: currentPet
          ? pets.find(p => p.id === currentPet.id) || pets[0] || null
          : pets[0] || null,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '获取宠物列表失败',
      })
    }
  },

  /**
   * 添加新宠物
   * @param data - 宠物资料（不含 id/时间戳）
   * @returns 创建后的宠物资料
   */
  addPet: async (data) => {
    const { userId } = get()
    if (!userId) throw new Error('用户未登录')
    set({ isLoading: true, error: null })
    try {
      const pet = await createPet(userId, data)
      set(state => ({
        pets: [...state.pets, pet],
        currentPet: state.currentPet || pet,
        isLoading: false,
      }))
      return pet
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '添加宠物失败',
      })
      throw err
    }
  },

  /**
   * 更新宠物资料
   * @param id - 宠物 ID
   * @param data - 要更新的字段
   */
  updatePet: async (id, data) => {
    const { userId } = get()
    if (!userId) throw new Error('用户未登录')
    set({ isLoading: true, error: null })
    try {
      const updated = await updatePet(userId, id, data)
      set(state => ({
        pets: state.pets.map(p => p.id === id ? updated : p),
        currentPet: state.currentPet?.id === id ? updated : state.currentPet,
        isLoading: false,
      }))
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '更新宠物失败',
      })
      throw err
    }
  },

  /**
   * 删除宠物
   * @param id - 宠物 ID
   */
  removePet: async (id) => {
    const { userId } = get()
    if (!userId) throw new Error('用户未登录')
    set({ isLoading: true, error: null })
    try {
      await deletePet(userId, id)
      set(state => {
        const remainingPets = state.pets.filter(p => p.id !== id)
        return {
          pets: remainingPets,
          currentPet: state.currentPet?.id === id
            ? (remainingPets[0] || null)
            : state.currentPet,
          isLoading: false,
        }
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '删除宠物失败',
      })
      throw err
    }
  },

  /**
   * 标记宠物离世
   * @param id - 宠物 ID
   * @param date - 离世日期
   */
  markPetDeceased: async (id, date) => {
    const { userId } = get()
    if (!userId) throw new Error('用户未登录')
    set({ isLoading: true, error: null })
    try {
      const updated = await markDeceased(userId, id, date)
      set(state => ({
        pets: state.pets.map(p => p.id === id ? updated : p),
        currentPet: state.currentPet?.id === id ? updated : state.currentPet,
        isLoading: false,
      }))
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '标记离世失败',
      })
      throw err
    }
  },

  /**
   * 切换当前宠物
   *
   * 2026-09-11 审查（P2-3 / P2-4）修掉两个边界：
   *  · **乐观切换失败要回滚**：原来先 `set({currentPet})` 再持久化，失败时不还原 →
   *    界面上已经切成新宠物、页面数据也按新宠物重拉了，而调用方弹的却是「切换失败」，前后矛盾。
   *  · **id 不在列表里要报错**：原来 `if (pet)` 为假时静默 resolve，调用方的 catch 根本接不到，
   *    用户点了没反应（典型场景：列表过期、宠物已被删）。
   *
   * @param id - 目标宠物 ID
   * @throws 未登录 / 宠物不存在 / 持久化失败（同时写入 store.error）
   */
  switchPet: async (id) => {
    const { userId, currentPet: prevPet } = get()
    if (!userId) throw new Error('用户未登录')
    try {
      const pet = get().pets.find(p => p.id === id)
      if (!pet) {
        const notFound = new Error('宠物不存在或已删除')
        set({ error: notFound.message })
        throw notFound
      }
      set({ currentPet: pet })
      await setCurrentPet(userId, id)
    } catch (err) {
      set({
        // 回滚到切换前的宠物：失败时界面必须与"切换失败"的提示保持一致
        currentPet: prevPet,
        error: err instanceof Error ? err.message : '切换宠物失败',
      })
      throw err
    }
  },

  /** 清除错误状态 */
  clearError: () => {
    set({ error: null })
  },

  /**
   * 设置 2D 头像生成任务 ID
   * @param taskId - 任务 ID，传 null 表示清除
   */
  setAvatar2DTaskId: (taskId) => {
    set({ avatar2DTaskId: taskId })
    if (taskId) {
      Taro.setStorageSync('xhh_avatar_2d_task_id', taskId)
    } else {
      Taro.removeStorageSync('xhh_avatar_2d_task_id')
    }
  },

  /**
   * 设置 3D 头像生成任务 ID
   * @param taskId - 任务 ID，传 null 表示清除
   */
  setAvatar3DTaskId: (taskId) => {
    set({ avatar3DTaskId: taskId })
    if (taskId) {
      Taro.setStorageSync('xhh_avatar_3d_task_id', taskId)
    } else {
      Taro.removeStorageSync('xhh_avatar_3d_task_id')
    }
  },
}))

export type { PetProfile }
