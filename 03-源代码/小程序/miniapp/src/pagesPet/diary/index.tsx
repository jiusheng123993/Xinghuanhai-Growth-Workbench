/**
 * 宠物日记页面
 * 日记头部卡 + 心情筛选 + 时间轴日记流 + 写日记入口
 */
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useShareAppMessage, useShareTimeline, useDidShow } from '@tarojs/taro'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import PetSwitcher from '../../components/PetSwitcher'
import { PageLoading, PageError, Icon } from '../../components'
import { usePetStore } from '../../stores/petStore'
import { useAuthStore } from '../../stores/authStore'
import { useCheckinStore } from '../../stores/checkinStore'
import { useThemeClass } from '../../hooks/useThemeClass'
import { generateDiaryFromEntries, type DiaryRecord } from '../../services/diaryService'
import { MedicalDisclaimer } from '../../engines/petSafety/MedicalDisclaimer'
import { useAnalytics, usePageView } from '../../hooks/useAnalytics'
import { daysSinceLocalDate, formatPetAge } from '../../utils/date'
import './index.scss'
import PageBackground from '../../components/PageBackground'

const TONE_COLORS: Record<string, string> = {
  happy: '#52C41A',
  neutral: '#8C8C8C',
  tired: '#FAAD14',
  sick: '#FF4D4F',
  proud: '#FF8C42',
}

const TONE_LABELS: Record<string, string> = {
  happy: '开心',
  neutral: '平静',
  tired: '疲惫',
  sick: '不舒服',
  proud: '骄傲',
}

const TONE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'happy', label: '开心' },
  { key: 'neutral', label: '平静' },
  { key: 'tired', label: '疲惫' },
  { key: 'sick', label: '不舒服' },
  { key: 'proud', label: '骄傲' },
]

const PET_EMOJI: Record<string, string> = { cat: '🐱', dog: '🐕' }

function formatFullDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length >= 3) {
    const d = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`)
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${parts[1]}月${parts[2]}日 · ${weekDays[d.getDay()]}`
  }
  return dateStr
}

/**
 * 年龄文案已收敛到 utils/date 的 formatPetAge（2026-09-11）
 * 原实现按月相减但**不减「日」**（生日 20 号、今天 5 号会多算一个月）、按 UTC 解析，
 * 且不足一个月时返回「刚出生」而不是天数。统一规则见 formatPetAge 的注释。
 */

