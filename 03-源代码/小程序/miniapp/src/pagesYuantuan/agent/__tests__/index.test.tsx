/**
 * 团团 · AI 全屏对话页 —— 单元测试（2026-09-12 IA 第 4 批新增）
 *
 * 【这一页从哪来】今天页（`pages/index`）重做成健康看板后，AI 对话（欢迎语 / 消息流 /
 * 输入框 / 会话历史抽屉 / 快捷能力）整体搬到本页，本页是「全站 AI 能力的唯一入口」。
 *
 * 【本文件覆盖什么】
 *  1. 首屏：团团身份顶栏 + 欢迎语 + 常驻能力条 + 输入框 + 医疗免责声明；
 *  2. 空态 / 加载态：没有宠物时团团没有档案可问，只能引导去添加宠物；
 *  3. **发送消息主路径**：输入 → 发送 → 用户消息上屏 → AI 流式回复上屏，
 *     并且**网络层全部 mock，绝不真发请求**（对齐 hooks/__tests__/useChatCoreHistory.test.ts 的做法）；
 *  4. 能力入口 / 加号面板的跳转与弹窗接线；
 *  5. 多会话：新建、历史抽屉、切换、长按删除、长对话软提示。
 *
 * 【为什么用**真实** useChatCore 而不是把它 mock 掉】
 * 页面测试要验证的正是"页面 ↔ 聊天核心"的接线（发了消息到底有没有进列表、会话 id 有没有透传）。
 * 把它 mock 掉就只能断言"函数被调用过"，测不出"消息真的上屏"。
 * 它依赖的所有网络出口（agentService / chatService）在本文件里都被替换掉了，
 * 所以既真实又不联网。会话/历史本身的行为边界另有 hooks/__tests__ 覆盖，此处不重复。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { createElement, forwardRef } from 'react'
import YuantuanAgent from '../index'

// ============================================================
// vi.hoisted —— vi.mock 工厂里引用的变量必须 hoisted（vi.mock 被提升到文件最前）
// ============================================================
const {
  mockNavigateTo,
  mockSwitchTab,
  mockNavigateBack,
  mockShowToast,
  mockShowModal,
  mockPreviewImage,
  mockSetClipboardData,
  mockGetCurrentPages,
  mockListChatSessions,
  mockLoadAgentHistory,
  mockCreateChatSession,
  mockDeleteChatSession,
  mockAgentChat,
  mockSendChatMessage,
  mockChooseImageWithPrivacy,
  mockStartNaming,
  mockHandleFoodQuery,
  mockStartMemoryRecord,
  mockHandleNamingAnswer,
  /** 路由参数容器：`capability` 用例通过改它来模拟"带参数进页面"（见 Taro mock 的 getCurrentInstance） */
  routerParams,
  petStoreState,
  pet,
} = vi.hoisted(() => {
  const petData = {
    id: 'pet_001',
    name: '旺财',
    species: 'dog' as const,
    breed: '金毛',
    birthDate: '2023-03-15',
    createdAt: '2024-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  return {
    mockNavigateTo: vi.fn(),
    // 返回 Promise：safeNavigateBack 会链式 .catch()，返回 undefined 会在页面里抛 TypeError
    mockSwitchTab: vi.fn(() => Promise.resolve()),
    mockNavigateBack: vi.fn(() => Promise.resolve()),
    mockShowToast: vi.fn(),
    mockShowModal: vi.fn(),
    mockPreviewImage: vi.fn(),
    mockSetClipboardData: vi.fn(),
    /** 页面栈：默认空栈 → safeNavigateBack 走 switchTab 兜底回首页 */
    mockGetCurrentPages: vi.fn(() => [] as unknown[]),
    mockListChatSessions: vi.fn(),
    mockLoadAgentHistory: vi.fn(),
    mockCreateChatSession: vi.fn(),
    mockDeleteChatSession: vi.fn(),
    mockAgentChat: vi.fn(),
    mockSendChatMessage: vi.fn(),
    mockChooseImageWithPrivacy: vi.fn(),
    mockStartNaming: vi.fn(),
    mockHandleFoodQuery: vi.fn(),
    mockStartMemoryRecord: vi.fn(),
    mockHandleNamingAnswer: vi.fn(),
    pet: petData,
    routerParams: {} as Record<string, string>,
    petStoreState: {
      currentPet: petData as any,
      pets: [petData] as any[],
      isLoading: false,
    },
  }
})

