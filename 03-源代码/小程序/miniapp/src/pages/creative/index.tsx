import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Image } from '@tarojs/components'
import { usePetStore } from '../../stores/petStore'
import { useAuthStore } from '../../stores/authStore'
import { getTodayCheckin } from '../../services/checkinService'
import type { PetHealthEntry } from '../../services/checkinService'

import './index.scss'

/**
 * 创作 tab 页（2026-09-09 对齐高保真原型 creative-hub-prototype.html 屏1）：
 * 原「家庭」tab 位改为「创作」——宠物主页收敛为创作双入口 + 今日功能保位。
 * - 🎨创作区：形象工坊 / 回忆录馆 两张主题卡承载全部 AIGC 能力
 * - 📋今日区：健康打卡 / AI管家 / 家庭图谱 / 周报 维持原位
 * - 更多区：时光线（原 tab 页收口）+ 疫苗日历
 * 导航栏标题动态为家庭名/宠物名（原型「可乐的家庭」）。
 */

/** 健康评分（与宠物详情页同算法）：poop/spirit 0-5，appetite 0-4 */
function calcHealthScore(poop: number, appetite: number, spirit: number): number {
  const poopScore = Math.max(0, Math.min(5, poop))
  const spiritScore = Math.max(0, Math.min(5, spirit))
  const appetiteScore = Math.max(0, Math.min(4, appetite))
  return Math.round(((poopScore + spiritScore + appetiteScore) / 14) * 100)
}

/** 出生日期 → 中文年龄（岁X月） */
function formatAge(birthDate: string): string {
  if (!birthDate) return ''
  const birth = new Date(birthDate)
  if (Number.isNaN(birth.getTime())) return ''
  const now = new Date()
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  if (now.getDate() < birth.getDate()) months -= 1
  if (months < 0) months = 0
  return `${Math.floor(months / 12)}岁${months % 12}月`
}

