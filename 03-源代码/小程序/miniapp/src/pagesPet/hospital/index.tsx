/**
 * 宠物医院查询页面
 * 附近宠物医院搜索、筛选、电话导航
 */
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { useAnalytics, usePageView } from '../../hooks/useAnalytics'
import { AnalyticsEventName } from '../../types/analyticsTypes'
import { MedicalDisclaimer } from '../../engines/petSafety/MedicalDisclaimer'
import PageLoading from '../../components/PageLoading'
import {
  getNearbyHospitals,
  searchHospitals,
  getEmergencyHospitals,
  callHospital,
  navigateToHospital,
  HospitalInfo,
} from '../../services/hospitalService'
import './index.scss'
import { PageBackground, Icon, Illustration } from '../../components'

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'emergency', label: '24h急诊' },
  { key: 'general', label: '综合' },
  { key: 'specialist', label: '专科' },
  { key: 'nearest', label: '离我最近' },
] as const

type FilterKey = typeof FILTER_TABS[number]['key']

const TYPE_LABELS: Record<string, string> = {
  general: '综合',
  specialist: '专科',
  emergency: '急诊',
}

const TYPE_COLORS: Record<string, string> = {
  general: '#4A90D9',
  specialist: '#FF8C42',
  emergency: '#FF4D4F',
}

