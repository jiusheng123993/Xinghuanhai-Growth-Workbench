/**
 * 健康打卡页面
 * 宠物日常健康数据记录（食欲、精力、便便、运动、体重）
 */
import { View, Text, Input, Textarea } from '@tarojs/components'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { useAuthStore } from '../../stores/authStore'
import { useShareStore } from '../../stores/shareStore'
import { usePet } from '../../hooks/usePet'
import { useCheckin } from '../../hooks/useCheckin'
import PetSwitcher from '../../components/PetSwitcher'
import { PageLoading, PageError, PetAvatar, AchievementCard, AchievementShareCard, EmergencyAlert, CarePlanCard, Icon, emojiToIcon } from '../../components'
import type { FillIconName } from '../../components/Icon'
import CrisisReferralCard from '../../components/CrisisReferralCard'
import { useSubscribeStore } from '../../stores/subscribeStore'
import { useCheckinStore } from '../../stores/checkinStore'
import { getTodayCheckin, batchCreateCheckins, type CheckinInput } from '../../services/checkinService'
import { checkAllAchievements } from '../../services/achievementService'
import { useEmotionTracking } from '../../hooks/useEmotionTracking'
import type { EmotionSeverity } from '../../services/emotionTrackingService'
import { generateDiaryForToday, type DiaryEntry } from '../../engines/petAvatar/diaryEngine'
import type { ExpressionContext } from '../../engines/petAvatar'
import type { AchievementConfig } from '../../components/AchievementCard'
import { getCrisisMessage } from '../../engines/emotion'
import { MedicalDisclaimer } from '../../engines/petSafety/MedicalDisclaimer'
import { updateLastCheckinDate } from '../../services/churnDetectionService'
import { MilestoneAdapter } from '../../memory-body/adapters/milestoneAdapter'
import { useAnalytics, usePageView } from '../../hooks/useAnalytics'
import { AnalyticsEventName } from '../../types/analyticsTypes'
import { EVENT } from '../../constants/analyticsEvents'
import { getActiveBreeds } from '../../data/petKnowledge/breeds'
import type { Checkin } from '../../types'
import './index.scss'
import PageBackground from '../../components/PageBackground'

export const APPETITE_OPTIONS = [
  { value: 3 as const, emoji: '😋', label: '正常' },
  { value: 2 as const, emoji: '😐', label: '少吃' },
  { value: 4 as const, emoji: '🍽️', label: '多吃' },
  { value: 1 as const, emoji: '😷', label: '不吃' },
  { value: 5 as const, emoji: '🤮', label: '呕吐' },
]

export const SPIRIT_OPTIONS = [
  { value: 3 as const, emoji: '⚡', label: '正常' },
  { value: 2 as const, emoji: '😴', label: '安静' },
  { value: 4 as const, emoji: '😊', label: '兴奋' },
  { value: 5 as const, emoji: '🤪', label: '亢奋' },
  { value: 1 as const, emoji: '😞', label: '萎靡' },
]

export const POOP_OPTIONS = [
  { value: 3 as const, emoji: '💩', label: '正常' },
  { value: 4 as const, emoji: '🟤', label: '偏软' },
  { value: 2 as const, emoji: '💧', label: '腹泻' },
  { value: 5 as const, emoji: '🪨', label: '便秘' },
  { value: 1 as const, emoji: '🩸', label: '带血' },
]

export const EXERCISE_OPTIONS = [
  { value: 2 as const, emoji: '🏃', label: '正常' },
  { value: 1 as const, emoji: '🛋️', label: '少' },
  { value: 3 as const, emoji: '🏋️', label: '多' },
]

/** 快捷体重预设（kg）—— 按宠物体型分组 */
const WEIGHT_PRESETS = [
  { label: '小型', weights: ['2.5', '3.0', '4.0', '5.0'] },
  { label: '中型', weights: ['8.0', '10.0', '12.0', '15.0'] },
  { label: '大型', weights: ['20.0', '25.0', '30.0', '35.0'] },
]

const APPETITE_LABELS: Record<number, string> = { 1: '不吃', 2: '少吃', 3: '正常', 4: '多吃', 5: '呕吐' }
const SPIRIT_LABELS: Record<number, string> = { 1: '萎靡', 2: '安静', 3: '正常', 4: '兴奋', 5: '亢奋' }
const POOP_LABELS: Record<number, string> = { 1: '带血', 2: '腹泻', 3: '正常', 4: '偏软', 5: '便秘' }
const EXERCISE_LABELS: Record<number, string> = { 1: '少', 2: '正常', 3: '多' }
const APPETITE_EMOJIS: Record<number, string> = { 1: '😷', 2: '😐', 3: '😋', 4: '🍽️', 5: '🤮' }
const SPIRIT_EMOJIS: Record<number, string> = { 1: '😞', 2: '😴', 3: '⚡', 4: '😊', 5: '🤪' }
const POOP_EMOJIS: Record<number, string> = { 1: '🩸', 2: '💧', 3: '💩', 4: '🟤', 5: '🪨' }
const EXERCISE_EMOJIS: Record<number, string> = { 1: '🛋️', 2: '🏃', 3: '🏋️' }

const RESULT_LABELS: Record<string, string> = {
  low: '状态良好',
  medium: '注意观察',
  high: '密切观察',
  emergency: '立即就医',
}

