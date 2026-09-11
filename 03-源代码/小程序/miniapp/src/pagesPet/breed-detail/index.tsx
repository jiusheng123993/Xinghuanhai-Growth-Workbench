/**
 * 品种详情页面
 * 宠物品种详细信息展示、特征、疾病、护理建议
 */
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useState, useEffect, useCallback } from 'react'
import { useThemeStore, type ThemeKey } from '../../stores/themeStore'
import { getActiveBreeds, type BreedItem } from '../../data/petKnowledge/breeds'
import { syncBreedKnowledge } from '../../services/breedService'
import { MedicalDisclaimer } from '../../engines/petSafety/MedicalDisclaimer'
import { useAnalytics, usePageView } from '../../hooks/useAnalytics'
import { usePet } from '../../hooks/usePet'
import { EVENT } from '../../constants/analyticsEvents'
import './index.scss'
import { PageBackground, Icon  } from '../../components'

const disclaimerText = new MedicalDisclaimer().getDisclaimer('green', 'breed')

const SPECIES_LABEL: Record<string, string> = {
  dog: '犬类',
  cat: '猫类',
}

const SPECIES_EMOJI: Record<string, string> = {
  dog: '🐶',
  cat: '🐱',
}

const SIZE_LABEL: Record<string, string> = {
  toy: '超小型',
  small: '小型',
  medium: '中型',
  large: '大型',
  giant: '巨型',
}

const EXERCISE_LABEL: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

const GROOMING_LABEL: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

