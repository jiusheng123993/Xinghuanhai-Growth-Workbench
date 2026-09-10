/**
 * 宠物档案页（视觉方向 C · 温暖手账）单元测试
 *
 * 覆盖三层：
 *  1) 纯函数：封面图解析规则（照片 > AI 形象 > 品牌预设小图，永远非空）、封面渲染判定
 *     （有图就不渲染插画、加载失败退回插画、无图退回插画）、日期与年龄格式化；
 *  2) 渲染冒烟：无数据时数据带给出"下一步动作"而不是「--」、多宠物才出现切换器、
 *     危险操作仍在（改版不能把「标记宠物离世」这条通路弄丢）、功能性图标走 Icon 而不是 emoji；
 *  3) 关键交互：空态、登录守卫、品种特征匹配、标记离世的"两次确认 + 输入宠物名比对"。
 *
 * 【夹具注意】涉及"当前时间"的用例一律先把日号设成 15 再回退月份：
 * 直接 setMonth(-5) 在 7/29~7/31 这类日期会溢出到下月 1 号，期望值随日历变化而失败
 * （审查实测 2026 年有 8 个日期必然变红）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
// vi.mock 会被 vitest 提升到所有 import 之前，因此这里可以正常把页面放在顶部导入
import PetProfile, {
  formatDate,
  calcAge,
  resolveCoverImageUrl,
  resolveCoverImage,
  isBrandAvatarUrl,
} from '../index'

// —— Taro 基础组件 → DOM 元素，便于用 testing-library 断言 ——
vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
  ScrollView: ({ children, className }: any) => <div className={className}>{children}</div>,
  // 必须透传 onError：否则页面里"图片加载失败 → 退回插画"这条路径在测试里根本触发不了
  // （独立审查指出：不透传时 33 条用例全绿也拦不住"失败后照片位空白"这个退化）
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

vi.mock('@tarojs/taro', () => ({ default: taro }))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({ user: { id: 'user_001' }, isAuthenticated: auth.isAuthenticated, isInitialized: auth.isInitialized }),
}))

vi.mock('../../../stores/petStore', () => ({
  usePetStore: () => ({
    pets: store.pets,
    currentPet: store.currentPet,
    fetchPets: store.fetchPets,
    switchPet: store.switchPet,
    markPetDeceased: store.markPetDeceased,
  }),
}))

vi.mock('../../../stores/familyStore', () => {
  const useFamilyStore: any = (selector: any) => selector({ users: store.users })
  useFamilyStore.getState = () => ({ currentFamily: null, fetchUsers: vi.fn() })
  return { useFamilyStore }
})

vi.mock('../../../hooks/useThemeClass', () => ({ useThemeClass: () => '' }))
vi.mock('../../../utils/authGuard', () => guard)
vi.mock('../../index.scss', () => ({}))

vi.mock('../../../services/petService', () => ({ getPetFacts: vi.fn().mockResolvedValue([]) }))
vi.mock('../../../services/checkinService', () => ({
  getCheckinStats: vi.fn().mockResolvedValue({ streak: 12 }),
  getCheckinsByDateRange: vi.fn().mockResolvedValue([]),
  getLatestCheckin: vi.fn().mockResolvedValue(null),
  calcHealthScore: vi.fn(() => 86),
}))
vi.mock('../../../services/vaccineService', () => ({ getVaccineRecords: vi.fn().mockResolvedValue([]) }))
vi.mock('../../../data/petKnowledge/breedsLight', () => ({ BREED_LIGHT: breeds.list }))

vi.mock('../../../components/PageLoading', () => ({ default: () => <div>loading</div> }))
vi.mock('../../../components/PageBackground', () => ({ default: () => null }))
vi.mock('../../../components/PetAvatar', () => ({
  default: ({ petName }: any) => <span data-testid='pet-avatar'>{petName}</span>,
}))
vi.mock('../../../components', () => ({
  // 只渲染 data-icon 属性，便于断言"这个位置用的是 Icon 而不是 emoji"
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
}

beforeEach(() => {
  store.pets = [{ ...petBase }]
  store.currentPet = store.pets[0]
  store.users = []
  auth.isAuthenticated = true
  auth.isInitialized = true
  // 原地清空（mock 工厂持有的是同一个数组引用）
  breeds.list.length = 0
  taro.showModal.mockReset()
  taro.showToast.mockReset()
  taro.navigateTo.mockReset()
  store.markPetDeceased.mockClear()
  guard.redirectToLoginIfNeeded.mockClear()
})

// ---------------------------------------------------------------------------
// 1. 纯函数
// ---------------------------------------------------------------------------
describe('resolveCoverImageUrl', () => {
  it('should return the photo url when the pet has a real photo', () => {
    expect(resolveCoverImageUrl({ ...petBase, avatarPhotoUrl: 'https://cdn.example.com/a.png' }))
      .toBe('https://cdn.example.com/a.png')
  })

  it('should fall back to the AI cartoon url when there is no photo', () => {
    expect(resolveCoverImageUrl({ ...petBase, avatarCartoonUrl: 'https://cdn.example.com/b.png' }))
      .toBe('https://cdn.example.com/b.png')
  })

  it('should prefer the photo over the AI cartoon', () => {
    expect(resolveCoverImageUrl({
      ...petBase,
      avatarPhotoUrl: 'https://cdn.example.com/photo.png',
      avatarCartoonUrl: 'https://cdn.example.com/cartoon.png',
    })).toBe('https://cdn.example.com/photo.png')
  })

  it('should return the brand fallback avatar when the pet has no image of its own', () => {
    // 全站统一口径：任何宠物永远有一个"小动物"头像（品种兜底），所以这里不再是空串。
    // 页面上"用不用它当封面"由 resolveCoverImage 决定，不在这个函数里判。
    expect(resolveCoverImageUrl({ ...petBase, avatarPhotoUrl: null, avatarCartoonUrl: null }))
      .toContain('/uploads/avatars/home-style/cat/')
    expect(resolveCoverImageUrl(petBase)).toContain('/uploads/avatars/home-style/cat/')
  })

  it('should still return brand preset avatars — the user picked them, so the cover must show them', () => {
    // 回归锁（2026-09-11 用户实测）：以前这里判"品牌头像不当封面"直接回空串，
    // 于是用户在形象定制里选的预设形象在封面被一张通用插画顶掉，
    // 用户原话"我宠物是有头像的，这个不是头像，而是不知道哪来的图"。
    const serverPreset = 'https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01-orange-tabby.png'
    expect(resolveCoverImageUrl({ ...petBase, avatarCartoonUrl: serverPreset })).toBe(serverPreset)
    const localPreset = '/assets/preset-home/cat/cat-01-orange-tabby.png'
    expect(resolveCoverImageUrl({ ...petBase, avatarCartoonUrl: localPreset })).toBe(localPreset)
  })

  it('should still use a real photo even when a brand preset avatar also exists', () => {
    expect(resolveCoverImageUrl({
      ...petBase,
      avatarPhotoUrl: 'https://cdn.example.com/photo.png',
      avatarCartoonUrl: 'https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01-orange-tabby.png',
    })).toBe('https://cdn.example.com/photo.png')
  })
})

describe('resolveCoverImage', () => {
  it('should render the image and hide the illustration when a cover url exists', () => {
    expect(resolveCoverImage('https://cdn.example.com/photo.png'))
      .toEqual({ show: true, showIllustration: false })
  })

  it('should format/keep brand presets usable as covers (256x256 方图也照显示)', () => {
    expect(resolveCoverImage('https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01-orange-tabby.png'))
      .toEqual({ show: true, showIllustration: false })
  })

  it('should fall back to the brand illustration when there is no image at all', () => {
    expect(resolveCoverImage(''))
      .toEqual({ show: false, showIllustration: true })
  })

  it('should fall back to the brand illustration when the cover image failed to load', () => {
    // 回归锁（独立审查 P1）：图片 onError 后必须"不渲染图片 + 露出插画"，
    // 否则照片位会剩一块空相纸 —— 首版把失败态留在 jsx 里就是这么翻的车
    expect(resolveCoverImage('https://cdn.example.com/broken.png', true))
      .toEqual({ show: false, showIllustration: true })
    expect(resolveCoverImage('', true))
      .toEqual({ show: false, showIllustration: true })
  })
})

describe('isBrandAvatarUrl', () => {
  it('should detect server home-style avatars and local presets', () => {
    expect(isBrandAvatarUrl('https://api.xinghuanhai.com/uploads/avatars/home-style/dog/dog-01-golden.png')).toBe(true)
    expect(isBrandAvatarUrl('/assets/preset-home/cat/cat-09-chinese-tabby.png')).toBe(true)
  })

  it('should not flag user photos or AI generated avatars', () => {
    expect(isBrandAvatarUrl('https://api.xinghuanhai.com/uploads/pet-photos/u/p/a.jpg')).toBe(false)
    expect(isBrandAvatarUrl('https://api.xinghuanhai.com/uploads/avatars/gen/abc.png')).toBe(false)
  })

  it('should still detect brand avatars after the host or directory prefix changes', () => {
    // 判据只认路径段（与服务端 familyPhotoService.isBrandPresetUrl 同口径），
    // 品牌头像改走 CDN 时不会漏判 → 不会把 256px 小图拉成封面糊图
    expect(isBrandAvatarUrl('https://cdn.example.com/assets/home-style/cat/cat-01.png')).toBe(true)
  })
})

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

/** 造一个"n 个月前"的日期：先固定日号为 15，避开 setMonth 的月末溢出（否则期望值随日历抖动） */
function monthsAgo(n: number): string {
  const d = new Date()
  d.setDate(15)
  d.setMonth(d.getMonth() - n)
  return d.toISOString()
}

