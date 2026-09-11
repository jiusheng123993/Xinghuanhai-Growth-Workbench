/**
 * 症状初筛页面
 * 宠物症状选择、AI分析、风险评级、就医建议
 */
import { View, Text } from '@tarojs/components'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { usePet } from '../../hooks/usePet'
import { useSymptom } from '../../hooks/useSymptom'
import { useMembership } from '../../hooks/useMembership'
import { useAuthStore } from '../../stores/authStore'
import { useShareStore } from '../../stores/shareStore'
import { safeNavigateBack } from '../../utils/navigation'
import PetSwitcher from '../../components/PetSwitcher'
import PaywallPopup from '../../components/PaywallPopup'
import AnxietyIntervention from '../../components/AnxietyIntervention'
import CrisisReferralCard from '../../components/CrisisReferralCard'
import { PageLoading, PageError, EmergencyAlert, Icon } from '../../components'
import { incrementSymptomCheckCount } from '../../utils/usageTracking'
import { useAnxietyDetection } from '../../hooks/useAnxietyDetection'
import { useEmotionTracking } from '../../hooks/useEmotionTracking'
import type { EmotionSeverity } from '../../services/emotionTrackingService'
import { useAnalytics, usePageView } from '../../hooks/useAnalytics'
import { AnalyticsEventName } from '../../types/analyticsTypes'
import type { UrgencyLevel } from '../../engines/petSafety/PetSafetyHandler'
import { getCrisisMessage } from '../../engines/emotion'
import { MedicalDisclaimer } from '../../engines/petSafety/MedicalDisclaimer'
import {
  aiDeepAnalyze,
  type SymptomItem,
  type AiDeepAnalysisResult,
} from '../../services/symptomService'
import { MEDICAL_GRAPH } from '../../data/petKnowledge/medicalGraph'
import { syncKnowledgeGraph, submitKnowledgeFeedback } from '../../services/knowledgeService'
import './index.scss'
import PageBackground from '../../components/PageBackground'

/** 原型常见症状（从后端症状库中按名称匹配展示） */
const COMMON_SYMPTOM_NAMES = ['呕吐', '腹泻', '食欲不振', '精神萎靡', '咳嗽', '打喷嚏', '体温升高', '便血', '抽搐', '呼吸困难']

const SYMPTOM_ICONS: Record<string, string> = {
  呕吐: '🤢',
  腹泻: '💧',
  食欲不振: '🍽️',
  精神萎靡: '😴',
  咳嗽: '💨',
  打喷嚏: '🤧',
  体温升高: '🌡️',
  便血: '🩸',
  抽搐: '⚡',
  呼吸困难: '🫁',
}

/** 紧急症状（照原型分级规则：命中即红） */
const URGENT_SYMPTOM_NAMES = new Set(['便血', '呼吸困难'])

/** 本地初步分级（照原型 JS 逻辑：1 项=观察 / 2 项=建议 / 3 项及以上或含急症症状=紧急） */
const LEVEL_CONFIG = [
  { key: 'observe', emoji: '🟢', name: '绿 · 观察', desc: '单一轻微症状，精神食欲正常', action: '→ 继续观察，明天打卡关注', color: '#2FC98E', bg: '47, 201, 142' },
  { key: 'watch', emoji: '🟡', name: '黄 · 建议', desc: '出现 2 项异常症状', action: '→ 建议关注，持续 2 天建议就医', color: '#FFB020', bg: '255, 176, 32' },
  { key: 'urgent', emoji: '🔴', name: '红 · 紧急', desc: '3 项及以上 · 便血 · 呼吸困难', action: '→ 建议立即就医', color: '#FF5A5F', bg: '255, 90, 95' },
]

const RISK_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  normal: { label: '状态良好', emoji: '✅', color: '#52C41A' },
  caution: { label: '注意观察', emoji: '💡', color: '#FAAD14' },
  warning: { label: '密切观察', emoji: '🔔', color: '#FF8C42' },
  emergency: { label: '立即就医', emoji: '🚨', color: '#FF4D4F' },
}

