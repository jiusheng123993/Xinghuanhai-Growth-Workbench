/**
 * 宠物档案页（高保真 v2 · 屏 06）单元测试
 *
 * 覆盖三层：
 *  1) 纯函数：日期与年龄格式化（口径见 utils/date 的 formatPetAge）；
 *  2) v2 结构：宽幅页头（品牌 IP 插画 + 宠物身份三段式）、两组 menulist 的 8 条文案、
 *     组头「全部 ›」、健康数据缺失时给下一步动作而不是 --；
 *  3) 必须保住的能力与关键交互：换头像入口（第二组那一行）、真实路由跳转、多宠物切换、品种特征匹配、
 *     它的小习惯、标记离世的两次确认 + 输入宠物名比对、登录守卫、空态、加载态。
 *
 * 【为什么逐条断言路由】本页 8 条清单**全部**指向分包页，路由写错在测试里不会报错、
 * 在真机上却是「点了没反应」（微信对不存在的路由只会静默失败）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
// vi.mock 会被 vitest 提升到所有 import 之前，因此这里可以正常把页面放在顶部导入
import PetProfile, { formatDate, calcAge } from '../index'

// —— Taro 基础组件 → DOM 元素，便于用 testing-library 断言 ——
vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick, hoverClass }: any) => (
    <div className={className} style={style} data-hover={hoverClass} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
  ScrollView: ({ children, className }: any) => <div className={className}>{children}</div>,
  // 必须透传 mode 与 onError：否则「页头插画按原图比例（widthFix）」「加载失败不再渲染」两条路径都测不到
  Image: ({ src, className, mode, onError, ...rest }: any) => (
    <img className={className} src={src} alt='' data-mode={mode} onError={onError} {...rest} />
  ),
}))

// —— 用 vi.hoisted 暴露给用例断言（vi.mock 的工厂会被提升，不能直接引用外层变量） ——
const taro = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  showModal: vi.fn(),
  showToast: vi.fn(),
}))
const guard = vi.hoisted(() => ({ redirectToLoginIfNeeded: vi.fn() }))
const store = vi.hoisted(() => ({
  pets: [] as any[],
  currentPet: null as any,
  users: [] as any[],
  fetchPets: vi.fn().mockResolvedValue(undefined),
  switchPet: vi.fn(),
  markPetDeceased: vi.fn().mockResolvedValue(undefined),
}))
const auth = vi.hoisted(() => ({ isAuthenticated: true, isInitialized: true }))
const breeds = vi.hoisted(() => ({ list: [] as any[] }))
// 三个取数服务的可控句柄：默认值在 beforeEach 里恢复
const petSvc = vi.hoisted(() => ({ getPetFacts: vi.fn() }))
const checkinSvc = vi.hoisted(() => ({
  getCheckinStats: vi.fn(),
  getCheckinsByDateRange: vi.fn(),
  getLatestCheckin: vi.fn(),
  calcHealthScore: vi.fn(),
}))
const vaccineSvc = vi.hoisted(() => ({ getVaccineRecords: vi.fn() }))

vi.mock('@tarojs/taro', () => ({ default: taro }))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({ user: { id: 'user_001' }, isAuthenticated: auth.isAuthenticated, isInitialized: auth.isInitialized }),
}))

vi.mock('../../../stores/petStore', () => {
  const usePetStore: any = () => ({
    pets: store.pets,
    currentPet: store.currentPet,
    fetchPets: store.fetchPets,
    switchPet: store.switchPet,
    markPetDeceased: store.markPetDeceased,
  })
  // 切换宠物失败提示那条分支读的是 store 的 error 字段
  usePetStore.getState = () => ({ error: null })
  return { usePetStore }
})

vi.mock('../../../stores/familyStore', () => {
  const useFamilyStore: any = (selector: any) => selector({ users: store.users })
  useFamilyStore.getState = () => ({ currentFamily: null, fetchUsers: vi.fn() })
  return { useFamilyStore }
})

// 本页订阅主题只为一个用途：给页头插画拼四季 URL（useThemeKey）
vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => 'theme-autumn',
  useThemeKey: () => 'autumn',
}))
vi.mock('../../../utils/authGuard', () => guard)
vi.mock('../../index.scss', () => ({}))

vi.mock('../../../services/petService', () => ({ getPetFacts: petSvc.getPetFacts }))
vi.mock('../../../services/checkinService', () => ({
  getCheckinStats: checkinSvc.getCheckinStats,
  getCheckinsByDateRange: checkinSvc.getCheckinsByDateRange,
  getLatestCheckin: checkinSvc.getLatestCheckin,
  calcHealthScore: checkinSvc.calcHealthScore,
}))
vi.mock('../../../services/vaccineService', () => ({ getVaccineRecords: vaccineSvc.getVaccineRecords }))
vi.mock('../../../data/petKnowledge/breedsLight', () => ({ BREED_LIGHT: breeds.list }))

vi.mock('../../../components/PageLoading', () => ({ default: () => <div>loading</div> }))
vi.mock('../../../components/PageBackground', () => ({ default: () => null }))
vi.mock('../../../components/PetAvatar', () => ({
  // 名字放在 data-pet 属性而不是文本里：宠物名在本页会出现在页头、头像位、切换器三处，
  // mock 再把名字渲染成文本就会让 findByText('小橘') 命中多个元素、把用例逼成 getAllBy。
  // 断言切换器名字的用例查的是 .pf-switch-name 文本，不受这里影响。
  default: ({ petName, className }: any) => (
    <span data-testid='pet-avatar' className={className} data-pet={petName} />
  ),
}))
vi.mock('../../../components', () => ({
  // 只渲染 data-icon 属性，便于断言「这个位置用的是 Icon 而不是 emoji」
  Icon: ({ name, className }: any) => <span className={className} data-icon={name} />,
  EmptyState: ({ title, actionText }: any) => (
    <div data-testid='empty-state'>{title}|{actionText}</div>
  ),
  Illustration: ({ name }: any) => <div data-testid='illustration' data-name={name} />,
}))

const petBase = {
  id: 'pet_001',
  userId: 'user_001',
  name: '小橘',
  species: 'cat' as const,
  breed: '中华田园猫',
  breedId: 'chinese_tabby',
  gender: 'male' as const,
  birthDate: '2023-05-12',
  weight: 4.2,
  coatColor: '橘色虎斑',
  isNeutered: true,
  microchipId: '',
  notes: '',
  isDeceased: false,
  allergies: [] as string[],
  medications: [] as string[],
  chronicConditions: [] as string[],
  // 建档时间：页头的「已陪伴 N 天」以它为起算点（口径同 pages/mine 的养宠时长）
  createdAt: '2025-09-12T00:00:00.000Z',
}

/** 本页 8 条清单全部有真实页面（2026-09-12 收口补上了「生日与纪念日」），逐条钉住落点 */
const REAL_ROUTES: Array<[string, string]> = [
  ['健康趋势与报告', '/pagesPet/trends/index'],
  ['疫苗日历', '/pagesPet/vaccine/index'],
  ['慢病记录', '/pagesPet/chronic-tracking/index'],
  ['喂养记录', '/pagesPet/feeding-advice/index'],
  ['生日与纪念日', '/pagesPet/anniversary/index'],
  ['形象与头像', '/pagesPet/avatar-customize/index'],
  ['家庭成员与血缘', '/pagesPet/family/lineage/index'],
  ['编辑档案', '/pagesPet/edit/index'],
]

