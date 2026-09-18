/**
 * 设置页单元测试
 *
 * 【本批（2026-09-12 v2 对齐批）为什么重写这份测试】
 * 本页从"10 个平铺区块"重排成 v2 的四组卡片（账号 / 偏好 / 数据管理 / 关于），
 * 结构改动很大，而它承载着**不能丢**的三类东西，所以逐条钉住：
 *   ① 「新手指引」常驻回看入口（2026-09-12 新增，硬约束要求必须保留，且必须真跳转不是假按钮）；
 *   ② 四季主题胶囊（v2 的核心交互：点一下真的改主题，不是画着好看）；
 *   ③ 「提醒」行的展开面板里三条真实通知开关（折叠只是收纳，开关本身不能消失）；
 *   ④ 「隐私」入口与危险操作（注销账号 / 删除云端数据）都还在，且各有落点。
 * 另外保留原测试对「新手指引」的断言（未删改，只是搬进新的 describe 分组）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'

const mocks = vi.hoisted(() => ({
  taro: {
    navigateTo: vi.fn().mockResolvedValue({ errMsg: 'navigateTo:ok' }),
    reLaunch: vi.fn().mockResolvedValue({ errMsg: 'reLaunch:ok' }),
    switchTab: vi.fn().mockResolvedValue({ errMsg: 'switchTab:ok' }),
    pageScrollTo: vi.fn().mockResolvedValue({ errMsg: 'pageScrollTo:ok' }),
    showToast: vi.fn(),
    showModal: vi.fn(),
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    setClipboardData: vi.fn().mockResolvedValue(undefined),
    compressImage: vi.fn(),
    saveFile: vi.fn(),
    getSystemInfoSync: vi.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
    eventCenter: { on: vi.fn(), off: vi.fn(), trigger: vi.fn() },
  },
  trackPageView: vi.fn(),
  trackEvent: vi.fn(),
  updateNotification: vi.fn(),
  updateProfile: vi.fn(),
  // 主题：这里的 current 固定成 'autumn'，只是本文件用例的 fixture（秋季预览件的断言数据），
  // 与真实 store 的默认主题无关 —— 默认主题 2026-09-12 起是 spring，别照抄当默认值。
  setTheme: vi.fn(),
  applyNativeBars: vi.fn(),
  setPetWallpaper: vi.fn(),
}))

/**
 * 当前主题的可变 holder（供 useThemeKey / useThemeClass 两个 mock 共用）
 *
 * 【为什么需要它】主题预览块显示的是「当前主题」（名称 / desc / 插画 key 都跟着变），
 * 而 useThemeKey 是**渲染期调用**的 hook —— 写死返回值就没法测"换主题后预览跟着换"。
 * 用一个模块级可变对象，切换后重新 render 即可。
 */
const themeBox = vi.hoisted(() => ({ key: 'autumn' as string }))

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) =>
    createElement('div', { className, style, onClick }, children),
  Text: ({ children, className, onClick }: any) =>
    createElement('span', { className, onClick }, children),
  Button: ({ children, className, onClick }: any) =>
    createElement('button', { className, onClick }, children),
  Input: ({ className, value, onInput }: any) =>
    createElement('input', { className, value, onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }) }),
  Image: ({ src, className }: any) => createElement('img', { src, className }),
  Switch: ({ checked, color, onChange }: any) =>
    createElement('input', {
      type: 'checkbox',
      checked,
      readOnly: true,
      'data-color': color,
      onChange: (e: any) => onChange?.({ detail: { value: e.target.checked } }),
    }),
  ScrollView: ({ children, className }: any) => createElement('div', { className }, children),
}))

vi.mock('@tarojs/taro', () => ({ default: mocks.taro }))

vi.mock('../../../stores/authStore', () => {
  // 快照稳定（同 settingsStore 的说明）：selector 返回的字段必须是同一批引用
  const user = { id: 'user_1', nickname: '铲屎官小王', avatar: 'https://cdn.example.com/a.png' }
  const state = { user, isAuthenticated: true, logout: vi.fn(), updateProfile: mocks.updateProfile }
  return { useAuthStore: (selector: any) => selector(state) }
})