export default function BreedDetail() {
  const [breed, setBreed] = useState<BreedItem | null>(null)
  const router = useRouter()
  const { trackEvent } = useAnalytics()
  usePageView('breed_detail')
  // 宠物列表：供「我的宠物是这个品种」确定目标宠物（编辑页强制要求宠物 id，缺失会提示「参数错误」）
  const { pets, isLoading: petsLoading } = usePet()

  // 直接从 store 读取主题，避免 useThemeClass 内 useEffect 冗余 setState 触发渲染层异常
  const [themeKey, setThemeKey] = useState<ThemeKey>(() => useThemeStore.getState().current)
  useEffect(() => {
    const handler = (t: ThemeKey) => { setThemeKey(t) }
    Taro.eventCenter.on('themeChange', handler)
    return () => { Taro.eventCenter.off('themeChange', handler) }
  }, [])
  const themeClass = `theme-${themeKey}`

  useEffect(() => {
    const id = router.params.id
    if (!id) return
    // 先用当前生效品种库立即渲染（静态兜底或已缓存的热更新版本），保证首屏不等待网络
    const found = getActiveBreeds().find((b) => b.id === id)
    if (found) {
      setBreed(found)
      trackEvent(EVENT.BREED_VIEW, { breedId: found.id, breedName: found.name })
    }
    // 再异步拉服务端最新品种库；若该品种在新版本中存在则热替换渲染（修订即时可见）
    syncBreedKnowledge().then(() => {
      const fresh = getActiveBreeds().find((b) => b.id === id)
      if (fresh && fresh !== found) setBreed(fresh)
    })
  }, [router.params.id])

  /**
   * 「我的宠物是这个品种」：把当前品种预填进自家宠物档案
   * 坑点：编辑页强制要求宠物 id 参数（缺失即提示「参数错误」并退回），
   * 因此跳转前必须先确定目标宠物——无档案引导添加 / 单档案直跳 / 多档案 ActionSheet 选择
   */
  const handleSetMyPet = useCallback(() => {
    if (!breed) return
    trackEvent('set_my_pet_breed', { breedId: breed.id, breedName: breed.name })

    // 宠物列表还在加载：先等一下，避免把「未加载完」误判成「没有宠物」
    if (petsLoading) {
      Taro.showToast({ title: '加载中，请稍候', icon: 'none' })
      return
    }

    // 没有宠物档案：引导先去添加页（添加页不支持品种预填，进页面后自选）
    if (pets.length === 0) {
      Taro.showModal({
        title: '还没有宠物档案',
        content: '先添加宠物档案，再来设置品种吧',
        confirmText: '去添加',
        cancelText: '暂不',
        success: (res) => {
          if (res.confirm) Taro.navigateTo({ url: '/pagesPet/add/index' })
        },
      })
      return
    }

    // 跳编辑页：id=目标宠物，品种三件套（breedId/breedName/species）供编辑页预填覆盖旧品种
    const goEdit = (petId: string) => {
      Taro.navigateTo({
        url: `/pagesPet/edit/index?id=${petId}&breedId=${breed.id}&breedName=${encodeURIComponent(breed.name)}&species=${breed.species}`,
      })
    }

    // 只有一只宠物：无需选择，直接进编辑页
    if (pets.length === 1) {
      goEdit(pets[0].id)
      return
    }

    // 多只宠物：ActionSheet 选一只（微信 ActionSheet 上限 6 项，超出截断；
    // 极端多宠场景属边缘 case，用户可分批设置，不值得为此引入自建选择弹层）
    Taro.showActionSheet({
      itemList: pets.slice(0, 6).map((p) => p.name),
      success: (res) => {
        const target = pets[res.tapIndex]
        if (target) goEdit(target.id)
      },
    })
  }, [breed, pets, petsLoading, trackEvent])

  if (!breed) {
    return (
      <View className={`breed-detail ${themeClass}`}>
        <PageBackground />
        <View className='breed-detail__loading'>
          <Text className='breed-detail__loading-text'>加载中...</Text>
        </View>
      </View>
    )
  }

  return (
    <View className={`breed-detail ${themeClass}`}>
      <ScrollView className='breed-detail__scroll' scrollY>
        <View className='breed-detail__hero'>
          <View className='breed-detail__hero-emoji'>
            <Text className='breed-detail__hero-emoji-text'>{SPECIES_EMOJI[breed.species]}</Text>
          </View>
          <Text className='breed-detail__hero-name'>{breed.name}</Text>
          <View className='breed-detail__hero-badges'>
            <View className='breed-detail__hero-badge'>
              <Text>{SPECIES_LABEL[breed.species]}</Text>
            </View>
            <View className='breed-detail__hero-badge'>
              <Text>{SIZE_LABEL[breed.size]}</Text>
            </View>
            <View className='breed-detail__hero-badge'>
              <Text>{breed.origin}</Text>
            </View>
          </View>
        </View>

        <View className='breed-detail__info-grid'>
          <View className='breed-detail__info-item'>
            <Text className='breed-detail__info-label'>寿命</Text>
            <Text className='breed-detail__info-value'>{breed.lifespan}</Text>
          </View>
          <View className='breed-detail__info-item'>
            <Text className='breed-detail__info-label'>体重</Text>
            <Text className='breed-detail__info-value'>{breed.weightRangeStr}</Text>
          </View>
          <View className='breed-detail__info-item'>
            <Text className='breed-detail__info-label'>运动需求</Text>
            <Text className='breed-detail__info-value'>{EXERCISE_LABEL[breed.exerciseNeeds]}</Text>
          </View>
          <View className='breed-detail__info-item'>
            <Text className='breed-detail__info-label'>美容需求</Text>
            <Text className='breed-detail__info-value'>{GROOMING_LABEL[breed.groomingNeeds]}</Text>
          </View>
        </View>

        {breed.aliases.length > 0 && (
          <View className='breed-detail__section'>
            <Text className='breed-detail__section-title'>别名</Text>
            <View className='breed-detail__tags'>
              {breed.aliases.map((alias) => (
                <View key={alias} className='breed-detail__tag'>
                  <Text>{alias}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {breed.temperament.length > 0 && (
          <View className='breed-detail__section'>
            <Text className='breed-detail__section-title'>性格特征</Text>
            <View className='breed-detail__tags'>
              {breed.temperament.map((t) => (
                <View key={t} className='breed-detail__tag breed-detail__tag--primary'>
                  <Text>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {breed.suitableFor.length > 0 && (
          <View className='breed-detail__section'>
            <Text className='breed-detail__section-title'>适合人群</Text>
            <View className='breed-detail__tags'>
              {breed.suitableFor.map((s) => (
                <View key={s} className='breed-detail__tag breed-detail__tag--green'>
                  <Text>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {breed.toxicFoods.length > 0 && (
          <View className='breed-detail__section'>
            <Text className='breed-detail__section-title breed-detail__section-title--danger'>
              ⚠️ 饮食禁忌
            </Text>
            <View className='breed-detail__danger-list'>
              {breed.toxicFoods.map((food) => (
                <View key={food} className='breed-detail__danger-card'>
                  <Text className='breed-detail__danger-icon'>🚫</Text>
                  <Text className='breed-detail__danger-text'>{food}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {breed.commonDiseases.length > 0 && (
          <View className='breed-detail__section'>
            <Text className='breed-detail__section-title breed-detail__section-title--warning'>
              ⚡ 常见疾病
            </Text>
            <View className='breed-detail__warning-list'>
              {breed.commonDiseases.map((disease) => (
                <View key={disease} className='breed-detail__warning-card'>
                  <Icon name='lightbulb' size={18} tone='primary' className='breed-detail__warning-icon' />
                  <Text className='breed-detail__warning-text'>{disease}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {breed.careTips.length > 0 && (
          <View className='breed-detail__section'>
            <Text className='breed-detail__section-title breed-detail__section-title--success'>
              💚 养护建议
            </Text>
            <View className='breed-detail__success-list'>
              {breed.careTips.map((tip, index) => (
                <View key={index} className='breed-detail__success-card'>
                  <Text className='breed-detail__success-index'>{index + 1}</Text>
                  <Text className='breed-detail__success-text'>{tip}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {breed.dietRestrictions.length > 0 && (
          <View className='breed-detail__section'>
            <Text className='breed-detail__section-title'>饮食建议</Text>
            <View className='breed-detail__list'>
              {breed.dietRestrictions.map((item) => (
                <View key={item} className='breed-detail__list-item'>
                  <Text className='breed-detail__list-dot'>•</Text>
                  <Text className='breed-detail__list-text'>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View className='breed-detail__disclaimer'>
          <Text className='breed-detail__disclaimer-text'>{disclaimerText}</Text>
        </View>

        <View className='breed-detail__bottom-spacer' />
      </ScrollView>

      <View className='breed-detail__footer'>
        <View className='breed-detail__footer-btn' onClick={handleSetMyPet}>
          <Text className='breed-detail__footer-btn-text'>我的宠物是这个品种</Text>
        </View>
      </View>
    </View>
  )
}
