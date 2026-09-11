/**
 * 焦虑干预组件测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { createElement } from 'react'
import Taro from '@tarojs/taro'

import AnxietyIntervention from '../AnxietyIntervention'
import { getSickAnxietyMessage, getNewOwnerAnxietyMessage, getDisclaimer } from '../../engines/emotion'

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

vi.mock('../../engines/emotion', () => ({
  getSickAnxietyMessage: vi.fn(() => '理解你的担心'),
  getNewOwnerAnxietyMessage: vi.fn(() => '新手家长你好'),
  getDisclaimer: vi.fn((type: string) => type === 'sick_anxiety' ? '健康焦虑免责声明' : '新手焦虑免责声明'),
  detectSickAnxiety: vi.fn(),
  detectNewOwnerAnxiety: vi.fn(),
  getSickAnxietyLevel: vi.fn(),
  createIntervention: vi.fn(),
  generateCarePlan: vi.fn(() => ({
    steps: [
      { id: 'step1', title: '观察记录', description: '记录宠物每日状态' },
      { id: 'step2', title: '环境调整', description: '提供安静舒适的环境' },
      { id: 'step3', title: '专业咨询', description: '联系兽医获取专业建议' },
    ],
  })),
}))

const mockTrackEvent = vi.fn()
vi.mock('../../hooks/useAnalytics', () => ({
  useAnalytics: () => ({ trackEvent: mockTrackEvent, trackPageView: vi.fn() }),
}))

vi.mock('../../types/analyticsTypes', () => ({
  AnalyticsEventName: { EmotionTrigger: 'emotion_trigger' },
}))

vi.mock('../AnxietyIntervention.scss', () => ({}))

vi.mock('../../services/emotionTrackingService', () => ({
  trackEmotionEvent: vi.fn(),
  getEmotionScore: vi.fn(() => 0),
  shouldShowCrisisReferral: vi.fn(() => false),
  recordCrisisReferralShown: vi.fn(),
  getEmotionTrend: vi.fn(() => 'stable' as const),
  getCrisisSeverity: vi.fn(() => 'moderate' as const),
  recordFollowUp: vi.fn(),
}))

const sickContext = {
  petId: 'pet1',
  petName: '旺财',
  consecutiveAnomalyDays: 3,
  userOpenFrequency: 5,
  lastAnomalyItems: ['食欲下降'],
  previousRecoveryCount: 1,
}

const newOwnerContext = {
  userId: 'user1',
  accountAgeDays: 10,
  foodQueryCount: 6,
  symptomCheckCount: 3,
  petAgeDays: 15,
  hasVaccineSchedule: false,
}

describe('AnxietyIntervention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders sick_anxiety type with mild level for <5 anomaly days', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    const levelEl = container.querySelector('.anxiety-intervention__level--mild')
    expect(levelEl).toBeTruthy()
    expect(container.textContent).toContain('轻度关注')
  })

  it('renders sick_anxiety type with moderate level for 5-6 anomaly days', () => {
    const moderateContext = { ...sickContext, consecutiveAnomalyDays: 5 }
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={moderateContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    const levelEl = container.querySelector('.anxiety-intervention__level--moderate')
    expect(levelEl).toBeTruthy()
    expect(container.textContent).toContain('中度关注')
  })

  it('renders sick_anxiety type with severe level for >=7 anomaly days', () => {
    const severeContext = { ...sickContext, consecutiveAnomalyDays: 7 }
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={severeContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    const levelEl = container.querySelector('.anxiety-intervention__level--severe')
    expect(levelEl).toBeTruthy()
    expect(container.textContent).toContain('重度关注')
  })

  it('renders new_owner_anxiety type with mild level for low query count', () => {
    const mildCtx = { ...newOwnerContext, foodQueryCount: 2, symptomCheckCount: 1 }
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={mildCtx}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    const levelEl = container.querySelector('.anxiety-intervention__level--mild')
    expect(levelEl).toBeTruthy()
    expect(container.textContent).toContain('轻度关注')
  })

  it('renders new_owner_anxiety type with moderate level for medium query count', () => {
    const moderateCtx = { ...newOwnerContext, foodQueryCount: 5, symptomCheckCount: 3 }
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={moderateCtx}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    const levelEl = container.querySelector('.anxiety-intervention__level--moderate')
    expect(levelEl).toBeTruthy()
    expect(container.textContent).toContain('中度关注')
  })

  it('renders new_owner_anxiety type with severe level for high query count', () => {
    const severeCtx = { ...newOwnerContext, foodQueryCount: 10, symptomCheckCount: 8 }
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={severeCtx}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    const levelEl = container.querySelector('.anxiety-intervention__level--severe')
    expect(levelEl).toBeTruthy()
    expect(container.textContent).toContain('重度关注')
  })

  it('shows progress dots matching step count', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    const dots = container.querySelectorAll('.anxiety-intervention__progress-dot')
    expect(dots).toHaveLength(3)
  })

  it('shows step title and content', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    expect(container.textContent).toContain('理解你的担心')
    expect(getSickAnxietyMessage).toHaveBeenCalledWith(sickContext)
  })

  it('shows new_owner_anxiety step title and content', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    expect(container.textContent).toContain('新手家长你好！')
    expect(getNewOwnerAnxietyMessage).toHaveBeenCalledWith(newOwnerContext, 'cat', '小白')
  })

  it('action buttons call onAction with correct value', () => {
    const onAction = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
        onAction={onAction}
      />,
    )
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    fireEvent.click(actionBtns[0])
    expect(onAction).toHaveBeenCalledWith('breathe')
  })

  it('done action calls onDismiss', () => {
    const onDismiss = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const doneActionBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('完成'))
    fireEvent.click(doneActionBtn!)
    expect(onDismiss).toHaveBeenCalled()
  })

  it('trends action calls onDismiss and navigates to trends page', () => {
    const onDismiss = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={onDismiss}
      />,
    )
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const trendsBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('查看健康数据'))
    fireEvent.click(trendsBtn!)
    expect(onDismiss).toHaveBeenCalled()
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/trends/index' })
  })

  it('checkin action calls onDismiss and navigates to checkin page', () => {
    const onDismiss = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const checkinBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('记录今日状态'))
    fireEvent.click(checkinBtn!)
    expect(onDismiss).toHaveBeenCalled()
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/checkin/index' })
  })

  it('vaccine action calls onDismiss and navigates to vaccine page', () => {
    const onDismiss = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const vaccineBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('设置疫苗提醒'))
    fireEvent.click(vaccineBtn!)
    expect(onDismiss).toHaveBeenCalled()
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/vaccine/index' })
  })

  it('breathe action shows toast', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const breatheBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('深呼吸一下'))
    fireEvent.click(breatheBtn!)
    expect(Taro.showToast).toHaveBeenCalledWith({ title: '深呼吸，放松~', icon: 'none' })
  })

  it('guide action shows detail view', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const guideBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('查看新手指南'))
    fireEvent.click(guideBtn!)
    expect(container.querySelector('.anxiety-intervention--detail')).toBeTruthy()
    expect(container.textContent).toContain('新手养宠攻略')
  })

  it('guide action shows sick_anxiety detail view', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const guideBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('查看养宠攻略'))
    fireEvent.click(guideBtn!)
    expect(container.querySelector('.anxiety-intervention--detail')).toBeTruthy()
    expect(container.textContent).toContain('新手养宠攻略')
  })

  it('detail view close button hides detail view', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const guideBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('查看新手指南'))
    fireEvent.click(guideBtn!)
    expect(container.querySelector('.anxiety-intervention--detail')).toBeTruthy()
    const closeBtn = container.querySelector('.anxiety-intervention__close')
    fireEvent.click(closeBtn!)
    expect(container.querySelector('.anxiety-intervention--detail')).toBeFalsy()
  })

  it('detail view overlay click hides detail view', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const guideBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('查看新手指南'))
    fireEvent.click(guideBtn!)
    expect(container.querySelector('.anxiety-intervention--detail')).toBeTruthy()
    const overlay = container.querySelector('.anxiety-intervention__overlay')
    fireEvent.click(overlay!)
    expect(container.querySelector('.anxiety-intervention--detail')).toBeFalsy()
  })

  it('next button advances step', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    expect(container.textContent).toContain('理解你的担心')
    fireEvent.click(screen.getByText('下一步'))
    expect(container.textContent).toContain('理性分析')
  })

  it('previous button goes back', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    expect(container.textContent).toContain('理性分析')
    const prevBtn = container.querySelector('.anxiety-intervention__nav-btn--secondary')
    fireEvent.click(prevBtn!)
    expect(container.textContent).toContain('理解你的担心')
  })

  it('previous button not shown on first step', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    const prevBtn = container.querySelector('.anxiety-intervention__nav-btn--secondary')
    expect(prevBtn).toBeFalsy()
  })

  it('skip button calls onDismiss', () => {
    const onDismiss = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={onDismiss}
      />,
    )
    const closeBtn = container.querySelector('.anxiety-intervention__close')
    fireEvent.click(closeBtn!)
    expect(onDismiss).toHaveBeenCalled()
  })

  it('overlay click calls onDismiss', () => {
    const onDismiss = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={onDismiss}
      />,
    )
    const overlay = container.querySelector('.anxiety-intervention__overlay')
    fireEvent.click(overlay!)
    expect(onDismiss).toHaveBeenCalled()
  })

  it('last step complete button calls onDismiss', () => {
    const onDismiss = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    const navBtn = container.querySelector('.anxiety-intervention__nav-btn--primary')
    fireEvent.click(navBtn!)
    expect(onDismiss).toHaveBeenCalled()
  })

  it('shows disclaimer text', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    expect(getDisclaimer).toHaveBeenCalledWith('sick_anxiety')
    expect(container.textContent).toContain('健康焦虑免责声明')
  })

  it('shows new_owner_anxiety disclaimer text', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    expect(getDisclaimer).toHaveBeenCalledWith('new_owner_anxiety')
    expect(container.textContent).toContain('新手焦虑免责声明')
  })

  it('progress dots mark current step as active', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    const dots = container.querySelectorAll('.anxiety-intervention__progress-dot')
    expect(dots[0].className).toContain('progress-dot--active')
    expect(dots[1].className).not.toContain('progress-dot--active')
    expect(dots[2].className).not.toContain('progress-dot--active')
  })

  it('progress dots update after advancing', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    const dots = container.querySelectorAll('.anxiety-intervention__progress-dot')
    expect(dots[0].className).toContain('progress-dot--active')
    expect(dots[1].className).toContain('progress-dot--active')
    expect(dots[2].className).not.toContain('progress-dot--active')
  })

  it('renders sick_anxiety step content with pet name and anomaly days', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    expect(container.textContent).toContain('旺财')
    expect(container.textContent).toContain('3')
  })

  it('renders new_owner_anxiety step content with query counts', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    expect(container.textContent).toContain('6')
    expect(container.textContent).toContain('3')
  })

  it('renders dog label for dog species', () => {
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    expect(container.textContent).toContain('狗狗家长')
  })

  it('renders cat label for cat species', () => {
    const catSickContext = { ...sickContext, petName: '咪咪' }
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={catSickContext}
        petName='咪咪'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    expect(container.textContent).toContain('猫咪家长')
  })

  it('new_owner_anxiety detail view shows cat-specific content', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const guideBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('查看新手指南'))
    fireEvent.click(guideBtn!)
    expect(container.textContent).toContain('饮食安全')
    expect(container.textContent).toContain('猫咪')
  })

  it('sick_anxiety step 2 trends button navigates to trends page', () => {
    const onDismiss = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const trendsBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('查看趋势图'))
    fireEvent.click(trendsBtn!)
    expect(onDismiss).toHaveBeenCalled()
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/trends/index' })
  })

  it('hospital action navigates to hospital page', () => {
    const onDismiss = vi.fn()
    const { container } = render(
      <AnxietyIntervention
        type='sick_anxiety'
        context={sickContext}
        petName='旺财'
        species='dog'
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    const hospitalBtn = Array.from(actionBtns).find(btn => btn.textContent?.includes('找附近医院'))
    fireEvent.click(hospitalBtn!)
    expect(onDismiss).toHaveBeenCalled()
    expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/hospital/index' })
  })

  it('new_owner_anxiety last step has only done action', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    expect(container.textContent).toContain('你已经做得很好了')
    const actionBtns = container.querySelectorAll('.anxiety-intervention__action-btn')
    expect(actionBtns).toHaveLength(1)
    expect(actionBtns[0].textContent).toContain('完成')
  })

  it('new_owner_anxiety encourage step mentions pet name', () => {
    const { container } = render(
      <AnxietyIntervention
        type='new_owner_anxiety'
        context={newOwnerContext}
        petName='小白'
        species='cat'
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    expect(container.textContent).toContain('小白')
  })
})
