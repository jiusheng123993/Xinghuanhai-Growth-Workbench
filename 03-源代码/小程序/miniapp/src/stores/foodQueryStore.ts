/**
 * 食物安全查询状态管理
 * 管理宠物食物安全性查询、查询历史、统计数据
 */
import create from 'zustand'
import type { PetFoodQuery } from '../memory-body/types/memoryBodyTypes'
import type { FoodQueryStats } from '../services/foodService'
import { queryFood, getQueryHistory, getQueryStats } from '../services/foodService'

export type { PetFoodQuery }
export type { FoodQueryStats }

/** 食物查询状态定义 */
interface FoodQueryStoreState {
  history: PetFoodQuery[]
  lastResult: PetFoodQuery | null
  stats: FoodQueryStats | null
  isLoading: boolean
  error: string | null

  queryFood: (userId: string, petId: string, foodName: string, species: 'dog' | 'cat') => Promise<PetFoodQuery>
  fetchHistory: (petId: string, userId: string) => Promise<void>
  fetchStats: (petId: string, userId: string) => Promise<void>
  clearError: () => void
}

export const useFoodQueryStore = create<FoodQueryStoreState>((set) => ({
  history: [],
  lastResult: null,
  stats: null,
  isLoading: false,
  error: null,

  /**
   * 查询食物对宠物的安全性
   * @param userId - 用户 ID
   * @param petId - 宠物 ID
   * @param foodName - 食物名称
   * @param species - 宠物物种（dog/cat）
   * @returns 查询结果
   */
  queryFood: async (userId, petId, foodName, species) => {
    set({ isLoading: true, error: null })
    try {
      const result = await queryFood(userId, petId, foodName, species)
      set((state) => ({
        lastResult: result,
        history: [result, ...state.history],
        isLoading: false
      }))
      return result
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '查询食物安全性失败'
      })
      throw err
    }
  },

  /**
   * 获取查询历史
   * @param petId - 宠物 ID
   * @param userId - 用户 ID
   */
  fetchHistory: async (petId, userId) => {
    set({ isLoading: true, error: null })
    try {
      const history = await getQueryHistory(petId, userId)
      set({ history, isLoading: false })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '获取查询历史失败'
      })
    }
  },

  /**
   * 获取查询统计数据
   * @param petId - 宠物 ID
   * @param userId - 用户 ID
   */
  fetchStats: async (petId, userId) => {
    set({ isLoading: true, error: null })
    try {
      const stats = await getQueryStats(petId, userId)
      set({ stats, isLoading: false })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '获取查询统计失败'
      })
    }
  },

  /** 清除错误状态 */
  clearError: () => {
    set({ error: null })
  }
}))
