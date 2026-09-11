/**
 * 绑定微信头像昵称页（登录后引导）
 *
 * 背景：微信已禁止静默获取真实昵称/头像（getUserProfile 只返回「微信用户」+灰头像），
 * 官方替代是「头像昵称填写能力」，本页即按官方方式实现「直接复用微信资料」：
 * - 头像：button open-type="chooseAvatar"，选择器第一项就是当前微信头像，点一下即用
 * - 昵称：input type="nickname"，键盘上方直接出现微信昵称，点一下即填
 *
 * 触发链路：微信登录成功且资料未完善（无头像或无昵称）时，登录页 reLaunch 到本页；
 * 保存成功后 switchTab 回首页；「暂不绑定」记录跳过标记，下次登录不再打断。
 * 之后仍可随时在「我的 → 个人资料」页修改。
 */
import { View, Text, Button, Input, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { isWeapp } from '../../platform'
import { api } from '../../services/api'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { bindSkippedKey } from './guide'
import './index.scss'
import { Icon } from '../../components'
import PageBackground from '../../components/PageBackground'

export default function BindWechat() {
  const { user, updateProfile } = useAuthStore()
  // 资料草稿：昵称跟随微信（type=nickname 输入框），头像跟随微信（chooseAvatar）
  const [nicknameDraft, setNicknameDraft] = useState('')
  // 本次刚选的微信头像临时文件路径（保存时上传到服务器换取永久 URL）
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  // 是否正在保存（防止连点重复提交）
  const [saving, setSaving] = useState(false)

  // 进入页面时用已登录用户的资料回填昵称草稿（老用户改资料时也能看到原昵称）；
  // 未登录时（深链防御，正常只会从登录流程 reLaunch 进入）直接回首页
  useEffect(() => {
    if (!useAuthStore.getState().user) {
      Taro.reLaunch({ url: '/pages/index/index' })
      return
    }
    setNicknameDraft(user?.nickname || '')
  }, [user?.nickname])

  /**
   * 选择微信头像：微信端走 chooseAvatar（e.detail.avatarUrl 是临时文件路径），
   * 其他端（防御性分支）回退到相册选择
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

  /**
   * 保存绑定：先上传新头像（如有），再更新昵称与头像，成功后回首页
   * 头像必须已选（本页语义就是"绑定微信头像+昵称"），否则保存后资料仍缺头像，
   * 下次登录引导条件再次命中会造成反复打断——与个人资料页的"可选编辑"区分开
   */
  const handleSave = async () => {
    if (saving) return
    const nickname = nicknameDraft.trim()
    if (!nickname) {
      Taro.showToast({ title: '请先填写昵称', icon: 'none' })
      return
    }
    const hasAvatar = !!(avatarDraft || user?.avatar)
    if (!hasAvatar) {
      Taro.showToast({ title: '请先选择微信头像', icon: 'none' })
      return
    }
    setSaving(true)
    try {
      // 未选新头像则沿用已有头像（老用户再次完善资料时）
      let avatarUrl = user?.avatar || ''
      if (avatarDraft && avatarDraft !== user?.avatar) {
        const uploaded = await api.uploadAvatar(avatarDraft)
        avatarUrl = uploaded.url
      }
      await updateProfile(nickname, avatarUrl)
      // 已完成绑定：资料已完善，登录判断自然不再触发引导
      Taro.showToast({ title: '绑定成功', icon: 'success' })
      setTimeout(() => Taro.switchTab({ url: '/pages/index/index' }), 600)
    } catch (err) {
      setSaving(false)
      Taro.showToast({
        title: err instanceof Error ? err.message : '保存失败，请重试',
        icon: 'none',
      })
    }
  }

  /**
   * 暂不绑定：记录跳过标记（下次登录不再打断），直接回首页；
   * 用户之后可随时在「我的 → 个人资料」绑定
   * 注意：用裸 Taro 存储而非 utils/storage（后者带 userId 前缀，登录页读取时机
   * 与绑定页写入时机 _currentUserId 不一致会导致键前缀错位、标记读不到）；
   * key 追加 userId 后缀做账号隔离（同设备多账号互不影响）
   */
  const handleSkip = () => {
    Taro.setStorageSync(bindSkippedKey(user?.id), true)
    Taro.switchTab({ url: '/pages/index/index' })
  }

  return (
    <View className='bind-page'>
      {/* 全屏背景光斑层（与登录页一致的温馨氛围） */}
      <PageBackground />

      <View className='bind-content'>
        {/* ===== 标题区：说明目的 ===== */}
        <View className='bind-header'>
          <Icon name='paw-print' size={36} tone='ink' className='bind-header__emoji' />
          <Text className='bind-header__title'>绑定微信头像昵称</Text>
          <Text className='bind-header__sub'>头像昵称跟随微信，一点就位</Text>
        </View>

        {/* ===== 头像 + 昵称卡片 ===== */}
        <View className='bind-card'>
          <Text className='bind-card__label'>我的头像与昵称</Text>
          <Text className='bind-card__hint'>
            点左侧头像选微信头像（第一项即微信头像），或点下方「从相册选自定义图」；
            昵称可直接输入，也可点键盘上方微信昵称一键填入
          </Text>

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
              {/* 非微信端（防御性分支）：头像按钮走相册选择 */}
              <Button className='bind-avatar-btn' onClick={handleChooseAvatar}>
                {avatarDraft ? (
                  <Image className='bind-avatar-img' src={avatarDraft} mode='aspectFill' />
                ) : user?.avatar ? (
                  <Image className='bind-avatar-img' src={user.avatar} mode='aspectFill' />
                ) : (
                  <View className='bind-avatar-placeholder'>
                    <Icon name='user' size={32} tone='primary' className='bind-avatar-icon' />
                  </View>
                )}
              </Button>
              {/* 非微信端：普通昵称输入 */}
              <Input
                className='bind-nickname-input'
                value={nicknameDraft}
                placeholder='输入昵称'
                onInput={(e) => setNicknameDraft(e.detail.value)}
              />
            </>
          )}
        </View>

        {/* ===== 保存 ===== */}
        <Button
          className='bind-save-btn'
          loading={saving}
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? '保存中...' : '保存并进入 🐾'}
        </Button>

        {/* ===== 跳过 ===== */}
        <View className='bind-skip' onClick={handleSkip}>
          <Text className='bind-skip__text'>暂不绑定，先逛逛</Text>
        </View>
      </View>
    </View>
  )
}
