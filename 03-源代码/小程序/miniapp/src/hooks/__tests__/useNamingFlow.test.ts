/**
 * AI 取名流程 Hook（useNamingFlow）单元测试（2026-09-10 补齐）
 *
 * 背景：该 Hook 承载聊天内取名的完整状态机（模式选择 → 性别 → 照片 → 描述 → 风格 → 推荐 →
 * 换一批 → 命理详情 → 改名），此前**零测试**。以下用例锁住本轮修复的回归点：
 *  ① 用户关闭命理弹窗后，慢请求返回不得把弹窗重新"顶"出来；
 *  ② AI 命理详情失败（空内容，例如服务端越界拦截/思考模式吃空）→ 必须落到本地模板而不是空白弹窗；
 *  ③ 换一批彻底拿不到新名字时，恢复上一批并提示，绝不渲染空卡片；
 *  ④ "就用这个名字"必须真正写入宠物档案（调用 petStore.updatePet）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const {
  mockRecommendNames,
  mockUploadNamingPhoto,
  mockInterpretName,
  mockAnalyzeNameDetail,
  mockExtractAppearance,
  mockShowToast,
  mockUpdatePet,
  currentPet,
} = vi.hoisted(() => ({
  mockRecommendNames: vi.fn(),
  mockUploadNamingPhoto: vi.fn(),
  mockInterpretName: vi.fn(),
  mockAnalyzeNameDetail: vi.fn(),
  mockExtractAppearance: vi.fn(),
  mockShowToast: vi.fn(),
  mockUpdatePet: vi.fn(),
  currentPet: { id: 'pet-1', name: '可乐', breed: '布偶猫', species: 'cat', birthDate: '2026-03-12' },
}))

vi.mock('../../services/namingService', () => ({
  recommendNames: (...args: unknown[]) => mockRecommendNames(...args),
  uploadNamingPhoto: (...args: unknown[]) => mockUploadNamingPhoto(...args),
  interpretName: (...args: unknown[]) => mockInterpretName(...args),
  analyzeNameDetail: (...args: unknown[]) => mockAnalyzeNameDetail(...args),
  extractNamingAppearance: (...args: unknown[]) => mockExtractAppearance(...args),
}))

vi.mock('../../stores/petStore', () => ({
  usePetStore: {
    getState: () => ({
      currentPet,
      updatePet: (...args: unknown[]) => mockUpdatePet(...args),
    }),
  },
}))

vi.mock('@tarojs/taro', () => ({
  default: { showToast: (...args: unknown[]) => mockShowToast(...args) },
}))

/* eslint-disable import/first -- 被测模块必须在 vi.mock 工厂与 vi.hoisted 之后 import，
   否则 vitest 的模块级 mock 时序不生效（与项目其它 Hook 测试同款写法） */
import { useNamingFlow } from '../useNamingFlow'

/** Hook 依赖的宿主回调（模拟首页聊天流） */
function buildParams() {
  return {
    addAiMsg: vi.fn(),
    addUserMsg: vi.fn(),
    addMessage: vi.fn(() => 'msg-1'),
    // 打字机效果：直接回调 onDone，等价于"回复已展示完毕"
    streamAiReply: vi.fn((_content: string, onDone?: () => void) => onDone?.()),
    setIsTyping: vi.fn(),
    updateMessageCard: vi.fn(),
    petInfo: {
      name: '可乐',
      emoji: '🐱',
      breed: '布偶猫',
      age: '1岁',
      hasPet: true,
      isLoading: false,
      activePet: null,
    },
  }
}

const AI_NAMES_JSON = JSON.stringify([
  { name: '墨韵', source: '《墨池记》', wuxing: '水', starMansion: '壁水貐', meaning: '墨香氤氲', score: 95 },
  { name: '云栖', source: '贾岛', wuxing: '水', starMansion: '箕水豹', meaning: '云深不知处', score: 92 },
  { name: '霁月', source: '范仲淹', wuxing: '金', starMansion: '心月狐', meaning: '雨过天晴', score: 88 },
  { name: '青崖', source: '李白', wuxing: '木', starMansion: '角木蛟', meaning: '青崖白鹿', score: 90 },
  { name: '鹿鸣', source: '《诗经》', wuxing: '木', starMansion: '亢金龙', meaning: '呦呦鹿鸣', score: 93 },
])