describe('calcAge', () => {
  it('should return months when younger than one year', () => {
    expect(calcAge(monthsAgo(5))).toBe('5个月')
  })

  it('should return years and months for an older pet', () => {
    expect(calcAge(monthsAgo(15))).toBe('1岁3月')
  })

  it('should not drift on month-end dates', () => {
    // 回归锁：以前用 setMonth 直接回退，7/31 会溢出成 4/30，算出 1岁2月
    const d = new Date()
    d.setDate(31)
    d.setMonth(d.getMonth() - 15)
    const months = (new Date().getFullYear() - d.getFullYear()) * 12 + (new Date().getMonth() - d.getMonth())
    expect(calcAge(d.toISOString())).toBe(`${Math.floor(months / 12)}岁${months % 12}月`)
  })

  it('should return an empty string when birth date is missing', () => {
    expect(calcAge('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 2. 渲染冒烟
// ---------------------------------------------------------------------------
describe('PetProfile 渲染', () => {
  it('should render the cover card with the pet name', async () => {
    render(<PetProfile />)
    expect(await screen.findByText('小橘')).toBeTruthy()
    expect(screen.getByText('宠物档案')).toBeTruthy()
    // 默认宠物没有任何自有形象 → 用品牌小动物头像兜底，且品牌插画不再同时渲染
    // （回归锁：以前封面把品牌头像判为"不合格"退回通用插画，用户看到的就是"不知道哪来的图"）
    const cover = document.querySelector('.pf-polaroid-img') as HTMLImageElement
    expect(cover).toBeTruthy()
    expect(cover.getAttribute('src')).toContain('/uploads/avatars/home-style/cat/')
    // 等比缩放：方形品牌头像靠 aspectFit + 相纸底色托底，不用 aspectFill 拉扁
    expect(cover.getAttribute('data-mode')).toBe('aspectFit')
    expect(screen.queryByTestId('illustration')).toBeNull()
  })

  it('should fall back to the brand illustration when the cover image fails to load', async () => {
    // 渲染级断言（独立审查 P1 的回归锁）：真触发 onError，再验证图片被卸载、插画出现。
    // 注意用 [data-role="cover"] 精确定位封面主图 —— 环境层与它同 src，靠 class 区分。
    const { container } = render(<PetProfile />)
    await screen.findByText('小橘')
    const cover = container.querySelector('[data-role="cover"]') as HTMLImageElement
    expect(cover).toBeTruthy()
    fireEvent.error(cover)
    // onError 后：主图与环境层都卸载，品牌插画顶上（照片位不允许空着）
    expect(container.querySelector('[data-role="cover"]')).toBeNull()
    expect(screen.getByTestId('illustration').getAttribute('data-name')).toBe('page-pet-profile')
  })

  it('should use Icon components instead of functional emoji', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    // 拍立得上的「换头像」必须是图标（曾经写成 tone=white 压在近白相纸上 → 所有主题看不见）
    expect(document.querySelector('.pf-polaroid-shoot [data-icon="camera"]')).toBeTruthy()
    // 便签方块四个入口也都是 Icon
    expect(document.querySelectorAll('.pf-grid-icon [data-icon]').length).toBe(4)
    // 功能性 emoji 不应出现在渲染文本里
    const text = document.body.textContent || ''
    for (const e of ['📷', '🩺', '📔', '🎨', '🚫', '💊', '🪪']) {
      expect(text.includes(e)).toBe(false)
    }
  })

  it('should show next-step hints instead of bare dashes when health data is missing', async () => {
    render(<PetProfile />)
    expect(await screen.findByText('打卡后生成')).toBeTruthy()
    expect(screen.getByText('暂无记录')).toBeTruthy()
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
    // （PetAvatar 的 mock 也会渲染 petName，那种断言即使切换器不渲染名字也会通过）
    const names = Array.from(document.querySelectorAll('.pf-switch-name')).map(n => n.textContent)
    expect(names).toEqual(['小橘', '旺财'])
  })

  it('should keep the mark-deceased entry available', async () => {
    render(<PetProfile />)
    await screen.findByText('小橘')
    expect(screen.getByText('标记宠物离世')).toBeTruthy()
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
    expect(screen.queryByText('宠物档案')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. 关键交互：标记离世（两次确认 + 输入宠物名比对）
// ---------------------------------------------------------------------------
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