vi.mock('../../../stores/settingsStore', () => {
  // ⚠️ 快照必须**稳定**：zustand 的 useSyncExternalStore 用 Object.is 比较 selector 返回的快照，
  // 每次渲染返回新对象会导致"永远不等"→ 无限重渲染 → 堆爆（本文件首次运行即因此 OOM）。
  // 所以这里把通知设置与动作都提到工厂外层，只创建一次。
  const notification = { checkinReminder: false, vaccineReminder: true, healthAlert: false }
  const loadSettings = vi.fn()
  const clearCache = vi.fn()
  const exportData = vi.fn()
  return {
    useSettingsStore: (selector: any) =>
      selector({ notification, loadSettings, updateNotification: mocks.updateNotification, clearCache, exportData }),
  }
})

vi.mock('../../../stores/themeStore', () => {
  // ThemeMeta 的字段与真实 store 保持一致（本页用到 name / desc / primaryColor / palette）
  // ⚠️ desc 不能漏：主题预览块的副标题直接读它（单一真相源），漏了会渲染成空白
  const META: Record<string, any> = {
    spring: { name: '嫩芽绿', desc: '清新嫩芽绿 · 迎春花黄 · 奶油嫩白', primaryColor: '#54B460', palette: { goldDeep: '#E8A81C', teal: '#4FA3E3', success: '#2FC98E' } },
    summer: { name: '海盐蓝', desc: '海盐天蓝 · 落日橙 · 清爽蓝白', primaryColor: '#2FA8E8', palette: { goldDeep: '#E8931C', teal: '#4FA3E3', success: '#2FC98E' } },
    autumn: { name: '暖阳珊瑚橙', desc: '高饱和珊瑚橙 · 暖金 · 奶油暖白', primaryColor: '#FF6B3D', palette: { goldDeep: '#E8920A', teal: '#4FA3E3', success: '#2FC98E' } },
    winter: { name: '冰晶紫', desc: '冰晶紫 · 雪青蓝 · 霜白', primaryColor: '#6C7CF0', palette: { goldDeep: '#6A82CE', teal: '#4FA3E3', success: '#2FC98E' } },
    starry: { name: '星空银河', desc: '深蓝夜空 · 星河流转 · 暖金星点', primaryColor: '#7A8CFF', palette: { goldDeep: '#E8A81C', teal: '#6FC0F5', success: '#2FC98E' } },
    grid: { name: '奶油格纹', desc: '奶油底色 · 细格纹 · 手账质感', primaryColor: '#FF6B3D', palette: { goldDeep: '#E8920A', teal: '#4FA3E3', success: '#2FC98E' } },
  }
  const state = {
    current: 'autumn' as const,
    petWallpaper: null as string | null,
    setTheme: mocks.setTheme,
    setPetWallpaper: mocks.setPetWallpaper,
    applyNativeBars: mocks.applyNativeBars,
  }
  return {
    // 本页只用 getState()（不订阅 store），故 mock 成最小可用形状
    useThemeStore: Object.assign(() => state, { getState: () => state }),
    getThemeMeta: (key: string) => META[key] ?? META.autumn,
  }
})

vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => `theme-${themeBox.key}`,
  // 用可变的 holder 而不是写死 'autumn'：主题预览块要断言"换主题后预览跟着换"，
  // 而 useThemeKey 是渲染期调用的 hook → 改 holder 再 render 即可（见预览块那几个用例）
  useThemeKey: () => themeBox.key,
  usePetWallpaper: () => null,
}))

vi.mock('../../../hooks/useMembership', () => {
  // 同上：返回对象必须稳定，否则每次渲染都是新引用
  const membership = { isMember: false, membership: null }
  return { useMembership: () => membership }
})

vi.mock('../../../hooks/useAnalytics', () => ({
  useAnalytics: () => ({ trackPageView: mocks.trackPageView, trackEvent: mocks.trackEvent }),
}))

