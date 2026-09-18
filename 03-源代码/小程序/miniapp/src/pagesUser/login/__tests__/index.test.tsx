/**
 * 登录页新增的「登录 → 新手引导」链路回归测试（2026-09-12 本批）
 *
 * 【为什么要测】2026-09-12 复核确认：引导页重做完成后**全仓没有任何导航指向它**，
 * 登录两处成功分支都是直接 `reLaunch('/pages/index/index')`，三屏用户永远看不到。
 * 本批把两处改成走 `utils/onboardingGate.goAfterAuthEntry()`，本文件钉死两条：
 *   ① 首次用户（没有 onboarding_completed 标记）→ 登录成功后进引导页；
 *   ② **老用户（已有标记）→ 仍然 reLaunch 首页，绝不被重新引导一遍**（硬约束，防回退）。
 * 另外钉住"资料不全先补资料"的既有分支：needBind 时仍 navigateTo 绑定页
 * （引导不会抢在补资料之前，也不会被这条分支吃掉）。
 *
 * 【为什么本文件自带 Taro mock】页面要渲染 PageBackground → useThemeClass →
 * `useDidShow`/`eventCenter`，全局 setup.ts 的 mock 没有覆盖到这些细节，
 * 这里给一份更完整可控的（路由 API 均返回 Promise，与 Taro 实际契约一致）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createElement } from 'react'

// ── 可变 mock 状态（vi.mock 工厂会被提升，必须用 vi.hoisted 暴露）──
const mocks = vi.hoisted(() => {
  const user = { id: 'user_1', nickname: '', avatar: '' } as {
    id: string
    nickname: string
    avatar: string
  }
  return {
    user,
    /** 登录成功的两个动作（用 vi.fn 便于断言被调用） */
    login: vi.fn().mockResolvedValue(undefined),
    loginByPhone: vi.fn().mockResolvedValue(undefined),
    /** 存储：模拟"没有看过新手引导"（getStorageSync 无值返回空串） */
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
  }
})

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
  // useThemeClass（经 PageBackground）会调用该生命周期 hook，缺失会直接抛错
  useDidShow: vi.fn(),
  useShareAppMessage: vi.fn(),
  useShareTimeline: vi.fn(),
}))

// 登录动作由 store 提供：既当 hook 用（取 login/loginByPhone），也用静态 getState() 读最新 user
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: any) => selector({ login: mocks.login, loginByPhone: mocks.loginByPhone }),
    { getState: () => ({ user: mocks.user }) }
  ),
}))

// 平台判定：让登录页走微信登录分支（微信端 isWeapp=true 时的界面）
vi.mock('../../../platform', () => ({
  isWeapp: () => true,
  isApp: () => false,
  sendSmsCode: vi.fn().mockResolvedValue({ success: true }),
  API_BASE_URL: 'https://api.example.com',
}))

import Login from '../index'

/** 勾选协议（登录的前置条件，不勾会直接 error 不进入登录动作） */
function agreeTerms() {
  const check = document.querySelector('.auth-agree__check') as HTMLElement
  fireEvent.click(check)
}

/** 让所有待处理 Promise 结算（登录动作 → state 更新 → 出口导航） */
async function flush() {
  await waitFor(() => {
    expect(mocks.login.mock.calls.length + mocks.loginByPhone.mock.calls.length).toBeGreaterThan(0)
  })
  await waitFor(() => {
    const calls =
      mocks.taro.redirectTo.mock.calls.length +
      mocks.taro.reLaunch.mock.calls.length +
      mocks.taro.navigateTo.mock.calls.length
    expect(calls).toBeGreaterThan(0)
  })
}

describe('登录页 → 新手引导链路（goAfterAuthEntry）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 清掉 storage 里的所有标记（每个用例从"全新用户"开始）
    Object.keys(mocks.storage).forEach((k) => delete mocks.storage[k])
    mocks.user.nickname = ''
    mocks.user.avatar = ''
  })

  it('微信登录成功 + 资料未完善 → 仍先跳绑定资料页（既有分支不被引导抢走）', async () => {
    render(<Login />)
    agreeTerms()
    fireEvent.click(screen.getByText('微信一键登录'))
    await flush()

    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesUser/bind-wechat/index' })
    // 补资料之前不该同时把用户推进引导页或首页（一次点击只发生一次导航）
    expect(mocks.taro.redirectTo).not.toHaveBeenCalled()
    expect(mocks.taro.reLaunch).not.toHaveBeenCalled()
  })

  it('微信登录成功 + 资料已完善 + 未看过引导 → redirectTo 进新手引导页', async () => {
    mocks.user.nickname = '铲屎官小王'
    mocks.user.avatar = 'https://cdn.example.com/a.png'

    render(<Login />)
    agreeTerms()
    fireEvent.click(screen.getByText('微信一键登录'))
    await flush()

    expect(mocks.taro.redirectTo).toHaveBeenCalledWith({ url: '/pagesUser/onboarding/index' })
    expect(mocks.taro.reLaunch).not.toHaveBeenCalled()
  })

  it('★ 老用户（已有 onboarding_completed 标记）微信登录 → 仍 reLaunch 首页，不被重新引导', async () => {
    mocks.user.nickname = '铲屎官小王'
    mocks.user.avatar = 'https://cdn.example.com/a.png'
    mocks.storage['onboarding_completed'] = 'true'

    render(<Login />)
    agreeTerms()
    fireEvent.click(screen.getByText('微信一键登录'))
    await flush()

    expect(mocks.taro.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
    // 老用户路径上不允许出现任何进引导页的导航
    expect(mocks.taro.redirectTo).not.toHaveBeenCalled()
  })
})
