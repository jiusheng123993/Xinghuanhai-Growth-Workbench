/**
 * 登录页面
 * 品牌区 + 主视觉 + 功能预览 + 微信/手机号登录 + 协议
 */
import { View, Text, Button, Input, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect, useCallback } from 'react'
// 登录页迁入 pagesUser 分包（主包瘦身）；分包页与主包页同深度，仍用 ../../ 访问 src 根
import { useAuthStore } from '../../stores/authStore'
import { isWeapp, sendSmsCode, isApp, API_BASE_URL } from '../../platform'
// 登录后是否引导绑定微信头像昵称的判断 + 跳过标记 key 构造（纯函数，见 guide.ts 单测；
// 用裸 Taro 存储，utils/storage 带 userId 前缀会与绑定页写入时机错位）
import { shouldGuideWechatBind, bindSkippedKey } from '../bind-wechat/guide'
// 登录主视觉图片随页面一起迁入分包，避免占用主包体积。
// 原为 webp，微信安卓真机对 webp（尤其 VP8X+ALPH 带透明通道）解码兼容性差，
// 真机/体验版不显示（模拟器正常），已统一转 PNG 保证全端稳定显示。
import loginHero from './assets/login-hero.png'
// 品牌 logo：猫狗大头像，2026-09-11 换毛毡质感版（与全站插画质感统一）
import brandLogo from '../../assets/logo-catdog-felt.jpg'
import './index.scss'
import PageBackground from '../../components/PageBackground'