beforeEach(() => {
  store.pets = [{ ...petBase }]
  store.currentPet = store.pets[0]
  store.users = []
  auth.isAuthenticated = true
  auth.isInitialized = true
  // 原地清空（mock 工厂持有的是同一个数组引用）
  breeds.list.length = 0
  petSvc.getPetFacts.mockReset().mockResolvedValue([])
  checkinSvc.getCheckinStats.mockReset().mockResolvedValue({ streak: 12 })
  checkinSvc.getCheckinsByDateRange.mockReset().mockResolvedValue([])
  checkinSvc.getLatestCheckin.mockReset().mockResolvedValue(null)
  checkinSvc.calcHealthScore.mockReset().mockReturnValue(86)
  vaccineSvc.getVaccineRecords.mockReset().mockResolvedValue([])
  taro.showModal.mockReset()
  taro.showToast.mockReset()
  taro.navigateTo.mockReset()
  store.markPetDeceased.mockClear()
  guard.redirectToLoginIfNeeded.mockClear()
})
// ---------------------------------------------------------------------------
// 1. 纯函数
// ---------------------------------------------------------------------------
describe('formatDate', () => {
  it('should format an ISO date to YYYY-MM-DD', () => {
    expect(formatDate('2023-05-12T00:00:00.000Z')).toMatch(/^2023-05-1[12]$/)
  })

  it('should return 未设置 for an empty value', () => {
    expect(formatDate('')).toBe('未设置')
  })

  it('should keep the raw prefix for an unparsable value', () => {
    // 注意：'2023/05/12' 是能被 Date 解析的，这里必须用真正解析不了的字符串
    expect(formatDate('出生日期不详')).toBe('出生日期不详')
  })
})

