/**
 * 效果追踪页面
 * AI 干预效果统计与展示：建议采纳率 / 随访响应与改善率 / 情绪波动 / 宠物健康分 /
 * 近 7 天使用统计 / AI 建议记录列表
 *
 * 【2026-09-11 数据口径修正】本页此前有多处"看起来是数据、实为假数据或口径不符"的地方，
 * 逐一改掉（原因写在各自的行内注释里）：
 *   1. 情绪指标语义反了：getEmotionScore 的语义是「情绪异常强度」——越高代表近期异常越多越重，
 *      同一套服务里 ≥70 就触发危机干预、≥90 判定 severe；页面却按「情绪健康分」（越高越好）
 *      展示，还用 `|| 50` 兜底 —— 没数据时凭空显示 50 分，真出问题时反而显示高分。
 *      现改名为「情绪波动」并如实取数，无事件时显示 --。
 *   2. 宠物健康趋势写死：`trend: pet.id === 'pet_001' ? 'stable' : 'up'`，
 *      除 id 恰为 pet_001 的宠物外永远显示"上升"。现按连续异常/连续打卡天数真实推导。
 *   3. 情绪分只取 pets[0]：多宠家庭下其余宠物完全不参与。现取波动最高的那只并标注宠物名。
 *   4. 「AI 对话」一栏恒为占位符 "--"（前端无任何对话计数数据源）。现换成真实可得的打卡计数。
 *   5. 采纳率只统计 feeding 类型，而下方列表含 4 种类型，两处对不上。现按全部类型统计。
 *   6. 无数据显示成 0：随访/改善率没有记录时显示 0%，与"真的是 0"无法区分。现显示 --。
 *   7. 健康分：没打卡记录时恒为 50 分（凭空分数），且"打卡次数越多分越高" ——
 *      打卡是用户行为、不是宠物健康状态。现无数据返回 null（显示 --），并去掉打卡次数加分。
 *   8. 建议列表请求失败返回 []，页面显示"暂无记录"，把失败伪装成正常空态。现区分失败并可重试。
 *   9. 「+ 生成建议」写入的是硬编码文案（后端并无 AI 建议生成能力），且只针对 pets[0]，
 *      会污染采纳率统计 → 已移除该按钮。
 */
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { usePetStore } from '../../stores/petStore'
import { getFollowupStats } from '../../services/notificationService'
import { getEmotionScore, getEmotionTrend, getEmotionEventCount } from '../../services/emotionTrackingService'
import type { EmotionTrend } from '../../services/emotionTrackingService'
import { getRecentFoodQueryCount, getRecentSymptomCheckCount } from '../../utils/usageTracking'
import { getCheckinStats } from '../../services/checkinService'
import { getSuggestionRecords, updateSuggestionAdoption, deleteSuggestionRecord } from '../../services/suggestionRecordsService'
import type { SuggestionRecord } from '../../services/suggestionRecordsService'
import type { PetProfile } from '../../services/petService'
import './index.scss'
import { PageBackground, Icon  } from '../../components'

/** 单只宠物的健康分条目 */
interface PetScore {
  pet: PetProfile
  /** 健康分；null = 该宠物还没有打卡记录（不编造分数） */
  score: number | null
  /** 趋势：由真实打卡统计推导，见 resolveHealthTrend */
  trend: 'up' | 'down' | 'stable'
  /** 连续打卡天数：没有趋势可讲时给出一个真实、可解释的数字 */
  streak: number
  /** 该宠物的打卡记录总数（判定"有没有打过卡"，以及汇总"近 7 天使用统计"） */
  totalCheckins: number
  /** 本周打卡次数（"近 7 天使用统计"用这个口径，而不是终身总数） */
  weeklyCount: number
}

