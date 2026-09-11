/**
 * AI 取名流程 Hook
 * 支持推荐模式和解读模式，管理取名步骤、AI 推荐、照片上传和命理详情弹窗
 *
 * 本地降级名字库与 AI 返回解析统一使用 utils/namingFallback（与独立取名页 pagesPet/naming
 * 共用同一份实现）。2026-09-10 去重：此前本文件内联了一份逐字相同的副本（含 4 风格
 * 名字库 100+ 行 + shuffle/parseRecommendResult/parseDetailResult/generateFallbackDetail），
 * 与共享模块双份维护、改一处漏一处。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { recommendNames, uploadNamingPhoto, interpretName, analyzeNameDetail, extractNamingAppearance } from '../services/namingService'
import {
  generateFallbackNames,
  generateFallbackDetail,
  parseRecommendResult,
  parseDetailResult,
} from '../utils/namingFallback'
import { usePetStore } from '../stores/petStore'
import { CONFIG } from '../config'
import type { CardData, NamingDetail, NamingResult, PetInfo } from '../types/chatTypes'

// ── 步骤类型 ──────────────────────────────────────────────

type StepType = 'options' | 'text' | 'photo'

interface NamingStepDef {
  key: string
  type: StepType
  question: string
  options?: string[]
  placeholder?: string
  skipLabel?: string
}

type NamingMode = 'recommend' | 'interpret'

// ── 推荐模式步骤 ──────────────────────────────────────────

const MODE_SELECT_STEP: NamingStepDef = {
  key: 'mode',
  type: 'options',
  question: '你好呀！取名有两种方式哦～你想用哪种？',
  options: ['帮我推荐名字 ✨', '帮我解读名字 🔍'],
}

const RECOMMEND_STEPS: NamingStepDef[] = [
  {
    key: 'gender',
    type: 'options',
    question: '宝贝是男生还是女生呀？',
    options: ['男生 ♂', '女生 ♀', '还不知道'],
  },
  {
    key: 'photo',
    type: 'photo',
    question: '有宝贝的照片吗？上传一张让我看看它的样子，名字会更贴切哦～',
    skipLabel: '跳过，不需要',
  },
  {
    key: 'description',
    type: 'text',
    question: '可以描述一下宝贝的特点吗？\n性格、外貌、习惯、小癖好…想到什么说什么～',
    placeholder: '输入描述...',
    skipLabel: '跳过，让AI自由发挥',
  },
  {
    key: 'style',
    type: 'options',
    question: '你喜欢什么风格的名字？',
    options: ['古风诗意', '可爱萌系', '食物系列', '自然元素', '不限风格'],
  },
]

const INTERPRET_STEPS: NamingStepDef[] = [
  {
    key: 'name',
    type: 'text',
    question: '你想解读哪个名字？发给我吧～',
    placeholder: '输入名字...',
  },
]

// ── Hook 接口 ──────────────────────────────────────────────

export interface UseNamingFlowParams {
  addAiMsg: (content: string, options?: string[]) => void
  addUserMsg: (content: string) => void
  addMessage: (msg: { type: 'ai' | 'user'; content: string; card?: CardData; options?: string[] }) => string
  /** 流式输出 AI 回复（打字机效果） */
  streamAiReply: (fullContent: string, onDone?: () => void) => void
  /** 设置打字状态指示器 */
  setIsTyping: (typing: boolean) => void
  /** 更新消息的 card 数据（用于换一批） */
  updateMessageCard: (msgId: string, card: CardData) => void
  petInfo: PetInfo
}

/**
 * AI 取名流程 Hook
 *
 * 支持两种模式：
 * - 推荐模式：性别 → 照片 → 描述 → 风格 → AI 推荐 5 个名字
 * - 解读模式：用户输入名字 → AI 流式深度解读
 *
 * 命理详情通过悬浮弹窗展示，而非内联消息。
 */
