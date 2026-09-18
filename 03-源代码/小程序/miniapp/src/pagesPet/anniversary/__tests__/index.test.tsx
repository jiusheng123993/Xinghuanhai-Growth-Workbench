/**
 * 生日与纪念日页（pagesPet/anniversary）单元测试
 *
 * 覆盖三层：
 *  1) 纯函数：formatWeekday / nextBirthday / nextAnniversary（倒计时 0 天、跨年顺延、
 *     非法日期、2/29 平年进位）；
 *  2) 真实派生：页面每一行的值都能追到 birthDate / createdAt，且不出现 NaN / undefined / Invalid；
 *  3) 边界：没有生日 → 空态（照任务书口径写明「生日在档案里填」）、没有宠物 → 添加宠物、
 *     已安息 → 不给倒计时、未登录 → 交登录守卫、页面自身没有写入口（改日期只能回「编辑档案」）。
 *
 * 【为什么纯函数用注入的 now】倒计时与「满几岁」都依赖「今天是几号」，
 * 不注入就只能写出「大约 300 多天」这种测不出错的断言（pet-profile 的 calcAge 用例同理）。
 *
 * 【为什么断言 .anniv-row 的「标签 → 值」映射】直接 `getByText('还有 244 天')` 会把用例
 * 跟当天日期绑死；按行读值既稳，又能顺带钉住「值和标签没有串行」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PetAnniversary, { formatWeekday, nextBirthday, nextAnniversary } from '../index'

// —— Taro 基础组件 → DOM 元素，便于用 testing-library 断言 ——
vi.mock('@tarojs/components', () => ({
  View: ({ children, className, onClick, hoverClass }: any) => (
    <div className={className} data-hover={hoverClass} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className }: any) => <span className={className}>{children}</span>,
  ScrollView: ({ children, className }: any) => <div className={className}>{children}</div>,
}))

// —— 用 vi.hoisted 暴露给用例断言（vi.mock 的工厂会被提升，不能直接引用外层变量） ——
const taro = vi.hoisted(() => ({ navigateTo: vi.fn() }))
const guard = vi.hoisted(() => ({ redirectToLoginIfNeeded: vi.fn() }))
const store = vi.hoisted(() => ({
  pets: [] as any[],
  currentPet: null as any,
  fetchPets: vi.fn().mockResolvedValue(undefined),
}))
const auth = vi.hoisted(() => ({ isAuthenticated: true, isInitialized: true }))

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
  }),
}))

vi.mock('../../../hooks/useThemeClass', () => ({ useThemeClass: () => 'theme-autumn' }))
vi.mock('../../../utils/authGuard', () => guard)
vi.mock('../index.scss', () => ({}))
vi.mock('../../../components/PageLoading', () => ({ default: () => <div>loading</div> }))
vi.mock('../../../components/PageBackground', () => ({ default: () => null }))
vi.mock('../../../components', () => ({
  // 只渲染 data-icon，便于断言「这些位置用的是 Icon 而不是 emoji」
  Icon: ({ name, className }: any) => <span className={className} data-icon={name} />,
  // 页头插画：把 name / mode / fill 透到 DOM，便于钉住「页头挂的是 moment-anniversary」
  // 以及「尺寸交给 CSS（fill）而不是内联 px」——`size` 是写死的 px、不随 rpx 缩放，宽屏会露底色
  Illustration: ({ name, mode, fill, className }: any) => (
    <div
      className={className}
      data-testid='illustration'
      data-name={name}
      data-mode={mode}
      data-fill={String(!!fill)}
    />
  ),
  // 空态透传 desc / actionText，并给行动按钮挂上 onAction（页面里的落点靠它验证）
  EmptyState: ({ title, desc, actionText, onAction }: any) => (
    <div data-testid='empty-state'>
      <span data-testid='empty-title'>{title}</span>
      <span data-testid='empty-desc'>{desc}</span>
      {actionText ? <span data-testid='empty-action' onClick={onAction}>{actionText}</span> : null}
    </div>
  ),
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
  // 建档时间：纪念日与「已陪伴」都以它为起算点。
  // 取 12:00Z 而不是 00:00Z，是为了让「本地日历日」在 -12~+12 的任意时区都落在 9 月 12 日
  // （00:00Z 在东八区会被算成当天早上 8 点、在 UTC-8 又会被算成前一天，用例会随机器飘）
  createdAt: '2025-09-12T12:00:00.000Z',
}

beforeEach(() => {
  store.pets = [{ ...petBase }]
  store.currentPet = store.pets[0]
  auth.isAuthenticated = true
  auth.isInitialized = true
  store.fetchPets.mockClear()
  taro.navigateTo.mockReset()
  guard.redirectToLoginIfNeeded.mockClear()
})

/**
 * 读出页面上所有 `.anniv-row` 的「标签 → 值」映射
 * @returns 以标签为键、值为值的对象（同名标签后出现的会覆盖前面的，本页没有重名行）
 */
