/**
 * 使用额度统计组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import UsageCounter from '../UsageCounter'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
}))

vi.mock('../../services/membershipService', () => ({
  MEMBERSHIP_BENEFITS: [
    { featureKey: 'food_query', featureName: '食物查询', freeValue: '3次/天', memberValue: '不限', isHighlight: false },
    { featureKey: 'symptom_check', featureName: '症状初筛', freeValue: '2次/天', memberValue: '不限', isHighlight: false },
    { featureKey: 'health_report', featureName: '健康报告', freeValue: '❌', memberValue: '✅', isHighlight: true },
  ],
}))

vi.mock('../UsageCounter.scss', () => ({}))

describe('UsageCounter', () => {
  it('renders header row with 功能/免费/会员', () => {
    render(<UsageCounter isMember={false} />)
    expect(screen.getByText('功能')).toBeDefined()
    expect(screen.getByText('免费')).toBeDefined()
    expect(screen.getByText('会员')).toBeDefined()
  })

  it('renders benefit rows from MEMBERSHIP_BENEFITS', () => {
    const { container } = render(<UsageCounter isMember={false} />)
    const rows = container.querySelectorAll('.usage-counter__row')
    expect(rows.length).toBe(3)
  })

  it('shows member badge when isMember=true', () => {
    const { container } = render(<UsageCounter isMember />)
    expect(container.querySelector('.usage-counter__member-badge')).toBeDefined()
    expect(screen.getByText('当前为会员')).toBeDefined()
  })

  it('does not show member badge when isMember=false', () => {
    const { container } = render(<UsageCounter isMember={false} />)
    expect(container.querySelector('.usage-counter__member-badge')).toBeNull()
  })

  it('renders feature names', () => {
    render(<UsageCounter isMember={false} />)
    expect(screen.getByText('食物查询')).toBeDefined()
    expect(screen.getByText('症状初筛')).toBeDefined()
    expect(screen.getByText('健康报告')).toBeDefined()
  })

  it('renders free values', () => {
    render(<UsageCounter isMember={false} />)
    expect(screen.getByText('3次/天')).toBeDefined()
    expect(screen.getByText('2次/天')).toBeDefined()
    expect(screen.getByText('❌')).toBeDefined()
  })

  it('renders member values', () => {
    render(<UsageCounter isMember={false} />)
    expect(screen.getAllByText('不限').length).toBe(2)
    expect(screen.getByText('✅')).toBeDefined()
  })

  it('applies highlight class to highlighted rows', () => {
    const { container } = render(<UsageCounter isMember={false} />)
    const highlightedRows = container.querySelectorAll('.usage-counter__row--highlight')
    expect(highlightedRows.length).toBe(1)
  })

  it('applies disabled class to ❌ free values', () => {
    const { container } = render(<UsageCounter isMember={false} />)
    const disabledValues = container.querySelectorAll('.usage-counter__value--disabled')
    expect(disabledValues.length).toBe(1)
  })

  it('applies active class to ✅ and 不限 member values', () => {
    const { container } = render(<UsageCounter isMember={false} />)
    const activeValues = container.querySelectorAll('.usage-counter__value--active')
    expect(activeValues.length).toBe(3)
  })
})
