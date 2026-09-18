/**
 * 今天（首页）· 健康管家看板 —— 单元测试
 *
 * 【2026-09-12 IA 第 4 批重写说明（必读）】
 * 本页从「AI 对话首页」重做为「此刻该做什么」的健康看板（高保真 v2 第 1 屏）：
 * 品牌顶栏 / 宠物切换卡 / 品牌 Hero / 今日健康摘要 / 健康打卡 CTA /
 * 今天还有这些事（疫苗·驱虫待办）/ 快捷功能。
 * AI 对话（欢迎语、消息流、输入框、会话抽屉、症状初筛、加号面板、快捷能力）整体搬到
 * `pagesYuantuan/agent`（团团全屏页）。
 *
 * 因此本文件里**断言旧 AI 对话页的用例随第 4 批把 AI 对话搬到团团页而移除**，
 * 并按"原覆盖意图"在新结构上重写 —— 逐条对照见文件末尾《用例迁移对照》注释块，
 * 对照组统一放在 `src/pagesYuantuan/agent/__tests__/index.test.tsx`（新增）。
 * 没有任何一条旧用例是"因为断言不过"被静默删掉的。
 *
 * 【本文件的断言原则】
 * 1. 只断言页面**真实渲染出来的结构**（类名 / 文案 / 点击行为），不迁就旧测试去改页面；
 * 2. 数字类断言（分数、天数、待办到期日）用**仓库公共实现**算期望值，
 *    不在测试里复制一份实现（旧文件曾把 calcAge 复制进测试 → 源码改实现它也照样绿的假绿）；
 * 3. 所有网络/数据层一律 mock，绝不真发请求。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { createElement } from 'react'
// 被测页面正常置于顶部导入；vi.mock 由 vitest 自动提升到文件最前，mock 生效不受影响
import Index from '../index'
// 年龄与「已陪伴 N 天」用**仓库唯一的公共实现**算期望值：
// 这两个值随"运行当天"变化，硬编码会让用例过几天就红。
import { formatPetAge, daysSinceLocalDate } from '../../../utils/date'

// ============================================================
// vi.hoisted —— vi.mock 工厂里引用的变量必须用 hoisted 声明
// （vi.mock 会被提升到文件最顶部执行，普通 const 那时还没初始化）
// ============================================================
const {
  mockNavigateTo,
  mockSwitchTab,
  mockShowToast,
  mockGetTodayCheckin,
  mockGetCheckins,
  mockGetOverdueRecords,
  mockGetUpcomingRecords,
  mockSwitchPet,
  mockFetchUsers,
  mockPet,
  mockPet2,
  petStoreState,
  authState,
  familyState,
} = vi.hoisted(() => {
  /** 主宠物（狗，有生日与建档时间 → 宠物卡副信息三个字段都能取到） */
  const pet = {
    id: 'pet_001',
    name: '旺财',
    species: 'dog' as const,
    breed: '金毛',
    birthDate: '2023-03-15',
    createdAt: '2024-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  /** 第二只宠物：验证切换器真的把 id 交给 store，而不是"看起来能切" */
  const pet2 = {
    id: 'pet_002',
    name: '布丁',
    species: 'cat' as const,
    breed: '英短',
    birthDate: '2024-06-01',
    createdAt: '2025-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const switchPet = vi.fn(() => Promise.resolve())

  return {
    mockNavigateTo: vi.fn(),
    mockSwitchTab: vi.fn(),
    mockShowToast: vi.fn(),
    mockGetTodayCheckin: vi.fn(),
    mockGetCheckins: vi.fn(),
    mockGetOverdueRecords: vi.fn(),
    mockGetUpcomingRecords: vi.fn(),
    mockSwitchPet: switchPet,
    mockFetchUsers: vi.fn(() => Promise.resolve()),
    mockPet: pet,
    mockPet2: pet2,
    // 宠物 store 的可变状态：用例里改它即可切换"有宠物/无宠物/加载中"
    petStoreState: {
      currentPet: pet as any,
      pets: [pet] as any[],
      isLoading: false,
      switchPet,
    },
    // 登录用户：页面用它给 checkinService 传 userId（无用户时不拉今日摘要）
    authState: { user: { id: 'user_1' } as any },
    // 家庭成员（人）列表：长度 ≤1 时首页显示「邀请 TA 一起养宠」横幅
    familyState: { users: [] as any[], currentFamily: null as any },
  }
})