describe('useNamingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRecommendNames.mockResolvedValue(AI_NAMES_JSON)
    mockAnalyzeNameDetail.mockResolvedValue('')
    mockExtractAppearance.mockResolvedValue(null)
    mockUpdatePet.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should enter the mode-selection step when starting the flow', () => {
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    act(() => result.current.startNaming())

    expect(result.current.namingStep).toBe(0)
    expect(result.current.namingMode).toBeNull()
    // 模式选择提示必须带两个可选按钮，否则用户不知道下一步怎么做
    expect(params.addAiMsg).toHaveBeenCalledWith(expect.stringContaining('你想怎么用呢'), [
      '帮我推荐名字 ✨',
      '帮我解读名字 🔍',
    ])
  })

  it('should switch to interpret mode and reset data when user picks 解读', () => {
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    act(() => result.current.startNaming())
    act(() => result.current.handleNamingAnswer('帮我解读名字 🔍'))

    expect(result.current.namingMode).toBe('interpret')
    expect(result.current.namingStep).toBe(0)
  })

  it('should re-prompt with options when user types text at the mode step', () => {
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    act(() => result.current.startNaming())
    act(() => result.current.handleNamingAnswer('随便'))

    // 不进入任何模式，并重新给出按钮（此前是静默 return，用户以为流程卡死）
    expect(result.current.namingMode).toBeNull()
    expect(params.addAiMsg).toHaveBeenCalledWith(expect.stringContaining('点下面的按钮'), [
      '帮我推荐名字 ✨',
      '帮我解读名字 🔍',
    ])
  })

  it('should fall back to the local template when AI returns empty detail content', async () => {
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    // AI 返回空串（服务端越界拦截 / 思考模式吃空 max_tokens 的真实形态）
    mockAnalyzeNameDetail.mockResolvedValue('')
    await act(async () => {
      await result.current.handleNamingDetail({
        name: '墨韵',
        source: '',
        wuxing: '水',
        starMansion: '壁水貐',
        meaning: '墨香氤氲',
        score: 95,
      })
    })

    expect(result.current.namingDetailPopup?.name).toBe('墨韵')
    // 本地模板必须填满正文，不能留空段落
    expect(result.current.namingDetailPopup?.bazi).toContain('墨韵')
    expect(result.current.namingDetailPopup?.summary?.length).toBeGreaterThan(10)
    expect(result.current.isDetailLoading).toBe(false)
  })

  it('should render AI detail when server returns valid JSON', async () => {
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    mockAnalyzeNameDetail.mockResolvedValue(
      '```json\n{"bazi":"八字简析","fortune":"整体运势","summary":"寄语"}\n```'
    )
    await act(async () => {
      await result.current.handleNamingDetail({
        name: '云栖',
        source: '',
        wuxing: '水',
        starMansion: '箕水豹',
        meaning: '云深不知处',
        score: 92,
      })
    })

    expect(result.current.namingDetailPopup?.bazi).toBe('八字简析')
    expect(result.current.namingDetailPopup?.summary).toBe('寄语')
  })

  it('should not reopen the detail popup when user closed it before the request resolved', async () => {
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    // 手动控制请求时机，模拟"慢请求期间用户关掉弹窗"
    let resolveDetail: (value: string) => void = () => {}
    mockAnalyzeNameDetail.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveDetail = resolve
      })
    )

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.handleNamingDetail({
        name: '霁月',
        source: '',
        wuxing: '金',
        starMansion: '心月狐',
        meaning: '雨过天晴',
        score: 88,
      })
    })
    expect(result.current.namingDetailPopup?.name).toBe('霁月')

    act(() => result.current.closeNamingDetail())
    expect(result.current.namingDetailPopup).toBeNull()

    await act(async () => {
      resolveDetail('{"bazi":"迟到的结果"}')
      await pending
    })

    // 回归锁：结果返回后弹窗必须保持关闭
    expect(result.current.namingDetailPopup).toBeNull()
  })

  it('should write the chosen name into the pet profile when applying it', async () => {
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    await act(async () => {
      await result.current.applyNamingName('墨韵')
    })

    expect(mockUpdatePet).toHaveBeenCalledWith('pet-1', { name: '墨韵' })
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ icon: 'success' }))
  })

  it('should not call the API when the pet already uses that name', async () => {
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    await act(async () => {
      await result.current.applyNamingName('可乐')
    })

    expect(mockUpdatePet).not.toHaveBeenCalled()
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: '宝贝已经叫这个名字啦' }))
  })

  it('should never render an empty card when refreshing runs out of new names', async () => {
    vi.useFakeTimers()
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    // AI 始终解析不出名字 → 每次都走本地名字库，连续换一批会逐步耗尽该风格候选池
    mockRecommendNames.mockResolvedValue('（AI 不可用）')

    /** 推进 400ms 的步骤切换 + 冲掉挂起的 promise */
    const tick = async () => {
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      await act(async () => {
        await Promise.resolve()
      })
    }

    act(() => result.current.startNaming())
    act(() => result.current.handleNamingAnswer('帮我推荐名字 ✨'))
    await tick() // → 性别步骤
    act(() => result.current.handleNamingAnswer('女生 ♀'))
    await tick() // → 照片步骤
    act(() => result.current.skipNamingPhoto())
    await tick() // → 描述步骤
    act(() => result.current.skipNamingDesc())
    await tick() // → 风格步骤
    act(() => result.current.handleNamingAnswer('古风诗意'))
    await tick() // → 生成第一张卡片

    expect(params.addMessage).toHaveBeenCalled()
    const firstCard = params.updateMessageCard.mock.calls.at(-1)?.[1] as { names?: unknown[] } | undefined
    expect(firstCard).toBeUndefined() // 首轮用 addMessage 建卡，不经过 updateMessageCard

    // 连续换一批直到候选池耗尽
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await result.current.refreshNaming()
      })
    }

    const renderedBatches = params.updateMessageCard.mock.calls
      .map((call) => call[1] as { data?: { refreshing?: boolean }; names?: unknown[] })
      // 只关心"最终渲染的那一批"，跳过 refreshing 加载态
      .filter((card) => card.data?.refreshing !== true)
    const finalBatch = renderedBatches.at(-1)
    expect(finalBatch?.names?.length).toBeGreaterThan(0)
    // 且必须明确提示而不是静默
    expect(params.addAiMsg).toHaveBeenCalledWith(expect.stringContaining('没能找到更多新名字'))
  })

  it('should upload with the current pet id and feed the visual appearance into the prompt', async () => {
    vi.useFakeTimers()
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    mockUploadNamingPhoto.mockResolvedValue('/uploads/pet-photos/u1/pet-1/a.jpg')
    mockExtractAppearance.mockResolvedValue('橘白相间，圆脸，琥珀色大眼睛，白手套')

    const tick = async () => {
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      await act(async () => {
        await Promise.resolve()
      })
    }

    act(() => result.current.startNaming())
    act(() => result.current.handleNamingAnswer('帮我推荐名字 ✨'))
    await tick() // → 性别
    act(() => result.current.handleNamingAnswer('女生 ♀'))
    await tick() // → 照片步骤

    await act(async () => {
      await result.current.handleNamingPhoto('/tmp/a.jpg')
    })
    // 回归锁：上传必须带当前宠物 id（缺参服务端必然 400）
    expect(mockUploadNamingPhoto).toHaveBeenCalledWith('/tmp/a.jpg', 'pet-1')
    // 视觉提取同样要带 petId（服务端按"自己宠物目录"做归属校验）
    expect(mockExtractAppearance).toHaveBeenCalledWith('/uploads/pet-photos/u1/pet-1/a.jpg', 'pet-1')

    await tick() // → 描述步骤
    act(() => result.current.skipNamingDesc())
    await tick() // → 风格步骤
    act(() => result.current.handleNamingAnswer('古风诗意'))
    await tick() // → 发起推荐

    // 外貌描述必须进入取名提示词（"看图取名"的最后一环）
    const lastCall = mockRecommendNames.mock.calls.at(-1)?.[0] as { appearance?: string } | undefined
    expect(lastCall?.appearance).toBe('橘白相间，圆脸，琥珀色大眼睛，白手套')
  })

  it('should let the user open another name after closing the popup mid-request', async () => {
    const params = buildParams()
    const { result } = renderHook(() => useNamingFlow(params))

    // 第一个名字：请求一直挂着（模拟慢网络）
    let resolveFirst: (value: string) => void = () => {}
    mockAnalyzeNameDetail.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveFirst = resolve
      })
    )

    let firstPending: Promise<void> = Promise.resolve()
    act(() => {
      firstPending = result.current.handleNamingDetail({
        name: '墨韵',
        source: '',
        wuxing: '水',
        starMansion: '壁水貐',
        meaning: '墨香氤氲',
        score: 95,
      })
    })
    expect(result.current.namingDetailPopup?.name).toBe('墨韵')

    // 用户关掉弹窗 → 必须复位"分析中"，否则下一次点击会被守卫静默吞掉
    act(() => result.current.closeNamingDetail())
    expect(result.current.namingDetailPopup).toBeNull()

    // 点另一个名字：应能正常发起新请求并展示结果
    mockAnalyzeNameDetail.mockResolvedValueOnce('{"bazi":"云栖的八字简析"}')
    await act(async () => {
      await result.current.handleNamingDetail({
        name: '云栖',
        source: '',
        wuxing: '水',
        starMansion: '箕水豹',
        meaning: '云深不知处',
        score: 92,
      })
    })
    expect(result.current.namingDetailPopup?.name).toBe('云栖')
    expect(result.current.namingDetailPopup?.bazi).toBe('云栖的八字简析')

    // 旧请求这时才返回：不得覆盖新结果、也不得重新打开弹窗
    await act(async () => {
      resolveFirst('{"bazi":"迟到的墨韵结果"}')
      await firstPending
    })
    expect(result.current.namingDetailPopup?.name).toBe('云栖')
    expect(result.current.namingDetailPopup?.bazi).toBe('云栖的八字简析')
  })
})
