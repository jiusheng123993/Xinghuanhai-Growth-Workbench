/**
 * 时光页刷新回归测试
 *
 * 2026-09-11 事故背景（生产实测）：
 *   用户在 AI 页记完一条回忆（04:11:04 POST /api/timeline/moments 返回 200），
 *   再点「时光」tab 却看不到这条新记录——04:11 之后到 04:15 该用户没有任何
 *   GET /api/timeline/moments 请求。
 *   根因：「时光」是 tabBar 页面，微信小程序切走再切回**不会重新挂载页面实例**，
 *   只在 useEffect 里加载数据的页面就永远停在切走前的快照。
 *   修复：抽出 loadTimelineData + useDidShow（首次 show 与 useEffect 重叠，用 ref 跳过）。
 *
 * 2026-09-11 第二轮（本文件下半部分整体改写）：用户否掉了"按当前宠物分类"的时光页 ——
 *   "时光页面 所有宠物应该共用一个回忆录吧 你怎么做分类了？？"
 *   → 顶部宠物切换条移除；回忆不传 petId（账号下全部宠物共用一本）；
 *     打卡里程碑逐只生成后合并、事件带宠物归属；速览数字改全宠口径。
 *   原来的 4 条用例锁的正是被否掉的旧契约（"查询参数带宠物 id""切宠物后整页换数据"），
 *   已按新契约重写，避免测试把旧行为焊死。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import TimelinePage from '../index'
import { usePetStore } from '../../../stores/petStore'
import type { PetMoment } from '../../../types/familyTypes'

const {
  mockGetMoments,
  mockGetCheckins,
  mockAddMoment,
  showCallbacks,
  shareAppCallbacks,
  mockGenerateDiary,
  mockTrackEvent,
  mockPet,
  mockPet2,
} = vi.hoisted(() => ({
  mockGetMoments: vi.fn(),
  mockGetCheckins: vi.fn(),
  mockAddMoment: vi.fn(),
  // 收集页面注册的 onShow 回调，测试里手动触发模拟「切走再切回」
  showCallbacks: [] as Array<() => void>,
  /**
   * 收集页面注册的 useShareAppMessage 回调（2026-09-12 IA 第 2c 批新增）
   *
   * 为什么要测它：本页承接了被删的「宠物日记」页的分享出口，
   * 分享 path 必须指回本页 —— 否则用户点开分享卡片就是死链。
   */
  shareAppCallbacks: [] as Array<() => { title: string; path?: string }>,
  /** 日记正文生成器（默认实现＝真 diaryService，见下方 mock 工厂） */
  mockGenerateDiary: vi.fn(),
  /** 埋点：日记卡分享沿用原 diary 页的 share_diary 事件 */
  mockTrackEvent: vi.fn(),
  mockPet: {
    id: 'pet_1',
    name: '可乐',
    species: 'cat' as const,
    breed: '中华田园猫',
    birthDate: '2026-07-01',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  },
  // 第二只宠物：验证"所有宠物共用一条时间线"（卡片带宠物标签、里程碑合并）
  mockPet2: {
    id: 'pet_2',
    name: '布丁',
    species: 'dog' as const,
    breed: '柯基',
    birthDate: '2025-01-01',
    createdAt: '2025-01-01T10:00:00.000Z',
    updatedAt: '2025-01-01T10:00:00.000Z',
  },
}))

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, onClick }: any) => createElement('div', { className, onClick }, children),
  Text: ({ children, className }: any) => createElement('span', { className }, children),
  ScrollView: ({ children, className }: any) => createElement('div', { className }, children),
  Image: ({ src, className }: any) => createElement('img', { src, className }),
  // onInput 必须转发（新增回忆弹窗靠它写正文），否则"选宠物后保存"这条链路测不了
  Textarea: ({ value, className, onInput }: any) =>
    createElement('textarea', {
      value,
      className,
      onInput: (e: any) => onInput?.({ detail: { value: e.target.value } }),
    }),
  Picker: ({ children }: any) => createElement('div', null, children),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    showToast: vi.fn(),
    showModal: vi.fn(),
    previewImage: vi.fn(),
    navigateTo: vi.fn(),
    switchTab: vi.fn(),
    getEnv: vi.fn(() => 'WEAPP'),
    getStorageSync: vi.fn(() => null),
    // 必须补上：petStore.switchPet → petService.setCurrentPet → utils/storage.setStorage
    // 会同步调它，缺了就在这里抛 TypeError，让"切换宠物"这条链路看起来通过、
    // 实际是页面 .catch 把异常吞了（2026-09-11 审查 P3 测试保真度）。
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    // 日记卡的「分享这篇日记」会调它（Taro.showShareMenu）
    showShareMenu: vi.fn(),
  },
  // 注册即收集：页面注册的 onShow 回调由测试显式触发。
  // 只保留最后一次注册的回调——Taro 真实的 useDidShow 把回调存进 ref，每次渲染只更新不叠加，
  // 若这里按渲染次数 push，一次 onShow 会被触发多次，测出假的"重复请求"。
  useDidShow: (cb: () => void) => {
    showCallbacks.length = 0
    showCallbacks.push(cb)
  },
  // 2026-09-12 IA 第 2c 批：本页开始注册分享（承接被删的 diary 页）→ mock 必须收下回调
  useShareAppMessage: (cb: () => { title: string; path?: string }) => {
    shareAppCallbacks.length = 0
    shareAppCallbacks.push(cb)
  },
  useShareTimeline: () => {},
  showToast: vi.fn(),
  switchTab: vi.fn(),
}))

vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => 'theme-sakura-dream',
  useThemeKey: () => 'autumn',
  usePetWallpaper: () => null,
}))

vi.mock('../../../services/checkinService', () => ({
  getCheckins: (...args: unknown[]) => mockGetCheckins(...args),
}))

vi.mock('../../../services/timelineService', () => ({
  timelineService: {
    getMoments: (...args: unknown[]) => mockGetMoments(...args),
    deleteMoment: vi.fn(),
    addMoment: (...args: unknown[]) => mockAddMoment(...args),
  },
}))

vi.mock('../../../services/api', () => ({
  resolveAvatarUrl: (u: string) => u || '',
}))

/** 埋点：本页只用到 trackEvent（日记卡分享），不去碰 analyticsService 的本地队列 */
vi.mock('../../../hooks/useAnalytics', () => ({
  useAnalytics: () => ({ trackPageView: vi.fn(), trackEvent: mockTrackEvent }),
  usePageView: () => {},
}))

/**
 * 日记服务：默认实现**委托真实现**（importOriginal）
 *
 * 这样既能断言「喂进去的正是 checkinService 那批 entries」（数据源统一的关键证据），
 * 又不会把 diaryEngine 换掉 —— 日记正文仍是它真算出来的，
 * 顺带证明 2026-09-12 并入后 diaryEngine 没有被孤儿化。
 */
vi.mock('../../../services/diaryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/diaryService')>()
  mockGenerateDiary.mockImplementation((...args: unknown[]) =>
    (actual.generateDiaryFromEntries as (...a: unknown[]) => unknown)(...args),
  )
  return {
    ...actual,
    generateDiaryFromEntries: (...args: unknown[]) => mockGenerateDiary(...args),
  }
})

/** 构造一条 pet_moments 回忆（字段对齐后端返回） */
function makeMoment(description: string, pet: { id: string; name: string } = mockPet): PetMoment {
  return {
    id: `moment_${pet.id}_${description.length}`,
    userId: 'user_1',
    petId: pet.id,
    type: 'memory',
    content: { petName: pet.name, petEmoji: pet.id === mockPet.id ? '🐱' : '🐕', description } as PetMoment['content'],
    photos: [],
    createdAt: '2026-09-11T04:11:04.000Z',
    happenedAt: '2026-09-11',
  }
}

