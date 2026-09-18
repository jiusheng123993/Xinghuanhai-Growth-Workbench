/**
 * 品种百科页面
 * 宠物品种查询、AI图片识别品种、特征信息展示
 */
import { View, Text, ScrollView, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useMemo, useCallback, useEffect } from 'react'
import { useThemeStore, type ThemeKey } from '../../stores/themeStore'
import { getActiveBreeds, type BreedItem } from '../../data/petKnowledge/breeds'
import { MedicalDisclaimer } from '../../engines/petSafety/MedicalDisclaimer'
import { useAnalytics, usePageView } from '../../hooks/useAnalytics'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { recognizeBreed, matchBreedInData, syncBreedKnowledge, type BreedRecognizeResult } from '../../services/breedService'
import './index.scss'
import { PageBackground, Icon, Illustration } from '../../components'

const disclaimerText = new MedicalDisclaimer().getDisclaimer('green', 'breed')

type SpeciesFilter = 'all' | 'dog' | 'cat'
type SizeFilter = 'all' | 'toy' | 'small' | 'medium' | 'large' | 'giant'

const SIZE_LABELS: Record<SizeFilter, string> = {
  all: '全部',
  toy: '超小型',
  small: '小型',
  medium: '中型',
  large: '大型',
  giant: '巨型',
}

const SPECIES_EMOJI: Record<string, string> = {
  dog: '🐶',
  cat: '🐱',
}

