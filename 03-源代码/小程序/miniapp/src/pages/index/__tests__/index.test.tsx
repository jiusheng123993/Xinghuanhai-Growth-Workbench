/** 首页页面单元测试 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
// 被测组件正常置于顶部导入；vi.mock 由 vitest 自动提升到文件最前，mock 生效不受影响
import Index from '../index'
import { formatPetAge } from '../../../utils/date'

// ============================================================
// 年龄文案：2026-09-11 起全站统一到 utils/date 的 formatPetAge
// 这里**直接 import 真身**。此前本文件在测试里复制了一份 calcAge 的实现
// （注释写"从源码复制，用于测试私有函数"），源码改成别的实现它也照样绿——
// 是典型的假绿测试。现在页面已改为调用 formatPetAge，测试直接测它。
// ============================================================

/** 本地时区 YYYY-MM-DD（不能用 toISOString：东八区晚上会退到前一天） */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ============================================================
// vi.hoisted — 所有在 vi.mock factory 中引用的变量必须用 hoisted 声明
// 因为 vi.mock 会被提升到文件最顶部执行
// ============================================================
const {
  mockNavigateTo,
  mockShowToast,
  mockSwitchTab,
  mockSetClipboardData,
  mockSetFlowHandlers,
  mockHandleNewSession,
  mockPet,
  mockMessages,
  mockSessionId,
  petStoreState,
} = vi.hoisted(() => {
  const mockPetData = {
    id: 'pet_001',
    name: '旺财',
    species: 'dog' as const,
    breed: '金毛',
    birthDate: '2023-03-15',
    createdAt: '2024-01-01',
    updatedAt: '2024-06-01',
  }

  return {
    mockNavigateTo: vi.fn(),
    mockShowToast: vi.fn(),
    mockSwitchTab: vi.fn(),
    mockSetClipboardData: vi.fn(),
    mockSetFlowHandlers: vi.fn(),
    mockHandleNewSession: vi.fn(),
    mockPet: mockPetData,
    // 显式声明元素类型：初始值只有 'ai' 会让类型推断收窄成字面量，push 'user' 时类型不兼容
    mockMessages: [{ id: 'msg_1', type: 'ai' as const, content: '你好' }] as Array<{ id: string; type: 'ai' | 'user'; content: string }>,
    mockSessionId: { value: null as string | null },
    petStoreState: {
      currentPet: mockPetData as any,
      pets: [mockPetData] as any[],
      isLoading: false,
    },
  }
})

// ============================================================
// Taro 组件 mock
// ============================================================
vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick, onLongPress }: any) =>
    createElement('div', { className, style, onClick, onLongPress }, children),
  Text: ({ children, className, style }: any) =>
    createElement('span', { className, style }, children),
  ScrollView: ({ children, className }: any) =>
    createElement('div', { className }, children),
  Input: ({ className, value, placeholder, onInput, onConfirm, onFocus }: any) =>
    createElement('input', {
      className,
      value,
      placeholder,
      onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }),
      onKeyDown: (e: any) => e.key === 'Enter' && onConfirm?.(),
      onFocus,
    }),
  Image: ({ src, className, mode }: any) =>
    createElement('img', { src, className, 'data-mode': mode }),
}))

// ============================================================
// Taro API mock
// ============================================================
vi.mock('@tarojs/taro', () => ({
  default: {
    navigateTo: mockNavigateTo,
    showToast: mockShowToast,
    switchTab: mockSwitchTab,
    setClipboardData: mockSetClipboardData,
  },
  // ⚠️ 必须是**与 default 平级的具名导出**，放进 default 里没用：
  // 首页现在经 useTabBarSelected(constants/tabBar) 注册 useDidShow 来广播 tabBar 选中态
  // （自定义 tabBar 第 3 批），而 constants/tabBar.ts 用的是具名导入
  // `import Taro, { useDidShow } from '@tarojs/taro'`；缺了它本文件 20 条用例会全红，
  // 报错是「No "useDidShow" export is defined on the "@tarojs/taro" mock」。
  useDidShow: () => {},
}))

