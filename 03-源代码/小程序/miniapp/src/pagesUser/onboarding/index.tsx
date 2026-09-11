/**
 * 新用户引导页面
 * 首次使用引导轮播
 */
import { useState, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useAnalytics } from '../../hooks/useAnalytics'
import { useThemeClass } from '../../hooks/useThemeClass'
import './index.scss'
import PageBackground from '../../components/PageBackground'

interface OnboardingSlide {
  key: string
  icon: string
  title: string
  description: string
}

const SLIDES: OnboardingSlide[] = [
  {
    key: 'checkin',
    icon: '📋',
    title: '3秒健康打卡',
    description: '每天3秒记录便便、食欲、精神、运动、体重，AI即时反馈健康状态',
  },
  {
    key: 'food',
    icon: '🍖',
    title: '食物安全查询',
    description: '输入食物名称，秒查能不能吃。支持品种禁忌识别，保护毛孩子远离危险',
  },
  {
    key: 'symptom',
    icon: '🩺',
    title: 'AI症状初筛',
    description: '4步描述症状，AI评估紧急程度。红色预警立即就医，守护每一刻',
  },
]

export default function OnboardingPage() {
  const [currentSlide, setCurrentSlide] = useState(0)
  const { trackPageView, trackEvent } = useAnalytics()

  useEffect(() => { trackPageView('onboarding') }, [trackPageView])
  const themeClass = useThemeClass()

  const slide = SLIDES[currentSlide]

  useEffect(() => {
    trackEvent('onboarding_step_view', { step: currentSlide + 1, stepKey: slide.key })
  }, [currentSlide, slide.key, trackEvent])

  const handleNext = () => {
    if (currentSlide < SLIDES.length - 1) {
      setCurrentSlide(currentSlide + 1)
    }
  }

  const handleStart = () => {
    trackEvent('onboarding_complete')
    Taro.setStorageSync('onboarding_completed', 'true')
    Taro.redirectTo({ url: '/pagesPet/add/index' })
  }

  const handleSkip = () => {
    trackEvent('onboarding_skip', { step: currentSlide + 1 })
    Taro.setStorageSync('onboarding_completed', 'true')
    Taro.switchTab({ url: '/pages/index/index' })
  }

  return (
    <View className={'onboarding-page ' + themeClass}>
      <PageBackground />
      <View className='onboarding-page__skip' onClick={handleSkip}>
        <Text className='onboarding-page__skip-text'>跳过</Text>
      </View>

      <View className='onboarding-page__content'>
        <View className='onboarding-page__icon'>
          <Text className='onboarding-page__icon-emoji'>{slide.icon}</Text>
        </View>
        <Text className='onboarding-page__title'>{slide.title}</Text>
        <Text className='onboarding-page__description'>{slide.description}</Text>
      </View>

      <View className='onboarding-page__dots'>
        {SLIDES.map((s, i) => (
          <View
            key={s.key}
            className={`onboarding-page__dot ${i === currentSlide ? 'onboarding-page__dot--active' : ''}`}
          />
        ))}
      </View>

      <View className='onboarding-page__actions'>
        {currentSlide < SLIDES.length - 1 ? (
          <View className='onboarding-page__btn onboarding-page__btn--next' onClick={handleNext}>
            <Text className='onboarding-page__btn-text'>下一步</Text>
          </View>
        ) : (
          <View className='onboarding-page__btn onboarding-page__btn--start' onClick={handleStart}>
            <Text className='onboarding-page__btn-text'>添加我的宠物</Text>
          </View>
        )}
      </View>
    </View>
  )
}