/** 触发一次「页面 onShow」（首次进入与切回都是它） */
async function fireShow() {
  await act(async () => {
    showCallbacks.forEach((cb) => cb())
  })
}

describe('时光页 - 切回本页刷新', () => {
  beforeEach(() => {
    showCallbacks.length = 0
    vi.clearAllMocks()
    mockGetCheckins.mockResolvedValue([])
    mockGetMoments.mockResolvedValue([])
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet] as any, userId: 'user_1' })
  })

  it('首次进入：useEffect 拉一次，首次 onShow 不重复请求', async () => {
    render(createElement(TimelinePage))

    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    await fireShow()
    expect(mockGetMoments).toHaveBeenCalledTimes(1)
  })

  it('切走再切回（第二次 onShow）：重新拉取并展示新记录的文案', async () => {
    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    // 首次 show（进入页面那次）与 useEffect 重叠 → 跳过，不重复请求
    await fireShow()
    expect(mockGetMoments).toHaveBeenCalledTimes(1)

    // 模拟：用户在 AI 页记了一条回忆后切回「时光」→ 第二次 show 必须重新拉取
    mockGetMoments.mockResolvedValue([makeMoment('今天可乐追逗猫棒玩疯了')])
    await fireShow()

    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('今天可乐追逗猫棒玩疯了')).toBeTruthy())
  })

  it('回忆按账号全量拉取：不传宠物 id（传了就又变成"按宠物分类"）', async () => {
    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    // 关键断言：无参调用 ⇒ 后端返回本账号下**所有宠物**的回忆
    expect(mockGetMoments).toHaveBeenCalledWith()
  })

  /**
   * 2026-09-11 审查 P2-1 回归：刷新失败不得把已经显示出来的回忆清空。
   * 修复前 catch 分支无条件 setMomentEvents([])，而本函数现在每次切回都会跑，
   * 一次网络抖动就会让用户看到"还没有时光记录"（数据其实在库里）——比"看不到新记录"更糟。
   */
  it('刷新失败：保留已显示的回忆，不清空列表', async () => {
    mockGetMoments.mockResolvedValue([makeMoment('今天可乐追逗猫棒玩疯了')])
    render(createElement(TimelinePage))
    await waitFor(() => expect(screen.getByText('今天可乐追逗猫棒玩疯了')).toBeTruthy())

    // 切回本页时接口挂了
    mockGetMoments.mockRejectedValue(new Error('request:fail'))
    await fireShow() // 首次 show：跳过
    await fireShow() // 切回：刷新 → 失败

    expect(screen.getByText('今天可乐追逗猫棒玩疯了')).toBeTruthy()
  })

  /**
   * 2026-09-11 审查 P2-2 回归：刷新不得重置「已添加到时光线」。
   * 修复前 loadTimelineData 里无条件 setFlashbackAdded(false)，被 useDidShow 复用后，
   * 用户刚点完「添加到时光线」再切一次 tab，条目消失、横幅也已关闭 → 本页再也点不出这个入口。
   */
  it('切回刷新后：已添加到时光线的旧时光条目仍在', async () => {
    // 出生日期的月日设为今天 → 触发"旧时光提醒"（N 年前的今天来到这个世界）
    const today = new Date()
    const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const petToday = { ...mockPet, birthDate: `2020-${mmdd}` }
    usePetStore.setState({ currentPet: petToday as any, pets: [petToday] as any, userId: 'user_1' })

    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    // 点「添加到时光线」→ 条目进入时光线
    fireEvent.click(await screen.findByText('添加到时光线'))
    await waitFor(() => expect(screen.getByText(/年前的今天/)).toBeTruthy())

    // 切走再切回（第二次 show 才刷新）
    await fireShow()
    await fireShow()
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(2))

    // 关键：刷新后该条目仍在（修复前会被 setFlashbackAdded(false) 抹掉）
    expect(screen.getByText(/年前的今天/)).toBeTruthy()
  })
})

