/**
 * 设置页面
 * 应用设置、通知管理、主题切换、账号管理
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { View, Text, Switch, Button, Input, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore, type NotificationSettings } from '../../stores/settingsStore'
import { type ThemeKey } from '../../stores/themeStore'
import { useMembership } from '../../hooks/useMembership'
import { useAnalytics } from '../../hooks/useAnalytics'
import { bindPhone } from '../../services/authService'
import { APP_VERSION } from '../../constants'
import {
  exportAllUserData,
  deleteUserData,
  generateDeletionConfirmCode,
  getDataPrivacyStatus,
  requestAccountDeletion,
  cancelAccountDeletion,
} from '../../services/dataPrivacyService'
import type { AccountDeletionReason, DataPrivacyStatus, AccountDeletionResult } from '../../types/dataPrivacyTypes'
import { AccountDeletionConfirm } from '../../components/AccountDeletionConfirm'
import { useThemeClass } from '../../hooks/useThemeClass'
import BackgroundPicker from '../../components/BackgroundPicker'
// 【2026-09-12 IA 第 2a 批】「个人资料」页并入本页后新增的依赖：
// Icon = 非微信端的头像占位图标；api.uploadAvatar = 上传新头像换永久 URL；
// isWeapp = 判定是否走微信原生资料组件；chooseImageWithPrivacy = 相册选图（含隐私授权处理）
import { Icon } from '../../components'
import { api } from '../../services/api'
import { isWeapp } from '../../platform'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import './index.scss'

/** Taro 手机号授权 API 类型扩展（微信 Button open-type=getPhoneNumber 对应运行时能力） */
interface TaroWithPhoneNumber {
  getPhoneNumber: (options: {
    success?: (res: unknown) => void
    fail?: (res: unknown) => void
    complete?: () => void
  }) => void
}

