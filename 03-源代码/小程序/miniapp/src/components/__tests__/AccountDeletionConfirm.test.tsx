/**
 * 账号注销确认组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { AccountDeletionConfirm } from '../AccountDeletionConfirm'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style }: any) => (
    <span className={className} style={style}>{children}</span>
  ),
  Input: ({ className, placeholder, value, onInput, maxlength }: any) => (
    <input className={className} placeholder={placeholder} value={value} onChange={(e: any) => onInput?.({ detail: { value: e.target.value } })} maxLength={maxlength} />
  ),
  Button: ({ children, className, onClick, disabled, loading }: any) => (
    <button className={className} onClick={onClick} disabled={disabled} data-loading={loading}>{children}</button>
  ),
  Radio: ({ children, value, checked, color }: any) => (
    <label data-value={value} data-checked={checked} data-color={color}>{children}</label>
  ),
  RadioGroup: ({ children, onChange }: any) => (
    <div data-testid='radio-group' onClick={() => onChange?.({ detail: { value: 'other' } })}>{children}</div>
  ),
}))

vi.mock('../types/dataPrivacyTypes', () => ({}))

describe('AccountDeletionConfirm', () => {
  const defaultProps = {
    confirmCode: 'ABC123',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    loading: false,
  }

  it('renders warning title 账号注销确认', () => {
    const { getByText } = render(<AccountDeletionConfirm {...defaultProps} />)
    expect(getByText('账号注销确认')).toBeDefined()
  })

  it('renders reason options', () => {
    const { getByText } = render(<AccountDeletionConfirm {...defaultProps} />)
    expect(getByText('不再需要')).toBeDefined()
    expect(getByText('隐私顾虑')).toBeDefined()
    expect(getByText('找到更好的替代品')).toBeDefined()
    expect(getByText('使用太复杂')).toBeDefined()
    expect(getByText('其他原因')).toBeDefined()
  })

  it('cancel button calls onCancel', () => {
    const onCancel = vi.fn()
    const { getByText } = render(<AccountDeletionConfirm {...defaultProps} onCancel={onCancel} />)
    fireEvent.click(getByText('取消'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('confirm button is disabled when inputCode does not match confirmCode', () => {
    const { getByText } = render(<AccountDeletionConfirm {...defaultProps} />)
    const confirmBtn = getByText('确认注销').closest('button')!
    expect(confirmBtn.disabled).toBe(true)
  })

  it('confirm button is disabled when loading is true', () => {
    const { getByText } = render(<AccountDeletionConfirm {...defaultProps} loading />)
    const confirmBtn = getByText('确认注销').closest('button')!
    expect(confirmBtn.disabled).toBe(true)
  })

  it('confirm button calls onConfirm when code matches', () => {
    const onConfirm = vi.fn()
    const { getByText, getByPlaceholderText } = render(
      <AccountDeletionConfirm {...defaultProps} onConfirm={onConfirm} />
    )
    const codeInput = getByPlaceholderText('输入确认码')
    fireEvent.change(codeInput, { target: { value: 'ABC123' } })
    fireEvent.click(getByText('确认注销'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('no_longer_needed', '', 'ABC123')
  })

  it('shows custom reason input when reason is other', () => {
    const { getByTestId, getByPlaceholderText } = render(
      <AccountDeletionConfirm {...defaultProps} />
    )
    const radioGroup = getByTestId('radio-group')
    fireEvent.click(radioGroup)
    expect(getByPlaceholderText('请说明注销原因')).toBeDefined()
  })

  it('does not show custom reason input for default reason', () => {
    const { queryByPlaceholderText } = render(
      <AccountDeletionConfirm {...defaultProps} />
    )
    expect(queryByPlaceholderText('请说明注销原因')).toBeNull()
  })

  it('shows confirm code display', () => {
    const { getByText } = render(<AccountDeletionConfirm {...defaultProps} />)
    expect(getByText('ABC123')).toBeDefined()
  })

  it('shows code input field', () => {
    const { getByPlaceholderText } = render(
      <AccountDeletionConfirm {...defaultProps} />
    )
    expect(getByPlaceholderText('输入确认码')).toBeDefined()
  })

  it('loading state shows on confirm button', () => {
    const { getByText } = render(
      <AccountDeletionConfirm {...defaultProps} loading />
    )
    const confirmBtn = getByText('确认注销').closest('button')!
    expect(confirmBtn.dataset.loading).toBe('true')
  })

  it('confirm button does not call onConfirm when code does not match', () => {
    const onConfirm = vi.fn()
    const { getByText, getByPlaceholderText } = render(
      <AccountDeletionConfirm {...defaultProps} onConfirm={onConfirm} />
    )
    const codeInput = getByPlaceholderText('输入确认码')
    fireEvent.change(codeInput, { target: { value: 'WRONG' } })
    fireEvent.click(getByText('确认注销'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cancel button is disabled when loading', () => {
    const { getByText } = render(
      <AccountDeletionConfirm {...defaultProps} loading />
    )
    const cancelBtn = getByText('取消').closest('button')!
    expect(cancelBtn.disabled).toBe(true)
  })
})
