/**
 * 首页页面
 * 宠物看护AI助手对话、快捷操作入口、打卡/取名/食物查询等流程
 */
import { View, Text, ScrollView, Input, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useState } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { useChatCore } from '../../hooks/useChatCore'
import SymptomCheckPopup from '../../components/SymptomCheckPopup'
import { useNamingFlow } from '../../hooks/useNamingFlow'
import { useFoodFlow } from '../../hooks/useFoodFlow'
import { useMemoryFlow } from '../../hooks/useMemoryFlow'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import { usePetStore } from '../../stores/petStore'
import { useAuthStore } from '../../stores/authStore'
import { useFamilyStore } from '../../stores/familyStore'
import { getTodayCheckin } from '../../services/checkinService'
import type { CardData, Message, PetInfo } from '../../types/chatTypes'
import type { PetHealthEntry } from '../../memory-body/types/memoryBodyTypes'
import HomeSkeleton from '../../components/HomeSkeleton'
import { Icon, type FillIconName } from '../../components'
// 品牌 IP（2026-09-11 换毛毡质感版，与全站插画统一）
import catDogHero from '../../assets/logo-catdog-felt.jpg'
import CheckinPopup from '../../components/CheckinPopup'
import AiAvatar from './AiAvatar'
import { suggestQuickActions, type QuickAction } from '../../utils/suggestQuickActions'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { formatPetAge } from '../../utils/date'
import { getCachedRiskScan } from '../../services/chronicService'
import { resolvePetAvatarUrl } from '../../data/homeStyleAvatars'
// 自定义 tabBar 的选中态广播 hook（与本页路由一一对应，写错页面路径 tsc 直接报错）
import { useTabBarSelected } from '../../constants/tabBar'
import './index.scss'
import PageBackground from '../../components/PageBackground'

/**
 * 年龄文案已收敛到 utils/date 的 formatPetAge（2026-09-11）
 *
 * 本页原实现按月相减但**不减「日」**（生日 20 号、今天 5 号会多算一个月），
 * 且用 `new Date('YYYY-MM-DD')`（UTC 解析）。首页宠物卡与宠物档案页
 * 因此可能显示不同年龄 —— 这是用户最容易同时看到两处的地方。
 */

/** 食欲等级 → 文案（对齐打卡页） */
const APPETITE_LABEL: Record<number, string> = { 1: '不吃', 2: '少吃', 3: '正常', 4: '多吃', 5: '亢进', 6: '呕吐' }

/** 精神等级 → 文案（对齐打卡页） */
const SPIRIT_LABEL: Record<number, string> = { 1: '萎靡', 2: '低落', 3: '正常', 4: '活跃', 5: '亢奋' }

/** 格式化打卡时间 → "08:32" */
function formatCheckinTime(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value)
  // Number.isNaN 替代全局 isNaN（eslint no-restricted-globals 要求）
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// 从真实宠物数据获取信息，而非硬编码
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

/** 加号菜单项：icon 改存面性图标名（原为 emoji），带类型标注以便直接传给 Icon 组件 */
const PLUS_MENU_ITEMS: Array<{ icon: FillIconName; label: string; sub: string; bg: string }> = [
  { icon: 'camera', label: '拍摄照片', sub: '相机拍摄', bg: 'rgba(255,107,61,0.12)' },
  { icon: 'image', label: '相册图片', sub: '从相册选择', bg: 'rgba(232,168,56,0.12)' },
  { icon: 'clipboard-text', label: '健康打卡', sub: '5项日常检查，1分钟完成', bg: 'rgba(232,168,56,0.12)' },
  { icon: 'note-pencil', label: '记录回忆', sub: '上传照片 + 写一段话', bg: 'rgba(140,173,126,0.12)' },
  { icon: 'cat', label: '品种百科', sub: '40+品种特征和护理要点', bg: 'rgba(166,143,120,0.12)' },
  { icon: 'house', label: '看家庭', sub: '家人动态 + 家庭周报', bg: 'rgba(224,133,107,0.12)' },
]