const FEATURES = [
  { icon: '✅', label: '健康打卡' },
  { icon: '💉', label: '疫苗日历' },
  { icon: '🔍', label: '食物查询' },
  { icon: '🕰️', label: '时光记录' },
]

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const wechatLogin = useAuthStore(state => state.login)
  const phoneLogin = useAuthStore(state => state.loginByPhone)
  const isWechatOnly = isWeapp()

  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [loginMode, setLoginMode] = useState<'wechat' | 'phone'>(isWechatOnly ? 'wechat' : 'phone')

  useEffect(() => {
    if (smsCountdown <= 0) return
    const timer = setTimeout(() => setSmsCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [smsCountdown])

  const requireAgree = (): boolean => {
    if (!agreed) {
      setError('请先阅读并同意《用户协议》和《隐私政策》')
      return false
    }
    return true
  }

  const handleWechatLogin = useCallback(async () => {
    if (loading) return
    if (!requireAgree()) return
    setLoading(true)
    setError('')
    try {
      await wechatLogin()
      // 微信已禁止静默获取真实头像昵称，登录后引导用户走官方「头像昵称填写能力」绑定：
      // 资料未完善（无头像或无昵称）且未点过"暂不绑定"时，跳绑定引导页；否则直接进首页。
      const user = useAuthStore.getState().user
      const needBind = shouldGuideWechatBind({
        isWeapp: isWeapp(),
        user,
        // 跳过标记 key 带 userId（与绑定页写入一致，见 guide.bindSkippedKey）
        skipped: Taro.getStorageSync(bindSkippedKey(user?.id)),
      })
      if (needBind) {
        // 用 navigateTo 而非 reLaunch：bind-wechat 与登录页同属 pagesUser 分包，
        // 分包已加载时导航无懒加载竞态（reLaunch 到分包页在 lazyCodeLoading 下偶发
        // "routeDone with a webviewId not found" 路由错误）；保存/跳过均 switchTab 首页清栈
        Taro.navigateTo({ url: '/pagesUser/bind-wechat/index' })
      } else {
        Taro.reLaunch({ url: '/pages/index/index' })
      }
    } catch (err: any) {
      setError(err.message || '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [loading, wechatLogin, agreed])

  const handleSendSms = useCallback(async () => {
    if (smsSending || smsCountdown > 0) return
    if (!/^1\d{10}$/.test(phone)) {
      setError('请输入正确的手机号')
      return
    }
    setSmsSending(true)
    setError('')
    try {
      const result = await sendSmsCode(phone, API_BASE_URL)
      if (result.success) {
        setSmsCountdown(60)
      } else {
        setError(result.message || '发送失败')
      }
    } catch {
      setError('发送验证码失败')
    } finally {
      setSmsSending(false)
    }
  }, [phone, smsSending, smsCountdown])

  const handlePhoneLogin = useCallback(async () => {
    if (loading) return
    if (!requireAgree()) return
    if (!/^1\d{10}$/.test(phone)) {
      setError('请输入正确的手机号')
      return
    }
    if (smsCode.length < 4) {
      setError('请输入验证码')
      return
    }
    setLoading(true)
    setError('')
    try {
      await phoneLogin(phone, smsCode)
      Taro.reLaunch({ url: '/pages/index/index' })
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }, [loading, phone, smsCode, phoneLogin, agreed])

  const switchMode = useCallback(() => {
    setLoginMode(m => (m === 'wechat' ? 'phone' : 'wechat'))
    setError('')
  }, [])

  return (
    <View className='login-page'>
      {/* 全屏动态背景层 */}
      <PageBackground />

      <View className='login-page__content'>
        {/* ===== 品牌区 ===== */}
        <View className='auth-brand'>
          {/* 品牌 logo 图标（暖色版，替代深蓝金原版） */}
          <Image className='auth-brand__badge-img' src={brandLogo} mode='aspectFit' />
          <Text className='auth-brand__logo'>星河宠记</Text>
          <Text className='auth-brand__slogan'>AI 宠物管家，懂 TA 的一生</Text>
        </View>

        {/* ===== 主视觉卡：猫狗插画（Seedream 生成） ===== */}
        <View className='auth-hero'>
          <Image className='auth-hero__img' src={loginHero} mode='widthFix' />
          <Text className='auth-hero__caption'>🐱🐶 猫狗双全，幸福加倍</Text>
        </View>

        {/* ===== 功能预览 ===== */}
        <View className='auth-features'>
          {FEATURES.map(f => (
            <View key={f.label} className='auth-feature'>
              <View className='auth-feature__icon'>
                <Text className='auth-feature__icon-text'>{f.icon}</Text>
              </View>
              <Text className='auth-feature__label'>{f.label}</Text>
            </View>
          ))}
        </View>

        {error && <View className='login-error'>{error}</View>}

        {loginMode === 'wechat' ? (
          <>
            <Button
              className={`auth-btn auth-btn--wechat ${loading ? 'auth-btn--loading' : ''}`}
              onClick={handleWechatLogin}
              loading={loading}
              disabled={loading}
            >
              {loading ? '登录中...' : '微信一键登录'}
            </Button>
            {!isWechatOnly && (
              <View className='auth-btn auth-btn--phone' onClick={switchMode}>
                <Text className='auth-btn--phone__text'>手机号登录</Text>
              </View>
            )}
          </>
        ) : (
          <>
            <View className='login-phone-form'>
              <Input
                className='login-input'
                type='number'
                placeholder='请输入手机号'
                value={phone}
                maxlength={11}
                onInput={(e: any) => setPhone(e.detail.value)}
              />
              <View className='login-sms-row'>
                <Input
                  className='login-input login-sms-input'
                  type='number'
                  placeholder='验证码'
                  value={smsCode}
                  maxlength={6}
                  onInput={(e: any) => setSmsCode(e.detail.value)}
                />
                <View
                  className={`login-sms-btn ${smsCountdown > 0 || smsSending ? 'login-sms-btn--disabled' : ''}`}
                  onClick={handleSendSms}
                >
                  {smsCountdown > 0 ? `${smsCountdown}s` : smsSending ? '发送中' : '获取验证码'}
                </View>
              </View>
            </View>
            <Button
              className={`auth-btn auth-btn--wechat ${loading ? 'auth-btn--loading' : ''}`}
              onClick={handlePhoneLogin}
              disabled={loading}
            >
              {loading ? '登录中...' : '登录'}
            </Button>
            {!isWechatOnly && (
              <View className='auth-btn auth-btn--phone' onClick={switchMode}>
                <Text className='auth-btn--phone__text'>微信登录</Text>
              </View>
            )}
          </>
        )}

        {/* ===== 协议勾选 ===== */}
        <View className='auth-agree'>
          <View
            className={`auth-agree__check${agreed ? ' auth-agree__check--on' : ''}`}
            onClick={() => setAgreed(a => !a)}
          >
            {agreed && <Text className='auth-agree__check-mark'>✓</Text>}
          </View>
          <Text className='auth-agree__text'>我已阅读并同意</Text>
          <Text
            className='auth-agree__link'
            onClick={() => Taro.navigateTo({ url: '/pagesUser/agreement/index?type=user' })}
          >
            《用户协议》
          </Text>
          <Text className='auth-agree__text'>和</Text>
          <Text
            className='auth-agree__link'
            onClick={() => Taro.navigateTo({ url: '/pagesUser/agreement/index?type=privacy' })}
          >
            《隐私政策》
          </Text>
        </View>
      </View>
    </View>
  )
}
