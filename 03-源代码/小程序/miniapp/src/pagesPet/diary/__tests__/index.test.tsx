/**
 * 宠物日记页 —— 「相伴天数」口径回归测试
 *
 * 2026-09-11 背景：本页原来的 `daysTogether(birthDate)` 算的是**出生日至今**
 * （宠物的年龄天数），却标成「相伴」；且用 `Math.floor(毫秒差/86400000)`，
 * 在东八区每天 00:00–08:00 会少算一天。
 * 现改为 `daysSinceLocalDate(currentPet?.createdAt)`（建档/加入家庭至今），
 * 与时光线页「相伴 N 天」同一口径 —— 这页此前**一条测试都没有**，改口径等于零保护。
 *
 * 查询方式说明：宠物名"可乐"在页面上出现两次（顶部切换条 + 头部卡片），
 * `getByText` 会因为多个匹配直接失败，所以这里改为定点查 `.pdiary-head__stats` 的文本。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import PetDiaryPage from '../index'
import { usePetStore } from '../../../stores/petStore'

const { mockPet, mockPet2, mockGenerateDiary, mockCheckinState } = vi.hoisted(() => ({
  mockPet: {
    id: 'pet_1',
    name: '可乐',
    species: 'cat' as const,
    breed: '中华田园猫',
    birthDate: '2023-05-12',
    createdAt: '2025-06-01T10:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  mockPet2: {
    id: 'pet_2',
    name: '布丁',
    species: 'dog' as const,
    breed: '柯基',
    birthDate: '2024-02-20',
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  /**
   * 可观测的 `generateDiaryFromEntries`：用它断言"过期请求没有落到界面上"——
   * 竞态的关键就是这个函数**被调用的次数与参数**（第 2 个参数是 birthDate）。
   */
  mockGenerateDiary: vi.fn((..._args: unknown[]) => [] as unknown[]),
  /**
   * 可手动控制的打卡 store：测试里能让某一次 `fetchCheckins` 挂起不返回，
   * 用来复现"快速切宠物时旧响应晚到"的竞态。
   */
  mockCheckinState: {
    checkins: [] as unknown[],
    isLoading: false,
    initUser: vi.fn(async () => {}),
    fetchCheckins: vi.fn(async () => {}),
  },
}))

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, onClick }: any) => createElement('div', { className, onClick }, children),
  Text: ({ children, className }: any) => createElement('span', { className }, children),
  ScrollView: ({ children, className }: any) => createElement('div', { className }, children),
  Image: ({ src, className }: any) => createElement('img', { src, className }),
  Textarea: ({ value, className }: any) => createElement('textarea', { value, className }),
  Picker: ({ children }: any) => createElement('div', null, children),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    showToast: vi.fn(),
    showModal: vi.fn(),
    showShareMenu: vi.fn(),
    navigateTo: vi.fn(),
    getStorageSync: vi.fn(() => null),
    setStorageSync: vi.fn(),
  },
  useShareAppMessage: vi.fn(),
  useShareTimeline: vi.fn(),
  useDidShow: vi.fn(),
}))

vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => 'theme-sakura-dream',
  useThemeKey: () => 'autumn',
  usePetWallpaper: () => null,
}))

vi.mock('../../../hooks/useAnalytics', () => ({
  useAnalytics: () => ({ trackPageView: vi.fn(), trackEvent: vi.fn() }),
  usePageView: () => {},
}))

vi.mock('../../../services/diaryService', () => ({
  generateDiaryFromEntries: (...args: unknown[]) => mockGenerateDiary(...args),
}))

vi.mock('../../../engines/petSafety/MedicalDisclaimer', () => ({
  MedicalDisclaimer: class {
    getCheckinDisclaimer() {
      return ''
    }
  },
}))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'user_1' } }),
}))

vi.mock('../../../stores/checkinStore', () => {
  // 用 hoisted 里那份可控 state：测试既能改它的 checkins，也能替换 fetchCheckins 的行为
  const useCheckinStore = Object.assign(() => mockCheckinState, { getState: () => mockCheckinState })
  return { useCheckinStore }
})

vi.mock('../../../components/PageBackground', () => ({ default: () => null }))

/** 等头部统计行渲染出来（它只在 currentPet 有值时出现） */
async function renderAndWait(): Promise<Element> {
  const { container } = render(createElement(PetDiaryPage))
  await waitFor(() => expect(container.querySelector('.pdiary-head__stats')).toBeTruthy())
  return container.querySelector('.pdiary-head__stats')!
}