// ============================================================
// Taro 组件 mock
// 为什么自己写而不是复用 src/test/setup.ts 的全局 mock：这里只转发页面真正用到的 props，
// 避免 className/style 之外的小程序专有属性（hoverClass / catchMove 等）落进 DOM 造成噪声；
// Image 必须转发 onError —— 头像"加载失败退回 emoji"这条链路靠它触发。
// ============================================================
vi.mock('@tarojs/components', () => ({
  // 本页没有任何长按交互（长按复制消息在团团页），故不转发 onLongPress：
  // 它会让 React 打出 "Unknown event handler property" 噪声，掩盖真正的警告
  View: ({ children, className, style, onClick }: any) =>
    createElement('div', { className, style, onClick }, children),
  // Text 必须转发 onClick：横幅上的关闭「✕」就是一个 <Text onClick>
  Text: ({ children, className, style, onClick }: any) =>
    createElement('span', { className, style, onClick }, children),
  ScrollView: ({ children, className }: any) =>
    createElement('div', { className }, children),
  Image: ({ src, className, mode, onError, onLoad }: any) =>
    createElement('img', { src, className, 'data-mode': mode, onError, onLoad }),
  Input: ({ className, value, placeholder, onInput, onConfirm }: any) =>
    createElement('input', {
      className,
      value,
      placeholder,
      onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }),
      onKeyDown: (e: any) => e.key === 'Enter' && onConfirm?.(),
    }),
}))

// ============================================================
// Taro API mock
// ============================================================
vi.mock('@tarojs/taro', () => ({
  default: {
    navigateTo: mockNavigateTo,
    switchTab: mockSwitchTab,
    showToast: mockShowToast,
    showModal: vi.fn(),
    setClipboardData: vi.fn(),
    previewImage: vi.fn(),
    getStorageSync: vi.fn(() => null),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    getEnv: vi.fn(() => 'WEAPP'),
  },
  // ⚠️ 具名导出必须与 default 平级：constants/tabBar.ts 用的是
  // `import Taro, { useDidShow } from '@tarojs/taro'`（本页用它广播 tabBar 选中态）。
  // 放进 default 里没用，缺了会报
  // 「No "useDidShow" export is defined on the "@tarojs/taro" mock」。
  useDidShow: () => {},
  useShareAppMessage: () => {},
  useShareTimeline: () => {},
  useRouter: () => ({ path: '/pages/index/index', params: {} }),
  // Icon 组件（经 components/index 引入）会读主题 store，兜底给一个返回 null 的版本
  getStorageSync: vi.fn(() => null),
}))

// ============================================================
// 业务 hook mock
// ============================================================
// 主题 hook：mock 掉是为了让"根容器带主题类名"与"PageBackground / Illustration 能读主题"
// 这两件事在 jsdom 里可控（真实实现要读 zustand store + Taro.eventCenter）
vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => 'theme-autumn',
  useThemeKey: () => 'autumn',
  usePetWallpaper: () => null,
}))

// ============================================================
// store mock —— 按 selector 返回字段；getState 也补上，
// 因为页面用 useFamilyStore.getState().currentFamily 判断要不要拉家庭成员
// ============================================================
vi.mock('../../../stores/petStore', () => {
  const usePetStore: any = (selector?: (s: any) => any) =>
    selector ? selector(petStoreState) : petStoreState
  usePetStore.getState = () => petStoreState
  return { usePetStore }
})

vi.mock('../../../stores/authStore', () => {
  const useAuthStore: any = (selector?: (s: any) => any) =>
    selector ? selector(authState) : authState
  useAuthStore.getState = () => authState
  return { useAuthStore }
})

vi.mock('../../../stores/familyStore', () => {
  // 每次调用都从 hoisted 的可变状态**现取**：用例里改 familyState.users 后要立刻生效。
  // （若在工厂里快照成一个固定对象，用例改了也不生效，会测出假的"横幅不显示"。）
  const snapshot = () => ({
    users: familyState.users,
    currentFamily: familyState.currentFamily,
    fetchUsers: mockFetchUsers,
  })
  const useFamilyStore: any = (selector?: (s: any) => any) => {
    const state = snapshot()
    return selector ? selector(state) : state
  }
  useFamilyStore.getState = snapshot
  return { useFamilyStore }
})

// ============================================================
// service mock
// 为什么用 importOriginal 展开真身、只覆盖取数函数：
// `calcHealthScore` 是页面健康分的唯一口径，必须用**真实现**，
// 若在这里复制一份公式，页面把分数换错算法测试也照样绿（假绿）。
// ============================================================
vi.mock('../../../services/checkinService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/checkinService')>()
  return {
    ...actual,
    getTodayCheckin: mockGetTodayCheckin,
    getCheckins: mockGetCheckins,
  }
})

// 疫苗/驱虫：只覆盖本页用到的两个查询，其余导出保留（同模块被其它组件引用时不会缺 export）
vi.mock('../../../services/vaccineService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vaccineService')>()
  return {
    ...actual,
    getOverdueRecords: mockGetOverdueRecords,
    getUpcomingRecords: mockGetUpcomingRecords,
  }
})

// ============================================================
// 组件 mock
// ============================================================
vi.mock('../../../components/HomeSkeleton', () => ({
  default: () => createElement('div', { 'data-testid': 'home-skeleton' }, '加载中...'),
}))

