/**
 * 「我的」页 · 按高保真 v2 补齐三块的回归测试（2026-09-12 本批）
 *
 * 【为什么要测】独立审查对完高保真 v2 的 12 屏后判定本页"7 块里 3 块缺失"
 * （探针 `statbar` / `血缘图谱` / `我的回忆录` / `memcard` 全 0 命中）。本文件锁三件事：
 *   1. **statbar 四项数据条存在，且每一格都是真数**（不是写死的演示数字）：
 *      · 陪伴天数 = **当前宠物**建档那天到今天（`currentPet ?? pets[0]`，走 utils/date 本地日历日）
 *        —— 与首页 hero「已陪伴 N 天」**同口径**，两处必须始终一致。2026-09-12 统一之前，
 *        本页取的是"账号下最早建档那只"，同屏会出现 46 天（我的页）vs 43 天（首页）两个数
 *      · 打卡次数 = 跨宠物累加 `totalCheckins`（**条数**，不是 `totalDays`）
 *      · 照片回忆 = 每条回忆的 photos 张数累加（与时光页「记录 N 张照片」同口径）
 *      · 第 4 格 = 毛孩子数（v2 的「生成的片」服务端无累计口径，见页面注释）
 *   2. **新增的两组菜单**（家人与家庭 / 作品与回忆）条目的文案与目标路由都指向
 *      **已注册的真实路由**；「宠物档案」这条常驻入口在**没有宠物时也在**（它是
 *      「宠物档案」退出 tabBar 后的主要入口，丢了这个用户就找不到档案卡）。
 *   3. **会员卡 memcard**：非会员 = 引导态（文案必须是真实权益），会员 = 真实到期日。
 *   4. **「打卡次数」的冷启动回归锁**（2026-09-12 修复的真缺陷）：本页必须**先 `getCheckins`**
 *      （它会 `GET /api/pets/:petId/checkins` 并回写本地缓存），**再 `getCheckinStats`**
 *      （只读本地缓存、自己不发请求）。顺序反过来 = 冷启动直进本页时缓存为空 → 恒显示 0。
 *      对应断言：statbar describe 里的「先拉取、再统计」顺序锁 + 「getCheckins 失败」用例。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import Mine from '../index'
import { daysSinceLocalDate } from '../../../utils/date'

// ── 可变 mock 状态（vi.mock 的工厂会被提升，必须用 vi.hoisted 暴露）──
const mocks = vi.hoisted(() => ({
  taro: {
    useDidShow: vi.fn(),
    setNavigationBarTitle: vi.fn(),
    navigateTo: vi.fn(),
    showModal: vi.fn(),
    reLaunch: vi.fn(),
    showToast: vi.fn(),
  },
  petState: {
    pets: [] as any[],
    currentPet: null as any,
    fetchPets: vi.fn().mockResolvedValue(undefined),
  },
  familyState: {
    currentFamily: null as any,
    users: [] as any[],
    fetchFamilies: vi.fn().mockResolvedValue(undefined),
    fetchUsers: vi.fn().mockResolvedValue(undefined),
  },
  membership: {
    isMember: false,
    membership: null as any,
  },
  getCheckinStats: vi.fn(),
  // 先拉取再统计（2026-09-12 修复）：本页进入时会先 await getCheckins，它才会发请求并回写本地缓存
  getCheckins: vi.fn(),
  getMoments: vi.fn(),
}))

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) =>
    createElement('div', { className, style, onClick }, children),
  Text: ({ children, className }: any) => createElement('span', { className }, children),
  ScrollView: ({ children, className }: any) => createElement('div', { className }, children),
  Image: ({ src, className }: any) => createElement('img', { src, className }),
}))

vi.mock('@tarojs/taro', () => ({ default: mocks.taro }))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      user: { id: 'user_1', nickname: '张河彬', avatar: '' },
      isAuthenticated: true,
      isInitialized: true,
      logout: vi.fn(),
    }),
}))

// 宠物 store：页面既当 hook 用（`usePetStore()`），又用静态 `getState()` 读最新列表
vi.mock('../../../stores/petStore', () => ({
  usePetStore: Object.assign(() => mocks.petState, { getState: () => mocks.petState }),
}))

vi.mock('../../../stores/familyStore', () => ({
  useFamilyStore: Object.assign((selector: any) => selector(mocks.familyState), {
    getState: () => mocks.familyState,
  }),
}))

vi.mock('../../../stores/themeStore', () => ({
  useThemeStore: { getState: () => ({ current: 'autumn', setTheme: vi.fn() }) },
}))

// 会员态走 hook（本批新引入）：测试里直接控制 isMember / 到期日
vi.mock('../../../hooks/useMembership', () => ({
  useMembership: () => mocks.membership,
}))

vi.mock('../../../hooks/useThemeClass', () => ({ useThemeClass: () => 'theme-autumn' }))

// 自定义 tabBar 的选中态广播：本页必须调用它（删了底部高亮不动），但测试里不需要副作用
vi.mock('../../../constants/tabBar', () => ({ useTabBarSelected: vi.fn() }))

vi.mock('../../../utils/authGuard', () => ({ redirectToLoginIfNeeded: vi.fn() }))

vi.mock('../../../services/checkinService', () => ({
  getCheckins: (...args: unknown[]) => mocks.getCheckins(...args),
  getCheckinStats: (...args: unknown[]) => mocks.getCheckinStats(...args),
}))

vi.mock('../../../services/timelineService', () => ({
  timelineService: { getMoments: (...args: unknown[]) => mocks.getMoments(...args) },
}))

vi.mock('../../../components', () => ({
  Icon: () => null,
  Illustration: () => null,
  PageBackground: () => null,
}))

vi.mock('../../../components/PageLoading', () => ({ default: () => null }))

/**
 * 两只宠物：建档日一早一晚（PET_A 2023-08-20 / PET_B 2024-05-01）。
 * 用来验证「陪伴天数」取的是**当前宠物**（`currentPet ?? pets[0]`），而**不是"最早建档那只"** ——
 * 两个建档日差得远，取错了断言必红（这正是用户截图里 46 天 vs 43 天的成因）。
 */