export function useNamingFlow(params: UseNamingFlowParams) {
  const { addAiMsg, addUserMsg, addMessage, streamAiReply, setIsTyping, updateMessageCard } = params

  const [namingMode, setNamingMode] = useState<NamingMode | null>(null)
  const [namingStep, setNamingStep] = useState(-1)
  const [namingData, setNamingData] = useState<Record<string, string>>({})
  /** 用 ref 避免 setTimeout 闭包陷阱，确保 finishRecommend 读取到最新 namingData */
  const namingDataRef = useRef(namingData)
  useEffect(() => {
    namingDataRef.current = namingData
  }, [namingData])
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [isAnalyzingDetail, setIsAnalyzingDetail] = useState(false)
  /** 命理详情弹窗数据 */
  const [namingDetailPopup, setNamingDetailPopup] = useState<NamingDetail | null>(null)
  /** 命理详情弹窗是否正在加载 */
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  /** 当前取名卡片的消息 ID（用于换一批时更新卡片） */
  const namingCardMsgIdRef = useRef<string | null>(null)
  /** 是否正在换一批 */
  const [isRefreshing, setIsRefreshing] = useState(false)
  /** 已推荐过的名字，避免重复推荐 */
  const seenNamesRef = useRef<Set<string>>(new Set())
  /** 上一批成功展示的名字（换一批彻底拿不到新名字时用于恢复卡片，避免空卡片） */
  const lastNamesRef = useRef<NamingResult[]>([])
  /** 用户在等待命理详情返回期间关闭了弹窗（避免请求回来后弹窗被"自动重开"） */
  const detailCancelledRef = useRef(false)
  /** 命理详情请求令牌：只有最新一次请求有权写入弹窗状态（旧请求的结果作废） */
  const detailRequestIdRef = useRef(0)
  /** 照片外貌提取任务（"看图取名"）：调用 AI 取名前 await，保证外貌信息已就绪 */
  const appearanceTaskRef = useRef<Promise<string | null> | null>(null)

  /** 将推荐结果加入已推荐名单 */
  const addToSeenNames = useCallback((names: NamingResult[]) => {
    names.forEach(n => seenNamesRef.current.add(n.name))
  }, [])

  /** 当前步骤是否处于文本输入模式（需要路由聊天输入到取名流程） */
  const isTextInputActive = namingStep >= 0
    && namingMode !== null
    && getCurrentStepDef()?.type === 'text'

  /** 获取当前步骤定义 */
  function getCurrentStepDef(): NamingStepDef | null {
    if (namingStep < 0) return null
    if (namingMode === null) return MODE_SELECT_STEP

    const steps = namingMode === 'recommend' ? RECOMMEND_STEPS : INTERPRET_STEPS
    return steps[namingStep] || null
  }

  /** 获取当前步骤（供 UI 渲染判断） */
  const currentStep = getCurrentStepDef()

  // ── 调用 AI 获取名字推荐（可复用于换一批） ─────────────

  /** 调用 AI 服务获取名字推荐，失败时返回 null */
  const fetchAiNames = useCallback(async (excludeNames?: string[]): Promise<NamingResult[] | null> => {
    if (CONFIG.USE_MOCK) {
      return null
    }

    // "看图取名"：用户刚上传照片时先等外貌提取完成再拼提示词（提取失败/超时按"未识别"降级）。
    // 必须放在读取 namingDataRef 之前——appearance 是异步写入 ref 的（2026-09-10）
    if (appearanceTaskRef.current) {
      // 等待期间先给出"正在思考"反馈：视觉提取通常 2-10 秒，此前 await 在 setIsTyping 之前，
      // 界面没有任何提示，用户会以为卡住（2026-09-10 审查 P2）
      setIsTyping(true)
      try {
        await appearanceTaskRef.current
      } catch {
        // 忽略：未识别到外貌时提示词会走"不要编造照片内容"分支
      }
    }

    const currentData = namingDataRef.current
    const style = currentData.style || ''
    const genderText = currentData.gender || ''
    const description = currentData.description || ''

    try {
      const pet = usePetStore.getState().currentPet
      const breed = pet?.breed || '未知品种'
      const birthDate = pet?.birthDate || ''
      const gender = genderText.includes('男') ? 'male' : genderText.includes('女') ? 'female' : 'unknown'

      setIsTyping(true)
      const result = await recommendNames({
        breed,
        birthDate,
        gender,
        style,
        // 物种一并传给 AI（2026-09-10）：此前只传品种，提示词里没有任何"猫/狗"信息，
        // 推荐质量与用户预期脱节（独立取名页有手动物种选择，聊天内取当前宠物档案）
        species: pet?.species,
        photoUrl: photoUrl || undefined,
        // 照片外貌描述（视觉模型提取）：模型看不到图，只有这段文字才能真正"看图取名"
        appearance: currentData.appearance || undefined,
        description: description || undefined,
        excludeNames,
      })
      setIsTyping(false)

      const parsed = parseRecommendResult(result)
      if (parsed.length > 0) {
        // 过滤掉已推荐过的（AI 可能不严格遵守排除指令）
        const filtered = excludeNames && excludeNames.length > 0
          ? parsed.filter(n => !excludeNames.includes(n.name))
          : parsed
        return filtered.slice(0, 5)
      }
      console.warn('[NamingFlow] AI 返回了结果但解析失败，原始内容:', result.substring(0, 200))
    } catch (err) {
      setIsTyping(false)
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[NamingFlow] AI 推荐调用失败:', errMsg)
    }
    return null
  }, [photoUrl, setIsTyping])

  // ── 完成推荐流程 ──────────────────────────────────────

  const finishRecommend = useCallback(async () => {
    setNamingStep(-1)
    // 从 ref 读取最新值，避免 setTimeout 闭包陷阱
    const currentData = namingDataRef.current
    const style = currentData.style || ''

    let names: NamingResult[] = []

    const aiNames = await fetchAiNames()
    if (aiNames && aiNames.length > 0) {
      names = aiNames
    }

    if (names.length === 0) {
      const excludeList = Array.from(seenNamesRef.current)
      names = generateFallbackNames(style || '不限风格', excludeList)
    }

    // 极端兜底（2026-09-10）：AI 不可用 + 本地库该风格名字已全部推荐过时，
    // 原来会直接渲染一张空卡片（用户看到"什么都没有"且无任何提示）。改为明说并结束。
    if (names.length === 0) {
      streamAiReply('抱歉，这轮没能生成新的名字～你可以换个风格，或稍后再试一次 ✦')
      return
    }

    addToSeenNames(names)
    lastNamesRef.current = names

    const card: CardData = {
      type: 'naming_cards',
      data: {},
      names,
    }

    // 构建个性化引导语
    const parts: string[] = []
    if (photoUrl) parts.push('照片特征')
    if (currentData.description) parts.push('你的描述')
    parts.push(`「${style || '不限风格'}」风格偏好`)
    const aiLabel = aiNames && aiNames.length > 0 ? '' : '（本地精选）'
    const introText = `综合${parts.join('、')}，为你精心推荐以下 ${names.length} 个名字 ✦${aiLabel}\n\n每个名字都蕴含独特的文化寓意，点击名字卡片可以查看详细的命理解析哦～`

    // 流式输出引导语，完成后展示卡片
    streamAiReply(introText, () => {
      const msgId = addMessage({ type: 'ai', content: '', card })
      namingCardMsgIdRef.current = msgId
    })
  }, [addMessage, photoUrl, setIsTyping, streamAiReply, fetchAiNames, addToSeenNames])

  // ── 换一批 ──────────────────────────────────────────

  const refreshNaming = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)

    const msgId = namingCardMsgIdRef.current
    if (!msgId) {
      setIsRefreshing(false)
      return
    }

    // 先显示加载态
    updateMessageCard(msgId, {
      type: 'naming_cards',
      data: { refreshing: true },
      names: [],
    })

    let names: NamingResult[] = []
    const excludeList = Array.from(seenNamesRef.current)
    const aiNames = await fetchAiNames(excludeList)
    if (aiNames && aiNames.length > 0) {
      names = aiNames
    }

    if (names.length === 0) {
      const currentData = namingDataRef.current
      const style = currentData.style || '不限风格'
      names = generateFallbackNames(style, excludeList)
    }

    // 一批都拿不到（AI 不可用 + 本地库已把这批名字推荐完）→ 恢复上一批而不是渲染空卡片
    if (names.length === 0) {
      updateMessageCard(msgId, { type: 'naming_cards', data: {}, names: lastNamesRef.current })
      addAiMsg('这一轮没能找到更多新名字，先看看上面的推荐吧～稍后再试试「换一批」')
      setIsRefreshing(false)
      return
    }

    addToSeenNames(names)
    lastNamesRef.current = names

    updateMessageCard(msgId, {
      type: 'naming_cards',
      data: {},
      names,
    })
    setIsRefreshing(false)
  }, [isRefreshing, fetchAiNames, updateMessageCard, addToSeenNames, addAiMsg])

