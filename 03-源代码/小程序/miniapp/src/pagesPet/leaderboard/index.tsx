/**
 * 家庭排行榜页面
 * 展示积分排名和角色分配
 */
import { useEffect, useState, useCallback } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useFamilyStore } from '../../stores/familyStore'
import { leaderboardService } from '../../services/leaderboardService'
import type { LeaderboardPeriod, RankingItem, RoleResponse, RankingMetrics } from '../../services/leaderboardService'
import './index.scss'
import PageBackground from '../../components/PageBackground'

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: 'weekly', label: '本周' },
  { key: 'monthly', label: '本月' },
  { key: 'all_time', label: '总榜' },
]

const PODIUM_MEDALS = ['🥇', '🥈', '🥉']

const ROLE_COLORS: Record<string, string> = {
  mvp: '#FFD700',
  caretaker: '#4CAF50',
  socialite: '#FF8C42',
  health_guardian: '#2196F3',
}

const ROLE_LABELS: Record<string, string> = {
  mvp: '最佳成员',
  caretaker: '贴心管家',
  socialite: '社交达人',
  health_guardian: '健康卫士',
}

const METRIC_ITEMS: { key: keyof RankingMetrics; label: string; weight: number }[] = [
  { key: 'checkin_count', label: '打卡', weight: 3 },
  { key: 'feed_count', label: '喂食', weight: 2 },
  { key: 'moment_count', label: '动态', weight: 2 },
  { key: 'health_score', label: '健康', weight: 3 },
]

export default function Leaderboard() {
  const { currentFamily } = useFamilyStore()
  const [period, setPeriod] = useState<LeaderboardPeriod>('weekly')
  const [rankings, setRankings] = useState<RankingItem[]>([])
  const [roles, setRoles] = useState<RoleResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!currentFamily) return
    setLoading(true)
    try {
      const [lbRes, roleRes] = await Promise.all([
        leaderboardService.getLeaderboard(currentFamily.id, period),
        leaderboardService.getRoles(currentFamily.id),
      ])
      setRankings(lbRes.rankings)
      setRoles(roleRes.roles)
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [currentFamily, period])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleRefresh = useCallback(async () => {
    if (!currentFamily || refreshing) return
    setRefreshing(true)
    try {
      const lbRes = await leaderboardService.refreshLeaderboard(currentFamily.id, period)
      setRankings(lbRes.rankings)
      Taro.showToast({ title: '已刷新', icon: 'success' })
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '刷新失败', icon: 'none' })
    } finally {
      setRefreshing(false)
    }
  }, [currentFamily, period, refreshing])

  const toggleExpand = useCallback((petId: string) => {
    setExpandedId(prev => (prev === petId ? null : petId))
  }, [])

  const podium = rankings.slice(0, 3)
  const restRankings = rankings.slice(3)

  if (!currentFamily) {
    return (
      <View className='leaderboard-container'>
        <PageBackground />
        <View className='lb-empty'>
          <Text className='lb-empty-icon'>🏡</Text>
          <Text className='lb-empty-text'>请先创建家庭</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='leaderboard-container'>
      <View className='lb-header'>
        <Text className='lb-header-title'>家庭排行榜</Text>
        <View
          className={`refresh-btn ${refreshing ? 'refresh-btn--loading' : ''}`}
          onClick={handleRefresh}
        >
          <Text className='refresh-btn-text'>{refreshing ? '⏳' : '🔄'}</Text>
        </View>
      </View>

      <View className='period-tabs'>
        {PERIODS.map(({ key, label }) => (
          <View
            key={key}
            className={`period-tab ${period === key ? 'period-tab--active' : ''}`}
            onClick={() => setPeriod(key)}
          >
            <Text className='period-tab-text'>{label}</Text>
          </View>
        ))}
      </View>

      {podium.length > 0 && (
        <View className='podium'>
          {podium.map((item, idx) => (
            <View key={item.pet_id} className={`podium-item podium-item--${idx + 1}`}>
              <Text className='podium-rank'>{PODIUM_MEDALS[idx]}</Text>
              <View className='podium-avatar'>
                <Text>{item.pet_avatar_url || '🐾'}</Text>
              </View>
              <Text className='podium-name'>{item.pet_name}</Text>
              <Text className='podium-score'>{item.score}分</Text>
            </View>
          ))}
        </View>
      )}

      <ScrollView className='rank-list' scrollY>
        {loading ? (
          <View className='lb-loading'>
            <Text className='lb-loading-text'>加载中...</Text>
          </View>
        ) : restRankings.length === 0 ? (
          <View className='lb-empty-list'>
            <Text className='lb-empty-list-text'>暂无更多排名</Text>
          </View>
        ) : (
          restRankings.map((item) => (
            <View key={item.pet_id}>
              <View className='rank-item' onClick={() => toggleExpand(item.pet_id)}>
                <Text className='rank-number'>{item.rank}</Text>
                <View className='rank-avatar'>
                  <Text>{item.pet_avatar_url || '🐾'}</Text>
                </View>
                <View className='rank-info'>
                  <Text className='rank-name'>{item.pet_name}</Text>
                  {item.badges.length > 0 && (
                    <Text className='rank-badges'>{item.badges.join(' ')}</Text>
                  )}
                </View>
                <Text className='rank-score'>{item.score}分</Text>
              </View>
              {expandedId === item.pet_id && (
                <View className='rank-metrics'>
                  {METRIC_ITEMS.map(({ key, label, weight }) => (
                    <View key={key} className='metric-item'>
                      <Text className='metric-item-label'>{label}</Text>
                      <Text className='metric-item-value'>{item.metrics[key]}</Text>
                      <Text className='metric-item-weight'>×{weight}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {roles.length > 0 && (
        <View className='role-section'>
          <Text className='role-title'>🏆 角色分配</Text>
          <ScrollView className='role-list' scrollX>
            {roles.map((role) => (
              <View
                key={role.id}
                className='role-card'
                style={{ borderColor: ROLE_COLORS[role.role_type as string] || '#D08AA8' }}
              >
                <View
                  className='role-icon'
                  style={{ backgroundColor: ROLE_COLORS[role.role_type as string] || '#D08AA8' }}
                >
                  <Text>{role.pet_avatar_url || '🐾'}</Text>
                </View>
                <Text className='role-label'>{ROLE_LABELS[role.role_type as string] || role.role_label}</Text>
                <Text className='role-pet-name'>{role.pet_name}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  )
}