export default function PetBreed() {
  const [searchText, setSearchText] = useState<string>('')
  const [speciesFilter, setSpeciesFilter] = useState<SpeciesFilter>('all')
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>('all')
  const [displayCount, setDisplayCount] = useState<number>(20)
  // 拍照识别状态
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [recognizeResult, setRecognizeResult] = useState<BreedRecognizeResult | null>(null)
  const [matchedBreedId, setMatchedBreedId] = useState<string | null>(null)
  const { trackPageView, trackEvent } = useAnalytics()

  // 直接从 store 读取主题，避免 useThemeClass 内 useEffect 冗余 setState 触发渲染层异常
  const [themeKey, setThemeKey] = useState<ThemeKey>(() => useThemeStore.getState().current)
  useEffect(() => {
    const handler = (t: ThemeKey) => { setThemeKey(t) }
    Taro.eventCenter.on('themeChange', handler)
    return () => { Taro.eventCenter.off('themeChange', handler) }
  }, [])
  const themeClass = `theme-${themeKey}`

  usePageView('breed')

  // 品种库热更新：挂载时拉一次服务端最新版本（失败不阻塞，继续用静态兜底/缓存）
  const [breedDataVersion, setBreedDataVersion] = useState(0)
  useEffect(() => {
    syncBreedKnowledge().then((synced) => {
      if (synced) setBreedDataVersion((v) => v + 1)
    })
  }, [])

  const filteredBreeds = useMemo<BreedItem[]>(() => {
    // 取当前生效品种库（静态兜底或服务端热更新版本）
    void breedDataVersion // 仅作刷新信号：热更新切换成功后递增触发本 memo 重算
    let result = getActiveBreeds()

    if (speciesFilter !== 'all') {
      result = result.filter((b) => b.species === speciesFilter)
    }
    if (sizeFilter !== 'all') {
      result = result.filter((b) => b.size === sizeFilter)
    }
    if (searchText.trim()) {
      const keyword = searchText.trim().toLowerCase()
      result = result.filter(
        (b) =>
          b.name.includes(keyword) ||
          b.aliases.some((a) => a.toLowerCase().includes(keyword))
      )
    }

    return result
  }, [searchText, speciesFilter, sizeFilter, breedDataVersion])

  const handleBreedClick = useCallback((breed: BreedItem) => {
    trackEvent('click_breed_card', { breedId: breed.id, breedName: breed.name })
    Taro.navigateTo({ url: `/pagesPet/breed-detail/index?id=${breed.id}` })
  }, [trackEvent])

  const handleSpeciesFilterChange = useCallback((value: SpeciesFilter) => {
    setSpeciesFilter(value)
    setDisplayCount(20)
    trackEvent('filter_species', { species: value })
  }, [trackEvent])

  const handleSizeFilterChange = useCallback((value: SizeFilter) => {
    setSizeFilter(value)
    setDisplayCount(20)
  }, [])

  const handleSearchInput = useCallback((e: { detail: { value: string } }) => {
    setSearchText(e.detail.value)
    setDisplayCount(20)
    if (e.detail.value.trim()) {
      trackEvent('search_breed', { query: e.detail.value.trim() })
    }
  }, [trackEvent])

  const handleLoadMore = useCallback(() => {
    setDisplayCount((prev) => prev + 20)
  }, [])

  // 拍照识别品种
  const handleCameraRecognize = useCallback(async () => {
    if (isRecognizing) return

    try {
      const result = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
      })

      if (!result.tempFilePaths || result.tempFilePaths.length === 0) return

      setIsRecognizing(true)
      trackEvent('breed_recognize_start', {})

      // 改名 recognized：避免遮蔽组件状态 recognizeResult（no-shadow）
      const recognized = await recognizeBreed(result.tempFilePaths[0])

      if (recognized) {
        setRecognizeResult(recognized)
        // 在品种库中匹配
        const matchedId = matchBreedInData(recognized.breedName, recognized.species, getActiveBreeds())
        setMatchedBreedId(matchedId)
        trackEvent('breed_recognize_success', {
          breedName: recognized.breedName,
          confidence: recognized.confidence,
          matched: !!matchedId,
        })
      }
    } catch (err: any) {
      // 用户取消选择不提示
      if (err?.errMsg?.includes('cancel')) return
      console.error('[Breed] 拍照识别失败:', err)
    } finally {
      setIsRecognizing(false)
    }
  }, [isRecognizing, trackEvent])

  // 关闭识别结果弹窗
  const handleCloseResult = useCallback(() => {
    setRecognizeResult(null)
    setMatchedBreedId(null)
  }, [])

  // 跳转到匹配的品种详情
  const handleGoToDetail = useCallback(() => {
    if (matchedBreedId) {
      handleCloseResult()
      Taro.navigateTo({ url: `/pagesPet/breed-detail/index?id=${matchedBreedId}` })
    }
  }, [matchedBreedId, handleCloseResult])

  return (
    <View className={`breed-page ${themeClass}`}>
      <PageBackground />
      <View className='breed-page__header'>
        <Text className='breed-page__title'>品种百科</Text>
        <Text className='breed-page__subtitle'>
          共收录 {getActiveBreeds().length} 个品种，了解你的毛孩子
        </Text>
      </View>

      <View className='breed-page__search'>
        <View className='breed-page__search-wrapper'>
          <Icon name='magnifying-glass' size={18} tone='ink' className='breed-page__search-icon' />
          <Input
            className='breed-page__search-input'
            placeholder='搜索品种名称...'
            placeholderClass='breed-page__search-placeholder'
            value={searchText}
            onInput={handleSearchInput}
          />
          {searchText && (
            <View className='breed-page__search-clear' onClick={() => { setSearchText(''); setDisplayCount(20) }}>
              <Text className='breed-page__search-clear-icon'>✕</Text>
            </View>
          )}
        </View>
      </View>

      <View className='breed-page__filters'>
        <ScrollView className='breed-page__filter-row' scrollX>
          <View
            className={`breed-page__filter-chip ${speciesFilter === 'all' ? 'breed-page__filter-chip--active' : ''}`}
            onClick={() => handleSpeciesFilterChange('all')}
          >
            <Text>全部</Text>
          </View>
          <View
            className={`breed-page__filter-chip ${speciesFilter === 'dog' ? 'breed-page__filter-chip--active' : ''}`}
            onClick={() => handleSpeciesFilterChange('dog')}
          >
            {/* 功能性 emoji 换成面性图标（与全站图标体系一致，且能随主题换色） */}
            <Icon name='dog' size={14} tone={speciesFilter === 'dog' ? 'primary' : 'muted'} />
            <Text>犬类</Text>
          </View>
          <View
            className={`breed-page__filter-chip ${speciesFilter === 'cat' ? 'breed-page__filter-chip--active' : ''}`}
            onClick={() => handleSpeciesFilterChange('cat')}
          >
            <Icon name='cat' size={14} tone={speciesFilter === 'cat' ? 'primary' : 'muted'} />
            <Text>猫类</Text>
          </View>
        </ScrollView>

        <ScrollView className='breed-page__filter-row' scrollX>
          {(['all', 'toy', 'small', 'medium', 'large', 'giant'] as SizeFilter[]).map((size) => (
            <View
              key={size}
              className={`breed-page__filter-chip ${sizeFilter === size ? 'breed-page__filter-chip--active' : ''}`}
              onClick={() => handleSizeFilterChange(size)}
            >
              <Text>{SIZE_LABELS[size]}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <ScrollView className='breed-page__list' scrollY lowerThreshold={100} onScrollToLower={handleLoadMore}>
        <View className='breed-page__count'>
          <Text className='breed-page__count-text'>
            共 {filteredBreeds.length} 个品种
          </Text>
        </View>

        <View className='breed-page__grid'>
          {filteredBreeds.slice(0, displayCount).map((breed) => (
            <View
              key={breed.id}
              className='breed-page__card'
              onClick={() => handleBreedClick(breed)}
            >
              <View className='breed-page__card-emoji'>
                <Text className='breed-page__card-emoji-text'>{SPECIES_EMOJI[breed.species]}</Text>
              </View>
              <View className='breed-page__card-body'>
                <Text className='breed-page__card-name'>{breed.name}</Text>
                <View className='breed-page__card-meta'>
                  {/* ⏱/⚖ 属功能性符号，换面性图标，与卡片名左侧的图标体系一致 */}
                  <View className='breed-page__card-meta-item'>
                    <Icon name='clock' size={12} tone='muted' />
                    <Text>{breed.lifespan}</Text>
                  </View>
                  <View className='breed-page__card-meta-item'>
                    <Icon name='scales' size={12} tone='muted' />
                    <Text>{breed.weightRangeStr}</Text>
                  </View>
                </View>
                <View className='breed-page__card-tags'>
                  {breed.temperament.slice(0, 3).map((t) => (
                    <View key={t} className='breed-page__card-tag'>
                      <Text>{t}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View className='breed-page__card-arrow'>
                <Text>›</Text>
              </View>
            </View>
          ))}
        </View>

        {filteredBreeds.length > 0 && displayCount < filteredBreeds.length && (
          <View className='breed-page__load-more' onClick={handleLoadMore}>
            <Text className='breed-page__load-more-text'>加载更多</Text>
          </View>
        )}
        {filteredBreeds.length > 0 && displayCount >= filteredBreeds.length && (
          <View className='breed-page__load-more'>
            <Text className='breed-page__load-more-text'>已加载全部 {filteredBreeds.length} 个品种</Text>
          </View>
        )}

        {filteredBreeds.length === 0 && (
          <View className='breed-page__empty'>
            {/* 空态插画：`empty-search` 的画面是「猫狗一起低头看一枚立在地上的空放大镜」，
                与本处「搜索无果」逐字对应（服务器 /uploads/illustrations/empty-search.jpg，HEAD 200）。
                为什么替换掉原来的 18px 小图标：`.breed-page__empty` 上下各留 80px，
                18px 图标在那个留白里几乎看不见，和全站空态口径（EmptyState 统一 132px 插画）也不成比例。 */}
            <Illustration name='empty-search' size={132} className='breed-page__empty-illus' />
            <Text className='breed-page__empty-text'>未找到匹配的品种</Text>
          </View>
        )}
      </ScrollView>

      <View className='breed-page__disclaimer'>
        <Text className='breed-page__disclaimer-text'>{disclaimerText}</Text>
      </View>

      {/* 拍照识别按钮 */}
      <View
        className={`breed-page__camera-btn ${isRecognizing ? 'breed-page__camera-btn--loading' : ''}`}
        onClick={handleCameraRecognize}
      >
        {/* 识别中保留 ⏳ 文案（进度感），空闲态用面性相机图标 */}
        <View className='breed-page__camera-btn-icon'>
          {isRecognizing ? <Text className='breed-page__camera-btn-loading'>⏳</Text> : <Icon name='camera' size={24} tone='white' />}
        </View>
      </View>

      {/* 识别中遮罩 */}
      {isRecognizing && (
        <View className='breed-page__recognize-overlay'>
          <View className='breed-page__recognize-loading'>
            <View className='breed-page__recognize-spinner' />
            <Text className='breed-page__recognize-loading-text'>AI 正在识别品种...</Text>
            <Text className='breed-page__recognize-loading-sub'>请稍候，正在分析照片中的宠物</Text>
          </View>
        </View>
      )}

      {/* 识别结果弹窗 */}
      {recognizeResult && !isRecognizing && (
        <View className='breed-page__recognize-overlay' onClick={handleCloseResult}>
          <View className='breed-page__recognize-modal' onClick={(e) => e.stopPropagation()}>
            <View className='breed-page__recognize-modal-header'>
              <Text className='breed-page__recognize-modal-title'>识别结果</Text>
              <View className='breed-page__recognize-modal-close' onClick={handleCloseResult}>
                <Text>✕</Text>
              </View>
            </View>

            <View className='breed-page__recognize-modal-body'>
              <View className='breed-page__recognize-species'>
                <Text className='breed-page__recognize-species-icon'>
                  {recognizeResult.species === 'dog' ? '🐶' : '🐱'}
                </Text>
                <Text className='breed-page__recognize-species-label'>
                  {recognizeResult.species === 'dog' ? '犬类' : '猫类'}
                </Text>
              </View>

              <Text className='breed-page__recognize-breed-name'>{recognizeResult.breedName}</Text>

              <View className='breed-page__recognize-confidence'>
                <View className='breed-page__recognize-confidence-bar'>
                  <View
                    className='breed-page__recognize-confidence-fill'
                    style={{ width: `${recognizeResult.confidence}%` }}
                  />
                </View>
                <Text className='breed-page__recognize-confidence-text'>
                  置信度 {recognizeResult.confidence}%
                </Text>
              </View>

              {recognizeResult.reason && (
                <Text className='breed-page__recognize-reason'>{recognizeResult.reason}</Text>
              )}

              {matchedBreedId ? (
                <View className='breed-page__recognize-match'>
                  <Icon name='check-circle' size={18} tone='muted' className='breed-page__recognize-match-icon' />
                  <Text className='breed-page__recognize-match-text'>已在品种百科中找到匹配品种</Text>
                </View>
              ) : (
                <View className='breed-page__recognize-match breed-page__recognize-match--no'>
                  <Icon name='magnifying-glass' size={18} tone='muted' className='breed-page__recognize-match-icon' />
                  <Text className='breed-page__recognize-match-text'>
                    品种百科中暂无该品种，可手动搜索查看
                  </Text>
                </View>
              )}
            </View>

            <View className='breed-page__recognize-modal-footer'>
              {matchedBreedId && (
                <View className='breed-page__recognize-btn breed-page__recognize-btn--primary' onClick={handleGoToDetail}>
                  <Text>查看品种详情</Text>
                </View>
              )}
              <View
                className={`breed-page__recognize-btn ${matchedBreedId ? '' : 'breed-page__recognize-btn--primary'}`}
                onClick={handleCloseResult}
              >
                <Text>{matchedBreedId ? '关闭' : '知道了'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
