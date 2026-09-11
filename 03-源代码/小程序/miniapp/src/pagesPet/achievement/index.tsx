/**
 * 成就页面
 * 展示宠物的所有成就（生日、打卡里程碑、疫苗完成、彩虹桥等）
 */
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect, useMemo } from 'react'
import { usePetStore } from '../../stores/petStore'
import { useAuthStore } from '../../stores/authStore'
import { getCheckinStats } from '../../services/checkinService'
import AchievementCard, { ACHIEVEMENT_DEFS, type AchievementConfig } from '../../components/AchievementCard'
import { useThemeClass } from '../../hooks/useThemeClass'
import PageLoading from '../../components/PageLoading'
import './index.scss'
import { PageBackground, EmptyState } from '../../components'

interface AchievementRecord {
  achievement: AchievementConfig
  petName: string
  species: 'dog' | 'cat'
  description: string
}

export default function AchievementPage() {
  const { pets, currentPet, fetchPets } = usePetStore()
  const user = useAuthStore(s => s.user)
  const [pageReady, setPageReady] = useState(false)
  const [achievements, setAchievements] = useState<AchievementRecord[]>([])
  const themeClass = useThemeClass()

  useEffect(() => {
    const loadData = async () => {
      if (!user?.id) return
      try {
        await fetchPets(user.id)
        const fetchedPets = usePetStore.getState().pets
        const allAchievements: AchievementRecord[] = []

        for (const pet of fetchedPets) {
          const species = (pet.species === 'cat' ? 'cat' : 'dog') as 'dog' | 'cat'

          // 生日成就
          if (pet.birthDate) {
            const birth = new Date(pet.birthDate)
            const now = new Date()
            const age = now.getFullYear() - birth.getFullYear()
            if (age > 0) {
              allAchievements.push({
                achievement: ACHIEVEMENT_DEFS.birthday,
                petName: pet.name,
                species,
                description: `${pet.name}今年${age}岁了`,
              })
            }
          }

          // 打卡成就
          try {
            const stats = await getCheckinStats(pet.id, user.id)
            if (stats.totalCheckins >= 100) {
              allAchievements.push({
                achievement: ACHIEVEMENT_DEFS.streak_100,
                petName: pet.name,
                species,
                description: `${pet.name}已完成${stats.totalCheckins}次打卡`,
              })
            } else if (stats.totalCheckins >= 30) {
              allAchievements.push({
                achievement: ACHIEVEMENT_DEFS.streak_30,
                petName: pet.name,
                species,
                description: `${pet.name}已完成${stats.totalCheckins}次打卡`,
              })
            } else if (stats.totalCheckins >= 7) {
              allAchievements.push({
                achievement: ACHIEVEMENT_DEFS.streak_7,
                petName: pet.name,
                species,
                description: `${pet.name}已完成${stats.totalCheckins}次打卡`,
              })
            }
          } catch {
            // 打卡数据获取失败，跳过往日成就
          }
        }

        setAchievements(allAchievements)
      } catch {
        // 静默处理
      }
      setPageReady(true)
    }
    loadData()
  }, [user?.id])

  const hasAchievements = achievements.length > 0

  if (!pageReady) {
    return <PageLoading />
  }

  return (
    <ScrollView className={`achievement-page ${themeClass}`} scrollY>
      <PageBackground />
      <View className='achievement-header'>
        <Text className='achievement-header__title'>成就墙</Text>
        <Text className='achievement-header__desc'>
          {hasAchievements
            ? `已解锁 ${achievements.length} 个成就`
            : '坚持打卡，解锁更多成就'}
        </Text>
      </View>

      {hasAchievements ? (
        <View className='achievement-grid'>
          {achievements.map((item, index) => (
            <View key={`${item.achievement.type}-${index}`} className='achievement-grid__item'>
              <View
                className='achievement-mini-card'
                style={{ borderColor: item.achievement.color }}
              >
                <View className='achievement-mini-card__icon'>
                  <Text>{item.achievement.icon}</Text>
                </View>
                <View className='achievement-mini-card__body'>
                  <Text className='achievement-mini-card__title' style={{ color: item.achievement.color }}>
                    {item.achievement.title}
                  </Text>
                  <Text className='achievement-mini-card__subtitle'>{item.achievement.subtitle}</Text>
                  <Text className='achievement-mini-card__pet'>{item.petName}</Text>
                  <Text className='achievement-mini-card__desc'>{item.description}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          illustration='empty-achievement'
          title='还没有成就'
          desc='坚持每天打卡，记录毛孩子的健康数据，就能解锁各种成就'
          actionText='去打卡'
          onAction={() => Taro.switchTab({ url: '/pages/pet-profile/index' })}
        />
      )}
    </ScrollView>
  )
}