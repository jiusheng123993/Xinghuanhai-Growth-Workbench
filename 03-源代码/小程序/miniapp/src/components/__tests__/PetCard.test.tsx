/**
 * 宠物卡片组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import PetCard from '../PetCard'
import type { PetProfile } from '../../services/petService'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick, onLongPress }: any) => (
    <div className={className} style={style} onClick={onClick} onContextMenu={onLongPress}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
  Image: ({ src, className, mode, lazyLoad }: any) => (
    <img src={src} className={className} data-mode={mode} data-lazyLoad={lazyLoad} />
  ),
  Picker: ({ children, mode, value, onChange }: any) => (
    <div data-mode={mode} data-value={value} onClick={() => onChange?.({ detail: { value: '2026-01-15' } })}>{children}</div>
  ),
  ScrollView: ({ children, className, scrollX }: any) => (
    <div className={className} data-scrollX={scrollX}>{children}</div>
  ),
}))

vi.mock('./PetCard.scss', () => ({}))

const basePet: PetProfile = {
  id: 'pet-1',
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
}

describe('PetCard', () => {
  it('renders pet name', () => {
    const { getByText } = render(<PetCard pet={basePet} />)
    expect(getByText('旺财')).toBeDefined()
  })

  it('renders breed', () => {
    const { getByText } = render(<PetCard pet={basePet} />)
    expect(getByText('金毛')).toBeDefined()
  })

  it('shows dog emoji for dog species without avatar', () => {
    const { getByText } = render(<PetCard pet={basePet} />)
    expect(getByText('🐕')).toBeDefined()
  })

  it('shows cat emoji for cat species without avatar', () => {
    const catPet = { ...basePet, species: 'cat' as const, name: '咪咪', breed: '英短' }
    const { getByText } = render(<PetCard pet={catPet} />)
    expect(getByText('🐱')).toBeDefined()
  })

  it('shows image when avatarPhotoUrl provided', () => {
    const petWithAvatar = { ...basePet, avatarPhotoUrl: 'https://example.com/avatar.jpg' }
    const { container } = render(<PetCard pet={petWithAvatar} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('https://example.com/avatar.jpg')
  })

  it('shows male gender icon for male', () => {
    const { getByText } = render(<PetCard pet={basePet} />)
    expect(getByText('♂️')).toBeDefined()
  })

  it('shows female gender icon for female', () => {
    const femalePet = { ...basePet, gender: 'female' as const }
    const { getByText } = render(<PetCard pet={femalePet} />)
    expect(getByText('♀️')).toBeDefined()
  })

  it('shows current tag when isCurrent=true', () => {
    const { getByText } = render(<PetCard pet={basePet} isCurrent />)
    expect(getByText('当前')).toBeDefined()
  })

  it('does not show current tag when isCurrent=false', () => {
    const { queryByText } = render(<PetCard pet={basePet} isCurrent={false} />)
    expect(queryByText('当前')).toBeNull()
  })

  it('shows deceased tag when isDeceased=true', () => {
    const deceasedPet = { ...basePet, isDeceased: true }
    const { getByText } = render(<PetCard pet={deceasedPet} />)
    expect(getByText('已离世')).toBeDefined()
  })

  it('click calls onClick with pet', () => {
    const onClick = vi.fn()
    const { container } = render(<PetCard pet={basePet} onClick={onClick} />)
    const card = container.querySelector('.pet-card')
    fireEvent.click(card!)
    expect(onClick).toHaveBeenCalledWith(basePet)
  })

  it('long press calls onLongPress with pet', () => {
    const onLongPress = vi.fn()
    const { container } = render(<PetCard pet={basePet} onLongPress={onLongPress} />)
    const card = container.querySelector('.pet-card')
    fireEvent.contextMenu(card!)
    expect(onLongPress).toHaveBeenCalledWith(basePet)
  })

  it('renders age and weight in detail text', () => {
    const { getByText } = render(<PetCard pet={basePet} />)
    expect(getByText(/25kg/)).toBeDefined()
  })

  it('applies deceased class when isDeceased=true', () => {
    const deceasedPet = { ...basePet, isDeceased: true }
    const { container } = render(<PetCard pet={deceasedPet} />)
    const card = container.querySelector('.pet-card--deceased')
    expect(card).not.toBeNull()
  })

  it('applies current class when isCurrent=true', () => {
    const { container } = render(<PetCard pet={basePet} isCurrent />)
    const card = container.querySelector('.pet-card--current')
    expect(card).not.toBeNull()
  })
})
