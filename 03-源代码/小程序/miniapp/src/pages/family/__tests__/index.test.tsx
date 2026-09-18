/**
 * 家庭页「家庭成员（人）关系管理」单元测试
 * （pages/family/index —— 由 pagesPet/family-tree 搬来后新增的能力，2026-09-12 舰长裁决方案②）
 *
 * 【为什么必须补这组测试】family-tree 整页下线后，这份「人关系」（8 种关系：情侣/父女/母子…）
 * 全仓只剩家庭页一处承载 —— 如果入口没渲染出来、或 owner 权限判反了，用户就**彻底没有入口**
 * 去管理家人关系了，而且不会有任何报错提示。故这里钉四件事：
 *  1) 「共同养宠」卡里渲染出设置关系入口，点开才出现面板（入口本身可发现）；
 *  2) 8 种关系类型齐全（少一种就等于删了一种能力）；
 *  3) owner 能新建（createRelation 收到正确的两个 userId + 关系类型）、能删（removeRelation）；
 *  4) **非 owner 只读**：面板里没有成员选择器、没有确认添加、关系行上没有删除 ✕（权限没放宽）。
 *  另外钉一条数据契约：fetchRelations 在挂载后被调用过（否则已有关系永远不显示）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FamilyPage from '../index'

// —— Taro 基础组件 → DOM 元素，便于 testing-library 断言 ——
vi.mock('@tarojs/components', () => ({
  View: ({ children, className, onClick, style, ...rest }: any) => (
    <div className={className} style={style} onClick={onClick} {...rest}>{children}</div>
  ),
  Text: ({ children, className }: any) => <span className={className}>{children}</span>,
  ScrollView: ({ children, className }: any) => <div className={className}>{children}</div>,
  Image: ({ src, className }: any) => <img src={src} className={className} alt='' />,
  Canvas: ({ className, id }: any) => <canvas className={className} id={id} />,
  Textarea: ({ className, value, onInput }: any) => (
    <textarea className={className} value={value} onChange={(e) => onInput?.({ detail: { value: e.target.value } })} />
  ),
}))

// —— vi.mock 工厂会被提升，跨用例共享的桩必须走 vi.hoisted ——
/** Taro API 桩：默认自动确认弹窗/ActionSheet，用例可覆写实现 */
const taro = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  showToast: vi.fn(),
  showModal: vi.fn(),
  showActionSheet: vi.fn(),
  setClipboardData: vi.fn(),
  previewImage: vi.fn(),
  chooseMedia: vi.fn(),
}))
const guard = vi.hoisted(() => ({ redirectToLoginIfNeeded: vi.fn() }))
const petStore = vi.hoisted(() => ({
  pets: [] as any[],
  fetchPets: vi.fn(),
  switchPet: vi.fn(),
}))
const authStore = vi.hoisted(() => ({
  isAuthenticated: true,
  isInitialized: true,
  /**
   * ⚠️ `user` 必须是**稳定引用**（同一个对象反复返回），不能在工厂里每次 new 一个字面量。
   *
   * 为什么：页面 `loadData` 的 effect 依赖是 `[isInitialized, isAuthenticated, user]`。
   * 桩每次调用都新建 `{ id, nickname }` → 每次渲染 `user` 引用都变 → effect 反复重跑 `loadData`
   * → 无限 setState → React 对每条都在控制台报 "An update to FamilyPage inside a test was
   * not wrapped in act(...)"，**实测 30 秒刷出 59MB 日志**，表现为整个测试文件"挂死"
   * （vitest 的 5s 超时都发不出来，因为日志写入把进程拖垮；本波 20 号 就是被这个坑耗到失败的）。
   * 真机上 zustand 的 selector 返回的是同一个 user 引用，所以**真机完全没这个问题** ——
   * 它是纯测试桩缺陷，修在桩里，不要去改页面依赖。
   */
  user: { id: 'user_001', nickname: '铲屎官' },
}))
const familyStore = vi.hoisted(() => ({
  currentFamily: { id: 'fam_001', name: '星澜小筑' } as any,
  members: [] as any[],
  users: [] as any[],
  relations: [] as any[],
  photos: [] as any[],
  photosLoading: false,
  loading: false,
  fetchFamilies: vi.fn(),
  createFamily: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
  fetchUsers: vi.fn(),
  createInvite: vi.fn().mockResolvedValue('ABC123'),
  joinFamily: vi.fn(),
  removeUser: vi.fn(),
  fetchRelations: vi.fn(),
  createRelation: vi.fn(),
  removeRelation: vi.fn(),
  fetchPhotos: vi.fn(),
  savePhoto: vi.fn(),
  deletePhoto: vi.fn(),
  generateAiPhoto: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({ default: taro }))

vi.mock('../../../stores/authStore', () => ({
  // 页面两种取法都支持：useAuthStore() 与 useAuthStore(s => s.user)
  useAuthStore: (selector?: any) => {
    const state = { user: authStore.user, isAuthenticated: authStore.isAuthenticated, isInitialized: authStore.isInitialized }
    return selector ? selector(state) : state
  },
}))

vi.mock('../../../stores/petStore', () => ({
  usePetStore: Object.assign(
    (selector?: any) => {
      const state = { pets: petStore.pets, fetchPets: petStore.fetchPets, switchPet: petStore.switchPet }
      return selector ? selector(state) : state
    },
    // 页面里有 usePetStore.getState().pets（loadData 后取最新宠物列表）
    { getState: () => ({ pets: petStore.pets }) },
  ),
}))

vi.mock('../../../stores/familyStore', () => ({
  useFamilyStore: Object.assign(
    (selector?: any) => (selector ? selector(familyStore) : familyStore),
    { getState: () => familyStore },
  ),
}))

// 数据服务：本组测试只关心"人关系"，其余一律给空结果（也避免真发请求）
vi.mock('../../../services/checkinService', () => ({
  getTodayCheckin: vi.fn().mockResolvedValue(null),
  getCheckinStats: vi.fn().mockResolvedValue({ totalCheckins: 0, totalAnomalyDays: 0, streak: 0, weeklyDays: 0, weeklyCount: 0 }),
}))
vi.mock('../../../services/momentService', () => ({
  getFamilyMoments: vi.fn().mockResolvedValue([]),
  getNewMoments: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../services/vaccineService', () => ({
  getUpcomingRecords: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../services/weeklyReportService', () => ({
  generateWeeklyReport: vi.fn().mockReturnValue({ summary: '', overallMood: 'good', highlights: [], concerns: [], suggestions: [] }),
  generateFamilyWeeklySummary: vi.fn().mockReturnValue({ summary: '', overallMood: 'good', highlights: [], concerns: [], suggestions: [] }),
  getLatestWeeklyReport: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../../hooks/usePolling', () => ({ usePolling: () => undefined }))
/**
 * 主题 hook：本页根节点现在会挂 `theme-*` 类名（2026-09-12 补主题跟随），
 * 而 PageBackground 在下面被 mock 成 null、Taro 桩里也没有 eventCenter / useDidShow /
 * setNavigationBarColor，跑真 hook 会直接抛错；故按仓内其它页面测试的惯例固定一个主题类名。
 */
vi.mock('../../../hooks/useThemeClass', () => ({ useThemeClass: () => 'theme-autumn' }))
vi.mock('../../../utils/authGuard', () => guard)
vi.mock('../index.scss', () => ({}))
vi.mock('../../../components/PageBackground', () => ({ default: () => null }))
vi.mock('../../../components', () => ({
  Icon: ({ name, className }: any) => <span className={className} data-icon={name} />,
  PageHero: ({ title }: any) => <div data-testid='page-hero'>{title}</div>,
  Illustration: ({ name }: any) => <span data-illustration={name} />,
}))
vi.mock('../FamilyPetAvatar', () => ({
  default: ({ pet, imgClass }: any) => <span className={imgClass} data-pet={pet?.id} />,
}))

/** 造一只宠物档案（FamilyPetAvatar 被 mock，只需 id/name 等少数字段） */
function makePet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pet_001',
    userId: 'user_001',
    name: '小橘',
    species: 'cat',
    breed: '中华田园猫',
    breedId: 'chinese_tabby',
    avatarPhotoUrl: '',
    avatarCartoonUrl: '',
    ...overrides,
  }
}

/** 桩 store 的异步方法必须每次重建实现：
 *  ⚠️ 不要用 vi.clearAllMocks —— 它只清调用记录、**不动实现**，看着没问题；
 *  但一旦有人改成 resetAllMocks/restoreAllMocks，这些 mockResolvedValue 会被清空 →
 *  loadData 里 `await fetchPets()` 拿到 undefined → 抛错 → pageReady 永远 false →
 *  页面卡在"加载中..."（本波实测踩过：表现为 findByTestId 一直等不到元素，进程跑到 CPU 打满）。
 *  这里显式重设一遍，任何重置都不会让页面卡死。 */
function stubAsyncMethods() {
  for (const fn of [
    familyStore.fetchFamilies,
    familyStore.createFamily,
    familyStore.addMember,
    familyStore.removeMember,
    familyStore.updateMemberRole,
    familyStore.fetchUsers,
    familyStore.joinFamily,
    familyStore.removeUser,
    familyStore.fetchRelations,
    familyStore.createRelation,
    familyStore.removeRelation,
    familyStore.fetchPhotos,
    familyStore.savePhoto,
    familyStore.deletePhoto,
    petStore.fetchPets,
    petStore.switchPet,
  ]) {
    fn.mockResolvedValue(undefined)
  }
}

const OWNER = { id: 'u1', familyId: 'fam_001', userId: 'user_001', role: 'owner', nickname: '铲屎官' }
const MEMBER = { id: 'u2', familyId: 'fam_001', userId: 'user_002', role: 'member', nickname: '室友' }

const COUPLE_REL = {
  id: 'rel_001',
  familyId: 'fam_001',
  userIdA: 'user_001',
  userIdB: 'user_002',
  relationType: 'couple',
  createdAt: '2026-09-01T10:00:00.000Z',
  nicknameA: '铲屎官',
  nicknameB: '室友',
}

/** 按用例需要重置桩数据（默认：一个家庭、一位 owner、一只已入家庭宠物） */
function setStore(overrides: Partial<typeof familyStore> = {}) {
  Object.assign(familyStore, {
    currentFamily: { id: 'fam_001', name: '星澜小筑' },
    members: [{ id: 'fm_001', familyId: 'fam_001', petId: 'pet_001', petName: '小橘', role: '团宠', joinedAt: '2026-01-01' }],
    users: [OWNER, MEMBER],
    relations: [],
    photos: [],
    photosLoading: false,
    loading: false,
  }, overrides)
  petStore.pets = [makePet()]
  petStore.fetchPets.mockResolvedValue(undefined)
  authStore.isAuthenticated = true
  authStore.isInitialized = true
}

/** 渲染家庭页并等到 pageReady（首屏"加载中..."消失、设置关系入口出现） */
async function renderPage() {
  const utils = render(<FamilyPage />)
  await screen.findByTestId('family-rel-entry')
  return utils
}

describe('家庭页 · 家庭成员（人）关系入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setStore()
    // 重置后再装一遍异步实现（见 stubAsyncMethods 注释：缺了它页面会永远停在"加载中"）
    stubAsyncMethods()
    // 默认：ActionSheet 选第一项、弹窗默认确认（用例需要时再覆写）
    taro.showActionSheet.mockImplementation((opts: any) => opts?.success?.({ tapIndex: 0 }))
    taro.showModal.mockImplementation((opts: any) => opts?.success?.({
      confirm: true,
      cancel: false,
      content: null,
      confirmColor: '#000000',
    }))
  })

  it('「共同养宠」卡渲染设置关系入口，且挂载后拉取已有关系', async () => {
    await renderPage()

    // 入口在共同养宠卡里（同卡还有"共同养宠"标题与家人卡片）
    expect(screen.getByTestId('family-rel-entry')).toBeTruthy()
    expect(screen.getByText('设置关系')).toBeTruthy()
    expect(screen.getByText('共同养宠')).toBeTruthy()
    // 关键契约：不拉 relations 的话，已有关系永远不会显示
    expect(familyStore.fetchRelations).toHaveBeenCalled()
  })

  it('点入口才打开面板；面板里 8 种关系类型齐全（少一种＝少一种能力）', async () => {
    await renderPage()
    // 未点击时面板不存在（不能让浮层常驻）
    expect(screen.queryByTestId('family-rel-panel')).toBeNull()

    fireEvent.click(screen.getByTestId('family-rel-entry'))

    const panel = await screen.findByTestId('family-rel-panel')
    expect(panel).toBeTruthy()
    for (const label of ['情侣', '父女', '父子', '母女', '母子', '兄弟姐妹', '朋友', '其他']) {
      expect(panel.textContent).toContain(label)
    }
    // 成员选择器与提交按钮都在（owner 视图）
    expect(panel.textContent).toContain('成员 A')
    expect(panel.textContent).toContain('成员 B')
    expect(panel.textContent).toContain('确认添加')
  })

  it('owner 新建关系：选两名成员 + 选类型 → createRelation 收到正确参数，面板关闭', async () => {
    await renderPage()
    fireEvent.click(screen.getByTestId('family-rel-entry'))

    const panel = await screen.findByTestId('family-rel-panel')
    // 「成员 A」选择器 = 含"请选择成员 A"的那一行（文案在 <Text> 里，容器带 onClick）
    const pickerFor = (placeholder: string) => {
      const text = Array.from(panel.querySelectorAll('span')).find((el) => el.textContent === placeholder)
      return text?.parentElement as HTMLElement
    }
    // 两次选择都取 ActionSheet 第 0/1 项（桩按 tapIndex 返回）
    taro.showActionSheet.mockImplementationOnce((opts: any) => opts?.success?.({ tapIndex: 0 }))
    fireEvent.click(pickerFor('请选择成员 A'))
    taro.showActionSheet.mockImplementationOnce((opts: any) => opts?.success?.({ tapIndex: 1 }))
    fireEvent.click(pickerFor('请选择成员 B'))

    // 选"兄弟姐妹"（在 8 个类型 chip 里按文案点）
    const siblingChip = Array.from(panel.querySelectorAll('span')).find((el) => el.textContent?.includes('兄弟姐妹'))
    fireEvent.click(siblingChip!.parentElement as HTMLElement)
    fireEvent.click(Array.from(panel.querySelectorAll('span')).find((el) => el.textContent === '确认添加')!.parentElement as HTMLElement)

    await waitFor(() => {
      expect(familyStore.createRelation).toHaveBeenCalledWith('user_001', 'user_002', 'siblings')
    })
    // 成功后收起面板（避免用户重复提交同一条关系）
    await waitFor(() => expect(screen.queryByTestId('family-rel-panel')).toBeNull())
  })

  it('owner 删除关系：点 ✕ → 确认后 removeRelation(relationId)', async () => {
    setStore({ relations: [COUPLE_REL] })
    await renderPage()

    const rows = document.querySelectorAll('[data-testid="family-rel-row"]')
    expect(rows.length).toBe(1)
    // 关系文案带方向箭头与类型（对等关系用 ↔）
    expect(rows[0].textContent).toContain('铲屎官 ↔ 室友 · 情侣')

    // ⚠️ 选择器必须用类名、不能写成 `span.family-rel__remove`：页面里它是一个 `<View>`
    // （在 @tarojs/components 桩里渲染成 div），写 span 会永远取不到 —— 那样不仅本用例失败，
    // 下一条「非 owner 没有 ✕」也会变成**空断言**（选择器匹配不到任何东西，当然为 null）。
    fireEvent.click(rows[0].querySelector('.family-rel__remove') as HTMLElement)
    // 先弹二次确认
    await waitFor(() => expect(taro.showModal).toHaveBeenCalled())
    await waitFor(() => expect(familyStore.removeRelation).toHaveBeenCalledWith('rel_001'))
  })

  it('非 owner 只读：面板里没有成员选择器 / 确认添加 / 删除 ✕（权限没有放宽）', async () => {
    setStore({
      // 当前登录用户只是普通成员
      users: [{ ...MEMBER, userId: 'user_001' }, { ...OWNER, userId: 'user_002' }],
      relations: [COUPLE_REL],
    })
    await renderPage()

    // 关系列表仍然可见（只读可看）
    const rows = document.querySelectorAll('[data-testid="family-rel-row"]')
    expect(rows.length).toBe(1)
    // 但行上没有删除按钮（选择器与上一条一致：类名定位，不写 span —— 它是 <View> 渲染的 div）
    expect(rows[0].querySelector('.family-rel__remove')).toBeNull()

    fireEvent.click(screen.getByTestId('family-rel-entry'))
    const panel = await screen.findByTestId('family-rel-panel')
    expect(panel.textContent).toContain('只有家庭创建者')
    expect(panel.textContent).not.toContain('成员 A')
    expect(panel.textContent).not.toContain('确认添加')
    // 更不能因为"点了什么"就真的发请求
    expect(familyStore.createRelation).not.toHaveBeenCalled()
    expect(familyStore.removeRelation).not.toHaveBeenCalled()
  })
})