// ── 完成解读流程 ──────────────────────────────────────

  const finishInterpret = useCallback(async (name: string) => {
    setNamingStep(-1)

    if (!CONFIG.USE_MOCK) {
      try {
        const pet = usePetStore.getState().currentPet
        const breed = pet?.breed || '未知品种'
        const birthDate = pet?.birthDate || ''

        setIsTyping(true)
        const result = await interpretName(name, breed, birthDate)
        setIsTyping(false)

        if (result && !result.startsWith('AI服务暂不可用') && !result.startsWith('网络异常')) {
          streamAiReply(result)
          return
        }
      } catch (err) {
        setIsTyping(false)
        console.error('[NamingFlow] AI 解读调用失败:', err)
      }
    }

    // 本地降级解读
    const fallbackText =
      `「${name}」这个名字很有韵味呢！\n\n` +
      `寓意：名字寓意美好，寄托了主人对宝贝的深厚感情。\n` +
      `建议：名字朗朗上口，适合日常呼唤，是一个不错的选择～`
    streamAiReply(fallbackText)
  }, [setIsTyping, streamAiReply])

  // ── 点击名字卡片查看命理详情（弹出悬浮卡片）──────────

  const handleNamingDetail = useCallback(
    async (nameResult: NamingResult) => {
      if (isAnalyzingDetail) return
      // 请求令牌（2026-09-10 审查 P1 修复）：用户在慢请求期间关掉弹窗、又点了另一个名字时，
      // 旧请求返回后**不得**再写 popup/loading 状态（否则要么把关闭的弹窗顶回来，
      // 要么把新请求的 loading 提前复位，导致新点击"点了没反应"）
      const requestId = ++detailRequestIdRef.current
      setIsAnalyzingDetail(true)
      // 新一轮请求开始，重置"用户已取消"标记
      detailCancelledRef.current = false

      // 从 ref 读取最新数据
      const currentData = namingDataRef.current

      // 立即弹出悬浮卡片，显示加载态
      const loadingDetail: NamingDetail = {
        name: nameResult.name,
        bazi: '',
        fortune: '',
        careerFortune: '',
        loveFortune: '',
        healthFortune: '',
        personality: '',
        strokes: '',
        luckyDirection: '',
        luckyColor: '',
        luckyNumber: '',
        karmaWithOwner: '',
        summary: '',
      }
      setNamingDetailPopup(loadingDetail)
      setIsDetailLoading(true)

      let detail: NamingDetail | null = null

      if (!CONFIG.USE_MOCK) {
        try {
          const pet = usePetStore.getState().currentPet
          const breed = pet?.breed || '未知品种'
          const birthDate = pet?.birthDate || ''
          const gender = currentData.gender?.includes('男') ? 'male'
            : currentData.gender?.includes('女') ? 'female' : 'unknown'

          const result = await analyzeNameDetail({
            name: nameResult.name,
            breed,
            birthDate,
            gender,
            wuxing: nameResult.wuxing,
            starMansion: nameResult.starMansion,
            description: currentData.description,
          })

          if (result) {
            detail = parseDetailResult(result)
          }
        } catch {
          // AI 不可用时降级
        }
      }

      if (!detail) {
        detail = generateFallbackDetail(nameResult.name, nameResult.wuxing, nameResult.starMansion)
      }

      detail.name = nameResult.name

      // 已被更新的请求取代（用户在等待期间又点了另一个名字）：本次结果作废，
      // 且**不碰任何状态**，让新请求自己收尾（2026-09-10 审查 P1 修复）
      if (requestId !== detailRequestIdRef.current) return

      // 用户在等待期间关掉了弹窗（或点了遮罩），结果直接丢弃——
      // 2026-09-10 修复：此前无条件 setNamingDetailPopup(detail)，会把已关闭的弹窗
      // 再次"顶"出来，用户以为关不掉（慢请求下尤其明显）
      if (detailCancelledRef.current) {
        setIsDetailLoading(false)
        setIsAnalyzingDetail(false)
        return
      }

      // 更新弹窗数据，结束加载
      setNamingDetailPopup(detail)
      setIsDetailLoading(false)
      setIsAnalyzingDetail(false)
    },
    [isAnalyzingDetail]
  )

  /** 关闭命理详情弹窗 */
  const closeNamingDetail = useCallback(() => {
    // 标记取消，让仍在飞行中的请求不要在返回后重新打开弹窗
    detailCancelledRef.current = true
    // 令牌自增：在飞请求的结果作废（不会再把弹窗顶回来）
    detailRequestIdRef.current++
    // 复位"分析中"（2026-09-10 审查 P1 修复）：否则用户关掉弹窗后想点另一个名字，
    // 会被 handleNamingDetail 的 isAnalyzingDetail 守卫静默吞掉，表现为"点了没反应"
    setIsAnalyzingDetail(false)
    setIsDetailLoading(false)
    setNamingDetailPopup(null)
  }, [])

  /**
   * 就用这个名字：把推荐名字写入当前宠物档案（重命名）
   *
   * 2026-09-10 新增：此前取名流程到"看到名字"就断了，用户还得手动去宠物编辑页
   * 把名字再敲一遍。改名走 petStore.updatePet（内部同步服务端 + 更新 currentPet，
   * 首页/我的页宠物名会一起刷新）。
   * @returns 是否改名成功（失败已 toast 提示）
   */
  const applyNamingName = useCallback(async (name: string): Promise<boolean> => {
    const pet = usePetStore.getState().currentPet
    if (!pet) {
      Taro.showToast({ title: '请先添加宠物', icon: 'none' })
      return false
    }
    if (pet.name === name) {
      Taro.showToast({ title: '宝贝已经叫这个名字啦', icon: 'none' })
      return true
    }
    try {
      await usePetStore.getState().updatePet(pet.id, { name })
      Taro.showToast({ title: `已改名为「${name}」`, icon: 'success' })
      return true
    } catch {
      // 失败原因（网络/鉴权）无需暴露细节，给统一可操作提示
      Taro.showToast({ title: '改名失败，请稍后再试', icon: 'none' })
      return false
    }
  }, [])

  // ── 步骤推进 ──────────────────────────────────────────

  const askNextStep = useCallback(
    (step: number) => {
      setNamingStep(step)

      if (namingMode === 'recommend' && step >= RECOMMEND_STEPS.length) {
        finishRecommend()
        return
      }
      if (namingMode === 'interpret' && step >= INTERPRET_STEPS.length) {
        return
      }

      const steps = namingMode === 'recommend' ? RECOMMEND_STEPS : INTERPRET_STEPS
      const s = steps[step]
      if (!s) return

      if (s.type === 'options') {
        addAiMsg(s.question, s.options)
      } else if (s.type === 'text') {
        addAiMsg(s.question)
      } else if (s.type === 'photo') {
        addAiMsg(s.question)
      }
    },
    [addAiMsg, finishRecommend, namingMode]
  )

  // ── 公开方法 ──────────────────────────────────────────

  /** 开始取名流程（显示模式选择） */
  const startNaming = useCallback(() => {
    setNamingData({})
    setNamingMode(null)
    setNamingStep(0)
    setPhotoUrl(null)
    setNamingDetailPopup(null)
    seenNamesRef.current = new Set()
    // 跨轮清理（2026-09-10 审查 P2 修复）：上一轮的照片外貌提取任务/上一批名字/旧卡片 id
    // 若不清空，用户上传照片后立刻重开流程（或换宠物）时，慢返回的旧任务会把
    // 旧照片的外貌描述注入新一轮提示词；"换一批"也可能误更新上一轮的卡片
    appearanceTaskRef.current = null
    lastNamesRef.current = []
    namingCardMsgIdRef.current = null
    // 作废可能仍在飞的命理请求
    detailRequestIdRef.current++
    detailCancelledRef.current = true
    setIsAnalyzingDetail(false)
    setIsDetailLoading(false)
    addAiMsg('要给宝贝取名字吗？太开心了！让我来帮你 ✦\n\n你想怎么用呢？', MODE_SELECT_STEP.options)
  }, [addAiMsg])

  /** 处理用户选项点击 */
  const handleNamingAnswer = useCallback(
    (text: string) => {
      addUserMsg(text)

      // 模式选择
      if (namingMode === null && namingStep === 0) {
        if (text.includes('推荐')) {
          setNamingMode('recommend')
          setNamingData({})
          setNamingStep(0)
          setTimeout(() => {
            const s = RECOMMEND_STEPS[0]
            addAiMsg(s.question, s.options)
          }, 400)
        } else if (text.includes('解读')) {
          setNamingMode('interpret')
          setNamingData({})
          setNamingStep(0)
          setTimeout(() => {
            const s = INTERPRET_STEPS[0]
            addAiMsg(s.question)
          }, 400)
        } else {
          // 这一步用户手打了其它文字（不是点选项）：原来直接 return，用户会觉得
          // "发了消息 AI 不理我"、流程卡死。改为重新给出选项按钮（2026-09-10）
          addAiMsg('这一步点下面的按钮选一下就好啦～', MODE_SELECT_STEP.options)
        }
        return
      }

      // 推荐/解读模式的选项步骤
      const steps = namingMode === 'recommend' ? RECOMMEND_STEPS : INTERPRET_STEPS
      const s = steps[namingStep]
      if (!s || s.type !== 'options') return

      setNamingData(prev => ({ ...prev, [s.key]: text }))
      const next = namingStep + 1
      setTimeout(() => askNextStep(next), 400)
    },
    [addUserMsg, askNextStep, namingMode, namingStep, addAiMsg]
  )

  /** 处理文本输入（text 步骤） */
  const handleNamingText = useCallback(
    (text: string) => {
      addUserMsg(text)

      if (namingMode === 'interpret') {
        // 解读模式：用户输入名字 → 直接解读
        finishInterpret(text)
        return
      }

      // 推荐模式：description 步骤
      const steps = RECOMMEND_STEPS
      const s = steps[namingStep]
      if (!s || s.type !== 'text') return

      setNamingData(prev => ({ ...prev, [s.key]: text }))
      const next = namingStep + 1
      setTimeout(() => askNextStep(next), 400)
    },
    [addUserMsg, askNextStep, finishInterpret, namingMode, namingStep]
  )

  /** 跳过描述步骤 */
  const skipNamingDesc = useCallback(() => {
    const steps = RECOMMEND_STEPS
    const s = steps[namingStep]
    if (!s || s.key !== 'description') return

    addUserMsg('跳过')
    const next = namingStep + 1
    setTimeout(() => askNextStep(next), 400)
  }, [addUserMsg, askNextStep, namingStep])

  /** 上传照片（含"看图取名"：后台提取外貌描述，供最终提示词使用） */
  const handleNamingPhoto = useCallback(async (tempFilePath: string): Promise<boolean> => {
    setIsUploadingPhoto(true)
    try {
      // 上传必须带 petId（2026-09-10 审查 P1 修复）：服务端 /api/naming/photo/upload
      // 要求 petId 并做宠物归属校验，缺参必然 400 —— 此前前端不传，照片上传 100% 失败，
      // 只是被静默成"照片上传失败，我们跳过这一步继续吧～"
      const pet = usePetStore.getState().currentPet
      const url = pet ? await uploadNamingPhoto(tempFilePath, pet.id) : null

      // 加 pet 判断纯为 TS 类型收窄：url 非空必然意味着 pet 非空（见上一行三元），
      // 行为与原来完全相同，只是让 tsc 在块内能确认 pet 不是 null（TS18047）
      if (url && pet) {
        setPhotoUrl(url)
        setNamingData(prev => ({ ...prev, photo: url }))
        addUserMsg('[上传了照片]')
        addAiMsg('收到照片啦，我看一眼宝贝长什么样～')

        // 视觉外貌提取不阻塞流程推进（用户可继续填描述）；但把 promise 存下来，
        // 真正调用 AI 取名前会 await 它，保证"看过照片"的信息不丢（2026-09-10）
        const task = extractNamingAppearance(url, pet.id)
          .then((appearance) => {
            if (appearance) {
              // 同时写 state 与 ref：用户若秒跳过描述步骤，finishRecommend 从 ref 读取也能拿到
              setNamingData(prev => ({ ...prev, appearance }))
              namingDataRef.current = { ...namingDataRef.current, appearance }
            }
            return appearance
          })
          .catch(() => null)
        appearanceTaskRef.current = task

        const next = namingStep + 1
        setTimeout(() => askNextStep(next), 400)
        return true
      }
      // 无宠物档案时不是"上传失败"，而是这一步本就无从上传 → 文案区分开
      addAiMsg(pet ? '照片上传失败，我们跳过这一步继续吧～' : '还没添加宠物档案，这一步先跳过啦～')
      const next = namingStep + 1
      setTimeout(() => askNextStep(next), 400)
      return false
    } catch {
      addAiMsg('照片上传失败，我们跳过这一步继续吧～')
      const next = namingStep + 1
      setTimeout(() => askNextStep(next), 400)
      return false
    } finally {
      setIsUploadingPhoto(false)
    }
  }, [addUserMsg, addAiMsg, askNextStep, namingStep])

  /** 跳过照片步骤 */
  const skipNamingPhoto = useCallback(() => {
    const steps = RECOMMEND_STEPS
    const s = steps[namingStep]
    if (!s || s.key !== 'photo') return

    addUserMsg('跳过')
    const next = namingStep + 1
    setTimeout(() => askNextStep(next), 400)
  }, [addUserMsg, askNextStep, namingStep])

  return {
    namingMode,
    namingStep,
    namingData,
    currentStep,
    photoUrl,
    isUploadingPhoto,
    isAnalyzingDetail,
    isTextInputActive,
    namingDetailPopup,
    isDetailLoading,
    isRefreshing,
    startNaming,
    handleNamingAnswer,
    handleNamingText,
    handleNamingPhoto,
    skipNamingPhoto,
    skipNamingDesc,
    handleNamingDetail,
    closeNamingDetail,
    applyNamingName,
    refreshNaming,
  }
}

export type UseNamingFlowReturn = ReturnType<typeof useNamingFlow>
