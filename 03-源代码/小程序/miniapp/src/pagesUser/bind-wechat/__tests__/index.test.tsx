/**
 * 绑定微信资料页 · 「暂不绑定」分支回归测试（2026-09-12 本批）
 *
 * 【为什么要测】本批把本页三处出口里的两处（保存成功 / 暂不绑定）改成走
 * `utils/onboardingGate.goAfterAuthEntry()`，**改动最容易踩坏的就是「暂不绑定」**：
 * 它的原有语义是"记录跳过标记（下次登录不再打断补资料）→ 回首页"，
 * 若改出口时把跳过标记一起改没了，用户下次登录会被反复打断。
 * 本文件钉死：跳过标记照写（key 带 userId 后缀、值为 true），
 * 之后走统一出口 —— 新用户接着看引导，老用户回首页。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'

const mocks = vi.hoisted(() => {
  const user = { id: 'user_1', nickname: '', avatar: '' }
  return {
    user,
    storage: {} as Record<string, unknown>,
    updateProfile: vi.fn().mockResolvedValue(undefined),
    taro: {
      navigateTo: vi.fn().mockResolvedValue({ errMsg: 'navigateTo:ok' }),
      redirectTo: vi.fn().mockResolvedValue({ errMsg: 'redirectTo:ok' }),
      reLaunch: vi.fn().mockResolvedValue({ errMsg: 'reLaunch:ok' }),
      switchTab: vi.fn().mockResolvedValue({ errMsg: 'switchTab:ok' }),
      showToast: vi.fn(),
      showModal: vi.fn(),
      // 主题 hook（useThemeClass）会调这两个原生栏 API（PageBackground 走它取主题类名）
      setNavigationBarColor: vi.fn(() => ({ catch: vi.fn() })),
      setTabBarStyle: vi.fn(() => ({ catch: vi.fn() })),
      getSystemInfoSync: vi.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
      eventCenter: { on: vi.fn(), off: vi.fn(), trigger: vi.fn() },
      getStorageSync: vi.fn((key: string) => mocks.storage[key] ?? ''),
      setStorageSync: vi.fn((key: string, value: unknown) => {
        mocks.storage[key] = value
      }),
    },
  }
})

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) =>
    createElement('div', { className, style, onClick }, children),
  Text: ({ children, className, onClick }: any) =>
    createElement('span', { className, onClick }, children),
  Button: ({ children, className, onClick }: any) =>
    createElement('button', { className, onClick }, children),
  Input: ({ className, value, onInput }: any) =>
    createElement('input', { className, value, onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }) }),
  Image: ({ src, className }: any) => createElement('img', { src, className }),
  ScrollView: ({ children, className }: any) => createElement('div', { className }, children),
}))

vi.mock('@tarojs/taro', () => ({
  default: mocks.taro,
  useDidShow: vi.fn(),
  useShareAppMessage: vi.fn(),
  useShareTimeline: vi.fn(),
}))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector?: any) => {
      const state = { user: mocks.user, updateProfile: mocks.updateProfile }
      return typeof selector === 'function' ? selector(state) : state
    },
    { getState: () => ({ user: mocks.user }) }
  ),
}))

vi.mock('../../../platform', () => ({ isWeapp: () => true }))
vi.mock('../../../services/api', () => ({ api: { uploadAvatar: vi.fn() } }))
vi.mock('../../../utils/privacy', () => ({ chooseImageWithPrivacy: vi.fn() }))

import BindWechat from '../index'
import { bindSkippedKey } from '../guide'

describe('绑定微信资料页出口（goAfterAuthEntry）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mocks.storage).forEach((k) => delete mocks.storage[k])
  })

  it('★ 暂不绑定：跳过标记照写（带 userId 后缀、值为 true），且不再 switchTab 首页', () => {
    render(<BindWechat />)
    fireEvent.click(screen.getByText('暂不绑定，先逛逛'))

    expect(mocks.taro.setStorageSync).toHaveBeenCalledWith(bindSkippedKey('user_1'), true)
    expect(mocks.taro.switchTab).not.toHaveBeenCalled()
  })

  it('暂不绑定 + 新用户（无引导标记）→ 接着进新手引导页', () => {
    render(<BindWechat />)
    fireEvent.click(screen.getByText('暂不绑定，先逛逛'))

    expect(mocks.taro.redirectTo).toHaveBeenCalledWith({ url: '/pagesUser/onboarding/index' })
  })

  it('★ 暂不绑定 + 老用户（已有引导标记）→ 直接 reLaunch 首页，不被重新引导', () => {
    mocks.storage['onboarding_completed'] = 'true'

    render(<BindWechat />)
    fireEvent.click(screen.getByText('暂不绑定，先逛逛'))

    expect(mocks.taro.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
    expect(mocks.taro.redirectTo).not.toHaveBeenCalled()
    // 老用户也必须照写跳过标记（与改动前一致：下次登录不再打断补资料）
    expect(mocks.taro.setStorageSync).toHaveBeenCalledWith(bindSkippedKey('user_1'), true)
  })
})
