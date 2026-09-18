/**
 * 团团 · AI 全屏对话页（IA 第 4 批：全站 AI 能力的唯一入口）
 *
 * 【这一页是怎么来的】本页内容整体从 `pages/index/index.tsx` 搬过来（2026-09-12）：
 * 首页（今天）重做成「此刻该做什么」的健康看板，AI 对话不再是首页主体；
 * 团团 = 「问它 / 让它替我做」的唯一入口，所以欢迎语、消息流、输入框
 * （语音 / 图片 / 加号附件）、会话历史抽屉、AI 能力入口全部收拢到本页。
 *
 * 【为什么放独立分包】本页依赖 chat 核心 + 取名/食物/回忆三个流程 hook，
 * 体积不小；主包余量到 2026-09-12 只剩约 143KB，塞不进主包，故放 pagesYuantuan 分包。
 *
 * 【为什么不是 tab 页 —— 底部让位口径与首页刻意不同】
 *   · 首页（tab 页，pages/index）：底栏是覆盖在页面之上的固定层（100rpx 底板 + 约 40rpx
 *     中心凸起圆钮 + 安全区），内容会钻到它下面，所以根容器要减 160rpx + 安全区。
 *   · 本页（非 tab 页，由 tabBar 中心按钮 navigateTo 打开）：微信里 tab 页整页被覆盖、
 *     本页不渲染自定义 tabBar，**不存在**底栏遮挡，因此这里不加 160rpx，
 *     输入条直接贴视口底部，只由 `.chat-input-safe` 留出底部安全区。
 *   判断依据写在这里，避免以后有人照抄首页的让位值、在真机上白掉一条 160rpx 空白。
 *
 * 【路由参数 `capability` —— 与各入口之间是契约，改一处必须同步另一处】
 * 收口批次（2026-09-12 §2）把全站 AI 能力入口收拢到本页后，若外部入口只跳到"团团首屏"、
 * 还要用户自己在能力条上再点一次，等于把"唯一入口"做成"多一步入口"，违背 IA 意图。
 * 所以本页接受可选参数 `capability`：带参数进来即**自动触发对应能力**
 * （复用页面内既有的 `handleCapability` 分发，不另写一套流程）。
 *
 *   · 参数名：`capability`
 *   · 取值：`utils/aiEntry.ts` 的 `AI_CAPABILITY_KEYS` —— `food` / `symptom` / `hospital` / `naming` / `memory`
 *     （命名与 `CAPABILITIES` 的 key 同一套，这里只列"需要 AI 推理"的那几个）
 *   · 缺失 / 非法 / 属纯记录查询类（`checkin`、`vaccine` 等）：**什么都不做**，保持现状，
 *     不抛错、也不降级到别的能力
 *   · 无宠物时也不触发：自动打开一个"没有档案可问"的能力只会更困惑，先让用户看到空态引导
 *
 * ⚠️ **契约提醒**：这些 key 与 `components/EmergencyAlert`、`components/AnxietyIntervention`、
 * `components/CrisisReferralCard`、`pagesPet/checkin` 里跳转时带的参数一一对应。
 * 写入侧统一走 `utils/aiEntry.ts` 的 `buildAiEntryUrl()`（**不要在页面里手拼字符串**），
 * 读取侧（本页）直接用同一份 `AI_CAPABILITY_KEYS` 做校验 —— 两侧共用一处真相，
 * 不存在"改了一边忘了另一边"的可能。
 */