/**
 * 造一个「n 个月前」的日期：用当月 1 号。
 * 既避开 setMonth 的月末溢出，也保证任何一天（必然 ≥ 1 号）都算满整月，
 * 期望值不会随「今天几号」抖动。
 */
function monthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return d.toISOString()
}

describe('calcAge', () => {
  it('should return months when younger than one year', () => {
    expect(calcAge(monthsAgo(5))).toBe('5个月')
  })

  it('should return years and months for an older pet', () => {
    // 统一后的格式是「1岁3个月」（旧实现输出「1岁3月」）
    expect(calcAge(monthsAgo(15))).toBe('1岁3个月')
  })

  it('should return an empty string when birth date is missing', () => {
    expect(calcAge('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 2. v2 结构：宽幅页头 + 两组 menulist
// ---------------------------------------------------------------------------
describe('PetProfile v2 页头', () => {
  it('should render the brand IP hero illustration at its natural ratio', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    const art = document.querySelector('.pf-hero__art') as HTMLImageElement
    expect(art).toBeTruthy()
    // 四季插画按主题取图（本用例把主题钉成 autumn）
    expect(art.getAttribute('src')).toContain('/uploads/illustrations/seasonal/pet-profile-autumn-hero.jpg')
    // widthFix = 按原图比例铺满宽度；方形插画用 aspectFill 会裁掉主体的头顶与笔记本
    expect(art.getAttribute('data-mode')).toBe('widthFix')
  })

  it('should show 品种 · 年龄 · 已陪伴 N 天 in the hero identity line', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    const meta = document.querySelector('.pf-hero__meta') as HTMLElement
    expect(meta.textContent).toContain('中华田园猫')
    expect(meta.textContent).toMatch(/已陪伴 \d+ 天/)
  })

  it('should drop the companion segment instead of showing 0 天 when createdAt is missing', async () => {
    store.pets = [{ ...petBase, createdAt: '' }]
    store.currentPet = store.pets[0]
    render(<PetProfile />)
    await screen.findByText('小橘')
    const meta = document.querySelector('.pf-hero__meta') as HTMLElement
    expect(meta.textContent).not.toContain('已陪伴')
    expect(meta.textContent).not.toContain('0 天')
  })

  it('should drop the hero avatar button (v2 没画) but keep 换头像 via 形象与头像 行', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    // v2 的页头只有名字 + 身份行，2026-09-12 收口按 v2 撤掉了头像圆钮
    expect(document.querySelector('.pf-hero__avatar')).toBeNull()
    // 能力没丢：形象定制（换头像 / 换形象）仍是第二组那一行的真实落点
    fireEvent.click(screen.getByText('形象与头像'))
    expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/avatar-customize/index' })
  })

  it('should hide the hero illustration instead of showing a broken image on error', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    fireEvent.error(document.querySelector('.pf-hero__art') as HTMLImageElement)
    expect(document.querySelector('.pf-hero__art')).toBeNull()
    // 文字层仍在（页头不会因为少一张图而塌掉）
    expect(document.querySelector('.pf-hero__name')).toBeTruthy()
  })
})

describe('PetProfile v2 两组 menulist', () => {
  it('should render both groups with the v2 section titles', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    expect(screen.getByText('健康档案')).toBeTruthy()
    // 第二组标题是「关于 + 当前宠物名」，多宠物下不会挂错名字
    expect(screen.getByText('关于小橘')).toBeTruthy()
  })

  it('should render all 8 v2 menu labels', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    for (const [label] of REAL_ROUTES) expect(screen.getByText(label)).toBeTruthy()
    // 两组各 4 行，图标位共 8 个（健康备忘 / 品种特征那几组是 pf-menu__item--static，另有图标）
    expect(document.querySelectorAll('.pf-sec .pf-menu__item:not(.pf-menu__item--static) .pf-menu__icon [data-icon]').length).toBe(8)
  })

  it('should navigate every row that has a real page to that exact route', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    for (const [label, url] of REAL_ROUTES) {
      taro.navigateTo.mockClear()
      fireEvent.click(screen.getByText(label))
      expect(taro.navigateTo).toHaveBeenCalledWith({ url })
    }
  })

  it('should navigate 生日与纪念日 to the real anniversary page', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    const row = screen.getByText('生日与纪念日').closest('.pf-menu__item') as HTMLElement
    // 8 行全部有落点：既没有「即将上线」胶囊，也没有降权态
    expect(screen.queryByText('即将上线')).toBeNull()
    expect(row.className).not.toContain('soon')
    fireEvent.click(screen.getByText('生日与纪念日'))
    expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/anniversary/index' })
  })

  it('should render the v2 「全部 ›」 in the 健康档案 group head and open 趋势页', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    const more = document.querySelector('.pf-sec__more') as HTMLElement
    expect(more).toBeTruthy()
    // 文案与 v2 原型逐字一致（字面量 › 而不是箭头图标，与 pages/mine、pages/creative 的组头引导字同款）
    expect(more.textContent).toBe('全部 ›')
    // 只有第一组有（v2 的「关于 {名}」组头没有这一枚）
    expect(document.querySelectorAll('.pf-sec__more').length).toBe(1)
    // 真入口：点了要跳到趋势页（不是纯展示的假按钮）
    fireEvent.click(more)
    expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/trends/index' })
  })
})