export default function HospitalPage() {
  /**
   * 主题类名：**必须挂在页面自己的根节点上**
   *
   * 为什么：小程序端每个页面独立渲染，app 组件的 JSX 不包裹页面节点，挂在 app 层的
   * `.theme-*` 传不进页面；不挂就会永远吃 styles/_theme.scss 里 page{} 的秋季基线变量，
   * 用户切主题后本页仍是一片秋色。口径与 pages/creative、pages/mine 一致。
   * （本页文件顶部原本就 import 了 useThemeClass 却从未调用，这里把它接上。）
   */
  const themeClass = useThemeClass()
  const { trackEvent } = useAnalytics()
  const [searchText, setSearchText] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const [hospitals, setHospitals] = useState<HospitalInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedHospital, setSelectedHospital] = useState<HospitalInfo | null>(null)

  usePageView('hospital')

  const loadHospitals = useCallback(() => {
    setLoading(true)
    try {
      let result: HospitalInfo[] = []
      switch (activeFilter) {
        case 'emergency':
          result = getEmergencyHospitals()
          break
        case 'general':
          result = getNearbyHospitals().filter(h => h.type === 'general')
          break
        case 'specialist':
          result = getNearbyHospitals().filter(h => h.type === 'specialist')
          break
        case 'nearest':
          result = getNearbyHospitals()
          break
        default:
          result = getNearbyHospitals()
      }
      setHospitals(result)
    } catch (error) {
      Taro.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [activeFilter])

  useEffect(() => {
    loadHospitals()
  }, [loadHospitals])

  const handleSearch = useCallback(() => {
    if (!searchText.trim()) {
      loadHospitals()
      return
    }
    trackEvent(AnalyticsEventName.FindHospital, {
      petId: '',
      urgencyLevel: 'green',
      source: 'search',
    })
    setLoading(true)
    try {
      const result = searchHospitals(searchText.trim())
      setHospitals(result)
    } catch (error) {
    } finally {
      setLoading(false)
    }
  }, [searchText, loadHospitals, trackEvent])

  const handleFilterChange = useCallback((filter: FilterKey) => {
    setActiveFilter(filter)
    trackEvent(AnalyticsEventName.FindHospital, {
      petId: '',
      urgencyLevel: 'green',
      source: `filter_${filter}`,
    })
  }, [trackEvent])

  const handleCall = useCallback((phone: string, hospitalName: string) => {
    trackEvent(AnalyticsEventName.FindHospital, {
      petId: '',
      urgencyLevel: 'green',
      source: 'call_phone',
    })
    callHospital(phone)
  }, [trackEvent])

  const handleNavigate = useCallback((hospital: HospitalInfo) => {
    trackEvent(AnalyticsEventName.FindHospital, {
      petId: '',
      urgencyLevel: 'green',
      source: 'navigate',
    })
    navigateToHospital(hospital.latitude, hospital.longitude, hospital.name)
  }, [trackEvent])

  const handleCardClick = useCallback((hospital: HospitalInfo) => {
    setSelectedHospital((prev: HospitalInfo | null) => (prev?.id === hospital.id ? null : hospital))
  }, [])

  const renderStars = useCallback((rating: number) => {
    const fullStars = Math.floor(rating)
    const hasHalf = rating - fullStars >= 0.5
    const stars: string[] = []
    for (let i = 0; i < fullStars; i++) {
      stars.push('★')
    }
    if (hasHalf) {
      stars.push('☆')
    }
    return stars.join('')
  }, [])

  const filteredHospitals = useMemo(() => {
    return hospitals
  }, [hospitals])

  return (
    <View className={`hospital-page ${themeClass}`}>
      <PageBackground />
      <View className='hospital-page__search'>
        <View className='hospital-page__search-input-wrap'>
          <Icon name='magnifying-glass' size={14} tone='muted' className='hospital-page__search-icon' />
          <Input
            className='hospital-page__search-input'
            placeholder='搜索医院名称、地址或服务'
            placeholderClass='hospital-page__search-placeholder'
            value={searchText}
            onInput={(e) => setSearchText(e.detail.value)}
            onConfirm={handleSearch}
          />
          {searchText && (
            <View
              className='hospital-page__search-clear'
              onClick={() => { setSearchText(''); loadHospitals() }}
            >
              <Text>✕</Text>
            </View>
          )}
        </View>
        <View className='hospital-page__search-btn' onClick={handleSearch}>
          <Text className='hospital-page__search-btn-text'>搜索</Text>
        </View>
      </View>

      <View className='hospital-page__filters'>
        {FILTER_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`hospital-page__filter-tag${
              activeFilter === tab.key ? ' hospital-page__filter-tag--active' : ''
            }`}
            onClick={() => handleFilterChange(tab.key)}
          >
            <Text className='hospital-page__filter-tag-text'>{tab.label}</Text>
          </View>
        ))}
      </View>

      <View className='hospital-page__disclaimer'>
        <Text className='hospital-page__disclaimer-text'>
          {new MedicalDisclaimer().getSymptomDisclaimer('green')}
        </Text>
      </View>

      {loading ? (
        <PageLoading text='正在加载医院信息...' />
      ) : filteredHospitals.length === 0 ? (
        <View className='hospital-page__empty'>
          {/* 空态插画：`empty-search`（猫狗一起看一枚空放大镜）对应本处「筛选/搜索后无匹配结果」——
              文案本身就是「尝试更换筛选条件或搜索关键词」，所以放大镜语义比原来的医院图标更贴。
              同时这张空态上下各留 160rpx，48px 的图标在其中偏小，换成 132px 插画（全站空态口径）更平衡。 */}
          <Illustration name='empty-search' size={132} className='hospital-page__empty-illus' />
          <Text className='hospital-page__empty-text'>暂无符合条件的医院</Text>
          <Text className='hospital-page__empty-hint'>尝试更换筛选条件或搜索关键词</Text>
        </View>
      ) : (
        <View className='hospital-page__list'>
          {filteredHospitals.map((hospital) => (
            <View
              key={hospital.id}
              className='hospital-page__card'
              onClick={() => handleCardClick(hospital)}
            >
              <View className='hospital-page__card-header'>
                <View className='hospital-page__card-title-wrap'>
                  <Text className='hospital-page__card-name'>{hospital.name}</Text>
                  <View
                    className='hospital-page__card-type'
                    style={{ backgroundColor: `${TYPE_COLORS[hospital.type]}18`, color: TYPE_COLORS[hospital.type] }}
                  >
                    <Text className='hospital-page__card-type-text'>
                      {TYPE_LABELS[hospital.type] || hospital.type}
                    </Text>
                  </View>
                </View>
                <View className='hospital-page__card-rating'>
                  <Text className='hospital-page__card-stars'>{renderStars(hospital.rating)}</Text>
                  <Text className='hospital-page__card-rating-text'>{hospital.rating.toFixed(1)}</Text>
                </View>
              </View>

              <View className='hospital-page__card-info'>
                <View className='hospital-page__card-info-item'>
                  <Icon name='map-pin' size={12} tone='muted' className='hospital-page__card-info-icon' />
                  <Text className='hospital-page__card-info-text'>{hospital.address}</Text>
                </View>
                <View className='hospital-page__card-info-item'>
                  <Text className='hospital-page__card-info-icon'></Text>
                  <Text className='hospital-page__card-info-text'>{hospital.openHours}</Text>
                </View>
                <View className='hospital-page__card-info-item'>
                  <Text className='hospital-page__card-info-icon'>📏</Text>
                  <Text className='hospital-page__card-info-text'>距您约 {hospital.distance}km</Text>
                </View>
              </View>

              <View className='hospital-page__card-services'>
                {hospital.services.slice(0, 4).map((service: string, index: number) => (
                  <View key={index} className='hospital-page__card-service-tag'>
                    <Text className='hospital-page__card-service-tag-text'>{service}</Text>
                  </View>
                ))}
                {hospital.services.length > 4 && (
                  <View className='hospital-page__card-service-tag hospital-page__card-service-tag--more'>
                    <Text className='hospital-page__card-service-tag-text'>+{hospital.services.length - 4}</Text>
                  </View>
                )}
              </View>

              {selectedHospital?.id === hospital.id && (
                <View className='hospital-page__card-detail'>
                  {hospital.specialties && hospital.specialties.length > 0 && (
                    <View className='hospital-page__card-detail-section'>
                      <Text className='hospital-page__card-detail-label'>专科特色</Text>
                      <View className='hospital-page__card-detail-tags'>
                        {hospital.specialties.map((specialty: string, index: number) => (
                          <Text key={index} className='hospital-page__card-detail-tag'>{specialty}</Text>
                        ))}
                      </View>
                    </View>
                  )}
                  <View className='hospital-page__card-detail-section'>
                    <Text className='hospital-page__card-detail-label'>接诊物种</Text>
                    <View className='hospital-page__card-detail-tags'>
                      {hospital.species.map((s: string, index: number) => (
                        <Text key={index} className='hospital-page__card-detail-tag'>
                          {s === 'dog' ? '犬' : s === 'cat' ? '猫' : s === 'bird' ? '鸟类' : s === 'rabbit' ? '兔子' : s === 'reptile' ? '爬行类' : '小宠'}
                        </Text>
                      ))}
                    </View>
                  </View>
                </View>
              )}

              <View className='hospital-page__card-actions'>
                <View
                  className='hospital-page__card-btn hospital-page__card-btn--call'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCall(hospital.phone, hospital.name)
                  }}
                >
                  <Text className='hospital-page__card-btn-icon'>📞</Text>
                  <Text className='hospital-page__card-btn-text'>电话</Text>
                </View>
                <View
                  className='hospital-page__card-btn hospital-page__card-btn--nav'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleNavigate(hospital)
                  }}
                >
                  <Text className='hospital-page__card-btn-icon'>🧭</Text>
                  <Text className='hospital-page__card-btn-text'>导航</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