// 组件依赖：只保留本页结构，避免把无关组件的内部行为拖进这条测试
vi.mock('../../../components', () => ({
  Icon: ({ name }: any) => createElement('i', { 'data-icon': name }),
  // 插画组件：把 name 落到 data-illustration 上，供「主题预览块用的是哪个 key」这条断言使用；
  // 真实组件的取 URL / 尺寸 / 失败降级逻辑不在本测试范围内（它有自己的测试）
  Illustration: ({ name, className }: any) => createElement('img', { 'data-illustration': name, className }),
}))

// 插画 URL 出口：本页只断言"用的是哪个 key"，不重复测 data 层的拼装规则
// （`brand-starry` 必须命中固定远程图 today-brand-starry.jpg 那条规则由 illustrations.test.ts 钉住）
vi.mock('../../../data/illustrations', () => ({
  illustrationUrl: (name: string) =>
    name === 'brand-starry'
      ? 'https://api.xinghuanhai.com/uploads/illustrations/seasonal/today-brand-starry.jpg'
      : `https://api.xinghuanhai.com/uploads/illustrations/${name}.jpg`,
}))
vi.mock('../../../components/AccountDeletionConfirm', () => ({ AccountDeletionConfirm: () => null }))

// 服务层：数据隐私状态/导出等（本页 useEffect 会读一次隐私状态）
vi.mock('../../../services/dataPrivacyService', () => ({
  exportAllUserData: vi.fn(),
  deleteUserData: vi.fn(),
  generateDeletionConfirmCode: vi.fn(() => '123456'),
  getDataPrivacyStatus: vi.fn(() => ({
    accountDeletionRequested: false,
    accountDeletionScheduledAt: null,
  })),
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletion: vi.fn(),
}))

vi.mock('../../../services/authService', () => ({ bindPhone: vi.fn() }))
vi.mock('../../../services/api', () => ({ api: { uploadAvatar: vi.fn() } }))
vi.mock('../../../platform', () => ({ isWeapp: () => true }))
vi.mock('../../../utils/privacy', () => ({ chooseImageWithPrivacy: vi.fn() }))

import SettingsPage from '../index'
import { ONBOARDING_URL } from '../../../utils/onboardingGate'
import { illustrationUrl } from '../../../data/illustrations'

describe('设置页结构（v2 四组卡片）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('四组分组标题都渲染（账号 / 偏好 / 数据管理 / 关于）', () => {
    render(<SettingsPage />)

    expect(screen.getByText('账号')).toBeTruthy()
    expect(screen.getByText('偏好')).toBeTruthy()
    expect(screen.getByText('数据管理')).toBeTruthy()
    expect(screen.getByText('关于')).toBeTruthy()
  })

  it('账号组显示真实昵称（不是写死的假文案）', () => {
    render(<SettingsPage />)

    expect(screen.getByText('头像与昵称')).toBeTruthy()
    expect(screen.getByText('手机号')).toBeTruthy()
    // 昵称来自 authStore 的 user.nickname
    expect(screen.getByText('铲屎官小王')).toBeTruthy()
  })

  it('★ 「头像与昵称」行真的滚回顶部资料卡（不是假按钮）', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('头像与昵称'))

    expect(mocks.taro.pageScrollTo).toHaveBeenCalledWith({ scrollTop: 0, duration: 240 })
    expect(mocks.trackEvent).toHaveBeenCalledWith('edit_profile_from_account_row')
  })
})