// ============================================================
// Taro 组件 mock
// ============================================================
vi.mock('@tarojs/components', () => ({
  // onLongPress 是 Taro 专有 prop，DOM 里没有对应事件：桥接到 onContextMenu，
  // 这样测试能用 fireEvent.contextMenu 触发"长按删除会话"（否则该分支无法被覆盖）
  View: ({ children, className, style, onClick, onLongPress }: any) =>
    createElement('div', { className, style, onClick, onContextMenu: onLongPress }, children),
  // Text 转发 onClick：能力条/胶囊等位置有 <Text onClick>
  Text: ({ children, className, style, onClick }: any) =>
    createElement('span', { className, style, onClick }, children),
  // 消息列表的 ScrollView 带 ref={chat.scrollRef}（用于滚到底部）：
  // 用 forwardRef 才能把 ref 落到 DOM 上，否则 React 会警告
  // "Function components cannot be given refs"
  ScrollView: forwardRef(({ children, className }: any, ref: any) =>
    createElement('div', { className, ref }, children)),
  Image: ({ src, className, mode, onError }: any) =>
    createElement('img', { src, className, 'data-mode': mode, onError }),
  // 输入框：把 DOM onChange 翻译成 Taro 的 onInput({ detail: { value } })，
  // 页面正是用 e.detail.value 写 state 的；不翻译就永远测不到"输入→发送"
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
    navigateBack: mockNavigateBack,
    reLaunch: vi.fn(() => Promise.resolve()),
    getCurrentPages: mockGetCurrentPages,
    showToast: mockShowToast,
    showModal: mockShowModal,
    previewImage: mockPreviewImage,
    setClipboardData: mockSetClipboardData,
    showShareMenu: vi.fn(),
    getStorageSync: vi.fn(() => null),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    getEnv: vi.fn(() => 'WEAPP'),
    // 页面用 `Taro.getCurrentInstance()?.router?.params?.capability` 读能力参数（本仓既有读参口径）。
    // 把 routerParams 做成可变对象，`capability` 用例里改它就等于"带参数进页面"。
    getCurrentInstance: () => ({ router: { path: '/pagesYuantuan/agent/index', params: routerParams } }),
  },
  // ⚠️ 具名导出必须与 default 平级：useThemeClass 用的是
  // `import Taro, { useDidShow } from '@tarojs/taro'`，缺了会报
  // 「No "useDidShow" export is defined on the "@tarojs/taro" mock」
  useDidShow: () => {},
  useShareAppMessage: () => {},
  useShareTimeline: () => {},
  useRouter: () => ({ path: '/pagesYuantuan/agent/index', params: {} }),
  getStorageSync: vi.fn(() => null),
}))

// ============================================================
// 网络层 mock（本页最容易"真发请求"的地方，必须全部掐断）
// ============================================================

// Agent 对话服务：agentChat 是 async generator，mock 成同形函数（返回可控事件流）
vi.mock('../../../services/agentService', () => ({
  agentChat: (...args: any[]) => mockAgentChat(...args),
  getToolLabel: (name: string) => name,
  loadAgentHistory: (...args: any[]) => mockLoadAgentHistory(...args),
  listChatSessions: (...args: any[]) => mockListChatSessions(...args),
  createChatSession: (...args: any[]) => mockCreateChatSession(...args),
  deleteChatSession: (...args: any[]) => mockDeleteChatSession(...args),
}))

// 非流式聊天服务：只在 Agent 失败时兜底用，这里留着 vi.fn 证明"没被走到"
vi.mock('../../../services/chatService', () => ({
  sendChatMessage: (...args: any[]) => mockSendChatMessage(...args),
  analyzeChatPhoto: vi.fn(),
}))

// 选图（隐私协议授权链）—— 不 mock 会在 jsdom 里走 Taro.authorize 报错
vi.mock('../../../utils/privacy', () => ({
  chooseImageWithPrivacy: (...args: any[]) => mockChooseImageWithPrivacy(...args),
}))

// 日志：静音，避免测试输出被 logger 噪声淹没（也避免把 mock 数据打进日志）
vi.mock('../../../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ============================================================
// 业务 hook mock
// ============================================================
vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => 'theme-autumn',
  useThemeKey: () => 'autumn',
  usePetWallpaper: () => null,
}))

/**
 * 语音输入：真实实现依赖微信同声传译插件（requirePlugin('WechatSI')），
 * jsdom 里必然不可用。这里只固定成"不支持语音"的稳定状态，
 * 让文字输入这条主路径不受平台探测结果影响。
 */