interface EffectStats {
  adviceAdopted: number
  adviceTotal: number
  /** 随访响应率；null = 还没有随访记录（不是 0%） */
  followupResponseRate: number | null
  /** 健康改善率；null = 还没有随访反馈（不是 0%） */
  followupBetterRate: number | null
  followupTotal: number
  foodQueryCount: number
  symptomCheckCount: number
  /** 近 7 天的打卡次数（与同栏的食物查询/症状筛查同一时间窗口） */
  checkinTotal: number
  /** 情绪波动指数；null = 近 7 天没有任何情绪事件 */
  emotionScore: number | null
  emotionTrend: EmotionTrend
  /** 情绪分取自哪只宠物（多宠时标明，避免"这个分是谁的"） */
  emotionPetName: string
  petScores: PetScore[]
}

function getTrendLabel(trend: string): string {
  switch (trend) {
    case 'up': return '上升'
    case 'down': return '下降'
    case 'stable': return '稳定'
    case 'improving': return '改善中'
    case 'worsening': return '需关注'
    default: return '稳定'
  }
}

/**
 * 建议记录的日期文案
 *
 * 接口历史上出现过字段缺失 / 大小写错位（见 suggestionRecordsService 的注释），
 * 一旦 createdAt 为空，`new Date('').toLocaleDateString()` 会渲染成 "Invalid Date"。
 * 这里空值与非合法日期都如实显示 --，不再把脏数据显示给用户。
 */
function formatSuggestionDate(iso: string): string {
  if (!iso) return '--'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleDateString('zh-CN')
}

