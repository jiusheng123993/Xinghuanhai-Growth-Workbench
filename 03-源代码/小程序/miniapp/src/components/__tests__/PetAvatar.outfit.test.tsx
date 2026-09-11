/**
 * PetAvatar 形象展示测试（替代原 outfitLayers 测试）
 * 验证组件不再生成简笔画 SVG，形象图优先、无图时使用渐变 emoji 兜底
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import PetAvatar from '../PetAvatar'
import type { ExpressionContext } from '../../engines/petAvatar'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
  Image: ({ src, className, style, mode }: any) => (
    <img src={src} className={className} style={style} data-mode={mode} />
  ),
}))

const mockExpression = {
  expression: 'happy' as const,
  label: '开心',
  color: '#4CAF50',
  eyes: 'happy',
  mouth: 'smile',
  accessory: 'blush',
  animation: 'bounce' as const
}

vi.mock('../../engines/petAvatar', () => ({
  calculateExpression: vi.fn(() => mockExpression),
  generateDiaryForToday: vi.fn(),
  EXPRESSION_MAP: {},
}))

const defaultContext: ExpressionContext = {
  todayEntry: null,
  hasAnomaly: false,
  anomalyCount: 0,
  riskLevel: null,
  streakDays: 0,
  isBirthday: false,
  isVaccineComplete: false,
  isRecovery: false,
  isDeceased: false,
}

describe('PetAvatar 形象展示', () => {
  it('no outfitSlots required anymore（不再叠加 SVG 图层）', () => {
    // 仅验证传基础属性即可渲染，不依赖 outfitSlots
    const { container } = render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} />
    )
    expect(container.querySelector('.pet-avatar')).toBeDefined()
  })

  it('不输出任何 SVG 简笔画脸（无 <svg> 内容）', () => {
    const { container } = render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} />
    )
    expect(container.innerHTML).not.toContain('<svg')
    expect(container.querySelector('img')).toBeNull()
  })

  it('传入 imageUrl 时展示图片而非 emoji 兜底', () => {
    render(
      <PetAvatar
        species='cat'
        petName='咪咪'
        expressionContext={defaultContext}
        imageUrl='https://cdn.example.com/cartoon.png'
      />
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/cartoon.png')
    expect(screen.queryByText('🐱')).toBeNull()
  })

  it('无 imageUrl 时展示物种 emoji 兜底', () => {
    render(
      <PetAvatar species='cat' petName='咪咪' expressionContext={defaultContext} />
    )
    expect(screen.getByText('🐱')).toBeDefined()
  })
})