function readRows(): Record<string, string> {
  const rows: Record<string, string> = {}
  document.querySelectorAll('.anniv-row').forEach(row => {
    const label = row.querySelector('.anniv-row__label')?.textContent || ''
    const value = row.querySelector('.anniv-row__value')?.textContent || ''
    rows[label] = value
  })
  return rows
}

// ---------------------------------------------------------------------------
// 1. 纯函数
// ---------------------------------------------------------------------------
describe('formatWeekday', () => {
  it('should return the Chinese weekday for a local date string', () => {
    // 2026-01-01 是周四（用固定日期断言，不用「今天」算，避免用例随日期漂）
    expect(formatWeekday('2026-01-01')).toBe('周四')
  })

  it('should return an empty string for an unparsable value', () => {
    expect(formatWeekday('')).toBe('')
  })
})

describe('nextBirthday', () => {
  // 固定参照日：2026-09-12（本地零点）
  const NOW = new Date(2026, 8, 12)

  it('should roll to next year when this year birthday has passed', () => {
    const next = nextBirthday('2023-05-12', NOW)
    expect(next?.date).toBe('2027-05-12')
    expect(next?.nth).toBe(4)
    expect(next?.daysUntil).toBeGreaterThan(0)
  })

  it('should return 0 days and the exact age when the birthday is today', () => {
    const next = nextBirthday('2023-09-12', NOW)
    expect(next?.date).toBe('2026-09-12')
    expect(next?.nth).toBe(3)
    expect(next?.daysUntil).toBe(0)
  })

  it('should never report 第 0 岁 for a pet born this year', () => {
    // 2026-01-05 出生、参照日 2026-09-12：今年这个日子已经过了，下一次是 2027-01-05（满 1 岁），
    // 而不是「2026-01-05 满 0 岁」—— nth 的下限 1 就是为这种情况准备的
    const next = nextBirthday('2026-01-05', NOW)
    expect(next?.date).toBe('2027-01-05')
    expect(next?.nth).toBe(1)
  })

  it('should return null when the birth date is missing or unparsable', () => {
    expect(nextBirthday('', NOW)).toBeNull()
    expect(nextBirthday('出生日期不详', NOW)).toBeNull()
  })

  it('should roll a 2 月 29 日 birthday to a real date in a common year', () => {
    // 2026 / 2027 都是平年：Date 会把 2/29 自然进位到 3/1，页面不能出现「2027-02-29」这种不存在的日期
    const next = nextBirthday('2024-02-29', NOW)
    expect(next?.date).toBe('2027-03-01')
  })
})

