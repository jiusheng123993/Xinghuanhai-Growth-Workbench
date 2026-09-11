/**
 * 宠物离世标记弹窗组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import PetDeceasedModal from '../PetDeceasedModal'

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

vi.mock('../PetDeceasedModal.scss', () => ({}))

describe('PetDeceasedModal', () => {
  const defaultProps = {
    visible: true,
    petName: '旺财',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('returns null when visible=false', () => {
    const { container } = render(<PetDeceasedModal {...defaultProps} visible={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders when visible=true', () => {
    const { container } = render(<PetDeceasedModal {...defaultProps} />)
    const overlay = container.querySelector('.deceased-modal__overlay')
    expect(overlay).not.toBeNull()
  })

  it('shows petName in title', () => {
    const { getByText } = render(<PetDeceasedModal {...defaultProps} />)
    expect(getByText(/旺财/)).toBeDefined()
  })

  it('overlay click calls onCancel', () => {
    const onCancel = vi.fn()
    const { container } = render(<PetDeceasedModal {...defaultProps} onCancel={onCancel} />)
    const overlay = container.querySelector('.deceased-modal__overlay')
    fireEvent.click(overlay!)
    expect(onCancel).toHaveBeenCalled()
  })

  it('cancel button calls onCancel', () => {
    const onCancel = vi.fn()
    const { getByText } = render(<PetDeceasedModal {...defaultProps} onCancel={onCancel} />)
    fireEvent.click(getByText('取消'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('confirm button calls onConfirm with selectedDate', () => {
    const onConfirm = vi.fn()
    const { getByText } = render(<PetDeceasedModal {...defaultProps} onConfirm={onConfirm} />)
    fireEvent.click(getByText('确认标记'))
    expect(onConfirm).toHaveBeenCalled()
    expect(typeof onConfirm.mock.calls[0][0]).toBe('string')
  })

  it('shows date picker', () => {
    const { container } = render(<PetDeceasedModal {...defaultProps} />)
    const picker = container.querySelector('[data-mode="date"]')
    expect(picker).not.toBeNull()
  })

  it('shows hint text about irreversibility', () => {
    const { getByText } = render(<PetDeceasedModal {...defaultProps} />)
    expect(getByText('此操作不可撤销，请确认')).toBeDefined()
  })

  it('re-render with visible=false hides modal', () => {
    const { container, rerender } = render(<PetDeceasedModal {...defaultProps} visible />)
    expect(container.querySelector('.deceased-modal__overlay')).not.toBeNull()
    rerender(<PetDeceasedModal {...defaultProps} visible={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('date picker onChange updates selectedDate', () => {
    const onConfirm = vi.fn()
    const { container, getByText } = render(<PetDeceasedModal {...defaultProps} onConfirm={onConfirm} />)
    const picker = container.querySelector('[data-mode="date"]')
    fireEvent.click(picker!)
    fireEvent.click(getByText('确认标记'))
    expect(onConfirm).toHaveBeenCalledWith('2026-01-15')
  })

  it('modal content click does not propagate to overlay', () => {
    const onCancel = vi.fn()
    const { container } = render(<PetDeceasedModal {...defaultProps} onCancel={onCancel} />)
    const modal = container.querySelector('.deceased-modal')
    fireEvent.click(modal!)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('shows label for date field', () => {
    const { getByText } = render(<PetDeceasedModal {...defaultProps} />)
    expect(getByText('离世日期')).toBeDefined()
  })
})