// 打卡弹窗：只验证首页的"开 / 关 / 完成后刷新"接线，卡内四步流程由 CheckinPopup 自己的测试覆盖。
// 这里额外暴露两个按钮，用来触发 onClose / onComplete（页面在完成后会重拉今日摘要）。
vi.mock('../../../components/CheckinPopup', () => ({
  default: ({ open, onClose, onComplete }: any) =>
    open
      ? createElement(
          'div',
          { 'data-testid': 'checkin-popup' },
          '打卡弹窗',
          createElement('button', {
            'data-testid': 'checkin-complete',
            onClick: () => onComplete?.({ type: 'ai', content: '打卡完成' }),
          }, '完成'),
          createElement('button', {
            'data-testid': 'checkin-close',
            onClick: () => onClose?.(),
          }, '关闭'),
        )
      : null,
}))

// 样式文件：单测不关心样式，mock 成空对象避免走 CSS 处理链
vi.mock('../index.scss', () => ({}))

// ============================================================
// 测试工具
// ============================================================

/** 本地时区 YYYY-MM-DD（不能用 toISOString：东八区晚上会退到前一天） */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 相对今天偏移 n 天的本地日期串（待办"还有 N 天到期"用） */
function dateOffsetFromToday(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

/**
 * 渲染页面并冲掉首屏的异步取数
 *
 * 为什么需要：本页三块数据（今日摘要 / 体重差值 / 待办）全靠 useEffect + promise 落地，
 * 渲染完立刻断言会看到"还没加载完"的中间态，用例会随微任务时机时红时绿。
 * 这里用 act 包一次空异步函数，把已排队的 promise 回调冲干净。
 */
async function renderPage() {
  const utils = render(createElement(Index))
  await act(async () => {})
  return utils
}

/** 造一条疫苗/驱虫记录（字段与 services/vaccineService 的 VaccineRecord 一致） */
function vaccineRecord(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'vac_1',
    petId: 'pet_001',
    type: 'vaccine',
    category: 'rabies',
    date: '2025-01-05',
    nextDate: '2026-01-05',
    status: 'completed',
    createdAt: '2025-01-05T00:00:00.000Z',
    updatedAt: '2025-01-05T00:00:00.000Z',
    ...over,
  }
}

/** 造一条打卡记录（字段与 PetHealthEntry 一致） */
function checkinEntry(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'ck_1',
    petId: 'pet_001',
    userId: 'user_1',
    poopLevel: 3,
    appetiteLevel: 3,
    spiritLevel: 3,
    exerciseLevel: 3,
    hasAnomaly: false,
    anomalyItems: [],
    riskLevel: 'low',
    createdAt: new Date(),
    ...over,
  }
}

/** 每个用例开始前的基线：有宠物、有登录用户、无待办、今天未打卡 */
beforeEach(() => {
  vi.clearAllMocks()
  petStoreState.currentPet = mockPet
  petStoreState.pets = [mockPet]
  petStoreState.isLoading = false
  authState.user = { id: 'user_1' }
  familyState.users = []
  familyState.currentFamily = null
  mockGetTodayCheckin.mockResolvedValue(null)
  mockGetCheckins.mockResolvedValue([])
  mockGetOverdueRecords.mockResolvedValue([])
  mockGetUpcomingRecords.mockResolvedValue([])
})

// ============================================================
// 年龄文案（页面用它渲染宠物卡的年龄段）
//
// 2026-09-11 起全站统一到 utils/date 的 formatPetAge，这里**直接 import 真身**。
// 此前本文件在测试里复制了一份 calcAge 的实现（注释写"从源码复制，用于测试私有函数"），
// 源码改成别的实现它也照样绿 —— 是典型的假绿测试。现在页面已改为调用 formatPetAge，
// 测试直接测它（用例意图原样保留，未随第 4 批改动）。
// ============================================================
describe('年龄文案（已统一到 utils/date 的 formatPetAge）', () => {
  it('空值返回空串', () => {
    expect(formatPetAge('')).toBe('')
  })

  it('不满 1 岁只给月龄（< 12 个月）', () => {
    // 用「5 个月前的 1 号」：任何一天都 ≥ 1 号，必然满 5 个月，期望值不随日历抖动
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    expect(formatPetAge(localDateStr(target))).toBe('5个月')
  })

  it('整岁不带零头（恰好 24 个月）', () => {
    const now = new Date()
    const target = new Date(now.getFullYear() - 2, now.getMonth(), 1)
    expect(formatPetAge(localDateStr(target))).toBe('2岁')
  })

  it('岁 + 月龄（2 岁 3 个月）', () => {
    const now = new Date()
    const target = new Date(now.getFullYear() - 2, now.getMonth() - 3, 1)
    // 统一后的格式是「2岁3个月」（旧实现输出「2岁3月」）
    expect(formatPetAge(localDateStr(target))).toBe('2岁3个月')
  })

  it('未来日期不再输出负数年龄，而是走兜底文案', () => {
    // 旧实现会返回「-890月」这种明显错误的文案
    expect(formatPetAge('2099-01-01')).toBe('')
    expect(formatPetAge('2099-01-01', { fallback: '年龄未知' })).toBe('年龄未知')
  })
})

