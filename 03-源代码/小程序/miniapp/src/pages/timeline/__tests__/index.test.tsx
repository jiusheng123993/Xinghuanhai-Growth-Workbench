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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  authState,
  mockRedirectToLogin,
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
  /**
   * 认证态：本文件下面「登录守卫」用例组用它切换登录态（不改真 authStore）
   *
   * 【为什么用可变对象、而不是真 store 的 setState】与 pages/creative 的用例同款写法：
   * authStore 被 vi.mock 成「把 selector 套在这个对象上」，测试里改几个字段就能切登录态，
   * 既不用把真 authStore 的初始化链路（它会拉 api / platform / wsClient 一长串依赖）
   * 在 jsdom 里跑一遍，也不会把登录态残留到同文件其它用例。
   * 默认值＝已初始化 + 已登录：本文件其它用例模拟的正是「登录用户在用时光页」。
   */
  authState: {
    user: { id: 'user_1', nickname: '测试用户' } as any,
    isAuthenticated: true,
    isInitialized: true,
  },
  /** 页面级未登录守卫的替身（真实现是 utils/authGuard.redirectToLoginIfNeeded，这里只记调用） */
  mockRedirectToLogin: vi.fn(),
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

/**
 * 登录态与页面级登录守卫（2026-09-12 补齐）
 *
 * 【为什么现在才需要这两条 mock】页面此前**没有**任何登录守卫（没 import 过 authStore / authGuard），
 * 本文件自然也从没 mock 过它们。补上守卫后，测试要能：
 *   ① 改登录态（authState）；② 断言守卫到底有没有被调用（mockRedirectToLogin）。
 * 写法与 pages/creative/__tests__/index.test.tsx 一致，避免同一个东西两套 mock 口径。
 * 注意这里是**整体替换**模块：真 authStore 不会被加载，也就不会在 jsdom 里跑它的初始化依赖链。
 */
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: any) => selector(authState),
}))

