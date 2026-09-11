/**
 * 广告管理页面
 * 配置流量主广告位ID和统计管理
 */
import { View, Text, ScrollView, Input, Switch } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useCallback } from 'react'
import {
  updateAdConfig,
  getCurrentAdConfig,
  resetAdStats,
  getAdStatsInfo,
  type AdConfig,
  type AdStats,
} from '../../services/adService'
import { AD_UNIT_IDS } from '../../constants/adUnitIds'
import { useThemeClass } from '../../hooks/useThemeClass'
import './index.scss'

interface AdUnitField {
  key: keyof typeof AD_UNIT_IDS
  label: string
  category: string
}

const AD_UNIT_FIELDS: AdUnitField[] = [
  { key: 'BANNER_HOME', label: '首页Banner', category: 'Banner广告' },
  { key: 'BANNER_FAMILY', label: '家庭页Banner', category: 'Banner广告' },
  { key: 'BANNER_TIMELINE', label: '时间线Banner', category: 'Banner广告' },
  { key: 'BANNER_MINE', label: '我的Banner', category: 'Banner广告' },
  { key: 'BANNER_HOSPITAL', label: '医院页Banner', category: 'Banner广告' },
  { key: 'BANNER_PRODUCT', label: '商品页Banner', category: 'Banner广告' },
  { key: 'REWARDED_VIDEO_AVATAR', label: '头像生成激励视频', category: '激励视频' },
  { key: 'REWARDED_VIDEO_REPORT', label: '周报激励视频', category: '激励视频' },
  { key: 'REWARDED_VIDEO_ANALYSIS', label: '分析激励视频', category: '激励视频' },
  { key: 'INTERSTITIAL_PAGE_SWITCH', label: '页面切换插屏', category: '插屏广告' },
  { key: 'INTERSTITIAL_HOSPITAL_NAV', label: '医院导航插屏', category: '插屏广告' },
  { key: 'INTERSTITIAL_PRODUCT_CLICK', label: '商品点击插屏', category: '插屏广告' },
]

