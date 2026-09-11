/**
 * 紧急健康预警组件测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, act } from '@testing-library/react'
import Taro from '@tarojs/taro'

import EmergencyAlert from '../index'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
}))

vi.mock('@tarojs/taro', () => ({
  default: { navigateTo: vi.fn(), showToast: vi.fn() },
}))

const mockTrackEvent = vi.fn()
vi.mock('../../../hooks/useAnalytics', () => ({
  useAnalytics: () => ({ trackEvent: mockTrackEvent, trackPageView: vi.fn() }),
}))

vi.mock('../../../types/analyticsTypes', () => ({
  AnalyticsEventName: { EmergencyAlert: 'emergency_alert' },
}))

vi.mock('../EmergencyAlert.scss', () => ({}))

describe('EmergencyAlert', () => {
  const defaultProps = {
    visible: true,
    message: '您的宠物可能存在紧急健康风险',
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(Taro.navigateTo).mockClear()
    defaultProps.onClose.mockClear()
    mockTrackEvent.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when visible=false', () => {
    const { container } = render(<EmergencyAlert {...defaultProps} visible={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders when visible=true with default title', () => {
    const { container } = render(<EmergencyAlert {...defaultProps} />)
    const overlay = container.querySelector('.emergency-alert__overlay')
    expect(overlay).not.toBeNull()
    expect(screen.getByText('紧急健康预警')).toBeDefined()
  })

  it('renders custom title when provided', () => {
    render(<EmergencyAlert {...defaultProps} title='自定义预警标题' />)
    expect(screen.getByText('自定义预警标题')).toBeDefined()
  })

  it('displays the message', () => {
    render(<EmergencyAlert {...defaultProps} message='测试消息内容' />)
    expect(screen.getByText('测试消息内容')).toBeDefined()
  })

  it('shows disclaimer text', () => {
    render(<EmergencyAlert {...defaultProps} />)
    expect(screen.getByText(/以上内容仅供参考，不能替代专业兽医诊断/)).toBeDefined()
  })

  it('shows symptom button by default', () => {
    const { container } = render(<EmergencyAlert {...defaultProps} />)
    const symptomBtn = container.querySelector('.emergency-alert__btn--symptom')
    expect(symptomBtn).not.toBeNull()
    expect(screen.getByText('记录症状')).toBeDefined()
  })

  it('shows food button by default', () => {
    const { container } = render(<EmergencyAlert {...defaultProps} />)
    const foodBtn = container.querySelector('.emergency-alert__btn--food')
    expect(foodBtn).not.toBeNull()
    expect(screen.getByText('查食物')).toBeDefined()
  })

  it('hides symptom button when showSymptomButton=false', () => {
    const { container, queryByText } = render(
      <EmergencyAlert {...defaultProps} showSymptomButton={false} />
    )
    const symptomBtn = container.querySelector('.emergency-alert__btn--symptom')
    expect(symptomBtn).toBeNull()
    expect(queryByText('记录症状')).toBeNull()
  })

  it('hides food button when showFoodButton=false', () => {
    const { container, queryByText } = render(
      <EmergencyAlert {...defaultProps} showFoodButton={false} />
    )
    const foodBtn = container.querySelector('.emergency-alert__btn--food')
    expect(foodBtn).toBeNull()
    expect(queryByText('查食物')).toBeNull()
  })

  it('symptom button click calls onClose and navigates to symptom-check', () => {
    const onClose = vi.fn()
    render(<EmergencyAlert {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByText('记录症状'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/symptom-check/index' })
  })

  it('food button click calls onClose and navigates to food-query', () => {
    const onClose = vi.fn()
    render(<EmergencyAlert {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByText('查食物'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/food-query/index' })
  })

  it('close button is disabled initially (has disabled class)', () => {
    const { container } = render(<EmergencyAlert {...defaultProps} />)
    const closeBtn = container.querySelector('.emergency-alert__btn--close')
    expect(closeBtn?.classList.contains('emergency-alert__btn--disabled')).toBe(true)
  })

  it('close button shows countdown text initially', () => {
    render(<EmergencyAlert {...defaultProps} />)
    expect(screen.getByText('请仔细阅读 (3s)')).toBeDefined()
  })

  it('close button click does NOT call onClose when canClose is false', () => {
    const onClose = vi.fn()
    const { container } = render(<EmergencyAlert {...defaultProps} onClose={onClose} />)
    const closeBtn = container.querySelector('.emergency-alert__btn--close')!
    fireEvent.click(closeBtn)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('after 3 seconds, close button becomes enabled and calls onClose', () => {
    const onClose = vi.fn()
    const { container } = render(<EmergencyAlert {...defaultProps} onClose={onClose} />)
    act(() => { vi.advanceTimersToNextTimer() })  // 3 → 2
    act(() => { vi.advanceTimersToNextTimer() })  // 2 → 1
    act(() => { vi.advanceTimersToNextTimer() })  // 1 → 0, canClose=true
    const closeBtn = container.querySelector('.emergency-alert__btn--close')!
    expect(closeBtn.classList.contains('emergency-alert__btn--disabled')).toBe(false)
    expect(screen.getByText('我知道了')).toBeDefined()
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('countdown decreases from 3 to 0 over 3 seconds', () => {
    render(<EmergencyAlert {...defaultProps} />)
    expect(screen.getByText('请仔细阅读 (3s)')).toBeDefined()
    act(() => { vi.advanceTimersToNextTimer() })
    expect(screen.getByText('请仔细阅读 (2s)')).toBeDefined()
    act(() => { vi.advanceTimersToNextTimer() })
    expect(screen.getByText('请仔细阅读 (1s)')).toBeDefined()
    act(() => { vi.advanceTimersToNextTimer() })
    expect(screen.getByText('我知道了')).toBeDefined()
  })

  it('tracks EmergencyAlert event when visible with petId', () => {
    render(<EmergencyAlert {...defaultProps} petId='pet123' symptoms={['vomit']} alertType='checkin_emergency' />)
    expect(mockTrackEvent).toHaveBeenCalledWith('emergency_alert', {
      petId: 'pet123',
      symptoms: ['vomit'],
      alertType: 'checkin_emergency',
    })
  })

  it('does not track EmergencyAlert event when visible without petId', () => {
    render(<EmergencyAlert {...defaultProps} />)
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})