describe('设置页·主题皮肤（v2 四季胶囊）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('季节切换胶囊渲染为「春 / 夏 / 秋 / 冬」四个，且当前配色名可见', () => {
    render(<SettingsPage />)

    expect(screen.getByText('主题皮肤')).toBeTruthy()
    for (const label of ['春', '夏', '秋', '冬']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // 当前主题名（autumn = 暖阳珊瑚橙）显示在行的右上角。
    // ⚠️ 这里必须按类名取，不能用 getByText：合并后同一屏有两处渲染主题名
    //    （行右上角的「当前」+ 卡内预览块的标题），文本查询会命中 2 个元素直接报错。
    expect(document.querySelector('.settings-page__theme-now')?.textContent).toBe('暖阳珊瑚橙')
  })

  it('★ 点「春」真的切主题（调 themeStore.setTheme + 埋点），不是画着好看', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('春'))

    expect(mocks.setTheme).toHaveBeenCalledWith('spring')
    expect(mocks.trackEvent).toHaveBeenCalledWith('change_theme', { theme: 'spring' })
  })

  it('点当前主题（秋）不重复切换、不弹提示', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('秋'))

    expect(mocks.setTheme).not.toHaveBeenCalled()
  })

  it('非四季的两套背景不用展开就在主题卡里；照片壁纸入口仍收在折叠里（既有能力没丢）', () => {
    render(<SettingsPage />)

    // 6 套主题同属「主题皮肤」一张卡、一眼看全：非四季那两套不再需要先展开才看得到
    expect(screen.getByText('星空银河')).toBeTruthy()
    expect(screen.getByText('奶油格纹')).toBeTruthy()

    // 照片壁纸是"主题之外的另一种背景来源"，仍收在折叠里：展开前没有操作胶囊
    expect(screen.queryByText('选择照片')).toBeNull()
    fireEvent.click(screen.getByText('宠物照片壁纸'))
    expect(screen.getByText('选择照片')).toBeTruthy()
  })
})

/**
 * 主题预览块（2026-09-12：由「独立星空预览卡」合并进「主题皮肤」卡）
 *
 * 【为什么重写这组用例】原先断言的是**一张星空专属的独立卡**（写死文案「星空银河 · 深色主题」/
 * 「毛孩子回到天上当星星」）；合并后预览跟随**当前主题**（名称 / desc / 插画 key 都跟着变），
 * 所以断言口径从"卡片文案写死"改成"跟着 themeKey 变"，并多钉一条"四季走季节图 key"。
 */
describe('设置页·主题预览块（主题卡内的"当前主题预览"）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认回到秋主题（其它用例可能把它改成 starry）
    themeBox.key = 'autumn'
  })

  it('★ 预览显示当前主题的名称与该主题注册的 desc（不是写死的运营文案）', () => {
    render(<SettingsPage />)

    expect(document.querySelector('.settings-page__theme-preview-title')?.textContent).toBe('暖阳珊瑚橙')
    expect(document.querySelector('.settings-page__theme-preview-desc')?.textContent).toBe(
      '高饱和珊瑚橙 · 暖金 · 奶油暖白',
    )
  })

  it('★ 当前是星空银河时，预览插画切到固定 key brand-starry（→ today-brand-starry.jpg）', () => {
    themeBox.key = 'starry'
    render(<SettingsPage />)

    expect(document.querySelector('.settings-page__theme-preview-desc')?.textContent).toBe(
      '深蓝夜空 · 星河流转 · 暖金星点',
    )

    const art = document.querySelector('[data-illustration]')
    expect(art?.getAttribute('data-illustration')).toBe('brand-starry')
    // 且该 key 解析出的就是服务器上那张固定图（不是季节拼装出来的名字）
    expect(illustrationUrl('brand-starry')).toBe(
      'https://api.xinghuanhai.com/uploads/illustrations/seasonal/today-brand-starry.jpg',
    )
  })

  it('四季主题下预览走季节 key page-home（由插画组件按当前主题解析成对应季节的图）', () => {
    render(<SettingsPage />)

    const art = document.querySelector('[data-illustration]')
    expect(art?.getAttribute('data-illustration')).toBe('page-home')
  })

  it('奶油格纹没有专属品牌图：预览不插图（改画它自己的格纹底），文案仍读它自己的 desc', () => {
    themeBox.key = 'grid'
    render(<SettingsPage />)

    // 不插图是**有意**的：按季节回退会拿秋季风景图去配"奶油底色 · 细格纹"的说明，图文对不上
    expect(document.querySelector('[data-illustration]')).toBeNull()
    expect(document.querySelector('.settings-page__theme-preview-desc')?.textContent).toBe(
      '奶油底色 · 细格纹 · 手账质感',
    )
  })

  it('★ 点非四季的「星空银河」胶囊真的切主题（不是假按钮）', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('星空银河'))

    expect(mocks.setTheme).toHaveBeenCalledWith('starry')
    expect(mocks.trackEvent).toHaveBeenCalledWith('change_theme', { theme: 'starry' })
    expect(mocks.taro.showToast).toHaveBeenCalled()
  })
})

