/**
 * 宠物切换器组件
 * 横向滚动展示所有宠物，支持切换当前宠物和添加新宠物
 * 头像走全站统一口径 resolvePetAvatarUrl（照片 > AI 形象 > 品种品牌头像），
 * 加载失败再退回物种 emoji —— 未设过头像的新宠物也始终显示小动物头像
 */
import { useState, useEffect } from 'react'
import { View, Text, Image, ScrollView } from '@tarojs/components'
import type { PetProfile } from '../services/petService'
import { resolvePetAvatarUrl } from '../data/homeStyleAvatars'
import './PetSwitcher.scss'

interface PetSwitcherProps {
  pets: PetProfile[]
  currentPetId: string | null
  onSwitch: (petId: string) => void
  onAdd?: () => void
}

const getDefaultEmoji = (species: 'dog' | 'cat'): string => {
  return species === 'dog' ? '🐕' : '🐱'
}

export default function PetSwitcher({ pets, currentPetId, onSwitch, onAdd }: PetSwitcherProps) {
  // 头像加载失败记录：key=宠物 id，value=失败时的头像地址。
  // 仅当"当前地址 === 记录的失败地址"才退回 emoji —— 同一坏地址不反复重试，
  // 档案换了新头像地址会自动用新图重试（同「我的」页 chips 的既有口径）
  const [failedAvatars, setFailedAvatars] = useState<Record<string, string>>({})

  // 列表内容变化时清空失败记录，避免切换/新增宠物后残留旧标记
  useEffect(() => {
    setFailedAvatars({})
  }, [pets])

  return (
    <View className='pet-switcher'>
      <ScrollView scrollX className='pet-switcher__scroll'>
        <View className='pet-switcher__list'>
          {pets.map(pet => {
            // 全站统一口径：未设自定义形象 → 按品种匹配的品牌小动物头像（不再只剩 emoji）
            const avatarUrl = resolvePetAvatarUrl(pet)
            const showAvatarImg = !!avatarUrl && failedAvatars[pet.id] !== avatarUrl
            return (
            <View
              key={pet.id}
              className={`pet-switcher__item ${pet.id === currentPetId ? 'pet-switcher__item--active' : ''} ${pet.isDeceased ? 'pet-switcher__item--deceased' : ''}`}
              onClick={() => onSwitch(pet.id)}
            >
              <View className='pet-switcher__avatar'>
                {showAvatarImg ? (
                  <Image
                    src={avatarUrl}
                    className='pet-switcher__avatar-img'
                    mode='aspectFill'
                    lazyLoad
                    onError={() => setFailedAvatars(prev => ({ ...prev, [pet.id]: avatarUrl }))}
                  />
                ) : (
                  <Text className='pet-switcher__avatar-emoji'>{getDefaultEmoji(pet.species)}</Text>
                )}
              </View>
              <Text className='pet-switcher__name'>{pet.name}</Text>
            </View>
            )
          })}
          {onAdd && (
            <View className='pet-switcher__item pet-switcher__item--add' onClick={onAdd}>
              <View className='pet-switcher__avatar pet-switcher__avatar--add'>
                <Text className='pet-switcher__add-icon'>+</Text>
              </View>
              <Text className='pet-switcher__name'>添加</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  )
}