const PET_A = {
  id: 'pet_1',
  name: '可乐',
  species: 'cat',
  breed: '橘猫',
  birthDate: '2023-08-20',
  createdAt: '2023-08-20T02:00:00.000Z',
}
const PET_B = {
  id: 'pet_2',
  name: '布丁',
  species: 'dog',
  breed: '柯基',
  birthDate: '2024-01-01',
  createdAt: '2024-05-01T02:00:00.000Z',
}

/** 构造一条回忆（照片在 PetMoment.photos 顶层数组里，与时光页读取方式一致） */
function makeMoment(id: string, photos: string[]) {
  return { id, userId: 'user_1', type: 'photo', content: {}, photos, createdAt: '2026-09-01T02:00:00.000Z' }
}

/** 取 statbar 四格的「数字 + 标签」 */
function readStatbar() {
  const values = Array.from(document.querySelectorAll('.mine-statbar__num')).map(el => el.textContent)
  const labels = Array.from(document.querySelectorAll('.mine-statbar__label')).map(el => el.textContent)
  return { values, labels }
}

/** 取所有分组标题 */
function readGroupTitles() {
  return Array.from(document.querySelectorAll('.mine-menu-group-title')).map(el => el.textContent)
}

/** 按菜单主文案找那一行（找不到返回 null） */
function findMenuItem(label: string): HTMLElement | null {
  const labels = Array.from(document.querySelectorAll('.mine-menu-label'))
  const hit = labels.find(el => el.textContent === label)
  return (hit?.closest('.mine-menu-item') as HTMLElement) ?? null
}

