/**
 * 症状初筛弹窗卡片
 *
 * 替代旧的"逐条聊天问答"症状初筛流程：旧流程一次初筛会向聊天流注入十余条消息
 * （开场白 + 4 问 × 问题/回答 + 结果卡），把聊天撑得非常长。
 * 现在全部 4 步（主要症状 → 持续时间 → 严重程度 → 其他信息）都在卡片内完成，
 * 完成后仅通过 onComplete 向聊天流追加一条结果卡消息。
 */
import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { usePetStore } from '../../stores/petStore'
import type { CardData } from '../../types/chatTypes'
import './index.scss'

/** 症状初筛单步配置（题目沿用旧聊天问答，去掉 {name} 占位——宠物名在卡片头部展示） */
interface ScStep {
  key: string
  emoji: string
  title: string
  question: string
  options: string[]
}

const SC_STEPS: ScStep[] = [
  { key: 'symptom', emoji: '🤢', title: '主要症状', question: '出现了什么症状？', options: ['呕吐 / 反胃', '腹泻 / 软便', '食欲不振', '精神萎靡 / 嗜睡', '皮肤瘙痒 / 掉毛', '咳嗽 / 打喷嚏'] },
  { key: 'duration', emoji: '⏳', title: '持续时间', question: '这个症状持续多久了？', options: ['刚开始，不到半天', '今天一整天了', '2-3天了', '超过3天了'] },
  { key: 'severity', emoji: '⚡', title: '严重程度', question: '症状的严重程度如何？', options: ['轻微的，不太影响日常', '中等，能看出不舒服', '比较严重，明显异常', '非常严重，需要急救'] },
  { key: 'other', emoji: '🔎', title: '其他信息', question: '还有没有其他异常？', options: ['没有其他异常', '体温偏高 / 发烧', '有外伤或肿块', '眼睛/鼻子有分泌物'] },
]

/** 卡片内部步骤：逐题勾选 → 看结果 */
type ScStepType = 'steps' | 'result'

/** 初筛完成后回传给聊天流的消息负载（card 缺省 = 纯文本结果，一般带 card） */
export interface SymptomCompletePayload {
  type: 'ai'
  content: string
  card?: CardData
}

export interface SymptomCheckPopupProps {
  /** 是否显示弹窗（由父级控制开关） */
  open: boolean
  /** 关闭弹窗（用户主动取消或完成后收起） */
  onClose: () => void
  /** 初筛完成并关闭卡片后回调：父级负责往聊天流加一条结果消息 */
  onComplete: (payload: SymptomCompletePayload) => void
}

/** 结果卡数据（风险等级 + 归类建议 + 收集到的 4 项答案） */
interface ScResult {
  riskLevel: string
  riskLabel: string
  advice: string
  symptomInfo: Array<{ label: string; value: string }>
}

/**
 * 症状初筛弹窗卡片组件
 * 自包含读取当前宠物；4 步勾选，完成后组装结果卡并回传父级
 */