vi.mock('../../../hooks/useVoiceInput', () => ({
  useVoiceInput: () => ({
    isVoiceSupported: false,
    isRecording: false,
    recordDuration: 0,
    startRecord: vi.fn(),
    stopRecord: vi.fn(),
  }),
}))

/**
 * 三条对话内流程（取名 / 食物 / 回忆）：mock 掉。
 * 它们各自会调自己的服务（namingService / foodService / timelineService），
 * 本文件要验的是"能力入口有没有把用户送进流程"，流程内部由各自的测试覆盖。
 * 返回值必须**穷举页面真正读到的字段**，少一个就是运行期 undefined 崩溃。
 */
vi.mock('../../../hooks/useNamingFlow', () => ({
  useNamingFlow: () => ({
    namingStep: -1,
    currentStep: null,
    isTextInputActive: false,
    isUploadingPhoto: false,
    namingDetailPopup: null,
    isDetailLoading: false,
    startNaming: mockStartNaming,
    handleNamingAnswer: mockHandleNamingAnswer,
    handleNamingText: vi.fn(),
    handleNamingDetail: vi.fn(),
    refreshNaming: vi.fn(),
    closeNamingDetail: vi.fn(),
    applyNamingName: vi.fn(),
    skipNamingPhoto: vi.fn(),
    skipNamingDesc: vi.fn(),
    handleNamingPhoto: vi.fn(),
  }),
}))

vi.mock('../../../hooks/useFoodFlow', () => ({
  useFoodFlow: () => ({
    foodActive: false,
    handleFoodQuery: mockHandleFoodQuery,
    selectFood: vi.fn(),
  }),
}))

vi.mock('../../../hooks/useMemoryFlow', () => ({
  useMemoryFlow: () => ({
    memoryActive: false,
    startMemoryRecord: mockStartMemoryRecord,
    handleMemoryRecord: vi.fn(),
    memoryPhoto: null,
    handleMemoryPhoto: vi.fn(),
    clearMemoryPhoto: vi.fn(),
    isUploadingPhoto: false,
  }),
}))

// ============================================================
// store mock —— 按 selector 返回字段；getState 也补上（页面/依赖方可能直接取）
// ============================================================
vi.mock('../../../stores/petStore', () => {
  const usePetStore: any = (selector?: (s: any) => any) =>
    selector ? selector(petStoreState) : petStoreState
  usePetStore.getState = () => petStoreState
  return { usePetStore }
})

// ============================================================
// 组件 mock（只验证页面级"开/关"接线，卡片内部流程由各自的测试覆盖）
// ============================================================
vi.mock('../../../components/HomeSkeleton', () => ({
  default: () => createElement('div', { 'data-testid': 'home-skeleton' }, '加载中...'),
}))

vi.mock('../../../components/CheckinPopup', () => ({
  default: ({ open }: any) =>
    open ? createElement('div', { 'data-testid': 'checkin-popup' }, '打卡弹窗') : null,
}))

vi.mock('../../../components/SymptomCheckPopup', () => ({
  default: ({ open }: any) =>
    open ? createElement('div', { 'data-testid': 'symptom-popup' }, '症状初筛弹窗') : null,
}))

vi.mock('../index.scss', () => ({}))

// ============================================================
// 测试工具
// ============================================================

/** 页面初始 value={inputValue}，用 React 受控输入写法触发 onChange */
function typeMessage(container: HTMLElement, text: string) {
  const input = container.querySelector('.chat-input-field') as HTMLInputElement
  expect(input).toBeTruthy()
  fireEvent.change(input, { target: { value: text } })
}

/** 造一个与 agentService.agentChat 同形的异步事件流 */
async function* agentStream(events: Array<Record<string, unknown>>) {
  for (const e of events) yield e
}

/** 造一条会话摘要（对齐后端 /api/agent/sessions 的 camelCase 结构） */
function session(id: string, title: string, messageCount = 0) {
  return {
    id,
    petId: 'pet_001',
    title,
    messageCount,
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T01:00:00Z',
  }
}

/** 按文案找能力条上的某个入口 */
function findCapability(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('.yuantuan-cap')).find(
    el => el.textContent?.includes(label),
  )
}

/**
 * 渲染页面并冲掉首屏的异步取数（会话列表 / 历史）
 * 不冲干净就断言会看到"还没加载完"的中间态，用例会随微任务时机时红时绿。
 */
async function renderPage() {
  const utils = render(createElement(YuantuanAgent))
  await act(async () => {})
  return utils
}