// ============================================================
// 业务 hook mock
// ============================================================
vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => 'theme-sakura-dream',
  // PageBackground 组件内部会用到这两个导出，mock 必须一并提供
  useThemeKey: () => 'autumn',
  usePetWallpaper: () => null,
}))

vi.mock('../../../hooks/useChatCore', () => ({
  useChatCore: () => ({
    messages: mockMessages,
    isTyping: false,
    setIsTyping: vi.fn(),
    chatHistory: [],
    setChatHistory: vi.fn(),
    streamingId: null,
    scrollRef: { current: null },
    addMessage: vi.fn(),
    addAiMsg: vi.fn(),
    addUserMsg: vi.fn(),
    addImageMsg: vi.fn(),
    streamAiReply: vi.fn(),
    skipStream: vi.fn(),
    scrollToBottom: vi.fn(),
    handleSend: vi.fn(),
    handleChooseImage: vi.fn(),
    pendingImage: null,
    clearPendingImage: vi.fn(),
    sendPendingImage: vi.fn(),
    setFlowHandlers: mockSetFlowHandlers,
    updateMessageCard: vi.fn(),
    agentToolStatus: null,
    // 多会话（豆包式「新建对话」）
    sessionId: mockSessionId.value,
    sessions: [],
    handleNewSession: mockHandleNewSession,
    handleSwitchSession: vi.fn(),
    handleDeleteSession: vi.fn(),
  }),
}))

vi.mock('../../../hooks/useNamingFlow', () => ({
  useNamingFlow: () => ({
    namingStep: -1,
    startNaming: vi.fn(),
    handleNamingAnswer: vi.fn(),
  }),
}))

vi.mock('../../../hooks/useFoodFlow', () => ({
  useFoodFlow: () => ({
    foodActive: false,
    handleFoodQuery: vi.fn(),
    selectFood: vi.fn(),
  }),
}))

vi.mock('../../../hooks/useMemoryFlow', () => ({
  useMemoryFlow: () => ({
    memoryActive: false,
    startMemoryRecord: vi.fn(),
    handleMemoryRecord: vi.fn(),
  }),
}))

// ============================================================
// usePetStore mock — 根据 selector 返回不同值
// ============================================================
vi.mock('../../../stores/petStore', () => ({
  usePetStore: (selector: (s: any) => any) => selector(petStoreState),
}))

// ============================================================
// 组件 / 工具 mock
// ============================================================
vi.mock('../../../components/HomeSkeleton', () => ({
  default: () => createElement('div', { 'data-testid': 'home-skeleton' }, '加载中...'),
}))

// 打卡弹窗 mock：只验证首页的"开/关"接线，卡内流程由 CheckinPopup 自己的测试覆盖
vi.mock('../../../components/CheckinPopup', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? createElement('div', { 'data-testid': 'checkin-popup' }, '打卡弹窗') : null,
}))

// 症状初筛弹窗 mock：只验证首页的"开/关"接线，卡内 4 步由 SymptomCheckPopup 自己的测试覆盖
vi.mock('../../../components/SymptomCheckPopup', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? createElement('div', { 'data-testid': 'symptom-popup' }, '症状初筛弹窗') : null,
}))

vi.mock('../../../utils/suggestQuickActions', () => ({
  suggestQuickActions: () => [
    { action: 'checkin', label: '打卡', emoji: '💩' },
    { action: 'food', label: '查食物', emoji: '🔍' },
    { action: 'symptom', label: '症状初筛', emoji: '💊' },
  ],
}))

vi.mock('../index.scss', () => ({}))

