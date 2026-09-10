/**
 * 年度回忆页面
 * 珊瑚渐变头部 + 年度数据 + AI 年度总结 + 年度视频
 */
import { useEffect, useState, useCallback } from 'react'
import { View, Text, Video, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { usePetStore } from '../../stores/petStore'
import { useMembership } from '../../hooks/useMembership'
import { api } from '../../services/api'
import type { PetProfile } from '../../services/petService'
import './index.scss'
import { Icon } from '../../components'
import PageBackground from '../../components/PageBackground'

interface YearlyReview {
  id: string; pet_id: string; year: number
  total_checkins: number; total_days: number; max_streak: number
  weight_change?: { start: number; end: number; diff: number }
  top_moods: { mood: string; emoji: string; count: number }[]
  highlights: string[]; summary: string
  video_url: string; video_status: 'pending' | 'processing' | 'completed' | 'failed'
  created_at: string
}

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i)
const STATUS_LABELS: Record<string, string> = {
  pending: '等待生成', processing: '生成中...', completed: '可播放', failed: '生成失败',
}

export default function YearlyReviewPage() {
  const { pets, fetchPets, currentPet } = usePetStore()
  const { isMember } = useMembership()
  const [selectedPetId, setSelectedPetId] = useState('')
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [review, setReview] = useState<YearlyReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const uid = Taro.getStorageSync('xhh_user_id') || ''
    if (uid) fetchPets(uid)
  }, [])

  useEffect(() => {
    if (pets.length > 0 && !selectedPetId) {
      setSelectedPetId(currentPet?.id || pets[0].id)
    }
  }, [pets, currentPet, selectedPetId])

  const fetchReview = useCallback(async () => {
    if (!selectedPetId) return
    setLoading(true); setError('')
    try {
      const data = await api.get<YearlyReview>(`/api/pets/${selectedPetId}/yearly-review/${selectedYear}`)
      setReview(data)
    } catch {
      setReview(null); setError('暂无该年度回忆数据')
    } finally { setLoading(false) }
  }, [selectedPetId, selectedYear])

  useEffect(() => { fetchReview() }, [fetchReview])

  const handleGenerateVideo = async () => {
    if (!review || generating) return
    if (!isMember) { Taro.showToast({ title: '该功能需要会员权限', icon: 'none' }); return }
    setGenerating(true)
    try {
      await api.post(`/api/pets/${selectedPetId}/yearly-review/${review.id}/generate-video`)
      Taro.showToast({ title: '视频生成任务已提交', icon: 'success' })
      fetchReview()
    } catch (err: unknown) {
      Taro.showToast({ title: (err as { message?: string }).message || '生成失败', icon: 'none' })
    } finally { setGenerating(false) }
  }

  const selectedPet = pets.find((p) => p.id === selectedPetId) || null

  if (loading) {
    return (
      <View className='review-page'>
        <View className='review-page__loading'>
          <View className='review-page__spinner' />
          <Text className='review-page__loading-text'>加载年度回忆中...</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='review-page'>
      {/* 全屏动态背景层 */}
      <PageBackground />

      <View className='review-page__content'>
        {/* ===== 年度头部：珊瑚渐变横幅 ===== */}
        <View className='annual-hero'>
          {/* 年份胶囊 */}
          <ScrollView scrollX className='annual-hero__pills' showScrollbar={false}>
            <View className='annual-hero__pills-inner'>
              {YEARS.map(year => (
                <View
                  key={year}
                  className={`annual-hero__pill${selectedYear === year ? ' annual-hero__pill--active' : ''}`}
                  onClick={() => setSelectedYear(year)}
                >
                  <Text className='annual-hero__pill-text'>{year}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* 宠物切换胶囊（业务保留） */}
          {pets.length > 1 && (
            <ScrollView scrollX className='annual-hero__pets' showScrollbar={false}>
              <View className='annual-hero__pills-inner'>
                {pets.map((pet: PetProfile) => (
                  <View
                    key={pet.id}
                    className={`annual-hero__pill annual-hero__pill--pet${selectedPetId === pet.id ? ' annual-hero__pill--active' : ''}`}
                    onClick={() => setSelectedPetId(pet.id)}
                  >
                    <Text className='annual-hero__pill-text'>{pet.name}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}

          <View className='annual-hero__title-row'>
            <Text className='annual-hero__title'>
              {selectedPet?.name || '毛孩子'}的 {selectedYear} 年
            </Text>
            <View className='annual-hero__badge'>
              <Text className='annual-hero__badge-icon'>✨</Text>
              <Text className='annual-hero__badge-text'>年度回忆</Text>
            </View>
          </View>
          <Text className='annual-hero__sub'>
            {/* 文案纠正（2026-09-11）：total_days 是"当年有记录的天数"，不是"陪伴天数"，
                原来写「N 个日夜的陪伴与成长」会把记录天数说成相处时长。
                ⚠️ 独立审查发现：本页接口声明里的 total_days / total_checkins / max_streak 等字段
                **后端 toDetailResponse 并不返回**（只回 { id, pet_id, year, status, review_data, ... }），
                所以这里必须做 0 兜底，否则直接渲染出「undefined 天有记录的日子」。
                要真正显示数字，需要后端由 review_data.stats 派生这些字段（或前端改读 review_data）。 */}
            {review ? `${review.total_days ?? 0} 天有记录的日子，都在这里` : '记录毛孩子的温暖时光'}
          </Text>
        </View>

        {error || !review ? (
          <View className='review-empty'>
            <Icon name='book-open' size={36} tone='primary' className='review-empty__icon' />
            <Text className='review-empty__text'>{error || '暂无年度回忆\n去打卡记录更多美好时光吧'}</Text>
          </View>
        ) : (
          <>
            {/* ===== 年度数据 2x2 ===== */}
            <View className='annual-section'>
              <Text className='annual-section__title'>年度数据</Text>
              <View className='annual-stats'>
                <View className='annual-stat'>
                  <View className='annual-stat__head'>
                    <Icon name='calendar-check' size={14} tone='primary' className='annual-stat__icon' />
                    {/* 标签纠正（2026-09-11）：这一格的值是 review.total_days =
                        当年**有打卡记录的去重天数**（yearlyReviewService 里就叫「记录天数」），
                        原先标成「陪伴」会让人误以为是"陪伴了多少天"（等于把记录天数当相处时长）。
                        与右侧的「打卡 N 次」区分：这个按天去重，那个按次计数。 */}
                    <Text className='annual-stat__label'>记录天数</Text>
                  </View>
                  {/* 0 兜底的原因见上方 hero 的注释：后端当前不返回 total_days（契约缺失） */}
                  <Text className='annual-stat__num'>{review.total_days ?? 0}<Text className='annual-stat__unit'>天</Text></Text>
                </View>
                <View className='annual-stat'>
                  <View className='annual-stat__head'>
                    <Icon name='check-circle' size={14} tone='primary' className='annual-stat__icon' />
                    <Text className='annual-stat__label'>打卡</Text>
                  </View>
                  <Text className='annual-stat__num'>{review.total_checkins ?? 0}<Text className='annual-stat__unit'>次</Text></Text>
                </View>
                <View className='annual-stat'>
                  <View className='annual-stat__head'>
                    <Text className='annual-stat__icon'>🔥</Text>
                    <Text className='annual-stat__label'>最长连续</Text>
                  </View>
                  <Text className='annual-stat__num'>{review.max_streak ?? 0}<Text className='annual-stat__unit'>天</Text></Text>
                </View>
                <View className='annual-stat'>
                  <View className='annual-stat__head'>
                    <Icon name='chart-line' size={14} tone='primary' className='annual-stat__icon' />
                    <Text className='annual-stat__label'>体重</Text>
                  </View>
                  <Text className='annual-stat__num'>
                    {review.weight_change
                      ? `${review.weight_change.diff > 0 ? '+' : ''}${review.weight_change.diff}`
                      : '--'}
                    <Text className='annual-stat__unit'>kg</Text>
                  </Text>
                </View>
              </View>
            </View>

            {/* ===== AI 年度总结 ===== */}
            <View className='annual-summary'>
              <View className='annual-summary__head'>
                <View className='annual-summary__icon'>
                  <Text className='annual-summary__icon-text'>✨</Text>
                </View>
                <View className='annual-summary__info'>
                  <Text className='annual-summary__title'>AI 年度总结</Text>
                  <Text className='annual-summary__sub'>写给{selectedPet?.name || '毛孩子'}和你的 {selectedYear}</Text>
                </View>
              </View>
              <Text className='annual-summary__text'>{review.summary || '这一年有太多值得记录的瞬间，继续陪伴毛孩子成长吧。'}</Text>
              <Text className='annual-summary__sign'>— 星河宠记 AI 管家</Text>
            </View>

            {/* ===== 年度视频 ===== */}
            <View className='annual-video'>
              {review.video_status === 'completed' && review.video_url && (
                <Video className='annual-video__player' src={review.video_url} controls />
              )}
              <View className={`annual-video__status annual-video__status--${review.video_status}`}>
                <Text className='annual-video__status-text'>
                  {STATUS_LABELS[review.video_status]}
                </Text>
                {review.video_status === 'processing' && (
                  <View className='annual-video__progress'>
                    <View className='annual-video__progress-bar' />
                  </View>
                )}
              </View>
              <View
                className={`annual-video__btn${generating ? ' annual-video__btn--loading' : ''}${review.video_status === 'processing' ? ' annual-video__btn--disabled' : ''}`}
                onClick={handleGenerateVideo}
              >
                <Icon name='film-strip' size={18} tone='primary' className='annual-video__btn-icon' />
                <Text className='annual-video__btn-text'>
                  {generating ? '⏳ 提交中...' : review.video_status === 'completed' ? '🔄 重新生成' : '生成年度视频'}
                </Text>
                <Text className='annual-video__btn-arrow'>→</Text>
              </View>
              <Text className='annual-video__price'>9.9 元 · 会员免费</Text>
            </View>
          </>
        )}
      </View>
    </View>
  )
}