/** 每个用例开始前的基线：有宠物、无历史会话、网络层全部返回空 */
beforeEach(() => {
  vi.clearAllMocks()
  petStoreState.currentPet = pet
  petStoreState.pets = [pet]
  petStoreState.isLoading = false
  mockGetCurrentPages.mockReturnValue([])
  mockListChatSessions.mockResolvedValue([])
  mockLoadAgentHistory.mockResolvedValue([])
  mockCreateChatSession.mockResolvedValue(session('session-new', '新的对话', 0))
  mockDeleteChatSession.mockResolvedValue(true)
  mockSendChatMessage.mockResolvedValue({ reply: '兜底回复' })
  // 路由参数基线：默认**不带** capability（只打开团团首屏），
  // 需要自动触发的用例自己往 routerParams 里塞值
  Object.keys(routerParams).forEach(k => delete routerParams[k])
  // 默认事件流：一段 token + done（与真实 SSE 的成功路径同形）
  mockAgentChat.mockImplementation((() =>
    agentStream([
      { type: 'token', data: { text: '好呀，我在。' } },
      { type: 'done', data: { content: '好呀，我在。' } },
    ])) as any)
})

// ============================================================
// 首屏渲染
// ============================================================
describe('团团页 · 首屏渲染', () => {
  it('顶栏渲染团团身份 + 在线状态（带上宠物名）+ 新建/历史入口', async () => {
    const { container } = await renderPage()

    const head = container.querySelector('.yuantuan-head')
    expect(head).toBeTruthy()
    expect(container.querySelector('.yuantuan-head__title')?.textContent).toBe('团团 · AI 宠物管家')
    // 在线状态按当前宠物说话，不是写死的"它"
    expect(container.querySelector('.yuantuan-head__status')?.textContent).toBe('在线 · 记得旺财的全部档案')

    // 收起（回今天）、新建对话、历史对话三件套都在
    expect(container.querySelector('.yuantuan-head__close')).toBeTruthy()
    expect(container.querySelector('.yuantuan-head__new')?.textContent).toContain('新建')
    expect(container.querySelector('.yuantuan-head__icon')).toBeTruthy()
  })

  it('欢迎语是「时段问候 + 宠物名」，能力清单交给常驻的 7 个能力入口', async () => {
    const { container } = await renderPage()

    const greeting = container.querySelector('.msg-row.ai .msg-bubble')
    expect(greeting).toBeTruthy()
    expect(greeting!.textContent).toContain('我是团团')
    // 宠物名：欢迎语必须落到"这只宠物"上，不能是放之四海皆可的自我介绍
    expect(greeting!.textContent).toContain('旺财')
    // 时段问候三档之一（用例不锁具体哪一档，跑在凌晨/白天/晚上都得通过）
    expect(greeting!.textContent).toMatch(/^(早上好|下午好|晚上好)呀/)
    // 关键回归：能力清单**不许**再写进气泡 —— 下面那排胶囊就是同一份清单且可点，
    // 两处都写会让首屏出现两套"我能干什么"（2026-09-12 收口批次按 v2 屏 03 改的口径）
    expect(greeting!.textContent).not.toContain('我可以帮你')

    const caps = Array.from(container.querySelectorAll('.yuantuan-cap'))
    expect(caps).toHaveLength(7)
    const labels = caps.map(el => el.querySelector('.yuantuan-cap__label')?.textContent)
    expect(labels).toEqual([
      '健康打卡', '食物查询', '症状初筛', '疫苗日历', '附近医院', '团团的记忆', 'AI 取名',
    ])
  })

  it('greetingByHour 覆盖 24 小时且不出现"凌晨说晚上好"的空档', async () => {
    // 2026-09-12：实现已下沉到 utils/date.ts（今天页顶栏也用它），这里改从新位置导入 ——
    // 断言本身一字未改，仍是"三档覆盖 0~23 点、不留空档"
    const { greetingByHour } = await import('../../../utils/date')
    // 三档边界：<11 早上好 / <18 下午好 / 其余晚上好 —— 0~23 每小时都要落进某一档
    expect(greetingByHour(new Date(2026, 8, 12, 0, 0))).toBe('早上好')
    expect(greetingByHour(new Date(2026, 8, 12, 10, 59))).toBe('早上好')
    expect(greetingByHour(new Date(2026, 8, 12, 11, 0))).toBe('下午好')
    expect(greetingByHour(new Date(2026, 8, 12, 17, 59))).toBe('下午好')
    expect(greetingByHour(new Date(2026, 8, 12, 18, 0))).toBe('晚上好')
    expect(greetingByHour(new Date(2026, 8, 12, 23, 59))).toBe('晚上好')
  })

  it('输入区渲染输入框（placeholder 为团团口径）与加号按钮', async () => {
    const { container } = await renderPage()

    const input = container.querySelector('.chat-input-field') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.getAttribute('placeholder')).toBe('和团团说点什么…')

    // 未输入时是「+」按钮，没有发送按钮
    expect(container.querySelector('.wx-plus-btn')).toBeTruthy()
    expect(container.querySelector('.wx-send-btn')).toBeFalsy()
  })

  it('医疗免责声明常驻（合规口径，AI 对话页必须可见）', async () => {
    const { container } = await renderPage()

    expect(container.querySelector('.yuantuan-disclaimer__text')?.textContent)
      .toBe('团团由 AI 驱动，不能替代兽医诊断')
  })

  it('点「收起」回「今天」：无页面栈时由 safeNavigateBack 兜底 switchTab 首页', async () => {
    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.yuantuan-head__close')!)
    expect(mockSwitchTab).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('有页面栈时「收起」走 navigateBack（不把用户甩回首页 tab）', async () => {
    mockGetCurrentPages.mockReturnValue([{}, {}] as unknown[])

    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.yuantuan-head__close')!)
    expect(mockNavigateBack).toHaveBeenCalledWith({ delta: 1 })
    expect(mockSwitchTab).not.toHaveBeenCalled()
  })
})

// ============================================================
// 空态 / 加载态
// ============================================================
describe('团团页 · 空态与加载态', () => {
  it('无宠物且加载中 → 骨架屏，不渲染对话区', async () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    petStoreState.isLoading = true

    const { container } = await renderPage()

    expect(container.querySelector('[data-testid="home-skeleton"]')).toBeTruthy()
    expect(container.querySelector('.chat-input-area')).toBeFalsy()
  })

  it('无宠物 → 空态提示先添加宠物（团团没有档案可问），并不请求会话列表', async () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    petStoreState.isLoading = false

    const { container } = await renderPage()

    expect(container.textContent).toContain('欢迎来到星河宠记')
    expect(container.textContent).toContain('团团才能帮你看它的一生')
    expect(container.querySelector('[data-testid="home-skeleton"]')).toBeFalsy()
    // 没有宠物就没有会话可拉，不能白发请求
    expect(mockListChatSessions).not.toHaveBeenCalled()
  })

  it('空态的「添加宠物」按钮跳添加宠物页', async () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    petStoreState.isLoading = false

    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.chat-empty-btn')!)
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesPet/add/index' })
  })

  it('有宠物时即使 isLoading=true 也照常渲染对话区', async () => {
    petStoreState.isLoading = true

    const { container } = await renderPage()

    expect(container.querySelector('[data-testid="home-skeleton"]')).toBeFalsy()
    expect(container.querySelector('.chat-input-area')).toBeTruthy()
  })
})