export default function AdAdminPage() {
  const themeClass = useThemeClass()
  const [adConfig, setAdConfig] = useState<AdConfig>(getCurrentAdConfig)
  const [stats, setStats] = useState<AdStats>(getAdStatsInfo)
  const [editValues, setEditValues] = useState<Record<string, string>>({})

  const handleUnitIdChange = useCallback((key: string, value: string) => {
    setEditValues(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(() => {
    const updates: Partial<AdConfig> = {}
    let hasUpdate = false

    const bannerFields: (keyof typeof AD_UNIT_IDS)[] = [
      'BANNER_HOME', 'BANNER_FAMILY', 'BANNER_TIMELINE',
      'BANNER_MINE', 'BANNER_HOSPITAL', 'BANNER_PRODUCT',
    ]
    const rewardedFields: (keyof typeof AD_UNIT_IDS)[] = [
      'REWARDED_VIDEO_AVATAR', 'REWARDED_VIDEO_REPORT', 'REWARDED_VIDEO_ANALYSIS',
    ]
    const interstitialFields: (keyof typeof AD_UNIT_IDS)[] = [
      'INTERSTITIAL_PAGE_SWITCH', 'INTERSTITIAL_HOSPITAL_NAV', 'INTERSTITIAL_PRODUCT_CLICK',
    ]

    Object.entries(editValues).forEach(([key, value]) => {
      if (!value) return
      hasUpdate = true

      if (bannerFields.includes(key as keyof typeof AD_UNIT_IDS)) {
        updates.bannerAdUnitId = value
      } else if (rewardedFields.includes(key as keyof typeof AD_UNIT_IDS)) {
        updates.rewardedVideoAdUnitId = value
      } else if (interstitialFields.includes(key as keyof typeof AD_UNIT_IDS)) {
        updates.interstitialAdUnitId = value
      }
    })

    if (hasUpdate) {
      updateAdConfig(updates)
      setAdConfig(getCurrentAdConfig())
      Taro.showToast({ title: '保存成功', icon: 'success' })
    } else {
      Taro.showToast({ title: '没有需要保存的修改', icon: 'none' })
    }
  }, [editValues])

  const handleResetStats = useCallback(() => {
    Taro.showModal({
      title: '确认重置',
      content: '确定要重置广告统计数据吗？此操作不可撤销',
      success: (res) => {
        if (res.confirm) {
          resetAdStats()
          setStats(getAdStatsInfo())
          Taro.showToast({ title: '已重置', icon: 'success' })
        }
      },
    })
  }, [])

  const getCurrentAdUnitIdDisplay = useCallback((field: AdUnitField): string => {
    if (editValues[field.key] !== undefined) return editValues[field.key]

    const bannerFields = ['BANNER_HOME', 'BANNER_FAMILY', 'BANNER_TIMELINE', 'BANNER_MINE', 'BANNER_HOSPITAL', 'BANNER_PRODUCT']
    const rewardedFields = ['REWARDED_VIDEO_AVATAR', 'REWARDED_VIDEO_REPORT', 'REWARDED_VIDEO_ANALYSIS']
    const interstitialFields = ['INTERSTITIAL_PAGE_SWITCH', 'INTERSTITIAL_HOSPITAL_NAV', 'INTERSTITIAL_PRODUCT_CLICK']

    if (bannerFields.includes(field.key)) return adConfig.bannerAdUnitId || '未配置'
    if (rewardedFields.includes(field.key)) return adConfig.rewardedVideoAdUnitId || '未配置'
    if (interstitialFields.includes(field.key)) return adConfig.interstitialAdUnitId || '未配置'
    return '未配置'
  }, [adConfig, editValues])

  const categories = [...new Set(AD_UNIT_FIELDS.map(f => f.category))]

  return (
    <ScrollView className={`ad-admin-page ${themeClass}`} scrollY>
      <View className='ad-admin-header'>
        <Text className='ad-admin-title'>广告管理</Text>
        <Text className='ad-admin-subtitle'>配置流量主广告位ID</Text>
      </View>

      <View className='ad-admin-stats'>
        <View className='ad-admin-stat-item'>
          <Text className='ad-admin-stat-value'>{stats.todayImpressions}</Text>
          <Text className='ad-admin-stat-label'>今日展示</Text>
        </View>
        <View className='ad-admin-stat-item'>
          <Text className='ad-admin-stat-value'>{stats.todayClicks}</Text>
          <Text className='ad-admin-stat-label'>今日点击</Text>
        </View>
        <View className='ad-admin-stat-item'>
          <Text className='ad-admin-stat-value'>{stats.totalImpressions}</Text>
          <Text className='ad-admin-stat-label'>累计展示</Text>
        </View>
        <View className='ad-admin-stat-item'>
          <Text className='ad-admin-stat-value'>{stats.totalClicks}</Text>
          <Text className='ad-admin-stat-label'>累计点击</Text>
        </View>
      </View>

      <View className='ad-admin-limits'>
        <View className='ad-admin-limit-row'>
          <Text className='ad-admin-limit-label'>每日最大展示次数</Text>
          <Input
            className='ad-admin-limit-input'
            type='number'
            value={String(adConfig.maxDailyAds)}
            onInput={(e) => {
              const val = parseInt(String(e.detail.value), 10)
              if (!Number.isNaN(val) && val > 0) {
                updateAdConfig({ maxDailyAds: val })
                setAdConfig(getCurrentAdConfig())
              }
            }}
          />
        </View>
        <View className='ad-admin-limit-row'>
          <Text className='ad-admin-limit-label'>最小展示间隔（秒）</Text>
          <Input
            className='ad-admin-limit-input'
            type='number'
            value={String(adConfig.minIntervalSeconds)}
            onInput={(e) => {
              const val = parseInt(String(e.detail.value), 10)
              if (!Number.isNaN(val) && val >= 0) {
                updateAdConfig({ minIntervalSeconds: val })
                setAdConfig(getCurrentAdConfig())
              }
            }}
          />
        </View>
      </View>

      {categories.map(category => (
        <View key={category} className='ad-admin-section'>
          <View className='ad-admin-section-header'>
            <Text className='ad-admin-section-title'>{category}</Text>
          </View>
          {AD_UNIT_FIELDS.filter(f => f.category === category).map(field => (
            <View key={field.key} className='ad-admin-field'>
              <Text className='ad-admin-field-label'>{field.label}</Text>
              <Input
                className='ad-admin-field-input'
                placeholder='请输入广告位ID'
                value={editValues[field.key] ?? getCurrentAdUnitIdDisplay(field)}
                onInput={(e) => handleUnitIdChange(field.key, String(e.detail.value))}
              />
            </View>
          ))}
        </View>
      ))}

      <View className='ad-admin-actions'>
        <View className='ad-admin-btn ad-admin-btn--primary' onClick={handleSave}>
          <Text className='ad-admin-btn-text'>保存配置</Text>
        </View>
        <View className='ad-admin-btn ad-admin-btn--danger' onClick={handleResetStats}>
          <Text className='ad-admin-btn-text'>重置统计数据</Text>
        </View>
      </View>

      <View className='ad-admin-bottom-safe' />
    </ScrollView>
  )
}