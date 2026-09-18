/**
 * 会员中心页面
 * 会员状态卡 + 三档价格卡 + 权益清单 + 常见问题
 */
import { View, Text, ScrollView, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
// 会员中心页迁入 pagesUser 分包（主包瘦身）；分包页与主包页同深度，仍用 ../../ 访问 src 根
import { useThemeClass } from '../../hooks/useThemeClass'
import { useAuthStore } from '../../stores/authStore'
import { useMembershipStore } from '../../stores/membershipStore'
import { api } from '../../services/api'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import PageLoading from '../../components/PageLoading'
import './index.scss'
import { Icon } from '../../components'
import PageBackground from '../../components/PageBackground'

/**
 * 套餐价格展示。⚠️ 必须与服务端 routes/membership.ts 的 getPlanPrice 保持一致：
 * 立项 v0.2 P0-1 后促销价仅年费 88 元（月均 7.3），月卡/季卡恢复常规价 29.9/79.9。
 * 展示价 < 实收价会引发微信支付投诉，展示价 > 实收价属误导——两处永远同步改。
 */
const PLANS = [
  { key: 'monthly', name: '月卡', price: '¥29.9', period: '/月', note: '按月续费', tag: '' },
  { key: 'quarterly', name: '季卡', price: '¥79.9', period: '/季', note: '即将上线', tag: '' },
  { key: 'yearly', name: '年卡', price: '¥88', period: '/年', note: '限时价 · 原价¥269', tag: '推荐' },
]

const BENEFITS = [
  { icon: '✨', title: 'AI 取名', value: '20次/月', color: 'coral' },
  { icon: '✅', title: '回忆录', value: '8折', color: 'gold' },
  { icon: '♾️', title: '健康打卡报告', value: '无限', color: 'green' },
  { icon: '💬', title: '专属客服', value: '在线服务', color: 'blue' },
  { icon: '💕', title: '全家共享', value: '5人', color: 'deep' },
]

const FAQS = [
  {
    q: '如何开通会员？',
    a: '点击上方价格卡或"立即开通"按钮，选择套餐后通过微信支付完成支付，开通后权益立即生效。',
  },
  {
    q: '自动续费如何管理？',
    a: '开通时默认不开启自动续费。可在"我的 - 会员中心 - 续费管理"中随时开启或关闭，扣款前会提前通知。',
  },
  {
    q: '会员可以退款吗？',
    a: '购买后 7 天内未使用任何付费权益可申请全额退款；已使用的会员按剩余有效期比例退回。',
  },
]

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  return dateStr.slice(0, 10)
}

function remainingDays(endDate: string): number {
  if (!endDate) return 0
  const end = new Date(endDate)
  if (Number.isNaN(end.getTime())) return 0
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000))
}