/**
 * 打卡结果的状态图标（面性图标名）
 *
 * 原来这里是 emoji（✅/💡/🔔/⚠️）。按 emojiIconMap 的取舍原则，状态提示属"功能性"位置
 * （要能随主题换色、字形统一），改成 Icon；情绪类 emoji（日记里的表情等）保持不动。
 */
const RESULT_ICON_NAMES: Record<string, FillIconName> = {
  low: 'check-circle',
  medium: 'lightbulb',
  high: 'bell',
  emergency: 'warning',
}

const MOOD_DISPLAY: Record<string, { emoji: string; label: string }> = {
  happy: { emoji: '😊', label: '开心' },
  normal: { emoji: '⚡', label: '正常' },
  sad: { emoji: '😞', label: '萎靡' },
}

const APPETITE_DISPLAY: Record<string, { emoji: string; label: string }> = {
  good: { emoji: '🍽️', label: '好' },
  normal: { emoji: '😋', label: '正常' },
  poor: { emoji: '😷', label: '差' },
}

const STOOL_DISPLAY: Record<string, { emoji: string; label: string }> = {
  normal: { emoji: '💩', label: '正常' },
  loose: { emoji: '💧', label: '腹泻' },
  hard: { emoji: '🪨', label: '便秘' },
}

export function mapAppetiteLevel(level: number): Checkin['appetite'] {
  if (level <= 2) return 'poor'
  if (level === 3) return 'normal'
  return 'good'
}

export function mapSpiritLevel(level: number): Checkin['mood'] {
  if (level <= 2) return 'sad'
  if (level === 3) return 'normal'
  return 'happy'
}

export function mapPoopLevel(level: number): Checkin['stool'] {
  if (level <= 2) return 'loose'
  if (level === 3) return 'normal'
  return 'hard'
}

export function computeRiskLevel(mood: Checkin['mood'], appetite: Checkin['appetite'], stool: Checkin['stool']): string {
  if (stool === 'loose' && appetite === 'poor' && mood === 'sad') return 'emergency'
  if (appetite === 'poor' && mood === 'sad') return 'high'
  if (stool === 'loose' || appetite === 'poor' || mood === 'sad') return 'medium'
  return 'low'
}

export function computeAnomalyItems(mood: Checkin['mood'], appetite: Checkin['appetite'], stool: Checkin['stool']): string[] {
  const items: string[] = []
  if (mood === 'sad') items.push('spirit')
  if (appetite === 'poor') items.push('appetite')
  if (stool !== 'normal') items.push('poop')
  return items
}

export function computeHasAnomaly(mood: Checkin['mood'], appetite: Checkin['appetite'], stool: Checkin['stool']): boolean {
  return mood === 'sad' || appetite === 'poor' || stool !== 'normal'
}

/**
 * 已打卡结果里的一个标签（食欲 / 精力 / 便便 / 体重）
 *
 * 图标口径与全站一致：emojiIconMap 里收录的"功能性" emoji（🍽️→bowl-food、⚡→lightning、
 * 💧→drop）换成面性 Icon；未收录的情绪类（😊/😋/😷/💩…）保留 emoji ——
 * 同一屏内便签头部已经用 Icon，标签再混一套 emoji 会显得是两套体系（审查 P2-6）。
 *
 * @param emoji 原始 emoji（可选：体重标签没有）
 * @param text  标签文本（形如「食欲：正常」）
 */
function ResultTag({ emoji, text }: { emoji?: string; text: string }) {
  const iconName = emoji ? emojiToIcon(emoji) : null
  return (
    <View className='pet-checkin__result-tag'>
      {iconName ? (
        <Icon name={iconName} size={13} tone='primary' />
      ) : emoji ? (
        <Text className='pet-checkin__result-tag-emoji'>{emoji}</Text>
      ) : null}
      <Text className='pet-checkin__result-tag-text'>{text}</Text>
    </View>
  )
}

