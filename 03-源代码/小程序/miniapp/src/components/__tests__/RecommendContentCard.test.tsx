/**
 * 推荐内容卡片组件测试
 *
 * 【本测试守的是什么】
 * 2026-09-12 收口批次 §2：AI 推理类能力（食物安全速查）的入口收拢到团团，
 * 纯记录/查询类（品种百科、健康打卡）保留原路径。本组件此前没有测试。
 * 另外锁住关闭态的持久化行为（localStorage 标记、不再渲染）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import RecommendContentCard from '../RecommendContentCard'

/** 团团全屏页路由（AI 能力唯一入口） */
const AI_HUB_PATH = '/pagesYuantuan/agent/index'

const { mockNavigateTo, mockOnNavigate, mockGetStorageSync, mockSetStorageSync } = vi.hoisted(() => ({
  mockNavigateTo: vi.fn(),
  mockOnNavigate: vi.fn(),
  mockGetStorageSync: vi.fn(),
  mockSetStorageSync: vi.fn(),
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
    navigateTo: mockNavigateTo,
    getStorageSync: mockGetStorageSync,
    setStorageSync: mockSetStorageSync,
    eventCenter: { trigger: vi.fn() },
  },
  useDidShow: vi.fn(),
}))

vi.mock('../RecommendContentCard.scss', () => ({}))

describe('RecommendContentCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认未关闭过（首次进入的场景）
    mockGetStorageSync.mockReturnValue(false)
  })

  /** 渲染卡片；`onNavigate` 由页面注入，路径由本组件决定 */
  const setup = () => render(<RecommendContentCard onNavigate={mockOnNavigate} />)

  it('renders the three recommendation entries', () => {
    setup()
    expect(screen.getByText('为你推荐')).toBeDefined()
    expect(screen.getByText('热门品种百科')).toBeDefined()
    expect(screen.getByText('食物安全速查')).toBeDefined()
    expect(screen.getByText('健康小贴士')).toBeDefined()
  })

  it('food entry goes to the AI hub (团团)', () => {
    setup()
    fireEvent.click(screen.getByText('食物安全速查'))
    // 食物安全查询属 AI 推理类能力 → 收拢到团团，并带 capability 让团团进页自动开流程
    expect(mockOnNavigate).toHaveBeenCalledWith(`${AI_HUB_PATH}?capability=food`)
  })

  it('breed entry keeps its own route (pure query, not AI)', () => {
    setup()
    fireEvent.click(screen.getByText('热门品种百科'))
    expect(mockOnNavigate).toHaveBeenCalledWith('/pagesPet/breed/index')
  })

  it('health entry keeps the checkin route (pure record, not AI)', () => {
    setup()
    fireEvent.click(screen.getByText('健康小贴士'))
    expect(mockOnNavigate).toHaveBeenCalledWith('/pagesPet/checkin/index')
  })

  it('never routes straight to the food-query page anymore', () => {
    setup()
    fireEvent.click(screen.getByText('食物安全速查'))
    expect(mockOnNavigate).not.toHaveBeenCalledWith('/pagesPet/food-query/index')
  })

  it('renders nothing when the dismissed flag is already stored', () => {
    mockGetStorageSync.mockReturnValue(true)
    const { container } = setup()
    expect(container.innerHTML).toBe('')
  })

  it('persists the dismissed flag and hides itself on close', () => {
    const { container } = setup()
    fireEvent.click(screen.getByText('✕'))
    expect(mockSetStorageSync).toHaveBeenCalledWith('xhh_recommend_dismissed', true)
    expect(container.innerHTML).toBe('')
  })
})