export default function Index() {
  const themeClass = useThemeClass()
  /**
   * 广播「当前选中的是第 1 个 tab」给自定义 tabBar 组件（今天 = 下标 0）。
   *
   * 【为什么必须由页面主动广播】微信给**每个 tab 页各创建一个**自定义 tabBar 实例
   * （官方文档原话：每个 tab 页下的自定义 tabBar 组件实例是不同的），实例建好后就不随
   * `switchTab` 重新挂载，React 也不会因为路由变化自动重渲染它 —— 所以「现在选中第几个」
   * 只能由 tab 页在 `useDidShow` 时推进来。不接这一行，症状就是「点了 tab、页面确实切了，
   * 但底部高亮还停在上一个」。机制细节（含"某页实例刚创建时靠路由兜底"）见
   * src/custom-tab-bar/index.tsx 文件头。
   *
   * 位置要求：必须放在组件函数体顶层、与其它 hook 同级（hook 内部挂的是 useDidShow，
   * 放进条件分支/循环会让 hook 调用顺序在渲染间漂移）。
   */
  useTabBarSelected('/pages/index/index')
  const petInfo = usePetInfo()
  const user = useAuthStore(s => s.user)
  const [todayHealth, setTodayHealth] = useState<PetHealthEntry | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text')
  const [plusPanelOpen, setPlusPanelOpen] = useState(false)
  const [showGreetingQuickActions, setShowGreetingQuickActions] = useState(true)
  // 会话列表抽屉开关（多会话「历史对话」入口）
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false)
  // 慢性病风险角标：进入首页读取缓存的风险扫描结果，有风险信号时在快捷入口显示角标
  const [chronicRiskCount, setChronicRiskCount] = useState(0)
  const [currentQuickActions, setCurrentQuickActions] = useState<QuickAction[]>([
    { action: 'checkin', label: '健康打卡', icon: 'clipboard-text' },
    { action: 'food', label: '食物查询', icon: 'magnifying-glass' },
    { action: 'symptom', label: '症状初筛', icon: 'stethoscope' },
  ])
  // 多成员共同养宠：家庭成员（人）列表 + 引导横幅开关（情侣引导 2026-08-24）
  const familyUsers = useFamilyStore((s) => s.users)
  const [showCoCareTip, setShowCoCareTip] = useState(true)
  // 今日摘要卡头像：走全站统一口径（真实照片 > AI 形象 > 品种品牌头像），
  // 未设过头像的新宠物也显示小动物头像而不是空圆；仅加载失败时退回物种 emoji
  const homeAvatarUrl = petInfo.activePet ? resolvePetAvatarUrl(petInfo.activePet) : ''
  const [homeAvatarFailed, setHomeAvatarFailed] = useState(false)

  // 头像地址变化（切换宠物 / 换了形象 / 失败地址被替换）时重置失败标记，允许新地址重试
  useEffect(() => {
    setHomeAvatarFailed(false)
  }, [homeAvatarUrl])

  // 进入首页若有家庭，加载家庭成员（人）列表（用于"邀请 TA 一起养宠"引导判断）
  useEffect(() => {
    if (useFamilyStore.getState().currentFamily) {
      useFamilyStore.getState().fetchUsers().catch(() => {})
    }
  }, [])

  const chat = useChatCore({
    petInfo,
    inputValue,
    setInputValue,
    setPlusMenuOpen: setPlusPanelOpen,
    setShowGreetingQuickActions,
  })

  const { agentToolStatus, sessionId, sessions, messages, handleNewSession, handleSwitchSession, handleDeleteSession } = chat

  // 长对话软提示：当前会话页面消息满 60 条时提示「建议新建对话」（不强制、可继续聊）。
  // 用 messages.length 而非 sessions[].messageCount——后者是进入页面时的快照，发送后不刷新，
  // 会导致新建会话计数冻结为 0、软提示实时永不触发（审查 P1）；messages 随发送实时递增。
  const LONG_CHAT_THRESHOLD = 60
  const showLongChatTip = sessionId !== null && messages.length >= LONG_CHAT_THRESHOLD

  // 加载今日健康打卡数据（用于健康摘要卡）
  // 抽成 refreshTodayHealth：打卡弹窗完成后也需要手动刷新一次
  // activePet 提升到回调外，依赖对象引用（eslint exhaustive-deps 口径）
  const activePet = petInfo.activePet
  const refreshTodayHealth = useCallback(() => {
    if (!activePet || !user?.id) {
      setTodayHealth(null)
      return
    }
    getTodayCheckin(activePet.id, user.id)
      .then(entry => setTodayHealth(entry))
      .catch(() => setTodayHealth(null))
  }, [activePet, user?.id])

  useEffect(() => {
    refreshTodayHealth()
  }, [refreshTodayHealth])

  // 慢性病风险角标：读取缓存的风险扫描结果（慢性病页进入时自动扫描并写缓存）
  useEffect(() => {
    if (!activePet) {
      setChronicRiskCount(0)
      return
    }
    const cached = getCachedRiskScan(activePet.id)
    // 仅统计需要关注的信号（warning/alert），info 级不打扰
    const count = cached ? cached.signals.filter(s => s.level !== 'info').length : 0
    setChronicRiskCount(count)
  }, [activePet])

  // 健康打卡改为弹窗卡片交互：全流程在卡内完成，聊天流只在打卡完成后追加一条结果消息
  const [checkinOpen, setCheckinOpen] = useState(false)
  /** 所有打卡入口统一走这里（快捷按钮/+面板/摘要卡/CTA/Agent 工具动作） */
  const openCheckin = useCallback(() => setCheckinOpen(true), [])

  /** 打卡完成回调：往聊天流追加一条结果卡消息 + 刷新顶部今日健康摘要 */
  const handleCheckinComplete = useCallback((payload: {
    type: 'ai'
    content: string
    card?: CardData
  }) => {
    chat.addMessage(payload)
    refreshTodayHealth()
  }, [chat, refreshTodayHealth])

  // 症状初筛改为弹窗卡片交互：全流程在卡内完成，聊天流只在初筛完成后追加一条结果消息
  const [symptomOpen, setSymptomOpen] = useState(false)
  /** 所有症状初筛入口统一走这里（快捷按钮/首页入口/Agent 工具动作/Layer 1 意图） */
  const openSymptom = useCallback(() => setSymptomOpen(true), [])

  /** 初筛完成回调：往聊天流追加一条结果卡消息 */
  const handleSymptomComplete = useCallback((payload: {
    type: 'ai'
    content: string
    card?: CardData
  }) => {
    chat.addMessage(payload)
  }, [chat])

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

  // 语音转文字处理中标记
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false)

  /** 同声传译识别完成后的处理：把识别到的文字直接作为消息发送（改版后不再上传后端 ASR） */
  const handleVoiceComplete = useCallback((text: string) => {
    if (!text || text === '无法识别语音内容') {
      Taro.showToast({ title: '未识别到语音内容，请重试', icon: 'none' })
      return
    }

    // 打卡已改为弹窗卡片交互，语音不再承担打卡答题入口；转写结果直接作为消息发送
    // （用 chat.handleSend(text) 直传识别文本，修复经 setInputValue+setTimeout 读取旧闭包 inputValue 的发送缺陷）
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
      // Layer 2: Agent 工具调用触发的流程动作映射（data 为工具返回的附加数据，如 breed_flow 的 breedId）
      onToolAction: (action: string, data?: Record<string, unknown>) => {
        switch (action) {
          case 'naming_flow': naming.startNaming(); break
          case 'checkin_flow': openCheckin(); break
          case 'memory_flow': memory.startMemoryRecord(); break
          case 'symptom_flow': openSymptom(); break
          case 'breed_flow': {
            // AI 识图/追问品种命中品种库 → 跳品种详情页（详情页底部可一键设为我的宠物品种）
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

  // 长按消息复制内容
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
      if (errMsg.includes('cancel')) {
        return
      }
      console.error('[NamingPhotoChoose] Error:', errMsg, err)
      // 根据错误类型给出更具体的提示
      if (errMsg.includes('auth deny') || errMsg.includes('authorize')) {
        Taro.showToast({ title: '需要相册/相机权限，请在设置中开启', icon: 'none', duration: 2500 })
      } else if (errMsg.includes('api scope is not declared')) {
        Taro.showToast({ title: '隐私协议未授权，请重新进入小程序', icon: 'none', duration: 2500 })
      } else {
        Taro.showToast({ title: '选择照片失败，请重试', icon: 'none' })
      }
    }
  }

  const handleQuickAction = (action: string) => {
    setShowGreetingQuickActions(false)
    if (action === 'checkin') openCheckin()
    else if (action === 'food') food.handleFoodQuery()
    else if (action === 'symptom') openSymptom()
    else if (action === 'naming') naming.startNaming()
    else if (action === 'memory') memory.startMemoryRecord()
  }

  // 用户发送消息后，根据消息内容更新快捷操作推荐
  const handleSendWithSuggestions = () => {
    const text = inputValue.trim()
    // 有待发送图片附件时允许无文字发送（沿用自动分析引导文案）
    if (!text && !chat.pendingImage) return
    // 分析用户消息，更新推荐
    const suggestions = suggestQuickActions(text)
    setCurrentQuickActions(suggestions)

    // 调用原始 handleSend
    chat.handleSend()
  }

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

  const getCurrentFlowType = (): 'naming' | null => {
    // 打卡/症状初筛已改为弹窗卡片，不再占用聊天输入流；此处只识别取名聊天内流程
    if (naming.namingStep >= 0) return 'naming'
    return null
  }

  const handleOptionClick = (option: string) => {
    const flowType = getCurrentFlowType()
    if (flowType === 'naming') naming.handleNamingAnswer(option)
  }

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
    <View className={`chat-home-page ${themeClass}`}>

      {/* 全屏动态背景光斑层 */}
      <PageBackground />

      {/* 爪印粒子装饰 */}
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
        /* 加载中：骨架屏 */
        <HomeSkeleton />
      ) : !petInfo.hasPet ? (
        /* 空状态：引导用户添加宠物
           优化点：① 主视觉换成猫狗 IP 形象（原来是一个浅色爪印，太弱、缺情感）
                  ② 补一句品牌 slogan（带小星星点缀），空态也有品牌感
                  ③ 按钮补 + 图标，不再是裸文字 */
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
          <Text className='chat-empty-desc'>添加你的第一位宠物伙伴，{'\n'}开始记录温馨的每一天</Text>

          <View className='chat-empty-btn' onClick={() => Taro.navigateTo({ url: '/pagesPet/add/index' })}>
            <Icon name='plus' size={16} tone='white' />
            <Text className='chat-empty-btn-text'>添加宠物</Text>
          </View>
        </View>
      ) : (
        <>
      <View className='chat-top-bar'>
        <View className='chat-top-left'>
          <View className='chat-top-brand'>
            <Text className='chat-pet-name'>星河宠记</Text>
            <Text className='chat-pet-detail'>团团 · AI 宠物管家</Text>
          </View>
        </View>
        <View className='chat-top-right'>
          {/* 新建对话：主入口常驻顶栏（用户反馈「放历史里找不到」，对齐豆包式一屏可见） */}
          <View className='chat-top-new-btn' onClick={handleNewSession}>
            <Icon name='note-pencil' size={16} tone='white' />
            <Text className='chat-top-new-text'>新建</Text>
          </View>
          <View className='chat-top-memory-btn' onClick={() => setSessionDrawerOpen(true)}>
            <Icon name='clipboard-text' size={18} tone='primary' />
            <Text className='chat-top-memory-text'>历史</Text>
          </View>
          <View className='chat-top-memory-btn' onClick={() => Taro.navigateTo({ url: '/pagesUser/memory/index' })}>
            <Icon name='brain' size={18} tone='primary' />
            <Text className='chat-top-memory-text'>记忆</Text>
          </View>
        </View>
      </View>

      {/* 品牌 Hero：情绪 slogan + 猫狗 IP 主视觉
          首页原本从品牌栏直接跳到消息流，缺少「这是谁的家」的情感锚点；
          这里用一句 slogan + 吉祥物补上，高度刻意克制，避免挤压消息列表 */}
      <View className='home-hero'>
        {/* 散落星点：既呼应「星河」品牌意象，也填掉 Hero 的空白感（绝对定位，不占布局） */}
        <Icon name='sparkle' size={18} tone='primary' className='home-hero__spark home-hero__spark--1' />
        <Icon name='sparkle' size={13} tone='primary' className='home-hero__spark home-hero__spark--2' />
        <Icon name='sparkle' size={16} tone='primary' className='home-hero__spark home-hero__spark--3' />
        <Icon name='sparkle' size={12} tone='primary' className='home-hero__spark home-hero__spark--4' />
        <Icon name='sparkle' size={14} tone='primary' className='home-hero__spark home-hero__spark--5' />
        <Icon name='sparkle' size={11} tone='primary' className='home-hero__spark home-hero__spark--6' />

        <View className='home-hero__slogan'>
          {/* 第一行：两侧大星星对称点缀 */}
          <View className='home-hero__line'>
            <Icon name='sparkle' size={20} tone='primary' className='home-hero__star' />
            <Text className='home-hero__line-text'>它的可爱</Text>
            <Icon name='sparkle' size={20} tone='primary' className='home-hero__star' />
          </View>
          {/* 第二行：落点在「星河」上，用主色点出呼应品牌名；行末再缀一颗 */}
          <View className='home-hero__line'>
            <Text className='home-hero__line-text'>
              要一颗一颗收进<Text className='home-hero__accent'>星河</Text>里
            </Text>
            <Icon name='sparkle' size={15} tone='primary' className='home-hero__star home-hero__star--end' />
          </View>
        </View>

        <Image className='home-hero__mascot' src={catDogHero} mode='aspectFit' />
      </View>

      {/* 多成员共同养宠：情侣引导横幅（有宠物但家庭仅自己时提示邀请 TA，2026-08-24） */}
      {showCoCareTip && petInfo.hasPet && familyUsers.length <= 1 && (
        <View className='home-co-care-tip' onClick={() => Taro.navigateTo({ url: '/pages/family/index' })}>
          <Icon name='users' size={15} tone='primary' className='home-co-care-tip__icon' />
          <Text className='home-co-care-tip__text'>邀请 TA 一起养宠，共同记录毛孩子的每一天</Text>
          <Text className='home-co-care-tip__close' onClick={(e) => { e.stopPropagation(); setShowCoCareTip(false) }}>✕</Text>
        </View>
      )}

      <ScrollView
        className='chat-msg-list'
        scrollY
        scrollWithAnimation
        ref={chat.scrollRef}
      >

        {/* 内层容器：scroll-view 上不支持 padding（webview 渲染模式），由内部元素承载间距 */}
        <View className='chat-msg-list__inner'>

        {/* ===== 长对话软提示（多会话：满 30 轮建议新建，不强制） ===== */}
        {showLongChatTip && (
          <View className='chat-long-tip' onClick={handleNewSession}>
            <Icon name='lightbulb' size={15} color='#a06a3f' className='chat-long-tip-icon' />
            <Text className='chat-long-tip-text'>当前对话已较长，新建对话 AI 会更记得住</Text>
            <Text className='chat-long-tip-action'>＋ 新建对话</Text>
          </View>
        )}

        {/* ===== 今日健康摘要卡（设计稿对齐） ===== */}
        <View className='home-summary-card' onClick={openCheckin}>
          <View className='home-summary-main'>
            <View className='home-summary-avatar'>
              {/* 头像走全站统一口径：真实照片 > AI 形象 > 按品种匹配的品牌小动物头像；
                  仅当图片加载失败时才退回物种 emoji（未设头像的新宠物也显示小动物头像） */}
              {homeAvatarUrl && !homeAvatarFailed ? (
                <Image
                  className='home-summary-avatar-img'
                  src={homeAvatarUrl}
                  mode='aspectFill'
                  lazyLoad
                  onError={() => setHomeAvatarFailed(true)}
                />
              ) : (
                <Text>{petInfo.emoji || '🐾'}</Text>
              )}
            </View>
            <View className='home-summary-info'>
              <Text className='home-summary-title'>今日健康摘要</Text>
              <View className='home-summary-stats'>
                <Text className='home-summary-stat'>
                  便便 <Text className='home-summary-stat-val home-summary-stat-val--coral'>{todayHealth ? `${todayHealth.poopLevel}/5` : '--'}</Text>
                </Text>
                <Text className='home-summary-stat'>
                  食欲 <Text className='home-summary-stat-val home-summary-stat-val--success'>{todayHealth ? APPETITE_LABEL[todayHealth.appetiteLevel] ?? '正常' : '--'}</Text>
                </Text>
                <Text className='home-summary-stat'>
                  精神 <Text className='home-summary-stat-val home-summary-stat-val--success'>{todayHealth ? SPIRIT_LABEL[todayHealth.spiritLevel] ?? '正常' : '--'}</Text>
                </Text>
              </View>
              <Text className='home-summary-hint'>
                {todayHealth
                  ? `上次打卡：今天 ${formatCheckinTime(todayHealth.createdAt)}`
                  : '👆 今天还没打卡，点击开始'}
              </Text>
            </View>
            <Text className='home-summary-go'>›</Text>
          </View>
        </View>

        {/* ===== 宠物的话（设计稿对齐） ===== */}
        <View className='home-pet-quote'>
          <Text className='home-pet-quote-icon'>✨</Text>
          <Text className='home-pet-quote-text'>{todayHealth ? '今天状态记录好啦，我很舒服～想出去玩！' : '今天也要元气满满哦！记得帮我打卡，我想出去玩～'}</Text>
          <Text className='home-pet-quote-author'>— {petInfo.name || '小可爱'}</Text>
        </View>

        {/* ===== 3秒健康打卡主按钮（设计稿对齐） ===== */}
        <View className='home-checkin-cta' onClick={openCheckin} hoverClass='home-checkin-cta--hover'>
          <View className='home-checkin-cta-left'>
            <View className='home-checkin-cta-icon'>
              <Icon name='paw-print' size={18} tone='primary' />
            </View>
            <View className='home-checkin-cta-texts'>
              <Text className='home-checkin-cta-title'>3秒健康打卡</Text>
              <Text className='home-checkin-cta-sub'>便便 · 食欲 · 精神 · 运动 · 体重</Text>
            </View>
          </View>
          <Text className='home-checkin-cta-arrow'>→</Text>
        </View>

        <View className='msg-row ai'>
          <View className='msg-avatar'>
            <AiAvatar imgClass='msg-avatar-img' emojiClass='msg-avatar-emoji' />
          </View>
          <View className='msg-bubble-wrap'>
            <View className='msg-bubble'>
              <Text>你好呀～我是团团，你的 AI 宠物管家🐾{'\n'}我可以帮你：<Text className='msg-bubble-highlight'>3秒健康打卡</Text>、<Text className='msg-bubble-highlight'>食物安全查询</Text>、<Text className='msg-bubble-highlight'>症状初筛</Text>、<Text className='msg-bubble-highlight'>疫苗日历</Text>、<Text className='msg-bubble-highlight'>时光记录</Text>。今天想做什么呢？</Text>
            </View>
            {showGreetingQuickActions && !symptomOpen && naming.namingStep < 0 && !food.foodActive && !memory.memoryActive && (
              <View className='msg-quick-actions'>
                {currentQuickActions.map(qa => (
                  <View key={qa.action} className='msg-quick-btn' onClick={() => handleQuickAction(qa.action)}>
                    <Icon name={qa.icon} size={14} tone='primary' />
                    <Text>{qa.label}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {chat.messages.map((msg, idx) => (
          <View key={msg.id} className={`msg-row ${msg.type}`}>
            <View className='msg-avatar'>
              {msg.type === 'ai' ? (
                <AiAvatar imgClass='msg-avatar-img' emojiClass='msg-avatar-emoji' />
              ) : (
                // 用户头像占位：原来用 😊 emoji，改用图标与 AI 头像（图片）保持体例一致
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

              {idx === chat.messages.length - 1 && msg.type === 'ai' && showGreetingQuickActions && !symptomOpen && naming.namingStep < 0 && !food.foodActive && !memory.memoryActive && (
                <View className='msg-quick-actions'>
                  {currentQuickActions.map(qa => (
                    <View key={qa.action} className='msg-quick-btn' onClick={() => handleQuickAction(qa.action)}>
                      <Icon name={qa.icon} size={14} tone='primary' />
                      <Text>{qa.label}</Text>
                    </View>
                  ))}
                </View>
              )}

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

              {/* 回忆流程 - 照片上传按钮 */}
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

        <View className='chat-bottom-spacer' />

        {/* ===== 快捷功能网格 3×2（设计稿对齐） ===== */}
        <View className='home-shortcuts'>
          <Text className='home-shortcuts-title'>快捷功能</Text>
          <View className='home-shortcuts-grid'>
            <View className='home-shortcut' onClick={() => food.handleFoodQuery()} hoverClass='home-shortcut--hover'>
              <View className='home-shortcut-icon home-shortcut-icon--coral'>
                {/* 食物碗：原先是放大镜，只表达“搜索”，看不出是查食物 */}
                <Icon name='bowl-food' size={18} tone='primary' />
              </View>
              <Text className='home-shortcut-label'>食物查询</Text>
              <Text className='home-shortcut-desc'>毛孩子能吃吗</Text>
            </View>
            <View className='home-shortcut' onClick={() => openSymptom()} hoverClass='home-shortcut--hover'>
              <View className='home-shortcut-icon home-shortcut-icon--gold'>
                {/* tone='gold-deep' 与宫格底色 rgba(var(--gold-deep-rgb),·) 同源，切换主题一起变 */}
                <Icon name='stethoscope' size={18} tone='gold-deep' />
              </View>
              <Text className='home-shortcut-label'>症状初筛</Text>
              <Text className='home-shortcut-desc'>不舒服先问问我</Text>
            </View>
            <View className='home-shortcut' onClick={() => Taro.navigateTo({ url: '/pagesPet/vaccine/index' })} hoverClass='home-shortcut--hover'>
              <View className='home-shortcut-icon home-shortcut-icon--sage'>
                <Icon name='syringe' size={18} tone='sage' />
              </View>
              <Text className='home-shortcut-label'>疫苗日历</Text>
              <Text className='home-shortcut-desc'>接种提醒不遗漏</Text>
            </View>
            <View className='home-shortcut' onClick={() => Taro.navigateTo({ url: '/pagesPet/trends/index' })} hoverClass='home-shortcut--hover'>
              <View className='home-shortcut-icon home-shortcut-icon--teal'>
                <Icon name='chart-line' size={18} tone='teal' />
              </View>
              <Text className='home-shortcut-label'>健康趋势</Text>
              <Text className='home-shortcut-desc'>看看成长变化</Text>
            </View>
            <View className='home-shortcut' onClick={() => Taro.navigateTo({ url: '/pagesPet/chronic-tracking/index' })} hoverClass='home-shortcut--hover'>
              <View className='home-shortcut-icon home-shortcut-icon--coral'>
                {/* 心跳：原先是 stethoscope，与「症状初筛」撞了同一个图标 */}
                <Icon name='heartbeat' size={18} tone='primary' />
                {chronicRiskCount > 0 && (
                  <View className='home-shortcut-badge'>
                    <Text className='home-shortcut-badge-text'>{chronicRiskCount}</Text>
                  </View>
                )}
              </View>
              <Text className='home-shortcut-label'>慢性病追踪</Text>
              <Text className='home-shortcut-desc'>自动扫描健康风险</Text>
            </View>
            <View className='home-shortcut' onClick={() => Taro.navigateTo({ url: '/pages/family/index' })} hoverClass='home-shortcut--hover'>
              <View className='home-shortcut-icon home-shortcut-icon--coral'>
                <Icon name='users' size={18} tone='primary' />
              </View>
              <Text className='home-shortcut-label'>宠物家庭</Text>
              <Text className='home-shortcut-desc'>一页看全家健康</Text>
            </View>
          </View>
        </View>
        </View>
      </ScrollView>

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

        {/* 待发送图片附件条（微信 IM 式）：选图后先在此预览，可补充文字/取消，点发送一起发出 */}
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
              // 非微信/插件未就绪时不允许切到语音模式（P1-2：避免"点击无反应"）
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

          {/* 文字模式：输入框 */}
          {inputMode === 'text' && (
            <Input
              className='chat-input-field'
              value={inputValue}
              onInput={(e) => setInputValue(e.detail.value)}
              onConfirm={handleSendWithSuggestions}
              onFocus={() => setPlusPanelOpen(false)}
              placeholder={naming.isTextInputActive && naming.currentStep?.placeholder
                ? naming.currentStep.placeholder
                : '说说宠物今天的情况...'}
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

          {/* + 按钮 / 发送按钮（有待发送附件时也显示发送） */}
          {inputValue.trim() || chat.pendingImage ? (
            <View className='wx-send-btn' onClick={handleSendWithSuggestions}>
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

      {/* 症状初筛弹窗卡片：全流程在卡内完成，完成后聊天流只追加一条结果消息 */}
      <SymptomCheckPopup
        open={symptomOpen}
        onClose={() => setSymptomOpen(false)}
        onComplete={handleSymptomComplete}
      />

      {/* 命理详情悬浮弹窗 */}
      {naming.namingDetailPopup && (
        <View className='naming-popup-overlay' onClick={naming.closeNamingDetail}>
          <View className='naming-popup-card' onClick={(e: any) => e.stopPropagation()}>
            {/* 关闭按钮 */}
            <View className='naming-popup-close' onClick={naming.closeNamingDetail}>
              <Text>✕</Text>
            </View>

            {/* 头部 */}
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
              {/* 八字命理 */}
              <View className='msg-naming-detail-section'>
                <View className='msg-naming-detail-section-title'>
                  <Text className='msg-naming-detail-icon'>☯</Text>
                  <Text>八字命理</Text>
                </View>
                <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.bazi}</Text>
              </View>

              {/* 整体运势 */}
              <View className='msg-naming-detail-section msg-naming-detail-section--fortune'>
                <View className='msg-naming-detail-section-title'>
                  <Icon name='star' size={14} tone='primary' className='msg-naming-detail-icon' />
                  <Text>整体运势</Text>
                </View>
                <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.fortune}</Text>
              </View>

              {/* 事业/生活运势 */}
              <View className='msg-naming-detail-section'>
                <View className='msg-naming-detail-section-title'>
                  <Icon name='star' size={14} tone='primary' className='msg-naming-detail-icon' />
                  <Text>事业/生活运势</Text>
                </View>
                <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.careerFortune}</Text>
              </View>

              {/* 感情/人际运势 */}
              <View className='msg-naming-detail-section'>
                <View className='msg-naming-detail-section-title'>
                  <Icon name='heart' size={14} tone='primary' className='msg-naming-detail-icon' />
                  <Text>感情/人际运势</Text>
                </View>
                <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.loveFortune}</Text>
              </View>

              {/* 健康运势 */}
              <View className='msg-naming-detail-section'>
                <View className='msg-naming-detail-section-title'>
                  <Icon name='clover' size={14} tone='primary' className='msg-naming-detail-icon' />
                  <Text>健康运势</Text>
                </View>
                <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.healthFortune}</Text>
              </View>

              {/* 性格特质 */}
              <View className='msg-naming-detail-section'>
                <View className='msg-naming-detail-section-title'>
                  <Icon name='mask-happy' size={14} tone='primary' className='msg-naming-detail-icon' />
                  <Text>性格特质</Text>
                </View>
                <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.personality}</Text>
              </View>

              {/* 笔画数理 */}
              <View className='msg-naming-detail-section'>
                <View className='msg-naming-detail-section-title'>
                  <Text className='msg-naming-detail-icon'>✍</Text>
                  <Text>笔画数理</Text>
                </View>
                <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.strokes}</Text>
              </View>

              {/* 吉祥三宝 */}
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

              {/* 与主人缘分 */}
              <View className='msg-naming-detail-section'>
                <View className='msg-naming-detail-section-title'>
                  <Icon name='handshake' size={14} tone='primary' className='msg-naming-detail-icon' />
                  <Text>与主人缘分</Text>
                </View>
                <Text className='msg-naming-detail-text'>{naming.namingDetailPopup.karmaWithOwner}</Text>
              </View>

              {/* 总结寄语 */}
              <View className='msg-naming-detail-section msg-naming-detail-section--summary'>
                <View className='msg-naming-detail-section-title'>
                  <Text className='msg-naming-detail-icon'>✨</Text>
                  <Text>总结寄语</Text>
                </View>
                <Text className='msg-naming-detail-text msg-naming-detail-text--summary'>{naming.namingDetailPopup.summary}</Text>
              </View>

              {/* 结果闭环：一键把名字写进宠物档案（2026-09-10）——此前用户看完名字还得
                  自己去宠物编辑页重新敲一遍 */}
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
