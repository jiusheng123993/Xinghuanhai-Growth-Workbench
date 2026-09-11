import { useEffect, useState, useMemo, useCallback } from 'react'
import { View, Text, ScrollView, Image, Textarea, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useFamilyStore } from '../../../stores/familyStore'
import { usePetStore } from '../../../stores/petStore'
import { useAuthStore } from '../../../stores/authStore'
import { feedService, type FeedType, type FeedWithPet } from '../../../services/feedService'
import { useThemeClass } from '../../../hooks/useThemeClass'
import SpeciesAvatar from '../lineage/SpeciesAvatar'
import './index.scss'

const FEED_TYPE_LABELS: Record<FeedType, string> = {
  moment: '日常', achievement: '成就', health_milestone: '健康里程碑', family_event: '家庭事件',
}
const FEED_TYPE_COLORS: Record<FeedType, string> = {
  moment: '#FF8C42', achievement: '#FFD700', health_milestone: '#4CAF50', family_event: '#9C27B0',
}
const FEED_TYPES: FeedType[] = ['moment', 'achievement', 'health_milestone', 'family_event']
const PAGE_SIZE = 10

export default function FamilyFeed() {
  const { currentFamily } = useFamilyStore()
  const { pets, fetchPets } = usePetStore()
  const user = useAuthStore(s => s.user)
  const themeClass = useThemeClass()

  const [feeds, setFeeds] = useState<FeedWithPet[]>([])
  const [highlights, setHighlights] = useState<FeedWithPet[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeType, setActiveType] = useState('all')
  const [showPublish, setShowPublish] = useState(false)
  const [publishContent, setPublishContent] = useState('')
  const [publishType, setPublishType] = useState<FeedType>('moment')
  const [publishPetId, setPublishPetId] = useState('')
  const [publishing, setPublishing] = useState(false)

  const familyId = currentFamily?.id

  // 冷启动（分享链接直达等场景）补拉一次宠物列表，保证按 pet_id 匹配头像不落空
  useEffect(() => {
    if (user?.id) {
      fetchPets(user.id).catch(() => {})
    }
  }, [user?.id])

  const loadFeeds = useCallback(async (pageNum: number, isRefresh: boolean) => {
    if (!familyId) return
    if (isRefresh) setRefreshing(true); else setLoadingMore(true)
    try {
      const params: { page: number; page_size: number; feed_type?: FeedType } = { page: pageNum, page_size: PAGE_SIZE }
      if (activeType !== 'all') params.feed_type = activeType as FeedType
      const res = await feedService.getFeeds(familyId, params)
      setFeeds(isRefresh ? res.data : [...feeds, ...res.data])
      setTotal(res.total); setPage(pageNum)
    } catch { /* ignore */ }
    finally { setRefreshing(false); setLoadingMore(false) }
  }, [familyId, activeType, feeds])

  useEffect(() => {
    if (familyId) { loadFeeds(1, true); feedService.getHighlightFeeds(familyId).then(setHighlights).catch(() => {}) }
  }, [familyId])

  useEffect(() => {
    if (familyId) { setFeeds([]); loadFeeds(1, true) }
  }, [activeType])

  const hasMore = feeds.length < total

  const handleRefresh = () => loadFeeds(1, true)
  const handleLoadMore = () => { if (hasMore && !loadingMore) loadFeeds(page + 1, false) }

  const handlePublish = async () => {
    if (!familyId || !publishContent.trim() || publishing) return
    setPublishing(true)
    try {
      await feedService.createFeed(familyId, { feed_type: publishType, content: publishContent.trim(), pet_id: publishPetId || undefined })
      setPublishContent(''); setPublishType('moment'); setPublishPetId(''); setShowPublish(false)
      Taro.showToast({ title: '发布成功', icon: 'success' })
      loadFeeds(1, true)
    } catch (err: unknown) {
      Taro.showToast({ title: (err as { message?: string }).message || '发布失败', icon: 'none' })
    } finally { setPublishing(false) }
  }

  const handleDelete = (feedId: string) => {
    if (!familyId) return
    Taro.showModal({
      title: '删除动态', content: '确认删除这条动态吗？', confirmColor: '#E0856B',
      success: async (res) => {
        if (res.confirm) {
          try {
            await feedService.deleteFeed(familyId, feedId)
            setFeeds(prev => prev.filter(f => f.id !== feedId))
            Taro.showToast({ title: '已删除', icon: 'success' })
          } catch { Taro.showToast({ title: '删除失败', icon: 'none' }) }
        }
      },
    })
  }

  const familyPets = useMemo(() => {
    const memberIds = new Set(useFamilyStore.getState().members.map(m => m.petId))
    return pets.filter(p => memberIds.has(p.id))
  }, [pets])

  if (!currentFamily) {
    return (
      <View className={`feed-container ${themeClass}`}>
        <View className='feed-empty'>
          <Text className='feed-empty-icon'>🏡</Text>
          <Text className='feed-empty-text'>请先创建家庭</Text>
        </View>
      </View>
    )
  }

  return (
    <View className={`feed-container ${themeClass}`}>
      <View className='feed-header'><Text className='feed-header-title'>家庭动态</Text></View>

      {highlights.length > 0 && (
        <View className='highlight-section'>
          <Text className='highlight-title'>✨ 精选动态</Text>
          <ScrollView className='highlight-scroll' scrollX>
            {highlights.map(f => (
              <View key={f.id} className='highlight-card'>
                <Text className='highlight-card-type' style={{ color: FEED_TYPE_COLORS[f.feed_type] }}>{FEED_TYPE_LABELS[f.feed_type]}</Text>
                <Text className='highlight-card-content'>{f.content}</Text>
                <Text className='highlight-card-pet'>{f.pet_name || '家庭'}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <View className='filter-tabs'>
        <ScrollView className='filter-tabs-scroll' scrollX>
          {['all', ...FEED_TYPES].map(t => (
            <View key={t} className={`filter-tab ${activeType === t ? 'filter-tab--active' : ''}`} onClick={() => setActiveType(t)}>
              <Text className='filter-tab-text'>{t === 'all' ? '全部' : FEED_TYPE_LABELS[t as FeedType]}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <ScrollView className='feed-list' scrollY refresherEnabled refresherTriggered={refreshing}
        onRefresherRefresh={handleRefresh} onScrollToLower={handleLoadMore}
      >
        {feeds.map(feed => {
          // 按 pet_id 匹配家庭宠物档案；动态自带宠物照片优先（跨用户动态也能显示）
          const feedPet = feed.pet_id ? pets.find(p => p.id === feed.pet_id) : undefined
          // 孤儿 pet_id（宠物已删但动态还在）：按动态类型区分——家庭事件用 🏡，其余用 🐾
          const isFamilyEvent = feed.feed_type === 'family_event'
          const showHomeIcon = !feed.pet_id && isFamilyEvent
          return (
          <View key={feed.id} className='feed-card' onLongPress={() => handleDelete(feed.id)}>
            <View className='feed-card-header'>
              <View className='feed-card-avatar'>
                {feedPet ? (
                  <SpeciesAvatar
                    pet={feedPet}
                    imgClass='feed-card-avatar-img'
                    emojiClass='feed-card-avatar-emoji'
                  />
                ) : feed.pet_avatar_url ? (
                  // 动态自带宠物照片（如其他家庭成员发布的动态）
                  <Image src={feed.pet_avatar_url} className='feed-card-avatar-img' mode='aspectFill' lazyLoad />
                ) : (
                  <Text className='feed-card-avatar-emoji'>{showHomeIcon ? '🏡' : '🐾'}</Text>
                )}
              </View>
              <View className='feed-card-petinfo'>
                <Text className='feed-card-petname'>{feed.pet_name || '家庭'}</Text>
                <View className='feed-card-type' style={{ backgroundColor: FEED_TYPE_COLORS[feed.feed_type] }}>
                  <Text className='feed-card-type-text'>{FEED_TYPE_LABELS[feed.feed_type]}</Text>
                </View>
              </View>
            </View>
            <Text className='feed-card-content'>{feed.content}</Text>
            {feed.photos.length > 0 && (
              <View className='feed-card-photos'>
                {feed.photos.map((url, i) => <Image key={i} className='feed-card-photo' src={url} mode='aspectFill' />)}
              </View>
            )}
            <Text className='feed-card-time'>{feed.created_at.slice(0, 16).replace('T', ' ')}</Text>
          </View>
          )
        })}
        {loadingMore && <View className='feed-loading'><Text>加载中...</Text></View>}
        {!hasMore && feeds.length > 0 && <View className='feed-end'><Text>— 没有更多了 —</Text></View>}
        <View className='feed-bottom-safe' />
      </ScrollView>

      <View className='fab-button' onClick={() => setShowPublish(true)}>
        <Text className='fab-button-text'>+</Text>
      </View>

      {showPublish && (
        <View className='publish-overlay' onClick={() => setShowPublish(false)}>
          <View className='publish-panel' onClick={e => e.stopPropagation()}>
            <Text className='publish-title'>发布动态</Text>
            <View className='publish-form'>
              <View className='publish-select-row'>
                <Text className='publish-label'>类型</Text>
                <View className='publish-type-options'>
                  {FEED_TYPES.map(t => (
                    <View key={t} className={`publish-type-btn ${publishType === t ? 'publish-type-btn--active' : ''}`}
                      style={{ borderColor: publishType === t ? FEED_TYPE_COLORS[t] : undefined }} onClick={() => setPublishType(t)}
                    >
                      <Text className='publish-type-btn-text'>{FEED_TYPE_LABELS[t]}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Textarea className='publish-textarea' placeholder='分享家庭的美好时刻...' value={publishContent}
                onInput={e => setPublishContent(e.detail.value)}
              />
              {familyPets.length > 0 && (
                <View className='publish-select-row'>
                  <Text className='publish-label'>关联宠物</Text>
                  <View className='publish-pet-options'>
                    <View className={`publish-pet-btn ${publishPetId === '' ? 'publish-pet-btn--active' : ''}`} onClick={() => setPublishPetId('')}>
                      <Text className='publish-pet-btn-text'>不关联</Text>
                    </View>
                    {familyPets.map(p => (
                      <View key={p.id} className={`publish-pet-btn ${publishPetId === p.id ? 'publish-pet-btn--active' : ''}`}
                        onClick={() => setPublishPetId(p.id)}
                      >
                        <Text className='publish-pet-btn-text'>{p.name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              <View className='publish-actions'>
                <Button className='publish-btn publish-btn--cancel' onClick={() => setShowPublish(false)}>取消</Button>
                <Button className='publish-btn publish-btn--submit' disabled={!publishContent.trim() || publishing} onClick={handlePublish}>
                  {publishing ? '发布中...' : '发布'}
                </Button>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}