export default function PetDiaryPage() {
  const { pets, currentPet, fetchPets, switchPet } = usePetStore()
  const user = useAuthStore(s => s.user)
  const { checkins, fetchCheckins, isLoading: checkinLoading, initUser } = useCheckinStore()
  // 主题跟随：挂 themeClass 使页面 CSS 变量随主题切换（此前缺失导致换主题页不变色）
  const themeClass = useThemeClass()

  const [diaryRecords, setDiaryRecords] = useState<DiaryRecord[]>([])
  const [toneFilter, setToneFilter] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const { trackPageView, trackEvent } = useAnalytics()

  useShareAppMessage(() => ({
    title: '星河宠记 - 宠物日记',
    path: '/pagesPet/diary/index',
  }))
  useShareTimeline(() => ({
    title: '星河宠记 - 宠物日记',
  }))

  usePageView('diary')

  /**
   * 请求序号：丢弃过期响应（2026-09-11 审查 · 跨宠物竞态）
   *
   * 本页有两层串味风险，都靠它收口：
   *  ① 快速切宠物时（可乐 → 布丁），可乐那次请求的续体可能晚于布丁返回，
   *     把可乐的日记覆盖到布丁的界面上；
   *  ② 本函数要读 `useCheckinStore.getState().checkins`（全局共享），
   *     若布丁的 `fetchCheckins` 先落地，可乐的续体会读到**布丁的打卡记录**，
   *     再配上闭包里可乐的 birthDate —— 一次生成里混了两只宠物的数据。
   * 切宠物会递增序号，旧续体在写状态前比对一下即整体作废。
   */
  const loadSeqRef = useRef(0)

  const loadDiaryData = useCallback(async () => {
    const seq = ++loadSeqRef.current
    /** 本次请求是否已被更新的请求取代 */
    const isStale = () => seq !== loadSeqRef.current

    setError('')
    setIsLoading(true)
    try {
      if (!currentPet?.id || !user?.id) {
        setIsLoading(false)
        return
      }
      // 先把本次要用的宠物信息固定下来：后面 await 期间 currentPet 可能已经换人
      const petId = currentPet.id
      const petBirthDate = currentPet.birthDate || null

      await initUser(user.id)
      await fetchCheckins(petId)
      if (isStale()) return

      // 注意：不能依赖 checkins（fetchCheckins 每次返回新数组引用会触发本函数重建 → useEffect 无限循环 → 页面频闪）。
      // 改为 fetch 后从 store 读最新值（依赖数组不含 checkins，引用稳定）；
      // 上面的 isStale 已经保证"读到的就是本次这只宠物的批次"。
      const latestCheckins = useCheckinStore.getState().checkins
      // 与原实现一致：Checkin 结构可映射为 PetHealthEntry（字段命名差异，业务层兼容）
      const records = generateDiaryFromEntries(latestCheckins as any, petBirthDate)
      setDiaryRecords(records)
    } catch (err) {
      if (isStale()) return
      setError(err instanceof Error ? err.message : '加载失败，请重试')
    } finally {
      if (!isStale()) setIsLoading(false)
    }
  }, [currentPet?.id, currentPet?.birthDate, user?.id, initUser, fetchCheckins])

  useEffect(() => {
    if (currentPet?.id && user?.id) {
      loadDiaryData()
    }
  }, [loadDiaryData])

  /**
   * 切回本页时刷新（2026-09-11 审查 P2-5）
   *
   * 原先 `useDidShow` 只 `fetchPets`（刷新宠物列表），**不重载日记** ——
   * 用户在打卡页补了一条卡再回到日记页，列表里看不到那条新记录
   * （标题栏的"打卡 N 次"因为订阅 store 会变，列表不变，更容易让人以为数据丢了）。
   * 与时光线页同一套做法：首次 show 与上面的 useEffect 时机重叠，用 ref 跳过，避免进页面连发两次。
   * 序号守卫天然兼容 —— 刷新只会递增 seq，旧的在途请求自动作废。
   */
  const isFirstShowRef = useRef(true)
  useDidShow(() => {
    if (user?.id) {
      fetchPets(user.id)
    }
    if (isFirstShowRef.current) {
      isFirstShowRef.current = false
      return
    }
    if (currentPet?.id && user?.id) {
      loadDiaryData()
    }
  })

  /**
   * 切换宠物
   *
   * 必须自己兜住 rejection：petStore.switchPet 失败时会 `throw err`，这里没人接这个 promise
   * 就成了未处理的 Promise rejection（与时光线页同名回调对齐，2026-09-11 审查 P3）。
   * 只在 `setCurrentPet` 抛错时 store 才有 error，「未登录」那条 throw 在它 try 之外，
   * 所以兜一句默认文案，避免点了另一只宠物"什么都没发生"。
   */
  const handlePetSwitch = useCallback((petId: string) => {
    switchPet(petId).catch(() => {
      const errMsg = usePetStore.getState().error
      Taro.showToast({ title: errMsg || '切换失败，请重试', icon: 'none' })
    })
  }, [switchPet])

  const handleShareEntry = useCallback((record: DiaryRecord) => {
    trackEvent('share_diary', { date: record.date, tone: record.diary.tone })
    Taro.showShareMenu({ withShareTicket: true })
  }, [])

  /** 心情筛选 */
  const filteredRecords = useMemo(() => {
    if (toneFilter === 'all') return diaryRecords
    return diaryRecords.filter(r => r.diary.tone === toneFilter)
  }, [diaryRecords, toneFilter])

  const disclaimerText = useMemo(() => {
    return new MedicalDisclaimer().getCheckinDisclaimer(false)
  }, [])

  if (isLoading && pets.length === 0) {
    return (
      <View className={`pet-diary ${themeClass}`}>
        <PageLoading />
      </View>
    )
  }

  if (error && pets.length === 0) {
    return (
      <View className={`pet-diary ${themeClass}`}>
        <PageError message={error} onRetry={loadDiaryData} />
      </View>
    )
  }

  const petEmoji = PET_EMOJI[currentPet?.species || ''] || '🐾'
  const ageText = currentPet ? formatPetAge(currentPet.birthDate) : ''
  const breedText = currentPet?.breed || (currentPet?.species === 'cat' ? '猫咪' : '狗狗')

  /**
   * 相伴天数：建档（加入家庭）至今，与时光线页「相伴 N 天」同一口径。
   *
   * 2026-09-11 口径修正：原实现用的是 birthDate（＝宠物的年龄天数），却标成"相伴"，
   * 与时光线页改名后的含义对不上；且用 Math.floor(毫秒差/86400000)，
   * 在东八区每天 00:00–08:00 会少算一天。现统一走 utils/date：
   * 本地零点相减 + 按日历天取整，并改由 createdAt 起算。
   * 出生信息在头部卡片（"X岁X个月"）已经表达，这里不必再重复一遍出生天数。
   */
  const togetherDays = daysSinceLocalDate(currentPet?.createdAt)

  return (
    <View className={`pet-diary ${themeClass}`}>
      {/* 全屏动态背景层 */}
      <PageBackground />

      <PetSwitcher
        pets={pets}
        currentPetId={currentPet?.id || null}
        onSwitch={handlePetSwitch}
      />

      <View className='pet-diary__content'>
        {/* ===== 日记头部卡 ===== */}
        {currentPet && (
          <View className='pdiary-head'>
            <View className='pdiary-head__row'>
              <View className='pdiary-avatar'>
                <Text className='pdiary-avatar__emoji'>{petEmoji}</Text>
              </View>
              <View className='pdiary-head__info'>
                <View className='pdiary-head__name-row'>
                  <Text className='pdiary-head__name'>{currentPet.name}</Text>
                  <Text className='pdiary-head__meta'>
                    {breedText}{ageText ? ` · ${ageText}` : ''}
                  </Text>
                </View>
                <Text className='pdiary-head__slogan'>毛孩子的每一刻，都值得被记下</Text>
                <View className='pdiary-head__stats'>
                  <View className='pdiary-stat'>
                    <Icon name='book-open' size={12} tone='primary' className='pdiary-stat__icon' />
                    <Text className='pdiary-stat__text'>日记 <Text className='pdiary-stat__num'>{diaryRecords.length}</Text> 篇</Text>
                  </View>
                  <View className='pdiary-stat'>
                    <Icon name='check-circle' size={12} tone='primary' className='pdiary-stat__icon' />
                    <Text className='pdiary-stat__text'>打卡 <Text className='pdiary-stat__num'>{checkins.length}</Text> 次</Text>
                  </View>
                  {togetherDays !== null && (
                    <View className='pdiary-stat'>
                      <Text className='pdiary-stat__icon'>💕</Text>
                      <Text className='pdiary-stat__text'>相伴 <Text className='pdiary-stat__num'>{togetherDays}</Text> 天</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ===== 心情标签筛选行 ===== */}
        <ScrollView scrollX className='pdiary-filters' showScrollbar={false}>
          <View className='pdiary-filters__inner'>
            {TONE_FILTERS.map(f => (
              <View
                key={f.key}
                className={`pdiary-filter${toneFilter === f.key ? ' pdiary-filter--active' : ''}`}
                onClick={() => setToneFilter(f.key)}
              >
                <Text className='pdiary-filter__text'>{f.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* ===== 时间轴日记流 ===== */}
        <ScrollView scrollY className='pdiary-scroll' enhanced showScrollbar={false}>
          {isLoading ? (
            <View className='pet-diary__loading'>
              <Text className='pet-diary__loading-text'>加载中...</Text>
            </View>
          ) : error ? (
            <View className='pet-diary__error'>
              <Text className='pet-diary__error-text'>{error}</Text>
              <View className='pet-diary__retry-btn' onClick={loadDiaryData}>
                <Text className='pet-diary__retry-text'>重试</Text>
              </View>
            </View>
          ) : filteredRecords.length === 0 ? (
            <View className='pet-diary__empty'>
              <Text className='pet-diary__empty-icon'>📔</Text>
              <Text className='pet-diary__empty-text'>
                {diaryRecords.length === 0 ? '还没有日记哦~' : '该心情下暂无日记'}
              </Text>
              <Text className='pet-diary__empty-hint'>每天打卡后会自动生成一篇日记</Text>
            </View>
          ) : (
            <View className='pdiary-timeline'>
              <View className='pdiary-section-head'>
                <Text className='pdiary-section-title'>时光轴</Text>
                <Text className='pdiary-section-count'>共 {filteredRecords.length} 篇</Text>
              </View>
              {filteredRecords.map((record, index) => (
                <View key={record.entry.id} className='pdiary-item'>
                  <View className='pdiary-rail'>
                    <View
                      className='pdiary-dot'
                      style={{ backgroundColor: TONE_COLORS[record.diary.tone] || '#8C8C8C' }}
                    />
                    {index < filteredRecords.length - 1 && <View className='pdiary-rail__line' />}
                  </View>
                  <View className='pdiary-card'>
                    <View className='pdiary-card__top'>
                      <Text className='pdiary-date'>{formatFullDate(record.date)}</Text>
                      <View
                        className='pdiary-mood'
                        style={{ backgroundColor: TONE_COLORS[record.diary.tone] || '#8C8C8C' }}
                      >
                        <Text className='pdiary-mood__text'>{record.diary.emoji} {TONE_LABELS[record.diary.tone] || record.diary.tone}</Text>
                      </View>
                    </View>
                    <View className='pdiary-photo'>
                      <Text className='pdiary-photo__emoji'>{record.diary.emoji}</Text>
                      <Text className='pdiary-photo__caption'>来自 {record.date} 的日常</Text>
                    </View>
                    <Text className='pdiary-card__text'>&quot;{record.diary.text}&quot;</Text>
                    {record.entry.note && (
                      <View className='pdiary-note'>
                        <Text className='pdiary-note__label'>📝 备注：</Text>
                        <Text className='pdiary-note__text'>{record.entry.note}</Text>
                      </View>
                    )}
                    <View className='pdiary-card__actions'>
                      <View
                        className='pdiary-card__share'
                        onClick={() => handleShareEntry(record)}
                      >
                        <Text className='pdiary-card__share-text'>📤 分享这篇日记</Text>
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      <View className='pet-diary__disclaimer'>
        <Text className='pet-diary__disclaimer-text'>{disclaimerText}</Text>
      </View>

      {/* 写日记浮动入口 */}
      <View
        className='pdiary-fab'
        onClick={() => {
          trackEvent('click_write_diary')
          Taro.navigateTo({ url: '/pagesPet/checkin/index' })
        }}
      >
        <Icon name='pencil-simple' size={24} tone='primary' className='pdiary-fab__icon' />
      </View>
    </View>
  )
}