describe('我的页 - statbar 四项数据条（v2 第 3 块）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.petState.pets = [PET_A, PET_B]
    // 当前宠物刻意选**较新**的 PET_B：若实现退回"取最早那只"，下面的断言会直接失败
    mocks.petState.currentPet = PET_B
    mocks.membership.isMember = false
    mocks.membership.membership = null
    // 打卡：两只宠物各 50/36 **次**、40/30 **天** —— 次数与天数刻意不同，
    // 这样"标签写次数、数字取天数"的错配会被断言直接抓住
    mocks.getCheckinStats.mockImplementation(async (petId: string) =>
      petId === PET_A.id
        ? { totalCheckins: 50, totalDays: 40 }
        : { totalCheckins: 36, totalDays: 30 },
    )
    mocks.getMoments.mockResolvedValue([makeMoment('m1', ['a.jpg', 'b.jpg', 'c.jpg']), makeMoment('m2', ['d.jpg'])])
    // 先拉取再统计：真实实现里 getCheckins 才会发请求并回写本地缓存，测试里让它 resolve 即可
    // （数字本身仍由 getCheckinStats 的 mock 提供，两个 mock 相互独立）
    mocks.getCheckins.mockResolvedValue([])
  })

  it('渲染四项，数字全部来自真实数据源（陪伴天数/打卡次数/照片回忆/毛孩子）', async () => {
    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-statbar')).toBeTruthy())

    const { labels, values } = readStatbar()
    expect(labels).toEqual(['陪伴天数', '打卡次数', '照片回忆', '毛孩子'])

    // 陪伴天数：**当前宠物**（布丁 2024-05-01）到今天；与首页 hero 同口径、同走 utils/date 本地日历日
    const expectedDays = daysSinceLocalDate(PET_B.createdAt)
    expect(values[0]).toBe(String(expectedDays))
    // 反锁：绝不能变成"最早建档那只"（可乐 2023-08-20）的天数 —— 那是本批之前的口径，
    // 也就是用户说的"同一个概念两个数"。两个日期差一年，取错了这里必红。
    expect(values[0]).not.toBe(String(daysSinceLocalDate(PET_A.createdAt)))
    // 打卡次数 = 50 + 36 = 86（**不是**天数 40 + 30 = 70）
    expect(values[1]).toBe('86')
    // 照片回忆 = 3 + 1 张（不是回忆条数 2）
    expect(values[2]).toBe('4')
    // 第 4 格：毛孩子数
    expect(values[3]).toBe('2')

    // 数据来源证据：每只宠物各查一次统计；回忆一次性拉全账号（不传 petId）
    // ── 回归锁①：必须先拉取、再统计（冷启动恒为 0 那个 bug 的命门）──────────────────
    // 真实实现里 getCheckinStats 只读本地缓存、自己不发请求（checkinService.ts:337-340），
    // 而缓存只有 getCheckins 会回写（同文件 :170-179）。所以「先统计后拉取」或「干脆不拉」
    // → 冷启动直进本页那一轮算出来必然是 0，用户看到的正是「0 打卡次数」。
    // 这里对**每一次** getCheckinStats 调用都要求：同宠物的 getCheckins 更早发生过。
    const pulls = mocks.getCheckins.mock.calls.map((call, i) => ({
      petId: call[0] as string,
      order: mocks.getCheckins.mock.invocationCallOrder[i],
    }))
    const statsCalls = mocks.getCheckinStats.mock.calls.map((call, i) => ({
      petId: call[0] as string,
      order: mocks.getCheckinStats.mock.invocationCallOrder[i],
    }))
    // 一次都没拉取 = 退回 bug，直接判红
    expect(pulls.length).toBeGreaterThan(0)
    statsCalls.forEach(stat => {
      const pull = pulls.find(p => p.petId === stat.petId && p.order < stat.order)
      expect(pull, `宠物 ${stat.petId} 的统计调用之前必须先拉取打卡记录`).toBeTruthy()
    })

    // 数据来源证据：每只宠物都先拉过打卡、再各查一次统计；回忆一次性拉全账号（不传 petId）
    expect(mocks.getCheckins).toHaveBeenCalledWith(PET_A.id, 'user_1')
    expect(mocks.getCheckins).toHaveBeenCalledWith(PET_B.id, 'user_1')
    expect(mocks.getCheckinStats).toHaveBeenCalledWith(PET_A.id, 'user_1')
    expect(mocks.getCheckinStats).toHaveBeenCalledWith(PET_B.id, 'user_1')
    expect(mocks.getMoments).toHaveBeenCalledWith()
  })

  it('currentPet 为空时退回列表第一只（与首页 activePet = pet ?? pets[0] 同口径）', async () => {
    mocks.petState.pets = [PET_A, PET_B]
    mocks.petState.currentPet = null

    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-statbar')).toBeTruthy())

    const { values } = readStatbar()
    expect(values[0]).toBe(String(daysSinceLocalDate(PET_A.createdAt)))
  })

  it('一只宠物都没有时陪伴天数是 0（不是空白/NaN）', async () => {
    mocks.petState.pets = []
    mocks.petState.currentPet = null

    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-statbar')).toBeTruthy())

    const { values } = readStatbar()
    expect(values[0]).toBe('0')
  })

  // 本用例覆盖的是「拉取成功、但统计接口失败」这一支：同样不炸、数字回落 0；
  // 「拉取本身就失败」那一支见下面那条用例（两者都要守住，不能只守其一）
  it('只有一只宠物时按它算陪伴天数；接口挂了也不炸（数字回落 0）', async () => {
    mocks.petState.pets = [PET_B]
    mocks.petState.currentPet = PET_B
    mocks.getCheckinStats.mockRejectedValue(new Error('request:fail'))
    mocks.getMoments.mockRejectedValue(new Error('request:fail'))

    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-statbar')).toBeTruthy())

    const { values } = readStatbar()
    expect(values[0]).toBe(String(daysSinceLocalDate(PET_B.createdAt)))
    expect(values[1]).toBe('0')
    expect(values[2]).toBe('0')
    expect(values[3]).toBe('1')
  })

  /**
   * 【回归锁②：拉取失败时不炸、也不假报数】
   * 场景 = 冷启动直进「我的」页，而拉取打卡记录失败（未登录 / 归属校验没过 / 网络异常）。
   * 期望：① 页面照常渲染（不抛异常，其它三格照旧）；② 「打卡次数」停在 0；
   *      ③ **不许**在拉取失败后回读本地缓存凑数：本用例把 getCheckinStats 的返回值 mock 成
   *        999（模拟「缓存里躺着的是过期的 / 不属于当前账号的数」）—— 一旦有人把实现改成
   *        「拉取失败就退回读缓存」，这一格会显示 999，下面两条断言立刻变红。
   */
  it('getCheckins 失败时页面不炸：「打卡次数」停在 0 且不回读缓存凑数', async () => {
    mocks.petState.pets = [PET_B]
    mocks.petState.currentPet = PET_B
    mocks.getCheckins.mockRejectedValue(new Error('request:fail'))
    mocks.getCheckinStats.mockResolvedValue({ totalCheckins: 999, totalDays: 999 })

    render(createElement(Mine))
    // 能等到 statbar 出现 = 这次 reject 没有把页面打炸（也没有冒泡成未处理的 rejection）
    await waitFor(() => expect(document.querySelector('.mine-statbar')).toBeTruthy())

    const { values } = readStatbar()
    expect(values[1]).toBe('0') // 不假报：拉取失败就不给数
    expect(mocks.getCheckinStats).not.toHaveBeenCalled() // 也没有偷偷回读本地缓存凑数
    // 这一轮确实尝试过拉取（否则上面两条断言毫无意义）
    expect(mocks.getCheckins).toHaveBeenCalledWith(PET_B.id, 'user_1')
    // 其余三格不受这次失败影响（陪伴天数 / 照片回忆 / 毛孩子）
    expect(values[0]).toBe(String(daysSinceLocalDate(PET_B.createdAt)))
    expect(values[2]).toBe('4')
    expect(values[3]).toBe('1')
  })

})