// ============================================================
// 加载态与空态
// ============================================================
describe('今天页 · 加载态与空态', () => {
  it('无宠物且加载中 → 渲染骨架屏，不渲染看板', async () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    petStoreState.isLoading = true

    const { container } = await renderPage()

    expect(container.querySelector('[data-testid="home-skeleton"]')).toBeTruthy()
    expect(container.querySelector('.today-topbar')).toBeFalsy()
  })

  it('无宠物且加载完 → 渲染空态（欢迎文案 + 添加宠物按钮），不渲染骨架屏', async () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    petStoreState.isLoading = false

    const { container } = await renderPage()

    expect(container.textContent).toContain('欢迎来到星河宠记')
    expect(container.textContent).toContain('添加你的第一位宠物伙伴')
    expect(container.textContent).toContain('添加宠物')
    expect(container.querySelector('[data-testid="home-skeleton"]')).toBeFalsy()
  })

  it('空态的「添加宠物」按钮跳添加宠物页', async () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    petStoreState.isLoading = false

    const { container } = await renderPage()

    const addBtn = container.querySelector('.chat-empty-btn')
    expect(addBtn).toBeTruthy()
    fireEvent.click(addBtn!)

    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesPet/add/index' })
  })

  it('有宠物时即使 isLoading=true 也不显示骨架屏（看板照常渲染）', async () => {
    petStoreState.isLoading = true

    const { container } = await renderPage()

    expect(container.querySelector('[data-testid="home-skeleton"]')).toBeFalsy()
    expect(container.querySelector('.today-topbar')).toBeTruthy()
  })
})

