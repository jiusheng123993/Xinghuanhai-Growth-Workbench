/**
 * 打卡状态管理
 * 管理每日打卡记录、连续打卡天数和今日打卡状态
 */
import create from 'zustand'
import { api, normalizeCheckin } from '../services/api'
import { createCheckin, type CheckinInput } from '../services/checkinService'
import { localDateString, parseLocalDate } from '../utils/date'
import type { Checkin } from '../types'
import type { PetHealthEntry } from '../memory-body/types/memoryBodyTypes'

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
  /**
   * 提交今日打卡
   *
   * 入参是**服务层契约** CheckinInput（后端要的 snake_case 字段由 checkinService 自行组装）。
   * 2026-09-11 P0 修复：旧签名是 `Partial<Checkin>`，调用方会把视图字段
   * mood/appetite/stool 原样当 POST body 发出去，而服务端 createCheckinSchema 必填的是
   * poop_level/appetite_level/spirit_level/exercise_level/risk_level → 恒定 400/code 100001
   * → 用户看到「打卡失败，请重试」。类型收紧后，传错字段名在 `tsc --noEmit` 阶段就会暴露。
   */
  doCheckin: (data: CheckinInput) => Promise<Checkin>
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

/**
 * PetHealthEntry（服务层/记忆引擎口径）→ Checkin（页面消费口径）
 *
 * 【为什么必须复用读路径的归一化函数，而不是自己拼一份字段清单】
 * 打卡有两条写路径（本 store 的乐观写入、checkinService 落库回包）与一条读路径
 * （fetchCheckins → api.getCheckins → api.normalizeCheckin）。2026-09-11 审查 P1-1 实测：
 * 本函数原先是**白名单构造**（只回 10 个 Checkin 契约字段），而 normalizeCheckin 是
 * `{...raw, ...}`，会把服务端回包的原始字段一并保留 —— 两者字段差集有 8 个：
 *   poopLevel / appetiteLevel / spiritLevel / exerciseLevel /
 *   hasAnomaly / anomalyItems / aiFeedback / riskLevel
 * 这不只是"看起来不同"：原日记页把 store 里的 checkins 原样当 PetHealthEntry 喂给
 * diaryEngine（当年的日记页只能 `as any`），后者读 `entry.hasAnomaly` /
 * `entry.anomalyItems` 决定走不走异常文案；该页自己那次 fetchCheckins 失败时
 * （离线 / 401，store 的 catch 只关 loading、不动 checkins），用户刚提交的异常打卡
 * 会被渲染成"一切正常"的日记。
 * 【2026-09-12 IA 第 2c 批】日记视图已并入 pages/timeline，且改吃 checkinService 的
 * PetHealthEntry（不再经过本 store），那条坑对日记已经消失；本 store 仍被首页/个人资料等
 * 页面消费，下面这层修复照旧必要。
 *
 * 复用 normalizeCheckin 之后，"刚提交写进 store 的记录"与"刷新后读回的记录"由
 * **同一段代码**产出，字段集不可能再分叉；将来服务端回包加字段也自动两条路径同步。
 *
 * @param entry - 服务层落库结果（可能是云端回包，也可能是离线兜底的本地记录）
 */
function toCheckinView(entry: PetHealthEntry): Checkin {
  // 离线兜底记录的 createdAt 是 **Date 对象**，而服务端回包是 ISO 串：
  // normalizeCheckin 按字符串口径处理（String(Date) 会得到本地化长串、不是 ISO），
  // 故先折算成 ISO 再交给它，否则同一条记录在离线路径上的 createdAt 会与读路径不同形。
  // 日期（Checkin.date）同理由 normalizeCheckin 内部取**本地日历日**：
  // 直接 slice(0, 10) 取的是 UTC 日期，东八区 00:00–08:00 会退到前一天。
  const createdAt = entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt
  return normalizeCheckin({ ...entry, createdAt })
}

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
   *
   * 落库统一交给 checkinService（与首页打卡弹窗、多宠一键打卡**同一条链路**）：
   * 由服务层生成后端契约字段（snake_case + risk_level + aiFeedback），并在云端写失败时
   * 落本地兜底 + 入同步队列。本 store 只负责把结果写进状态，供页面立即渲染。
   *
   * @param data - 服务层打卡入参（CheckinInput）
   * @returns 创建后的打卡记录
   */
  doCheckin: async (data: CheckinInput) => {
    // 修复前这里是 `api.createCheckin(data)`：请求体字段名不合法（历史 P0），
    // 且与弹窗/批量的实现长期两套分叉——现在统一收敛到 checkinService。
    const entry = await createCheckin(data)
    const checkin = toCheckinView(entry)
    set(state => ({
      checkins: [checkin, ...state.checkins],
      // 这份数据归属哪只宠物：多宠切换时消费者据此判断是不是当前宠物的记录
      checkinsPetId: data.petId,
      todayCheckin: checkin,
      streakDays: state.streakDays + 1,
    }))
    return checkin
  },
}))
