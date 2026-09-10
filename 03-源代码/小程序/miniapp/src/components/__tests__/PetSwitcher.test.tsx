/**
 * 宠物切换器组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick, onLongPress }: any) => (
    <div className={className} style={style} onClick={onClick} onContextMenu={onLongPress}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
  Image: ({ src, className, mode, lazyLoad, onError }: any) => (
    <img src={src} className={className} data-mode={mode} data-lazyLoad={lazyLoad} onError={onError} />
  ),
  Picker: ({ children, mode, value, onChange }: any) => (
    <div data-mode={mode} data-value={value} onClick={() => onChange?.({ detail: { value: '2026-01-15' } })}>{children}</div>
  ),
  ScrollView: ({ children, className, scrollX }: any) => (
    <div className={className} data-scrollX={scrollX}>{children}</div>
  ),
}))

vi.mock('../PetSwitcher.scss', () => ({}))

import PetSwitcher from '../PetSwitcher'
import type { PetProfile } from '../../services/petService'

const makePet = (overrides: Partial<PetProfile> & { id: string }): PetProfile => ({
  userId: 'user-1',
  name: '旺财',
  species: 'dog',
  breed: '金毛',
  breedId: 'breed-1',
  gender: 'male',
  birthDate: '2024-04-15',
  weight: 25,
  coatColor: '',
  photos: [],
  isNeutered: false,
  microchipId: '',
  notes: '',
  isDeceased: false,
  allergies: [],
  medications: [],
  chronicConditions: [],
  createdAt: '2024-04-15',
  updatedAt: '2024-04-15',
  ...overrides,
})

const pets: PetProfile[] = [
  makePet({ id: 'pet-1', name: '旺财', species: 'dog' }),
  makePet({ id: 'pet-2', name: '咪咪', species: 'cat' }),
  makePet({ id: 'pet-3', name: '豆豆', species: 'dog' }),
]

describe('PetSwitcher', () => {
  it('renders all pets', () => {
    const { getByText } = render(<PetSwitcher pets={pets} currentPetId="pet-1" onSwitch={vi.fn()} />)
    expect(getByText('旺财')).toBeDefined()
    expect(getByText('咪咪')).toBeDefined()
    expect(getByText('豆豆')).toBeDefined()
  })

  it('active pet has --active class', () => {
    const { container } = render(<PetSwitcher pets={pets} currentPetId="pet-1" onSwitch={vi.fn()} />)
    const activeItem = container.querySelector('.pet-switcher__item--active')
    expect(activeItem).not.toBeNull()
    expect(activeItem!.textContent).toContain('旺财')
  })

  it('click on pet calls onSwitch with pet.id', () => {
    const onSwitch = vi.fn()
    const { getByText } = render(<PetSwitcher pets={pets} currentPetId="pet-1" onSwitch={onSwitch} />)
    fireEvent.click(getByText('咪咪'))
    expect(onSwitch).toHaveBeenCalledWith('pet-2')
  })

  it('shows add button when onAdd provided', () => {
    const { getByText } = render(<PetSwitcher pets={pets} currentPetId="pet-1" onSwitch={vi.fn()} onAdd={vi.fn()} />)
    expect(getByText('添加')).toBeDefined()
    expect(getByText('+')).toBeDefined()
  })

  it('does not show add button when onAdd not provided', () => {
    const { queryByText } = render(<PetSwitcher pets={pets} currentPetId="pet-1" onSwitch={vi.fn()} />)
    expect(queryByText('添加')).toBeNull()
    expect(queryByText('+')).toBeNull()
  })

  it('click add button calls onAdd', () => {
    const onAdd = vi.fn()
    const { getByText } = render(<PetSwitcher pets={pets} currentPetId="pet-1" onSwitch={vi.fn()} onAdd={onAdd} />)
    fireEvent.click(getByText('+'))
    expect(onAdd).toHaveBeenCalled()
  })

  it('deceased pet has --deceased class', () => {
    const deceasedPets = [
      makePet({ id: 'pet-1', name: '旺财', isDeceased: true }),
      makePet({ id: 'pet-2', name: '咪咪' }),
    ]
    const { container } = render(<PetSwitcher pets={deceasedPets} currentPetId="pet-2" onSwitch={vi.fn()} />)
    const deceasedItem = container.querySelector('.pet-switcher__item--deceased')
    expect(deceasedItem).not.toBeNull()
    expect(deceasedItem!.textContent).toContain('旺财')
  })

  it('shows pet name', () => {
    const { getByText } = render(<PetSwitcher pets={pets} currentPetId="pet-1" onSwitch={vi.fn()} />)
    expect(getByText('旺财')).toBeDefined()
    expect(getByText('咪咪')).toBeDefined()
  })

  it('shows brand animal avatar for pets without custom avatar', () => {
    // 全站统一口径（2026-09-10）：没设过头像的宠物给「按品种匹配的品牌小动物头像」，
    // 不再退化成裸 emoji（否则档案页/首页只剩空圆，用户会判定为头像没显示）
    const { container, queryByText } = render(<PetSwitcher pets={pets} currentPetId="pet-1" onSwitch={vi.fn()} />)
    const imgs = container.querySelectorAll('.pet-switcher__avatar-img')
    expect(imgs.length).toBe(3)
    // 金毛 → dog-01-golden；咪咪（中华田园猫关键词未命中"金毛"等狗关键词，按猫兜底）→ cat-01-orange-tabby
    expect(imgs[0].getAttribute('src')).toContain('/uploads/avatars/home-style/dog/dog-01-golden.png')
    expect(imgs[1].getAttribute('src')).toContain('/uploads/avatars/home-style/cat/')
    expect(queryByText('🐕')).toBeNull()
    expect(queryByText('🐱')).toBeNull()
  })

  it('falls back to species emoji when the avatar image fails to load', () => {
    // 两级兜底：品牌头像也加载失败时仍不能让头像位空着
    const { container, getByText } = render(<PetSwitcher pets={pets} currentPetId="pet-1" onSwitch={vi.fn()} />)
    const imgs = container.querySelectorAll('.pet-switcher__avatar-img')
    fireEvent.error(imgs[0])
    expect(getByText('🐕')).toBeDefined()
  })

  it('shows image for pets with avatarPhotoUrl', () => {
    const petsWithAvatar = [
      makePet({ id: 'pet-1', name: '旺财', avatarPhotoUrl: 'https://example.com/dog.jpg' }),
    ]
    const { container } = render(<PetSwitcher pets={petsWithAvatar} currentPetId="pet-1" onSwitch={vi.fn()} />)
    const img = container.querySelector('.pet-switcher__avatar-img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('https://example.com/dog.jpg')
  })

  it('renders with empty pets array', () => {
    const { container } = render(<PetSwitcher pets={[]} currentPetId={null} onSwitch={vi.fn()} />)
    const items = container.querySelectorAll('.pet-switcher__item')
    expect(items.length).toBe(0)
  })
})
