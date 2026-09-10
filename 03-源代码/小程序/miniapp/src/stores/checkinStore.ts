/**
 * 打卡状态管理
 * 管理每日打卡记录、连续打卡天数和今日打卡状态
 */
import create from 'zustand'
import { api } from '../services/api'
import { localDateString, parseLocalDate } from '../utils/date'
import type { Checkin } from '../types'

/** 打卡状态定义 */
interface CheckinState {
  checkins: Checkin[]
  /**
   * 当前 `checkins` 属于哪只宠物（2026-09-11 新增）
   * 多宠场景下消费者据此判断"这份数据是不是当前宠物的"，避免拿别的宠物的记录渲染。
   */
  checkinsPetId: string | null
  todayCheckin: Checkin | null
  streakDays: number
  isLoading: boolean
  initUser: (userId: string) => Promise<void>
  fetchCheckins: (petId: string) => Promise<void>
  doCheckin: (data: Partial<Checkin>) => Promise<Checkin>
}

/**
 * 请求序号：丢弃过期响应（2026-09-11 审查 P1-1）
 *
 * 这里原先只做 `set({ checkins })`，**没有任何归属判断** —— 快速切宠物时，
 * 慢的那次响应晚到会把 store 覆盖成上一只宠物的记录。而本 store 是全局共享的：
 * 日记页直接渲染 `checkins.length`（「打卡 N 次」）、`useUserStats`（个人资料的
 * 「记录天数/打卡记录」）、`useAnxietyDetection` 都读它 ——
 * 于是会出现"日记只有 1 篇、却显示打卡 5 次"这种自我矛盾，且数字来自另一只宠物。
 *
 * 守卫放在 store 层而不是各页面：一次覆盖全部消费者，页面不必各写一遍。
 */
let fetchSeq = 0

export const useCheckinStore = create<CheckinState>((set, get) => ({
  checkins: [],
  checkinsPetId: null,
  todayCheckin: null,
  streakDays: 0,
  isLoading: false,

  /** 初始化用户（预留接口） */
  initUser: async (userId: string) => {
  },

  /**
   * 获取打卡记录并计算连续打卡天数
   * @param petId - 宠物 ID
   */
  fetchCheckins: async (petId: string) => {
    const seq = ++fetchSeq
    set({ isLoading: true })
    try {
      const checkins = await api.getCheckins(petId)
      // 过期响应：这次结果已被更新的请求取代，直接丢弃（不写 store）
      if (seq !== fetchSeq) return

      // 日期一律用**本地日历日**（2026-09-11）：原实现用 toISOString()，
      // 东八区 08:00 之前"今天"会退到前一天 → 早上打卡后显示"今天还没打卡"、连续天数也不对
      const today = parseLocalDate(new Date())!
      const todayStr = localDateString(today)!
      const todayCheckin = checkins.find(c => c.date === todayStr) || null

      let streakDays = 0
      const sorted = [...checkins].sort((a, b) => b.date.localeCompare(a.date))
      const cursor = new Date(today)
      for (let i = 0; i < sorted.length; i++) {
        const expectedStr = localDateString(cursor)!
        if (sorted[i]?.date === expectedStr) {
          streakDays++
          cursor.setDate(cursor.getDate() - 1)
        } else {
          break
        }
      }
      set({ checkins, checkinsPetId: petId, todayCheckin, streakDays, isLoading: false })
    } catch {
      if (seq !== fetchSeq) return
      set({ isLoading: false })
    }
  },

  /**
   * 执行今日打卡
   * @param data - 打卡数据
   * @returns 创建后的打卡记录
   */
  doCheckin: async (data: Partial<Checkin>) => {
    const checkin = await api.createCheckin(data)
    set(state => ({
      checkins: [checkin, ...state.checkins],
      todayCheckin: checkin,
      streakDays: state.streakDays + 1,
    }))
    return checkin
  },
}))
