/**
 * 健康打卡弹窗卡片
 *
 * 替代旧的"逐条聊天问答"打卡流程：旧流程一次打卡会向聊天流注入十余条消息
 * （开场白 + 5 问 × 问题/回答 + 报告卡），把聊天撑得非常长。
 * 现在全部流程（多宠选择 → 5 项指标勾选 → 提交落库 → 结果展示）都在卡片内完成，
 * 完成后仅通过 onComplete 向聊天流追加一条结果卡消息。
 *
 * 多宠连续打卡（单只异常场景）：
 * 打开时并行查询各宠物今日打卡状态，列表带 ✓ 标记与剩余计数；
 * 先给状态不好的那只逐项勾选提交，结果页可「继续给剩余 N 只打卡」回到列表，
 * 再一键批量正常——避免"某一只状态不好却被全部正常"误伤，也无需反复开关弹窗。
 */
import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { usePetStore, type PetProfile } from '../../stores/petStore'
import { useAuthStore } from '../../stores/authStore'
import {
  batchCreateCheckins,
  createCheckin,
  getTodayCheckin,
  type CheckinInput,
} from '../../services/checkinService'
import type { CardData } from '../../types/chatTypes'
import './index.scss'

/** 弹窗内打卡选项：score 参与评分展示；input 为落库等级映射（口径对齐 checkinService.CheckinInput 与独立打卡页） */
interface CkOption {
  label: string
  score: number
  /** 落库字段映射（缺省 = 该选项不影响对应等级，落库取中性默认值） */
  input?: Partial<Pick<CheckinInput, 'poopLevel' | 'appetiteLevel' | 'spiritLevel' | 'exerciseLevel'>>
  /** 是否异常信号：计入 hasAnomaly / anomalyItems，影响服务端风险评级与记忆引擎 */
  abnormal?: boolean
  /** 追加到打卡备注的文本（小便/体重没有独立等级字段，用 note 记录供 AI/趋势参考） */
  note?: string
}

/** 弹窗内打卡单项配置（题目文案沿用旧聊天问答，去掉 {name} 占位——宠物名在卡片头部展示） */
interface CkItem {
  key: string
  emoji: string
  label: string
  question: string
  /** 异常时写入 anomalyItems 的枚举值（对齐 memory-body AnomalyItem 类型） */
  anomalyKey: 'poop' | 'appetite' | 'spirit' | 'exercise' | 'weight' | 'other'
  options: CkOption[]
}

const CHECKIN_ITEMS: CkItem[] = [
  {
    key: 'stool', emoji: '💩', label: '大便情况', question: '今天的大便怎么样？', anomalyKey: 'poop',
    options: [
      // poopLevel 口径对齐独立打卡页：3=正常、4=偏软、2=腹泻（1=带血本流程不涉及）
      { label: '成型正常', score: 5, input: { poopLevel: 3 } },
      { label: '偏软但不稀', score: 3, input: { poopLevel: 4 } },
      // 拉稀属于异常信号：poopLevel=2 会触发服务端 warning 风险评级
      { label: '拉稀/软便', score: 1, input: { poopLevel: 2 }, abnormal: true },
      { label: '没拉 / 未观察', score: 0 },
    ],
  },
  {
    key: 'pee', emoji: '💧', label: '小便情况', question: '小便颜色和频率正常吗？', anomalyKey: 'other',
    options: [
      { label: '清亮，次数正常', score: 5 },
      // 小便无独立等级字段，异常信号写入备注 + anomalyItems
      { label: '颜色偏黄', score: 3, note: '小便: 颜色偏黄' },
      { label: '频次异常', score: 1, note: '小便: 频次异常', abnormal: true },
      { label: '没注意', score: 0 },
    ],
  },
  {
    key: 'appetite', emoji: '🍖', label: '食欲状况', question: '今天吃饭怎么样？', anomalyKey: 'appetite',
    options: [
      // appetiteLevel 口径：1=不吃 2=少吃 3=正常 4=多吃（5=呕吐/6=亢进本流程不涉及）
      { label: '胃口很好，光盘', score: 5, input: { appetiteLevel: 4 } },
      { label: '正常吃完', score: 4, input: { appetiteLevel: 3 } },
      { label: '吃得比较少', score: 2, input: { appetiteLevel: 2 }, abnormal: true },
      { label: '完全不吃', score: 1, input: { appetiteLevel: 1 }, abnormal: true },
    ],
  },
  {
    key: 'energy', emoji: '⚡', label: '精神活力', question: '今天精神头怎么样？', anomalyKey: 'spirit',
    options: [
      // spiritLevel：1=萎靡 2=低落 3=正常 4=活跃 5=亢奋；exerciseLevel 由活力档位顺带推导
      { label: '活力满满，拆家选手', score: 5, input: { spiritLevel: 4, exerciseLevel: 3 } },
      { label: '正常活动', score: 4, input: { spiritLevel: 3, exerciseLevel: 2 } },
      { label: '有点蔫，不太想动', score: 2, input: { spiritLevel: 2, exerciseLevel: 1 }, abnormal: true },
      { label: '趴着不动，精神差', score: 1, input: { spiritLevel: 1, exerciseLevel: 1 }, abnormal: true },
    ],
  },
  {
    key: 'weight', emoji: '⚖', label: '体重确认', question: '体重今天称了吗？', anomalyKey: 'weight',
    options: [
      // 体重趋势暂无数值输入，写入备注；明显下降算轻度关注项但不标异常（避免误报风险升级）
      { label: '体重稳定', score: 5, note: '体重: 稳定' },
      { label: '小幅下降', score: 3, note: '体重: 小幅下降' },
      { label: '小幅上升', score: 3, note: '体重: 小幅上升' },
      { label: '今天没称', score: 0 },
    ],
  },
]