export default function EffectTrackingPage() {
  const { pets } = usePetStore()
  const [stats, setStats] = useState<EffectStats | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestionRecord[]>([])
  /** 建议记录是否加载失败：与"加载成功但没有记录"分开，避免把失败显示成空态 */
  const [suggestionsFailed, setSuggestionsFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const themeClass = useThemeClass()

  // 依赖用"宠物 id 串"而不是 pets 数组本身：store 每次更新都会换数组引用，
  // 直接依赖 pets 会在内容没变时也重复拉取接口
  const petsKey = useMemo(() => pets.map(p => p.id).join(','), [pets])

  const loadData = useCallback(async () => {
    setLoading(true)
    // 在回调内直接读 store 最新值（项目既有写法，见 pages/mine、pages/family），
    // 这样 loadData 可以保持空依赖的稳定引用，又不会读到过期的 pets
    const petList = usePetStore.getState().pets

    // ---- AI 建议记录 ----
    let allSuggestions: SuggestionRecord[] = []
    let failed = false
    if (petList.length > 0) {
      const results = await Promise.all(petList.map(p => getSuggestionRecords(p.id)))
      // null = 该宠物请求失败；[] = 请求成功但没记录。两者必须区分对待
      failed = results.some(r => r === null)
      allSuggestions = results.filter((r): r is SuggestionRecord[] => Array.isArray(r)).flat()
    }
    setSuggestions(allSuggestions)
    setSuggestionsFailed(failed)

    // ---- 采纳率：按全部类型统计（原来只算 feeding，与下方列表口径对不上）----
    const adviceTotal = allSuggestions.length
    const adviceAdopted = allSuggestions.filter(s => s.adopted).length

    // ---- 随访统计 ----
    const followupStats = getFollowupStats()
    // 门槛必须用"已发出 + 已回应"（= 服务端算比率时的分母），不能用 total：
    // scheduleFollowup 建档时状态就是 pending，"有计划但一条都没发出去"的时候
    // 比率分母为 0，此时显示 0% 属于把"没发过"说成"响应率为零"
    const followupDenominator = followupStats.sent + followupStats.responded
    const followupResponseRate = followupDenominator > 0 ? followupStats.responseRate : null
    const followupBetterRate = followupStats.responded > 0 ? followupStats.betterRate : null

    // ---- 情绪波动：取所有宠物中最高的一只（最需要关注的那只）----
    // 事件数为 0 表示该宠物近 7 天没有任何情绪事件 → 不参与统计；
    // 全部宠物都没有事件时保持 null，页面显示 --，而不是凭空给一个 50 分
    let emotionScore: number | null = null
    let emotionPetName = ''
    let emotionTrend: EmotionTrend = 'stable'
    for (const pet of petList) {
      if (getEmotionEventCount(pet.id) === 0) continue
      const score = getEmotionScore(pet.id)
      if (emotionScore === null || score > emotionScore) {
        emotionScore = score
        emotionPetName = pet.name
        emotionTrend = getEmotionTrend(pet.id)
      }
    }

    // ---- 逐宠健康分 ----
    // 用 Promise.all 的返回值收集结果：原来往闭包外的数组里 push，
    // loadData 被并发调用时两次结果会混进同一个数组
    const petScores = await Promise.all(petList.map(async (pet): Promise<PetScore> => {
      try {
        const checkinStats = await getCheckinStats(pet.id, pet.userId)
        return {
          pet,
          score: calculateScore(checkinStats),
          trend: resolveHealthTrend(checkinStats),
          streak: checkinStats.streak,
          totalCheckins: checkinStats.totalCheckins,
          weeklyCount: checkinStats.weeklyCount,
        }
      } catch {
        // 取不到统计时如实标记为"无数据"，不再编一个 50 分充数
        return { pet, score: null, trend: 'stable', streak: 0, totalCheckins: 0, weeklyCount: 0 }
      }
    }))

    setStats({
      adviceAdopted,
      adviceTotal,
      followupResponseRate,
      followupBetterRate,
      followupTotal: followupStats.total,
      foodQueryCount: getRecentFoodQueryCount(),
      symptomCheckCount: getRecentSymptomCheckCount(),
      // 用 weeklyCount 汇总而不是终身 totalCheckins：这一栏上面写的是"近 7 天使用统计"，
      // 同栏的食物查询/症状筛查都是 7 天窗口，口径必须一致（否则会被读成"7 天打了 N 次卡"）
      checkinTotal: petScores.reduce((sum, p) => sum + p.weeklyCount, 0),
      emotionScore,
      emotionTrend,
      emotionPetName,
      // 有分数的排前面，无数据（null）的沉底
      petScores: petScores.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData, petsKey])

  const handleAdoptSuggestion = async (id: string) => {
    const suggestion = suggestions.find(s => s.id === id)
    if (!suggestion) return
    const result = await updateSuggestionAdoption(suggestion.petId, id, true)
    if (!result) {
      Taro.showToast({ title: '操作失败，请重试', icon: 'none' })
      return
    }
    Taro.showToast({ title: '已采纳建议', icon: 'success' })
    void loadData()
  }

  const handleDismissSuggestion = async (id: string) => {
    const suggestion = suggestions.find(s => s.id === id)
    if (!suggestion) return
    const ok = await deleteSuggestionRecord(suggestion.petId, id)
    if (!ok) {
      Taro.showToast({ title: '操作失败，请重试', icon: 'none' })
      return
    }
    void loadData()
  }

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high': return '重要'
      case 'medium': return '建议'
      case 'low': return '参考'
      default: return ''
    }
  }

  const getPriorityClass = (priority: string) => {
    switch (priority) {
      case 'high': return 'effect-suggestion-priority--high'
      case 'medium': return 'effect-suggestion-priority--medium'
      case 'low': return 'effect-suggestion-priority--low'
      default: return ''
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'feeding': return '🍽️'
      case 'symptom': return '🩺'
      case 'trend': return '📊'
      case 'chat': return '💬'
      default: return '📝'
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'feeding': return '喂养'
      case 'symptom': return '症状'
      case 'trend': return '趋势'
      case 'chat': return '对话'
      default: return ''
    }
  }

  if (loading) {
    return (
      <View className={`effect-page ${themeClass}`}>
        <PageBackground />
        <View className='effect-loading'>
          <Text>加载中...</Text>
        </View>
      </View>
    )
  }

  // 采纳率：没有任何建议记录时显示 --（而不是 0%，免得与"有记录但一条都没采纳"混淆）
  const adoptionRate = stats && stats.adviceTotal > 0
    ? Math.round((stats.adviceAdopted / stats.adviceTotal) * 100)
    : null
  // 随访/改善率：没有随访记录同样显示 --（stats 里已经是 null，这里只做展示格式化）
  const followupRateText = stats?.followupResponseRate === null || stats?.followupResponseRate === undefined
    ? '--'
    : `${stats.followupResponseRate}%`
  const betterRateText = stats?.followupBetterRate === null || stats?.followupBetterRate === undefined
    ? '--'
    : `${stats.followupBetterRate}%`

  return (
    <View className={`effect-page ${themeClass}`}>
      <View className='effect-header'>
        <Text className='effect-header-title'>📈 效果追踪</Text>
        <Text className='effect-header-sub'>AI建议采纳率与健康改善追踪</Text>
      </View>

      <ScrollView className='effect-scroll' scrollY>
        {/* 核心指标卡片 */}
        <View className='effect-kpi-section'>
          <View className='effect-kpi-grid'>
            <View className='effect-kpi-card effect-kpi-card--primary'>
              <Text className='effect-kpi-icon'>🎯</Text>
              <Text className='effect-kpi-value'>{adoptionRate === null ? '--' : `${adoptionRate}%`}</Text>
              <Text className='effect-kpi-label'>AI建议采纳率</Text>
              <Text className='effect-kpi-desc'>
                {stats && stats.adviceTotal > 0 ? `${stats.adviceAdopted}/${stats.adviceTotal}条` : '暂无建议记录'}
              </Text>
            </View>
            <View className='effect-kpi-card'>
              <Text className='effect-kpi-icon'>📩</Text>
              <Text className='effect-kpi-value'>{followupRateText}</Text>
              <Text className='effect-kpi-label'>跟进响应率</Text>
              <Text className='effect-kpi-desc'>
                {/* total 含尚未发出的计划；比率的分母只算"已发出+已回应"，
                    所以有计划但还没发出去时这里要说清楚，别让 -- 显得像坏了 */}
                {stats && stats.followupTotal > 0
                  ? (stats.followupResponseRate === null
                    ? `${stats.followupTotal}次计划 · 尚未发出`
                    : `${stats.followupTotal}次跟进`)
                  : '暂无随访记录'}
              </Text>            </View>
            {/* 情绪波动：getEmotionScore 的语义是「异常强度」，越高越需要关注（≥70 即触发危机干预），
                所以这里不再叫"情绪健康分"、也不再对无数据兜底成 50 分 */}
            <View className='effect-kpi-card'>
              <Text className='effect-kpi-icon'>🌊</Text>
              <Text className='effect-kpi-value'>
                {stats?.emotionScore === null || stats?.emotionScore === undefined ? '--' : `${stats.emotionScore}`}
              </Text>
              <Text className='effect-kpi-label'>情绪波动</Text>
              <Text className='effect-kpi-desc'>
                {stats?.emotionScore === null || stats?.emotionScore === undefined
                  ? '近 7 天无异常记录'
                  : `${stats.emotionPetName} · ${getTrendLabel(stats.emotionTrend)} · 越高越需关注`}
              </Text>
            </View>
            <View className='effect-kpi-card'>
              <Text className='effect-kpi-icon'>💚</Text>
              <Text className='effect-kpi-value'>{betterRateText}</Text>
              <Text className='effect-kpi-label'>健康改善率</Text>
              <Text className='effect-kpi-desc'>反馈好转比例</Text>
            </View>
          </View>
        </View>

        {/* 宠物健康分趋势 */}
        {stats && stats.petScores.length > 0 && (
          <View className='effect-section'>
            <View className='effect-section-header'>
              <Text className='effect-section-title'>🐾 宠物健康分</Text>
            </View>
            <View className='effect-pets-list'>
              {stats.petScores.map(({ pet, score, trend, streak, totalCheckins }) => {
                const emoji = pet.species === 'cat' ? '🐱' : '🐕'
                // 没有打卡记录时不显示分数（原来恒显示 50 分，是凭空的）
                const hasScore = score !== null
                const scoreLevel = hasScore ? (score >= 85 ? 'green' : score >= 70 ? 'gold' : 'red') : 'none'
                // ⚠️ "有没有打过卡"必须用 totalCheckins 判断，不能用 streak：
                // streak 是"截至今天的连续天数"，断签即归 0，用它当判据会把
                // "打过卡但最近断了"的宠物说成"还没有打卡记录"，同一行还会同时显示真实分数，自相矛盾
                const metaText = totalCheckins === 0
                  ? '还没有打卡记录'
                  : streak > 0
                    ? `连续打卡 ${streak} 天`
                    : `累计打卡 ${totalCheckins} 次 · 近日未连续`
                return (
                  <View key={pet.id} className='effect-pet-item'>
                    <View className='effect-pet-icon'>
                      <Text>{emoji}</Text>
                    </View>
                    <View className='effect-pet-info'>
                      <Text className='effect-pet-name'>{pet.name}</Text>
                      <Text className='effect-pet-breed'>{pet.breed || '未知品种'}</Text>
                      {/* 趋势不再用写死的箭头，改为可解释的真实信息 */}
                      <Text className='effect-pet-meta'>
                        {metaText}
                        {trend === 'down' ? ' · 连续异常，建议关注' : ''}
                      </Text>
                    </View>
                    <View className={`effect-pet-score effect-pet-score--${scoreLevel}`}>
                      <Text className='effect-pet-score-value'>{hasScore ? `${score}分` : '--'}</Text>
                    </View>
                  </View>
                )
              })}
            </View>
          </View>
        )}

        {/* 使用统计 */}
        <View className='effect-section'>
          <View className='effect-section-header'>
            <Text className='effect-section-title'>📱 近7天使用统计</Text>
          </View>
          <View className='effect-stats-grid'>
            <View className='effect-stat-item'>
              <Text className='effect-stat-label'>食物查询</Text>
              <Text className='effect-stat-value'>{stats?.foodQueryCount || 0}</Text>
              <Text className='effect-stat-unit'>次</Text>
            </View>
            <View className='effect-stat-item'>
              <Text className='effect-stat-label'>症状筛查</Text>
              <Text className='effect-stat-value'>{stats?.symptomCheckCount || 0}</Text>
              <Text className='effect-stat-unit'>次</Text>
            </View>
            {/* 原来是"AI对话"且恒为 "--"（前端没有对话计数数据源，读的是内存态且无时间戳）。
                换成真实可得的打卡记录数，标题也相应改为"健康打卡" */}
            <View className='effect-stat-item'>
              <Text className='effect-stat-label'>健康打卡</Text>
              <Text className='effect-stat-value'>{stats?.checkinTotal || 0}</Text>
              <Text className='effect-stat-unit'>次</Text>
            </View>
          </View>
        </View>

        {/* AI建议记录 */}
        <View className='effect-section'>
          <View className='effect-section-header'>
            <Text className='effect-section-title'>💡 AI建议记录</Text>
          </View>

          {/* 失败态与空态必须分开：原来请求失败也返回 []，页面显示"暂无记录"，
              用户无法区分"没数据"和"没加载出来" */}
          {suggestionsFailed ? (
            <View className='effect-empty'>
              <Icon name='warning' size={32} tone='primary' className='effect-empty-icon' />
              <Text className='effect-empty-text'>建议记录加载失败</Text>
              <Text className='effect-empty-hint'>请检查网络后重试</Text>
              <View className='effect-empty-retry' onClick={() => void loadData()}>
                <Text className='effect-empty-retry-text'>重新加载</Text>
              </View>
            </View>
          ) : suggestions.length === 0 ? (
            <View className='effect-empty'>
              <Icon name='clipboard-text' size={32} tone='primary' className='effect-empty-icon' />
              <Text className='effect-empty-text'>暂无AI建议记录</Text>
              {/* 文案不再承诺"AI 会自动生成"：当前版本没有任何写入建议记录的前端入口
                  （后端 POST 路由在，但前端无调用方），写"会自动生成"属于空头承诺 */}
              <Text className='effect-empty-hint'>建议记录功能正在建设中<br />上线后会在这里按时间展示</Text>
            </View>
          ) : (
            <View className='effect-suggestions-list'>
              {suggestions.map(s => (
                <View
                  key={s.id}
                  className={`effect-suggestion-card ${s.adopted ? 'effect-suggestion-card--adopted' : ''}`}
                >
                  <View className='effect-suggestion-header'>
                    <View className='effect-suggestion-type'>
                      <Text className='effect-suggestion-type-icon'>{getTypeIcon(s.type)}</Text>
                      <Text className='effect-suggestion-type-label'>{getTypeLabel(s.type)}</Text>
                    </View>
                    <View className={`effect-suggestion-priority ${getPriorityClass(s.priority)}`}>
                      <Text>{getPriorityLabel(s.priority)}</Text>
                    </View>
                  </View>
                  <Text className='effect-suggestion-title'>{s.title}</Text>
                  <Text className='effect-suggestion-content'>{s.content}</Text>
                  <View className='effect-suggestion-meta'>
                    <Text className='effect-suggestion-pet'>🐾 {pets.find(p => p.id === s.petId)?.name || '未知宠物'}</Text>
                    <Text className='effect-suggestion-time'>
                      {formatSuggestionDate(s.createdAt)}
                    </Text>
                  </View>
                  {s.adopted ? (
                    <View className='effect-suggestion-adopted-badge'>
                      <Icon name='check-circle' size={18} tone='success' />
                      <Text>已采纳</Text>
                    </View>
                  ) : (
                    <View className='effect-suggestion-actions'>
                      <View
                        className='effect-suggestion-btn effect-suggestion-btn--adopt'
                        onClick={() => handleAdoptSuggestion(s.id)}
                      >
                        <Text>采纳</Text>
                      </View>
                      <View
                        className='effect-suggestion-btn effect-suggestion-btn--dismiss'
                        onClick={() => handleDismissSuggestion(s.id)}
                      >
                        <Text>忽略</Text>
                      </View>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        <View className='effect-bottom-safe' />
      </ScrollView>
    </View>
  )
}

/**
 * 计算宠物健康分
 *
 * 【口径】只反映"健康相关"的事实：以打卡记录中的异常占比为主线，
 * 100 分起按异常天数占比扣分（最多扣 60）。
 * 【为什么既不加"总打卡次数"也不加"连续打卡"】打卡次数与连续天数都是**用户行为**，
 * 不是宠物的健康状态 —— 打卡多不代表更健康。原实现里 `+ Math.min(totalCheckins, 10)`
 * 与 `+ Math.min(streak*3, 15)` 两项都会把行为分混进健康分（且与"打卡不算健康"的注释自相矛盾），
 * 已一并去掉。
 * 【为什么没有记录时返回 null】原来恒返回 50 分，用户看到的是一个凭空的分数；
 * 无数据就返回 null，由页面如实显示 --。
 */
function calculateScore(stats: { totalCheckins: number; totalAnomalyDays: number }): number | null {
  if (stats.totalCheckins === 0) return null
  const anomalyRatio = stats.totalAnomalyDays / Math.max(stats.totalCheckins, 1)
  let score = 100
  score -= anomalyRatio * 60
  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * 推导宠物健康趋势
 *
 * 【原来是什么】`trend: pet.id === 'pet_001' ? 'stable' : 'up'` —— 写死的：
 * 除 id 恰好是 pet_001 的宠物外，列表里每一只都显示"上升"，与真实数据毫无关系。
 * 【现在的规则】只依据真实打卡统计，规则写在明面上便于复核：
 *   · 连续异常 ≥ 2 天 → down（需要关注）
 *   · 连续打卡 ≥ 3 天且无连续异常 → up
 *   · 其余（含没有任何记录）→ stable
 */
function resolveHealthTrend(stats: { streak: number; consecutiveAnomalyDays: number }): 'up' | 'down' | 'stable' {
  if (stats.consecutiveAnomalyDays >= 2) return 'down'
  if (stats.streak >= 3) return 'up'
  return 'stable'
}