describe('我的页 - 家人与家庭 / 作品与回忆 两组菜单（v2 第 4、5 块）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.petState.pets = [PET_A]
    mocks.petState.currentPet = PET_A
    mocks.membership.isMember = false
    mocks.membership.membership = null
    mocks.getCheckinStats.mockResolvedValue({ totalCheckins: 1, totalDays: 1 })
    mocks.getCheckins.mockResolvedValue([])
    mocks.getMoments.mockResolvedValue([])
  })

  it('六组菜单按 v2 顺序排布（内容三组在会员卡之前，工具三组保留在其后）', async () => {
    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-menu-group')).toBeTruthy())

    expect(readGroupTitles()).toEqual(['我的宠物', '家人与家庭', '作品与回忆', '数据服务', '管理', '设置'])
  })

  it('血缘图谱 / 我的回忆录 指向真实存在的路由', async () => {
    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-menu-group')).toBeTruthy())

    const lineage = findMenuItem('血缘图谱')
    const memoir = findMenuItem('我的回忆录')
    expect(lineage).toBeTruthy()
    expect(memoir).toBeTruthy()

    fireEvent.click(lineage!)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/family/lineage/index' })

    fireEvent.click(memoir!)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesMemoir/memoir-center/index' })
  })

  it('「邀请好友」已并入「邀请家人」（同一路由同屏只留一条入口）', async () => {
    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-menu-group')).toBeTruthy())

    expect(findMenuItem('邀请好友')).toBeNull()
    const invite = findMenuItem('邀请家人')
    expect(invite).toBeTruthy()
    fireEvent.click(invite!)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesUser/invite/index' })
  })

  it('「宠物档案」是无条件常驻入口：一只宠物都没有时也在，且指向 pet-profile', async () => {
    mocks.petState.pets = []
    mocks.petState.currentPet = null

    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-menu-group')).toBeTruthy())

    const entry = findMenuItem('宠物档案')
    expect(entry).toBeTruthy()
    fireEvent.click(entry!)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/pet-profile/index' })

    // 没宠物时"添加"那行的文案也不能说"第二位"
    expect(findMenuItem('添加毛孩子')).toBeTruthy()
    expect(findMenuItem('添加第二位宠物伙伴')).toBeNull()
  })

  it('有宠物时「宠物档案」行带当前宠物身份（名字 · 品种 · 年龄），添加行回到 v2 文案', async () => {
    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-menu-group')).toBeTruthy())

    const desc = document.querySelector('.mine-menu-desc')?.textContent || ''
    expect(desc).toMatch(/^可乐 · 橘猫 · /)
    expect(desc).toMatch(/\d+(岁|个月|天)/)
    expect(findMenuItem('添加第二位宠物伙伴')).toBeTruthy()
  })

  /**
   * 分组渲染从「模块级常量 + 内联 map」重构成 `renderMenuGroup(group)` 之后，
   * 「设置」组末尾那条追加的「主题皮肤」行（含可展开的四季面板）必须原样还在 ——
   * 这是本页唯一不受 v2 影响的既有功能，重构时最容易漏。
   */
  it('「设置」组末尾仍保留可展开的「主题皮肤」行（四季选择面板）', async () => {
    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-menu-group')).toBeTruthy())

    const themeRow = findMenuItem('主题皮肤')
    expect(themeRow).toBeTruthy()
    // 默认收起：面板不渲染
    expect(document.querySelector('.mine-theme-panel')).toBeNull()

    fireEvent.click(themeRow!)
    await waitFor(() => expect(document.querySelector('.mine-theme-panel')).toBeTruthy())
    const seasons = Array.from(document.querySelectorAll('.mine-theme-choice-label')).map(el => el.textContent)
    expect(seasons).toEqual(['春', '夏', '秋', '冬'])
  })
})