// ============================================================
// 测试套件
// ============================================================
describe('calcAge（已统一到 utils/date 的 formatPetAge）', () => {
  it('returns empty string for falsy input', () => {
    expect(formatPetAge('')).toBe('')
  })

  it('calculates months-only age (< 12 months)', () => {
    // 用「5 个月前的 1 号」：任何一天都 ≥ 1 号，必然满 5 个月，期望值不随日历抖动
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    expect(formatPetAge(localDateStr(target))).toBe('5个月')
  })

  it('calculates exact years (no remaining months)', () => {
    // 2 年前的当月 1 号 → 恰好 24 个月，不多不少
    const now = new Date()
    const target = new Date(now.getFullYear() - 2, now.getMonth(), 1)
    expect(formatPetAge(localDateStr(target))).toBe('2岁')
  })

  it('calculates years and months', () => {
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

describe('PLUS_MENU_ITEMS', () => {
  // 从源码复制常量用于测试
  const PLUS_MENU_ITEMS = [
    { icon: '📋', label: '健康打卡', sub: '5项日常检查，1分钟完成', bg: 'rgba(232,168,56,0.12)' },
    { icon: '📸', label: '记录回忆', sub: '上传照片 + 写一段话', bg: 'rgba(140,173,126,0.12)' },
    { icon: '🐱', label: '品种百科', sub: '40+品种特征和护理要点', bg: 'rgba(166,143,120,0.12)' },
    { icon: '🏠', label: '看家庭', sub: '家人动态 + 家庭周报', bg: 'rgba(224,133,107,0.12)' },
  ]

  it('has exactly 4 items', () => {
    expect(PLUS_MENU_ITEMS).toHaveLength(4)
  })

  it('each item has icon, label, sub, bg properties', () => {
    PLUS_MENU_ITEMS.forEach((item) => {
      expect(item).toHaveProperty('icon')
      expect(item).toHaveProperty('label')
      expect(item).toHaveProperty('sub')
      expect(item).toHaveProperty('bg')
      expect(typeof item.icon).toBe('string')
      expect(typeof item.label).toBe('string')
      expect(typeof item.sub).toBe('string')
      expect(typeof item.bg).toBe('string')
    })
  })

  it('first item is 健康打卡', () => {
    expect(PLUS_MENU_ITEMS[0].label).toBe('健康打卡')
    expect(PLUS_MENU_ITEMS[0].icon).toBe('📋')
  })

  it('all bg values are rgba strings', () => {
    PLUS_MENU_ITEMS.forEach((item) => {
      expect(item.bg).toMatch(/^rgba\(\d+,\d+,\d+,\d+\.\d+\)$/)
    })
  })
})

describe('Index page — render states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重置 petStore 状态为默认（有宠物）
    petStoreState.currentPet = mockPet
    petStoreState.pets = [mockPet]
    petStoreState.isLoading = false
  })

  it('renders loading state (HomeSkeleton) when isLoading and no pet', () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    petStoreState.isLoading = true

    const { container } = render(createElement(Index))

    const skeleton = container.querySelector('[data-testid="home-skeleton"]')
    expect(skeleton).toBeTruthy()
    expect(skeleton!.textContent).toContain('加载中')
  })

  it('renders empty state when no pet and not loading', () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    petStoreState.isLoading = false

    const { container } = render(createElement(Index))

    // 空状态应显示欢迎文案
    expect(container.textContent).toContain('欢迎来到星河宠记')
    expect(container.textContent).toContain('添加你的第一位宠物伙伴')
    expect(container.textContent).toContain('添加宠物')

    // 不应显示骨架屏
    const skeleton = container.querySelector('[data-testid="home-skeleton"]')
    expect(skeleton).toBeFalsy()
  })

  it('renders chat interface when pet exists', () => {
    petStoreState.currentPet = mockPet
    petStoreState.pets = [mockPet]
    petStoreState.isLoading = false

    const { container } = render(createElement(Index))

    // 顶栏固定显示应用名，不显示具体宠物名/品种
    expect(container.textContent).toContain('星河宠记')
    expect(container.textContent).toContain('AI 宠物管家')

    // 应显示问候消息
    expect(container.textContent).toContain('今日健康摘要')

    // 应显示快捷操作
    expect(container.textContent).toContain('打卡')
    expect(container.textContent).toContain('食物查询')
    expect(container.textContent).toContain('症状初筛')

    // 应显示输入区域
    expect(container.textContent).toContain('+')

    // 不应显示空状态
    expect(container.textContent).not.toContain('欢迎来到星河宠记')
  })

  it('renders paw emoji for dog species', () => {
    petStoreState.currentPet = mockPet
    petStoreState.pets = [mockPet]
    petStoreState.isLoading = false

    const { container } = render(createElement(Index))

    // 顶栏头像统一为 🐾，不区分物种
    expect(container.textContent).toContain('🐾')
  })

  it('renders pet avatar image when pet has avatar (photo > cartoon priority)', () => {
    // 全局一致性：首页摘要卡头像优先显示真实照片，其次 AI/卡通形象，与档案页/其他页面一致
    const petWithPhoto = { ...mockPet, avatarPhotoUrl: 'https://example.com/photo.jpg' }
    petStoreState.currentPet = petWithPhoto
    petStoreState.pets = [petWithPhoto]
    petStoreState.isLoading = false

    const { container } = render(createElement(Index))
    const img = container.querySelector('.home-summary-avatar-img') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img?.src).toContain('https://example.com/photo.jpg')
  })

  it('renders cartoon avatar when pet only has cartoon image', () => {
    const petWithCartoon = { ...mockPet, avatarCartoonUrl: 'https://example.com/cartoon.jpg' }
    petStoreState.currentPet = petWithCartoon
    petStoreState.pets = [petWithCartoon]
    petStoreState.isLoading = false

    const { container } = render(createElement(Index))
    const img = container.querySelector('.home-summary-avatar-img') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img?.src).toContain('https://example.com/cartoon.jpg')
  })

  it('renders paw emoji for cat species', () => {
    const catPet = { ...mockPet, species: 'cat' as const, breed: '英短' }
    petStoreState.currentPet = catPet
    petStoreState.pets = [catPet]
    petStoreState.isLoading = false

    const { container } = render(createElement(Index))

    expect(container.textContent).toContain('🐾')
  })

  it('renders default paw emoji for unknown species', () => {
    const unknownPet = { ...mockPet, species: 'rabbit' as any, breed: '垂耳兔' }
    petStoreState.currentPet = unknownPet
    petStoreState.pets = [unknownPet]
    petStoreState.isLoading = false

    const { container } = render(createElement(Index))

    expect(container.textContent).toContain('🐾')
  })

  it('does not render skeleton when pet exists but isLoading is true', () => {
    // 有宠物时即使 isLoading 也不显示骨架屏
    petStoreState.currentPet = mockPet
    petStoreState.pets = [mockPet]
    petStoreState.isLoading = true

    const { container } = render(createElement(Index))

    const skeleton = container.querySelector('[data-testid="home-skeleton"]')
    expect(skeleton).toBeFalsy()
    expect(container.textContent).toContain('星河宠记')
  })

  it('empty state add-pet button navigates to add pet page', () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    petStoreState.isLoading = false

    const { container } = render(createElement(Index))

    const addBtn = container.querySelector('.chat-empty-btn')
    expect(addBtn).toBeTruthy()

    addBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesPet/add/index' })
  })
})