// ---------------------------------------------------------------------------
// 3. 既有能力与关键交互
// ---------------------------------------------------------------------------
describe('PetProfile 既有能力', () => {
  it('should show next-step hints instead of bare dashes when health data is missing', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    const values = Array.from(document.querySelectorAll('.pf-metric__value, .pf-metric__empty')).map(n => n.textContent)
    expect(values).toEqual(['打卡后生成', '12天', '暂无记录'])
    expect(document.body.textContent).not.toContain('--')
  })

  it('should render real numbers when checkin and vaccine data exist', async () => {
    checkinSvc.getLatestCheckin.mockResolvedValue({ poopLevel: 1, appetiteLevel: 1, spiritLevel: 1 })
    vaccineSvc.getVaccineRecords.mockResolvedValue([{ status: 'completed' }, { status: 'pending' }])
    render(<PetProfile />)
    await screen.findByText('小橘')
    // 等两批异步取数落地（打分 / 疫苗覆盖各一次 setState）
    await new Promise(r => setTimeout(r, 0))
    const values = Array.from(document.querySelectorAll('.pf-metric__value, .pf-metric__empty')).map(n => n.textContent)
    expect(values).toEqual(['86分', '12天', '50%'])
  })

  it('should match breed traits from the breed knowledge base', async () => {
    // 注意：mock 工厂在导入时就捕获了数组引用，这里必须原地 push（重新赋值 breeds.list 不会生效）
    breeds.list.push({
      name: '中华田园猫',
      aliases: [],
      geneticDiseases: ['多囊肾'],
      weightRangeStr: '3-5kg',
      dietRestrictions: ['洋葱'],
    })
    render(<PetProfile />)
    await screen.findByText('小橘')
    expect(screen.getByText('多囊肾')).toBeTruthy()
    expect(screen.getByText('3-5kg')).toBeTruthy()
    expect(screen.getByText('洋葱')).toBeTruthy()
  })

  it('should render 它的小习惯 only when there are facts', async () => {
    const first = render(<PetProfile />)
    await screen.findByText('小橘')
    expect(screen.queryByText('它的小习惯')).toBeNull()
    first.unmount()

    petSvc.getPetFacts.mockResolvedValue([
      { id: 1, petId: 'pet_001', category: 'like', fact: '爱吃冻干', createdAt: '2026-01-01' },
    ])
    render(<PetProfile />)
    expect(await screen.findByText('爱吃冻干')).toBeTruthy()
    expect(screen.getByText('它的小习惯')).toBeTruthy()
  })

  it('should use Icon components instead of functional emoji', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    // 两组清单 8 行 + 状态图标位都由 Icon 渲染
    expect(document.querySelectorAll('.pf-menu__icon [data-icon]').length).toBeGreaterThanOrEqual(8)
    // 功能性 emoji 不应出现在渲染文本里
    const text = document.body.textContent || ''
    for (const e of ['📷', '🩺', '📔', '🎨', '🚫', '💊', '🪪', '📈', '💉']) {
      expect(text.includes(e)).toBe(false)
    }
  })

  it('should hide the pet switcher when there is only one pet', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    expect(document.querySelector('.pf-switcher')).toBeNull()
  })

  it('should show the pet switcher when there are multiple pets', async () => {
    store.pets = [
      { ...petBase },
      { ...petBase, id: 'pet_002', name: '旺财', species: 'dog' as const },
    ]
    render(<PetProfile />)
    await screen.findAllByText('小橘')
    expect(document.querySelector('.pf-switcher')).toBeTruthy()
    // 精确断言切换器里的名字文本，而不是 getAllByText('旺财').length > 0
    // （PetAvatar 的 mock 把 petName 放在 data-pet 属性上，那种断言即使切换器不渲染名字也会通过）
    const names = Array.from(document.querySelectorAll('.pf-switch-name')).map(n => n.textContent)
    expect(names).toEqual(['小橘', '旺财'])
  })

  it('should keep the mark-deceased entry available', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    expect(screen.getByText('标记宠物离世')).toBeTruthy()
  })

  it('should render the empty state and its CTA when there is no pet', async () => {
    store.pets = []
    store.currentPet = null
    render(<PetProfile />)
    const empty = await screen.findByTestId('empty-state')
    expect(empty.textContent).toContain('还没有添加宠物')
    expect(empty.textContent).toContain('添加宠物')
  })

  it('should stay in loading state until auth store is initialized', () => {
    auth.isInitialized = false
    render(<PetProfile />)
    expect(screen.getByText('loading')).toBeTruthy()
  })

  it('should hand off to the login guard when the user is not authenticated', async () => {
    auth.isAuthenticated = false
    render(<PetProfile />)
    // 未登录：不渲染宠物内容，交由收口守卫处理
    await new Promise(r => setTimeout(r, 0))
    expect(guard.redirectToLoginIfNeeded).toHaveBeenCalled()
    expect(screen.queryByText('关于小橘')).toBeNull()
  })
})