vi.mock('../../../utils/authGuard', () => ({
  redirectToLoginIfNeeded: (...args: unknown[]) => mockRedirectToLogin(...args),
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
 * 【2026-09-12 第 4b 波之后它在本文件里只用来做一件事】断言「本页一次都没调用它」——
 * 自动生成的日记正文已经搬去健康档案页（pagesPet/trends），时光页不该再消费 diaryService。
 * 委托真实现是为了让这条断言更有意义：万一有人把调用加回来，走的也是真实逻辑，测试会立刻变红。
 * （diaryEngine 有没有被孤儿化，由趋势页的用例负责证明。）
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

/**
 * 点「记一条」写入口打开「新增回忆」弹窗
 *
 * 【为什么不再按文案查】2026-09-12 高保真 v2 屏 02 落地后，写入口按原型
 * 从**滚动区最底部**（原「+ 添加时光记录」通栏按钮）移到了页头正下方，
 * 文案也改成原型的「记一条」/「开始」。文案会随设计稿再动，而"这个类名是不是
 * 那个唯一写入口"是稳定的，所以这里按类名定位、把文案的断言留给专门的用例。
 */
function clickAddEntry() {
  const cta = document.querySelector('.timeline-cta')
  if (!cta) throw new Error('页面里找不到「记一条」写入口（.timeline-cta）')
  fireEvent.click(cta)
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

  it('打卡仍按每只宠物各拉一次（喂页头/成就的打卡数字），但线上不再产出任何卡片', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })
    mockGetCheckins.mockResolvedValue([{ id: 'c1', riskLevel: 'normal', createdAt: '2026-09-10T02:00:00.000Z', note: '今天很精神' }])
    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetCheckins).toHaveBeenCalledTimes(2))
    // 两只宠物各自拉了打卡记录（数字口径需要全宠合并）
    expect(mockGetCheckins).toHaveBeenCalledWith(mockPet.id, 'user_1')
    expect(mockGetCheckins).toHaveBeenCalledWith(mockPet2.id, 'user_1')

    // 【2026-09-12 第 4b 波】两只宠物各有一条打卡，但时光线上**一张卡都不该有**：
    // 打卡既不生成里程碑（第 4 波撤掉）也不生成日记（第 4b 波撤掉）。
    expect(container.querySelectorAll('.timeline-list .timeline-card').length).toBe(0)
    // 线上没有内容 → 空态（而不是被自动生成的句子填满）
    await waitFor(() => expect(container.querySelector('.empty-state')).toBeTruthy())
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

    clickAddEntry()
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

    clickAddEntry()
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

    clickAddEntry()
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

    clickAddEntry()
    await waitFor(() => expect(screen.getByText('新增回忆 ✦')).toBeTruthy())
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '布丁今天学会了握手' } })
    fireEvent.click(screen.getByText('💾 保存回忆'))

    await waitFor(() => expect(mockAddMoment).toHaveBeenCalledTimes(1))
    const payload = mockAddMoment.mock.calls[0][0] as { petId: string; petIds?: string[] }
    expect(payload.petIds).toEqual([mockPet2.id])
    expect(payload.petId).toBe(mockPet2.id)
  })

  it('回忆接口挂了不影响页面的打卡数字：两条链路各自兜错，时光线本身走空态', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })
    mockGetMoments.mockRejectedValue(new Error('request:fail'))
    mockGetCheckins.mockResolvedValue([{ id: 'c1', riskLevel: 'normal', createdAt: '2026-09-10T02:00:00.000Z', note: '今天很精神' }])

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetCheckins).toHaveBeenCalledTimes(2))

    // 回忆拿不到 → 时光线是空的（真实空态），但**打卡那一路的数据照样进了页头的数字**：
    // 两只宠物各 1 条打卡、同一天 → 「打卡天数」显示 1，页面没被这次失败拖垮。
    await waitFor(() =>
      expect(Array.from(container.querySelectorAll('.timeline-overview-value')).map((el) => el.textContent)).toContain('1'),
    )
    expect(container.querySelector('.empty-state')).toBeTruthy()
    expect(container.querySelectorAll('.timeline-card').length).toBe(0)
  })

  it('卡片日期是给人看的月日（或「今天」），不能把 createdAt 的整串 ISO 显示出来', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet] as any, userId: 'user_1' })
    // 【第 4b 波】线上唯一的卡片来源是**用户回忆**，所以这里喂一条回忆来验卡面日期
    mockGetMoments.mockResolvedValue([
      { ...makeMoment('今天可乐趴在窗台上晒太阳'), happenedAt: new Date().toISOString() },
    ])

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(container.querySelectorAll('.timeline-date-text').length).toBeGreaterThan(0))

    const dates = Array.from(container.querySelectorAll('.timeline-date-text')).map((el) => el.textContent || '')
    // 回归锁（2026-09-11）：曾把 `date: createdAt` 直接塞进事件，卡片上显示成「2024-08-20T02:00:00.000Z」
    expect(dates.every((d) => !d.includes('T') && !d.includes('Z'))).toBe(true)
    // 回归锁（2026-09-12 v2 屏 02）：卡面日期从 ISO 串改成人话 —— 月日或「今天」。
    // 原来断言的是 /^\d{4}-\d{2}-\d{2}$/（ISO 串本身），与"给人看"的目标相反，故改写。
    // 年份不再出现在卡面上：它已经在分组标题「2026 年 9 月」里了，卡面再写一遍是重复。
    expect(
      dates.every((d) => d === '今天' || /^\d{1,2} 月 \d{1,2} 日$/.test(d) || /年前$/.test(d)),
    ).toBe(true)
  })

  it('新增回忆：弹窗里能选归属宠物，保存时写到选中的那只名下（默认当前宠物）', async () => {
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })

    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    // 从列表底部入口打开弹窗（PageHero 的「记录」是同一个 handler）
    clickAddEntry()
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
 * 打卡自动生成的日记**已搬出时光线**（2026-09-12 第 4b 波）
 *
 * 背景：用户看完第 4 波成果后的原话 ——「你的打卡记录怎么全部归类到时光了　吃得好睡得好
 * 这个全部都是打卡的吧？？　我哪有填了那么多时光」。
 * 核实结论：第 4 波留在时光线上的那些「今天吃得香睡得香，是快乐的一天～」，是 diaryService →
 * diaryEngine 按**每条打卡 1:1 自动生成**的正文，用户从来没有记过它们。
 *
 * 这组用例锁三件事：
 *   ① 打卡再多也不在时光线上生成卡片（自动生成的正文不再出现在这一页）；
 *   ② 心情筛选行与日记卡的类名彻底消失（筛选搬去健康档案页，本页不留死控件）；
 *   ③ 页头「N 天的记录」只数**用户回忆**，不再被打卡天数顶上去。
 */