describe('我的页 - 会员卡 memcard（v2 第 6 块）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.petState.pets = [PET_A]
    mocks.petState.currentPet = PET_A
    mocks.getCheckinStats.mockResolvedValue({ totalCheckins: 1, totalDays: 1 })
    mocks.getCheckins.mockResolvedValue([])
    mocks.getMoments.mockResolvedValue([])
  })

  it('非会员：显示引导态，文案是会员中心里真实存在的权益（不承诺未上线权益）', async () => {
    mocks.membership.isMember = false
    mocks.membership.membership = null

    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-memcard')).toBeTruthy())

    expect(document.querySelector('.mine-memcard__title')?.textContent).toBe('星河宠记 · 会员')
    const desc = document.querySelector('.mine-memcard__desc')?.textContent || ''
    expect(desc).toContain('回忆录 8 折')
    // v2 原型的"解锁无限回忆录 · 高清导出 · 完整叙事档"在会员中心并不存在，不得出现
    expect(desc).not.toContain('无限回忆录')
    expect(desc).not.toContain('高清导出')
    expect(document.querySelector('.mine-memcard__btn-text')?.textContent).toBe('去看看')

    // 整卡可点（按钮不是假按钮）：点卡片进会员中心
    fireEvent.click(document.querySelector('.mine-memcard') as HTMLElement)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesUser/member/index' })
  })

  it('会员：显示真实到期日（本地日历日，不是 UTC 切片）与「会员中心」按钮', async () => {
    mocks.membership.isMember = true
    // 后端 endDate 是带时间的 ISO 串：东八区 20:00 之后产生的值按 UTC 切片会差一天
    mocks.membership.membership = { tier: 'member', status: 'active', expiresAt: '2026-12-31T16:00:00.000Z' }

    render(createElement(Mine))
    await waitFor(() => expect(document.querySelector('.mine-memcard')).toBeTruthy())

    // 本地时区（东八区）下这个时刻属于 2027-01-01；断言用页面同款口径，避免测试依赖运行机器时区
    expect(document.querySelector('.mine-memcard__desc')?.textContent).toMatch(/^有效期至 \d{4}-\d{2}-\d{2}$/)
    expect(document.querySelector('.mine-memcard__btn-text')?.textContent).toBe('会员中心')
    // 会员态下名片卡上的徽章同时出现（两处状态同源，都来自 useMembership）
    expect(screen.getByText('星钻会员')).toBeTruthy()
  })
})