export default function PetCheckin() {
  const themeClass = useThemeClass()
  const { pets, currentPet, switchPet, isLoading: petLoading } = usePet()
  const { checkins, todayCheckin, streakDays, isLoading: checkinLoading, initUser, doCheckin, fetchCheckins } = useCheckin()
  const userId = useAuthStore(s => s.user?.id) || ''
  const inviteCode = useShareStore(s => s.inviteCode)

  useShareAppMessage(() => ({
    title: '星河宠记 - 宠物健康打卡',
    path: `/pagesPet/checkin/index${inviteCode ? `?inviteCode=${inviteCode}` : ''}`,
  }))
  useShareTimeline(() => ({
    title: '星河宠记 - 宠物健康打卡',
    query: inviteCode ? `inviteCode=${inviteCode}` : '',
  }))

  const [formData, setFormData] = useState({
    appetiteLevel: 3 as 1 | 2 | 3 | 4 | 5,
    spiritLevel: 3 as 1 | 2 | 3 | 4 | 5,
    poopLevel: 3 as 1 | 2 | 3 | 4 | 5,
    exerciseLevel: 2 as 1 | 2 | 3,
    weight: undefined as number | undefined,
    notes: '',
  })

  const [weightText, setWeightText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [achievement, setAchievement] = useState<AchievementConfig | null>(null)
  const [showAchievementShare, setShowAchievementShare] = useState(false)
  const [feedbackResult, setFeedbackResult] = useState<{ riskLevel: string; feedback: string; anomalyItems?: string[] } | null>(null)
  const [diaryEntry, setDiaryEntry] = useState<DiaryEntry | null>(null)
  const [showCarePlan, setShowCarePlan] = useState(false)
  const [showCheckinCrisisReferral, setShowCheckinCrisisReferral] = useState(false)
  const { trackPageView, trackEvent } = useAnalytics()
  const { showCrisisReferral, crisisSeverity, trackEvent: trackEmotion, dismissCrisisReferral, handleFollowUp } = useEmotionTracking(currentPet?.id || null)

  // 多宠快捷打卡：记录今天已打卡的宠物 ID，用于一键给未打卡宠物批量打卡
  const [checkedTodayIds, setCheckedTodayIds] = useState<string[]>([])
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  // 尚未打卡的宠物列表（多宠场景展示用）
  const uncheckedPets = useMemo(
    () => pets.filter(p => !checkedTodayIds.includes(p.id)),
    [pets, checkedTodayIds],
  )

  const isAccepted = useSubscribeStore((s) => s.isAccepted)
  const requestAll = useSubscribeStore((s) => s.requestAll)

  const loadCheckinData = useCallback(async () => {
    setError('')
    try {
      if (userId) {
        await initUser(userId)
      }
      if (currentPet) {
        await fetchCheckins(currentPet.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败，请重试')
    }
  }, [userId, currentPet, initUser, fetchCheckins])

  useEffect(() => {
    trackPageView('checkin')
  }, [])

  useEffect(() => {
    loadCheckinData()
  }, [loadCheckinData])

  // 进入页面时并行查询所有宠物今日是否已打卡，供多宠快捷打卡使用
  useEffect(() => {
    if (!userId || pets.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const ids = await Promise.all(
          pets.map(async p => ((await getTodayCheckin(p.id, userId)) ? p.id : null)),
        )
        if (!cancelled) setCheckedTodayIds(ids.filter((id): id is string => id !== null))
      } catch {
        // 查询失败不阻塞主流程，快捷打卡区会按“未打卡”展示
      }
    })()
    return () => { cancelled = true }
  }, [userId, pets])

  const calculateConsecutiveAnomalyDays = useCallback((): number => {
    if (!checkins || checkins.length === 0) return 0
    const sorted = [...checkins].sort((a, b) => b.date.localeCompare(a.date))
    let count = 0
    for (const entry of sorted) {
      const isAnomaly = entry.mood === 'sad' || entry.appetite === 'poor' || entry.stool !== 'normal'
      const risk = computeRiskLevel(entry.mood, entry.appetite, entry.stool)
      if (isAnomaly || risk === 'high' || risk === 'emergency') {
        count++
      } else {
        break
      }
    }
    return count
  }, [checkins])

  const handleSubmit = async () => {
    if (!currentPet) return
    const mood = mapSpiritLevel(formData.spiritLevel)
    const appetite = mapAppetiteLevel(formData.appetiteLevel)
    const stool = mapPoopLevel(formData.poopLevel)
    const hasAnomaly = computeHasAnomaly(mood, appetite, stool)
    const anomalyItems = computeAnomalyItems(mood, appetite, stool)
    const riskLevel = computeRiskLevel(mood, appetite, stool)
    const noteParts: string[] = []
    if (formData.notes) noteParts.push(formData.notes)
    if (formData.exerciseLevel !== 2) noteParts.push(`运动: ${EXERCISE_LABELS[formData.exerciseLevel]}`)
    if (anomalyItems.length > 0) noteParts.push(`异常项: ${anomalyItems.join(', ')}`)

    trackEvent(AnalyticsEventName.CheckinSubmit, {
      petId: currentPet.id,
      items: JSON.stringify({ appetite: formData.appetiteLevel, spirit: formData.spiritLevel, poop: formData.poopLevel, exercise: formData.exerciseLevel }),
      hasAnomaly,
    })
    setSubmitting(true)
    try {
      const result = await doCheckin({
        petId: currentPet.id,
        userId,
        date: new Date().toISOString().split('T')[0],
        mood,
        appetite,
        stool,
        weight: formData.weight,
        note: noteParts.length > 0 ? noteParts.join('; ') : undefined,
      })

      if (hasAnomaly) {
        trackEvent(AnalyticsEventName.CheckinAnomaly, {
          petId: currentPet.id,
          anomalyItems: JSON.stringify(anomalyItems),
          urgency: riskLevel,
        })
      }
      if (hasAnomaly) {
        const riskToSeverity: Record<string, EmotionSeverity> = {
          low: 'mild',
          medium: 'moderate',
          high: 'severe',
          emergency: 'severe',
        }
        trackEmotion('anomaly_detected', riskToSeverity[riskLevel] || 'moderate')
      }
      if (riskLevel === 'emergency') {
        setFeedbackResult({ riskLevel, feedback: '检测到紧急健康信号，建议立即联系宠物医院', anomalyItems })
      } else if (riskLevel === 'high' || riskLevel === 'medium') {
        setFeedbackResult({ riskLevel, feedback: '检测到异常指标，建议持续观察', anomalyItems })
      } else {
        Taro.showToast({ title: '打卡成功', icon: 'success' })
      }

      updateLastCheckinDate()

      // 同步里程碑到记忆引擎
      if (userId && currentPet?.id) {
        try {
          const milestoneAdapter = new MilestoneAdapter(userId)
          // 局部改名 currentStreakDays：原名 streakDays 会遮蔽外层同名变量（no-shadow）
          const currentStreakDays = useCheckinStore.getState().streakDays
          milestoneAdapter.syncFromCheckins(currentPet.id, currentStreakDays)
        } catch (e) {
          // 里程碑同步失败不影响主流程
        }
      }

      const consecutiveDays = calculateConsecutiveAnomalyDays()
      if (consecutiveDays >= 7) {
        setShowCheckinCrisisReferral(true)
      }

      if (currentPet) {
        const currentStreakDays = useCheckinStore.getState().streakDays
        const birth = currentPet.birthDate ? new Date(currentPet.birthDate) : null
        const now = new Date()
        const isBirthday = birth
          ? now.getMonth() === birth.getMonth() && now.getDate() === birth.getDate()
          : false
        const diary = generateDiaryForToday(null, currentStreakDays, isBirthday, false)
        setDiaryEntry(diary)
      }

      if (currentPet) {
        fetchCheckins(currentPet.id)
      }

      if (currentPet) {
        const newStreakDays = useCheckinStore.getState().streakDays
        const detected = checkAllAchievements({
          petId: currentPet.id,
          birthDate: currentPet.birthDate,
          streakDays: newStreakDays,
          isDeceased: currentPet.isDeceased || false,
        })
        if (detected) {
          trackEvent('show_achievement')
          setAchievement(detected)
        }
      }

      if (!isAccepted('HEALTH_CHECKIN_TEMPLATE_ID_PLACEHOLDER')) {
        setTimeout(() => {
          Taro.showModal({
            title: '🔔 开启每日提醒',
            content: '是否开启每日打卡提醒？每天定时提醒你为毛孩子记录健康状态',
            confirmText: '开启',
            cancelText: '暂不',
            success: (modalRes) => {
              if (modalRes.confirm) {
                requestAll()
              }
            },
          })
        }, 1500)
      }
    } catch {
      Taro.showToast({ title: '打卡失败，请重试', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  // 多宠一键打卡：为所有未打卡宠物提交“全部正常”的默认指标
  const handleBatchCheckin = async () => {
    if (batchSubmitting || uncheckedPets.length === 0 || !userId) return
    setBatchSubmitting(true)
    try {
      // 默认值对齐“正常”档位：便便3/食欲3/精神3/运动2，不填体重
      const items: CheckinInput[] = uncheckedPets.map(p => ({
        petId: p.id,
        userId,
        poopLevel: 3,
        appetiteLevel: 3,
        spiritLevel: 3,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
      }))
      await batchCreateCheckins(items)
      // 合并已打卡集合，并刷新当前宠物视图（今天状态会变为“已打卡”）
      setCheckedTodayIds(prev => [...prev, ...uncheckedPets.map(p => p.id)])
      if (currentPet) await fetchCheckins(currentPet.id)
      Taro.showToast({ title: `已为 ${uncheckedPets.length} 只宠物完成打卡`, icon: 'success' })
      trackEvent(AnalyticsEventName.CheckinSubmit, { batch: true, count: uncheckedPets.length })
    } catch (err) {
      Taro.showToast({ title: '批量打卡失败，请重试', icon: 'none' })
    } finally {
      setBatchSubmitting(false)
    }
  }

  const handleWeightChange = (value: string) => {
    setWeightText(value)
    const num = parseFloat(value)
    if (!Number.isNaN(num) && num >= 0) {
      setFormData((prev) => ({ ...prev, weight: num }))
    } else if (value === '') {
      setFormData((prev) => ({ ...prev, weight: undefined }))
    }
  }

  const handleAchievementShare = useCallback(() => {
    trackEvent(AnalyticsEventName.ShareAction, { type: 'achievement', platform: 'wechat' })
    setShowAchievementShare(true)
  }, [trackEvent, achievement?.id])

  const handleAchievementShareClose = useCallback(() => {
    setShowAchievementShare(false)
  }, [])

  /** 表单完成进度（核心4项中已选的字段数/4） */
  const formProgress = useMemo(() => {
    let filled = 0
    if (formData.appetiteLevel) filled++
    if (formData.spiritLevel) filled++
    if (formData.poopLevel) filled++
    if (formData.exerciseLevel) filled++
    return { filled, total: 4, percent: Math.round((filled / 4) * 100) }
  }, [formData])

  const handleWeightPreset = (value: string) => {
    setWeightText(value)
    const num = parseFloat(value)
    if (!Number.isNaN(num)) {
      setFormData((prev) => ({ ...prev, weight: num }))
    }
  }

  const isLoading = petLoading || checkinLoading

  const todayHasAnomaly = todayCheckin ? computeHasAnomaly(todayCheckin.mood, todayCheckin.appetite, todayCheckin.stool) : false

  const disclaimerText = useMemo(() => {
    const disclaimer = new MedicalDisclaimer()
    return disclaimer.getCheckinDisclaimer(todayHasAnomaly)
  }, [todayHasAnomaly])

  const todayAnomalyItems = todayCheckin ? computeAnomalyItems(todayCheckin.mood, todayCheckin.appetite, todayCheckin.stool) : []
  const todayRiskLevel = todayCheckin ? computeRiskLevel(todayCheckin.mood, todayCheckin.appetite, todayCheckin.stool) : 'low'

  const expressionContext = useMemo((): ExpressionContext | null => {
    if (!currentPet) return null
    const now = new Date()
    const birth = currentPet.birthDate ? new Date(currentPet.birthDate) : null
    const isBirthday = birth
      ? now.getMonth() === birth.getMonth() && now.getDate() === birth.getDate()
      : false
    return {
      todayEntry: null,
      hasAnomaly: todayHasAnomaly,
      anomalyCount: todayAnomalyItems.length,
      riskLevel: todayRiskLevel as ExpressionContext['riskLevel'],
      streakDays,
      isBirthday,
      isVaccineComplete: false,
      isRecovery: false,
      isDeceased: currentPet.isDeceased || false,
    }
  }, [currentPet, todayHasAnomaly, todayAnomalyItems, todayRiskLevel, streakDays])

  const monthlyCount = useMemo(() => {
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    // 防御：历史/本地数据可能缺 date 字段（服务端契约修复见 api.normalizeCheckin）
    return checkins.filter(c => (c.date || '').startsWith(yearMonth)).length
  }, [checkins])

  const totalCheckins = checkins.length

  if (isLoading && pets.length === 0) {
    return (
      <View className='pet-checkin'>
        <PageLoading />
      </View>
    )
  }

  if (error && pets.length === 0) {
    return (
      <View className='pet-checkin'>
        <PageError message={error} onRetry={loadCheckinData} />
      </View>
    )
  }

  return (
    <View className={`pet-checkin ${themeClass}`}>
      {/* 全屏动态背景光斑层 */}
      <PageBackground />

      <PetSwitcher
        pets={pets}
        currentPetId={currentPet?.id || null}
        onSwitch={switchPet}
      />

      {/* 多宠快捷打卡：一次为所有未打卡宠物提交“全部正常” */}
      {pets.length > 1 && uncheckedPets.length > 0 && (
        <View className='pet-checkin__batch'>
          <View className='pet-checkin__batch-header'>
            <View className='pet-checkin__batch-title'>
              <Icon name='paw-print' size={14} tone='primary' />
              <Text className='pet-checkin__batch-title-text'>多宠快捷打卡</Text>
            </View>
            <Text className='pet-checkin__batch-sub'>还有 {uncheckedPets.length} 只毛孩子今天没打卡</Text>
          </View>
          <View className='pet-checkin__batch-list'>
            {uncheckedPets.map(p => (
              <View
                key={p.id}
                className='pet-checkin__batch-item'
                onClick={() => switchPet(p.id)}
              >
                <View className='pet-checkin__batch-item-emoji'>
                  <Icon
                    name={p.species === 'cat' ? 'cat' : p.species === 'dog' ? 'dog' : 'paw-print'}
                    size={16}
                    tone='primary'
                  />
                </View>
                <Text className='pet-checkin__batch-item-name'>{p.name}</Text>
                <Text className='pet-checkin__batch-item-arrow'>›</Text>
              </View>
            ))}
          </View>
          <View
            className={`pet-checkin__batch-btn${batchSubmitting ? ' pet-checkin__batch-btn--disabled' : ''}`}
            onClick={handleBatchCheckin}
          >
            <Text className='pet-checkin__batch-btn-text'>
              {batchSubmitting ? '打卡中...' : '全部正常，一键打卡'}
            </Text>
          </View>
          <Text className='pet-checkin__batch-hint'>个别有异常的宠物，点名字单独记录</Text>
        </View>
      )}

      {currentPet && expressionContext && (
        <View className='pet-checkin__avatar'>
          <PetAvatar
            species={currentPet.species as 'dog' | 'cat'}
            petName={currentPet.name}
            expressionContext={expressionContext}
            pet={currentPet}
            size={100}
            showLabel
          />
        </View>
      )}

      {!currentPet ? (
        <View className='pet-checkin__empty'>
          <Icon name='paw-print' size={48} tone='primary' className='pet-checkin__empty-icon' />
          <Text className='pet-checkin__empty-text'>请先添加宠物</Text>
        </View>
      ) : todayCheckin ? (
        <View className='pet-checkin__result-wrapper'>
          <View className={`pet-checkin__result pet-checkin__result--${todayRiskLevel}`}>
            <View className='pet-checkin__result-title-row'>
              <Icon name={RESULT_ICON_NAMES[todayRiskLevel] || 'check-circle'} size={18} tone='primary' />
              <Text className='pet-checkin__result-title'>今日已打卡</Text>
            </View>
            <Text className='pet-checkin__result-feedback'>
              {todayRiskLevel === 'emergency' ? '检测到紧急健康信号，建议立即联系宠物医院' :
               todayRiskLevel === 'high' ? '检测到异常指标，建议持续观察' :
               todayRiskLevel === 'medium' ? '部分指标需要关注，请继续观察' :
               '今日状态良好'}
            </Text>
            <View className='pet-checkin__result-detail'>
              <ResultTag
                emoji={APPETITE_DISPLAY[todayCheckin.appetite].emoji}
                text={`食欲：${APPETITE_DISPLAY[todayCheckin.appetite].label}`}
              />
              <ResultTag
                emoji={MOOD_DISPLAY[todayCheckin.mood].emoji}
                text={`精力：${MOOD_DISPLAY[todayCheckin.mood].label}`}
              />
              <ResultTag
                emoji={STOOL_DISPLAY[todayCheckin.stool].emoji}
                text={`便便：${STOOL_DISPLAY[todayCheckin.stool].label}`}
              />
              {todayCheckin.weight && (
                <ResultTag text={`体重：${todayCheckin.weight}kg`} />
              )}
            </View>
          </View>

          {diaryEntry && currentPet && (
            <View className='pet-checkin__diary'>
              <View className='pet-checkin__diary-header'>
                <PetAvatar
                  species={currentPet.species as 'dog' | 'cat'}
                  petName={currentPet.name}
                  expressionContext={expressionContext!}
                  pet={currentPet}
                  size={48}
                  showLabel={false}
                />
                <Text className='pet-checkin__diary-title'>今日宠物日记</Text>
              </View>
              <View className='pet-checkin__diary-body'>
                <Text className='pet-checkin__diary-emoji'>{diaryEntry.emoji}</Text>
                <Text className='pet-checkin__diary-text'>&quot;{diaryEntry.text}&quot;</Text>
                <Text className='pet-checkin__diary-author'>—— {currentPet.name}</Text>
              </View>
              <View
                className='pet-checkin__diary-share'
                onClick={() => {
                  trackEvent(AnalyticsEventName.ShareAction, { type: 'diary', platform: 'wechat' })
                  Taro.showShareMenu({ withShareTicket: true })
                }}
              >
                <Icon name='share-network' size={14} tone='primary' />
                <Text className='pet-checkin__diary-share-text'>分享日记</Text>
              </View>
            </View>
          )}

          {todayRiskLevel !== 'low' && calculateConsecutiveAnomalyDays() >= 3 && (
            <View
              className='pet-checkin__care-plan-btn'
              onClick={() => setShowCarePlan(true)}
            >
              <Icon name='clipboard-text' size={14} tone='primary' />
              <Text className='pet-checkin__care-plan-btn-text'>查看 3 天护理计划</Text>
            </View>
          )}
        </View>
      ) : (
        <View className='pet-checkin__form'>
          {/* 进度指示条 */}
          <View className='pet-checkin__progress'>
            <View className='pet-checkin__progress-header'>
              <Text className='pet-checkin__progress-title'>打卡进度</Text>
              <Text className='pet-checkin__progress-text'>{formProgress.filled}/{formProgress.total}</Text>
            </View>
            <View className='pet-checkin__progress-track'>
              <View
                className='pet-checkin__progress-fill'
                style={{ width: `${formProgress.percent}%` }}
              />
            </View>
          </View>

          {/* ===== 1 便便评分（原型对齐） ===== */}
          <View className='pet-checkin__section'>
            <View className='pet-checkin__section-head'>
              <View className='pet-checkin__section-icon pet-checkin__section-icon--coral'>
                {/* 原来用 💧 表示「便便评分」，语义不搭，换成 stool */}
                <Icon name='stool' size={18} tone='primary' />
              </View>
              <View className='pet-checkin__section-titles'>
                <Text className='pet-checkin__section-title'>便便评分</Text>
                <Text className='pet-checkin__section-desc'>观察今日便便形态与软硬程度</Text>
              </View>
              {/* 回显已选答案：原来只显示「已选」两个字，用户还得自己回选项行里数选了哪个 */}
              <View className='pet-checkin__section-answer'>
                <Text className='pet-checkin__section-answer-text'>
                  {POOP_OPTIONS.find(o => o.value === formData.poopLevel)?.label ?? '未选'}
                </Text>
              </View>
            </View>
            <View className='pet-checkin__options'>
              {POOP_OPTIONS.map((option) => (
                <View
                  key={option.value}
                  className={`pet-checkin__option${formData.poopLevel === option.value ? ' pet-checkin__option--active' : ''}`}
                  onClick={() => setFormData((prev) => ({ ...prev, poopLevel: option.value }))}
                >
                  <Text className='pet-checkin__option-label'>{option.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ===== 2 食欲状况（原型对齐） ===== */}
          <View className='pet-checkin__section'>
            <View className='pet-checkin__section-head'>
              <View className='pet-checkin__section-icon pet-checkin__section-icon--gold'>
                <Icon name='bowl-food' size={18} tone='gold-deep' />
              </View>
              <View className='pet-checkin__section-titles'>
                <Text className='pet-checkin__section-title'>食欲状况</Text>
                <Text className='pet-checkin__section-desc'>记录今日进食情况</Text>
              </View>
              <View className='pet-checkin__section-answer'>
                <Text className='pet-checkin__section-answer-text'>
                  {APPETITE_OPTIONS.find(o => o.value === formData.appetiteLevel)?.label ?? '未选'}
                </Text>
              </View>
            </View>
            <View className='pet-checkin__options'>
              {APPETITE_OPTIONS.map((option) => (
                <View
                  key={option.value}
                  className={`pet-checkin__option${formData.appetiteLevel === option.value ? ' pet-checkin__option--active' : ''}`}
                  onClick={() => setFormData((prev) => ({ ...prev, appetiteLevel: option.value }))}
                >
                  <Text className='pet-checkin__option-label'>{option.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ===== 3 精神状态（原型对齐） ===== */}
          <View className='pet-checkin__section'>
            <View className='pet-checkin__section-head'>
              <View className='pet-checkin__section-icon pet-checkin__section-icon--info'>
                <Icon name='smiley' size={18} tone='teal' />
              </View>
              <View className='pet-checkin__section-titles'>
                <Text className='pet-checkin__section-title'>精神状态</Text>
                <Text className='pet-checkin__section-desc'>记录当前精神状态</Text>
              </View>
              <View className='pet-checkin__section-answer'>
                <Text className='pet-checkin__section-answer-text'>
                  {SPIRIT_OPTIONS.find(o => o.value === formData.spiritLevel)?.label ?? '未选'}
                </Text>
              </View>
            </View>
            <View className='pet-checkin__options'>
              {SPIRIT_OPTIONS.map((option) => (
                <View
                  key={option.value}
                  className={`pet-checkin__option${formData.spiritLevel === option.value ? ' pet-checkin__option--active' : ''}`}
                  onClick={() => setFormData((prev) => ({ ...prev, spiritLevel: option.value }))}
                >
                  <Text className='pet-checkin__option-label'>{option.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ===== 4 运动量（原型对齐） ===== */}
          <View className='pet-checkin__section'>
            <View className='pet-checkin__section-head'>
              <View className='pet-checkin__section-icon pet-checkin__section-icon--success'>
                <Icon name='footprints' size={18} tone='success' />
              </View>
              <View className='pet-checkin__section-titles'>
                <Text className='pet-checkin__section-title'>运动量</Text>
                <Text className='pet-checkin__section-desc'>记录今日运动量情况</Text>
              </View>
              <View className='pet-checkin__section-answer'>
                <Text className='pet-checkin__section-answer-text'>
                  {EXERCISE_OPTIONS.find(o => o.value === formData.exerciseLevel)?.label ?? '未选'}
                </Text>
              </View>
            </View>
            <View className='pet-checkin__options'>
              {EXERCISE_OPTIONS.map((option) => (
                <View
                  key={option.value}
                  className={`pet-checkin__option${formData.exerciseLevel === option.value ? ' pet-checkin__option--active' : ''}`}
                  onClick={() => setFormData((prev) => ({ ...prev, exerciseLevel: option.value }))}
                >
                  <Text className='pet-checkin__option-label'>{option.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ===== 5 体重（可选，原型对齐） ===== */}
          <View className='pet-checkin__section'>
            <View className='pet-checkin__section-head'>
              <View className='pet-checkin__section-icon pet-checkin__section-icon--coral'>
                <Icon name='scales' size={18} tone='primary' />
              </View>
              <View className='pet-checkin__section-titles'>
                <Text className='pet-checkin__section-title'>体重 <Text className='pet-checkin__section-optional'>（可选）</Text></Text>
                <Text className='pet-checkin__section-desc'>今日体重，帮助跟踪健康趋势</Text>
              </View>
              {formData.weight !== undefined && (
                <View className='pet-checkin__section-answer'>
                  <Text className='pet-checkin__section-answer-text'>已填</Text>
                </View>
              )}
            </View>
            <View className='pet-checkin__weight-row'>
              <View className='pet-checkin__weight-input-wrap'>
                <Input
                  className='pet-checkin__weight-input'
                  type='digit'
                  placeholder='0.0'
                  placeholderClass='pet-checkin__weight-placeholder'
                  value={weightText}
                  onInput={(e) => handleWeightChange(e.detail.value)}
                />
                <Text className='pet-checkin__weight-unit'>kg</Text>
              </View>
              <View
                className='pet-checkin__weight-skip'
                onClick={() => setFormData((prev) => ({ ...prev, weight: undefined }))}
              >
                <Text>跳过</Text>
              </View>
            </View>
            {/* 快捷体重预设 */}
            <View className='pet-checkin__weight-presets'>
              {WEIGHT_PRESETS.map((group) => (
                group.weights.map((w) => (
                  <View
                    key={w}
                    className='pet-checkin__weight-preset'
                    onClick={() => handleWeightPreset(w)}
                  >
                    <Text>{w} kg</Text>
                  </View>
                ))
              ))}
            </View>
            {/* 品种标准范围提示（原型对齐） */}
            <Text className='pet-checkin__weight-range-hint'>
              {(() => {
                const breed = currentPet?.breed || ''
                const matched = getActiveBreeds().find(b => b.name === breed || b.aliases.includes(breed))
                return matched ? `${matched.name}标准范围：${matched.weightRangeStr}` : '记录体重帮助跟踪健康趋势'
              })()}
            </Text>
          </View>

          <View className='pet-checkin__section'>
            <View className='pet-checkin__section-head'>
              <View className='pet-checkin__section-icon pet-checkin__section-icon--coral'>
                <Icon name='note-pencil' size={18} tone='primary' />
              </View>
              <View className='pet-checkin__section-titles'>
                <Text className='pet-checkin__section-title'>备注 <Text className='pet-checkin__section-optional'>（选填）</Text></Text>
              </View>
            </View>
            <Textarea
              className='pet-checkin__notes'
              placeholder='有什么想记录的吗...'
              placeholderClass='pet-checkin__notes-placeholder'
              maxlength={200}
              value={formData.notes}
              onInput={(e) => setFormData((prev) => ({ ...prev, notes: e.detail.value }))}
            />
            <Text className='pet-checkin__notes-count'>{formData.notes.length}/200</Text>
          </View>

          <View
            className={`pet-checkin__submit${submitting ? ' pet-checkin__submit--disabled' : ''}`}
            onClick={submitting ? undefined : handleSubmit}
          >
            <Icon name='check-circle' size={20} tone='white' />
            <Text className='pet-checkin__submit-text'>{submitting ? '提交中...' : '完成打卡'}</Text>
          </View>
        </View>
      )}

      <View className='pet-checkin__stats'>
        <View className='pet-checkin__stats-item'>
          <Text className='pet-checkin__stats-value'>{streakDays}</Text>
          <Text className='pet-checkin__stats-label'>连续打卡（天）</Text>
        </View>
        <View className='pet-checkin__stats-divider' />
        <View className='pet-checkin__stats-item'>
          <Text className='pet-checkin__stats-value'>{monthlyCount}</Text>
          <Text className='pet-checkin__stats-label'>本月打卡（次）</Text>
        </View>
        <View className='pet-checkin__stats-divider' />
        <View className='pet-checkin__stats-item'>
          <Text className='pet-checkin__stats-value'>{totalCheckins}</Text>
          <Text className='pet-checkin__stats-label'>累计打卡</Text>
        </View>
      </View>

      {feedbackResult && feedbackResult.riskLevel !== 'emergency' && (
        <View className='pet-checkin__feedback-overlay' onClick={(e) => { e.stopPropagation() }}>
          <View className='pet-checkin__feedback-popup'>
            <View className='pet-checkin__feedback-header'>
            {/* 异常提醒弹窗：用警示金而不是品牌主色，语义更明确。
                tone 取 gold-deep 而非 gold：浅金在纸面底色上只有 1.8:1（深色主题 1.43:1），
                低于 WCAG 非文本 3:1；深金 2.4:1 且仍是"警示金"语义（审查 P2-4）。 */}
            <Icon name='warning' size={36} tone='gold-deep' className='pet-checkin__feedback-icon' />
              <Text className='pet-checkin__feedback-title'>异常指标提醒</Text>
            </View>
            <Text className='pet-checkin__feedback-text'>{feedbackResult.feedback}</Text>
            <View className='pet-checkin__feedback-actions'>
              <View
                className='pet-checkin__feedback-btn pet-checkin__feedback-btn--food'
                onClick={() => { setFeedbackResult(null); Taro.navigateTo({ url: '/pagesPet/food-query/index' }) }}
              >
                <Text className='pet-checkin__feedback-btn-text'>查食物</Text>
              </View>
              <View
                className='pet-checkin__feedback-btn pet-checkin__feedback-btn--close'
                onClick={() => setFeedbackResult(null)}
              >
                <Text className='pet-checkin__feedback-btn-text'>关闭</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      <EmergencyAlert
        visible={!!feedbackResult && feedbackResult.riskLevel === 'emergency'}
        message={feedbackResult?.feedback || '检测到紧急健康信号，建议立即联系宠物医院'}
        showSymptomButton
        showFoodButton
        petId={currentPet?.id || ''}
        symptoms={feedbackResult?.anomalyItems || []}
        alertType='checkin_emergency'
        onClose={() => setFeedbackResult(null)}
      />

      {achievement && currentPet && (
        <View className='pet-checkin__achievement'>
          <AchievementCard
            achievement={achievement}
            petName={currentPet.name}
            species={currentPet.species as 'dog' | 'cat'}
            onClose={() => setAchievement(null)}
            onShare={handleAchievementShare}
          />
        </View>
      )}

      {showAchievementShare && achievement && currentPet && (
        <AchievementShareCard
          petName={currentPet.name}
          petAvatar={currentPet.avatarPhotoUrl || currentPet.avatarCartoonUrl || ''}
          achievementType={achievement.type}
          achievementTitle={achievement.title}
          achievementSubtitle={achievement.subtitle}
          achievementIcon={achievement.icon}
          achievementColor={achievement.color}
          inviteCode={inviteCode}
          onClose={handleAchievementShareClose}
        />
      )}

      <View className='pet-checkin__disclaimer'>
        <Text className='pet-checkin__disclaimer-text'>{disclaimerText}</Text>
      </View>

      {showCrisisReferral && (
        <CrisisReferralCard
          message='我们注意到毛孩子近期健康数据持续异常，这可能会让你感到焦虑。照顾好自己，才能更好地照顾TA。'
          severity={crisisSeverity}
          onDismiss={dismissCrisisReferral}
          onFollowUp={handleFollowUp}
        />
      )}

      {currentPet && (
        <CarePlanCard
          visible={showCarePlan}
          petName={currentPet.name}
          anomalyItems={todayAnomalyItems}
          onClose={() => setShowCarePlan(false)}
        />
      )}

      {showCheckinCrisisReferral && (
        <CrisisReferralCard
          message={getCrisisMessage('sick_anxiety', 'severe')}
          severity='severe'
          triggerSource='checkin_severe'
          onDismiss={() => setShowCheckinCrisisReferral(false)}
          onFollowUp={handleFollowUp}
        />
      )}

    </View>
  )
}