describe('时光页 - 打卡自动生成的日记已搬走（2026-09-12 第 4b 波）', () => {
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
    // 【第 4b 波起】diaryService 已不在本页依赖里（断言它没被调用即可），
    // 这里的 mock 实现由文件顶部的 vi.mock 工厂统一委托给真实现。
  })

  it('打卡记录不再在时光线上生成任何卡片，也不再调用 diaryService', async () => {
    mockGetCheckins.mockResolvedValue([
      makeEntry('c1', '2026-09-10T02:00:00.000Z', '今天去公园了'),
      makeEntry('c2', '2026-09-11T02:00:00.000Z'),
    ])

    const { container } = render(createElement(TimelinePage))
    // 打卡这次拉取确实发生了（页头/成就的打卡口径仍要吃它）
    await waitFor(() => expect(mockGetCheckins).toHaveBeenCalledWith(mockPet.id, 'user_1'))

    // 线上没有日记卡、没有日记正文，也没有那个筛不动任何东西的心情筛选行
    expect(container.querySelectorAll('.timeline-card--diary').length).toBe(0)
    expect(container.querySelector('.timeline-diary-text')).toBeNull()
    expect(container.querySelector('.timeline-feed-filter')).toBeNull()
    // 【关键证据】本页不再生成日记正文 —— diaryService 一次都没被调用
    expect(mockGenerateDiary).not.toHaveBeenCalled()
    // 没有回忆 → 真实空态（而不是拿打卡生成的句子把列表填满）
    await waitFor(() => expect(container.querySelector('.empty-state')).toBeTruthy())
  })

  it('页头「N 天的记录」只数用户回忆：只打卡不写回忆时，页头不显示天数', async () => {
    // 连续 3 天打卡，但一条回忆都没有
    mockGetCheckins.mockResolvedValue([
      makeEntry('c1', '2026-09-09T02:00:00.000Z'),
      makeEntry('c2', '2026-09-10T02:00:00.000Z'),
      makeEntry('c3', '2026-09-11T02:00:00.000Z'),
    ])

    const { container } = render(createElement(TimelinePage))
    // 等到打卡那一格真的渲染出来（3 天的打卡口径）
    await waitFor(() =>
      expect(Array.from(container.querySelectorAll('.timeline-overview-value')).map((el) => el.textContent)).toContain('3'),
    )

    // 改前这里会渲染「3 天的记录」（打卡天数），而屏幕上一条卡都没有 —— 正是数字与列表对不上
    expect(container.querySelector('.timeline-topbar-sub')).toBeNull()
    // 速览「时光记录」= 0（线上确实没东西），但「打卡天数」那一格仍如实显示 3
    const values = Array.from(container.querySelectorAll('.timeline-overview-value')).map((el) => el.textContent)
    expect(values).toContain('0')
    expect(values).toContain('3')
  })

  it('没有回忆时给的是真实空态 + 指向「记一条」的引导（按钮真的能打开新增回忆弹窗）', async () => {
    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(container.querySelector('.empty-state')).toBeTruthy())

    expect(container.textContent).toContain('还没有时光记录')
    expect(container.textContent).toContain('这里只放你自己记下的回忆')
    // 空态自带一个真的能点的行动按钮（不是假按钮）：点了就打开既有的新增回忆弹窗
    fireEvent.click(screen.getByText('记第一条回忆'))
    await waitFor(() => expect(screen.getByText('新增回忆 ✦')).toBeTruthy())

    // 分享出口仍然注册在本页（承接被删的日记页路由），path 必须指回本页
    expect(shareAppCallbacks.length).toBe(1)
    expect(shareAppCallbacks[0]().path).toBe('/pages/timeline/index')
  })
})