import { View, Text, ScrollView, Input, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { useChatCore } from '../../hooks/useChatCore'
import SymptomCheckPopup from '../../components/SymptomCheckPopup'
import { useNamingFlow } from '../../hooks/useNamingFlow'
import { useFoodFlow } from '../../hooks/useFoodFlow'
import { useMemoryFlow } from '../../hooks/useMemoryFlow'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import { usePetStore } from '../../stores/petStore'
import type { CardData, Message, PetInfo } from '../../types/chatTypes'
import HomeSkeleton from '../../components/HomeSkeleton'
import { Icon, type FillIconName } from '../../components'
import CheckinPopup from '../../components/CheckinPopup'
// 空态主视觉：沿用首页那张新 IP 油画猫狗品牌图（主包已有、约 33KB）。
// 为什么不在分包里另存一份：会出现两张"同一只 IP"的图，将来换 IP 要改两处；
// 分包会把它复制进本页产物，体积代价约 33KB（分包上限 2MB，可接受）。
// 2026-09-12 由旧毡毛版 logo-catdog-felt.jpg 换成油画版 —— 旧版是早期 IP、与全站插画不同族，已弃用。
import catDogHero from '../../assets/logo-catdog-oil.jpg'
// 团团形象直接复用首页那枚品牌头像组件（同一张「戴星冠的橘猫管家」图，不另存一份资源）
import AiAvatar from '../../pages/index/AiAvatar'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { formatPetAge, greetingByHour } from '../../utils/date'
import { safeNavigateBack } from '../../utils/navigation'
// 能力参数契约的唯一真相：入口侧用它拼 URL，本页用它做白名单校验（见文件头「契约」一节）
import { AI_CAPABILITY_KEYS } from '../../utils/aiEntry'
import PageBackground from '../../components/PageBackground'
import './index.scss'

/**
 * 从真实宠物数据取本页需要的展示字段（与首页同一口径，避免两页显示不一致）
 *
 * 为什么本页要自己再写一份：原实现是 pages/index 的**页面内私有函数**，没有导出；
 * 本批次不许改共用文件，故按同样的口径复制一份，字段含义与原实现逐字一致。
 * ⚠️ 后续若把「当前宠物展示信息」抽成公共 hook，本函数应一并删掉。
 */
function usePetInfo(): PetInfo {
  const pet = usePetStore(s => s.currentPet)
  const pets = usePetStore(s => s.pets)
  const isLoading = usePetStore(s => s.isLoading)
  const activePet = pet ?? pets[0] ?? null
  return {
    name: activePet?.name || '',
    emoji: activePet?.species === 'cat' ? '🐱' : activePet?.species === 'dog' ? '🐕' : '🐾',
    breed: activePet?.breed || '',
    age: activePet?.birthDate ? formatPetAge(activePet.birthDate) : '',
    hasPet: pets.length > 0,
    isLoading,
    activePet,
  }
}

/**
 * 加号面板菜单项（原样从首页搬来，用户看到的入口一个都不能少）
 * icon 存面性图标名（不是 emoji），带类型标注以便直接传给 Icon 组件
 */
const PLUS_MENU_ITEMS: Array<{ icon: FillIconName; label: string; sub: string; bg: string }> = [
  { icon: 'camera', label: '拍摄照片', sub: '相机拍摄', bg: 'rgba(255,107,61,0.12)' },
  { icon: 'image', label: '相册图片', sub: '从相册选择', bg: 'rgba(232,168,56,0.12)' },
  { icon: 'clipboard-text', label: '健康打卡', sub: '5项日常检查，1分钟完成', bg: 'rgba(232,168,56,0.12)' },
  { icon: 'note-pencil', label: '记录回忆', sub: '上传照片 + 写一段话', bg: 'rgba(140,173,126,0.12)' },
  { icon: 'cat', label: '品种百科', sub: '40+品种特征和护理要点', bg: 'rgba(166,143,120,0.12)' },
  { icon: 'house', label: '看家庭', sub: '家人动态 + 家庭周报', bg: 'rgba(224,133,107,0.12)' },
]

/**
 * 团团的能力入口（《信息架构重做方案 v1》§3.2）
 *
 * IA 定的口径：症状初筛 / 食物查询 / 附近医院 / 疫苗日历 / 健康解读 / 记忆 这些
 * **AI 能力全部只在团团出现**（今天页只剩非 AI 的日常动作）。这张表就是那批能力的清单，
 * 常驻在欢迎语下方 —— 它不是「新手推荐」，不随会话推进消失。
 */
const CAPABILITIES: Array<{ key: string; label: string; icon: FillIconName }> = [
  { key: 'checkin', label: '健康打卡', icon: 'clipboard-text' },
  { key: 'food', label: '食物查询', icon: 'bowl-food' },
  { key: 'symptom', label: '症状初筛', icon: 'stethoscope' },
  { key: 'vaccine', label: '疫苗日历', icon: 'syringe' },
  { key: 'hospital', label: '附近医院', icon: 'hospital' },
  { key: 'memory', label: '团团的记忆', icon: 'brain' },
  { key: 'naming', label: 'AI 取名', icon: 'sparkle' },
]

/** 长对话阈值：当前会话消息满这么多条时软提示「建议新建对话」（不强制、可继续聊） */
const LONG_CHAT_THRESHOLD = 60

// 【时段问候语已下沉到 utils/date.ts 的 greetingByHour()】2026-09-12：
// 今天页顶栏改成问候语后也要用它，同一件事两处用就必须只有一处实现 ——
// 否则"几点算早上"会出现两套口径（今天页说早上好、团团页说下午好）。
// 本页只 import 使用，不再自己定义。

/**
 * `capability` 路由参数里**允许被自动触发**的能力 key 白名单
 *
 * 【为什么直接用 `utils/aiEntry.ts` 的常量，而不是在这里再抄一份字符串数组】
 * 最初这里抄了一份 `['food', 'symptom', ...]`（读取侧），但那样写入侧与读取侧就是**两份数据**，
 * 迟早漂移；漂移的症状是"点了按钮跳过来却没反应"，而且**不报错**、只有真机点得出来。
 * 现在只有 `AI_CAPABILITY_KEYS` 一处真相：入口侧用它拼 URL（`buildAiEntryUrl`），
 * 本页用它做白名单校验，两边取值永远一致。
 *
 * 【为什么只列这几个】与 IA 判断标准一致：只有"需要 AI 推理的能力"才收拢到团团；
 * 纯记录 / 查询类（`checkin` / `vaccine`）入口本就该原路径直达，所以即使有人带
 * `capability=checkin` 进来，本页也**什么都不做**（不抛错、不降级到别的能力）。
 * 完整契约说明见文件头。
 */
const AUTO_CAPABILITY_KEYS: readonly string[] = AI_CAPABILITY_KEYS

/**
 * 团团 AI 全屏对话页
 * @returns 页面 JSX
 */
export default function YuantuanAgent() {
  const themeClass = useThemeClass()
  const petInfo = usePetInfo()
  const [inputValue, setInputValue] = useState('')
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text')
  const [plusPanelOpen, setPlusPanelOpen] = useState(false)
  // 会话列表抽屉开关（多会话「历史对话」，原首页顶栏入口）
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false)
  /**
   * useChatCore 要求传入「隐藏问候快捷操作」的 setter（它在用户发出第一条消息时会调用）。
   * 但本页的能力入口是常驻的 —— 它不是只给新用户看的问候推荐，而是 IA 定的
   * 「全站 AI 能力唯一入口」，所以这里只保留 setter、不读这个标志位。
   */
  const [, setShowGreetingQuickActions] = useState(true)

  /**
   * 自动聚焦输入框：原型里团团是「全屏聚焦态」，进来就能直接打字。
   * 延迟 350ms 是为了等页面转场动画结束 —— 转场途中弹键盘会让新页面被顶起一下，
   * 观感上像「页面自己跳了一下」。组件卸载时清掉定时器，避免对已卸载页面 setState。
   */
  const [autoFocus, setAutoFocus] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setAutoFocus(true), 350)
    return () => clearTimeout(timer)
  }, [])

  const chat = useChatCore({
    petInfo,
    inputValue,
    setInputValue,
    setPlusMenuOpen: setPlusPanelOpen,
    setShowGreetingQuickActions,
  })

  const { agentToolStatus, sessionId, sessions, messages, handleNewSession, handleSwitchSession, handleDeleteSession } = chat

  /**
   * 长对话软提示：当前会话消息满 60 条时提示「建议新建对话」。
   * 用 messages.length 而非 sessions[].messageCount —— 后者是进入页面时的快照，
   * 发送后不刷新，会导致软提示实时永不触发。
   */
  const showLongChatTip = sessionId !== null && messages.length >= LONG_CHAT_THRESHOLD

  /** 收起团团、回到「今天」（无页面栈时由 safeNavigateBack 兜底 switchTab 回首页） */
  const handleClose = useCallback(() => {
    safeNavigateBack()
  }, [])

  // ===== 健康打卡 =====
  // 打卡仍是弹窗卡片交互：全流程在卡内完成，聊天流只在打卡完成后追加一条结果消息
  const [checkinOpen, setCheckinOpen] = useState(false)
  /** 所有打卡入口统一走这里（能力入口 / +面板 / Agent 工具动作） */
  const openCheckin = useCallback(() => setCheckinOpen(true), [])

  /** 打卡完成回调：往聊天流追加一条结果卡消息（本页没有「今日健康摘要」要刷新） */
  const handleCheckinComplete = useCallback((payload: {
    type: 'ai'
    content: string
    card?: CardData
  }) => {
    chat.addMessage(payload)
  }, [chat])

  // ===== 症状初筛 =====
  const [symptomOpen, setSymptomOpen] = useState(false)
  /** 所有症状初筛入口统一走这里（能力入口 / Agent 工具动作 / Layer 1 意图） */
  const openSymptom = useCallback(() => setSymptomOpen(true), [])

  /** 初筛完成回调：往聊天流追加一条结果卡消息 */
  const handleSymptomComplete = useCallback((payload: {
    type: 'ai'
    content: string
    card?: CardData
  }) => {
    chat.addMessage(payload)
  }, [chat])

  // ===== 三条对话内流程（取名 / 食物 / 回忆）=====
  const naming = useNamingFlow({
    addAiMsg: chat.addAiMsg,
    addUserMsg: chat.addUserMsg,
    addMessage: chat.addMessage,
    streamAiReply: chat.streamAiReply,
    setIsTyping: chat.setIsTyping,
    updateMessageCard: chat.updateMessageCard,
    petInfo,
  })

  const food = useFoodFlow({
    addAiMsg: chat.addAiMsg,
    addUserMsg: chat.addUserMsg,
    addMessage: chat.addMessage,
    setIsTyping: chat.setIsTyping,
    petInfo,
  })

  const memory = useMemoryFlow({
    addAiMsg: chat.addAiMsg,
    addUserMsg: chat.addUserMsg,
    setIsTyping: chat.setIsTyping,
    petInfo,
  })

  // ===== 语音输入 =====
  /** 语音转文字处理中标记（识别期间按钮显示「识别中...」） */
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false)

  /** 同声传译识别完成：把识别到的文字直接作为消息发送（改版后不再上传后端 ASR） */
  const handleVoiceComplete = useCallback((text: string) => {
    if (!text || text === '无法识别语音内容') {
      Taro.showToast({ title: '未识别到语音内容，请重试', icon: 'none' })
      return
    }
    // 用 chat.handleSend(text) 直传识别文本，避免 setInputValue + setTimeout 读到旧闭包
    setIsVoiceProcessing(true)
    chat.handleSend(text).finally(() => setIsVoiceProcessing(false))
  }, [chat])

  const voice = useVoiceInput({
    onRecognizeComplete: handleVoiceComplete,
    maxDuration: 60000,
  })

  // 将食物/回忆/取名流程处理器注册到聊天核心，打破循环依赖
  useEffect(() => {
    chat.setFlowHandlers({
      foodActive: food.foodActive,
      selectFood: food.selectFood,
      memoryActive: memory.memoryActive,
      handleMemoryRecord: memory.handleMemoryRecord,
      namingTextActive: naming.isTextInputActive,
      handleNamingText: naming.handleNamingText,
      startNaming: naming.startNaming,
      startCheckin: openCheckin,
      startMemory: memory.startMemoryRecord,
      startSymptom: openSymptom,
      startFoodQuery: food.handleFoodQuery,
      navigateToBreed: () => Taro.navigateTo({ url: '/pagesPet/breed/index' }),
      // Layer 2: Agent 工具调用触发的流程动作映射（data 为工具返回的附加数据）
      onToolAction: (action: string, data?: Record<string, unknown>) => {
        switch (action) {
          case 'naming_flow': naming.startNaming(); break
          case 'checkin_flow': openCheckin(); break
          case 'memory_flow': memory.startMemoryRecord(); break
          case 'symptom_flow': openSymptom(); break
          case 'breed_flow': {
            // AI 识图/追问品种命中品种库 → 跳品种详情页
            const breedId = data?.breedId
            if (breedId && typeof breedId === 'string') {
              Taro.navigateTo({ url: `/pagesPet/breed-detail/index?id=${breedId}` })
            } else {
              Taro.navigateTo({ url: '/pagesPet/breed/index' })
            }
            break
          }
        }
      },
    })
  })

  /** 长按消息复制内容（与首页一致，方便用户把团团的建议贴给兽医/家人） */
  const handleLongPress = (msg: Message) => {
    if (!msg.content) return
    Taro.setClipboardData({
      data: msg.content,
      success: () => {
        Taro.showToast({ title: '已复制', icon: 'success', duration: 1500 })
      },
    })
  }

  /** 取名流程 - 选择照片上传 */
  const handleNamingPhotoChoose = async () => {
    if (naming.isUploadingPhoto) return
    try {
      const res = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      if (!res.tempFilePaths.length) return
      await naming.handleNamingPhoto(res.tempFilePaths[0])
    } catch (err: any) {
      const errMsg = err?.errMsg || err?.message || ''
      // 用户自己取消不算错误，静默返回
      if (errMsg.includes('cancel')) {
        return
      }
      console.error('[NamingPhotoChoose] Error:', errMsg, err)
      // 按错误类型给具体提示：越模糊的文案越会让用户以为是「功能坏了」
      if (errMsg.includes('auth deny') || errMsg.includes('authorize')) {
        Taro.showToast({ title: '需要相册/相机权限，请在设置中开启', icon: 'none', duration: 2500 })
      } else if (errMsg.includes('api scope is not declared')) {
        Taro.showToast({ title: '隐私协议未授权，请重新进入小程序', icon: 'none', duration: 2500 })
      } else {
        Taro.showToast({ title: '选择照片失败，请重试', icon: 'none' })
      }
    }
  }

  /**
   * 能力入口点击分发（常驻能力条的唯一出口）
   * @param key - CAPABILITIES 里的 action key
   */
  const handleCapability = (key: string) => {
    switch (key) {
      case 'checkin': openCheckin(); break
      case 'food': food.handleFoodQuery(); break
      case 'symptom': openSymptom(); break
      case 'vaccine': Taro.navigateTo({ url: '/pagesPet/vaccine/index' }); break
      case 'hospital': Taro.navigateTo({ url: '/pagesPet/hospital/index' }); break
      case 'memory': Taro.navigateTo({ url: '/pagesUser/memory/index' }); break
      case 'naming': naming.startNaming(); break
    }
  }

  /**
   * 路由参数 `capability` 的一次性自动触发（入口收拢的闭环，见文件头「契约」一节）
   *
   * 【为什么放 useEffect 而不是 useDidShow】`useDidShow` 在每次页面重新可见时都会触发，
   * 若用户从食物查询返回团团，会被"再自动开一次"——这是重复触发，不是我们想要的。
   * 本页是 navigateTo 打开的非 tab 页，页面卸载后重进才会重新读参数，用挂载时执行一次即可。
   *
   * 【为什么用 ref 而不是空依赖数组就完事】本页大量 state（消息列表、流程状态）会在用户操作后
   * 反复重渲染，`handleCapability` 又是每次渲染新建的函数；若写成依赖数组会导致**每渲染一次
   * 就可能重开一次流程**。这里用 `didAutoTriggerRef` 把它钉成"整页生命周期内只执行一次"。
   * 若将来新增"用户名 → 切换能力"的交互（同一页面内二次触发），必须显式重置这个 ref。
   *
   * 【为什么读 `Taro.getCurrentInstance()` 而不是 `useRouter()`】本仓既有读参写法就是
   * `Taro.getCurrentInstance().router?.params`（见 `pagesMemoir/memoir-daily/index.tsx:96`
   * 与 `pagesMemoir/memoir-full/index.tsx:148`），沿用同一口径，不再多引一个 hook。
   */
  const didAutoTriggerRef = useRef(false)
  useEffect(() => {
    // 已经执行过（含用户操作引发的重渲染）→ 直接跳过，绝不重复触发
    if (didAutoTriggerRef.current) return
    didAutoTriggerRef.current = true

    const rawCapability = Taro.getCurrentInstance()?.router?.params?.capability
    const capability = typeof rawCapability === 'string' ? rawCapability : ''
    // 缺失 / 非法 / 属纯记录查询类 → 什么都不做（保持"只打开团团首屏"的现状）
    // 白名单是第一道闸；`handleCapability` 的 switch 没有 default 分支，未知 key 天然静默忽略，
    // 是第二道闸 —— 两道都在，参数被改坏也不会白屏或跳到意外页面。
    if (!AUTO_CAPABILITY_KEYS.includes(capability)) return

    // 还没加载完或没有宠物：自动打开一个"没有档案可问"的能力只会让用户更困惑，
    // 交给页面既有空态引导「添加宠物」；此处刻意不触发。
    if (petInfo.isLoading || !petInfo.hasPet) return

    handleCapability(capability)
    // 依赖数组有意留空：靠 didAutoTriggerRef 保证只跑一次，避免重渲染重复开流程
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** + 面板菜单点击分发（顺序与 PLUS_MENU_ITEMS 一一对应） */
  const handlePlusMenuItem = (index: number) => {
    setPlusPanelOpen(false)
    switch (index) {
      case 0: chat.handleChooseImage(['camera']); break
      case 1: chat.handleChooseImage(['album']); break
      case 2: openCheckin(); break
      case 3: memory.startMemoryRecord(); break
      case 4: Taro.navigateTo({ url: '/pagesPet/breed/index' }); break
      case 5: Taro.navigateTo({ url: '/pages/family/index' }); break
    }
  }

  /**
   * 当前处于哪个「对话内流程」
   * @returns 取名流程返回 'naming'，其余返回 null
   */
  const getCurrentFlowType = (): 'naming' | null => {
    // 打卡/症状初筛走弹窗卡片，不占用聊天输入流；此处只识别取名聊天内流程
    if (naming.namingStep >= 0) return 'naming'
    return null
  }

  /** AI 消息里的选项按钮点击（目前只有取名流程用） */
  const handleOptionClick = (option: string) => {
    const flowType = getCurrentFlowType()
    if (flowType === 'naming') naming.handleNamingAnswer(option)
  }

  /**
   * 渲染一条消息的正文（图片 + 按换行拆成多行 Text）
   *
   * 为什么按 '\n' 拆：小程序 <Text> 里的 '\n' 在部分基础库上不换行，
   * 拆成多个 <Text> 再补 '\n' 是仓库既有做法，逐字沿用。
   * @param msg - 消息对象
   * @returns 消息正文 JSX
   */
  const renderMessageContent = (msg: Message) => {
    return (
      <View>
        {msg.imageUrl && (
          <Image
            className='msg-image'
            src={msg.imageUrl}
            mode='widthFix'
            style={{ maxWidth: '360rpx', borderRadius: '12rpx', marginBottom: msg.content ? '12rpx' : '0' }}
            onClick={() => {
              Taro.previewImage({ urls: [msg.imageUrl!], current: msg.imageUrl })
            }}
          />
        )}
        {msg.content.split('\n').map((line, i) => (
          <Text key={i}>
            {line}
            {i < msg.content.split('\n').length - 1 && '\n'}
          </Text>
        ))}
      </View>
    )
  }

  /**
   * 渲染结构化结果卡片（打卡结果 / 食物安全 / 症状初筛 / 取名推荐）
   *
   * 为什么卡片不带跳转：这些卡片是「AI 的回答」，答完就结束；
   * 需要用户操作的下一步（换一批、就用这个名字、上传照片）都用卡片内的按钮承接，
   * 不把用户踢出对话页 —— 这是原首页的做法，逐字搬过来保持一致。
   * @param card - 消息携带的结构化卡片数据
   * @returns 卡片 JSX；未知类型返回 null
   */
  const renderCard = (card: CardData) => {
    switch (card.type) {
      case 'checkin_result': {
        const starCount = card.score !== undefined ? Math.round(card.score / 20) : 0
        return (
          <View className='msg-card'>
            <Text className='msg-card-title'>{card.title}</Text>
            <View className='score-stars'>
              {[1, 2, 3, 4, 5].map(i => (
                <Text key={i}>{i <= starCount ? '★' : '☆'}</Text>
              ))}
            </View>
            <View className='msg-card-stat'>
              <Text className='msg-card-stat-label'>综合评分</Text>
              <Text className='msg-card-stat-val'>{card.score} 分</Text>
            </View>
            {card.stats?.map((stat, si) => (
              <View key={si} className='msg-card-stat'>
                <Text className='msg-card-stat-label'>{stat.emoji || ''} {stat.label}</Text>
                <Text className='msg-card-stat-val'>{stat.value}</Text>
              </View>
            ))}
          </View>
        )
      }
      case 'food_result': {
        const isSafe = card.safe !== false
        return (
          <View className='msg-card'>
            <Text className='msg-card-title'>{card.title}</Text>
            <Text className='msg-card-text'>{card.desc}</Text>
            <View className={`msg-card-alert ${isSafe ? 'msg-card-alert--safe' : 'msg-card-alert--danger'}`}>
              <Text>{isSafe ? '👍 建议：' : '⚠ 建议：'}{card.advice}</Text>
            </View>
            {!isSafe && card.risk === 'P0' && (
              <View className='msg-card-hospital'>
                <Text className='msg-card-hospital-title'>🏥 如果误食，请立即就医</Text>
                <Text className='msg-card-hospital-item'>🏥 瑞鹏宠物医院 · 1.2km</Text>
                <Text className='msg-card-hospital-item'>🏥 美联众合 · 2.5km</Text>
                <Text className='msg-card-hospital-item'>🏥 芭比堂 · 3.1km</Text>
              </View>
            )}
          </View>
        )
      }
      case 'symptom_result': {
        return (
          <View className='msg-card'>
            <Text className='msg-card-title'>{card.title}</Text>
            {card.symptomInfo?.map((info, si) => (
              <View key={si} className='msg-card-stat'>
                <Text className='msg-card-stat-label'>{info.label}</Text>
                <Text className='msg-card-stat-val'>{info.value}</Text>
              </View>
            ))}
            <View className={`msg-card-alert ${card.riskLevel === 'critical' || card.riskLevel === 'high' ? 'msg-card-alert--danger' : 'msg-card-alert--safe'}`}>
              <Text>{card.advice}</Text>
            </View>
            {card.hospitalList && card.hospitalList.length > 0 && (
              <View className='msg-card-hospital'>
                <Text className='msg-card-hospital-title'>🏥 附近的宠物医院</Text>
                {card.hospitalList.map((h, hi) => (
                  <Text key={hi} className='msg-card-hospital-item'>{h}</Text>
                ))}
              </View>
            )}
          </View>
        )
      }
      case 'naming_cards': {
        const isRefreshing = card.data?.refreshing === true
        return (
          <View>
            {isRefreshing ? (
              <View className='msg-naming-refreshing'>
                <Text className='msg-naming-refreshing-text'>AI 正在为你重新推荐...</Text>
                <View className='msg-naming-refreshing-dots'>
                  <View className='msg-naming-dot' />
                  <View className='msg-naming-dot' />
                  <View className='msg-naming-dot' />
                </View>
              </View>
            ) : (
              <>
                {card.names?.map((n, ni) => (
                  <View
                    key={ni}
                    className='msg-naming-card msg-naming-card--clickable'
                    onClick={() => naming.handleNamingDetail(n)}
                    hoverClass='msg-naming-card--hover'
                  >
                    {ni === 0 && <View className='msg-naming-badge'><Text>推荐</Text></View>}
                    <View className='msg-naming-header'>
                      <Text className='msg-naming-name'>{n.name}</Text>
                      <View className='score-stars' style={{ marginBottom: '4rpx' }}>
                        {[1, 2, 3, 4, 5].map(i => (
                          <Text key={i}>{i <= Math.round(n.score / 20) ? '★' : '☆'}</Text>
                        ))}
                      </View>
                    </View>
                    {n.wuxing && (
                      <View className='msg-naming-tags'>
                        <Text className='msg-naming-tag msg-naming-tag--wuxing'>五行：{n.wuxing}</Text>
                        {n.starMansion && <Text className='msg-naming-tag msg-naming-tag--star'>星宿：{n.starMansion}</Text>}
                      </View>
                    )}
                    {n.source && (
                      <Text className='msg-naming-source'>{n.source}</Text>
                    )}
                    <Text className='msg-naming-meaning'>{n.meaning}</Text>
                    <View className='msg-naming-detail-hint'>
                      <Text>点击查看命理详情 →</Text>
                    </View>
                  </View>
                ))}
                <View
                  className='msg-naming-refresh-btn'
                  onClick={() => naming.refreshNaming()}
                  hoverClass='msg-naming-refresh-btn--hover'
                >
                  <Icon name='arrows-clockwise' size={14} tone='primary' className='msg-naming-refresh-icon' />
                  <Text className='msg-naming-refresh-label'>不满意？换一批</Text>
                </View>
              </>
            )}
          </View>
        )
      }
      default:
        return null
    }
  }

  return (
    <View className={`yuantuan-page ${themeClass}`}>

      {/* 全屏动态背景光斑层（与首页同一套，切主题一起变） */}
      <PageBackground />

      {/* 爪印粒子装饰（原首页装饰，随对话页一起搬过来） */}
      <View className='chat-paw-particles'>
        <Icon name='paw-print' size={16} tone='primary' className='chat-paw chat-paw--1' />
        <Icon name='paw-print' size={16} tone='primary' className='chat-paw chat-paw--2' />
        <Icon name='paw-print' size={16} tone='primary' className='chat-paw chat-paw--3' />
        <Icon name='paw-print' size={16} tone='primary' className='chat-paw chat-paw--4' />
        <Icon name='paw-print' size={16} tone='primary' className='chat-paw chat-paw--5' />
        <Icon name='paw-print' size={16} tone='primary' className='chat-paw chat-paw--6' />
      </View>

      {/* 星星装饰 */}
      <View className='chat-stars'>
        <Text className='chat-star chat-star--1'>✦</Text>
        <Text className='chat-star chat-star--2'>✧</Text>
        <Text className='chat-star chat-star--3'>✦</Text>
        <Text className='chat-star chat-star--4'>✧</Text>
        <Text className='chat-star chat-star--5'>✦</Text>
        <Text className='chat-star chat-star--6'>✧</Text>
      </View>

      {petInfo.isLoading && !petInfo.hasPet ? (
        /* 加载中：骨架屏（与首页同款） */
        <HomeSkeleton />
      ) : !petInfo.hasPet ? (
        /* 空状态：还没有宠物时团团没有档案可问，引导先去添加宠物 */
        <View className='chat-empty'>
          <View className='chat-empty-mascot'>
            <View className='chat-empty-mascot__halo' />
            <View className='chat-empty-mascot__ring' />
            <Image className='chat-empty-mascot__img' src={catDogHero} mode='aspectFit' />
          </View>

          <View className='chat-empty-slogan'>
            <Icon name='sparkle' size={16} tone='primary' className='chat-empty-slogan__star' />
            <Text className='chat-empty-slogan__text'>
              它的可爱 要一颗一颗收进<Text className='chat-empty-slogan__accent'>星河</Text>里
            </Text>
            <Icon name='sparkle' size={16} tone='primary' className='chat-empty-slogan__star' />
          </View>

          <Text className='chat-empty-title'>欢迎来到星河宠记</Text>
          <Text className='chat-empty-desc'>添加你的第一位宠物伙伴，{'\n'}团团才能帮你看它的一生</Text>

          <View className='chat-empty-btn' onClick={() => Taro.navigateTo({ url: '/pagesPet/add/index' })}>
            <Icon name='plus' size={16} tone='white' />
            <Text className='chat-empty-btn-text'>添加宠物</Text>
          </View>
        </View>
      ) : (
        <>
          {/* ===== 顶栏：左边收起（回「今天」）+ 团团身份，右边新建/历史 ===== */}
          <View className='yuantuan-head'>
            <View className='yuantuan-head__close' onClick={handleClose} hoverClass='yuantuan-head__close--hover'>
              <Icon name='caret-down' size={16} tone='muted' />
            </View>

            <View className='yuantuan-head__ava'>
              <AiAvatar imgClass='yuantuan-head__ava-img' emojiClass='yuantuan-head__ava-emoji' />
            </View>

            <View className='yuantuan-head__info'>
              <Text className='yuantuan-head__title'>团团 · AI 宠物管家</Text>
              <View className='yuantuan-head__status-row'>
                {/* 在线小圆点：纯装饰，配色走主题（不用固定绿，深色主题下才不会突兀） */}
                <View className='yuantuan-head__dot' />
                <Text className='yuantuan-head__status'>在线 · 记得{petInfo.name || '它'}的全部档案</Text>
              </View>
            </View>

            {/* 新建对话：主入口常驻顶栏（用户反馈「放历史里找不到」，对齐豆包式一屏可见） */}
            <View className='yuantuan-head__new' onClick={handleNewSession} hoverClass='yuantuan-head__new--hover'>
              <Icon name='note-pencil' size={14} tone='white' />
              <Text className='yuantuan-head__new-text'>新建</Text>
            </View>
            {/* 历史对话：抽屉入口（会话列表 + 长按删除） */}
            <View
              className='yuantuan-head__icon'
              onClick={() => setSessionDrawerOpen(true)}
              hoverClass='yuantuan-head__icon--hover'
            >
              <Icon name='clipboard-text' size={16} tone='primary' />
            </View>
          </View>

          <ScrollView
            className='chat-msg-list'
            scrollY
            scrollWithAnimation
            ref={chat.scrollRef}
          >
            {/* 内层容器：scroll-view 上不支持 padding（webview 渲染模式），间距由内部元素承载 */}
            <View className='chat-msg-list__inner'>

              {/* ===== 长对话软提示（多会话：满 60 条建议新建，不强制） ===== */}
              {showLongChatTip && (
                <View className='chat-long-tip' onClick={handleNewSession}>
                  <Icon name='lightbulb' size={15} color='#a06a3f' className='chat-long-tip-icon' />
                  <Text className='chat-long-tip-text'>当前对话已较长，新建对话 AI 会更记得住</Text>
                  <Text className='chat-long-tip-action'>＋ 新建对话</Text>
                </View>
              )}

              {/* ===== 欢迎语（真实文案，一字未改从首页搬来） ===== */}
              <View className='msg-row ai'>
                <View className='msg-avatar'>
                  <AiAvatar imgClass='msg-avatar-img' emojiClass='msg-avatar-emoji' />
                </View>
                <View className='msg-bubble-wrap'>
                  <View className='msg-bubble'>
                    {/* 欢迎语：时段问候 + 宠物名（都能就地取到，不额外发请求）。
                        ⚠️ 不要再把能力清单写回这里 —— 下面那排胶囊就是同一份清单且可点，
                        写两遍会让首屏出现两套"我能干什么"（2026-09-12 收口批次按 v2 屏 03 改）。 */}
                    <Text>{greetingByHour()}呀，我是团团 🐾{'\n'}有关{petInfo.name || '它'}的事，随时问我。</Text>
                  </View>

                  {/* 常驻能力入口：IA §3.2 定的「全站 AI 能力唯一入口」 */}
                  <View className='yuantuan-caps'>
                    {CAPABILITIES.map(cap => (
                      <View
                        key={cap.key}
                        className='yuantuan-cap'
                        hoverClass='yuantuan-cap--hover'
                        onClick={() => handleCapability(cap.key)}
                      >
                        <Icon name={cap.icon} size={14} tone='primary' />
                        <Text className='yuantuan-cap__label'>{cap.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              {chat.messages.map((msg, idx) => (
                <View key={msg.id} className={`msg-row ${msg.type}`}>
                  <View className='msg-avatar'>
                    {msg.type === 'ai' ? (
                      <AiAvatar imgClass='msg-avatar-img' emojiClass='msg-avatar-emoji' />
                    ) : (
                      // 用户头像占位：用图标与 AI 头像（图片）保持体例一致
                      <Icon name='user' size={16} tone='primary' className='msg-avatar-emoji' />
                    )}
                  </View>
                  <View className='msg-bubble-wrap'>
                    <View
                      className={`msg-bubble ${msg.id === chat.streamingId ? 'msg-bubble--streaming' : ''}`}
                      onClick={msg.id === chat.streamingId ? chat.skipStream : undefined}
                      onLongPress={() => handleLongPress(msg)}
                    >
                      {renderMessageContent(msg)}
                      {msg.id === chat.streamingId && (
                        <Text className='streaming-cursor'>▋</Text>
                      )}
                    </View>
                    {msg.id === chat.streamingId && (
                      <Text className='streaming-hint'>点击跳过 ↑</Text>
                    )}

                    {msg.card && renderCard(msg.card)}

                    {msg.options && msg.options.length > 0 && (
                      <View className='msg-options-list'>
                        {msg.options.map((opt, oi) => (
                          <View
                            key={oi}
                            className='msg-option'
                            onClick={() => handleOptionClick(opt)}
                          >
                            <Text>{opt}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* 取名流程 - 照片上传步骤 */}
                    {idx === chat.messages.length - 1 && naming.currentStep?.type === 'photo' && naming.namingStep >= 0 && (
                      <View className='msg-naming-actions'>
                        <View className='msg-naming-action-btn msg-naming-action-btn--upload' onClick={handleNamingPhotoChoose}>
                          <Text>{naming.isUploadingPhoto ? '上传中...' : '📷 上传照片'}</Text>
                        </View>
                        <View className='msg-naming-action-btn msg-naming-action-btn--skip' onClick={naming.skipNamingPhoto}>
                          <Text>{naming.currentStep?.skipLabel || '跳过'}</Text>
                        </View>
                      </View>
                    )}

                    {/* 取名流程 - 描述步骤跳过按钮 */}
                    {idx === chat.messages.length - 1 && naming.currentStep?.type === 'text' && naming.currentStep?.key === 'description' && naming.namingStep >= 0 && (
                      <View className='msg-naming-actions'>
                        <View className='msg-naming-action-btn msg-naming-action-btn--skip' onClick={naming.skipNamingDesc}>
                          <Text>{naming.currentStep?.skipLabel || '跳过'}</Text>
                        </View>
                      </View>
                    )}

                    {/* 回忆流程 - 照片上传/预览 */}
                    {idx === chat.messages.length - 1 && memory.memoryActive && (
                      <View className='msg-naming-actions'>
                        {memory.memoryPhoto ? (
                          <View className='msg-memory-photo-preview'>
                            <Image
                              className='msg-memory-photo-img'
                              src={memory.memoryPhoto}
                              mode='aspectFill'
                            />
                            <View className='msg-memory-photo-info'>
                              <Text className='msg-memory-photo-label'>照片已选择</Text>
                              <View className='msg-memory-photo-actions'>
                                <View className='msg-naming-action-btn msg-naming-action-btn--upload' onClick={memory.handleMemoryPhoto}>
                                  <Text>更换</Text>
                                </View>
                                <View className='msg-naming-action-btn msg-naming-action-btn--skip' onClick={memory.clearMemoryPhoto}>
                                  <Text>删除</Text>
                                </View>
                              </View>
                            </View>
                          </View>
                        ) : (
                          <View className='msg-naming-action-btn msg-naming-action-btn--upload' onClick={memory.handleMemoryPhoto}>
                            <Text>{memory.isUploadingPhoto ? '上传中...' : '📷 拍照/上传照片'}</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              ))}

              {agentToolStatus && (
                <View className='msg-row ai'>
                  <View className='msg-avatar'>
                    <AiAvatar imgClass='msg-avatar-img' emojiClass='msg-avatar-emoji' />
                  </View>
                  <View className='msg-bubble agent-status-bubble'>
                    <Text className='agent-status-text'>{agentToolStatus}</Text>
                  </View>
                </View>
              )}

              {chat.isTyping && (
                <View className='msg-row ai'>
                  <View className='msg-avatar'>
                    <AiAvatar imgClass='msg-avatar-img' emojiClass='msg-avatar-emoji' />
                  </View>
                  <View className='msg-bubble typing-bubble'>
                    <View className='typing-dots'>
                      <View className='typing-dot' />
                      <View className='typing-dot' />
                      <View className='typing-dot' />
                    </View>
                  </View>
                </View>
              )}

              {/* 医疗免责声明：AI 对话页必须常驻（合规口径，原首页在最底部） */}
              <View className='yuantuan-disclaimer'>
                <Text className='yuantuan-disclaimer__text'>团团由 AI 驱动，不能替代兽医诊断</Text>
              </View>

              <View className='chat-bottom-spacer' />
            </View>
          </ScrollView>

          {/* ===== 吸底输入区（本页非 tab 页，直接贴视口底部，仅留安全区） ===== */}
          <View className='chat-input-area'>
            {/* + 功能面板 */}
            {plusPanelOpen && (
              <>
                <View
                  className='chat-plus-overlay'
                  catchMove
                  onClick={() => setPlusPanelOpen(false)}
                />
                <View className='chat-plus-panel' catchMove>
                  <View className='chat-plus-panel-grid'>
                    {PLUS_MENU_ITEMS.map((item, idx) => (
                      <View
                        key={idx}
                        className='plus-panel-item'
                        hoverClass='plus-panel-item--hover'
                        hoverStayTime={80}
                        onClick={() => handlePlusMenuItem(idx)}
                      >
                        <View className='plus-panel-icon-wrap' style={{ background: item.bg }}>
                          <Icon name={item.icon} size={20} tone='primary' className='plus-panel-icon' />
                        </View>
                        <Text className='plus-panel-label'>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </>
            )}

            {/* 待发送图片附件条（微信 IM 式）：选图后先在此预览，可补充文字/取消 */}
            {chat.pendingImage && (
              <View className='chat-attach-bar'>
                <View className='chat-attach-thumb-wrap'>
                  <Image
                    className='chat-attach-thumb'
                    src={chat.pendingImage}
                    mode='aspectFill'
                    onClick={() => Taro.previewImage({ urls: [chat.pendingImage!], current: chat.pendingImage! })}
                  />
                  <View className='chat-attach-remove' onClick={chat.clearPendingImage}>
                    <Text className='chat-attach-remove-icon'>×</Text>
                  </View>
                </View>
                <Text className='chat-attach-hint'>已选图片，可输入文字补充说明</Text>
              </View>
            )}

            {/* 微信风格输入行 */}
            <View className='chat-input-row'>
              {/* 语音/文字切换 */}
              <View
                className={`wx-toggle-btn ${inputMode === 'voice' ? 'wx-toggle-btn--active' : ''}`}
                onClick={() => {
                  // 非微信/插件未就绪时不允许切到语音模式（避免「点击无反应」）
                  if (inputMode === 'text' && !voice.isVoiceSupported) {
                    Taro.showToast({ title: '当前平台不支持语音输入', icon: 'none' })
                    return
                  }
                  setInputMode(inputMode === 'text' ? 'voice' : 'text')
                  setPlusPanelOpen(false)
                }}
              >
                <Icon
                  name={inputMode === 'text' ? 'microphone' : 'keyboard'}
                  size={16}
                  tone='primary'
                  className='wx-toggle-icon'
                />
              </View>

              {/* 文字模式：输入框（focus 由 autoFocus 控制，进页面自动聚焦） */}
              {inputMode === 'text' && (
                <Input
                  className='chat-input-field'
                  value={inputValue}
                  focus={autoFocus}
                  onInput={(e) => setInputValue(e.detail.value)}
                  onConfirm={() => chat.handleSend()}
                  onFocus={() => setPlusPanelOpen(false)}
                  placeholder={naming.isTextInputActive && naming.currentStep?.placeholder
                    ? naming.currentStep.placeholder
                    : '和团团说点什么…'}
                  placeholderStyle='color: #B69B83'
                  confirmType='send'
                />
              )}

              {/* 语音模式：按住说话 */}
              {inputMode === 'voice' && (
                <View
                  className={`wx-hold-talk ${voice.isRecording ? 'wx-hold-talk--recording' : ''} ${isVoiceProcessing ? 'wx-hold-talk--processing' : ''}`}
                  onTouchStart={voice.startRecord}
                  onTouchEnd={voice.stopRecord}
                  onTouchCancel={voice.stopRecord}
                >
                  {isVoiceProcessing ? (
                    <Text className='wx-hold-talk-text'>识别中...</Text>
                  ) : voice.isRecording ? (
                    <View className='wx-hold-talk-recording'>
                      <View className='wx-hold-talk-wave'>
                        <View className='wx-hold-talk-wave-bar' />
                        <View className='wx-hold-talk-wave-bar' />
                        <View className='wx-hold-talk-wave-bar' />
                      </View>
                      <Text className='wx-hold-talk-duration'>{voice.recordDuration}s 松开结束</Text>
                    </View>
                  ) : (
                    <Text className='wx-hold-talk-text'>按住 说话</Text>
                  )}
                </View>
              )}

              {/* 发送 / + 按钮（有待发送附件时也显示发送） */}
              {inputValue.trim() || chat.pendingImage ? (
                <View className='wx-send-btn' onClick={() => chat.handleSend()}>
                  <Text className='wx-send-text'>↑</Text>
                </View>
              ) : (
                <View
                  className={`wx-plus-btn ${plusPanelOpen ? 'wx-plus-btn--active' : ''}`}
                  onClick={() => {
                    setPlusPanelOpen(!plusPanelOpen)
                    setInputMode('text')
                  }}
                >
                  <Text className='wx-plus-text'>+</Text>
                </View>
              )}
            </View>
            <View className='chat-input-safe' />
          </View>
        </>
      )}

      {/* 健康打卡弹窗卡片：全流程在卡内完成，完成后聊天流只追加一条结果消息 */}
      <CheckinPopup
        open={checkinOpen}
        onClose={() => setCheckinOpen(false)}
        onComplete={handleCheckinComplete}
      />

      {/* 症状初筛弹窗卡片 */}
      <SymptomCheckPopup
        open={symptomOpen}
        onClose={() => setSymptomOpen(false)}
        onComplete={handleSymptomComplete}
      />

      {/* 命理详情悬浮弹窗（取名流程的结果闭环） */}
      {naming.namingDetailPopup && (
        <View className='naming-popup-overlay' onClick={naming.closeNamingDetail}>
          <View className='naming-popup-card' onClick={(e: any) => e.stopPropagation()}>
            <View className='naming-popup-close' onClick={naming.closeNamingDetail}>
              <Text>✕</Text>
            </View>

            <View className='msg-naming-detail-header'>
              <Text className='msg-naming-detail-name'>{naming.namingDetailPopup.name}</Text>
              <Text className='msg-naming-detail-subtitle'>命理深度分析</Text>
            </View>

            <ScrollView className='naming-popup-body' scrollY enhanced showScrollbar={false}>
              {naming.isDetailLoading ? (
                /* 加载骨架屏 */
                <View className='naming-popup-loading'>
                  <View className='naming-popup-spinner'>
                    <Text className='naming-popup-spinner-icon'>☯</Text>
                  </View>
                  <Text className='naming-popup-loading-text'>
                    正在深度解析「{naming.namingDetailPopup.name}」的命理运势...
                  </Text>
                  <View className='naming-popup-skeleton'>
                    {[1, 2, 3, 4, 5].map(i => (
                      <View key={i} className='naming-popup-skeleton-line' style={{ width: `${85 + Math.random() * 15}%` }} />
                    ))}
                  </View>
                </View>
              ) : (
                <>
                  <View className='msg-naming-detail-section'>
                    <View className='msg-naming-detail-section-title'>
                      <Text className='msg-naming-detail-icon'>☯</Text>
                      <Text>八字命理</Text>
                    </View>
                    <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.bazi}</Text>
                  </View>

                  <View className='msg-naming-detail-section msg-naming-detail-section--fortune'>
                    <View className='msg-naming-detail-section-title'>
                      <Icon name='star' size={14} tone='primary' className='msg-naming-detail-icon' />
                      <Text>整体运势</Text>
                    </View>
                    <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.fortune}</Text>
                  </View>

                  <View className='msg-naming-detail-section'>
                    <View className='msg-naming-detail-section-title'>
                      <Icon name='star' size={14} tone='primary' className='msg-naming-detail-icon' />
                      <Text>事业/生活运势</Text>
                    </View>
                    <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.careerFortune}</Text>
                  </View>

                  <View className='msg-naming-detail-section'>
                    <View className='msg-naming-detail-section-title'>
                      <Icon name='heart' size={14} tone='primary' className='msg-naming-detail-icon' />
                      <Text>感情/人际运势</Text>
                    </View>
                    <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.loveFortune}</Text>
                  </View>

                  <View className='msg-naming-detail-section'>
                    <View className='msg-naming-detail-section-title'>
                      <Icon name='clover' size={14} tone='primary' className='msg-naming-detail-icon' />
                      <Text>健康运势</Text>
                    </View>
                    <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.healthFortune}</Text>
                  </View>

                  <View className='msg-naming-detail-section'>
                    <View className='msg-naming-detail-section-title'>
                      <Icon name='mask-happy' size={14} tone='primary' className='msg-naming-detail-icon' />
                      <Text>性格特质</Text>
                    </View>
                    <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.personality}</Text>
                  </View>

                  <View className='msg-naming-detail-section'>
                    <View className='msg-naming-detail-section-title'>
                      <Text className='msg-naming-detail-icon'>✍</Text>
                      <Text>笔画数理</Text>
                    </View>
                    <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.strokes}</Text>
                  </View>

                  <View className='msg-naming-detail-section'>
                    <View className='msg-naming-detail-section-title'>
                      <Icon name='sparkle' size={14} tone='primary' className='msg-naming-detail-icon' />
                      <Text>吉祥三宝</Text>
                    </View>
                    <View className='msg-naming-detail-lucky'>
                      <View className='msg-naming-detail-lucky-item'>
                        <Text className='msg-naming-detail-lucky-label'>方位</Text>
                        <Text className='msg-naming-detail-lucky-val'>{naming.namingDetailPopup.luckyDirection}</Text>
                      </View>
                      <View className='msg-naming-detail-lucky-item'>
                        <Text className='msg-naming-detail-lucky-label'>颜色</Text>
                        <Text className='msg-naming-detail-lucky-val'>{naming.namingDetailPopup.luckyColor}</Text>
                      </View>
                      <View className='msg-naming-detail-lucky-item'>
                        <Text className='msg-naming-detail-lucky-label'>数字</Text>
                        <Text className='msg-naming-detail-lucky-val'>{naming.namingDetailPopup.luckyNumber}</Text>
                      </View>
                    </View>
                  </View>

                  <View className='msg-naming-detail-section'>
                    <View className='msg-naming-detail-section-title'>
                      <Icon name='handshake' size={14} tone='primary' className='msg-naming-detail-icon' />
                      <Text>与主人缘分</Text>
                    </View>
                    <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.karmaWithOwner}</Text>
                  </View>

                  <View className='msg-naming-detail-section msg-naming-detail-section--summary'>
                    <View className='msg-naming-detail-section-title'>
                      <Text className='msg-naming-detail-icon'>✨</Text>
                      <Text>总结寄语</Text>
                    </View>
                    <Text className='msg-naming-detail-text msg-naming-detail-text--summary'>{naming.namingDetailPopup.summary}</Text>
                  </View>

                  {/* 结果闭环：一键把名字写进宠物档案 */}
                  {petInfo.hasPet && (
                    <View
                      className='naming-popup-apply'
                      hoverClass='naming-popup-apply--hover'
                      onClick={async () => {
                        const target = naming.namingDetailPopup
                        if (!target) return
                        const ok = await naming.applyNamingName(target.name)
                        if (ok) naming.closeNamingDetail()
                      }}
                    >
                      <Text className='naming-popup-apply-text'>就用这个名字 ✨</Text>
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {/* ===== 会话列表抽屉（多会话「历史对话」，豆包式新建/切换/删除） ===== */}
      {sessionDrawerOpen && (
        <View className='session-drawer-overlay' onClick={() => setSessionDrawerOpen(false)}>
          <View className='session-drawer' onClick={(e: any) => e.stopPropagation()}>
            <View className='session-drawer-head'>
              <Text className='session-drawer-title'>历史对话</Text>
              <View
                className='session-drawer-new'
                onClick={() => { handleNewSession(); setSessionDrawerOpen(false) }}
              >
                <Text className='session-drawer-new-icon'>＋</Text>
                <Text className='session-drawer-new-text'>新建对话</Text>
              </View>
            </View>
            <ScrollView className='session-drawer-list' scrollY>
              {sessions.length === 0 ? (
                <View className='session-drawer-empty'>
                  <Icon name='chat-circle' size={32} color='#b6a594' className='session-drawer-empty-icon' />
                  <Text className='session-drawer-empty-text'>还没有对话，点上方「新建对话」开始吧</Text>
                </View>
              ) : (
                sessions.map((s) => (
                  <View
                    key={s.id}
                    className={`session-item ${s.id === sessionId ? 'session-item--active' : ''}`}
                    onClick={() => { handleSwitchSession(s.id); setSessionDrawerOpen(false) }}
                    onLongPress={() => {
                      // 长按删除：confirmText「删除」2 字（微信 showModal 上限 4 字，超长弹不出）
                      Taro.showModal({
                        title: '删除对话',
                        content: `确定删除「${s.title}」吗？删除后无法恢复。`,
                        confirmText: '删除',
                        confirmColor: '#E5484D',
                        success: (res) => { if (res.confirm) handleDeleteSession(s.id) },
                      })
                    }}
                  >
                    <View className='session-item-main'>
                      <Text className='session-item-title'>{s.title}</Text>
                      <Text className='session-item-meta'>{s.messageCount} 条消息</Text>
                    </View>
                    {s.id === sessionId && <Text className='session-item-current'>当前</Text>}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  )
}