// ============================================================
// 发送消息主路径（网络层已 mock，不真发请求）
// ============================================================
describe('团团页 · 发送消息主路径', () => {
  it('输入文字 → 点发送：用户消息上屏，AI 流式回复随后上屏', async () => {
    const { container } = await renderPage()

    typeMessage(container, '今天它有点蔫')
    // 有内容才出现发送按钮（与「+」互斥）
    const sendBtn = container.querySelector('.wx-send-btn')
    expect(sendBtn).toBeTruthy()
    expect(container.querySelector('.wx-plus-btn')).toBeFalsy()

    fireEvent.click(sendBtn!)

    // 用户消息进列表
    await waitFor(() => {
      expect(container.querySelectorAll('.msg-row.user')).toHaveLength(1)
    })
    expect(container.querySelector('.msg-row.user')!.textContent).toContain('今天它有点蔫')

    // AI 回复上屏（token 流式写入同一条气泡）
    await waitFor(() => {
      expect(container.textContent).toContain('好呀，我在。')
    })

    // 发送后输入框清空
    expect((container.querySelector('.chat-input-field') as HTMLInputElement).value).toBe('')
  })

  it('首条消息会惰性创建会话，并把 sessionId 透传给 agentChat', async () => {
    const { container } = await renderPage()

    typeMessage(container, '它今天精神不太好')
    fireEvent.click(container.querySelector('.wx-send-btn')!)

    await waitFor(() => {
      expect(mockAgentChat).toHaveBeenCalled()
    })

    // 会话按当前宠物创建
    expect(mockCreateChatSession).toHaveBeenCalledWith('pet_001')
    // 消息带上会话 id 才会被持久化进该会话
    const payload = mockAgentChat.mock.calls[0][0] as Record<string, unknown>
    expect(payload.message).toBe('它今天精神不太好')
    expect(payload.petId).toBe('pet_001')
    expect(payload.sessionId).toBe('session-new')
  })

  it('消息文本不进对话流时不发请求（空白输入被守卫拦下）', async () => {
    const { container } = await renderPage()

    // 只输入空格：发送按钮不出现，强行点也不该发请求
    typeMessage(container, '   ')
    expect(container.querySelector('.wx-send-btn')).toBeFalsy()
    expect(mockAgentChat).not.toHaveBeenCalled()
  })

  it('Agent 流失败时不把用户消息丢掉（降级到非流式兜底）', async () => {
    // 只 yield error 事件 → useChatCore 会降级走 sendChatMessage
    mockAgentChat.mockImplementation((() =>
      agentStream([{ type: 'error', data: { message: '连接失败' } }])) as any)
    mockSendChatMessage.mockResolvedValue({ reply: '兜底回复：先观察精神状态' })

    const { container } = await renderPage()

    typeMessage(container, '它不吃东西')
    fireEvent.click(container.querySelector('.wx-send-btn')!)

    await waitFor(() => {
      expect(container.textContent).toContain('兜底回复：先观察精神状态')
    })
    expect(container.querySelector('.msg-row.user')!.textContent).toContain('它不吃东西')
  })
})

