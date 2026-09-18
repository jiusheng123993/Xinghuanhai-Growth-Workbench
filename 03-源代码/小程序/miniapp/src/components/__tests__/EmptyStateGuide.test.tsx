/**
 * 空状态引导组件测试
 *
 * 【本测试守的是什么】
 * 2026-09-12 收口批次 §2 把「AI 推理类能力」的入口统一收拢到团团
 * （`/pagesYuantuan/agent/index`），非 AI 的纯记录/查询类保持原路径。
 * 这个组件此前**没有任何测试**，而它的亮点条目以前连点击都没接 ——
 * 所以这里既锁「AI 入口落在团团」，也锁「品种百科没被顺手改坏」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import EmptyStateGuide from '../EmptyStateGuide'

/** 团团全屏页路由（AI 能力唯一入口） */
const AI_HUB_PATH = '/pagesYuantuan/agent/index'

const { mockNavigateTo } = vi.hoisted(() => ({ mockNavigateTo: vi.fn() }))

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, onClick }: any) => (
    <div className={className} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className }: any) => (
    <span className={className}>{children}</span>
  ),
}))

vi.mock('@tarojs/taro', () => ({
  default: { navigateTo: mockNavigateTo, eventCenter: { trigger: vi.fn() } },
  useDidShow: vi.fn(),
}))

vi.mock('../EmptyStateGuide.scss', () => ({}))

describe('EmptyStateGuide', () => {
  const onAddPet = vi.fn()
  const onExplore = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** 渲染组件并返回容器（用例里频繁需要按类名取元素） */
  const setup = () => render(<EmptyStateGuide onAddPet={onAddPet} onExplore={onExplore} />)

  it('renders welcome copy and the two action buttons', () => {
    setup()
    expect(screen.getByText('欢迎来到星河宠记')).toBeDefined()
    expect(screen.getByText('添加我的宠物')).toBeDefined()
    expect(screen.getByText('先逛逛')).toBeDefined()
  })

  it('calls onAddPet when the primary button is clicked', () => {
    setup()
    fireEvent.click(screen.getByText('添加我的宠物'))
    expect(onAddPet).toHaveBeenCalledTimes(1)
  })

  it('calls onExplore when the secondary button is clicked', () => {
    setup()
    fireEvent.click(screen.getByText('先逛逛'))
    expect(onExplore).toHaveBeenCalledTimes(1)
  })

  it('food highlight opens the food capability in 团团 (one step, not two)', () => {
    setup()
    fireEvent.click(screen.getByText('食物查询'))
    // 食物安全查询属 AI 推理类能力 → 收拢到团团，并带 capability 让团团进页自动开流程
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: `${AI_HUB_PATH}?capability=food` })
  })

  it('symptom highlight opens the symptom capability in 团团', () => {
    setup()
    fireEvent.click(screen.getByText('症状初筛'))
    // 症状初筛属 AI 推理类能力 → 收拢到团团 + 自动打开
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: `${AI_HUB_PATH}?capability=symptom` })
  })

  it('breed highlight keeps its own route (not an AI capability)', () => {
    setup()
    fireEvent.click(screen.getByText('品种百科'))
    // 品种百科是纯查询类能力 → 保留原位，不许被一起收拢
    expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesPet/breed/index' })
  })

  it('never navigates straight to the page-level AI entries', () => {
    setup()
    fireEvent.click(screen.getByText('食物查询'))
    fireEvent.click(screen.getByText('症状初筛'))
    const urls = mockNavigateTo.mock.calls.map(c => (c[0] as { url: string }).url)
    // 沿用旧直达路径（food-query / symptom-check）即为回归
    expect(urls).not.toContain('/pagesPet/food-query/index')
    expect(urls).not.toContain('/pagesPet/symptom-check/index')
  })
})
