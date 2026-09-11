/**
 * 打卡状态管理 - 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { useCheckinStore } from '../checkinStore'
import type { Checkin } from '../../types'
import type { CheckinInput } from '../../services/checkinService'
import type { PetHealthEntry } from '../../memory-body/types/memoryBodyTypes'
// 日期 fixture 必须用「本地日历日」（与实现同口径）：原来用 toISOString() 取的是 UTC 日期，
// 东八区 08:00 之前会与本地「今天」差一天，用例就成了在复述旧 bug（2026-09-11 修复）
import { localDateString } from '../../utils/date'

const { mockApi, mockCreateCheckin } = vi.hoisted(() => {
  return {
    mockApi: {
      getCheckins: vi.fn(),
      // 保留旧入口的桩：它现在是**负向哨兵** —— 若有人把 doCheckin 改回 api.createCheckin
      // （P0 的原始写法），新链路断言会立刻失败，不留"改回去也照过"的缝
      createCheckin: vi.fn(),
    },
    /** 新链路的真实调用点：checkinStore.doCheckin → checkinService.createCheckin */
    mockCreateCheckin: vi.fn(),
  }
})

// api 模块**只替 api 对象**，其余导出（deriveCheckinView）保留真实实现：
// store 的 toCheckinView 就是用 deriveCheckinView 把「落库的 level 字段」折成视图字段的，
// 若把这个函数一并 mock 掉，本文件就变成在测一个假转换，抓不到读写口径分叉的回归。
vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>()
  return { ...actual, api: mockApi }
})

// 打卡落库链路（2026-09-11 P0 收尾）：
// store 已不再调 api.createCheckin，而是统一走 checkinService.createCheckin
// （服务层负责组装后端契约的 snake_case 字段，与首页弹窗/多宠批量同一条链路）。
// 因此这里替身的是**新链路真正的调用点**；服务层内部的字段组装另有
// pagesPet/checkin/__tests__/submitContract.test.tsx 在「不打桩的真实链路 + 抓 Taro.request」上覆盖。
vi.mock('../../services/checkinService', () => ({
  createCheckin: mockCreateCheckin,
}))

function makeCheckin(overrides: Partial<Checkin> = {}): Checkin {
  return {
    id: 'checkin_001',
    petId: 'pet_001',
    userId: 'user_001',
    date: localDateString(new Date())!,
    mood: 'happy',
    appetite: 'good',
    stool: 'normal',
    weight: 30,
    note: '',
    createdAt: '2024-06-01T10:00:00.000Z',
    ...overrides,
  }
}

/**
 * doCheckin 的服务层入参（CheckinInput）
 *
 * 必填字段一个都不能少：petId / userId / 4 个等级 / hasAnomaly / anomalyItems。
 * userId 尤其关键 —— 服务层第一步就是 requirePetOwnership(petId, userId)，
 * 缺它会直接抛「[PetOwnership] userId is required」（2026-09-11 那两条红用例的死因）。
 */
function makeInput(overrides: Partial<CheckinInput> = {}): CheckinInput {
  return {
    petId: 'pet_001',
    userId: 'user_001',
    poopLevel: 3,
    appetiteLevel: 3,
    spiritLevel: 3,
    exerciseLevel: 2,
    hasAnomaly: false,
    anomalyItems: [],
    ...overrides,
  }
}

/**
 * 服务层落库结果（PetHealthEntry）
 *
 * 刻意用 **level 字段 + Date 型 createdAt**（而不是直接给一份 Checkin 视图对象）：
 * store 的职责正是把这份口径折算成页面消费的 Checkin，喂它就等于让用例真的走到那层转换上。
 */
function makeEntry(overrides: Partial<PetHealthEntry> = {}): PetHealthEntry {
  return {
    id: 'checkin_001',
    petId: 'pet_001',
    userId: 'user_001',
    poopLevel: 3,
    appetiteLevel: 3,
    spiritLevel: 3,
    exerciseLevel: 2,
    hasAnomaly: false,
    anomalyItems: [],
    riskLevel: 'low',
    createdAt: new Date(),
    ...overrides,
  }
}

