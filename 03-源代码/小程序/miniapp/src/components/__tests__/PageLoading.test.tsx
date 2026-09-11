/**
 * 页面加载组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

import PageLoading from '../PageLoading'

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

describe('PageLoading', () => {
  it('renders default text 加载中...', () => {
    const { getByText } = render(<PageLoading />)
    expect(getByText('加载中...')).toBeDefined()
  })

  it('renders custom text when provided', () => {
    const { getByText } = render(<PageLoading text='请稍候' />)
    expect(getByText('请稍候')).toBeDefined()
  })

  it('renders spinner element', () => {
    const { container } = render(<PageLoading />)
    expect(container.querySelector('.page-loading__spinner')).not.toBeNull()
  })

  it('renders with page-loading container class', () => {
    const { container } = render(<PageLoading />)
    expect(container.querySelector('.page-loading')).not.toBeNull()
  })

  it('does not render default text when custom text is provided', () => {
    const { queryByText } = render(<PageLoading text='自定义' />)
    expect(queryByText('加载中...')).toBeNull()
  })
})
