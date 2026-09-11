/**
 * 情绪陪伴页面（按高保真原型 1:1 新建）
 * 主视觉 hero → 隐私提示 → 纪念专区 2x2 → 想对你说 → 哀伤陪伴流程 → 专业支持引导
 * 业务接回：GriefCompanion 组件（4 步情绪陪伴流程）+ 各专区页面跳转
 */
import { View, Text } from '@tarojs/components'
import { useState, useCallback } from 'react'
import Taro from '@tarojs/taro'
import { useThemeClass } from '../../hooks/useThemeClass'
import { usePetStore } from '../../stores/petStore'
import GriefCompanion from '../../components/GriefCompanion'
import { safeNavigateBack } from '../../utils/navigation'
import type { PetSpecies } from '../../types/avatarTypes'
import './index.scss'
import PageBackground from '../../components/PageBackground'

/** 陪伴话术 */
const COMFORT_MESSAGES = [
  { icon: '🕊️', text: '不用着急走出来，想念是爱的一部分' },
  { icon: '🌙', text: 'TA 现在很好，只是换了个地方等你' },
  { icon: '💬', text: '难过的时候，随时来和我说说' },
]

/** 纪念专区 2x2 */
const MEMORIAL_ENTRIES = [
  { key: 'memoir', icon: '📖', title: '回忆录', desc: '做一条专属回忆录', url: '/pagesMemoir/memoir-daily/index' },
  { key: 'timeline', icon: '🕰️', title: '时光线', desc: '回看 TA 的日常', url: '/pages/timeline/index' },
  { key: 'family', icon: '🌳', title: '家族图谱', desc: '家族的每一个成员', url: '/pagesPet/family-tree/index' },
  { key: 'share', icon: '🃏', title: '分享卡片', desc: '把爱分享出去', url: '/pagesPet/share-card/index' },
]

export default function GriefPage() {
  const themeClass = useThemeClass()
  const { currentPet } = usePetStore()

  const [showCompanion, setShowCompanion] = useState(false)

  const petName = currentPet?.name || '毛孩子'
  const species = (currentPet?.species || 'dog') as PetSpecies
  const deceasedDate = currentPet?.deceasedDate || ''

  const handleGoEntry = useCallback((url: string, petId: string) => {
    const withPet = url.includes('/pagesPet/')
      ? `${url}${petId ? `?petId=${petId}` : ''}`
      : url
    Taro.navigateTo({ url: withPet })
  }, [])

  /** 拨打心理援助热线 */
  const handleCallHotline = useCallback(() => {
    Taro.makePhoneCall({
      phoneNumber: '400-161-9995',
    })
  }, [])

  const handleCompanionComplete = useCallback(() => {
    setShowCompanion(false)
  }, [])

  return (
    <View className={`grief ${themeClass}`}>
      <PageBackground />
      {/* 1. 主视觉 hero */}
      <View className='grief__hero'>
        <View className='grief__hero-bg'>
          <Text className='grief__hero-emoji'>🌅</Text>
        </View>
        <View className='grief__hero-shade' />
        <View className='grief__hero-caption'>
          <Text className='grief__hero-title'>我们陪你，慢慢道别</Text>
          <Text className='grief__hero-sub'>TA 的一生，值得被温柔记住</Text>
        </View>
      </View>

      {/* 2. 隐私提示条 */}
      <View className='grief__privacy'>
        <Text className='grief__privacy-icon'>🔒</Text>
        <Text className='grief__privacy-text'>此页面内容仅自己可见</Text>
      </View>

      {/* 3. 纪念专区 2x2 */}
      <View className='grief__section'>
        <Text className='grief__section-title'>纪念专区</Text>
        <View className='grief__mem-grid'>
          {MEMORIAL_ENTRIES.map(entry => (
            <View
              key={entry.key}
              className='grief__mem-card'
              onClick={() => handleGoEntry(entry.url, currentPet?.id || '')}
            >
              <View className='grief__mem-icon'>{entry.icon}</View>
              <Text className='grief__mem-title'>{entry.title}</Text>
              <Text className='grief__mem-desc'>{entry.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 4. 想对你说 */}
      <View className='grief__section'>
        <Text className='grief__section-title'>想对你说</Text>
        <View className='grief__soft-list'>
          {COMFORT_MESSAGES.map((msg, i) => (
            <View key={i} className='grief__soft-card'>
              <View className='grief__soft-icon'>{msg.icon}</View>
              <Text className='grief__soft-text'>{msg.text}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 5. 哀伤陪伴流程 */}
      {showCompanion ? (
        <View className='grief__companion-wrap'>
          <GriefCompanion
            petId={currentPet?.id || ''}
            petName={petName}
            species={species}
            deceasedDate={deceasedDate}
            onComplete={handleCompanionComplete}
          />
        </View>
      ) : (
        <View className='grief__companion-entry' onClick={() => setShowCompanion(true)}>
          <Text className='grief__companion-entry-icon'>🤍</Text>
          <View className='grief__companion-entry-texts'>
            <Text className='grief__companion-entry-title'>和{petName}说说话</Text>
            <Text className='grief__companion-entry-desc'>把想说的，慢慢说出来</Text>
          </View>
          <Text className='grief__companion-entry-arrow'>›</Text>
        </View>
      )}

      {/* 6. 专业支持引导 */}
      <View className='grief__support'>
        <View className='grief__support-head'>
          <Text className='grief__support-icon'>🫂</Text>
          <View className='grief__support-texts'>
            <Text className='grief__support-title'>我们也在你身边</Text>
            <Text className='grief__support-desc'>如果悲伤影响生活，可以寻求专业帮助</Text>
          </View>
        </View>
        <View className='grief__hotline-btn' onClick={handleCallHotline}>
          <Text className='grief__hotline-text'>📞 全国心理援助热线 400-161-9995</Text>
        </View>
        <Text className='grief__support-note'>本页内容不构成医疗建议，如有需要请及时就医</Text>
      </View>

      {/* 返回 */}
      <View className='grief__back' onClick={() => safeNavigateBack()}>
        <Text className='grief__back-text'>返回</Text>
      </View>
    </View>
  )
}