describe('checkinStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCheckinStore.setState({
      checkins: [],
      // 归属标记也是状态契约的一部分：不重置的话，上一条用例留下的 petId
      // 会让「checkinsPetId 有没有被本次提交正确设置」这类断言蒙混过关
      checkinsPetId: null,
      todayCheckin: null,
      streakDays: 0,
      isLoading: false,
    })
  })

  describe('initial state', () => {
    it('should have empty checkins', () => {
      const state = useCheckinStore.getState()
      expect(state.checkins).toEqual([])
    })

    it('should have null todayCheckin', () => {
      const state = useCheckinStore.getState()
      expect(state.todayCheckin).toBeNull()
    })

    it('should have streakDays as 0', () => {
      const state = useCheckinStore.getState()
      expect(state.streakDays).toBe(0)
    })

    it('should have isLoading as false', () => {
      const state = useCheckinStore.getState()
      expect(state.isLoading).toBe(false)
    })
  })

  describe('initUser', () => {
    it('should set userId', async () => {
      await useCheckinStore.getState().initUser('user_123')
    })
  })

  describe('fetchCheckins', () => {
    it('should load checkins and set isLoading correctly', async () => {
      const mockCheckins = [makeCheckin(), makeCheckin({ id: 'checkin_002' })]
      mockApi.getCheckins.mockResolvedValue(mockCheckins)

      await useCheckinStore.getState().fetchCheckins('pet_001')

      const state = useCheckinStore.getState()
      expect(state.checkins).toHaveLength(2)
      expect(state.checkins[0].id).toBe('checkin_001')
      expect(state.checkins[1].id).toBe('checkin_002')
      expect(state.isLoading).toBe(false)
      expect(mockApi.getCheckins).toHaveBeenCalledWith('pet_001')
    })

    it('should set todayCheckin when today has a checkin', async () => {
      const today = localDateString(new Date())!
      const mockCheckins = [makeCheckin({ date: today })]
      mockApi.getCheckins.mockResolvedValue(mockCheckins)

      await useCheckinStore.getState().fetchCheckins('pet_001')

      const state = useCheckinStore.getState()
      expect(state.todayCheckin).not.toBeNull()
      expect(state.todayCheckin!.id).toBe('checkin_001')
    })

    it('should set todayCheckin to null when no today checkin', async () => {
      const mockCheckins = [makeCheckin({ date: '2020-01-01' })]
      mockApi.getCheckins.mockResolvedValue(mockCheckins)

      await useCheckinStore.getState().fetchCheckins('pet_001')

      const state = useCheckinStore.getState()
      expect(state.todayCheckin).toBeNull()
    })

    it('should set isLoading to false on failure', async () => {
      mockApi.getCheckins.mockRejectedValue(new Error('Network error'))

      await useCheckinStore.getState().fetchCheckins('pet_001')

      const state = useCheckinStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should set isLoading to true during fetch and false after', async () => {
      let resolveFetch!: (value: Checkin[]) => void
      mockApi.getCheckins.mockReturnValue(
        new Promise<Checkin[]>((resolve) => {
          resolveFetch = resolve
        })
      )

      const fetchPromise = useCheckinStore.getState().fetchCheckins('pet_001')
      expect(useCheckinStore.getState().isLoading).toBe(true)

      resolveFetch([])
      await fetchPromise

      expect(useCheckinStore.getState().isLoading).toBe(false)
    })
  })

  describe('doCheckin', () => {
    it('should add checkin to list and set todayCheckin', async () => {
      // 刻意给一组「非默认档」：5 档 → 3 档视图映射只有在这种值上才看得出真假
      const input = makeInput({ poopLevel: 5, appetiteLevel: 2, spiritLevel: 1, hasAnomaly: true, anomalyItems: ['spirit'] })
      mockCreateCheckin.mockResolvedValue(makeEntry({ poopLevel: 5, appetiteLevel: 2, spiritLevel: 1, hasAnomaly: true, anomalyItems: ['spirit'] }))

      const result = await useCheckinStore.getState().doCheckin(input)

      // ① 落库确实走了新链路，且**原样**收到服务层契约入参（userId 在内，缺它服务层会直接抛）
      expect(mockCreateCheckin).toHaveBeenCalledTimes(1)
      expect(mockCreateCheckin).toHaveBeenCalledWith(input)
      // ② 视图字段不得回灌进服务层入参 —— 这正是 P0 根因（mood/appetite/stool 被当 POST body）
      const passed = mockCreateCheckin.mock.calls[0][0]
      for (const viewField of ['mood', 'appetite', 'stool', 'date']) {
        expect(passed, `服务层入参不应包含视图字段 ${viewField}`).not.toHaveProperty(viewField)
      }

      // ③ 返回的是**页面口径的 Checkin**：视图字段由 level 派生，不是把入参原样透传
      expect(result.id).toBe('checkin_001')
      expect(result.petId).toBe('pet_001')
      expect(result.userId).toBe('user_001')
      expect(result.date).toBe(localDateString(new Date())!)
      expect(result.mood).toBe('sad')      // spiritLevel 1 ≤2
      expect(result.appetite).toBe('poor') // appetiteLevel 2 ≤2
      expect(result.stool).toBe('hard')    // poopLevel 5 ≥4

      const state = useCheckinStore.getState()
      expect(state.checkins).toHaveLength(1)
      expect(state.checkins[0]).toEqual(result)
      expect(state.checkinsPetId).toBe('pet_001')
      expect(state.todayCheckin).not.toBeNull()
      expect(state.todayCheckin!.id).toBe('checkin_001')
      expect(state.streakDays).toBe(1)
    })

    it('should prepend new checkin to existing checkins', async () => {
      useCheckinStore.setState({
        checkins: [makeCheckin()],
        streakDays: 1,
      })
      mockCreateCheckin.mockResolvedValue(makeEntry({ id: 'checkin_002' }))

      await useCheckinStore.getState().doCheckin(makeInput())

      const state = useCheckinStore.getState()
      expect(state.checkins).toHaveLength(2)
      // 新的在最前，且老记录仍在（是 prepend，不是覆盖整份列表）
      expect(state.checkins[0].id).toBe('checkin_002')
      expect(state.checkins[1].id).toBe('checkin_001')
      expect(state.streakDays).toBe(2)
    })

    it('服务层落库失败时不得写状态（不能把失败装成成功）', async () => {
      // 服务层自身在云端写失败时会落本地兜底、只有归属校验这类硬错误才会抛；
      // 一旦抛出，页面靠 catch 弹「打卡失败，请重试」，所以 store 必须保持原样
      mockCreateCheckin.mockRejectedValue(new Error('[PetOwnership] 无权访问该宠物数据'))

      await expect(useCheckinStore.getState().doCheckin(makeInput())).rejects.toThrow('无权访问')

      const state = useCheckinStore.getState()
      expect(state.checkins).toEqual([])
      expect(state.todayCheckin).toBeNull()
      expect(state.streakDays).toBe(0)
      expect(state.checkinsPetId).toBeNull()
    })
  })
})