export default function SymptomCheckPopup({ open, onClose, onComplete }: SymptomCheckPopupProps) {
  const pet = usePetStore(s => s.currentPet)

  const [stepType, setStepType] = useState<ScStepType>('steps')
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ScResult | null>(null)

  const reset = useCallback(() => {
    setStepType('steps')
    setStepIndex(0)
    setAnswers({})
    setResult(null)
  }, [])

  // 每次打开时重置到第一步（与 CheckinPopup 同模式：open 翻转触发）
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  /**
   * 根据 4 个答案组装风险等级与结果卡
   * 口径对齐旧 useSymptomFlow.finishSymptomCheck：只看严重程度定档
   */
  const buildResult = useCallback((a: Record<string, string>): ScResult => {
    const severity = a.severity || ''
    let riskLevel = 'low'
    let riskLabel = '暂不严重'
    let advice = '👍 看起来暂时不严重，继续观察即可。保持正常饮食和作息。'

    if (severity.includes('非常严重')) {
      riskLevel = 'critical'
      riskLabel = '紧急'
      advice = '🚨 症状紧急！建议立即带它前往最近的宠物医院。不要等待，不要自行用药。'
    } else if (severity.includes('比较严重')) {
      riskLevel = 'high'
      riskLabel = '建议尽快就医'
      advice = '⚠ 症状比较明显，建议24小时内去看兽医。暂时保持安静，提供充足的清水。'
    } else if (severity.includes('中等')) {
      riskLevel = 'mid'
      riskLabel = '可先观察'
      advice = '⚡ 可以先在家观察1-2天。如果症状加重再考虑就医。'
    }

    return {
      riskLevel,
      riskLabel,
      advice,
      symptomInfo: [
        { label: '主要症状', value: a.symptom || '-' },
        { label: '持续时间', value: a.duration || '-' },
        { label: '严重程度', value: severity || '-' },
        { label: '其他', value: a.other || '-' },
      ],
    }
  }, [])

  /** 选择某一步的选项：记录答案，自动前进；最后一步选完直接出结果 */
  const handleSelect = useCallback((key: string, option: string) => {
    const next = { ...answers, [key]: option }
    setAnswers(next)
    if (stepIndex < SC_STEPS.length - 1) {
      setStepIndex(stepIndex + 1)
    } else {
      setResult(buildResult(next))
      setStepType('result')
    }
  }, [answers, stepIndex, buildResult])

  /** 上一步：回到前一题（结果页回到最后一道题） */
  const handlePrev = useCallback(() => {
    if (stepType === 'result') {
      setStepType('steps')
      setStepIndex(SC_STEPS.length - 1)
      return
    }
    if (stepIndex > 0) setStepIndex(stepIndex - 1)
  }, [stepIndex, stepType])

  /** 完成按钮：回传结果消息到聊天流 + 关闭 */
  const handleDone = useCallback(() => {
    if (!result) return
    const card: CardData = {
      type: 'symptom_result',
      data: {},
      title: '📋 症状评估报告',
      riskLevel: result.riskLevel,
      risk: result.riskLabel,
      symptomInfo: result.symptomInfo,
      advice: result.advice,
      hospitalList:
        result.riskLevel === 'critical' || result.riskLevel === 'high'
          ? ['🏥 瑞鹏宠物医院 · 1.2km', '🏥 美联众合 · 2.5km', '🏥 芭比堂 · 3.1km']
          : undefined,
    }
    const summary = `初筛完成 ✦\n\n风险等级：${result.riskLabel}`
    reset()
    onComplete({ type: 'ai', content: summary, card })
    onClose()
  }, [onClose, onComplete, reset, result])

  /** 关闭卡片：进行中需确认放弃，防止误触丢数据 */
  const handleClose = useCallback(() => {
    if (stepType === 'result') {
      onClose()
      return
    }
    const answered = Object.keys(answers).length
    if (answered > 0) {
      Taro.showModal({
        title: '放弃本次初筛？',
        content: '已选择的内容不会被保存',
        confirmText: '放弃',
        cancelText: '继续',
        success: (res) => { if (res.confirm) onClose() },
      })
      return
    }
    onClose()
  }, [answers, onClose, stepType])

  if (!open) return null

  const currentStep = SC_STEPS[stepIndex]
  const answeredCount = Object.keys(answers).length
  const isResultView = stepType === 'result'

  return (
    <View className='scp-overlay' onClick={handleClose}>
      {/*
        防滚动穿透层：catchMove 会编译成 catchtouchmove（Taro 把节点换成 catch-view，
        产物见 dist/base.wxml 的 tmpl_0_0），而 catchtouchmove 挂在内层滚动区的「祖先」上时，
        微信 WebView 渲染器下 scroll-view 会出现「有进度条却滑不动」的现象
        —— 所以它必须是卡片的「兄弟」而不是「祖先」，卡片内 2 个 ScrollView 的祖先链上不能再有 catchMove。
        本层不绑 onClick：点深色区域的点击照样冒泡到 .scp-overlay 触发 handleClose，关闭行为与改动前一致。
      */}
      <View className='scp-mask' catchMove />
      <View className='scp-card' onClick={(e: any) => e.stopPropagation()}>
        {/* 关闭按钮 */}
        <View className='scp-close' onClick={handleClose}>
          <Text>✕</Text>
        </View>

        {/* ===== 步骤：逐题勾选 ===== */}
        {!isResultView && (
          <>
            {/* 卡片内「非滚动区」补 catchMove（.scp-head / .scp-footer 两个步骤统一加）：
                它们内部只有 View / Text，确认不含任何 ScrollView，
                所以加 catchMove 不会踩「catchMove 祖先阻断内层 scroll-view」这个坑，
                但能兜住手指在标题区/底部按钮区拖动时的滚动穿透。 */}
            <View className='scp-head' catchMove>
              <Text className='scp-head-icon'>🩺</Text>
              <Text className='scp-head-title'>{pet?.name ? `${pet.name}的症状初筛` : '症状初筛'}</Text>
              <Text className='scp-head-sub'>点一点就能完成，大概 10 秒</Text>
            </View>

            <ScrollView className='scp-body' scrollY enhanced showScrollbar={false}>
              <View className='scp-body-inner'>
                {/* 进度指示 */}
                <View className='scp-progress-dots'>
                  {SC_STEPS.map((s, i) => (
                    <View key={s.key} className={`scp-progress-dot ${i <= stepIndex ? 'scp-progress-dot--active' : ''}`} />
                  ))}
                  <Text className='scp-progress-text'>第 {stepIndex + 1}/{SC_STEPS.length} 步</Text>
                </View>

                <View className='scp-q'>
                  <Text className='scp-q-emoji'>{currentStep.emoji}</Text>
                  <Text className='scp-q-title'>{currentStep.title}</Text>
                  <Text className='scp-q-question'>{currentStep.question}</Text>
                </View>
                <View className='scp-opts'>
                  {currentStep.options.map(opt => (
                    <View
                      key={opt}
                      className={`scp-opt ${answers[currentStep.key] === opt ? 'scp-opt--active' : ''}`}
                      onClick={() => handleSelect(currentStep.key, opt)}
                      hoverClass='scp-opt--hover'
                    >
                      <Text>{opt}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>

            <View className='scp-footer' catchMove>
              <View
                className={`scp-back-btn ${stepIndex === 0 ? 'scp-back-btn--disabled' : ''}`}
                onClick={handlePrev}
              >
                <Text>‹ 上一步</Text>
              </View>
              <Text className='scp-progress-label'>
                {answeredCount >= SC_STEPS.length ? '全部就绪 ✦' : `还剩 ${SC_STEPS.length - answeredCount} 项`}
              </Text>
            </View>
          </>
        )}

        {/* ===== 结果页 ===== */}
        {isResultView && result && (
          <>
            <View className='scp-head' catchMove>
              <Text className='scp-head-icon'>📋</Text>
              <Text className='scp-head-title'>症状评估报告</Text>
              <Text className='scp-head-sub'>已生成初筛结论</Text>
            </View>
            <ScrollView className='scp-body scp-body--result' scrollY enhanced showScrollbar={false}>
              <View className='scp-body-inner'>
                <View className={`scp-risk scp-risk--${result.riskLevel}`}>
                  <Text className='scp-risk-label'>{result.riskLabel}</Text>
                </View>
                <Text className='scp-result-advice'>{result.advice}</Text>
                {result.symptomInfo.map(info => (
                  <View key={info.label} className='scp-stat'>
                    <Text className='scp-stat-label'>{info.label}</Text>
                    <Text className='scp-stat-val'>{info.value}</Text>
                  </View>
                ))}
                <View className='scp-hint-msg'>
                  <Text>报告已同步到聊天，随时可以回看～</Text>
                </View>
              </View>
            </ScrollView>
            <View className='scp-footer' catchMove>
              <View className='scp-submit' hoverClass='scp-submit--hover' onClick={handleDone}>
                <Text>收下啦 ✨</Text>
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  )
}