// ============================================================
// 能力入口
// ============================================================
describe('团团页 · 能力入口', () => {
  it('疫苗日历 / 附近医院 / 团团的记忆 各跳对应页面', async () => {
    const { container } = await renderPage()

    fireEvent.click(findCapability(container, '疫苗日历')!)
    expect(mockNavigateTo).toHaveBeenLastCalledWith({ url: '/pagesPet/vaccine/index' })

    fireEvent.click(findCapability(container, '附近医院')!)
    expect(mockNavigateTo).toHaveBeenLastCalledWith({ url: '/pagesPet/hospital/index' })

    fireEvent.click(findCapability(container, '团团的记忆')!)
    expect(mockNavigateTo).toHaveBeenLastCalledWith({ url: '/pagesUser/memory/index' })
  })

  it('健康打卡入口打开打卡弹窗（不再往聊天流塞逐条问答）', async () => {
    const { container } = await renderPage()

    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeFalsy()
    fireEvent.click(findCapability(container, '健康打卡')!)

    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeTruthy()
  })

  it('症状初筛入口打开初筛弹窗', async () => {
    const { container } = await renderPage()

    expect(container.querySelector('[data-testid="symptom-popup"]')).toBeFalsy()
    fireEvent.click(findCapability(container, '症状初筛')!)

    expect(container.querySelector('[data-testid="symptom-popup"]')).toBeTruthy()
  })

  it('食物查询入口交给食物流程 hook，AI 取名入口交给取名流程 hook', async () => {
    const { container } = await renderPage()

    fireEvent.click(findCapability(container, '食物查询')!)
    expect(mockHandleFoodQuery).toHaveBeenCalledTimes(1)

    fireEvent.click(findCapability(container, 'AI 取名')!)
    expect(mockStartNaming).toHaveBeenCalledTimes(1)
  })
})