/** 卡片内部步骤：选宠物 → 填表单 → 看结果（单宠场景直接从 form 开始） */
type CheckinStep = 'pet' | 'form' | 'result'

/** 打卡完成后回传给聊天流的消息负载（card 缺省 = 批量打卡等纯文本结果） */
export interface CheckinCompletePayload {
  type: 'ai'
  content: string
  card?: CardData
}

export interface CheckinPopupProps {
  /** 是否显示弹窗（由父级控制开关） */
  open: boolean
  /** 关闭弹窗（用户主动取消或完成后收起） */
  onClose: () => void
  /** 打卡完成并关闭卡片后回调：父级负责往聊天流加一条结果消息并刷新今日摘要 */
  onComplete: (payload: CheckinCompletePayload) => void
}

/**
 * 健康打卡弹窗卡片组件
 * 自包含读取宠物列表与登录态；提交走 createCheckin 真实落库（云端失败自动本地兜底）
 */
export default function CheckinPopup({ open, onClose, onComplete }: CheckinPopupProps) {
  const pets = usePetStore(s => s.pets)
  const user = useAuthStore(s => s.user)

  const [step, setStep] = useState<CheckinStep>('form')
  const [targetPetId, setTargetPetId] = useState('')
  const [answers, setAnswers] = useState<Record<string, CkOption>>({})
  const [submitting, setSubmitting] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [resultPayload, setResultPayload] = useState<CheckinCompletePayload | null>(null)
  const [resultFeedback, setResultFeedback] = useState<{ text: string; riskLevel: string } | null>(null)
  /** 今日各宠物是否已打卡（打开时并行查询；单只提交/批量成功后增量更新） */
  const [checkedToday, setCheckedToday] = useState<Record<string, boolean>>({})

  /** 当前打卡的目标宠物（表单头部展示用） */
  const targetPet = pets.find(p => p.id === targetPetId) ?? pets[0] ?? null

  /** 今日尚未打卡的宠物数：宠物选择步骤的剩余提示、批量按钮文案、结果页"继续打卡"按钮统一口径 */
  const uncheckedCount = pets.filter(p => !checkedToday[p.id]).length

  /** 每次打开时重置状态：单宠直接进表单，多宠先选宠物 */
  useEffect(() => {
    if (!open) return
    setAnswers({})
    setSubmitting(false)
    setBatchRunning(false)
    setResultPayload(null)
    setResultFeedback(null)
    setCheckedToday({})
    setTargetPetId(usePetStore.getState().currentPet?.id || pets[0]?.id || '')
    setStep(pets.length > 1 ? 'pet' : 'form')
    // 多宠打开时并行查询今日打卡状态：宠物列表带 ✓ 标记、批量按钮只面向未打卡宠物，
    // 避免"某一只状态不好却被一键全部正常"误伤（单宠直接进表单无需查询）
    const uid = user?.id
    if (pets.length > 1 && uid) {
      // Promise.resolve 防御：异常/非 Promise 返回值一律视为未打卡，不阻塞打开
      Promise.all(pets.map(p => Promise.resolve(getTodayCheckin(p.id, uid)).catch(() => null)))
        .then(results => {
          // 合并时保留已提交标记：查询是打开瞬间的快照，若期间用户已完成某只打卡，
          // 不得用旧快照（null）把它的 ✓ 打回未打卡（异步竞态）
          setCheckedToday(prev => {
            const next = { ...prev }
            pets.forEach((p, i) => {
              if (!next[p.id]) next[p.id] = !!results[i]
            })
            return next
          })
        })
    }
    // 仅在打开瞬间做一次初始化；pets 变化不重置进行中的打卡
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** 已回答项数（用于进度提示与提交按钮可用态） */
  const answeredCount = CHECKIN_ITEMS.filter(it => answers[it.key]).length

  /**
   * 把卡内勾选结果映射为服务端 CheckinInput：
   * 未提供等级映射的项取中性默认值（便便3/食欲3/精神3/运动2，与独立打卡页默认一致）
   */
  const buildCheckinInput = useCallback((petId: string): CheckinInput => {
    const selected = CHECKIN_ITEMS.map(it => ({ item: it, option: answers[it.key] })).filter(e => e.option)
    const abnormalOpts = selected.filter(e => e.option!.abnormal)
    const notes = selected.map(e => e.option!.note).filter(Boolean)
    const merged: Partial<Pick<CheckinInput, 'poopLevel' | 'appetiteLevel' | 'spiritLevel' | 'exerciseLevel'>> = {}
    selected.forEach(e => Object.assign(merged, e.option!.input))
    return {
      petId,
      userId: user?.id ?? '',
      poopLevel: merged.poopLevel ?? 3,
      appetiteLevel: merged.appetiteLevel ?? 3,
      spiritLevel: merged.spiritLevel ?? 3,
      exerciseLevel: merged.exerciseLevel ?? 2,
      hasAnomaly: abnormalOpts.length > 0,
      // anomalyItems 落枚举值（poop/appetite/spirit/weight/other），具体描述走 note，供 AI/趋势参考
      anomalyItems: abnormalOpts.map(e => e.item.anomalyKey),
      note: notes.length > 0 ? notes.join('；') : undefined,
    }
  }, [answers, user?.id])

  /** 勾选某一项（同组单选语义：重复点击同一选项为覆盖，无取消——与旧问答流程一致） */
  const handleSelectOption = useCallback((itemKey: string, option: CkOption) => {
    setAnswers(prev => ({ ...prev, [itemKey]: option }))
  }, [])

  /** 提交打卡：真实落库 → 计分 → 组装结果视图与聊天消息负载 */
  const handleSubmit = useCallback(async () => {
    if (submitting || !targetPet) return
    // 未答完不允许提交（按钮禁用态只是视觉，这里兜底拦截）：
    // 缺项若静默按中性默认值落库会把"未观察"伪装成"正常"，污染健康数据与趋势
    if (answeredCount < CHECKIN_ITEMS.length) {
      Taro.showToast({ title: `还有 ${CHECKIN_ITEMS.length - answeredCount} 项未选`, icon: 'none' })
      return
    }
    if (!user?.id) {
      Taro.showToast({ title: '请先登录后再打卡', icon: 'none' })
      return
    }
    setSubmitting(true)
    try {
      const entry = await createCheckin(buildCheckinInput(targetPet.id))
      // 提交成功即标记今日已打卡：结果页据此提示"剩余 N 只"，批量按钮不再包含本只
      setCheckedToday(prev => ({ ...prev, [targetPet.id]: true }))

      // 评分口径与旧聊天流程一致：各选项 score 求和 / 满分(5×5) 取百分比
      const total = CHECKIN_ITEMS.reduce((s, it) => s + (answers[it.key]?.score ?? 0), 0)
      const rate = Math.round((total / (CHECKIN_ITEMS.length * 5)) * 100)
      const stats = CHECKIN_ITEMS.map(it => ({
        label: it.label,
        value: answers[it.key]?.label ?? '--',
        emoji: it.emoji,
      }))
      const card: CardData = {
        type: 'checkin_result',
        data: {},
        title: '📊 今日健康报告',
        score: rate,
        maxScore: 100,
        stats,
      }
      let summary = `${targetPet.name}的打卡完成！健康报告出炉 ✦`
      if (rate >= 90) summary += '\n\n太棒了！状态满分 ✦ 继续保持！'
      else if (rate >= 70) summary += '\n\n整体还不错！有些项目需要注意一下～'
      else summary += '\n\n状态不太理想，建议多观察。可以做个症状初筛看看。'
      // 高风险信号在聊天消息里显式提示（aiFeedback 由服务端按风险评级生成）
      if (entry.riskLevel === 'high' || entry.riskLevel === 'emergency') {
        summary += `\n\n⚠️ ${entry.aiFeedback || '检测到需要关注的健康信号，建议尽快咨询兽医。'}`
      }

      setResultPayload({ type: 'ai', content: summary, card })
      setResultFeedback({ text: entry.aiFeedback || '', riskLevel: entry.riskLevel })
      setStep('result')
    } catch {
      Taro.showToast({ title: '打卡失败，请重试', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }, [answers, answeredCount, buildCheckinInput, submitting, targetPet, user?.id])

  /** 多宠一键打卡：为今天还没打卡的宠物批量提交"全部正常"默认指标（迁移自旧 useCheckinFlow） */
  const runBatchCheckin = useCallback(async () => {
    const userId = useAuthStore.getState().user?.id
    if (!userId || pets.length === 0) {
      Taro.showToast({ title: '还没有可打卡的宠物', icon: 'none' })
      return
    }
    setBatchRunning(true)
    try {
      // 只批量处理今天尚未打卡的宠物：已 ✓（打开时查询或单只已提交）的直接跳过，
      // 不重复查询也不重复记录；剩余的逐个向云端复核后提交
      const candidates = pets.filter(p => !checkedToday[p.id])
      const unchecked: PetProfile[] = []
      for (const p of candidates) {
        const today = await getTodayCheckin(p.id, userId)
        if (!today) unchecked.push(p)
      }
      if (unchecked.length === 0) {
        Taro.showToast({ title: '今天都打过卡啦 🎉', icon: 'none' })
        return
      }
      await batchCreateCheckins(unchecked.map(p => ({
        petId: p.id,
        userId,
        poopLevel: 3,
        appetiteLevel: 3,
        spiritLevel: 3,
        exerciseLevel: 2,
        hasAnomaly: false,
        anomalyItems: [],
      })))
      // 批量成功后同步标记，宠物列表/继续按钮状态保持一致
      setCheckedToday(prev => {
        const next = { ...prev }
        unchecked.forEach(p => { next[p.id] = true })
        return next
      })
      setResultPayload({
        type: 'ai',
        content: `搞定！已为 ${unchecked.length} 只毛孩子完成打卡 ✦\n\n${unchecked.map(p => p.name).join('、')} 今天都是满分状态！`,
      })
      setStep('result')
    } catch {
      Taro.showToast({ title: '批量打卡失败，请重试', icon: 'none' })
    } finally {
      setBatchRunning(false)
    }
  }, [checkedToday, pets])

  /** 结果页"继续给剩余宠物打卡"：先回传本只结果卡到聊天，再回到宠物选择（同会话连续打卡） */
  const handleContinue = useCallback(() => {
    if (!resultPayload) return
    const payload = resultPayload
    setResultPayload(null)
    setResultFeedback(null)
    setAnswers({})
    setSubmitting(false)
    setTargetPetId('')
    setStep('pet')
    onComplete(payload)
  }, [onComplete, resultPayload])

  /** 关闭卡片：已完成则回传结果消息；表单填了一半需确认放弃，防止误触丢数据 */
  const handleClose = useCallback(() => {
    if (submitting || batchRunning) return
    if (resultPayload) {
      // 先同步置空防重入：快速双击"收下啦"/遮罩不会向聊天重复插入结果卡
      const payload = resultPayload
      setResultPayload(null)
      onComplete(payload)
      onClose()
      return
    }
    if (step === 'form' && answeredCount > 0) {
      Taro.showModal({
        title: '放弃本次打卡？',
        content: '已勾选的内容不会被保存',
        confirmText: '放弃',
        cancelText: '继续打',
        success: (res) => {
          if (res.confirm) onClose()
        },
      })
      return
    }
    onClose()
  }, [answeredCount, batchRunning, onComplete, onClose, resultPayload, step, submitting])

  if (!open) return null

  return (
    <View className='ckp-overlay' onClick={handleClose}>
      {/*
        防滚动穿透层：catchMove 会编译成 catchtouchmove（Taro 把节点换成 catch-view，
        产物见 dist/base.wxml 的 tmpl_0_0），而 catchtouchmove 挂在内层滚动区的「祖先」上时，
        微信 WebView 渲染器下 scroll-view 会出现「有进度条却滑不动」的现象
        —— 所以它必须是卡片的「兄弟」而不是「祖先」，卡片内 3 个 ScrollView 的祖先链上不能再有 catchMove。
        本层不绑 onClick：点深色区域的点击照样冒泡到 .ckp-overlay 触发 handleClose，关闭行为与改动前一致。
      */}
      <View className='ckp-mask' catchMove />
      <View className='ckp-card' onClick={(e: any) => e.stopPropagation()}>
        {/* 关闭按钮 */}
        <View className='ckp-close' onClick={handleClose}>
          <Text>✕</Text>
        </View>

        {/* ===== 步骤一：多宠选择（单宠跳过） ===== */}
        {step === 'pet' && (
          <>
            {/* 卡片内「非滚动区」补 catchMove（.ckp-head / .ckp-footer 本步骤及后续步骤统一加）：
                它们内部只有 View / Text，确认不含任何 ScrollView，
                所以加 catchMove 不会踩「catchMove 祖先阻断内层 scroll-view」这个坑，
                但能兜住手指在标题区/按钮区拖动时的滚动穿透。 */}
            <View className='ckp-head' catchMove>
              <Text className='ckp-head-icon'>📋</Text>
              <Text className='ckp-head-title'>要为谁打卡？</Text>
              <Text className='ckp-head-sub'>
                {uncheckedCount > 0 ? `今天还有 ${uncheckedCount} 只没打卡` : '今天都已打卡，可以安心休息 🎉'}
              </Text>
            </View>
            <ScrollView className='ckp-pet-scroll' scrollY enhanced showScrollbar={false}>
              <View className='ckp-pet-list'>
                {pets.map(p => {
                  const done = !!checkedToday[p.id]
                  return (
                    <View
                      key={p.id}
                      className={`ckp-pet-chip ${p.id === targetPetId ? 'ckp-pet-chip--active' : ''} ${done ? 'ckp-pet-chip--done' : ''}`}
                      hoverClass='ckp-pet-chip--hover'
                      onClick={() => {
                        // 已打卡宠物点击拦截：防误以为还能重打，避免同一天重复记录
                        if (done) {
                          Taro.showToast({ title: '今天已经打过卡啦', icon: 'none' })
                          return
                        }
                        setTargetPetId(p.id)
                        setStep('form')
                      }}
                    >
                      <Text className='ckp-pet-chip-emoji'>{p.species === 'cat' ? '🐱' : p.species === 'dog' ? '🐕' : '🐾'}</Text>
                      <Text className='ckp-pet-chip-name'>{p.name}</Text>
                      {done && <Text className='ckp-pet-chip-check'>✓</Text>}
                    </View>
                  )
                })}
              </View>
            </ScrollView>
            <View className='ckp-batch-btn' hoverClass='ckp-batch-btn--hover' onClick={runBatchCheckin}>
              <Text>
                {batchRunning
                  ? '打卡中...'
                  : uncheckedCount === 0
                    ? '🐾 今天都打过卡啦 🎉'
                    : `🐾 剩余 ${uncheckedCount} 只全部正常，一键打卡`}
              </Text>
            </View>
          </>
        )}

        {/* ===== 步骤二：五项指标勾选表单 ===== */}
        {step === 'form' && targetPet && (
          <>
            <View className='ckp-head' catchMove>
              <Text className='ckp-head-icon'>📋</Text>
              <Text className='ckp-head-title'>
                {targetPet.name}的健康打卡
              </Text>
              <Text className='ckp-head-sub'>点一点就能完成，大概 10 秒</Text>
            </View>

            <ScrollView className='ckp-body' scrollY enhanced showScrollbar={false}>
              {/* scroll-view 上不支持 padding（webview 渲染模式），间距放内部容器 */}
              <View className='ckp-body-inner'>
                {CHECKIN_ITEMS.map(item => (
                  <View key={item.key} className='ckp-item'>
                    <View className='ckp-item-q'>
                      <Text className='ckp-item-emoji'>{item.emoji}</Text>
                      <Text className='ckp-item-label'>{item.label}</Text>
                      <Text className='ckp-item-question'>{item.question}</Text>
                    </View>
                    <View className='ckp-opts'>
                      {item.options.map(opt => (
                        <View
                          key={opt.label}
                          className={`ckp-opt ${answers[item.key]?.label === opt.label ? 'ckp-opt--active' : ''}`}
                          onClick={() => handleSelectOption(item.key, opt)}
                          hoverClass='ckp-opt--hover'
                        >
                          <Text>{opt.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* 底部进度 + 提交 */}
            <View className='ckp-footer' catchMove>
              <Text className='ckp-progress'>
                {answeredCount >= CHECKIN_ITEMS.length
                  ? '全部就绪 ✦'
                  : `还剩 ${CHECKIN_ITEMS.length - answeredCount} 项`}
              </Text>
              <View
                className={`ckp-submit ${answeredCount >= CHECKIN_ITEMS.length && !submitting ? '' : 'ckp-submit--disabled'}`}
                hoverClass='ckp-submit--hover'
                onClick={handleSubmit}
              >
                <Text>{submitting ? '提交中...' : '✅ 完成打卡'}</Text>
              </View>
            </View>
          </>
        )}

        {/* ===== 步骤三：结果展示（评分报告 / 批量成功） ===== */}
        {step === 'result' && resultPayload && (
          <>
            <View className='ckp-head' catchMove>
              <Text className='ckp-head-icon'>🎉</Text>
              <Text className='ckp-head-title'>{resultPayload.card ? '今日健康报告' : '打卡完成'}</Text>
              <Text className='ckp-head-sub'>已记录到健康档案</Text>
            </View>
            <ScrollView className='ckp-body ckp-body--result' scrollY enhanced showScrollbar={false}>
              {/* scroll-view 上不支持 padding（webview 渲染模式），间距放内部容器 */}
              <View className='ckp-body-inner'>
                {resultPayload.card?.score !== undefined && (
                  <>
                    <View className='ckp-score'>
                      {[1, 2, 3, 4, 5].map(i => (
                        <Text key={i} className='ckp-star'>
                          {i <= Math.round(resultPayload.card!.score! / 20) ? '★' : '☆'}
                        </Text>
                      ))}
                      <Text className='ckp-score-num'>{resultPayload.card.score} 分</Text>
                    </View>
                    {resultPayload.card.stats?.map(stat => (
                      <View key={stat.label} className='ckp-stat'>
                        <Text className='ckp-stat-label'>{stat.emoji || ''} {stat.label}</Text>
                        <Text className='ckp-stat-val'>{stat.value}</Text>
                      </View>
                    ))}
                  </>
                )}
                {/* 服务端风险反馈：低风险绿色安抚，中风险金色提示，高风险红色警示 */}
                {resultFeedback?.text && (
                  <View className={`ckp-feedback ckp-feedback--${resultFeedback.riskLevel}`}>
                    <Text>{resultFeedback.text}</Text>
                  </View>
                )}
                <View className='ckp-hint-msg'>
                  <Text>报告已同步到聊天，随时可以回看～</Text>
                </View>
              </View>
            </ScrollView>
            <View className='ckp-footer' catchMove>
              {uncheckedCount > 0 && (
                <View className='ckp-continue' hoverClass='ckp-continue--hover' onClick={handleContinue}>
                  <Text>继续给剩余 {uncheckedCount} 只打卡 ›</Text>
                </View>
              )}
              <View className='ckp-submit' hoverClass='ckp-submit--hover' onClick={handleClose}>
                <Text>收下啦 ✨</Text>
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  )
}
