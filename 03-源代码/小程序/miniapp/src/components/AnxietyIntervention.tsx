/**
 * 焦虑干预组件
 * 针对宠物健康焦虑和新手养宠焦虑提供分步引导，包含护理计划和危机转介
 *
 * 【IA：`找附近医院` 为什么跳团团】（2026-09-12 收口批次 §2）
 * 判断标准：**需要 AI 推理的能力**（食物安全查询 / 症状初筛 / 附近医院 / AI 取名 / AI 记忆）
 * 入口统一先跳团团；**纯记录 / 查询类**（打卡 / 品种 / 疫苗 / 时光）保留原位。
 * 本组件里只有 `hospital`（附近医院）属 AI 推理类 → 收拢到团团；
 * 其余动作 `trends`（趋势）/ `checkin`（打卡）/ `vaccine`（疫苗）是纯记录查询类，
 * **保持原路径直达**，不要顺手一起改。
 */
import { View, Text } from '@tarojs/components'
import { useState, useCallback, useEffect, useMemo } from 'react'
import Taro from '@tarojs/taro'
import {
  type SickAnxietyContext,
  type NewOwnerAnxietyContext,
  type AnxietyLevel,
  type EmotionSceneType,
  type CarePlan,
  getSickAnxietyMessage,
  getNewOwnerAnxietyMessage,
  getDisclaimer,
  generateCarePlan,
} from '../engines/emotion'
import { trackEmotionEvent, type EmotionSeverity } from '../services/emotionTrackingService'
import { useAnalytics } from '../hooks/useAnalytics'
import { AnalyticsEventName } from '../types/analyticsTypes'
import { buildAiEntryUrl } from '../utils/aiEntry'
import './AnxietyIntervention.scss'

interface AnxietyInterventionProps {
  type: 'sick_anxiety' | 'new_owner_anxiety'
  context: SickAnxietyContext | NewOwnerAnxietyContext
  petName: string
  species: 'dog' | 'cat'
  petId?: string
  anomalyItems?: string[]
  onDismiss: () => void
  onAction?: (action: string) => void
  onCrisisReferral?: () => void
}

interface InterventionStep {
  id: string
  title: string
  content: string
  actions?: { label: string; value: string }[]
}