// ============================================================
// 路由参数 capability —— 入口收拢后"一步到位"的闭环（2026-09-12 收口批次 §2）
// ============================================================
describe('团团页 · capability 路由参数', () => {
  it('带 capability=food 进入 → 自动触发食物查询', async () => {
    routerParams.capability = 'food'
    await renderPage()
    // 走的是页面既有的能力分发（handleCapability → food.handleFoodQuery），不另写一套流程
    expect(mockHandleFoodQuery).toHaveBeenCalledTimes(1)
  })

  it('带 capability=symptom 进入 → 自动打开症状初筛弹窗', async () => {
    routerParams.capability = 'symptom'
    const { container } = await renderPage()
    expect(container.querySelector('[data-testid="symptom-popup"]')).toBeTruthy()
  })

  it('带 capability=hospital / memory 进入 → 自动跳到对应页', async () => {
    routerParams.capability = 'hospital'
    await renderPage()
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesPet/hospital/index' })
  })

  it('带 capability=naming 进入 → 自动启动取名流程', async () => {
    routerParams.capability = 'naming'
    await renderPage()
    expect(mockStartNaming).toHaveBeenCalledTimes(1)
  })

  it('不带参数进入 → 不触发任何能力（保持只打开团团首屏的现状）', async () => {
    await renderPage()
    expect(mockHandleFoodQuery).not.toHaveBeenCalled()
    expect(mockStartNaming).not.toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('非法值 / 纯记录查询类的 key → 不崩、也不触发任何能力', async () => {
    // 非法值：页面必须静默忽略，不许抛错（抛错会让整页白屏）
    routerParams.capability = 'not-a-real-capability'
    const { container } = await renderPage()
    expect(container.querySelector('.yuantuan-head')).toBeTruthy()
    expect(mockHandleFoodQuery).not.toHaveBeenCalled()
    expect(mockStartNaming).not.toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()

    // checkin / vaccine 是纯记录查询类：不在白名单里，团团对它们不做任何反应
    routerParams.capability = 'checkin'
    await renderPage()
    expect(mockHandleFoodQuery).not.toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('没有宠物时不自动触发（先让用户看到空态引导，不打开"没有档案可问"的能力）', async () => {
    petStoreState.currentPet = null
    petStoreState.pets = []
    routerParams.capability = 'food'

    await renderPage()
    expect(mockHandleFoodQuery).not.toHaveBeenCalled()
  })

  it('用户操作引发的重渲染不会重复触发能力（靠 ref 保证整页只跑一次）', async () => {
    routerParams.capability = 'food'
    const { container } = await renderPage()
    expect(mockHandleFoodQuery).toHaveBeenCalledTimes(1)

    // 触发一次重渲染（点开 + 面板会 setState），若没有 ref 守卫这里会变成 2 次
    fireEvent.click(container.querySelector('.wx-plus-btn')!)
    expect(mockHandleFoodQuery).toHaveBeenCalledTimes(1)
  })
})

// ============================================================
// 加号面板（从首页整体搬来的入口，一个都不能少）
// ============================================================
describe('团团页 · 加号面板', () => {
  it('点「+」展开 6 个附件/动作入口', async () => {
    const { container } = await renderPage()

    expect(container.querySelector('.chat-plus-panel')).toBeFalsy()
    fireEvent.click(container.querySelector('.wx-plus-btn')!)

    const items = Array.from(container.querySelectorAll('.plus-panel-item'))
    expect(items).toHaveLength(6)
    expect(items.map(el => el.querySelector('.plus-panel-label')?.textContent)).toEqual([
      '拍摄照片', '相册图片', '健康打卡', '记录回忆', '品种百科', '看家庭',
    ])
  })

  it('面板里的「健康打卡」打开打卡弹窗；「品种百科」跳品种页', async () => {
    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.wx-plus-btn')!)
    const items = () => Array.from(container.querySelectorAll('.plus-panel-item'))

    fireEvent.click(items()[2])
    expect(container.querySelector('[data-testid="checkin-popup"]')).toBeTruthy()
    // 点完一项面板自动收起（不能挡着聊天流）
    expect(container.querySelector('.chat-plus-panel')).toBeFalsy()

    fireEvent.click(container.querySelector('.wx-plus-btn')!)
    fireEvent.click(items()[4])
    expect(mockNavigateTo).toHaveBeenLastCalledWith({ url: '/pagesPet/breed/index' })
  })

  it('点面板里的「记录回忆」启动回忆流程', async () => {
    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.wx-plus-btn')!)
    const items = Array.from(container.querySelectorAll('.plus-panel-item'))
    fireEvent.click(items[3])

    expect(mockStartMemoryRecord).toHaveBeenCalledTimes(1)
  })
})

// ============================================================
// 多会话（新建 / 历史抽屉 / 切换 / 删除 / 长对话提示）
// ============================================================
describe('团团页 · 多会话', () => {
  it('顶栏「新建」创建会话并清空当前消息流', async () => {
    const { container } = await renderPage()

    // 先发一条消息，制造"当前会话里有内容"的前提
    typeMessage(container, '先随便聊一句')
    fireEvent.click(container.querySelector('.wx-send-btn')!)
    await waitFor(() => expect(container.querySelectorAll('.msg-row.user')).toHaveLength(1))

    fireEvent.click(container.querySelector('.yuantuan-head__new')!)

    await waitFor(() => {
      expect(mockCreateChatSession).toHaveBeenCalledWith('pet_001')
    })
    // 新建后消息流清空，回到问候语态
    await waitFor(() => {
      expect(container.querySelectorAll('.msg-row.user')).toHaveLength(0)
    })
    expect(container.textContent).toContain('我是团团')
  })

  it('点历史入口打开抽屉；没有会话时给出空态引导', async () => {
    mockListChatSessions.mockResolvedValue([])

    const { container } = await renderPage()

    expect(container.querySelector('.session-drawer-overlay')).toBeFalsy()
    fireEvent.click(container.querySelector('.yuantuan-head__icon')!)

    expect(container.querySelector('.session-drawer-title')?.textContent).toBe('历史对话')
    expect(container.querySelector('.session-drawer-empty-text')?.textContent)
      .toContain('还没有对话')
  })

  it('有会话时抽屉列出会话，点某条切过去并按该会话 id 拉历史', async () => {
    mockListChatSessions.mockResolvedValue([
      session('session-1', '我家猫不吃东西', 4),
      session('session-2', '疫苗怎么安排', 2),
    ])
    mockLoadAgentHistory.mockResolvedValue([])

    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.yuantuan-head__icon')!)

    const items = Array.from(container.querySelectorAll('.session-item'))
    expect(items).toHaveLength(2)
    // 最近活跃会话默认是当前会话
    expect(items[0].className).toContain('session-item--active')
    expect(items[0].textContent).toContain('我家猫不吃东西')
    expect(items[0].textContent).toContain('4 条消息')

    fireEvent.click(items[1])

    await waitFor(() => {
      expect(mockLoadAgentHistory).toHaveBeenLastCalledWith('pet_001', 20, 'session-2')
    })
    // 选完自动收起抽屉
    expect(container.querySelector('.session-drawer-overlay')).toBeFalsy()
  })

  it('长按会话弹删除确认，确认后才真的删', async () => {
    mockListChatSessions.mockResolvedValue([session('session-1', '旧对话', 1)])
    // showModal 的 success 回调由测试主动触发（模拟用户点「删除」）
    mockShowModal.mockImplementation((opts: any) => {
      opts.success?.({ confirm: true, cancel: false })
    })

    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.yuantuan-head__icon')!)
    fireEvent.contextMenu(container.querySelector('.session-item')!)

    expect(mockShowModal).toHaveBeenCalledTimes(1)
    const modalArgs = mockShowModal.mock.calls[0][0] as Record<string, any>
    expect(modalArgs.title).toBe('删除对话')
    expect(modalArgs.content).toContain('旧对话')
    // 微信 showModal 的 confirmText 上限 4 个字，超长弹不出来
    expect(modalArgs.confirmText.length).toBeLessThanOrEqual(4)

    await waitFor(() => {
      expect(mockDeleteChatSession).toHaveBeenCalledWith('session-1')
    })
  })

  it('长按后取消删除：不调用删除接口', async () => {
    mockListChatSessions.mockResolvedValue([session('session-1', '旧对话', 1)])
    mockShowModal.mockImplementation((opts: any) => {
      opts.success?.({ confirm: false, cancel: true })
    })

    const { container } = await renderPage()

    fireEvent.click(container.querySelector('.yuantuan-head__icon')!)
    fireEvent.contextMenu(container.querySelector('.session-item')!)

    expect(mockDeleteChatSession).not.toHaveBeenCalled()
  })

  it('当前会话消息满 60 条 → 显示长对话软提示（建议新建，不强制）', async () => {
    mockListChatSessions.mockResolvedValue([session('session-1', '长对话', 60)])
    mockLoadAgentHistory.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `第 ${i} 条`,
      })),
    )

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelector('.chat-long-tip')).toBeTruthy()
    })
    expect(container.querySelector('.chat-long-tip')!.textContent).toContain('新建对话')
  })

  it('消息不足 60 条 → 不显示长对话软提示', async () => {
    mockListChatSessions.mockResolvedValue([session('session-1', '短对话', 3)])
    mockLoadAgentHistory.mockResolvedValue([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好呀' },
    ])

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelectorAll('.msg-row').length).toBeGreaterThan(1)
    })
    expect(container.querySelector('.chat-long-tip')).toBeFalsy()
  })

  it('进入页面默认打开最近会话并把历史渲染成消息（进来看不到历史是曾经的 P0）', async () => {
    mockListChatSessions.mockResolvedValue([session('session-1', '我家猫不吃东西', 2)])
    mockLoadAgentHistory.mockResolvedValue([
      { role: 'user', content: '我家猫最近不吃东西' },
      { role: 'assistant', content: '先观察精神状态，记一条打卡' },
    ])

    const { container } = await renderPage()

    await waitFor(() => {
      expect(container.querySelectorAll('.msg-row.user')).toHaveLength(1)
    })
    expect(container.textContent).toContain('我家猫最近不吃东西')
    expect(container.textContent).toContain('先观察精神状态，记一条打卡')
    expect(mockLoadAgentHistory).toHaveBeenCalledWith('pet_001', 20, 'session-1')
  })
})
