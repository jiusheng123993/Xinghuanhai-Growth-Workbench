/**
 * 登录页（手机号/短信分支）→ 新手引导链路回归测试（2026-09-12 本批）
 *
 * 【为什么要单独一个文件】登录页的手机号登录入口只在**非微信端**渲染
 * （`isWechatOnly` 为 true 时整块隐藏，微信端只留微信一键登录），
 * 而"新用户看到引导 / 老用户不被重新引导"这两条在短信登录分支上同样要钉住：
 * 短信登录没有"补微信资料"这一步，登录成功后会**直接**走统一出口
 * `utils/onboardingGate.goAfterAuthEntry()`。
 *
 * 【为什么 isWeapp 返回 false】这不是"假装在小程序里"：短信登录本身是小程序里
 * 不存在的入口，它的出口逻辑与端无关，本文件只针对出口分流做验证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createElement } from 'react'

const mocks = vi.hoisted(() => ({
  loginByPhone: vi.fn().mockResolvedValue(undefined),
  storage: {} as Record<string, unknown>,
  taro: {
    navigateTo: vi.fn().mockResolvedValue({ errMsg: 'navigateTo:ok' }),
    redirectTo: vi.fn().mockResolvedValue({ errMsg: 'redirectTo:ok' }),
    reLaunch: vi.fn().mockResolvedValue({ errMsg: 'reLaunch:ok' }),
    switchTab: vi.fn().mockResolvedValue({ errMsg: 'switchTab:ok' }),
    showToast: vi.fn(),
    showModal: vi.fn(),
    getStorageSync: vi.fn((key: string) => mocks.storage[key] ?? ''),
    setStorageSync: vi.fn((key: string, value: unknown) => {
      mocks.storage[key] = value
    }),
    getSystemInfoSync: vi.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
    setNavigationBarColor: vi.fn(() => ({ catch: vi.fn() })),
    setTabBarStyle: vi.fn(() => ({ catch: vi.fn() })),
    eventCenter: { on: vi.fn(), off: vi.fn(), trigger: vi.fn() },
  },
}))

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, onClick }: any) =>
    createElement('div', { className, style, onClick }, children),
  Text: ({ children, className, onClick }: any) =>
    createElement('span', { className, onClick }, children),
  Button: ({ children, className, onClick, disabled }: any) =>
    createElement('button', { className, onClick, disabled }, children),
  Input: ({ className, value, onInput, placeholder }: any) =>
    createElement('input', {
      className,
      value,
      placeholder,
      onChange: (e: any) => onInput?.({ detail: { value: e.target.value } }),
    }),
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
    (selector: any) =>
      selector({
        user: { id: 'user_1', nickname: '铲屎官小王', avatar: '' },
        login: vi.fn(),
        loginByPhone: mocks.loginByPhone,
      }),
    { getState: () => ({ user: { id: 'user_1', nickname: '', avatar: '' } }) }
  ),
}))

// 非微信端：手机号登录表单可见（isWechatOnly=false），loginMode 默认就是 'phone'
vi.mock('../../../platform', () => ({
  isWeapp: () => false,
  isApp: () => true,
  sendSmsCode: vi.fn().mockResolvedValue({ success: true }),
  API_BASE_URL: 'https://api.example.com',
}))

import Login from '../index'

/** 勾选协议（登录前置条件）+ 填手机号验证码 + 点登录 */
function submitPhoneLogin() {
  fireEvent.click(document.querySelector('.auth-agree__check') as HTMLElement)
  const inputs = document.querySelectorAll('input')
  fireEvent.change(inputs[0], { target: { value: '13800138000' } })
  fireEvent.change(inputs[1], { target: { value: '123456' } })
  fireEvent.click(screen.getByText('登录'))
}

/** 等登录动作与出口导航都发生 */
async function flush() {
  await waitFor(() => expect(mocks.loginByPhone).toHaveBeenCalled())
  await waitFor(() => {
    const calls = mocks.taro.redirectTo.mock.calls.length + mocks.taro.reLaunch.mock.calls.length
    expect(calls).toBeGreaterThan(0)
  })
}

describe('登录页短信分支 → 新手引导链路（goAfterAuthEntry）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mocks.storage).forEach((k) => delete mocks.storage[k])
  })

  it('新用户短信登录 → redirectTo 进新手引导页（短信登录没有补资料环节）', async () => {
    render(<Login />)
    submitPhoneLogin()
    await flush()

    expect(mocks.loginByPhone).toHaveBeenCalledWith('13800138000', '123456')
    expect(mocks.taro.redirectTo).toHaveBeenCalledWith({ url: '/pagesUser/onboarding/index' })
    expect(mocks.taro.reLaunch).not.toHaveBeenCalled()
  })

  it('★ 老用户（已有标记）短信登录 → 直接 reLaunch 首页，行为与改动前一致', async () => {
    mocks.storage['onboarding_completed'] = 'true'

    render(<Login />)
    submitPhoneLogin()
    await flush()

    expect(mocks.taro.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
    expect(mocks.taro.redirectTo).not.toHaveBeenCalled()
  })
})
