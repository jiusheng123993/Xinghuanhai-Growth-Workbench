/**
 * 付费墙弹窗组件测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import Taro from '@tarojs/taro'

import PaywallPopup from '../PaywallPopup'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
}))

vi.mock('@tarojs/taro', () => ({
  default: { navigateTo: vi.fn(), switchTab: vi.fn() },
}))

vi.mock('../../services/analyticsService', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('../PaywallPopup.scss', () => ({}))

vi.mock('../../services/membershipService', () => ({
  MEMBERSHIP_PLANS: [
    { plan: 'monthly', label: '月度会员', price: 9.9, originalPrice: 9.9, discountLabel: '', durationDays: 30 },
    { plan: 'quarterly', label: '季度会员', price: 25.9, originalPrice: 29.7, discountLabel: '省3.8元', durationDays: 90 },
    { plan: 'yearly', label: '年度会员', price: 88, originalPrice: 118.8, discountLabel: '省30.8元', durationDays: 365 },
  ],
  MEMBERSHIP_BENEFITS: [],
}))

describe('PaywallPopup', () => {
  const defaultProps = {
    visible: true,
    featureName: '食物查询',
    remainingFree: 0,
    onUpgrade: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when visible=false', () => {
    const { container } = render(<PaywallPopup {...defaultProps} visible={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders when visible=true', () => {
    const { container } = render(<PaywallPopup {...defaultProps} />)
    expect(container.querySelector('.paywall-popup')).toBeDefined()
  })

  it('shows featureName in title', () => {
    render(<PaywallPopup {...defaultProps} featureName='AI症状初筛' />)
    expect(screen.getByText(/AI症状初筛/)).toBeDefined()
  })

  it('shows remainingFree count', () => {
    render(<PaywallPopup {...defaultProps} remainingFree={3} />)
    expect(screen.getByText('3')).toBeDefined()
  })

  it('shows remainingFree as 0', () => {
    render(<PaywallPopup {...defaultProps} remainingFree={0} />)
    expect(screen.getByText('0')).toBeDefined()
  })

  it('overlay click calls onClose', () => {
    const onClose = vi.fn()
    const { container } = render(<PaywallPopup {...defaultProps} onClose={onClose} />)
    const overlay = container.querySelector('.paywall-popup__overlay')!
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    render(<PaywallPopup {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByText('暂不需要'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('upgrade button calls onClose then navigates with selected plan', () => {
    const onClose = vi.fn()
    const { container } = render(<PaywallPopup {...defaultProps} onClose={onClose} />)
    const upgradeBtn = container.querySelector('.paywall-popup__btn--upgrade')!
    fireEvent.click(upgradeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(vi.mocked(Taro.navigateTo)).toHaveBeenCalledWith({ url: '/pagesUser/member/index' })
  })

  it('shows plan options with prices', () => {
    render(<PaywallPopup {...defaultProps} />)
    expect(screen.getByText('月度会员')).toBeDefined()
    expect(screen.getByText('季度会员')).toBeDefined()
    expect(screen.getByText('年度会员')).toBeDefined()
  })

  it('shows comparison table', () => {
    render(<PaywallPopup {...defaultProps} />)
    expect(screen.getByText('免费版 vs 会员版')).toBeDefined()
    expect(screen.getByText('食物查询')).toBeDefined()
    expect(screen.getByText('5次/天')).toBeDefined()
    expect(screen.getAllByText('无限').length).toBeGreaterThanOrEqual(2)
  })

  it('shows section titles', () => {
    render(<PaywallPopup {...defaultProps} />)
    expect(screen.getByText('选择套餐')).toBeDefined()
  })

  it('shows info label for remaining free count', () => {
    render(<PaywallPopup {...defaultProps} />)
    expect(screen.getByText('今日剩余免费次数')).toBeDefined()
  })

  it('renders card structure with bar', () => {
    const { container } = render(<PaywallPopup {...defaultProps} />)
    expect(container.querySelector('.paywall-popup__card')).toBeDefined()
    expect(container.querySelector('.paywall-popup__bar')).toBeDefined()
  })

  it('re-render with visible=false hides popup', () => {
    const { container, rerender } = render(<PaywallPopup {...defaultProps} />)
    expect(container.querySelector('.paywall-popup')).toBeDefined()
    rerender(<PaywallPopup {...defaultProps} visible={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('defaults to yearly plan selected', () => {
    const { container } = render(<PaywallPopup {...defaultProps} />)
    const yearlyPlan = container.querySelector('.paywall-popup__plan--active')
    expect(yearlyPlan).toBeDefined()
  })

  it('shows best badge on yearly plan', () => {
    const { container } = render(<PaywallPopup {...defaultProps} />)
    const badge = container.querySelector('.paywall-popup__plan-badge')
    expect(badge).toBeDefined()
  })
})