/**
 * 共用回忆录（2026-09-11 第二轮改写）
 *
 * 用户要求："时光页面 所有宠物应该共用一个回忆录" —— 本页不再按宠物分类：
 *   · 顶部宠物切换条移除；
 *   · 回忆一次性拉全账号（不传 petId），打卡里程碑逐只生成后合并成一条时间线；
 *   · 每条卡片带宠物标签（谁的回忆）；
 *   · 速览第一格从「相伴天数」换成「毛孩子 N 只」纯计数（用户 2026-09-11 拍板）。
 */
describe('时光页 - 所有宠物共用一本回忆录', () => {
  beforeEach(() => {
    showCallbacks.length = 0
    vi.clearAllMocks()
    mockGetCheckins.mockResolvedValue([])
    mockGetMoments.mockResolvedValue([])
    mockAddMoment.mockImplementation(async (m: any) => ({ ...m, id: 'moment_saved', createdAt: '2026-09-11T05:00:00.000Z' }))
  })

  it('不再渲染宠物切换条（那正是用户说的"分类"）', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    expect(container.querySelector('.pet-switcher')).toBeNull()
    // 且本页不会再自行改动"当前宠物"
    expect(usePetStore.getState().currentPet?.id).toBe(mockPet.id)
  })

  it('两只宠物的回忆混在同一条时间线里，每张卡带宠物标签', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })
    mockGetMoments.mockResolvedValue([
      makeMoment('可乐今天拆了快递箱', mockPet),
      makeMoment('布丁第一次学会握手', mockPet2),
    ])

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(screen.getByText('可乐今天拆了快递箱')).toBeTruthy())
    // 布丁的回忆同样出现在这条线上（改前会被"按当前宠物过滤"挡掉）
    expect(screen.getByText('布丁第一次学会握手')).toBeTruthy()

    // 宠物标签把归属写在卡片上
    const tagTexts = Array.from(container.querySelectorAll('.timeline-pet-tag-text')).map((el) => el.textContent || '')
    expect(tagTexts.some((t) => t.includes('可乐'))).toBe(true)
    expect(tagTexts.some((t) => t.includes('布丁'))).toBe(true)
  })

  it('打卡里程碑按每只宠物各拉一次并合并（事件 id 不撞、条数相加）', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })
    mockGetCheckins.mockResolvedValue([{ id: 'c1', riskLevel: 'normal', createdAt: '2026-09-10T02:00:00.000Z', note: '今天很精神' }])
    // React 对重复 key 只告警、仍照常渲染两条 —— 不监听 console.error 的话，
    // 把 tagPetEvents 的 `${pet.id}-` 前缀删掉（真会撞 key）测试也不会变红（审查 P2-1）
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const { container } = render(createElement(TimelinePage))
      await waitFor(() => expect(mockGetCheckins).toHaveBeenCalledTimes(2))
      // 两只宠物各自拉了打卡记录
      expect(mockGetCheckins).toHaveBeenCalledWith(mockPet.id, 'user_1')
      expect(mockGetCheckins).toHaveBeenCalledWith(mockPet2.id, 'user_1')

      // 每只各产出 2 条：生日 + 这条打卡动态（两只宠物的 createdAt 与生日同一天，
      // 所以 generateTimelineFromData 不会产出「加入家庭的第1天」）→ 合计 4 条，精确断言
      // 注意选择器要限定在「时光足迹」那段（.timeline-list）里：2026-09-12 并入的日记分区
      // 复用了同一个 .timeline-card 类名，不限定的话这条断言会把日记卡也算进来
      await waitFor(() => expect(container.querySelectorAll('.timeline-list .timeline-card').length).toBe(4))

      const titles = Array.from(container.querySelectorAll('.timeline-card-title')).map((el) => el.textContent || '')
      expect(titles.filter((t) => t.includes('可乐')).length).toBeGreaterThan(0)
      expect(titles.filter((t) => t.includes('布丁')).length).toBeGreaterThan(0)

      // 重复 key 哨兵：合并两支列表时 id 必须带宠物前缀
      const errorText = errorSpy.mock.calls.flat().map((v) => String(v)).join(' ')
      expect(errorText).not.toMatch(/same key/i)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('速览换成不带歧义的纯计数：毛孩子 N 只（不再有「相伴天数」「出生天数」）', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })

    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    // 2026-09-11 用户拍板："把相伴天数删掉 换成其他的" → 第一格改为「毛孩子 N 只」
    expect(screen.getByText('毛孩子')).toBeTruthy()
    // 用 class 精确定位速览区的数字（页面上还有别的 "2"，按文本查会撞）
    const values = Array.from(document.querySelectorAll('.timeline-overview-value')).map((el) => el.textContent)
    expect(values[0]).toBe('2')
    expect(screen.queryByText('相伴天数')).toBeNull()
    expect(screen.queryByText('出生天数')).toBeNull()
  })

  it('多选：连点两只宠物 → petIds 同时带上两只，petId 用第一只（主宠物）', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })

    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('添加时光记录'))
    await waitFor(() => expect(screen.getByText('新增回忆 ✦')).toBeTruthy())

    // 第一次点「布丁」＝把默认的「可乐」换成它（单选手感）；再点「可乐」＝变成多选
    fireEvent.click(screen.getByText('布丁'))
    fireEvent.click(screen.getByText('可乐'))
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '两只一起晒太阳' } })
    fireEvent.click(screen.getByText('💾 保存回忆'))

    await waitFor(() => expect(mockAddMoment).toHaveBeenCalledTimes(1))
    const payload = mockAddMoment.mock.calls[0][0] as { petId: string; petIds?: string[] }
    expect(payload.petIds).toEqual([mockPet2.id, mockPet.id])
    expect(payload.petId).toBe(mockPet2.id)
  })

  it('多选至少保留一只：把唯一选中的那只再点一次，不会变全不选', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })

    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('添加时光记录'))
    await waitFor(() => expect(screen.getByText('新增回忆 ✦')).toBeTruthy())

    // 默认选中当前宠物（可乐）；先点「布丁」换成它，再点「布丁」取消 → 应保持选中（不能全不选）
    fireEvent.click(screen.getByText('布丁'))
    fireEvent.click(screen.getByText('布丁'))
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '随便写点' } })
    fireEvent.click(screen.getByText('💾 保存回忆'))

    await waitFor(() => expect(mockAddMoment).toHaveBeenCalledTimes(1))
    const payload = mockAddMoment.mock.calls[0][0] as { petId: string; petIds?: string[] }
    expect(payload.petIds).toEqual([mockPet2.id])
  })

  it('弹窗开着时宠物列表变了（宠物被删/新增）→ 自动关弹窗清草稿，不会写出错归属', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })

    const { rerender } = render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('添加时光记录'))
    await waitFor(() => expect(screen.getByText('新增回忆 ✦')).toBeTruthy())
    fireEvent.click(screen.getByText('布丁'))
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '布丁今天拆家' } })

    // 模拟"布丁在别的页面被删了"：列表里只剩可乐（petsKey 变化 → 本页的 effect 会关弹窗并清草稿）
    await act(async () => {
      usePetStore.setState({ pets: [mockPet] as any })
    })
    rerender(createElement(TimelinePage))

    // 弹窗被关掉（用户不会在"归属已失效"的状态下提交），且一条都没写
    await waitFor(() => expect(screen.queryByText('新增回忆 ✦')).toBeNull())
    expect(mockAddMoment).not.toHaveBeenCalled()
  })

  it('正文里提到谁就自动记给谁（不手动选也不用手动改）', async () => {
    // 当前选中是可乐，但正文写的是布丁 → 应记到布丁名下
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })

    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('添加时光记录'))
    await waitFor(() => expect(screen.getByText('新增回忆 ✦')).toBeTruthy())
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '布丁今天学会了握手' } })
    fireEvent.click(screen.getByText('💾 保存回忆'))

    await waitFor(() => expect(mockAddMoment).toHaveBeenCalledTimes(1))
    const payload = mockAddMoment.mock.calls[0][0] as { petId: string; petIds?: string[] }
    expect(payload.petIds).toEqual([mockPet2.id])
    expect(payload.petId).toBe(mockPet2.id)
  })

  it('回忆接口挂了也不影响里程碑：生日/建档仍按每只宠物显示（两条链路各自兜错）', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })
    mockGetMoments.mockRejectedValue(new Error('request:fail'))

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetCheckins).toHaveBeenCalledTimes(2))

    // 回忆拿不到，但两只宠物的里程碑照样合并展示（改前会整体降级成"只有当前宠物"）。
    // 条数说明：两只宠物的建档日都与生日同一天 → generateTimelineFromData 各只产出 1 条（生日），
    // 所以这里断言"两只宠物都在列表里"，而不是断言条数（条数由生成规则决定，不是本用例要锁的东西）。
    await waitFor(() =>
      expect(container.querySelectorAll('.timeline-list .timeline-card').length).toBeGreaterThanOrEqual(2),
    )
    const tagTexts = Array.from(container.querySelectorAll('.timeline-pet-tag-text')).map((el) => el.textContent || '')
    expect(tagTexts.some((t) => t.includes('可乐'))).toBe(true)
    expect(tagTexts.some((t) => t.includes('布丁'))).toBe(true)
  })

  it('卡片日期必须是纯日期（YYYY-MM-DD），不能把 createdAt 的整串 ISO 显示出来', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet] as any, userId: 'user_1' })

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(container.querySelectorAll('.timeline-date-text').length).toBeGreaterThan(0))

    const dates = Array.from(container.querySelectorAll('.timeline-date-text')).map((el) => el.textContent || '')
    // 回归锁：曾把 `date: createdAt` 直接塞进事件，卡片上显示成「2024-08-20T02:00:00.000Z」
    expect(dates.every((d) => !d.includes('T') && !d.includes('Z'))).toBe(true)
    expect(dates.some((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true)
  })

  it('新增回忆：弹窗里能选归属宠物，保存时写到选中的那只名下（默认当前宠物）', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })

    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    // 从列表底部入口打开弹窗（PageHero 的「记录」是同一个 handler）
    fireEvent.click(screen.getByText('添加时光记录'))
    await waitFor(() => expect(screen.getByText('新增回忆 ✦')).toBeTruthy())

    // 选"布丁"作为归属
    fireEvent.click(screen.getByText('布丁'))

    // 写正文 → 保存
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '布丁今天学会了握手' } })
    fireEvent.click(screen.getByText('💾 保存回忆'))

    await waitFor(() => expect(mockAddMoment).toHaveBeenCalledTimes(1))
    const payload = mockAddMoment.mock.calls[0][0] as { petId: string; content: { petName: string } }
    expect(payload.petId).toBe(mockPet2.id)
    expect(payload.content.petName).toBe('布丁')
  })
})