export default function AnxietyIntervention({
  type,
  context,
  petName,
  species,
  petId,
  anomalyItems,
  onDismiss,
  onAction,
  onCrisisReferral,
}: AnxietyInterventionProps) {
  const { trackEvent } = useAnalytics()
  const [currentStep, setCurrentStep] = useState(0)
  const [showDetail, setShowDetail] = useState(false)
  const [showCarePlan, setShowCarePlan] = useState(false)

  const petLabel = species === 'cat' ? '猫咪' : '狗狗'
  const disclaimer = getDisclaimer(type)

  const carePlan = useMemo((): CarePlan | null => {
    if (type !== 'sick_anxiety') return null
    return generateCarePlan(petName, anomalyItems)
  }, [type, petName, anomalyItems])

  useEffect(() => {
    if (petId) {
      const levelToSeverity: Record<AnxietyLevel, EmotionSeverity> = {
        mild: 'mild',
        moderate: 'moderate',
        severe: 'severe',
      }
      const level = getLevel()
      trackEmotionEvent(petId, 'anxiety_detected', levelToSeverity[level])
      trackEvent(AnalyticsEventName.EmotionTrigger, { scene: type, triggerType: 'anxiety_detected', userAction: undefined })
    }
  }, [petId])

  const getMessage = useCallback(() => {
    if (type === 'sick_anxiety') {
      return getSickAnxietyMessage(context as SickAnxietyContext)
    }
    return getNewOwnerAnxietyMessage(context as NewOwnerAnxietyContext, species, petName)
  }, [type, context, species, petName])

  const getLevel = useCallback((): AnxietyLevel => {
    if (type === 'sick_anxiety') {
      const ctx = context as SickAnxietyContext
      return ctx.consecutiveAnomalyDays >= 7 ? 'severe' : ctx.consecutiveAnomalyDays >= 5 ? 'moderate' : 'mild'
    }
    const ctx = context as NewOwnerAnxietyContext
    const total = ctx.foodQueryCount + ctx.symptomCheckCount
    return total >= 15 ? 'severe' : total >= 8 ? 'moderate' : 'mild'
  }, [type, context])

  const level = getLevel()

  const getSteps = useCallback((): InterventionStep[] => {
    if (type === 'sick_anxiety') {
      return [
        {
          id: 'acknowledge',
          title: '理解你的担心',
          content: getMessage(),
          actions: [
            { label: '深呼吸一下', value: 'breathe' },
            { label: '查看健康数据', value: 'trends' },
          ],
        },
        {
          id: 'guide',
          title: '理性分析',
          content: `让我们一起来看看${petName}的实际情况。连续${(context as SickAnxietyContext).consecutiveAnomalyDays}天的数据波动，可能是正常的生理变化，也可能是需要关注的信号。`,
          actions: [
            { label: '查看趋势图', value: 'trends' },
            { label: '记录今日状态', value: 'checkin' },
          ],
        },
        {
          id: 'support',
          title: '你不是一个人',
          content: `很多${petLabel}家长都经历过类似的焦虑。重要的是保持观察，而不是过度担心。如果症状持续或加重，及时就医是最好的选择。`,
          actions: [
            { label: '📋 3天护理计划', value: 'care_plan' },
            { label: '找附近医院', value: 'hospital' },
            ...(level === 'severe' ? [{ label: '需要更多帮助？', value: 'crisis_referral' }] : []),
            { label: '完成', value: 'done' },
          ],
        },
      ]
    }

    const ctx = context as NewOwnerAnxietyContext
    return [
      {
        id: 'welcome',
        title: '新手家长你好！',
        content: getMessage(),
        actions: [
          { label: '查看新手指南', value: 'guide' },
          { label: '记录今日状态', value: 'checkin' },
        ],
      },
      {
        id: 'tips',
        title: '新手必知',
        content: `养${petLabel}的前30天是最需要学习的阶段。你已经查询了${ctx.foodQueryCount}次食物安全、${ctx.symptomCheckCount}次症状，这说明你是个负责任的家长！`,
        actions: [
          { label: '查看养宠攻略', value: 'guide' },
          { label: '设置疫苗提醒', value: 'vaccine' },
        ],
      },
      {
        id: 'encourage',
        title: '你已经做得很好了',
        content: `每个新手家长都会经历焦虑期，这是正常的。重要的是你在学习和成长。${petName}很幸运有你这样的家人。`,
        actions: [
          ...(level === 'severe' ? [{ label: '需要更多帮助？', value: 'crisis_referral' }] : []),
          { label: '完成', value: 'done' },
        ],
      },
    ]
  }, [type, context, petName, species, petLabel, getMessage])

  const steps = getSteps()

  const handleAction = useCallback((actionValue: string) => {
    trackEvent(AnalyticsEventName.EmotionTrigger, { scene: type, triggerType: 'user_action', userAction: actionValue })
    if (onAction) {
      onAction(actionValue)
    }

    switch (actionValue) {
      case 'breathe':
        Taro.showToast({ title: '深呼吸，放松~', icon: 'none' })
        break
      case 'trends':
        onDismiss()
        Taro.navigateTo({ url: '/pagesPet/trends/index' })
        break
      case 'checkin':
        onDismiss()
        Taro.navigateTo({ url: '/pagesPet/checkin/index' })
        break
      case 'vaccine':
        onDismiss()
        Taro.navigateTo({ url: '/pagesPet/vaccine/index' })
        break
      case 'hospital':
        onDismiss()
        // 附近医院属 AI 推理类能力 → 跳团团并自动打开该能力（上面 trends/checkin/vaccine 不动）
        Taro.navigateTo({ url: buildAiEntryUrl('hospital') })
        break
      case 'care_plan':
        setShowCarePlan(true)
        return
      case 'guide':
        setShowDetail(true)
        return
      case 'done':
        onDismiss()
        return
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1)
    } else {
      onDismiss()
    }
  }, [currentStep, steps.length, onDismiss, onAction])

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1)
    } else {
      onDismiss()
    }
  }, [currentStep, steps.length, onDismiss])

  const handleSkip = useCallback(() => {
    onDismiss()
  }, [onDismiss])

  if (showDetail) {
    return (
      <View className='anxiety-intervention anxiety-intervention--detail'>
        <View className='anxiety-intervention__overlay' onClick={() => setShowDetail(false)} />
        <View className='anxiety-intervention__content'>
          <View className='anxiety-intervention__header'>
            <Text className='anxiety-intervention__title'>
              {type === 'sick_anxiety' ? '🩺 健康焦虑缓解指南' : '📚 新手养宠攻略'}
            </Text>
            <View className='anxiety-intervention__close' onClick={() => setShowDetail(false)}>
              <Text>✕</Text>
            </View>
          </View>
          <View className='anxiety-intervention__detail-body'>
            {type === 'sick_anxiety' ? (
              <>
                <View className='anxiety-intervention__detail-section'>
                  <Text className='anxiety-intervention__detail-section-title'>🫁 深呼吸练习</Text>
                  <Text className='anxiety-intervention__detail-text'>
                    慢慢吸气4秒，屏住呼吸4秒，然后缓慢呼气6秒。重复3次，这能帮助你平静下来。
                  </Text>
                </View>
                <View className='anxiety-intervention__detail-section'>
                  <Text className='anxiety-intervention__detail-section-title'>📊 数据观察法</Text>
                  <Text className='anxiety-intervention__detail-text'>
                    连续3天以上的数据才有参考价值。单次波动很正常，关注趋势而非单点。
                  </Text>
                </View>
                <View className='anxiety-intervention__detail-section'>
                  <Text className='anxiety-intervention__detail-section-title'>🏥 何时就医</Text>
                  <Text className='anxiety-intervention__detail-text'>
                    如果症状持续加重、宠物精神萎靡、拒食超过24小时，请立即就医。
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View className='anxiety-intervention__detail-section'>
                  <Text className='anxiety-intervention__detail-section-title'>🍽️ 饮食安全</Text>
                  <Text className='anxiety-intervention__detail-text'>
                    不确定的食物先用「食物安全查询」查一下。巧克力、葡萄、洋葱等对{petLabel}有毒，绝对不要喂。
                  </Text>
                </View>
                <View className='anxiety-intervention__detail-section'>
                  <Text className='anxiety-intervention__detail-section-title'>💉 疫苗计划</Text>
                  <Text className='anxiety-intervention__detail-text'>
                    幼{petLabel}需要接种多联疫苗和狂犬疫苗。使用「疫苗日历」功能，设置提醒，不会错过。
                  </Text>
                </View>
                <View className='anxiety-intervention__detail-section'>
                  <Text className='anxiety-intervention__detail-section-title'>📝 日常记录</Text>
                  <Text className='anxiety-intervention__detail-text'>
                    每天花3秒记录一下{petName}的状态，长期坚持能帮你发现健康规律。
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>
      </View>
    )
  }

  if (showCarePlan && carePlan) {
    return (
      <View className='anxiety-intervention anxiety-intervention--detail'>
        <View className='anxiety-intervention__overlay' onClick={() => setShowCarePlan(false)} />
        <View className='anxiety-intervention__content'>
          <View className='anxiety-intervention__header'>
            <Text className='anxiety-intervention__title'>📋 3天护理计划</Text>
            <View className='anxiety-intervention__close' onClick={() => setShowCarePlan(false)}>
              <Text>✕</Text>
            </View>
          </View>
          <View className='anxiety-intervention__care-plan'>
            <Text className='anxiety-intervention__care-plan-subtitle'>
              为{petName}定制的3天观察护理方案
            </Text>
            {carePlan.days.map((day) => (
              <View key={day.day} className='anxiety-intervention__care-day'>
                <View className='anxiety-intervention__care-day-header'>
                  <Text className='anxiety-intervention__care-day-icon'>{day.icon}</Text>
                  <Text className='anxiety-intervention__care-day-title'>
                    Day{day.day} {day.title}
                  </Text>
                </View>
                <View className='anxiety-intervention__care-day-suggestions'>
                  {day.suggestions.map((suggestion, idx) => (
                    <View key={idx} className='anxiety-intervention__care-suggestion'>
                      <Text className='anxiety-intervention__care-suggestion-dot'>•</Text>
                      <Text className='anxiety-intervention__care-suggestion-text'>{suggestion}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
          <View className='anxiety-intervention__care-plan-footer'>
            <View
              className='anxiety-intervention__nav-btn anxiety-intervention__nav-btn--primary'
              onClick={() => setShowCarePlan(false)}
            >
              <Text>我知道了</Text>
            </View>
          </View>
        </View>
      </View>
    )
  }

  const currentStepData = steps[currentStep]

  return (
    <View className='anxiety-intervention'>
      <View className='anxiety-intervention__overlay' onClick={handleSkip} />
      <View className='anxiety-intervention__content'>
        <View className='anxiety-intervention__header'>
          <View className='anxiety-intervention__progress'>
            {steps.map((_, index) => (
              <View
                key={index}
                className={`anxiety-intervention__progress-dot ${
                  index <= currentStep ? 'anxiety-intervention__progress-dot--active' : ''
                }`}
              />
            ))}
          </View>
          <View className='anxiety-intervention__close' onClick={handleSkip}>
            <Text>✕</Text>
          </View>
        </View>

        <View className='anxiety-intervention__body'>
          <View className={`anxiety-intervention__level anxiety-intervention__level--${level}`}>
            <Text className='anxiety-intervention__level-text'>
              {level === 'mild' ? '💚 轻度关注' : level === 'moderate' ? '💛 中度关注' : '❤️ 重度关注'}
            </Text>
          </View>

          <Text className='anxiety-intervention__step-title'>{currentStepData.title}</Text>
          <Text className='anxiety-intervention__step-content'>{currentStepData.content}</Text>

          {currentStepData.actions && (
            <View className='anxiety-intervention__actions'>
              {currentStepData.actions.map((action) => (
                <View
                  key={action.value}
                  className='anxiety-intervention__action-btn'
                  onClick={() => handleAction(action.value)}
                >
                  <Text className='anxiety-intervention__action-text'>{action.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View className='anxiety-intervention__footer'>
          <Text className='anxiety-intervention__disclaimer'>{disclaimer}</Text>
          <View className='anxiety-intervention__nav'>
            {currentStep > 0 && (
              <View
                className='anxiety-intervention__nav-btn anxiety-intervention__nav-btn--secondary'
                onClick={() => setCurrentStep(prev => prev - 1)}
              >
                <Text>上一步</Text>
              </View>
            )}
            <View
              className='anxiety-intervention__nav-btn anxiety-intervention__nav-btn--primary'
              onClick={handleNext}
            >
              <Text>{currentStep < steps.length - 1 ? '下一步' : '完成'}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
