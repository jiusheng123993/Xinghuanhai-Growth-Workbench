/**
 * 危机转介卡片组件测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CrisisReferralCard from '../CrisisReferralCard'

const { mockMakePhoneCall, mockDismiss, mockTrackEvent, mockNavigateTo } = vi.hoisted(() => ({
  mockMakePhoneCall: vi.fn(),
  mockDismiss: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockNavigateTo: vi.fn(),
}))

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, onClick }: any) => (
    <div className={className} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className }: any) => (
    <span className={className}>{children}</span>
  ),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    makePhoneCall: mockMakePhoneCall,
    navigateTo: mockNavigateTo,
    setStorageSync: vi.fn(),
    getStorageSync: vi.fn(),
  },
}))

vi.mock('../constants', () => ({
  HOTLINE_NUMBER: '400-161-9995',
}))

vi.mock('../../services/analyticsService', () => ({
  trackEvent: mockTrackEvent,
  flushEvents: vi.fn(),
  getQueueLength: vi.fn(() => 0),
  clearQueue: vi.fn(),
  setUserProperties: vi.fn(),
  getUserProperties: vi.fn(() => null),
  trackFunnelStep: vi.fn(),
  startPageTimer: vi.fn(),
  endPageTimer: vi.fn(),
}))

vi.mock('../CrisisReferralCard.scss', () => ({}))

describe('CrisisReferralCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders crisis message and hotline number', () => {
    render(<CrisisReferralCard message='你看起来非常焦虑' onDismiss={mockDismiss} />)
    expect(screen.getByText('你看起来非常焦虑')).toBeTruthy()
    expect(screen.getByText('400-161-9995')).toBeTruthy()
  })

  it('calls makePhoneCall on call button click', () => {
    render(<CrisisReferralCard message='test' onDismiss={mockDismiss} />)
    const callBtn = screen.getByText('拨打热线')
    fireEvent.click(callBtn)
    expect(mockMakePhoneCall).toHaveBeenCalledWith({ phoneNumber: '4001619995' })
  })

  it('renders moderate tips when severity is moderate', () => {
    render(<CrisisReferralCard message='test' onDismiss={mockDismiss} severity='moderate' />)
    expect(screen.getByText('试试深呼吸，放松一下')).toBeTruthy()
    expect(screen.queryByText('拨打热线')).toBeNull()
  })

  it('renders follow up buttons', () => {
    render(<CrisisReferralCard message='test' onDismiss={mockDismiss} />)
    expect(screen.getByText('我已联系帮助')).toBeTruthy()
    expect(screen.getByText('我没事，谢谢关心')).toBeTruthy()
  })

  it('calls onFollowUp and onDismiss when follow up button clicked', () => {
    const mockFollowUp = vi.fn()
    render(<CrisisReferralCard message='test' onDismiss={mockDismiss} onFollowUp={mockFollowUp} />)
    const contactedBtn = screen.getByText('我已联系帮助')
    fireEvent.click(contactedBtn)
    expect(mockFollowUp).toHaveBeenCalledWith('contacted')
    expect(mockDismiss).toHaveBeenCalled()
  })

  it('emergency "find hospital" item opens the hospital capability in 团团', () => {
    render(<CrisisReferralCard message='test' onDismiss={mockDismiss} />)
    fireEvent.click(screen.getByText('找宠物医院'))
    // 2026-09-12 收口批次 §2：附近医院属 AI 推理类能力 → 收拢到团团 + 带 capability 自动打开。
    // 改之前这里写的是「找宠物医院」却跳 /pagesPet/symptom-check/index（文案与去处对不上），
    // 这条断言同时锁住「不再跳症状初筛页」。
    expect(mockNavigateTo).toHaveBeenCalledWith({
      url: '/pagesYuantuan/agent/index?capability=hospital',
    })
    expect(mockNavigateTo).not.toHaveBeenCalledWith({ url: '/pagesPet/symptom-check/index' })
  })
})