// 【已删除】localDaysSince 辅助函数：它原本用来独立复算"相伴天数"，
// 而 2026-09-11 用户拍板把「相伴天数」整格撤掉（换成「毛孩子 N 只」纯计数），该辅助函数随之无用。

/**
 * 宠物日记并入时光线（2026-09-12 IA 第 2c 批）
 *
 * 背景：原「宠物日记」页是独立分包页，数据源是 useCheckinStore（单宠 + 视图态 Checkin），
 * 而本页是 checkinService + timelineService 双源、全宠共用一本。合并时选择「日记跟本页的
 * 数据源走」，下面这组用例锁的就是这个决定：同一次拉取的同一批 entries → 既出里程碑也出日记。
 *
 * 另：原日记页的 4 条用例随页面删除（3 条是「相伴天数口径」，那个统计格 2026-09-11 已被用户
 * 要求整格撤掉、并入时没有迁过来；1 条是页面各自的加载竞态，并入后日记不再有自己的 loader，
 * 该场景在本页结构上已不存在，竞态由本文件上半部分的时间线刷新用例覆盖）。
 */
describe('时光页 - 宠物日记分区（原 diary 页并入）', () => {
  /** 构造一条打卡记录（字段对齐 checkinService 返回的 PetHealthEntry） */
  function makeEntry(id: string, createdAt: string, note?: string) {
    return {
      id,
      petId: mockPet.id,
      userId: 'user_1',
      poopLevel: 'normal',
      appetiteLevel: 'normal',
      spiritLevel: 'normal',
      exerciseLevel: 'normal',
      hasAnomaly: false,
      anomalyItems: [],
      riskLevel: 'normal',
      note,
      createdAt,
    }
  }

  beforeEach(async () => {
    showCallbacks.length = 0
    shareAppCallbacks.length = 0
    vi.clearAllMocks()
    mockGetMoments.mockResolvedValue([])
    mockGetCheckins.mockResolvedValue([])
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet] as any, userId: 'user_1' })
    // 每个用例都从「真 diaryService」起跑：个别用例会临时换成固定数据，不能污染别的用例
    const actual = await vi.importActual<typeof import('../../../services/diaryService')>(
      '../../../services/diaryService',
    )
    mockGenerateDiary.mockReset()
    mockGenerateDiary.mockImplementation((...args: unknown[]) =>
      (actual.generateDiaryFromEntries as (...a: unknown[]) => unknown)(...args),
    )
  })

  it('打卡记录会在时光线上生成日记正文（来自 diaryEngine），卡片带心情角标与宠物标签', async () => {
    mockGetCheckins.mockResolvedValue([makeEntry('c1', '2026-09-10T02:00:00.000Z', '今天去公园了')])

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(container.querySelectorAll('.timeline-diary .timeline-card').length).toBe(1))

    // 正文非空，且不是打卡备注的复读 → 证明走的是 diaryEngine 的模板文案
    const text = container.querySelector('.timeline-diary-text')?.textContent || ''
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toBe('今天去公园了')
    // 心情角标（6 档筛选的取值来源）
    expect(container.querySelector('.timeline-diary-mood-text')?.textContent || '').toMatch(/开心|平静|疲惫|不舒服|骄傲/)
    // 宠物归属标签：本页全宠共用一本，卡片必须能看出这日记是谁的
    expect(container.querySelector('.timeline-diary .timeline-pet-tag-text')?.textContent || '').toContain('可乐')
    // 原 diary 页的「📝 备注」照旧显示
    expect(container.querySelector('.timeline-diary-note-text')?.textContent).toBe('今天去公园了')
    // 区块计数与实际条数一致
    expect(screen.getByText(/共 1 篇/)).toBeTruthy()
  })

  it('数据源统一：日记吃的是 checkinService 那批 entries（不再读 useCheckinStore）', async () => {
    const entries = [makeEntry('c1', '2026-09-10T02:00:00.000Z')]
    mockGetCheckins.mockResolvedValue(entries)

    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetCheckins).toHaveBeenCalledWith(mockPet.id, 'user_1'))
    await waitFor(() => expect(mockGenerateDiary).toHaveBeenCalledTimes(1))

    // 同一个数组引用 ⇒ 与打卡里程碑同一次请求的结果，同屏不可能出现两套打卡口径
    expect(mockGenerateDiary.mock.calls[0][0]).toBe(entries)
    // 第二个参数是该宠物的出生日期（diaryEngine 靠它判断「今天是不是生日」）
    expect(mockGenerateDiary.mock.calls[0][1]).toBe(mockPet.birthDate)
  })

  it('多宠共用一本：每只宠物各自的打卡生成各自的日记，靠归属标签区分', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })
    const entriesA = [makeEntry('c1', '2026-09-10T02:00:00.000Z')]
    const entriesB = [{ ...makeEntry('c2', '2026-09-11T02:00:00.000Z'), petId: mockPet2.id }]
    mockGetCheckins.mockImplementation(async (petId: string) =>
      petId === mockPet.id ? entriesA : entriesB,
    )

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(container.querySelectorAll('.timeline-diary .timeline-card').length).toBe(2))

    const tagTexts = Array.from(container.querySelectorAll('.timeline-diary .timeline-pet-tag-text')).map(
      (el) => el.textContent || '',
    )
    expect(tagTexts.some((t) => t.includes('可乐'))).toBe(true)
    expect(tagTexts.some((t) => t.includes('布丁'))).toBe(true)
    expect(mockGenerateDiary).toHaveBeenCalledTimes(2)
  })

  it('6 档心情筛选：点「开心」只剩开心日记，点「全部」恢复；不影响时光足迹', async () => {
    // 心情由 diaryEngine 按 seed 决定 → 这里用固定数据，避免测试依赖 hash 细节
    mockGetCheckins.mockResolvedValue([
      makeEntry('c1', '2026-09-10T02:00:00.000Z'),
      makeEntry('c2', '2026-09-11T02:00:00.000Z'),
    ])
    mockGenerateDiary.mockImplementation(() => [
      {
        date: '2026-09-10',
        diary: { text: '今天便便很正常，我很舒服~', tone: 'happy', emoji: '💩' },
        entry: makeEntry('c1', '2026-09-10T02:00:00.000Z'),
      },
      {
        date: '2026-09-11',
        diary: { text: '今天肚子不太舒服，主人要留意哦...', tone: 'sick', emoji: '🤒' },
        entry: makeEntry('c2', '2026-09-11T02:00:00.000Z'),
      },
    ])

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(container.querySelectorAll('.timeline-diary .timeline-card').length).toBe(2))
    expect(screen.getByText(/共 2 篇/)).toBeTruthy()

    // 6 档胶囊都在（全部 + 5 种心情）
    const chips = Array.from(
      container.querySelectorAll('.timeline-diary-filter-list .timeline-pet-chip-text'),
    ).map((el) => el.textContent)
    expect(chips).toEqual(['全部', '开心', '平静', '疲惫', '不舒服', '骄傲'])

    fireEvent.click(screen.getByText('开心'))
    await waitFor(() => expect(container.querySelectorAll('.timeline-diary .timeline-card').length).toBe(1))
    expect(screen.getByText('今天便便很正常，我很舒服~')).toBeTruthy()
    expect(screen.queryByText('今天肚子不太舒服，主人要留意哦...')).toBeNull()
    // 关键：筛选只作用在日记分区，上面的时光足迹照旧（时间线卡片还在 .timeline-list 里）
    expect(container.querySelectorAll('.timeline-list .timeline-card').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('全部'))
    await waitFor(() => expect(container.querySelectorAll('.timeline-diary .timeline-card').length).toBe(2))
  })

  it('没有打卡时只提示不报错；分享 path 已从被删的 diary 路由改指本页', async () => {
    mockGetCheckins.mockResolvedValue([])

    render(createElement(TimelinePage))
    await waitFor(() => expect(screen.getByText('还没有日记哦~')).toBeTruthy())
    expect(screen.getByText('每天打卡后会自动生成一篇日记')).toBeTruthy()

    // 分享出口：原日记页硬编码的分享 path 已随页面一起删除，
    // 必须改指本页，否则分享卡片全是死链（微信分享 path 无法重定向）
    expect(shareAppCallbacks.length).toBe(1)
    const shareConfig = shareAppCallbacks[0]()
    expect(shareConfig.path).toBe('/pages/timeline/index')
  })
})