/** 置信度展示文案（由代码按依据推导，见 medicalGraph） */
const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

/** 结论依据徽标文案（rule=规则 / graph=图谱 / record=记录 / llm=AI推测） */
const BASIS_LABEL: Record<string, string> = {
  rule: '规则',
  graph: '图谱',
  record: '记录',
  llm: 'AI推测',
}

export default function PetSymptomCheck() {
  const { pets, currentPet, switchPet, isLoading: petLoading } = usePet()
  const {
    categories,
    selectedSymptoms,
    currentResult,
    isLoading: symptomLoading,
    error,
    fetchCategories,
    selectSymptom,
    deselectSymptom,
    analyzeSymptoms,
    clearSelection,
    clearError,
  } = useSymptom()
  const { isMember, checkAccess, shouldShowPaywall, markPaywallShown } = useMembership()
  const user = useAuthStore(s => s.user)
  const inviteCode = useShareStore(s => s.inviteCode)

  const [analyzing, setAnalyzing] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [paywallVisible, setPaywallVisible] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [showSymptomCrisisReferral, setShowSymptomCrisisReferral] = useState(false)
  // AI 深度分析（Phase 2，会员）：结果文案 + 记忆召回 + 加载态
  const [deepAdvice, setDeepAdvice] = useState('')
  const [deepMemories, setDeepMemories] = useState<AiDeepAnalysisResult['memoriesUsed']>([])
  const [deepLoading, setDeepLoading] = useState(false)
  const { anxietyState, checkSickAnxiety, dismissSickAnxiety } = useAnxietyDetection()
  const { showCrisisReferral, crisisSeverity, trackEvent: trackEmotion, dismissCrisisReferral, handleFollowUp } = useEmotionTracking(currentPet?.id || null)
  const { trackPageView, trackEvent } = useAnalytics()

  usePageView('symptom_check')

  const RISK_TO_URGENCY: Record<string, UrgencyLevel> = {
    normal: 'green',
    caution: 'yellow',
    warning: 'orange',
    emergency: 'red',
  }

  const disclaimerText = useMemo(() => {
    if (!currentResult) return new MedicalDisclaimer().getSymptomDisclaimer('green')
    return new MedicalDisclaimer().getSymptomDisclaimer(RISK_TO_URGENCY[currentResult.riskLevel] || 'green')
  }, [currentResult])

  useShareAppMessage(() => {
    return {
      title: currentResult
        ? `我家毛孩子的症状分析结果，快来看看！`
        : '星河宠记 - 宠物健康管家',
      path: `/pagesPet/symptom-check/index${inviteCode ? `?inviteCode=${inviteCode}` : ''}`,
    }
  })
  useShareTimeline(() => ({
    title: currentResult
      ? `我家毛孩子的症状分析结果`
      : '星河宠记 - 宠物健康管家',
    query: inviteCode ? `inviteCode=${inviteCode}` : '',
  }))

  const loadSymptomData = useCallback(async () => {
    setLoadError('')
    try {
      if (currentPet) {
        await fetchCategories(currentPet.species)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载失败，请重试')
    }
  }, [currentPet, fetchCategories])

  useEffect(() => {
    loadSymptomData()
  }, [loadSymptomData])

  // Phase 3：启动时同步服务端最新知识图谱（热更新；失败静默走静态兜底，不阻塞页面）
  useEffect(() => {
    syncKnowledgeGraph().catch(() => {})
  }, [])

  useEffect(() => {
    if (error) {
      Taro.showToast({ title: error, icon: 'none' })
      clearError()
    }
  }, [error, clearError])

  useEffect(() => {
    if (currentPet) {
      checkSickAnxiety(currentPet.id, currentPet.name)
    }
  }, [currentPet, checkSickAnxiety])

  /** 常见症状网格：从后端症状库按名称提取（匹配不到的自动跳过） */
  const commonSymptoms = useMemo(() => {
    const byName = new Map<string, SymptomItem>()
    for (const cat of categories) {
      for (const s of cat.symptoms) {
        byName.set(s.name, s)
      }
    }
    return COMMON_SYMPTOM_NAMES
      .map((name) => byName.get(name))
      .filter((s): s is SymptomItem => !!s)
  }, [categories])

  const allSymptoms = useMemo(() => categories.flatMap((c) => c.symptoms), [categories])

  /** 本地初步分级（照原型规则实时计算） */
  const localLevel = useMemo(() => {
    const selectedNames = selectedSymptoms
      .map((sid) => allSymptoms.find((s) => s.id === sid)?.name || '')
      .filter(Boolean)
    const count = selectedNames.length
    if (count === 0) return null
    const hasUrgent = selectedNames.some((n) => URGENT_SYMPTOM_NAMES.has(n))
    if (count >= 3 || hasUrgent) return 'urgent'
    if (count === 2) return 'watch'
    return 'observe'
  }, [selectedSymptoms, allSymptoms])

  const handleToggleSymptom = (symptomId: string) => {
    if (selectedSymptoms.includes(symptomId)) {
      deselectSymptom(symptomId)
    } else {
      selectSymptom(symptomId)
    }
  }

  const handleAnalyze = async () => {
    if (!currentPet) return
    if (selectedSymptoms.length === 0) {
      Taro.showToast({ title: '请至少选择一个症状', icon: 'none' })
      return
    }
    if (!isMember && user?.id) {
      const access = await checkAccess('symptom_check')
      if (!access.allowed) {
        const showPaywall = await shouldShowPaywall('symptom_check')
        if (showPaywall) {
          await markPaywallShown('symptom_check')
          trackEvent('show_paywall', { feature: 'symptom_check' })
          setPaywallVisible(true)
        } else {
          Taro.navigateTo({ url: '/pagesUser/member/index' })
        }
        return
      }
    }
    setAnalyzing(true)
    try {
      const result = await analyzeSymptoms(
        currentPet.id,
        {
          duration: 'today',
          frequency: 'occasional',
          severity: 'mild',
          appetite: 'normal',
          energy: 'normal',
          otherNotes: undefined,
        },
        currentPet
      )
      incrementSymptomCheckCount()
      setShowResult(true)
      const riskToSeverity: Record<string, EmotionSeverity> = {
        normal: 'mild',
        caution: 'mild',
        warning: 'moderate',
        emergency: 'severe',
      }
      trackEmotion('symptom_check', riskToSeverity[result.riskLevel] || 'mild')
      trackEvent(AnalyticsEventName.SymptomCheck, {
        petId: currentPet.id,
        symptoms: selectedSymptoms,
        urgencyLevel: RISK_TO_URGENCY[result.riskLevel] || 'green',
      })
      if (result.riskLevel === 'emergency') {
        setShowSymptomCrisisReferral(true)
      }
    } catch {
      Taro.showToast({ title: '分析失败，请重试', icon: 'none' })
    } finally {
      setAnalyzing(false)
    }
  }

  /**
   * 会员 AI 深度分析（Phase 2）
   * 基于本地初筛结论调用服务端：注入宠物档案 + 近7天打卡 + 记忆闸门召回后由 LLM 组织话术
   * 前端会员门仅为体验（服务端另有强制校验，非会员 403）
   */
  const handleDeepAnalyze = async () => {
    if (!currentPet || !currentResult) return
    if (!isMember) {
      const showPaywall = await shouldShowPaywall('symptom_check')
      if (showPaywall) {
        await markPaywallShown('symptom_check')
        setPaywallVisible(true)
      } else {
        Taro.navigateTo({ url: '/pagesUser/member/index' })
      }
      return
    }
    setDeepLoading(true)
    try {
      // 症状 ID → 中文名（供服务端记忆召回与 prompt）
      const symptomNames = currentResult.symptoms.map((id) => {
        const entity = MEDICAL_GRAPH.symptoms.find((s) => s.id === id)
        return entity ? entity.name : id
      })
      const result = await aiDeepAnalyze(currentPet.id, {
        symptoms: currentResult.symptoms,
        symptomNames,
        riskLevel: currentResult.riskLevel,
        possibleConditions: currentResult.possibleConditions,
        conclusions: currentResult.conclusions || [],
        duration: currentResult.additionalInfo?.duration,
        severity: currentResult.additionalInfo?.severity,
      })
      setDeepAdvice(result.aiAdvice)
      setDeepMemories(result.memoriesUsed || [])
      trackEvent('symptom_deep_analyze', { petId: currentPet.id, riskLevel: currentResult.riskLevel })
    } catch {
      Taro.showToast({ title: '深度分析失败，请重试', icon: 'none' })
    } finally {
      setDeepLoading(false)
    }
  }

  /**
   * 用户纠错反馈（Phase 3）：对当前分析结果提出异议 → 进 knowledge_feedback 表，管理后台人工审核
   */
  const handleFeedback = () => {
    if (!currentResult) return
    // Taro 3.6 类型未声明 editable/content，做类型收窄（运行时微信支持可编辑弹窗）
    const modalOptions = {
      title: '反馈问题',
      editable: true,
      placeholderText: '请描述你认为有误的地方（如排查方向、风险等级、建议）',
      confirmText: '提交',
      success: async (res: { confirm?: boolean; content?: string }) => {
        if (res.confirm && res.content) {
          try {
            await submitKnowledgeFeedback({
              entityType: 'other',
              entityName: `风险等级 ${currentResult.riskLevel} 的分析结果`,
              suggestion: res.content,
              checkId: currentResult.id,
              petId: currentPet?.id,
            })
            Taro.showToast({ title: '已收到反馈，感谢！', icon: 'success' })
          } catch {
            Taro.showToast({ title: '提交失败，请重试', icon: 'none' })
          }
        }
      },
    } as unknown as Parameters<typeof Taro.showModal>[0]
    Taro.showModal(modalOptions)
  }

  const handleReset = () => {
    clearSelection()
    setShowResult(false)
    setDeepAdvice('')
    setDeepMemories([])
  }

  const isLoading = petLoading || symptomLoading

  if (isLoading && pets.length === 0) {
    return (
      <View className='pet-symptom-check'>
        <PageLoading />
      </View>
    )
  }

  if (loadError && pets.length === 0) {
    return (
      <View className='pet-symptom-check'>
        <PageError message={loadError} onRetry={loadSymptomData} />
      </View>
    )
  }

  return (
    <View className='pet-symptom-check'>
      {/* 全小程序统一动态背景层 */}
      <PageBackground />

      <PetSwitcher
        pets={pets}
        currentPetId={currentPet?.id || null}
        onSwitch={switchPet}
      />

      {!currentPet ? (
        <View className='pet-symptom-check__empty'>
          <Icon name='paw-print' size={48} tone='primary' className='pet-symptom-check__empty-icon' />
          <Text className='pet-symptom-check__empty-text'>请先添加宠物</Text>
        </View>
      ) : (
        <View className='pet-symptom-check__content'>
          {/* ===== 宠物信息条 ===== */}
          <View className='pet-symptom-check__pet-bar'>
            <View className='pet-symptom-check__pet-bar-avatar'>
              <Icon name='paw-print' size={24} tone='primary' className='pet-symptom-check__pet-bar-icon' />
            </View>
            <View className='pet-symptom-check__pet-bar-info'>
              <Text className='pet-symptom-check__pet-bar-name'>
                {currentPet.name}{currentPet.breed ? ` · ${currentPet.breed}` : ''}
              </Text>
              <Text className='pet-symptom-check__pet-bar-desc'>在线症状初筛 · 健康分诊</Text>
            </View>
            <View className='pet-symptom-check__pet-bar-badge'>
              <Text className='pet-symptom-check__pet-bar-badge-icon'>✨</Text>
              <Text className='pet-symptom-check__pet-bar-badge-text'>AI 初筛</Text>
            </View>
          </View>

          {/* ===== 多选症状卡 ===== */}
          <View className='pet-symptom-check__card'>
            <View className='pet-symptom-check__card-head'>
              <View className='pet-symptom-check__card-head-left'>
                <View className='pet-symptom-check__card-title-row'>
                  <View className='pet-symptom-check__card-title-bar' />
                  <Text className='pet-symptom-check__card-title'>
                    选择{currentPet.name}出现的症状
                    <Text className='pet-symptom-check__card-title-sub'>（可多选）</Text>
                  </Text>
                </View>
                <Text className='pet-symptom-check__card-hint'>按实际情况勾选，AI 将自动分级</Text>
              </View>
              <View className='pet-symptom-check__card-chip'>已选 {selectedSymptoms.length} 项</View>
            </View>
            <View className='pet-symptom-check__symptom-grid'>
              {commonSymptoms.map((s) => {
                const isSelected = selectedSymptoms.includes(s.id)
                return (
                  <View
                    key={s.id}
                    className={`pet-symptom-check__sym-btn${
                      isSelected ? ' pet-symptom-check__sym-btn--selected' : ''
                    }`}
                    onClick={() => handleToggleSymptom(s.id)}
                  >
                    <Text className='pet-symptom-check__sym-btn-icon'>
                      {SYMPTOM_ICONS[s.name] || '🐾'}
                    </Text>
                    <Text className='pet-symptom-check__sym-btn-label'>{s.name}</Text>
                  </View>
                )
              })}
            </View>
          </View>

          {/* ===== AI 初步评估卡（本地分级，照原型规则） ===== */}
          <View className='pet-symptom-check__card'>
            <View className='pet-symptom-check__subhead'>
              <View className='pet-symptom-check__subhead-icon pet-symptom-check__subhead-icon--gold'>
                <Text className='pet-symptom-check__subhead-icon-text'>🧠</Text>
              </View>
              <View className='pet-symptom-check__subhead-info'>
                <Text className='pet-symptom-check__subhead-title'>AI 初步评估</Text>
                <Text className='pet-symptom-check__subhead-desc'>根据所选症状数量自动分级</Text>
              </View>
            </View>
            <View className='pet-symptom-check__levels'>
              {LEVEL_CONFIG.map((lv) => {
                const active = localLevel === lv.key
                return (
                  <View
                    key={lv.key}
                    className={`pet-symptom-check__level${active ? ' pet-symptom-check__level--active' : ''}`}
                    style={{
                      borderColor: active ? lv.color : 'transparent',
                      background: active ? `rgba(${lv.bg}, 0.09)` : 'transparent',
                    }}
                  >
                    <View
                      className='pet-symptom-check__level-icon'
                      style={{ backgroundColor: active ? lv.color : `rgba(${lv.bg}, 0.16)`, color: active ? '#FFFFFF' : lv.color }}
                    >
                      <Text className='pet-symptom-check__level-icon-text'>{lv.emoji}</Text>
                    </View>
                    <View className='pet-symptom-check__level-info'>
                      <Text className='pet-symptom-check__level-name' style={{ color: active ? lv.color : undefined }}>
                        {lv.name}
                      </Text>
                      <Text className='pet-symptom-check__level-desc'>{lv.desc}</Text>
                      <Text className='pet-symptom-check__level-action' style={{ color: active ? lv.color : undefined }}>
                        {lv.action}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </View>
          </View>

          {/* ===== 开始 AI 深度分析按钮 ===== */}
          {!showResult && (
            <View
              className={`pet-symptom-check__analyze-btn${
                selectedSymptoms.length === 0 ? ' pet-symptom-check__analyze-btn--disabled' : ''
              }`}
              onClick={handleAnalyze}
            >
              <Text className='pet-symptom-check__analyze-btn-icon'>✨</Text>
              <Text className='pet-symptom-check__analyze-btn-text'>开始 AI 深度分析</Text>
            </View>
          )}

          {/* ===== AI 分析结果（真实后端数据） ===== */}
          {showResult && currentResult && (
            <View
              className={`pet-symptom-check__result pet-symptom-check__result--${currentResult.riskLevel}`}
            >
              <View className='pet-symptom-check__result-header'>
                <Text className='pet-symptom-check__result-emoji'>
                  {RISK_CONFIG[currentResult.riskLevel]?.emoji || '✅'}
                </Text>
                <Text className='pet-symptom-check__result-level'>
                  {RISK_CONFIG[currentResult.riskLevel]?.label || '未知'}
                </Text>
              </View>
              <View className='pet-symptom-check__result-advice'>
                <Text className='pet-symptom-check__result-advice-text'>
                  {currentResult.aiAdvice}
                </Text>
              </View>

              {/* ===== 置信度与依据（Phase 1：整体置信度 + 每条结论带依据徽标） ===== */}
              {currentResult.conclusions && currentResult.conclusions.length > 0 && (
                <View className='pet-symptom-check__confidence'>
                  <View className='pet-symptom-check__confidence-head'>
                    <Text className='pet-symptom-check__confidence-title'>分析置信度</Text>
                    <Text className={`pet-symptom-check__confidence-badge pet-symptom-check__confidence-badge--${currentResult.confidence || 'low'}`}>
                      {CONFIDENCE_LABEL[currentResult.confidence || 'low']}
                    </Text>
                  </View>
                  {currentResult.conclusions.map((conclusion, index) => (
                    <View key={index} className='pet-symptom-check__conclusion'>
                      <Text className='pet-symptom-check__conclusion-text'>{conclusion.text}</Text>
                      <Text className={`pet-symptom-check__conclusion-basis pet-symptom-check__conclusion-basis--${conclusion.basis}`}>
                        {BASIS_LABEL[conclusion.basis] || conclusion.basis}
                        {conclusion.confidence === 'low' ? ' 🤖' : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* ===== AI 深度分析（Phase 2，会员专属：记忆召回 + LLM 话术） ===== */}
              <View className='pet-symptom-check__deep'>
                {deepAdvice ? (
                  <>
                    <View className='pet-symptom-check__deep-head'>
                      <Text className='pet-symptom-check__deep-title'>🧠 AI 深度分析</Text>
                    </View>
                    <Text className='pet-symptom-check__deep-advice'>{deepAdvice}</Text>
                    {deepMemories.length > 0 && (
                      <View className='pet-symptom-check__deep-memories'>
                        <Text className='pet-symptom-check__deep-memories-title'>📋 记忆里的它</Text>
                        {deepMemories.map((m, index) => (
                          <Text key={index} className='pet-symptom-check__deep-memory'>
                            {m.content}
                          </Text>
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <View
                    className={`pet-symptom-check__deep-btn${
                      deepLoading ? ' pet-symptom-check__deep-btn--loading' : ''
                    }`}
                    onClick={handleDeepAnalyze}
                  >
                    <Text className='pet-symptom-check__deep-btn-text'>
                      {deepLoading
                        ? '⏳ AI 分析中...'
                        : isMember
                          ? '✨ 开启 AI 深度分析'
                          : '🔒 会员专享 · AI 深度分析'}
                    </Text>
                  </View>
                )}
              </View>

              {currentResult.possibleConditions.length > 0 && (
                <View className='pet-symptom-check__result-section'>
                  <Text className='pet-symptom-check__result-section-title'>🔬 可能相关</Text>
                  <View className='pet-symptom-check__result-tags'>
                    {currentResult.possibleConditions.map((condition) => (
                      <Text key={condition} className='pet-symptom-check__result-tag'>
                        {condition}
                      </Text>
                    ))}
                  </View>
                </View>
              )}

              {currentResult.recommendedActions.length > 0 && (
                <View className='pet-symptom-check__result-section'>
                  <Text className='pet-symptom-check__result-section-title'>📋 建议行动</Text>
                  <View className='pet-symptom-check__result-actions'>
                    {currentResult.recommendedActions.map((action, index) => (
                      <View key={index} className='pet-symptom-check__result-action'>
                        <Text className='pet-symptom-check__result-action-num'>{index + 1}</Text>
                        <Text className='pet-symptom-check__result-action-text'>{action}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View className='pet-symptom-check__result-disclaimer'>
                <Text className='pet-symptom-check__result-disclaimer-text'>
                  ⚠️ {disclaimerText}
                </Text>
              </View>

              {/* Phase 3：纠错入口（反馈进知识库审核流程，人工核查后热更新） */}
              <View className='pet-symptom-check__feedback' onClick={handleFeedback}>
                <Text className='pet-symptom-check__feedback-text'>📮 认为结果有误？点此反馈</Text>
              </View>

              <View className='pet-symptom-check__result-actions-bar'>
                {(currentResult.riskLevel === 'warning' || currentResult.riskLevel === 'emergency') && (
                  <View
                    className='pet-symptom-check__btn pet-symptom-check__btn--hospital'
                    onClick={() => {
                      trackEvent(AnalyticsEventName.FindHospital, { petId: currentPet?.id || '', urgencyLevel: RISK_TO_URGENCY[currentResult?.riskLevel || ''] || 'green', source: 'symptom_check' })
                      Taro.navigateTo({ url: '/pagesPet/hospital/index' })
                    }}
                  >
                    <Text className='pet-symptom-check__btn-text pet-symptom-check__btn-text--white'>🏥 找医院</Text>
                  </View>
                )}
                <View className='pet-symptom-check__btn pet-symptom-check__btn--outline' onClick={handleReset}>
                  <Text className='pet-symptom-check__btn-text'>重新检查</Text>
                </View>
                <View
                  className='pet-symptom-check__btn pet-symptom-check__btn--primary'
                  onClick={() => {
                    safeNavigateBack()
                  }}
                >
                  <Text className='pet-symptom-check__btn-text pet-symptom-check__btn-text--white'>完成</Text>
                </View>
              </View>
            </View>
          )}

          {/* ===== 就医建议卡 ===== */}
          <View className='pet-symptom-check__card'>
            <View className='pet-symptom-check__subhead'>
              <View className='pet-symptom-check__subhead-icon pet-symptom-check__subhead-icon--coral'>
                <Icon name='stethoscope' size={20} tone='primary' className='pet-symptom-check__subhead-icon-text' />
              </View>
              <View className='pet-symptom-check__subhead-info'>
                <Text className='pet-symptom-check__subhead-title'>就医建议</Text>
                <Text className='pet-symptom-check__subhead-desc'>就诊前的准备小贴士</Text>
              </View>
            </View>
            <View className='pet-symptom-check__tips-grid'>
              <View
                className='pet-symptom-check__tip-item'
                onClick={() => {
                  trackEvent(AnalyticsEventName.FindHospital, { petId: currentPet.id, source: 'symptom_tip' })
                  Taro.navigateTo({ url: '/pagesPet/hospital/index' })
                }}
              >
                <Icon name='map-pin' size={20} tone='primary' className='pet-symptom-check__tip-icon pet-symptom-check__tip-icon--coral' />
                <Text className='pet-symptom-check__tip-label'>医院导航</Text>
              </View>
              <View className='pet-symptom-check__tip-item'>
                <Text className='pet-symptom-check__tip-icon pet-symptom-check__tip-icon--gold'>📞</Text>
                <Text className='pet-symptom-check__tip-label'>电话咨询</Text>
              </View>
              <View className='pet-symptom-check__tip-item'>
                <Icon name='clipboard-text' size={20} tone='primary' className='pet-symptom-check__tip-icon pet-symptom-check__tip-icon--green' />
                <Text className='pet-symptom-check__tip-label'>带记录见医生</Text>
              </View>
            </View>
            <View className='pet-symptom-check__tip-note'>
              <Icon name='lightbulb' size={14} tone='primary' className='pet-symptom-check__tip-note-icon' />
              <Text className='pet-symptom-check__tip-note-text'>就诊时带上近14天打卡记录与症状描述</Text>
            </View>
          </View>

          {/* ===== 免责声明 ===== */}
          <Text className='pet-symptom-check__disclaimer'>本工具为健康分诊参考，不能替代兽医诊断与处方</Text>
        </View>
      )}

      {/* 分析中浮层 */}
      {analyzing && (
        <View className='pet-symptom-check__analyzing'>
          <View className='pet-symptom-check__analyzing-pulse'>
            <View className='pet-symptom-check__analyzing-ring' />
            <View className='pet-symptom-check__analyzing-ring pet-symptom-check__analyzing-ring--inner' />
            <Icon name='magnifying-glass' size={28} tone='primary' className='pet-symptom-check__analyzing-icon' />
          </View>
          <Text className='pet-symptom-check__analyzing-title'>AI正在分析中...</Text>
          <Text className='pet-symptom-check__analyzing-desc'>
            正在综合评估{currentPet?.name || ''}的症状信息
          </Text>
          <View className='pet-symptom-check__analyzing-dots'>
            <View className='pet-symptom-check__analyzing-dot' />
            <View className='pet-symptom-check__analyzing-dot' />
            <View className='pet-symptom-check__analyzing-dot' />
          </View>
        </View>
      )}

      <PaywallPopup
        visible={paywallVisible}
        featureName='AI症状初筛'
        remainingFree={0}
        onUpgrade={() => { setPaywallVisible(false); Taro.navigateTo({ url: '/pagesUser/member/index' }) }}
        onClose={() => setPaywallVisible(false)}
      />

      <EmergencyAlert
        visible={showResult && !!currentResult && currentResult.riskLevel === 'emergency'}
        title='紧急症状预警'
        message={currentResult?.aiAdvice || '检测到紧急症状信号，建议立即联系宠物医院进行专业诊断。'}
        showSymptomButton={false}
        showFoodButton={false}
        petId={currentPet?.id || ''}
        symptoms={selectedSymptoms}
        alertType='symptom_emergency'
        onClose={() => {}}
      />

      {anxietyState.showSickAnxiety && anxietyState.sickAnxietyContext && currentPet && (
        <AnxietyIntervention
          type='sick_anxiety'
          context={anxietyState.sickAnxietyContext}
          petName={currentPet.name}
          species={currentPet.species as 'dog' | 'cat'}
          petId={currentPet.id}
          onDismiss={dismissSickAnxiety}
          onCrisisReferral={() => { dismissSickAnxiety() }}
        />
      )}

      {showCrisisReferral && (
        <CrisisReferralCard
          message='我们注意到你最近频繁关注毛孩子的健康状况，持续焦虑可能影响你的判断和状态。'
          severity={crisisSeverity}
          onDismiss={dismissCrisisReferral}
          onFollowUp={handleFollowUp}
        />
      )}

      {showSymptomCrisisReferral && (
        <CrisisReferralCard
          message={getCrisisMessage('sick_anxiety', 'severe')}
          severity='severe'
          triggerSource='symptom_emergency'
          onDismiss={() => setShowSymptomCrisisReferral(false)}
          onFollowUp={handleFollowUp}
        />
      )}
    </View>
  )
}
