/**
 * 页面错误组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import PageError from '../PageError'

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
    <div data-testid='radio-group' onChange={(e: any) => onChange?.({ detail: { value: 'privacy_concern' } })}>{children}</div>
  ),
}))

describe('PageError', () => {
  it('renders message text', () => {
    const { getByText } = render(<PageError message='出错了' />)
    expect(getByText('出错了')).toBeDefined()
  })

  it('shows warning icon', () => {
    const { getByText } = render(<PageError message='出错了' />)
    expect(getByText('⚠️')).toBeDefined()
  })

  it('shows retry button when onRetry is provided', () => {
    const { getByText } = render(<PageError message='出错了' onRetry={vi.fn()} />)
    expect(getByText('重试')).toBeDefined()
  })

  it('does not show retry button when onRetry is not provided', () => {
    const { queryByText } = render(<PageError message='出错了' />)
    expect(queryByText('重试')).toBeNull()
  })

  it('retry button click calls onRetry', () => {
    const onRetry = vi.fn()
    const { getByText } = render(<PageError message='出错了' onRetry={onRetry} />)
    fireEvent.click(getByText('重试'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders with page-error container class', () => {
    const { container } = render(<PageError message='出错了' />)
    expect(container.querySelector('.page-error')).not.toBeNull()
  })
})
