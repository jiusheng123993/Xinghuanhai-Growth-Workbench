/**
 * useAuth 测试
 * 验证用户认证 Hook 的登录、登出和状态管理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import Taro from '@tarojs/taro'
import { useAuthStore } from '../../stores/authStore'
import { useAuth } from '../useAuth'

const {
  mockInitialize,
  mockLogin,
  mockLogout,
} = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockLogin: vi.fn(),
  mockLogout: vi.fn(),
}))

vi.mock('react', () => {
  const useEffect = vi.fn()
  return {
    useEffect,
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(),
    useReducer: (reducer: any, initialState: any) => [initialState, vi.fn()],
    useState: (initial: any) => [initial, vi.fn()],
    useRef: (initial: any) => ({ current: initial }),
    default: { useEffect, useCallback: (fn: any) => fn, useMemo: (fn: any) => fn(), useReducer: (r: any, i: any) => [i, vi.fn()], useState: (i: any) => [i, vi.fn()], useRef: (i: any) => ({ current: i }) },
  }
})

vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn(),
}))

function makeStore(overrides: Record<string, any> = {}) {
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isInitialized: false,
    token: null,
    initialize: mockInitialize,
    login: mockLogin,
    logout: mockLogout,
    ...overrides,
  }
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInitialize.mockImplementation(() => Promise.resolve())
    mockLogin.mockImplementation(() => Promise.resolve())
    mockLogout.mockImplementation(() => Promise.resolve())
    vi.mocked(useAuthStore).mockReturnValue(makeStore() as any)
  })

  it('返回值包含所有预期字段', () => {
    const result = useAuth()
    expect(result).toHaveProperty('user')
    expect(result).toHaveProperty('isAuthenticated')
    expect(result).toHaveProperty('isLoading')
    expect(result).toHaveProperty('isInitialized')
    expect(result).toHaveProperty('login')
    expect(result).toHaveProperty('logout')
  })

  it('login 成功时返回 true 并显示成功提示和跳转', async () => {
    const result = useAuth()
    const success = await result.login()
    expect(mockLogin).toHaveBeenCalled()
    expect(success).toBe(true)
    expect(Taro.showToast).toHaveBeenCalledWith({ title: '登录成功', icon: 'success' })
    expect(Taro.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('login 抛出异常时返回 false 并提示重试', async () => {
    mockLogin.mockRejectedValue(new Error('login error'))
    const result = useAuth()
    const success = await result.login()
    expect(success).toBe(false)
    expect(Taro.showToast).toHaveBeenCalledWith({ title: '登录失败，请重试', icon: 'none' })
  })

  it('logout 成功时调用 store logout 并提示', async () => {
    const result = useAuth()
    await result.logout()
    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(Taro.showToast).toHaveBeenCalledWith({ title: '已退出登录', icon: 'success' })
  })

  it('logout 抛出异常时静默处理不提示', async () => {
    mockLogout.mockRejectedValue(new Error('logout error'))
    const result = useAuth()
    await result.logout()
    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(Taro.showToast).not.toHaveBeenCalled()
  })

  it('返回 store 中的 user 状态', () => {
    const mockUser = { id: '1', openid: 'o1', nickname: 'test', avatarUrl: 'url' }
    vi.mocked(useAuthStore).mockReturnValue(makeStore({ user: mockUser }) as any)
    const result = useAuth()
    expect(result.user).toEqual(mockUser)
  })

  it('返回 store 中的 isAuthenticated 状态', () => {
    vi.mocked(useAuthStore).mockReturnValue(makeStore({ isAuthenticated: true }) as any)
    const result = useAuth()
    expect(result.isAuthenticated).toBe(true)
  })

  it('返回 store 中的 isLoading 状态', () => {
    vi.mocked(useAuthStore).mockReturnValue(makeStore({ isLoading: true }) as any)
    const result = useAuth()
    expect(result.isLoading).toBe(true)
  })

  it('返回 store 中的 isInitialized 状态', () => {
    vi.mocked(useAuthStore).mockReturnValue(makeStore({ isInitialized: true }) as any)
    const result = useAuth()
    expect(result.isInitialized).toBe(true)
  })
})