const CreativeHub = () => {
  const currentPet = usePetStore((s) => s.currentPet)
  const user = useAuthStore((s) => s.user)
  const [todayCheckin, setTodayCheckin] = useState<PetHealthEntry | null>(null)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const petId = currentPet?.id || ''
  const petName = currentPet?.name || '毛孩子'

  // 导航栏标题：家庭名优先（原型「可乐的家庭」），无家庭回退宠物名
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: `${petName}的家庭` })
  }, [petName])

  // 今日打卡态 + 健康分
  useEffect(() => {
    if (!petId || !user?.id) {
      setTodayCheckin(null)
      return
    }
    let cancelled = false
    getTodayCheckin(petId, user.id).then((r) => {
      if (!cancelled) setTodayCheckin(r)
    }).catch(() => {
      if (!cancelled) setTodayCheckin(null)
    })
    return () => { cancelled = true }
  }, [petId, user?.id])

  const healthScore = todayCheckin ? calcHealthScore(todayCheckin.poopLevel, todayCheckin.appetiteLevel, todayCheckin.spiritLevel) : null

  /** 头像与全局一致：真实照片 > AI 形象 > 物种 emoji */
  const avatarUrl = currentPet?.avatarPhotoUrl || currentPet?.avatarCartoonUrl || ''
  const petEmoji = currentPet?.species === 'cat' ? '🐱' : '🐶'

  /** 路由封装：无宠物时打卡/管家/时光线等需要宠物上下文的入口先校验 */
  const goWithPet = (url: string, requirePet = true) => {
    if (requirePet && !petId) {
      Taro.showToast({ title: '请先添加宠物', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: `${url}${petId ? `?petId=${petId}` : ''}` })
  }

  const goSwitchTab = (url: string) => {
    Taro.switchTab({ url })
  }

  return (
    <View className='cve'>
      {/* ===== 宠物头排：宠物卡 + 健康分卡（原型屏1 顶排） ===== */}
      <View className='cve-petrow'>
        <View className='cve-petcard'>
          <View className='cve-petcard-emoji'>{avatarUrl && !avatarFailed ? '' : petEmoji}</View>
          {avatarUrl && !avatarFailed && (
            <Image
              className='cve-petcard-avatar'
              src={avatarUrl}
              mode='aspectFill'
              lazyLoad
              onError={() => setAvatarFailed(true)}
            />
          )}
          <View className='cve-petcard-info'>
            <Text className='cve-petcard-name'>{petName}</Text>
            <Text className='cve-petcard-sub'>
              {currentPet?.breed || (currentPet?.species === 'cat' ? '猫咪' : '狗狗')}
              {currentPet?.birthDate ? ` · ${formatAge(currentPet.birthDate)}` : ''}
            </Text>
          </View>
        </View>
        <View className='cve-scorecard'>
          <Text className='cve-scorecard-label'>今日健康分</Text>
          <Text className={`cve-scorecard-value${healthScore !== null ? ' cve-scorecard-value--ok' : ''}`}>
            {healthScore !== null ? healthScore : '--'}
          </Text>
          <Text className='cve-scorecard-state'>
            {todayCheckin ? '✓ 已打卡' : '等待打卡'}
          </Text>
        </View>
      </View>

      {/* ===== 🎨 创作 ===== */}
      <View className='cve-sectitle'>🎨 创作</View>
      <View className='cve-grid2'>
        <View
          className='cve-ccard cve-ccard--warm'
          onClick={() => goWithPet('/pagesMemoir/studio/index', false)}
          style={{ borderRadius: 20, background: 'linear-gradient(150deg,#fff1e8,#ffe3ee)', padding: 14 }}
        >
          <Text className='cve-ccard-em'>🎨</Text>
          <Text className='cve-ccard-title'>形象工坊</Text>
          <Text className='cve-ccard-desc'>头像 · 趣味变装 · 全家福{'\n'}一馆搞定</Text>
          <Text className='cve-ccard-price'>免费 1 次变装体验</Text>
        </View>
        <View
          className='cve-ccard cve-ccard--violet'
          onClick={() => goWithPet('/pagesMemoir/memoir-center/index', false)}
          style={{ borderRadius: 20, background: 'linear-gradient(150deg,#f0ecff,#ffe0f0)', padding: 14 }}
        >
          <Text className='cve-ccard-em'>🎬</Text>
          <Text className='cve-ccard-title'>回忆录馆</Text>
          <Text className='cve-ccard-desc'>轻纪念 · 标准 · 完整{'\n'}真实记忆讲成片</Text>
          <Text className='cve-ccard-price'>19.9 起</Text>
        </View>
        <View
          className='cve-ccard cve-ccard--teal'
          onClick={() => goWithPet('/pagesPet/naming/index', false)}
          style={{ borderRadius: 20, background: 'linear-gradient(150deg,#e8f5f2,#dcedf0)', padding: 14 }}
        >
          <Text className='cve-ccard-em'>✨</Text>
          <Text className='cve-ccard-title'>AI 取名</Text>
          <Text className='cve-ccard-desc'>智能推荐 · 寓意解读{'\n'}五行星宿讲成故事</Text>
          <Text className='cve-ccard-price'>免费</Text>
        </View>
      </View>

      {/* ===== 📋 今日 ===== */}
      <View className='cve-sectitle'>📋 今日</View>
      <View className='cve-grid2'>
        <View className='cve-mini' onClick={() => goWithPet('/pagesPet/checkin/index')}>
          <Text className='cve-mini-em'>📷</Text>
          <Text className='cve-mini-title'>健康打卡</Text>
          <Text className='cve-mini-desc'>状态 · 饮食 · 疫苗提醒</Text>
        </View>
        <View className='cve-mini' onClick={() => goSwitchTab('/pages/index/index')}>
          <Text className='cve-mini-em'>🩺</Text>
          <Text className='cve-mini-title'>AI 管家</Text>
          <Text className='cve-mini-desc'>有记忆的养宠助手</Text>
        </View>
        <View className='cve-mini' onClick={() => goWithPet('/pagesPet/family/lineage/index', false)}>
          <Text className='cve-mini-em'>🌳</Text>
          <Text className='cve-mini-title'>家庭图谱</Text>
          <Text className='cve-mini-desc'>血缘 · 关系 · 邀请</Text>
        </View>
        <View className='cve-mini' onClick={() => goWithPet('/pagesPet/weekly-report/index', false)}>
          <Text className='cve-mini-em'>📅</Text>
          <Text className='cve-mini-title'>周报</Text>
          <Text className='cve-mini-desc'>本周健康小结</Text>
        </View>
      </View>

      {/* ===== ✨ 更多（原 tab 页功能收口 / 高频养宠工具） ===== */}
      <View className='cve-sectitle'>✨ 更多</View>
      <View className='cve-grid2'>
        <View className='cve-mini' onClick={() => goWithPet('/pagesPet/vaccine/index')}>
          <Text className='cve-mini-em'>💉</Text>
          <Text className='cve-mini-title'>疫苗日历</Text>
          <Text className='cve-mini-desc'>接种计划 · 提醒</Text>
        </View>
        <View className='cve-mini' onClick={() => goWithPet('/pagesPet/health-report/index')}>
          <Text className='cve-mini-em'>📄</Text>
          <Text className='cve-mini-title'>健康报告</Text>
          <Text className='cve-mini-desc'>体检 · 疫苗 · 检查记录</Text>
        </View>
      </View>
    </View>
  )
}

export default CreativeHub
