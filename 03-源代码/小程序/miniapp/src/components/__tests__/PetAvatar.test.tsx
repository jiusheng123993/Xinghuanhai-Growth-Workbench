/**
 * 宠物头像组件测试
 * 验证：有形象图时展示图片，无形象图时展示渐变 emoji 兜底（不再生成简笔画 SVG）
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
  Image: ({ src, className, style, mode, onError }: any) => (
    <img src={src} className={className} style={style} data-mode={mode} onError={onError} />
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

const mockDiary = { emoji: '😊', text: '今天很开心', tone: 'happy' as const }

vi.mock('../../engines/petAvatar', () => ({
  calculateExpression: vi.fn(() => mockExpression),
  generateDiaryForToday: vi.fn(() => mockDiary),
  EXPRESSION_MAP: {
    excited: {
      expression: 'excited',
      label: '兴奋',
      eyes: 'star',
      mouth: 'open_smile',
      accessory: 'confetti',
      animation: 'jump' as const,
      color: '#FF69B4'
    }
  },
}))

import PetAvatar from '../PetAvatar'
import { calculateExpression, generateDiaryForToday } from '../../engines/petAvatar'
import type { ExpressionContext } from '../../engines/petAvatar'

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

describe('PetAvatar', () => {
  it('renders with default props', () => {
    const { container } = render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} />
    )
    expect(container.querySelector('.pet-avatar')).toBeDefined()
  })

  it('renders gradient emoji placeholder for dog when no imageUrl', () => {
    const { container } = render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} />
    )
    expect(screen.getByText('🐶')).toBeDefined()
    expect(container.querySelector('.pet-avatar__placeholder--dog')).toBeDefined()
    expect(container.querySelector('.pet-avatar__image')).toBeNull()
  })

  it('renders gradient emoji placeholder for cat when no imageUrl', () => {
    const { container } = render(
      <PetAvatar species='cat' petName='咪咪' expressionContext={defaultContext} />
    )
    expect(screen.getByText('🐱')).toBeDefined()
    expect(container.querySelector('.pet-avatar__placeholder--cat')).toBeDefined()
  })

  it('renders Image with imageUrl when provided', () => {
    render(
      <PetAvatar
        species='dog'
        petName='旺财'
        expressionContext={defaultContext}
        imageUrl='https://cdn.example.com/avatar.png'
      />
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/avatar.png')
  })

  it('prefers imageUrl over placeholder', () => {
    render(
      <PetAvatar
        species='dog'
        petName='旺财'
        expressionContext={defaultContext}
        imageUrl='https://cdn.example.com/avatar.png'
      />
    )
    expect(screen.queryByText('🐶')).toBeNull()
  })

  it('uses pet.avatarCartoonUrl as fallback when no imageUrl', () => {
    render(
      <PetAvatar
        species='cat'
        petName='咪咪'
        expressionContext={defaultContext}
        pet={{ avatarPhotoUrl: undefined, avatarCartoonUrl: 'https://cdn.example.com/cartoon.png' }}
      />
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/cartoon.png')
    expect(screen.queryByText('🐱')).toBeNull()
  })

  it('prefers pet.avatarPhotoUrl over pet.avatarCartoonUrl', () => {
    render(
      <PetAvatar
        species='cat'
        petName='咪咪'
        expressionContext={defaultContext}
        pet={{
          avatarPhotoUrl: 'https://cdn.example.com/photo.png',
          avatarCartoonUrl: 'https://cdn.example.com/cartoon.png',
        }}
      />
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/photo.png')
  })

  it('prefers explicit imageUrl over pet avatar', () => {
    render(
      <PetAvatar
        species='cat'
        petName='咪咪'
        expressionContext={defaultContext}
        imageUrl='https://cdn.example.com/explicit.png'
        pet={{ avatarPhotoUrl: 'https://cdn.example.com/photo.png', avatarCartoonUrl: undefined }}
      />
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/explicit.png')
  })

  it('falls back to emoji when no pet is provided at all', () => {
    // 无档案上下文（如形象定制页生成中态）才走 emoji 占位
    render(
      <PetAvatar species='cat' petName='咪咪' expressionContext={defaultContext} />
    )
    expect(screen.getByText('🐱')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('falls back to brand animal avatar when pet has no custom avatar', () => {
    // 回归（2026-09-10 用户反馈「头像没显示」）：新建宠物默认没设头像，
    // 若退化成空渐变圆用户会判定为坏图 —— 必须给按品种匹配的品牌小动物头像
    render(
      <PetAvatar
        species='cat'
        petName='咪咪'
        expressionContext={defaultContext}
        pet={{ avatarPhotoUrl: undefined, avatarCartoonUrl: undefined, breed: '布偶猫', breedId: 'ragdoll' }}
      />
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toContain('/uploads/avatars/home-style/cat/cat-08-ragdoll.png')
    expect(screen.queryByText('🐱')).toBeNull()
  })

  it('falls back to emoji after the brand avatar image fails to load', () => {
    // 两级兜底：品牌头像也加载失败时仍不能让头像位空着
    const { container } = render(
      <PetAvatar
        species='cat'
        petName='咪咪'
        expressionContext={defaultContext}
        pet={{ avatarPhotoUrl: undefined, avatarCartoonUrl: undefined, breed: '布偶猫', breedId: 'ragdoll' }}
      />
    )
    const img = screen.getByRole('img')
    fireEvent.error(img)
    expect(screen.getByText('🐱')).toBeDefined()
    expect(container.querySelector('.pet-avatar__placeholder--cat')).toBeDefined()
  })

  it('treats empty-string imageUrl as absent and falls back to pet avatar', () => {
    render(
      <PetAvatar
        species='cat'
        petName='咪咪'
        expressionContext={defaultContext}
        imageUrl=''
        pet={{ avatarPhotoUrl: undefined, avatarCartoonUrl: 'https://cdn.example.com/cartoon.png' }}
      />
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/cartoon.png')
  })

  it('treats null avatarPhotoUrl as absent and falls back to cartoon', () => {
    render(
      <PetAvatar
        species='cat'
        petName='咪咪'
        expressionContext={defaultContext}
        pet={{ avatarPhotoUrl: null, avatarCartoonUrl: 'https://cdn.example.com/cartoon.png' }}
      />
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/cartoon.png')
  })

  it('does not show label by default', () => {
    render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} />
    )
    expect(screen.queryByText('开心')).toBeNull()
  })

  it('shows label when showLabel=true with expression.label and color', () => {
    render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} showLabel />
    )
    const labelText = screen.getByText('开心')
    expect(labelText).toBeDefined()
    const labelContainer = labelText.closest('.pet-avatar__label')
    expect(labelContainer).toBeDefined()
    expect((labelContainer as HTMLElement).style.backgroundColor).toBe('rgb(76, 175, 80)')
  })

  it('does not show diary by default', () => {
    render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} />
    )
    expect(screen.queryByText(/今天很开心/)).toBeNull()
    expect(screen.queryByText('😊')).toBeNull()
  })

  it('shows diary when showDiary=true with emoji, text, author', () => {
    render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} showDiary />
    )
    expect(screen.getByText('😊')).toBeDefined()
    expect(screen.getByText(/今天很开心/)).toBeDefined()
    expect(screen.getByText(/旺财/)).toBeDefined()
  })

  it('uses customExpression when provided instead of calculateExpression', () => {
    vi.clearAllMocks()
    const customExpression = {
      expression: 'excited' as const,
      label: '兴奋',
      color: '#FF69B4',
      eyes: 'star',
      mouth: 'open_smile',
      accessory: 'confetti',
      animation: 'jump' as const
    }
    render(
      <PetAvatar
        species='dog'
        petName='旺财'
        expressionContext={defaultContext}
        customExpression={customExpression}
        showLabel
      />
    )
    expect(screen.getByText('兴奋')).toBeDefined()
    expect(calculateExpression).not.toHaveBeenCalled()
  })

  it('applies className prop', () => {
    render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} className='custom-class' />
    )
    const avatar = document.querySelector('.pet-avatar.custom-class')
    expect(avatar).toBeDefined()
  })

  it('uses default size of 100 for placeholder when size not provided', () => {
    const { container } = render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} />
    )
    const placeholder = container.querySelector('.pet-avatar__placeholder') as HTMLElement
    expect(placeholder.style.width).toBe('100px')
    expect(placeholder.style.height).toBe('100px')
  })

  it('uses provided size for placeholder', () => {
    const { container } = render(
      <PetAvatar species='cat' petName='咪咪' expressionContext={defaultContext} size={150} />
    )
    const placeholder = container.querySelector('.pet-avatar__placeholder') as HTMLElement
    expect(placeholder.style.width).toBe('150px')
    expect(placeholder.style.height).toBe('150px')
  })

  it('calls calculateExpression with expressionContext', () => {
    vi.clearAllMocks()
    render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} />
    )
    expect(calculateExpression).toHaveBeenCalledWith(defaultContext)
  })

  it('calls generateDiaryForToday with expressionContext fields when showDiary=true', () => {
    vi.clearAllMocks()
    render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} showDiary />
    )
    expect(generateDiaryForToday).toHaveBeenCalledWith(
      defaultContext.todayEntry,
      defaultContext.streakDays,
      defaultContext.isBirthday,
      defaultContext.isRecovery
    )
  })

  it('does not call generateDiaryForToday when showDiary=false', () => {
    vi.clearAllMocks()
    render(
      <PetAvatar species='dog' petName='旺财' expressionContext={defaultContext} showDiary={false} />
    )
    expect(generateDiaryForToday).not.toHaveBeenCalled()
  })

  it('applies animation class to image based on expression.animation', () => {
    render(
      <PetAvatar
        species='dog'
        petName='旺财'
        expressionContext={defaultContext}
        imageUrl='https://cdn.example.com/avatar.png'
      />
    )
    const img = screen.getByRole('img')
    expect(img.className).toContain('pet-avatar__image--bounce')
  })

  it('applies different animation class for customExpression', () => {
    const customExpression = {
      expression: 'excited' as const,
      label: '兴奋',
      color: '#FF69B4',
      eyes: 'star',
      mouth: 'open_smile',
      accessory: 'confetti',
      animation: 'jump' as const
    }
    const { container } = render(
      <PetAvatar
        species='dog'
        petName='旺财'
        expressionContext={defaultContext}
        customExpression={customExpression}
      />
    )
    const placeholder = container.querySelector('.pet-avatar__placeholder') as HTMLElement
    expect(placeholder.className).toContain('pet-avatar__image--jump')
  })
})