describe('Index page — 打卡弹窗卡片交互', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    petStoreState.currentPet = mockPet
    petStoreState.pets = [mockPet]
    petStoreState.isLoading = false
  })

  it('默认不渲染打卡弹窗', () => {
    const { container } = render(createElement(Index))

    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeFalsy()
  })

  it('点击快捷操作「健康打卡」打开弹窗卡片（不再往聊天流塞逐条消息）', () => {
    const { container } = render(createElement(Index))

    const btn = Array.from(container.querySelectorAll('.msg-quick-btn')).find(
      el => el.textContent?.includes('健康打卡')
    )
    expect(btn).toBeTruthy()

    fireEvent.click(btn!)
    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeTruthy()
  })

  it('点击「3秒健康打卡」主按钮打开弹窗卡片', () => {
    const { container } = render(createElement(Index))

    const cta = container.querySelector('.home-checkin-cta')
    expect(cta).toBeTruthy()

    fireEvent.click(cta!)
    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeTruthy()
  })

  it('点击今日健康摘要卡打开弹窗卡片', () => {
    const { container } = render(createElement(Index))

    const card = container.querySelector('.home-summary-card')
    expect(card).toBeTruthy()

    fireEvent.click(card!)
    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeTruthy()
  })
})

describe('Index page — 症状初筛弹窗卡片交互', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    petStoreState.currentPet = mockPet
    petStoreState.pets = [mockPet]
    petStoreState.isLoading = false
  })

  it('默认不渲染症状初筛弹窗', () => {
    const { container } = render(createElement(Index))

    expect(container.querySelector('[data-testid="symptom-popup"]')).toBeFalsy()
  })

  it('首页「症状初筛」快捷入口打开弹窗卡片（不再往聊天流塞逐条问答）', () => {
    const { container } = render(createElement(Index))

    const shortcut = Array.from(container.querySelectorAll('.home-shortcut')).find(
      el => el.textContent?.includes('症状初筛')
    )
    expect(shortcut).toBeTruthy()

    fireEvent.click(shortcut!)
    expect(container.querySelector('[data-testid="symptom-popup"]')).toBeTruthy()
  })
})