// ============================================================
// 顶栏与宠物切换卡
// ============================================================
describe('今天页 · 顶栏与宠物切换卡', () => {
  it('顶栏渲染**时段问候 + 昵称**，且不再重复导航栏的品牌名', async () => {
    const { container } = await renderPage()

    const hello = container.querySelector('.today-topbar__hello')?.textContent || ''
    // 三档之一（用例不锁具体哪一档：跑在凌晨/白天/晚上都得通过）
    expect(hello).toMatch(/^(早上好|下午好|晚上好)/)
    // 带昵称时形如「早上好，铲屎官」；取不到昵称就只留问候、不出现半截的「早上好，」
    if (hello.length > 3) expect(hello).toContain('，')

    // 关键回归：顶栏**不许**再出现品牌名 —— 原生导航栏标题已经是「星河宠记」，
    // 顶栏再写一遍就是同一屏两次同样的四个字（2026-09-12 用户截图指出后改掉的）
    expect(container.querySelector('.today-topbar')?.textContent).not.toContain('星河宠记')
    expect(container.querySelector('.today-topbar__title')).toBeFalsy()
    expect(container.querySelector('.today-topbar__sub')).toBeFalsy()
  })

  it('宠物卡渲染 名字 + 品种 · 年龄 · 已陪伴 N 天', async () => {
    const { container } = await renderPage()

    expect(container.querySelector('.today-petcard__name')?.textContent).toBe('旺财')

    // 期望值用公共实现算，不硬编码（年龄/天数是相对"今天"变化的）
    const expectedAge = formatPetAge(mockPet.birthDate)
    const expectedDays = daysSinceLocalDate(mockPet.createdAt)
    expect(expectedAge).not.toBe('')
    expect(expectedDays).not.toBeNull()

    expect(container.querySelector('.today-petcard__meta')?.textContent)
      .toBe(`金毛 · ${expectedAge} · 已陪伴 ${expectedDays} 天`)
  })

  it('宠物卡缺字段时不留「 · 」空档（没生日就不显示年龄段）', async () => {
    const noBirthday = { ...mockPet, birthDate: '' }
    petStoreState.currentPet = noBirthday
    petStoreState.pets = [noBirthday]

    const { container } = await renderPage()

    const meta = container.querySelector('.today-petcard__meta')?.textContent || ''
    expect(meta).not.toContain(' ·  · ')
    expect(meta.startsWith('金毛 · 已陪伴')).toBe(true)
  })

  it('铃铛跳疫苗日历、齿轮跳设置页', async () => {
    const { container } = await renderPage()

    const btns = container.querySelectorAll('.today-icon-btn')
    expect(btns).toHaveLength(2)

    fireEvent.click(btns[0])
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesPet/vaccine/index' })

    fireEvent.click(btns[1])
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesUser/settings/index' })
  })

  it('点宠物卡展开切换器，再点另一只 → 交给 store 切换并收起切换器', async () => {
    petStoreState.pets = [mockPet, mockPet2]

    const { container } = await renderPage()

    // 默认收起：切换器不在 DOM 里
    expect(container.querySelector('.pet-switcher')).toBeFalsy()

    fireEvent.click(container.querySelector('.today-petcard')!)
    expect(container.querySelector('.pet-switcher')).toBeTruthy()

    const items = container.querySelectorAll('.pet-switcher__item')
    // 两只宠物 + 「添加」= 3 项
    expect(items).toHaveLength(3)
    fireEvent.click(items[1])

    expect(mockSwitchPet).toHaveBeenCalledWith('pet_002')
    // 选完收起：不能停在展开态
    expect(container.querySelector('.pet-switcher')).toBeFalsy()
  })

  it('切换器里的「添加」跳添加宠物页', async () => {
    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.today-petcard')!)
    const addItem = Array.from(container.querySelectorAll('.pet-switcher__item'))
      .find(el => el.textContent?.includes('添加'))
    expect(addItem).toBeTruthy()

    fireEvent.click(addItem!)
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesPet/add/index' })
  })

  it('头像走统一口径：有真实照片时优先显示照片', async () => {
    const withPhoto = { ...mockPet, avatarPhotoUrl: 'https://example.com/photo.jpg' }
    petStoreState.currentPet = withPhoto
    petStoreState.pets = [withPhoto]

    const { container } = await renderPage()

    const img = container.querySelector('.today-petcard__avatar-img') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('https://example.com/photo.jpg')
  })

  it('头像走统一口径：没设过任何自定义形象时用按品种匹配的品牌头像（不是留空）', async () => {
    const { container } = await renderPage()

    const img = container.querySelector('.today-petcard__avatar-img') as HTMLImageElement | null
    expect(img).not.toBeNull()
    // 金毛 → dog-01-golden（resolvePetAvatarUrl 的第三级兜底）
    expect(img!.getAttribute('src')).toContain('/uploads/avatars/home-style/dog/dog-01-golden.png')
  })

  it('头像加载失败 → 退回物种 emoji（狗 🐕），头像位不留空', async () => {
    const { container } = await renderPage()

    const img = container.querySelector('.today-petcard__avatar-img')
    expect(img).toBeTruthy()
    fireEvent.error(img!)

    expect(container.querySelector('.today-petcard__avatar-emoji')?.textContent).toBe('🐕')
  })

  it('猫科宠物头像失败退回 🐱（物种 emoji 分种，不再一律 🐾）', async () => {
    petStoreState.currentPet = mockPet2
    petStoreState.pets = [mockPet2]

    const { container } = await renderPage()

    fireEvent.error(container.querySelector('.today-petcard__avatar-img')!)
    expect(container.querySelector('.today-petcard__avatar-emoji')?.textContent).toBe('🐱')
  })

  it('猫狗之外的物种头像失败退回 🐾（保留旧的兜底口径）', async () => {
    const rabbit = { ...mockPet, species: 'rabbit' as any, breed: '垂耳兔' }
    petStoreState.currentPet = rabbit
    petStoreState.pets = [rabbit]

    const { container } = await renderPage()

    fireEvent.error(container.querySelector('.today-petcard__avatar-img')!)
    expect(container.querySelector('.today-petcard__avatar-emoji')?.textContent).toBe('🐾')
  })
})

