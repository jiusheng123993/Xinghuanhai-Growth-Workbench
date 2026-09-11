/**
 * 隐私弹窗组件测试
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import PrivacyPopup from '../PrivacyPopup'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) => (
    <div className={className} style={style} onClick={onClick}>{children}</div>
  ),
  Text: ({ children, className, style, onClick }: any) => (
    <span className={className} style={style} onClick={onClick}>{children}</span>
  ),
  Input: ({ className, placeholder, value, onInput, maxlength }: any) => (
    <input className={className} placeholder={placeholder} value={value} onChange={(e: any) => onInput?.({ detail: { value: e.target.value } })} maxLength={maxlength} />
  ),
  Button: ({ children, className, onClick, disabled, loading, openType, onAgreePrivacyAuthorization }: any) => (
    <button
      className={className}
      onClick={onClick}
      disabled={disabled}
      data-loading={loading}
      data-opentype={openType}
      onClickCapture={(e: any) => {
        // 模拟微信 agreePrivacyAuthorization：点击同意按钮时若配置了该回调则触发它
        if (openType === 'agreePrivacyAuthorization' && onAgreePrivacyAuthorization) {
          e.stopPropagation()
          onAgreePrivacyAuthorization()
        }
      }}
    >
      {children}
    </button>
  ),
  Radio: ({ children, value, checked, color }: any) => (
    <label data-value={value} data-checked={checked} data-color={color}>{children}</label>
  ),
  RadioGroup: ({ children, onChange }: any) => (
    <div data-testid='radio-group' onChange={(e: any) => onChange?.({ detail: { value: 'privacy_concern' } })}>{children}</div>
  ),
}))

describe('PrivacyPopup', () => {
  it('returns null when visible is false', () => {
    const { container } = render(
      <PrivacyPopup visible={false} onAgree={vi.fn()} onReject={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders when visible is true', () => {
    const { container } = render(
      <PrivacyPopup visible onAgree={vi.fn()} onReject={vi.fn()} />
    )
    expect(container.querySelector('.privacy-popup')).not.toBeNull()
  })

  it('shows title 隐私保护提示', () => {
    const { getByText } = render(
      <PrivacyPopup visible onAgree={vi.fn()} onReject={vi.fn()} />
    )
    expect(getByText('隐私保护提示')).toBeDefined()
  })

  it('agree button calls onAgree', () => {
    const onAgree = vi.fn()
    const { getByText } = render(
      <PrivacyPopup visible onAgree={onAgree} onReject={vi.fn()} />
    )
    fireEvent.click(getByText('同意'))
    expect(onAgree).toHaveBeenCalledTimes(1)
  })

  it('reject button calls onReject', () => {
    const onReject = vi.fn()
    const { getByText } = render(
      <PrivacyPopup visible onAgree={vi.fn()} onReject={onReject} />
    )
    fireEvent.click(getByText('拒绝'))
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('shows privacy text with link', () => {
    const { getByText } = render(
      <PrivacyPopup visible onAgree={vi.fn()} onReject={vi.fn()} />
    )
    expect(getByText('《用户隐私保护指引》')).toBeDefined()
  })

  it('re-render with visible=false hides popup', () => {
    const { container, rerender } = render(
      <PrivacyPopup visible onAgree={vi.fn()} onReject={vi.fn()} />
    )
    expect(container.querySelector('.privacy-popup')).not.toBeNull()
    rerender(<PrivacyPopup visible={false} onAgree={vi.fn()} onReject={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders overlay element', () => {
    const { container } = render(
      <PrivacyPopup visible onAgree={vi.fn()} onReject={vi.fn()} />
    )
    expect(container.querySelector('.privacy-popup__overlay')).not.toBeNull()
  })
})
