/**
 * 套餐选择器组件测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import PlanSelector from '../PlanSelector'
import type { MembershipPlan } from '../../services/membershipService'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
}))

vi.mock('../../services/membershipService', () => ({
  MEMBERSHIP_PLANS: [
    { plan: 'monthly', label: '月度会员', price: 29.9, originalPrice: 29.9, discountLabel: '', durationDays: 30 },
    { plan: 'quarterly', label: '季度会员', price: 79.9, originalPrice: 89.7, discountLabel: '省33%', durationDays: 90 },
    { plan: 'yearly', label: '年度会员', price: 299, originalPrice: 358.8, discountLabel: '省17%', durationDays: 365 },
  ],
}))

vi.mock('../PlanSelector.scss', () => ({}))

describe('PlanSelector', () => {
  const defaultProps = {
    selectedPlan: 'monthly' as MembershipPlan,
    onSelectPlan: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all plan cards', () => {
    const { container } = render(<PlanSelector {...defaultProps} />)
    const cards = container.querySelectorAll('.plan-selector__card')
    expect(cards.length).toBe(3)
  })

  it('selected plan has --active class', () => {
    const { container } = render(<PlanSelector {...defaultProps} selectedPlan='quarterly' />)
    const activeCard = container.querySelector('.plan-selector__card--active')
    expect(activeCard).toBeDefined()
    expect(activeCard?.textContent).toContain('季度会员')
  })

  it('click on plan card calls onSelectPlan with plan', () => {
    const onSelectPlan = vi.fn()
    const { container } = render(<PlanSelector {...defaultProps} onSelectPlan={onSelectPlan} />)
    const cards = container.querySelectorAll('.plan-selector__card')
    fireEvent.click(cards[1])
    expect(onSelectPlan).toHaveBeenCalledWith('quarterly')
  })

  it('shows discount badge when discountLabel exists', () => {
    const { container } = render(<PlanSelector {...defaultProps} />)
    const badges = container.querySelectorAll('.plan-selector__badge')
    expect(badges.length).toBe(2)
    expect(screen.getByText('省33%')).toBeDefined()
    expect(screen.getByText('省17%')).toBeDefined()
  })

  it('does not show badge when no discountLabel', () => {
    const { container } = render(<PlanSelector {...defaultProps} />)
    const cards = container.querySelectorAll('.plan-selector__card')
    const monthlyCard = cards[0]
    expect(monthlyCard.querySelector('.plan-selector__badge')).toBeNull()
  })

  it('shows original price when different from price', () => {
    render(<PlanSelector {...defaultProps} />)
    expect(screen.getByText('¥89.7')).toBeDefined()
    expect(screen.getByText('¥358.8')).toBeDefined()
  })

  it('does not show original price when same as price', () => {
    const { container } = render(<PlanSelector {...defaultProps} />)
    const cards = container.querySelectorAll('.plan-selector__card')
    const monthlyCard = cards[0]
    expect(monthlyCard.querySelector('.plan-selector__original-price')).toBeNull()
  })

  it('shows check icon for selected plan', () => {
    const { container } = render(<PlanSelector {...defaultProps} selectedPlan='monthly' />)
    const activeCard = container.querySelector('.plan-selector__card--active')
    expect(activeCard?.querySelector('.plan-selector__check')).toBeDefined()
    expect(screen.getByText('✓')).toBeDefined()
  })

  it('does not show check icon for non-selected plan', () => {
    const { container } = render(<PlanSelector {...defaultProps} selectedPlan='monthly' />)
    const cards = container.querySelectorAll('.plan-selector__card')
    const quarterlyCard = cards[1]
    expect(quarterlyCard.querySelector('.plan-selector__check')).toBeNull()
  })

  it('renders plan labels', () => {
    render(<PlanSelector {...defaultProps} />)
    expect(screen.getByText('月度会员')).toBeDefined()
    expect(screen.getByText('季度会员')).toBeDefined()
    expect(screen.getByText('年度会员')).toBeDefined()
  })

  it('renders plan prices', () => {
    render(<PlanSelector {...defaultProps} />)
    expect(screen.getByText('¥29.9')).toBeDefined()
    expect(screen.getByText('¥79.9')).toBeDefined()
    expect(screen.getByText('¥299')).toBeDefined()
  })

  it('renders per-month unit for each plan', () => {
    render(<PlanSelector {...defaultProps} />)
    const units = screen.getAllByText('/月')
    expect(units.length).toBe(3)
  })

  it('switches active class when selectedPlan changes', () => {
    const { container, rerender } = render(<PlanSelector {...defaultProps} selectedPlan='monthly' />)
    expect(container.querySelector('.plan-selector__card--active')?.textContent).toContain('月度会员')
    rerender(<PlanSelector {...defaultProps} selectedPlan='yearly' />)
    expect(container.querySelector('.plan-selector__card--active')?.textContent).toContain('年度会员')
  })
})