// ============================================================
// 今日健康摘要
// ============================================================
describe('今天页 · 今日健康摘要', () => {
  it('今天已打卡 → 渲染健康分与便便/食欲/精神/体重（分数用真实口径折算）', async () => {
    // 便便偏软(4)→3 分、食欲正常(3)→5 分、精神正常(3)→5 分 = 13/15 → 87 分
    mockGetTodayCheckin.mockResolvedValue(
      checkinEntry({ poopLevel: 4, appetiteLevel: 3, spiritLevel: 3, weight: 25.5 }),
    )

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelector('.today-health__score')?.textContent).toBe('87')
    })

    const rows = Array.from(container.querySelectorAll('.today-health__row'))
    const rowText = (i: number) => rows[i].textContent || ''
    // 便便：等级 / 5 次 + 中文档位（4=偏软）
    expect(rowText(0)).toContain('4/5 次')
    expect(rowText(0)).toContain('偏软')
    // 食欲 + 精神在同一行
    expect(rowText(1)).toContain('正常')
    // 体重带单位
    expect(rowText(2)).toContain('25.5 kg')
    // 已经打过卡，就不该再出现"今天还没打卡"的引导
    expect(container.querySelector('.today-health__hint')).toBeFalsy()
  })

  it('今天没打卡 → 分数与各指标显示「--」，并给出打卡引导', async () => {
    mockGetTodayCheckin.mockResolvedValue(null)

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelector('.today-health__hint')).toBeTruthy()
    })

    expect(container.querySelector('.today-health__score')?.textContent).toBe('--')
    expect(container.querySelector('.today-health__hint')?.textContent)
      .toContain('今天还没打卡')
    // 指标位全部是占位符，不拿 0 冒充数据
    const vals = Array.from(container.querySelectorAll('.today-health__val'))
    expect(vals.length).toBeGreaterThan(0)
    vals.forEach(v => expect(v.textContent).toBe('--'))
  })

  it('今日摘要求数失败时按"没打卡"降级，不白屏也不抛错', async () => {
    mockGetTodayCheckin.mockRejectedValue(new Error('network down'))

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelector('.today-health__hint')).toBeTruthy()
    })
    expect(container.querySelector('.today-health__score')?.textContent).toBe('--')
    // 页面主体仍在
    expect(container.querySelector('.today-cta')).toBeTruthy()
  })

  it('有 ≥7 天前的体重记录 → 渲染「较上周 +N」', async () => {
    mockGetTodayCheckin.mockResolvedValue(checkinEntry({ weight: 25.5 }))
    mockGetCheckins.mockResolvedValue([
      checkinEntry({ id: 'ck_old', weight: 24.5, createdAt: dateOffsetFromToday(-8) }),
      checkinEntry({ id: 'ck_new', weight: 25.5, createdAt: new Date() }),
    ])

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelector('.today-health__delta')?.textContent).toBe('+1')
    })
    expect(container.textContent).toContain('较上周')
  })

  it('没有可比对的上一周体重 → 不渲染「较上周」这一段', async () => {
    mockGetTodayCheckin.mockResolvedValue(checkinEntry({ weight: 25.5 }))
    // 只有一条有体重的记录 → 找不到 7 天前的参照值
    mockGetCheckins.mockResolvedValue([checkinEntry({ id: 'ck_new', weight: 25.5, createdAt: new Date() })])

    const { container } = await renderPage()

    expect(container.textContent).not.toContain('较上周')
  })

  it('点「健康档案 ›」跳宠物档案页（IA：健康数据的唯一归处）', async () => {
    const { container } = await renderPage()

    const more = container.querySelector('.today-sec__more')
    expect(more).toBeTruthy()
    fireEvent.click(more!)

    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pages/pet-profile/index' })
  })

  it('点摘要卡本体也跳宠物档案页（不再打开打卡弹窗）', async () => {
    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.today-health')!)

    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pages/pet-profile/index' })
    // 摘要卡不再是打卡入口：全站打卡只留 CTA 一条路
    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeFalsy()
  })
})

// ============================================================
// 健康打卡 CTA
// ============================================================
describe('今天页 · 健康打卡 CTA', () => {
  it('默认不渲染打卡弹窗', async () => {
    const { container } = await renderPage()

    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeFalsy()
  })

  it('点「健康打卡」CTA 打开弹窗，点关闭收起', async () => {
    const { container } = await renderPage()

    const cta = container.querySelector('.today-cta')
    expect(cta).toBeTruthy()
    expect(cta!.textContent).toContain('健康打卡')
    expect(cta!.textContent).toContain('去打卡')

    fireEvent.click(cta!)
    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeTruthy()

    fireEvent.click(container.querySelector('[data-testid="checkin-close"]')!)
    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeFalsy()
  })

  it('打卡完成后重新拉一次今日摘要（页面上没有聊天流可追加消息）', async () => {
    const { container } = await renderPage()

    await waitFor(() => expect(mockGetTodayCheckin).toHaveBeenCalledTimes(1))

    fireEvent.click(container.querySelector('.today-cta')!)
    fireEvent.click(container.querySelector('[data-testid="checkin-complete"]')!)

    await waitFor(() => expect(mockGetTodayCheckin).toHaveBeenCalledTimes(2))
  })
})

