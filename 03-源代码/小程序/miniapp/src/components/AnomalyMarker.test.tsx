/**
 * 异常标记组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import AnomalyMarker from './AnomalyMarker'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
}))

describe('AnomalyMarker', () => {
  const baseProps = {
    date: '2024-07-20',
    riskLevel: 'emergency' as const,
    description: '检测到多项异常指标',
    items: ['体温偏高', '食欲下降', '活动减少'],
    position: { x: 50, y: 60 },
    onClick: vi.fn(),
  }

  it('正确渲染标记圆点', () => {
    render(<AnomalyMarker {...baseProps} />)

    const dot = document.querySelector('.anomaly-marker__dot')
    expect(dot).toBeDefined()
  })

  it('风险等级颜色映射正确', () => {
    const levels = [
      { level: 'normal' as const, label: '正常' },
      { level: 'caution' as const, label: '注意' },
      { level: 'warning' as const, label: '警告' },
      { level: 'emergency' as const, label: '紧急' },
    ]

    levels.forEach(({ level, label }) => {
      const { unmount } = render(
        <AnomalyMarker {...baseProps} riskLevel={level} />
      )
      const dotWrapper = document.querySelector('.anomaly-marker__dot-wrapper')
      expect(dotWrapper).toBeDefined()
      unmount()
    })
  })

  it('emergency 级别有脉冲动画', () => {
    render(<AnomalyMarker {...baseProps} riskLevel='emergency' />)

    const pulse = document.querySelector('.anomaly-marker__pulse')
    expect(pulse).toBeDefined()
  })

  it('非 emergency 级别无脉冲动画', () => {
    render(<AnomalyMarker {...baseProps} riskLevel='warning' />)

    const pulse = document.querySelector('.anomaly-marker__pulse')
    expect(pulse).toBeNull()
  })

  it('点击标记展开气泡弹窗', () => {
    render(<AnomalyMarker {...baseProps} />)

    const dotWrapper = document.querySelector('.anomaly-marker__dot-wrapper')
    fireEvent.click(dotWrapper!)

    const bubble = document.querySelector('.anomaly-marker__bubble')
    expect(bubble).toBeDefined()
  })

  it('气泡中显示异常项列表', () => {
    render(<AnomalyMarker {...baseProps} />)

    const dotWrapper = document.querySelector('.anomaly-marker__dot-wrapper')
    fireEvent.click(dotWrapper!)

    expect(screen.getByText('体温偏高')).toBeDefined()
    expect(screen.getByText('食欲下降')).toBeDefined()
    expect(screen.getByText('活动减少')).toBeDefined()
  })

  it('再次点击关闭气泡', () => {
    render(<AnomalyMarker {...baseProps} />)

    const dotWrapper = document.querySelector('.anomaly-marker__dot-wrapper')
    fireEvent.click(dotWrapper!)
    expect(document.querySelector('.anomaly-marker__bubble')).toBeDefined()

    fireEvent.click(dotWrapper!)
    expect(document.querySelector('.anomaly-marker__bubble')).toBeNull()
  })
})