describe('nextAnniversary', () => {
  const NOW = new Date(2026, 8, 12)

  it('should return 0 days when the anniversary is today', () => {
    const next = nextAnniversary('2025-09-12', NOW)
    expect(next?.date).toBe('2026-09-12')
    expect(next?.nth).toBe(1)
    expect(next?.daysUntil).toBe(0)
  })

  it('should never report 第 0 周年 for a pet registered this year', () => {
    // 2026-07-01 建档、参照日在 2026-09-12：今年这一天已经过去，下一次是 2027-07-01（第 1 周年）
    const next = nextAnniversary('2026-07-01', NOW)
    expect(next?.date).toBe('2027-07-01')
    expect(next?.nth).toBe(1)
  })

  it('should accept an ISO string with time (server 的 createdAt 形态)', () => {
    const next = nextAnniversary('2025-09-12T12:00:00.000Z', NOW)
    expect(next?.date).toBe('2026-09-12')
    expect(next?.nth).toBe(1)
  })

  it('should return null when the created time is missing', () => {
    expect(nextAnniversary('', NOW)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. 真实派生（每一行的值都能追到 birthDate / createdAt）
// ---------------------------------------------------------------------------
describe('PetAnniversary 派生日期', () => {
  it('should derive every 生日 row from birthDate', async () => {
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')

    const rows = readRows()
    expect(rows['出生日期']).toBe('2023-05-12')
    // 年龄走 utils/date 的 formatPetAge（口径见 utils/date 顶部），只断言「不是空、不是 NaN」
    expect(rows['现在年龄']).toMatch(/(\d+岁)?\d+个月|\d+岁|\d+天/)
    expect(rows['下一岁生日']).toMatch(/^\d{4}-\d{2}-\d{2} 周[日一二三四五六]$/)
    expect(rows['距离生日']).toMatch(/^(还有 \d+ 天|今天就是它的 \d+ 岁生日)$/)
    // 组头小字：下一个生日满 N 岁
    expect(screen.getByText(/下一个生日满 \d+ 岁/)).toBeTruthy()
  })

  it('should derive every 纪念日 row from createdAt', async () => {
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')

    const rows = readRows()
    expect(rows['加入星河宠记']).toBe('2025-09-12 周五')
    expect(rows['已陪伴']).toMatch(/^\d+ 天$/)
    expect(rows['下一个周年']).toMatch(/^第 \d+ 周年 · \d{4}-\d{2}-\d{2}$/)
    expect(rows['距离纪念日']).toMatch(/^(还有 \d+ 天|就是今天)$/)
  })

  it('should not render NaN / undefined / Invalid anywhere', async () => {
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Invalid/)
  })

  it('should drop the 已陪伴 row instead of showing 0 天 when the pet was just added', async () => {
    // 建档时间取「今天」：已陪伴 0 天，这一行按设计不渲染（与档案页页头的口径一致）
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    store.pets = [{ ...petBase, createdAt: today }]
    store.currentPet = store.pets[0]
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')
    expect(readRows()['已陪伴']).toBeUndefined()
    // 用「整行消失」断言，而不是 toContain('0 天') —— 后面「还有 30 天」里也含「0 天」子串
    expect(screen.queryByText('已陪伴')).toBeNull()
  })

  it('should use Icon components instead of emoji', async () => {
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')
    // 生日 4 行 + 纪念日 4 行 + 说明与编辑入口的图标位
    expect(document.querySelectorAll('.anniv-row__icon [data-icon]').length).toBe(8)
    const text = document.body.textContent || ''
    for (const emoji of ['🎂', '📅', '🎉', '🐾']) expect(text.includes(emoji)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. 边界与入口
// ---------------------------------------------------------------------------
describe('PetAnniversary 边界', () => {
  it('should show the 空态 with the 生日在档案里填 口径 when birthDate is missing', async () => {
    store.pets = [{ ...petBase, birthDate: '' }]
    store.currentPet = store.pets[0]
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')

    // 生日分区塌成空态：不再有出生日期/倒计时行
    expect(readRows()['出生日期']).toBeUndefined()
    expect(readRows()['距离生日']).toBeUndefined()
    // 空态文案必须写清「生日在档案里填，这里会自动算出纪念日」（任务书口径）
    expect(screen.getByTestId('empty-desc').textContent)
      .toBe('宠物的生日在档案里填，这里会自动算出纪念日')
    // 纪念日分区仍由 createdAt 派生，不受生日缺失影响
    expect(readRows()['加入星河宠记']).toBe('2025-09-12 周五')
  })

  it('should send the 空态 CTA to 编辑档案 (本页没有写入口)', async () => {
    store.pets = [{ ...petBase, birthDate: '' }]
    store.currentPet = store.pets[0]
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')
    fireEvent.click(screen.getByTestId('empty-action'))
    expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/edit/index' })
  })

  it('should render the 添加宠物 empty state when there is no pet', async () => {
    store.pets = []
    store.currentPet = null
    render(<PetAnniversary />)
    const title = await screen.findByTestId('empty-title')
    expect(title.textContent).toBe('还没有添加宠物')
    fireEvent.click(screen.getByTestId('empty-action'))
    expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/add/index' })
  })

  it('should pin the 页头插画 to moment-anniversary with a fixed px size', async () => {
    store.pets = [petBase]
    store.currentPet = store.pets[0]
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')

    const art = screen.getByTestId('illustration')
    // 语义唯一：本页是全站唯一「周年纪念」语义的页面，插画 key 不许被换成别的
    expect(art.getAttribute('data-name')).toBe('moment-anniversary')
    // 尺寸必须交给 CSS（fill），不能用 size 内联 px —— 内联 px 不随 rpx 缩放，宽屏上容器变大图不变会露底色
    expect(art.getAttribute('data-fill')).toBe('true')
    // 600×600 方图进方形容器：aspectFill 与 aspectFit 等价，取 aspectFill 是为了
    // 将来换成非方图时不出现留白带（接线注释里写明了这个取舍）
    expect(art.getAttribute('data-mode')).toBe('aspectFill')
  })

  it('should keep the dates but drop the countdown for a deceased pet', async () => {
    store.pets = [{ ...petBase, isDeceased: true }]
    store.currentPet = store.pets[0]
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')

    const rows = readRows()
    expect(rows['出生日期']).toBe('2023-05-12')
    expect(rows['下一个周年']).toMatch(/^第 \d+ 周年/)
    // 已安息：不对着已离开的宠物数倒计时
    expect(rows['距离生日']).toBeUndefined()
    expect(rows['距离纪念日']).toBeUndefined()
    expect(screen.getByText('已安息 · 这些日子都留着')).toBeTruthy()
  })

  it('should expose 编辑档案 as the only write entry', async () => {
    render(<PetAnniversary />)
    await screen.findByText('小橘 的重要日子')
    fireEvent.click(screen.getByText('编辑档案'))
    expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/edit/index' })
    // 页面里没有任何表单控件（日期只能改档案，档案是唯一事实源）
    expect(document.querySelectorAll('input, textarea').length).toBe(0)
  })

  it('should stay in loading state until auth store is initialized', () => {
    auth.isInitialized = false
    render(<PetAnniversary />)
    expect(screen.getByText('loading')).toBeTruthy()
  })

  it('should hand off to the login guard when the user is not authenticated', async () => {
    auth.isAuthenticated = false
    render(<PetAnniversary />)
    await new Promise(r => setTimeout(r, 0))
    expect(guard.redirectToLoginIfNeeded).toHaveBeenCalled()
    expect(screen.queryByText('小橘 的重要日子')).toBeNull()
  })
})