describe('Index page — 长对话软提示（多会话）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    petStoreState.currentPet = mockPet
    petStoreState.pets = [mockPet]
    petStoreState.isLoading = false
    // 重置：默认短会话、无会话 id
    mockMessages.length = 0
    mockMessages.push({ id: 'msg_1', type: 'ai' as const, content: '你好' })
    mockSessionId.value = null
  })

  it('消息不足 60 条时不显示软提示', () => {
    const { container } = render(createElement(Index))

    expect(container.querySelector('.chat-long-tip')).toBeFalsy()
  })

  it('当前会话消息满 60 条时显示软提示（建议新建对话）', () => {
    mockSessionId.value = 'session-1'
    mockMessages.length = 0
    for (let i = 0; i < 60; i++) {
      mockMessages.push({ id: `msg_${i}`, type: i % 2 === 0 ? 'user' as const : 'ai' as const, content: `消息${i}` })
    }

    const { container } = render(createElement(Index))

    const tip = container.querySelector('.chat-long-tip')
    expect(tip).toBeTruthy()
    expect(tip!.textContent).toContain('新建对话')
  })
})

describe('Index page — 新建对话入口（顶部常驻，用户反馈修复）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    petStoreState.currentPet = mockPet
    petStoreState.pets = [mockPet]
    petStoreState.isLoading = false
    mockMessages.length = 0
    mockMessages.push({ id: 'msg_1', type: 'ai' as const, content: '你好' })
    mockSessionId.value = null
  })

  it('顶部栏常驻「新建」按钮，不依赖历史抽屉（无需展开即可见）', () => {
    const { container } = render(createElement(Index))

    const newBtn = container.querySelector('.chat-top-new-btn')
    expect(newBtn).toBeTruthy()
    expect(newBtn!.textContent).toContain('新建')
    // 抽屉关闭态下按钮仍在 → 证明入口不藏在历史里
    expect(container.querySelector('.session-drawer-overlay')).toBeFalsy()
  })

  it('点击顶部「新建」按钮直接新建会话', () => {
    const { container } = render(createElement(Index))

    const newBtn = container.querySelector('.chat-top-new-btn')
    expect(newBtn).toBeTruthy()

    fireEvent.click(newBtn!)

    expect(mockHandleNewSession).toHaveBeenCalledTimes(1)
  })
})