// ============================================================
// 今天还有这些事（疫苗 / 驱虫待办）
// ============================================================
describe('今天页 · 今天还有这些事', () => {
  it('有逾期 + 即将到期 → 各渲染一条，标题/副文案/状态胶囊按口径出', async () => {
    mockGetOverdueRecords.mockResolvedValue([vaccineRecord({ id: 'v_over', category: 'rabies', date: '2025-01-05' })])
    mockGetUpcomingRecords.mockResolvedValue([
      vaccineRecord({ id: 'v_soon', category: 'internal_deworm', nextDate: dateOffsetFromToday(10) }),
    ])

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelectorAll('.today-todo')).toHaveLength(2)
    })

    const todos = Array.from(container.querySelectorAll('.today-todo'))
    expect(todos[0].textContent).toContain('狂犬疫苗')
    expect(todos[0].textContent).toContain('上次 1 月 5 日 · 已逾期')
    expect(todos[0].textContent).toContain('该做了')

    expect(todos[1].textContent).toContain('体内驱虫')
    expect(todos[1].textContent).toContain('还有 10 天到期')
    expect(todos[1].textContent).toContain('提前提醒')

    // 到期窗口按 30 天查（口径写死在页面里，这里钉住它不被悄悄改成别的天数）
    expect(mockGetUpcomingRecords).toHaveBeenCalledWith('pet_001', 30)
  })

  it('后端新增的分类（中文表里没有）原样显示分类码，不留空标题', async () => {
    mockGetOverdueRecords.mockResolvedValue([vaccineRecord({ id: 'v_x', category: 'new_vaccine_x' })])

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelector('.today-todo')).toBeTruthy()
    })
    expect(container.querySelector('.today-todo__title')?.textContent).toBe('new_vaccine_x')
  })

  it('没有任何疫苗/驱虫记录 → 整块不渲染（不显示空壳提醒）', async () => {
    mockGetOverdueRecords.mockResolvedValue([])
    mockGetUpcomingRecords.mockResolvedValue([])

    const { container } = await renderPage()

    expect(container.querySelector('.today-todo')).toBeFalsy()
    expect(container.textContent).not.toContain('今天还有这些事')
  })

  it('待办取数失败时按"没有待办"处理，不抛错', async () => {
    mockGetOverdueRecords.mockRejectedValue(new Error('boom'))
    mockGetUpcomingRecords.mockRejectedValue(new Error('boom'))

    const { container } = await renderPage()

    expect(container.querySelector('.today-todo')).toBeFalsy()
    expect(container.querySelector('.today-cta')).toBeTruthy()
  })

  it('点某条待办 → 跳疫苗日历页', async () => {
    mockGetOverdueRecords.mockResolvedValue([vaccineRecord({ id: 'v_over' })])

    const { container } = await renderPage()

    await waitFor(() => expect(container.querySelector('.today-todo')).toBeTruthy())
    fireEvent.click(container.querySelector('.today-todo')!)

    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesPet/vaccine/index' })
  })
})

// ============================================================
// 快捷功能（只留非 AI 的日常动作）
// ============================================================
describe('今天页 · 快捷功能', () => {
  it('渲染 4 个入口，并标注 AI 能力已收进团团', async () => {
    const { container } = await renderPage()

    const gridItems = Array.from(container.querySelectorAll('.today-grid__item'))
    expect(gridItems).toHaveLength(4)
    const labels = gridItems.map(el => el.querySelector('.today-grid__title')?.textContent)
    expect(labels).toEqual(['健康趋势', '宠物档案', '时光', '做回忆录'])

    expect(container.querySelector('.today-sec__note')?.textContent).toBe('AI 的都收进团团了')
  })

  it('四个入口分别跳 趋势 / 档案 / 时光（switchTab）/ 回忆录馆', async () => {
    const { container } = await renderPage()

    const gridItems = container.querySelectorAll('.today-grid__item')
    const titles = ['健康趋势', '宠物档案', '时光', '做回忆录']

    fireEvent.click(gridItems[0])
    expect(mockNavigateTo).toHaveBeenLastCalledWith({ url: '/pagesPet/trends/index' })

    fireEvent.click(gridItems[1])
    expect(mockNavigateTo).toHaveBeenLastCalledWith({ url: '/pages/pet-profile/index' })

    // 时光是 tab 页：只能 switchTab（用 navigateTo 会静默失败）
    fireEvent.click(gridItems[2])
    expect(mockSwitchTab).toHaveBeenLastCalledWith({ url: '/pages/timeline/index' })

    fireEvent.click(gridItems[3])
    expect(mockNavigateTo).toHaveBeenLastCalledWith({ url: '/pagesMemoir/memoir-center/index' })

    // 四个入口都点过一遍，文案与序号一致（防止顺序漂移后用例却仍绿）
    expect(titles).toHaveLength(4)
  })
})