export default function Member() {
  /**
   * 主题类名：**必须挂在页面自己的根节点上**
   *
   * 为什么：小程序端每个页面独立渲染，app 组件的 JSX 不包裹页面节点，挂在 app 层的
   * `.theme-*` 传不进页面；不挂就会永远吃 styles/_theme.scss 里 page{} 的秋季基线变量，
   * 用户切主题后本页仍是一片秋色。口径与 pages/creative、pages/mine 一致。
   */
  const themeClass = useThemeClass()
  const user = useAuthStore(state => state.user)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const isInitialized = useAuthStore(state => state.isInitialized)
  const { membership, fetchMembership, subscribePlan } = useMembershipStore()
  const [pageReady, setPageReady] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState('yearly')
  const [subscribing, setSubscribing] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  // 兑换码（2026-08-23）：输入兑换码兑换会员
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)

  const handleSubscribe = async () => {
    if (subscribing || !user) return
    if (selectedPlan === 'quarterly') {
      Taro.showToast({ title: '季卡即将上线，请选择月卡或年卡', icon: 'none' })
      return
    }
    setSubscribing(true)
    try {
      const result = await subscribePlan(selectedPlan as 'monthly' | 'yearly')
      if (result.success) {
        Taro.showToast({ title: '开通成功', icon: 'success' })
        await fetchMembership(user.id)
      } else {
        Taro.showToast({ title: result.error || '开通失败', icon: 'none' })
      }
    } catch {
      Taro.showToast({ title: '开通失败，请重试', icon: 'none' })
    } finally {
      setSubscribing(false)
    }
  }

  /** 兑换码兑换会员（2026-08-23）：POST /api/redeem → 成功后刷新会员状态 */
  const handleRedeem = async () => {
    const code = redeemCode.trim()
    if (!code) {
      Taro.showToast({ title: '请输入兑换码', icon: 'none' })
      return
    }
    if (redeeming) return
    setRedeeming(true)
    try {
      // 坑点：服务端所有业务路由挂在 /api 前缀下（app.use('/api', redeemRoutes)），
      // 路径必须写 /api/redeem。曾误写 /redeem → 生产 404（nginx 层 HTML 404），
      // 被 catch 吞成"兑换失败，请检查兑换码"，掩盖真实原因
      const res = await api.post<{ message: string }>('/api/redeem', { code })
      Taro.showToast({ title: res?.message || '兑换成功', icon: 'success' })
      setRedeemCode('')
      if (user?.id) await fetchMembership(user.id)
    } catch (err) {
      // 透传服务端错误信息（如"兑换码不存在或已被使用"/"兑换码已被使用"），
      // 便于用户/运营区分原因；网络类错误用通用文案
      const message = err instanceof Error ? err.message : ''
      Taro.showToast({
        title: message && !message.includes('网络异常') ? message : '兑换失败，请检查兑换码',
        icon: 'none',
      })
    } finally {
      setRedeeming(false)
    }
  }

  useEffect(() => {
    if (!isInitialized) return
    if (!isAuthenticated || !user) {
      // 未登录统一走收口守卫（原实现缺少 currentPage 判空：登录页挂载中再次 reLaunch 会触发
      // "routeDone with a webviewId not found" 路由竞态噪音，这里一并收敛）
      redirectToLoginIfNeeded()
      return
    }
    const loadData = async () => {
      try {
        await fetchMembership(user.id)
      } catch {
        // 静默处理错误
      }
      setPageReady(true)
    }
    loadData()
  }, [isInitialized, isAuthenticated, user])

  if (!pageReady) {
    return <PageLoading />
  }

  const isVip = membership?.level !== 'free'
  const vipLevel = isVip && membership?.level
    ? `${membership.level.toUpperCase()}会员`
    : '体验会员'
  const days = remainingDays(membership?.endDate || '')
  const endDateText = membership?.endDate ? formatDate(membership.endDate) : '—'

  return (
    <View className={`member-page ${themeClass}`}>
      {/* 全屏动态背景层 */}
      <PageBackground />

      <ScrollView className='member-page__content' scrollY>
        {/* ===== 会员状态卡 ===== */}
        <View className='member-status'>
          <View className='member-status__head'>
            <View className='member-status__icon'>
              <Icon name='crown' size={20} tone='primary' className='member-status__icon-text' />
            </View>
            <View className='member-status__info'>
              <Text className='member-status__label'>当前状态</Text>
              <Text className='member-status__level'>{vipLevel}</Text>
            </View>
            {isVip && days > 0 ? (
              <View className='member-status__badge'>
                <Icon name='star' size={11} tone='primary' className='member-status__badge-icon' />
                <Text className='member-status__badge-text'>剩余 {days} 天</Text>
              </View>
            ) : (
              <View className='member-status__badge member-status__badge--muted'>
                <Text className='member-status__badge-text'>未开通</Text>
              </View>
            )}
          </View>

          <View className='member-status__grid'>
            <View className='member-status__cell'>
              <Text className='member-status__cell-label'>到期时间</Text>
              <Text className='member-status__cell-value'>{endDateText}</Text>
            </View>
            <View className='member-status__cell'>
              <Text className='member-status__cell-label'>会员状态</Text>
              <Text className='member-status__cell-value'>{isVip ? '已开通' : '未开通'}</Text>
            </View>
          </View>

          <View className='member-status__btn' onClick={handleSubscribe}>
            <Icon name='crown' size={14} tone='primary' className='member-status__btn-icon' />
            <Text className='member-status__btn-text'>{subscribing ? '开通中...' : '立即开通'}</Text>
          </View>
        </View>

        {/* ===== 兑换码（2026-08-23） ===== */}
        <View className='member-redeem'>
          <View className='member-redeem__head'>
            <Text className='member-redeem__title'>🎟️ 兑换码兑换</Text>
            <Text className='member-redeem__hint'>输入兑换码，开通或延长会员</Text>
          </View>
          <View className='member-redeem__row'>
            <Input
              className='member-redeem__input'
              placeholder='如 XHH-XXXX-XXXX-XXXX'
              value={redeemCode}
              onInput={(e) => setRedeemCode(e.detail.value)}
            />
            <View
              className={`member-redeem__btn${redeeming ? ' member-redeem__btn--loading' : ''}`}
              onClick={handleRedeem}
            >
              <Text className='member-redeem__btn-text'>{redeeming ? '兑换中...' : '兑换'}</Text>
            </View>
          </View>
        </View>

        {/* ===== 三档价格卡 ===== */}
        <View className='member-card'>
          <View className='member-card__head'>
            <View className='member-card__title-wrap'>
              <Text className='member-card__icon'>🏅</Text>
              <Text className='member-card__title'>开通会员</Text>
            </View>
            <Text className='member-card__meta'>一次开通 · 全家共享</Text>
          </View>

          <View className='member-plans'>
            {PLANS.map(plan => {
              const selected = selectedPlan === plan.key
              return (
                <View
                  key={plan.key}
                  className={`member-plan${selected ? ' member-plan--selected' : ''}`}
                  onClick={() => setSelectedPlan(plan.key)}
                >
                  {plan.tag && (
                    <View className='member-plan__tag'>
                      <Text className='member-plan__tag-text'>⭐ {plan.tag}</Text>
                    </View>
                  )}
                  <Text className='member-plan__name'>{plan.name}</Text>
                  <View className='member-plan__price-row'>
                    <Text className='member-plan__price'>{plan.price}</Text>
                    <Text className='member-plan__period'>{plan.period}</Text>
                  </View>
                  <Text className='member-plan__note'>{plan.note}</Text>
                </View>
              )
            })}
          </View>

          <View className='member-card__tip'>
            <Text className='member-card__tip-icon'>ℹ️</Text>
            <Text className='member-card__tip-text'>会员到期后自动恢复免费权益，历史打卡数据永久保留。</Text>
          </View>
        </View>

        {/* ===== 权益清单卡 ===== */}
        <View className='member-card'>
          <View className='member-card__head'>
            <View className='member-card__title-wrap'>
              <Text className='member-card__icon'>✨</Text>
              <Text className='member-card__title'>会员权益</Text>
            </View>
          </View>
          <View className='member-benefits'>
            {BENEFITS.map(b => (
              <View key={b.title} className='member-benefit'>
                <View className={`member-benefit__icon member-benefit__icon--${b.color}`}>
                  <Text className='member-benefit__icon-text'>{b.icon}</Text>
                </View>
                <Text className='member-benefit__title'>{b.title}</Text>
                <Text className={`member-benefit__value member-benefit__value--${b.color}`}>{b.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ===== 常见问题卡 ===== */}
        <View className='member-card'>
          <View className='member-card__head'>
            <View className='member-card__title-wrap'>
              <Text className='member-card__icon'>❓</Text>
              <Text className='member-card__title'>常见问题</Text>
            </View>
          </View>
          <View className='member-faqs'>
            {FAQS.map((faq, index) => {
              const open = openFaq === index
              return (
                <View key={index} className='member-faq'>
                  <View
                    className='member-faq__q'
                    onClick={() => setOpenFaq(open ? null : index)}
                  >
                    <Text className='member-faq__q-text'>{faq.q}</Text>
                    <Text className='member-faq__arrow'>{open ? '▲' : '▼'}</Text>
                  </View>
                  {open && (
                    <Text className='member-faq__a'>{faq.a}</Text>
                  )}
                </View>
              )
            })}
          </View>
        </View>

        <View style={{ height: '40rpx' }} />
      </ScrollView>
    </View>
  )
}