export default function SettingsPage() {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  // 资料编辑所需：登录态门槛 + 保存资料的动作（原 profile 页同款取用方式）
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const updateProfile = useAuthStore(s => s.updateProfile)
  const isMember = useMembership().isMember
  const notification = useSettingsStore(s => s.notification)
  const loadSettings = useSettingsStore(s => s.loadSettings)
  const updateNotification = useSettingsStore(s => s.updateNotification)
  const clearCache = useSettingsStore(s => s.clearCache)
  const exportData = useSettingsStore(s => s.exportData)
  const { trackPageView, trackEvent } = useAnalytics()
  const themeClass = useThemeClass()

  const [privacyStatus, setPrivacyStatus] = useState<DataPrivacyStatus | null>(null)
  const [showDeletionModal, setShowDeletionModal] = useState(false)
  const [deletionConfirmCode, setDeletionConfirmCode] = useState('')
  const [deletionLoading, setDeletionLoading] = useState(false)
  const [exportingData, setExportingData] = useState(false)
  const [phoneBound, setPhoneBound] = useState<string | null>(null)
  const [bindingPhone, setBindingPhone] = useState(false)

  // ===== 个人资料编辑草稿（2026-09-12 IA 第 2a 批：原 pagesUser 分包的 profile 页并入本页）=====
  // 昵称草稿：初始跟随现有资料；微信端可在原生输入框里直接填微信昵称
  const [nicknameDraft, setNicknameDraft] = useState('')
  // 本次刚选的头像临时文件路径（保存时上传换永久 URL）；null = 未选新头像，保存时沿用原头像
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  // 是否正在保存（防连点重复提交）
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
    setPrivacyStatus(getDataPrivacyStatus())
  }, [loadSettings])

  // 用户资料变化时同步昵称草稿（原 profile 页同款逻辑）：换账号或后台回填资料后，
  // 输入框不能还留着上一个账号/上一次的旧昵称
  useEffect(() => {
    setNicknameDraft(user?.nickname || '')
  }, [user?.nickname])

  useEffect(() => {
    trackPageView('settings')
  }, [trackPageView])

  const deletionCountdown = useMemo(() => {
    if (!privacyStatus?.accountDeletionRequested || !privacyStatus.accountDeletionScheduledAt) {
      return null
    }
    const scheduled = new Date(privacyStatus.accountDeletionScheduledAt)
    const now = new Date()
    const diffMs = scheduled.getTime() - now.getTime()
    if (diffMs <= 0) return '即将执行'
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    return `${days}天后`
  }, [privacyStatus?.accountDeletionRequested, privacyStatus?.accountDeletionScheduledAt])

  const handleToggleNotification = useCallback((key: keyof NotificationSettings, value: boolean) => {
    trackEvent('toggle_notification', { key, value })
    updateNotification(key, value)
  }, [updateNotification, trackEvent])

  const handleClearCache = useCallback(() => {
    Taro.showModal({
      title: '清除缓存',
      content: '确认清除所有本地缓存数据？',
      success: (res) => {
        if (res.confirm) {
          trackEvent('clear_cache')
          clearCache()
          Taro.showToast({ title: '缓存已清除', icon: 'success' })
        }
      },
    })
  }, [clearCache, trackEvent])

  const handleExportData = useCallback(async () => {
    if (!isMember) {
      Taro.showToast({ title: '会员专属功能', icon: 'none' })
      return
    }
    try {
      const data = exportData()
      await Taro.setClipboardData({ data })
      trackEvent('export_data')
      Taro.showToast({ title: '数据已复制到剪贴板', icon: 'success' })
    } catch {
      Taro.showToast({ title: '导出失败', icon: 'none' })
    }
  }, [isMember, exportData, trackEvent])

  const handleExportAllData = useCallback(async () => {
    if (!user?.id) return
    if (exportingData) return

    Taro.showModal({
      title: '导出全部数据',
      content: '将导出您在星河宠记的所有个人数据（云端+本地），生成JSON文件。是否继续？',
      success: async (res) => {
        if (!res.confirm) return
        setExportingData(true)
        try {
          const result = await exportAllUserData(user.id)
          if (result.success && result.data) {
            await Taro.setClipboardData({ data: result.data })
            trackEvent('export_all_data')
            Taro.showToast({ title: `已导出${result.totalRecords}条记录`, icon: 'success' })
            setPrivacyStatus(getDataPrivacyStatus())
          } else {
            Taro.showToast({ title: result.error || '导出失败', icon: 'none' })
          }
        } catch {
          Taro.showToast({ title: '导出失败', icon: 'none' })
        } finally {
          setExportingData(false)
        }
      },
    })
  }, [user?.id, exportingData, trackEvent])

  const handleDeleteCloudData = useCallback(() => {
    if (!user?.id) return

    Taro.showModal({
      title: '删除云端数据',
      content: '此操作将永久删除您在云端的全部数据，且无法恢复！本地数据不受影响。确定要继续吗？',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const result = await deleteUserData(user.id)
          if (result.success) {
            trackEvent('delete_cloud_data')
            Taro.showToast({ title: `已删除${result.deletedTables.length}类数据`, icon: 'success' })
            setPrivacyStatus(getDataPrivacyStatus())
          } else {
            Taro.showToast({ title: result.error || '删除失败', icon: 'none' })
          }
        } catch {
          Taro.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  }, [user?.id, trackEvent])

  const handleRequestDeletion = useCallback(() => {
    trackEvent('request_account_deletion')
    const code = generateDeletionConfirmCode()
    setDeletionConfirmCode(code)
    setShowDeletionModal(true)
  }, [trackEvent])

  const handleDeletionConfirm = useCallback(async (reason: AccountDeletionReason, customReason: string, code: string) => {
    if (!user?.id) return
    setDeletionLoading(true)
    try {
      const result: AccountDeletionResult = await requestAccountDeletion(user.id, { reason, customReason, confirmCode: code })
      if (result.success) {
        trackEvent('confirm_account_deletion', { reason })
        setShowDeletionModal(false)
        Taro.showToast({
          title: `注销申请已提交，${result.gracePeriodDays}天冷静期`,
          icon: 'none',
          duration: 3000,
        })
        setPrivacyStatus(getDataPrivacyStatus())
      } else {
        Taro.showToast({ title: result.error || '注销失败', icon: 'none' })
      }
    } catch {
      Taro.showToast({ title: '注销请求失败', icon: 'none' })
    } finally {
      setDeletionLoading(false)
    }
  }, [user?.id, trackEvent])

  const handleDeletionCancel = useCallback(() => {
    setShowDeletionModal(false)
  }, [])

  const handleCancelDeletion = useCallback(async () => {
    if (!user?.id) return
    Taro.showModal({
      title: '取消注销',
      content: '确认取消账号注销申请？取消后您的账号将恢复正常使用。',
      success: async (res) => {
        if (!res.confirm) return
        const success = await cancelAccountDeletion(user.id)
        if (success) {
          Taro.showToast({ title: '已取消注销', icon: 'success' })
          setPrivacyStatus(getDataPrivacyStatus())
        } else {
          Taro.showToast({ title: '取消失败，请稍后重试', icon: 'none' })
        }
      },
    })
  }, [user?.id])

  const handleAgreement = useCallback((type: 'user' | 'privacy') => {
    Taro.navigateTo({ url: `/pagesUser/agreement/index?type=${type}` })
  }, [])

  const handleMemoryCorrection = useCallback(() => {
    trackEvent('open_memory_correction')
    Taro.navigateTo({ url: '/pagesUser/memory/index' })
  }, [trackEvent])

  /**
   * 切换页面背景后的埋点与轻提示
   * 注意：setTheme 由 BackgroundPicker 内部完成，这里只负责埋点与用户反馈，
   * 不在外层重复切换，避免同一次操作触发两遍主题变更
   */
  const handleBackgroundChange = useCallback((theme: ThemeKey) => {
    trackEvent('change_theme', { theme })
    Taro.showToast({ title: '背景已切换', icon: 'success', duration: 1000 })
  }, [trackEvent])

  /** 微信手机号绑定 */
  const handleBindPhone = useCallback(() => {
    if (bindingPhone) return
    setBindingPhone(true)
    ;(Taro as unknown as TaroWithPhoneNumber).getPhoneNumber({
      success: async (res) => {
        const { code } = res as { code: string; errMsg: string }
        if (!code) {
          Taro.showToast({ title: '未获取到授权码', icon: 'none' })
          return
        }
        try {
          const result = await bindPhone(code)
          if (result.success && result.phone) {
            setPhoneBound(result.phone)
            trackEvent('bind_phone_success')
            Taro.showToast({ title: '绑定成功', icon: 'success' })
          } else {
            Taro.showToast({ title: '绑定失败，请重试', icon: 'none' })
          }
        } catch {
          Taro.showToast({ title: '绑定失败，请重试', icon: 'none' })
        }
      },
      fail: (err) => {
        if ((err as { errMsg?: string }).errMsg?.includes('cancel')) {
          // 用户取消，静默处理
        } else {
          Taro.showToast({ title: '获取手机号失败', icon: 'none' })
        }
      },
      complete: () => {
        setBindingPhone(false)
      },
    })
  }, [bindingPhone, trackEvent])

  // ===== 个人资料编辑（头像 + 昵称）=====
  // 为什么原样搬 profile 页的实现：微信已禁止静默获取昵称/头像，唯一官方路径是原生组件
  // （button open-type=chooseAvatar + input type=nickname）；逻辑里有"临时路径必须先上传换
  // 永久 URL""未选新头像不重复上传"等细节，重写容易漏，故保持与 profile 页一致。
  /**
   * 选择头像：微信端走原生 chooseAvatar（e.detail.avatarUrl 是临时文件路径）；
   * avatarUrl 为空串（用户点了"从相册选自定义图"）或非微信端时，回退到相册选图
   * @param e 原生组件 chooseavatar 事件，detail = { avatarUrl }
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
      // 用户取消选图属正常操作，静默处理（与 profile 页一致，不弹错误提示）
      .catch(() => {})
  }

  /**
   * 原生组件昵称变更回调（wechat-profile 组件 triggerEvent 传回）
   * @param e { detail: { value: string } }；非字符串（异常事件）直接忽略，避免写入脏草稿
   */
  const handleNicknameChange = (e?: any) => {
    const value = e?.detail?.value
    if (typeof value === 'string') setNicknameDraft(value)
  }

  /**
   * 保存资料：先把新头像上传换永久 URL（如有），再一次性更新昵称与头像
   * 无返回值；未登录或正在保存时直接返回（幂等保护），失败只 toast 不抛错
   */
  const handleSaveProfile = async () => {
    if (saving || !isAuthenticated) return
    setSaving(true)
    try {
      // 未选新头像就沿用旧头像：避免每次保存都把同一张图重复上传一遍
      let avatarUrl = user?.avatar || ''
      if (avatarDraft && avatarDraft !== user?.avatar) {
        const uploaded = await api.uploadAvatar(avatarDraft)
        avatarUrl = uploaded.url
      }
      // 昵称为空时兜底用原昵称，避免把用户名字清成空串
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

  /**
   * 健康报告：跳转到正式的健康报告入口（趋势页，与「我的」页「健康报告」同一条路由）
   *
   * 【为什么这么改】原 profile 页的「健康报告」是在本地生成文本后用 Taro.showModal 弹
   * 一段"截断到 500 字 + 完整报告请查看控制台"的字符串，属全站第三套报告实现，用户读不到完整内容。
   * IA 第 2a 批合并时清掉该实现，改为跳转既有正式入口；埋点事件名保持不变以延续历史口径。
   */
  const handleHealthReport = useCallback(() => {
    trackEvent('click_health_report')
    Taro.navigateTo({ url: '/pagesPet/trends/index' })
  }, [trackEvent])

  const handleLogout = useCallback(() => {
    Taro.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmColor: '#FF6B35',
      success: async (res) => {
        if (res.confirm) {
          trackEvent('logout')
          await logout()
          Taro.reLaunch({ url: '/pagesUser/login/index' })
        }
      },
    })
  }, [logout, trackEvent])

  return (
    <View className={'settings-page ' + themeClass}>
      {/* ===== 个人资料（2026-09-12 IA 第 2a 批：原 pagesUser 分包的 profile 页并入本页）=====
          「我的」页点头像、点「编辑」现在都落到本页，故区块放在最顶部，进来就能改；
          未登录时不渲染（与 profile 页一致：没登录谈不上改资料，登录入口在「我的」页）。 */}
      {isAuthenticated && (
        <View className='settings-page__section'>
          <Text className='settings-page__section-title'>个人资料</Text>
          {/* 微信端用原生组件（chooseAvatar + nickname）：Taro 3.6 编译层不支持这两个属性，
              必须原生组件才能跟随微信头像/昵称（否则 errno 112 / 属性被模板丢弃） */}
          {isWeapp() ? (
            <wechat-profile
              nickname={nicknameDraft}
              avatar={avatarDraft || user?.avatar || ''}
              onChooseavatar={handleChooseAvatar}
              onNickchange={handleNicknameChange}
            />
          ) : (
            <View className='settings-page__profile-row'>
              {/* 非微信端（H5 预览）防御性分支：头像按钮走相册选择 */}
              <Button className='settings-page__profile-avatar-btn' onClick={handleChooseAvatar}>
                {avatarDraft ? (
                  <Image className='settings-page__profile-avatar-img' src={avatarDraft} mode='aspectFill' />
                ) : user?.avatar ? (
                  <Image className='settings-page__profile-avatar-img' src={user.avatar} mode='aspectFill' />
                ) : (
                  <View className='settings-page__profile-avatar-placeholder'>
                    <Icon name='user' size={28} tone='primary' />
                  </View>
                )}
              </Button>
              <Input
                className='settings-page__profile-nickname-input'
                value={nicknameDraft}
                placeholder='输入昵称'
                onInput={(e) => setNicknameDraft(e.detail.value)}
              />
            </View>
          )}
          <Text className='settings-page__profile-tip'>头像昵称可跟随微信，也可自定义；保存后全局同步展示</Text>
          <Button
            className='settings-page__save-btn'
            loading={saving}
            disabled={saving}
            onClick={handleSaveProfile}
          >
            保存
          </Button>
        </View>
      )}

      <View className='settings-page__section'>
        <Text className='settings-page__section-title'>账号管理</Text>
        <View className='settings-page__item'>
          <Text className='settings-page__item-label'>微信绑定</Text>
          <Text className='settings-page__item-value settings-page__item-value--bound'>已绑定</Text>
        </View>
        <View className='settings-page__item' onClick={handleBindPhone}>
          <Text className='settings-page__item-label'>手机号绑定</Text>
          <Text className='settings-page__item-value'>
            {bindingPhone ? '绑定中...' : phoneBound ? `已绑定 (尾号${phoneBound})` : '未绑定'}
          </Text>
        </View>
      </View>

      <View className='settings-page__section'>
        <Text className='settings-page__section-title'>通知设置</Text>
        <View className='settings-page__item'>
          <Text className='settings-page__item-label'>打卡提醒</Text>
          <Switch checked={notification.checkinReminder} onChange={(e) => handleToggleNotification('checkinReminder', e.detail.value)} color='#4A90D9' />
        </View>
        <View className='settings-page__item'>
          <Text className='settings-page__item-label'>疫苗驱虫提醒</Text>
          <Switch checked={notification.vaccineReminder} onChange={(e) => handleToggleNotification('vaccineReminder', e.detail.value)} color='#4A90D9' />
        </View>
        <View className='settings-page__item'>
          <Text className='settings-page__item-label'>健康异常提醒</Text>
          <Switch checked={notification.healthAlert} onChange={(e) => handleToggleNotification('healthAlert', e.detail.value)} color='#4A90D9' />
        </View>
      </View>

      <View className='settings-page__section'>
        <Text className='settings-page__section-title'>页面背景</Text>
        {/* 预设背景（含星空银河/奶油格纹）+ 宠物照片壁纸；切换与持久化均在组件内部完成 */}
        <BackgroundPicker onChange={handleBackgroundChange} />
      </View>

      {/* ===== 数据服务（2026-09-12 IA 第 2a 批：接管 profile 页的「健康报告」入口）=====
          这里只放"跳出去看"的正式入口，不放报告实现；与「我的」页「健康报告」指向同一条路由。 */}
      <View className='settings-page__section'>
        <Text className='settings-page__section-title'>数据服务</Text>
        <View className='settings-page__item' onClick={handleHealthReport}>
          <Text className='settings-page__item-label'>健康报告</Text>
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
      </View>

      <View className='settings-page__section'>
        <Text className='settings-page__section-title'>数据管理</Text>
        <View className='settings-page__item' onClick={handleClearCache}>
          <Text className='settings-page__item-label'>清除缓存</Text>
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
        <View className='settings-page__item' onClick={handleExportData}>
          <Text className='settings-page__item-label'>快速导出</Text>
          {!isMember && <Text className='settings-page__item-badge'>会员</Text>}
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
        <View className='settings-page__item' onClick={handleExportAllData}>
          <Text className='settings-page__item-label'>导出全部数据</Text>
          {exportingData && <Text className='settings-page__item-loading'>导出中...</Text>}
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
        <View className='settings-page__item' onClick={handleMemoryCorrection}>
          <Text className='settings-page__item-label'>AI 记忆纠错</Text>
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
        <View className='settings-page__item' onClick={handleDeleteCloudData}>
          <Text className='settings-page__item-label settings-page__item-label--danger'>删除云端数据</Text>
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
      </View>

      {privacyStatus?.accountDeletionRequested && deletionCountdown && (
        <View className='settings-page__deletion-notice'>
          <Text className='deletion-notice__title'>账号注销中</Text>
          <Text className='deletion-notice__desc'>
            您的账号将于{deletionCountdown}被永久注销删除。冷静期内可取消。
          </Text>
          <View className='deletion-notice__action' onClick={handleCancelDeletion}>
            <Text className='deletion-notice__cancel'>取消注销</Text>
          </View>
        </View>
      )}

      <View className='settings-page__section'>
        <Text className='settings-page__section-title'>账号安全</Text>
        <View className='settings-page__item' onClick={handleRequestDeletion}>
          <Text className='settings-page__item-label settings-page__item-label--danger'>注销账号</Text>
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
      </View>

      <View className='settings-page__section'>
        <Text className='settings-page__section-title'>关于</Text>
        <View className='settings-page__item' onClick={() => handleAgreement('user')}>
          <Text className='settings-page__item-label'>用户协议</Text>
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
        <View className='settings-page__item' onClick={() => handleAgreement('privacy')}>
          <Text className='settings-page__item-label'>隐私政策</Text>
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
        <View className='settings-page__item' onClick={() => Taro.navigateTo({ url: '/pagesUser/feedback/index' })}>
          <Text className='settings-page__item-label'>意见反馈</Text>
          <Text className='settings-page__item-arrow'>›</Text>
        </View>
        <View className='settings-page__item'>
          <Text className='settings-page__item-label'>当前版本</Text>
          <Text className='settings-page__item-value'>{APP_VERSION}</Text>
        </View>
      </View>

      <View className='settings-page__logout' onClick={handleLogout}>
        <Text className='settings-page__logout-text'>退出登录</Text>
      </View>

      {showDeletionModal && (
        <View className='settings-page__modal'>
          <View className='settings-page__modal-content'>
            <AccountDeletionConfirm
              confirmCode={deletionConfirmCode}
              onConfirm={handleDeletionConfirm}
              onCancel={handleDeletionCancel}
              loading={deletionLoading}
            />
          </View>
        </View>
      )}
    </View>
  )
}