// ============================================================
// 共同养宠引导横幅
// ============================================================
describe('今天页 · 邀请 TA 一起养宠', () => {
  it('家庭成员只有自己（≤1 人）→ 显示横幅，点击跳家庭页', async () => {
    familyState.users = []

    const { container } = await renderPage()

    const tip = container.querySelector('.home-co-care-tip')
    expect(tip).toBeTruthy()
    expect(tip!.textContent).toContain('邀请 TA 一起养宠')

    fireEvent.click(tip!)
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pages/family/index' })
  })

  it('点横幅上的 ✕ 只关闭横幅，不触发跳转', async () => {
    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.home-co-care-tip__close')!)

    expect(container.querySelector('.home-co-care-tip')).toBeFalsy()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('家庭成员多于自己（>1 人）→ 不显示横幅', async () => {
    familyState.users = [{ userId: 'user_1' }, { userId: 'user_2' }]

    const { container } = await renderPage()

    expect(container.querySelector('.home-co-care-tip')).toBeFalsy()
  })
})

// ============================================================
// 主题与插画
// ============================================================
describe('今天页 · 主题与插画', () => {
  it('根容器带当前主题类名（颜色随主题变量走，不写死 hex）', async () => {
    const { container } = await renderPage()

    const root = container.querySelector('.today-page')
    expect(root).toBeTruthy()
    expect(root!.className).toContain('theme-autumn')
  })

  it('「{宠物名} 的今天」卡：四季插画 + 压在画上的身份条，且不再有独立口号块', async () => {
    const { container } = await renderPage()

    // 插画走服务器 URL 的 Illustration 组件（主包零新增图片），落在 .today-hero__art
    const art = container.querySelector('.today-hero__art')
    expect(art).toBeTruthy()
    expect(art!.className).toContain('illustration')
    expect(art!.getAttribute('src')).toBeTruthy()

    // 【护栏：插画必须铺满整卡、不许留白带】锁的就是用户 2026-09-12 真机那条诉求
    // （「这个图片要放满整个控件」）对应的修复：容器已改成「按宽度撑出的 1:1 比例盒」+ 插画绝对定位铺满，
    // 而 slot 资产 today-brand-* 与容器同为 1:1 → 只有 `aspectFill` 才是"既铺满又零裁切"；
    // 一旦有人把 mode 退回 `aspectFit`，框与图的微小差异会重新变成可见的白带 —— 这条断言就会红。
    // 断言可直接落在 `.today-hero__art` 上：该元素就是 <Image> 本身（className 由 Illustration 透传），
    // 而本文件 :116 的 Image mock 已把 mode 透传成 data-mode。
    expect(art!.getAttribute('data-mode')).toBe('aspectFill')

    // 2026-09-12 重构：宠物卡与品牌 Hero 合成一张卡 —— 插画在下、身份条压在其下沿。
    // 身份条必须**在** .today-hero 里面（压在插画上），而不是另起一张白卡
    const hero = container.querySelector('.today-hero') as HTMLElement
    expect(hero).toBeTruthy()
    expect(hero.querySelector('.today-petcard')).toBeTruthy()
    expect(hero.querySelector('.today-petcard__name')?.textContent).toBe('旺财')

    // 关键回归：原来那个"插画 + 口号"的宣传块已删除（用户："看起来像广告"）——
    // 口号句本身留在新手引导页，不再出现在今天页
    expect(container.querySelector('.today-hero__cap')).toBeFalsy()
    expect(container.textContent).not.toContain('把它的可爱')
  })
})

/* ============================================================
 * 用例迁移对照（第 4 批：AI 对话搬到团团页）
 * ------------------------------------------------------------
 * A. 原样保留（仍锁今天页的既有契约）
 *    · calcAge → formatPetAge 的 5 条           : 保留（仍在本文件，页面继续用它渲染年龄）
 *    · 加载态骨架屏 / 空态文案 / 空态添加按钮跳转 : 保留
 *    · 有宠物时 isLoading 不显示骨架屏            : 保留
 *    · 打卡弹窗默认不渲染                         : 保留
 *
 * B. 按新结构重写（覆盖意图不变，选择器/断言换新）
 *    · 「点击『3秒健康打卡』主按钮打开弹窗」.home-checkin-cta
 *        → 「点『健康打卡』CTA 打开弹窗」.today-cta（新类名）
 *    · 「点击今日健康摘要卡打开弹窗」.home-summary-card
 *        → 摘要卡现在是「去宠物档案」的入口，改为断言 navigateTo pet-profile（行为已变，不是漏测）
 *    · 头像两条（照片优先 / 卡通形象）  .home-summary-avatar-img
 *        → .today-petcard__avatar-img，并补上"无自定义形象时用品牌品种头像"这条第三级兜底
 *    · 🐾 emoji 三条（狗/猫/未知物种统一 🐾）
 *        → 新实现只在**头像加载失败**时才退回 emoji，且按物种分（🐕/🐱/🐾），故重写为
 *          「加载失败退回物种 emoji」三条（狗 / 猫 / 未知物种）+ 品牌头像一条
 *    · 「点击快捷操作『健康打卡』」+「点击『3秒健康打卡』主按钮」原为 2 条
 *        → 收敛成 1 条：新页面全站只剩一个打卡入口（IA 第 4 批"打卡两入口合并"的落点），
 *          两个旧选择器在新的今天页都属于同一个 .today-cta
 *
 * C. 已随 AI 对话搬到团团页而移除（对照组在 pagesYuantuan/agent/__tests__）
 *    1. PLUS_MENU_ITEMS 4 条 —— 加号面板整体搬走，且常量的内容也变了
 *       （现为 6 项：拍摄照片/相册图片/健康打卡/记录回忆/品种百科/看家庭）。
 *       ⚠️ 旧测试是"从源码复制常量再断言自己"，属假绿，本就不该留在页面测试里。
 *    2. 「症状初筛」弹窗 2 条（默认不渲染 + 快捷入口打开）—— 症状初筛入口已收进团团能力条。
 *    3. 长对话软提示 2 条（<60 不显示 / ≥60 显示）—— 多会话是 AI 对话概念，随对话搬走。
 *    4. 新建对话入口 2 条（顶部常驻「新建」/ 点击新建会话）—— 同上，现为团团顶栏「新建」。
 * ============================================================ */
