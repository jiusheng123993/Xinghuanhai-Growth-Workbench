/**
 * 用户资料页面
 * 用户个人信息展示与编辑
 */
import { View, Text, Image, Button, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useUserStats } from '../../hooks/useUserStats';
import { useSubscribeStore } from '../../stores/subscribeStore';
import { usePetStore } from '../../stores/petStore';
import { generateHealthReport, formatReportAsText } from '../../services/reportService';
import { APP_VERSION, HOTLINE_NUMBER } from '../../constants';
import { useAnalytics, usePageView } from '../../hooks/useAnalytics';
import { PageBackground, PageLoading, PageError, Icon  } from '../../components';
import { useThemeClass } from '../../hooks/useThemeClass';
import { isWeapp } from '../../platform';
import { api } from '../../services/api';
import { chooseImageWithPrivacy } from '../../utils/privacy';
import './index.scss';

export default function Profile() {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const { user, isAuthenticated, logout, updateProfile } = useAuthStore();
  // 资料编辑草稿：昵称跟随微信（type=nickname 输入框），头像跟随微信（chooseAvatar）
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const stats = useUserStats();
  const fetchStatuses = useSubscribeStore((s) => s.fetchStatuses)
  const hasAnyAccepted = useSubscribeStore((s) => s.hasAnyAccepted)
  const requestAll = useSubscribeStore((s) => s.requestAll)
  const currentPet = usePetStore((s) => s.currentPet)
  const { trackEvent } = useAnalytics()
  usePageView('profile')
  const themeClass = useThemeClass()

  const loadProfileData = useCallback(async () => {
    setError('')
    setIsLoading(true)
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      fetchStatuses()
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProfileData()
  }, [loadProfileData])

  // 用户资料变化时同步昵称草稿
  useEffect(() => {
    setNicknameDraft(user?.nickname || '')
  }, [user?.nickname])

  /** 未登录时点击头像跳转登录页 */
  const handleAvatarClick = () => {
    if (!isAuthenticated) {
      Taro.navigateTo({ url: '/pagesUser/login/index' });
    }
  };

  /**
   * 选择微信头像：微信端走 chooseAvatar（返回临时文件路径），
   * 其他端回退到相册/相机选择
   */
  const handleChooseAvatar = (e?: any) => {
    const temp = e?.detail?.avatarUrl
    if (temp) {
      setAvatarDraft(temp)
      return
    }
    chooseImageWithPrivacy({ count: 1, sizeType: ['compressed'] })
      .then((res) => {
        if (res.tempFilePaths.length) setAvatarDraft(res.tempFilePaths[0])
      })
      .catch(() => {})
  }

  /**
   * 原生组件昵称变更回调（wechat-profile 组件 triggerEvent 传回）
   * @param e - { detail: { value: string } }
   */
  const handleNicknameChange = (e?: any) => {
    const value = e?.detail?.value
    if (typeof value === 'string') setNicknameDraft(value)
  }

  /** 保存资料：先上传新头像（如有），再更新昵称与头像 */
  const handleSaveProfile = async () => {
    if (saving || !isAuthenticated) return
    setSaving(true)
    try {
      let avatarUrl = user?.avatar || ''
      if (avatarDraft && avatarDraft !== user?.avatar) {
        const uploaded = await api.uploadAvatar(avatarDraft)
        avatarUrl = uploaded.url
      }
      await updateProfile(nicknameDraft.trim() || user?.nickname || '', avatarUrl)
      setAvatarDraft(null)
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : '保存失败，请重试',
        icon: 'none',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleHealthReport = async () => {
    trackEvent('click_health_report')
    if (!user?.id || !currentPet?.id) {
      Taro.showToast({ title: '请先添加宠物', icon: 'none' })
      return
    }
    Taro.showLoading({ title: '生成报告中...' })
    try {
      const report = await generateHealthReport(user.id, currentPet.id, 30)
      Taro.hideLoading()
      if (!report) {
        Taro.showToast({ title: '暂无数据', icon: 'none' })
        return
      }
      const text = formatReportAsText(report)
      Taro.showModal({
        title: '健康报告',
        content: text.slice(0, 500) + '\n\n...（完整报告请查看控制台）',
        showCancel: true,
        cancelText: '关闭',
        confirmText: '复制文本',
        success: (res) => {
          if (res.confirm) {
            Taro.setClipboardData({
              data: text,
              success: () => Taro.showToast({ title: '已复制', icon: 'success' }),
            })
          }
        },
      })
    } catch (err) {
      Taro.hideLoading()
      Taro.showToast({ title: '生成失败', icon: 'none' })
    }
  }

  const handleSubscribeClick = () => {
    trackEvent('click_subscribe_manage')
    if (hasAnyAccepted()) {
      Taro.showModal({
        title: '消息订阅管理',
        content: '已开启消息提醒。如需关闭，请在微信「设置-订阅消息」中管理',
        showCancel: true,
        cancelText: '重新订阅',
        confirmText: '知道了',
        success: (res) => {
          if (res.cancel) {
            requestAll()
          }
        },
      })
    } else {
      Taro.showModal({
        title: '开启消息提醒',
        content: '开启后可以接收每日打卡提醒、疫苗到期提醒和健康异常通知',
        confirmText: '开启',
        cancelText: '暂不',
        success: (res) => {
          if (res.confirm) {
            requestAll()
          }
        },
      })
    }
  }

  const handleSettingsClick = () => {
    Taro.navigateTo({ url: '/pagesUser/settings/index' });
  };

  const handleAboutClick = () => {
    Taro.showModal({
      title: '关于星河宠记',
      content: `版本：${APP_VERSION}\n\n星河宠记 — AI宠物管家，以memory-body引擎为核心，帮助宠物主人科学管理宠物健康。\n\n宠物急救热线：${HOTLINE_NUMBER}`,
      showCancel: true,
      cancelText: '拨打热线',
      confirmText: '知道了',
      success: (res) => {
        if (res.cancel) {
          Taro.makePhoneCall({ phoneNumber: HOTLINE_NUMBER });
        }
      },
    });
  };

  const handleLogout = async () => {
    trackEvent('logout')
    const result = await Taro.showModal({
      title: '确认登出',
      content: '登出后需要重新登录才能使用完整功能',
      confirmText: '确认登出',
      cancelText: '取消',
    });

    if (result.confirm) {
      try {
        await logout();
        Taro.showToast({ title: '已登出', icon: 'success' });
      } catch {
        Taro.showToast({ title: '登出失败，请重试', icon: 'none' });
      }
    }
  };

  if (isLoading) {
    return (
      <View className={'profile-page ' + themeClass}>
        <PageBackground />
        <PageLoading />
      </View>
    )
  }

  if (error) {
    return (
      <View className={'profile-page ' + themeClass}>
        <PageError message={error} onRetry={loadProfileData} />
      </View>
    )
  }

  return (
    <View className={'profile-page ' + themeClass}>
      <View className='ink-bg-decoration ink-bg-1' />
      <View className='ink-bg-decoration ink-bg-2' />

      <View className='profile-header ink-item' style={{ animationDelay: '0.1s' }}>
        <View className='avatar-section' onClick={handleAvatarClick}>
          {user?.avatar ? (
            <Image className='avatar' src={user.avatar} mode='aspectFill' lazyLoad />
          ) : (
            <View className='avatar-placeholder'>
              <Icon name='user' size={32} tone='primary' className='avatar-icon' />
            </View>
          )}
          <View className='user-info'>
            {isAuthenticated && user?.nickname ? (
              <Text className='nickname'>{user.nickname}</Text>
            ) : (
              <Text className='login-hint'>点击登录</Text>
            )}
          </View>
        </View>
      </View>

      {isAuthenticated && (
        <View className='profile-edit-card ink-item' style={{ animationDelay: '0.2s' }}>
          <View className='profile-edit-title'>头像与昵称（可跟随微信，也可自定义）</View>
          <View className='profile-edit-row'>
            {/* 微信端：用原生组件（chooseAvatar + nickname），Taro 3.6 不支持这两个属性
                必须原生组件才能跟随微信头像/昵称（否则 errno 112 / 属性被模板丢弃） */}
            {isWeapp() ? (
              <wechat-profile
                nickname={nicknameDraft}
                avatar={avatarDraft || user?.avatar || ''}
                onChooseavatar={handleChooseAvatar}
                onNickchange={handleNicknameChange}
              />
            ) : (
              <>
                {/* 非微信端：头像按钮走相册选择 */}
                <Button
                  className='avatar-pick-btn'
                  onClick={handleChooseAvatar}
                >
                  {avatarDraft ? (
                    <Image className='avatar-pick-img' src={avatarDraft} mode='aspectFill' />
                  ) : user?.avatar ? (
                    <Image className='avatar-pick-img' src={user.avatar} mode='aspectFill' />
                  ) : (
                    <View className='avatar-pick-placeholder'>
                      <Icon name='user' size={28} tone='primary' className='avatar-pick-icon' />
                    </View>
                  )}
                </Button>
                {/* 非微信端：普通昵称输入 */}
                <Input
                  className='nickname-input'
                  value={nicknameDraft}
                  placeholder='输入昵称'
                  onInput={(e) => setNicknameDraft(e.detail.value)}
                />
              </>
            )}
          </View>
          <View className='profile-edit-tip'>头像昵称可跟随微信，也可自定义；保存后全局同步展示</View>
          <Button
            className='profile-save-btn'
            loading={saving}
            disabled={saving}
            onClick={handleSaveProfile}
          >
            保存
          </Button>
        </View>
      )}

      <View className='stats-section ink-item' style={{ animationDelay: '0.2s' }}>
        <View className='stats-title'>
          <Text>我的数据</Text>
        </View>
        <View className='stats-grid'>
          <View className='stat-item'>
            <Text className='stat-value'>{stats.usageDays}</Text>
            {/* 标签纠正（2026-09-11）：这个数字来自 `useUserStats.usageDays`，
                算的是**当前宠物、首次打卡至今的时间跨度**（没有打卡记录时为 0），不是 App 使用天数。
                ⚠️ 别当成与别处"同一口径"（审查指出上一版注释写错了）：
                  · 这里 = 单个宠物「首次打卡 → 今天」的跨度（且只读全局 checkinStore，冷启动可能为 0）
                  · 「我的」页「打卡天数」= Σ 各宠物**按天去重**后的天数
                  · 年度回顾「记录天数」= 当年**按天去重**后的天数
                三者可以是三个不同的数，同名不同量。 */}
            <Text className='stat-label'>记录天数</Text>
          </View>
          <View className='stat-item'>
            <Text className='stat-value'>{stats.petCount}</Text>
            <Text className='stat-label'>宠物数量</Text>
          </View>
          <View className='stat-item'>
            <Text className='stat-value'>{stats.checkinCount}</Text>
            <Text className='stat-label'>打卡记录</Text>
          </View>
          <View className='stat-item'>
            <Text className='stat-value'>{stats.vaccineCount}</Text>
            <Text className='stat-label'>疫苗记录</Text>
          </View>
        </View>
      </View>

      <View className='menu-section ink-item' style={{ animationDelay: '0.3s' }}>
        <View className='menu-item' onClick={handleHealthReport}>
          <Icon name='clipboard-text' size={20} tone='primary' className='menu-icon' />
          <Text className='menu-text'>健康报告</Text>
          <Text className='menu-arrow'>›</Text>
        </View>
        <View className='menu-item' onClick={handleSubscribeClick}>
          <Icon name='bell' size={20} tone='primary' className='menu-icon' />
          <Text className='menu-text'>消息提醒</Text>
          <Text className='menu-arrow'>›</Text>
        </View>
        <View className='menu-item' onClick={handleSettingsClick}>
          <Icon name='gear' size={20} tone='primary' className='menu-icon' />
          <Text className='menu-text'>设置</Text>
          <Text className='menu-arrow'>›</Text>
        </View>
        <View className='menu-item' onClick={handleAboutClick}>
          <Text className='menu-icon'>ℹ️</Text>
          <Text className='menu-text'>关于我们</Text>
          <Text className='menu-arrow'>›</Text>
        </View>
      </View>

      {isAuthenticated && (
        <View className='logout-section ink-item' style={{ animationDelay: '0.4s' }}>
          <View className='logout-btn' onClick={handleLogout}>
            <Text className='logout-text'>退出登录</Text>
          </View>
        </View>
      )}

      <View className='profile-footer'>
        <Text className='footer-text'>星河宠记 v{APP_VERSION}</Text>
      </View>

    </View>
  );
}
