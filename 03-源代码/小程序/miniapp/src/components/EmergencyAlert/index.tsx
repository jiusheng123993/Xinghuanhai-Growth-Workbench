/**
 * 紧急健康预警组件
 * 展示紧急健康预警弹窗，含倒计时关闭机制和快捷操作按钮
 *
 * 【IA：这三个按钮为什么都跳团团】（2026-09-12 收口批次 §2）
 * 判断标准：**需要 AI 推理的能力**（食物安全查询 / 症状初筛 / 附近医院 / AI 取名 / AI 记忆）
 * 入口统一先跳团团；**纯记录 / 查询类**（打卡 / 品种 / 疫苗 / 时光）保留原位。
 * 本组件三个按钮 `记录症状`（症状初筛）、`查食物`（食物安全查询）、`找医院`（附近医院）
 * **全部属于 AI 推理类** —— 落地页 `pagesPet/symptom-check`、`pagesPet/food-query`、
 * `pagesPet/hospital` 是团团流程内部的落地页，不再作为入口存在。
 *
 * 【带 `capability` 参数：紧急场景不能只把人丢到团团首屏】
 * 三个按钮各自带上能力参数（`buildAiEntryUrl('symptom' | 'food' | 'hospital')`），
 * 团团进页后会**自动打开对应能力**：症状初筛弹窗 / 食物查询流程 / 附近医院。
 * 契约（参数名与取值）见 `utils/aiEntry.ts`；团团读取侧是 `pagesYuantuan/agent/index.tsx`
 * 的 `AUTO_CAPABILITY_KEYS`，**改一处必须同步另一处**。
 */
import { View, Text } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { useAnalytics } from '../../hooks/useAnalytics'
import { AnalyticsEventName } from '../../types/analyticsTypes'
import { buildAiEntryUrl } from '../../utils/aiEntry'
import './EmergencyAlert.scss'

interface EmergencyAlertProps {
  visible: boolean
  title?: string
  message: string
  showSymptomButton?: boolean
  showFoodButton?: boolean
  showHospitalButton?: boolean
  petId?: string
  symptoms?: string[]
  alertType?: string
  onClose: () => void
}

export default function EmergencyAlert({
  visible,
  title = '紧急健康预警',
  message,
  showSymptomButton = true,
  showFoodButton = true,
  showHospitalButton = true,
  petId = '',
  symptoms = [],
  alertType = 'unknown',
  onClose,
}: EmergencyAlertProps) {
  const { trackEvent } = useAnalytics()
  const [canClose, setCanClose] = useState(false)
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    if (visible && petId) {
      trackEvent(AnalyticsEventName.EmergencyAlert, { petId, symptoms, alertType })
    }
  }, [visible])

  useEffect(() => {
    if (!visible) {
      setCanClose(false)
      setCountdown(3)
      return
    }

    let timer: ReturnType<typeof setInterval>
    let count = 3
    setCountdown(3)

    timer = setInterval(() => {
      count -= 1
      setCountdown(count)
      if (count <= 0) {
        clearInterval(timer)
        setCanClose(true)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [visible])

  if (!visible) return null

  return (
    <View className='emergency-alert__overlay'>
      <View className='emergency-alert__popup'>
        <View className='emergency-alert__header'>
          <Text className='emergency-alert__icon'>🚨</Text>
          <Text className='emergency-alert__title'>{title}</Text>
        </View>

        <Text className='emergency-alert__message'>{message}</Text>

        <View className='emergency-alert__divider' />

        <Text className='emergency-alert__disclaimer'>
          ⚠️ 以上内容仅供参考，不能替代专业兽医诊断。如情况紧急，请立即联系宠物医院。
        </Text>

        <View className='emergency-alert__actions'>
          {showSymptomButton && (
            <View
              className='emergency-alert__btn emergency-alert__btn--symptom'
              onClick={() => {
                onClose()
                // 症状初筛属 AI 推理类能力 → 跳团团并自动打开该能力（一步到位）
                Taro.navigateTo({ url: buildAiEntryUrl('symptom') })
              }}
            >
              <Text className='emergency-alert__btn-text'>记录症状</Text>
            </View>
          )}
          {showFoodButton && (
            <View
              className='emergency-alert__btn emergency-alert__btn--food'
              onClick={() => {
                onClose()
                // 食物安全查询属 AI 推理类能力 → 跳团团并自动打开该能力（一步到位）
                Taro.navigateTo({ url: buildAiEntryUrl('food') })
              }}
            >
              <Text className='emergency-alert__btn-text'>查食物</Text>
            </View>
          )}
          {showHospitalButton && (
            <View
              className='emergency-alert__btn emergency-alert__btn--hospital'
              onClick={() => {
                onClose()
                // 附近医院属 AI 推理类能力 → 跳团团并自动打开该能力（一步到位）
                Taro.navigateTo({ url: buildAiEntryUrl('hospital') })
              }}
            >
              <Text className='emergency-alert__btn-text'>找医院</Text>
            </View>
          )}
          <View
            className={`emergency-alert__btn emergency-alert__btn--close ${canClose ? '' : 'emergency-alert__btn--disabled'}`}
            onClick={() => canClose && onClose()}
          >
            <Text className='emergency-alert__btn-text'>
              {canClose ? '我知道了' : `请仔细阅读 (${countdown}s)`}
            </Text>
          </View>
        </View>
      </View>
    </View>
  )
}