describe('宠物日记页 - 相伴天数口径', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks 只清调用记录、不清实现：这里显式把打卡 store 复位成"立即返回"的默认行为，
    // 否则上一条用例塞进去的挂起实现会污染下一条（mockImplementationOnce 队列尤其容易残留）
    mockCheckinState.checkins = []
    mockCheckinState.fetchCheckins.mockReset().mockImplementation(async () => {})
    mockCheckinState.initUser.mockReset().mockImplementation(async () => {})
    mockGenerateDiary.mockImplementation(() => [])
    usePetStore.setState({
      currentPet: mockPet as any,
      pets: [mockPet] as any,
      userId: 'user_1',
    })
  })

  it('显示「相伴 N 天」，且起算日是建档日而不是出生日', async () => {
    const stats = await renderAndWait()

    const daysFromCreatedAt = localDaysSince('2025-06-01')
    const daysFromBirth = localDaysSince('2023-05-12')
    // 两个口径必须能区分开，否则这条测试无法证明"换了起算日"
    expect(daysFromCreatedAt).not.toBe(daysFromBirth)

    expect(stats.textContent).toContain(`相伴 ${daysFromCreatedAt} 天`)
    // 关键：不再是"出生至今"（旧实现会显示这个更大的数）
    expect(stats.textContent).not.toContain(`相伴 ${daysFromBirth} 天`)
  })

  it('建档时间缺失时该统计格不渲染（不显示 0 天这种假数字）', async () => {
    usePetStore.setState({
      currentPet: { ...mockPet, createdAt: '' } as any,
      pets: [mockPet] as any,
      userId: 'user_1',
    })

    const stats = await renderAndWait()
    expect(stats.textContent).not.toMatch(/相伴/)
  })

  it('建档时间非法（2026-02-31 这类不存在的日期）时同样不渲染该格', async () => {
    usePetStore.setState({
      currentPet: { ...mockPet, createdAt: '2026-02-31T00:00:00.000Z' } as any,
      pets: [mockPet] as any,
      userId: 'user_1',
    })

    const stats = await renderAndWait()
    expect(stats.textContent).not.toMatch(/相伴/)
  })

  /**
   * 跨宠物竞态回归（2026-09-11 审查，目标③）
   *
   * 复现路径：可乐的 `fetchCheckins` 慢 → 用户切到布丁 → 布丁很快返回 →
   * 之前可乐的响应才回来。修复前它会：① 把可乐的日记覆盖到布丁的界面；
   * ② 从全局 store 读到布丁的打卡记录、再配上闭包里可乐的 birthDate（一次生成混两只宠物）。
   * 修复后靠请求序号丢弃过期续体 —— 这里就用"generateDiaryFromEntries 的调用次数与参数"来钉住。
   */
  it('快速切宠物：旧宠物的响应晚到时不覆盖新宠物的日记', async () => {
    let releaseA: () => void = () => {}
    const pendingA = new Promise<void>((resolve) => { releaseA = () => resolve() })
    mockCheckinState.fetchCheckins
      .mockImplementationOnce(() => pendingA)   // 第一次（可乐）挂起
      .mockImplementation(async () => {})       // 之后（布丁）立即返回

    usePetStore.setState({
      currentPet: mockPet as any,
      pets: [mockPet, mockPet2] as any,
      userId: 'user_1',
    })
    render(createElement(PetDiaryPage))
    await waitFor(() => expect(mockCheckinState.fetchCheckins).toHaveBeenCalledTimes(1))
    // 可乐还没返回 → 此时不该生成任何日记
    expect(mockGenerateDiary).not.toHaveBeenCalled()

    // 切到布丁：布丁这次立即返回，只有它该生成日记
    usePetStore.setState({ currentPet: mockPet2 as any, pets: [mockPet, mockPet2] as any, userId: 'user_1' })
    await waitFor(() => expect(mockGenerateDiary).toHaveBeenCalledTimes(1))
    // 生成用的是布丁的出生日期（说明没读到可乐闭包里的值）
    expect(mockGenerateDiary.mock.calls[0][1]).toBe(mockPet2.birthDate)

    // 现在才放行可乐的响应：它是过期请求，必须被整体丢弃
    releaseA()
    await new Promise((r) => setTimeout(r, 30))
    expect(mockGenerateDiary).toHaveBeenCalledTimes(1)
    expect(mockGenerateDiary.mock.calls[0][1]).not.toBe(mockPet.birthDate)
  })
})

/** 独立实现一份「本地日历天差」，避免用被测工具反证被测逻辑 */
function localDaysSince(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((today.getTime() - start.getTime()) / 86400000)
}