describe('PetProfile 标记宠物离世', () => {
  /** 让 showModal 按顺序回放预设的响应 */
  function mockModals(responses: Array<Record<string, unknown>>) {
    let i = 0
    taro.showModal.mockImplementation((opts: any) => {
      const res = responses[i++] ?? { cancel: true }
      opts?.success?.(res)
      return Promise.resolve(res)
    })
  }

  it('should require the pet name to be typed before marking deceased', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    mockModals([
      { confirm: true },                       // 第一次确认
      { confirm: true, content: '小橘' },       // 第二次输入了正确名字
    ])
    fireEvent.click(screen.getByText('标记宠物离世'))
    await new Promise(r => setTimeout(r, 0))
    expect(taro.showModal).toHaveBeenCalledTimes(2)
    expect(store.markPetDeceased).toHaveBeenCalledTimes(1)
    expect(store.markPetDeceased.mock.calls[0][0]).toBe('pet_001')
    expect(taro.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '小橘已安息' }))
  })

  it('should abort when the typed name does not match', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    mockModals([
      { confirm: true },
      { confirm: true, content: '旺财' },
    ])
    fireEvent.click(screen.getByText('标记宠物离世'))
    await new Promise(r => setTimeout(r, 0))
    expect(store.markPetDeceased).not.toHaveBeenCalled()
    expect(taro.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '输入不正确，操作已取消' }))
  })

  it('should do nothing when the first confirmation is cancelled', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    mockModals([{ cancel: true }])
    fireEvent.click(screen.getByText('标记宠物离世'))
    await new Promise(r => setTimeout(r, 0))
    expect(taro.showModal).toHaveBeenCalledTimes(1)
    expect(store.markPetDeceased).not.toHaveBeenCalled()
  })
})