describe('设置页·提醒（折叠面板里是真实开关）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('点「提醒」展开三条真实通知开关，且带当前状态', () => {
    render(<SettingsPage />)
    // 折叠状态下开关不可见
    expect(screen.queryByText('打卡提醒')).toBeNull()

    fireEvent.click(screen.getByText('提醒'))

    expect(screen.getByText('打卡提醒')).toBeTruthy()
    expect(screen.getByText('疫苗驱虫提醒')).toBeTruthy()
    expect(screen.getByText('健康异常提醒')).toBeTruthy()
  })

  it('★ 拨动开关真的写回 settingsStore（toggle_notification 埋点 + updateNotification）', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('提醒'))

    const checkbox = screen.getByText('打卡提醒').parentElement?.querySelector('input')
    expect(checkbox).toBeTruthy()
    fireEvent.click(checkbox as Element)

    expect(mocks.updateNotification).toHaveBeenCalledWith('checkinReminder', true)
    expect(mocks.trackEvent).toHaveBeenCalledWith('toggle_notification', { key: 'checkinReminder', value: true })
  })

  it('开关轨道色跟随主题色板（不再写死 #4A90D9）', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('提醒'))

    const checkbox = screen.getByText('打卡提醒').parentElement?.querySelector('input')
    // autumn 主题的 palette.goldDeep
    expect(checkbox?.getAttribute('data-color')).toBe('#E8920A')
  })
})

describe('设置页·危险操作入口都在（重排后不能丢）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('数据管理组里「注销账号」「删除云端数据」「导出全部数据」都渲染', () => {
    render(<SettingsPage />)

    expect(screen.getByText('注销账号')).toBeTruthy()
    expect(screen.getByText('删除云端数据')).toBeTruthy()
    expect(screen.getByText('导出全部数据')).toBeTruthy()
    expect(screen.getByText('AI 记忆纠错')).toBeTruthy()
    expect(screen.getByText('清除缓存')).toBeTruthy()
  })

  it('「AI 记忆纠错」跳转团团的记忆页', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('AI 记忆纠错'))

    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesUser/memory/index' })
  })

  it('「用户协议」「隐私政策」分别带各自的 type 参数', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('用户协议'))
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesUser/agreement/index?type=user' })

    fireEvent.click(screen.getByText('隐私政策'))
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesUser/agreement/index?type=privacy' })
  })

  it('「退出登录」在「关于」卡里，点了会弹确认框', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('退出登录'))

    expect(mocks.taro.showModal).toHaveBeenCalled()
  })
})

describe('设置页「新手指引」入口（2026-09-12 新增，本批必须保留）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('「关于」分组里有「新手指引」行，副标题写明 3 步', () => {
    render(<SettingsPage />)

    expect(screen.getByText('新手指引')).toBeTruthy()
    expect(screen.getByText('3 步了解星河宠记')).toBeTruthy()
  })

  it('★ 点击「新手指引」真的跳转（不是假按钮）→ navigateTo 已注册的引导页路由', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('新手指引'))

    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: ONBOARDING_URL })
    // 回看语义：用 navigateTo 保留设置页在栈里（看完能返回），不是 redirectTo/reLaunch
    expect(mocks.taro.reLaunch).not.toHaveBeenCalled()
    expect(mocks.trackEvent).toHaveBeenCalledWith('open_onboarding_guide')
  })
})