/**
 * 高保真 v2 屏 02 新增的骨架（2026-09-12 第 2 波）
 *
 * 本批对照 `02-timeline.png` 补的两块 + 两处按原型的调整：
 *   ① 「记一条」写入口（原来塞在滚动区最底部，首屏看不见）；
 *   ② 「成就」展示分区（原来本页完全没有成就区）；
 *   ③ 时光足迹按月分组（原来是一条没有月份层次的光板列表）；
 *   ④ 页头副标题「N 天的记录」+ 卡面日期改成人话。
 *
 * 【为什么这组用例的数字断言都跟"今天"挂钩】页头的天数、连续天数、本月新增
 * 全是**相对今天**算的，写死日期的话这些用例过一个月就会自己变红。
 * 所以统一用 daysAgo() 现算日期。
 */
describe('时光页 - v2 屏 02 骨架（页头 / 记一条 / 按月分组 / 成就）', () => {
  /** 本地日期字符串（YYYY-MM-DD），与页面同一个口径 */
  function localDate(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  /** N 天前的**本地**日期字符串；用 setDate 而不是减毫秒，跨月/跨夏令时都稳 */
  function daysAgo(n: number): string {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return localDate(d)
  }

  /**
   * 构造一条打卡记录（字段对齐 checkinService 返回的 PetHealthEntry）
   *
   * 【第 4b 波起它只喂给「打卡口径」的数字】打卡不再产出任何卡片（时光线只剩用户回忆），
   * 所以这里只用它来验页头的「打卡天数」与成就第一格的「连续打卡」。
   *
   * ⚠️ `createdAt` 用**本地中午**而不是 `T02:00:00.000Z` —— 本页日期口径是「本地日历日」，
   *    统一取本地中午后无论时区怎么偏都落在同一天，断言的是「日期」而不是「小时」。
   */
  function makeEntry(id: string, dateStr: string) {
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
      note: '今天很精神',
      createdAt: `${dateStr}T12:00:00`,
    }
  }

  /** 自增序号：保证每条构造出来的回忆 id 唯一（React key 撞车会让分组计数类断言失真） */
  let memorySeq = 0

  /**
   * 构造一条「某天记下的回忆」（时光线上唯一的内容来源，第 4b 波起）
   *
   * 与打卡记录相对：它是**用户自己写的**，所以时间和内容都直接给，
   * 不再需要「有 note 才算一条」那套打卡口径的讲究。
   *
   * @param dateStr - 补记日期（YYYY-MM-DD，本地日历日）
   * @param description - 用户写下的那句话
   * @param photos - 这条回忆带的照片（默认没有）
   */
  function makeMemoryOn(dateStr: string, description: string, photos: string[] = []): PetMoment {
    memorySeq += 1
    return {
      id: `moment-${dateStr}-${memorySeq}`,
      userId: 'user_1',
      petId: mockPet.id,
      type: 'memory',
      content: { petName: mockPet.name, petEmoji: '🐱', description } as PetMoment['content'],
      photos,
      createdAt: `${dateStr}T12:00:00`,
      happenedAt: dateStr,
    }
  }

  beforeEach(async () => {
    showCallbacks.length = 0
    shareAppCallbacks.length = 0
    vi.clearAllMocks()
    mockGetMoments.mockResolvedValue([])
    mockGetCheckins.mockResolvedValue([])
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet] as any, userId: 'user_1' })
    // 【第 4b 波起】diaryService 已经不在本页的依赖里，这里不再需要「把 mock 恢复成真实现」；
    // 每组只要保证调用记录被清掉（vi.clearAllMocks() 已在上面做了）。
  })

  /**
   * 按标签取速览格子的数字（同一页有好几个数字，按文本查会撞）
   * @param label - 格子下方的标签文案，如「打卡天数」
   */
  function overviewValue(label: string): string | null {
    const items = Array.from(document.querySelectorAll('.timeline-overview-item'))
    for (const item of items) {
      if (item.querySelector('.timeline-overview-label')?.textContent === label) {
        return item.querySelector('.timeline-overview-value')?.textContent ?? null
      }
    }
    return null
  }

  it('页头「N 天的记录」数的是用户回忆覆盖的天数（同一天两条只算一天），打卡天数另有独立一格', async () => {
    // 3 天各记了回忆，其中今天记了 2 条 → 去重后是 3 天
    mockGetMoments.mockResolvedValue([
      makeMemoryOn(daysAgo(0), '今天可乐趴在窗台上晒太阳'),
      makeMemoryOn(daysAgo(0), '同一天的第二条回忆'),
      makeMemoryOn(daysAgo(1), '昨天带可乐去公园'),
      makeMemoryOn(daysAgo(2), '前天买了新逗猫棒'),
    ])
    // 打卡只有今天这一天 → 若页头仍按打卡口径算，就会写成「1 天的记录」
    mockGetCheckins.mockResolvedValue([makeEntry('c1', daysAgo(0))])

    render(createElement(TimelinePage))
    await waitFor(() => expect(screen.getByText('3 天的记录')).toBeTruthy())

    expect(document.querySelector('.timeline-topbar-brand')?.textContent).toBe('时光')
    expect(document.querySelector('.timeline-topbar-btn')).toBeTruthy()
    // 速览：时光记录 = 4 张卡；打卡天数 = 1（打卡口径，与页头那 3 天不是同一个数字）
    await waitFor(() => expect(overviewValue('打卡天数')).toBe('1'))
    expect(overviewValue('时光记录')).toBe('4')
    expect(overviewValue('珍藏照片')).toBe('0')
  })

  it('一条打卡都没有时页头不写「0 天的记录」（原型也没有这种丧气文案）', async () => {
    render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    expect(document.querySelector('.timeline-topbar-brand')?.textContent).toBe('时光')
    expect(document.querySelector('.timeline-topbar-sub')).toBeNull()
  })

  it('「记一条」写入口在页头下方（滚动区最上面），文案与原型一致，点击开既有新增回忆弹窗', async () => {
    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    // 位置：写入口必须是滚动区里的**第一个**区块（原来是滚动区最底部的通栏按钮）
    const scroll = container.querySelector('.timeline-scroll')
    expect(scroll).toBeTruthy()
    expect(scroll!.firstElementChild?.className).toContain('page-hero')

    // 文案按原型（「记一条」/「开始」/ 那句说明）
    expect(screen.getByText('记一条')).toBeTruthy()
    expect(screen.getByText('开始')).toBeTruthy()
    expect(
      screen.getByText('添加时光记录 · 随手写一句、配张照片，团团会自动归档'),
    ).toBeTruthy()
    // 底部那个重复的写入口已经撤掉（同页两个写入口会让用户以为功能不同）
    expect(container.querySelector('.timeline-add-main-btn')).toBeNull()

    // 点击 → 打开的是本页既有的「新增回忆」弹窗，不是新造的第二套流程
    clickAddEntry()
    await waitFor(() => expect(screen.getByText('新增回忆 ✦')).toBeTruthy())
  })

  it('时光足迹按月分组：标题是「YYYY 年 M 月」，条数等于该组卡片数，同一组不会被拆开', async () => {
    // 全部落在同一个月（今天往前 1/2 天），保证只有一组
    mockGetMoments.mockResolvedValue([
      makeMemoryOn(daysAgo(0), '今天晒了太阳'),
      makeMemoryOn(daysAgo(1), '昨天去公园'),
    ])

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(container.querySelectorAll('.timeline-month').length).toBeGreaterThan(0))

    const months = container.querySelectorAll('.timeline-month')
    // 每个分组的标题形如「2026 年 9 月」（月份不带前导零），且各自带条数
    const titles = Array.from(container.querySelectorAll('.timeline-month-title')).map((el) => el.textContent || '')
    const counts = Array.from(container.querySelectorAll('.timeline-month-count')).map((el) => el.textContent || '')
    expect(titles.length).toBe(months.length)
    expect(counts.length).toBe(months.length)
    expect(titles.every((t) => /^\d{4} 年 \d{1,2} 月$/.test(t))).toBe(true)

    // 条数必须等于该组里的卡片数（分组计数与实际渲染更容易悄悄错的地方）
    Array.from(months).forEach((m, i) => {
      expect(counts[i]).toBe(`${m.querySelectorAll('.timeline-item').length} 条`)
    })

    // 同一组不会被拆成两组（相邻聚合写错就会出现两个相同标题）
    expect(new Set(titles).size).toBe(titles.length)

    // 今天与昨天这两条**用户回忆**落在同一个分组里（月份取今天所在月）
    const now = new Date()
    const label = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`
    const thisMonth = Array.from(months).find(
      (m) => m.querySelector('.timeline-month-title')?.textContent === label,
    )
    if (!thisMonth) throw new Error(`找不到本月分组：titles=${JSON.stringify(titles)} label=${label}`)
    // 本月这一组里就是那两条回忆（打卡不产出卡片，所以条数只可能来自回忆）
    expect(thisMonth!.querySelectorAll('.timeline-item').length).toBe(2)
  })

  it('成就分区：连续打卡档位与本月新增都来自真实数据（没有任何编造的解锁状态）', async () => {
    // 连续 2 天（今天 + 昨天）→ 最早那一档是 7 天，应显示「已连续 2 天 · 还差 5 天」
    mockGetCheckins.mockResolvedValue([makeEntry('c1', daysAgo(0)), makeEntry('c2', daysAgo(1))])
    // 本月一条带 2 张照片的回忆（今天）→ 主标题说照片、副行说本月新增的记录条数
    mockGetMoments.mockResolvedValue([
      makeMemoryOn(daysAgo(0), '今天晒了太阳', ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']),
    ])

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(container.querySelectorAll('.timeline-achv-tile').length).toBe(2))

    const titles = Array.from(container.querySelectorAll('.timeline-achv-title')).map((el) => el.textContent)
    const subs = Array.from(container.querySelectorAll('.timeline-achv-sub')).map((el) => el.textContent)
    // 第一格：成就名取自 constants 的 ACHIEVEMENT_TYPES.streak_7（「坚持一周」）
    expect(titles[0]).toBe('坚持一周')
    expect(subs[0]).toBe('已连续 2 天 · 还差 5 天')
    // 第二格：这条回忆带了 2 张真实照片 → 主标题说照片、副行说记录条数
    expect(titles[1]).toBe('2 张照片')
    // 【2026-09-12 第 4b 波改口径】「本月新增 N 条记录」现在**只数用户回忆**（按日期去重）：
    // 本次数据里只有今天那一条回忆 → 1 条。打卡不再参与这个数字
    // （日记已离开本页，再把它算进去就是拿屏幕上看不见的东西充数）。
    expect(subs[1]).toBe('本月新增 1 条记录')
  })

  it('成就分区不编造数据：没有打卡、本月也没有回忆时，第二格不渲染、第一格是「还差 7 天」', async () => {
    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    const tiles = container.querySelectorAll('.timeline-achv-tile')
    // 只有连续打卡那一格（"本月新增 0 张"那种丧气格子不该出现）
    expect(tiles.length).toBe(1)
    expect(container.querySelector('.timeline-achv-title')?.textContent).toBe('坚持一周')
    expect(container.querySelector('.timeline-achv-sub')?.textContent).toBe('已连续 0 天 · 还差 7 天')
  })

  it('本月只有文字、没有照片时，成就第二格说「N 条记录」而不是「0 张照片」', async () => {
    // 真机取图时抓到的缺陷：主标题写死成「{monthPhotos} 张照片」，
    // 用户本月只写字没传图就会显示「0 张照片 / 本月新增 1 条记录」——
    // 主标题是个 0，看着像页面坏了。这条用例锁住「有照片说照片、没照片说记录」。
    // 【第 4b 波】这条记录改成「用户只写了字、没拍照片的回忆」—— 打卡已经不进这个计数了。
    mockGetMoments.mockResolvedValue([makeMemoryOn(daysAgo(0), '今天只写了字，没拍照')])

    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(container.querySelectorAll('.timeline-achv-tile').length).toBe(2))

    const titles = Array.from(container.querySelectorAll('.timeline-achv-title')).map((el) => el.textContent)
    const subs = Array.from(container.querySelectorAll('.timeline-achv-sub')).map((el) => el.textContent)
    expect(titles[1]).toBe('1 条记录')
    expect(subs[1]).toBe('本月新增')
  })

  it('按月分组下空态照常出现（空态判的是"一条记录都没有"，不是"分组数组为空"）', async () => {
    // 没有任何打卡、也没有回忆 → 页面只剩宠物自己的里程碑事件？
    // 不会：pets 里那只宠物的 birthDate/createdAt 会生成生日/建档里程碑，
    // 所以这里断言的是"空态与分组互斥"这条不变量，而不是硬要求空态出现。
    const { container } = render(createElement(TimelinePage))
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    const hasGroups = container.querySelectorAll('.timeline-month').length > 0
    const hasEmpty = !!container.querySelector('.empty-state')
    expect(hasGroups !== hasEmpty).toBe(true)
  })
})

/**
 * 时光页 · 登录守卫（2026-09-12 补齐「时光没有绑定登录」）
 *
 * 【背景（复核到的事实，不是历史猜测）】本页改造前通篇没有出现过 authStore / authGuard，
 * 是四个 tab 页（mine / creative / pet-profile 都已有）里唯一漏掉守卫的一页：未登录用户
 * 能直接进本页，退出登录后也不会被送回登录页。本组用例锁三件事：
 *   ① **初始化没跑完时不许跳**（否则冷启动会把已登录用户弹去登录页）；
 *   ② 初始化完成且未登录（或 user 没恢复出来）→ 调一次 redirectToLoginIfNeeded 收口；
 *   ③ 已登录 → 一次都不调，页面照常拉回忆。
 * 【这把锁能抓什么回归】把页面里那段守卫删掉，②③ 立刻变红；把 isInitialized 那行提前
 * return 删掉，① 立刻变红（真机上就是冷启动的已登录用户被弹出登录页）。
 */
describe('时光页 · 登录守卫', () => {
  /** 把 authState 拨到指定登录态（只改字段，不换对象引用） */
  function setAuth(next: { user: any; isAuthenticated: boolean; isInitialized: boolean }) {
    authState.user = next.user
    authState.isAuthenticated = next.isAuthenticated
    authState.isInitialized = next.isInitialized
  }

  beforeEach(() => {
    showCallbacks.length = 0
    shareAppCallbacks.length = 0
    vi.clearAllMocks()
    mockGetMoments.mockResolvedValue([])
    mockGetCheckins.mockResolvedValue([])
    usePetStore.setState({ currentPet: mockPet as any, pets: [mockPet] as any, userId: 'user_1' })
  })

  afterEach(() => {
    // 复位成「已初始化 + 已登录」：登录态是模块级可变对象，不复位会渗到同文件其它用例
    setAuth({ user: { id: 'user_1', nickname: '测试用户' }, isAuthenticated: true, isInitialized: true })
  })

  it('初始化没跑完时不动：冷启动不把已登录用户弹去登录页', async () => {
    // authStore 的初始值就是 isAuthenticated:false（stores/authStore.ts:41），真登录态要等
    // initialize() 从本地存储恢复完才有 —— 这一格模拟的正是「还没恢复完」的那一瞬
    setAuth({ user: null, isAuthenticated: false, isInitialized: false })

    render(createElement(TimelinePage))
    // 等页面自己的数据加载 effect 落地，证明确实渲染过、effect 跑过（不是「没渲染所以没跳」）
    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))

    expect(mockRedirectToLogin).not.toHaveBeenCalled()
  })

  it('初始化完成 + 未登录：收口跳登录页', async () => {
    setAuth({ user: null, isAuthenticated: false, isInitialized: true })

    render(createElement(TimelinePage))

    await waitFor(() => expect(mockRedirectToLogin).toHaveBeenCalledTimes(1))
  })

  it('初始化完成但 user 没恢复出来（只有 token）：同样收口跳登录页', async () => {
    setAuth({ user: null, isAuthenticated: true, isInitialized: true })

    render(createElement(TimelinePage))

    await waitFor(() => expect(mockRedirectToLogin).toHaveBeenCalledTimes(1))
  })

  it('已登录：一次都不跳，页面照常拉回忆', async () => {
    setAuth({ user: { id: 'user_1', nickname: '测试用户' }, isAuthenticated: true, isInitialized: true })

    render(createElement(TimelinePage))

    await waitFor(() => expect(mockGetMoments).toHaveBeenCalledTimes(1))
    expect(mockRedirectToLogin).not.toHaveBeenCalled()
  })
})
