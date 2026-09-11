/**
 * authStore 测试
 * 验证登录、登出和用户信息获取等认证流程
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useAuthStore } from '../stores/authStore'

const {
  mockApiLogin,
  mockApiGetUser,
  mockStorageGetToken,
  mockStorageGetUser,
  mockStorageSetToken,
  mockStorageSetRefreshToken,
  mockStorageSetUser,
  mockStorageClear,
  mockTaroClearStorageSync,
} = vi.hoisted(() => ({
  mockApiLogin: vi.fn(),
  mockApiGetUser: vi.fn(),
  mockStorageGetToken: vi.fn(),
  mockStorageGetUser: vi.fn(),
  mockStorageSetToken: vi.fn(),
  mockStorageSetRefreshToken: vi.fn(),
  mockStorageSetUser: vi.fn(),
  mockStorageClear: vi.fn(),
  mockTaroClearStorageSync: vi.fn(),
}))

vi.mock('../services/api', () => ({
  api: {
    login: mockApiLogin,
    getUser: mockApiGetUser,
  },
}))

vi.mock('../utils/storage', () => ({
  storage: {
    getToken: mockStorageGetToken,
    getUser: mockStorageGetUser,
    setToken: mockStorageSetToken,
    setRefreshToken: mockStorageSetRefreshToken,
    setUser: mockStorageSetUser,
    clear: mockStorageClear,
  },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getEnv: vi.fn(() => 'WEAPP'),
    login: vi.fn(() => ({ code: 'mock-code' })),
    getStorageSync: vi.fn(() => null),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    clearStorageSync: mockTaroClearStorageSync,
  },
}))

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStorageGetToken.mockReturnValue(null)
    mockStorageGetUser.mockReturnValue(null)
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
    })
  })

  it('初始状态为未登录', () => {
    const state = useAuthStore.getState()
    expect(state.token).toBeNull()
    expect(state.user).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.isLoading).toBe(false)
  })

  it('login 成功时更新用户状态', async () => {
    const mockUser = {
      id: 'user1',
      openid: 'openid1',
      nickname: '测试用户',
      avatar: 'https://example.com/avatar.png',
      createdAt: '2026-07-20T00:00:00Z',
    }
    mockApiLogin.mockResolvedValue({
      token: 'mock_token',
      refreshToken: 'mock_refresh_token',
      user: mockUser,
    })

    await useAuthStore.getState().login()

    const state = useAuthStore.getState()
    expect(state.user).toEqual(mockUser)
    expect(state.token).toBe('mock_token')
    expect(state.isAuthenticated).toBe(true)
    expect(state.isLoading).toBe(false)
    expect(mockStorageSetToken).toHaveBeenCalledWith('mock_token')
    expect(mockStorageSetRefreshToken).toHaveBeenCalledWith('mock_refresh_token')
    expect(mockStorageSetUser).toHaveBeenCalledWith(mockUser)
  })

  it('logout 清除用户状态', async () => {
    const mockUser = {
      id: 'user1',
      openid: 'openid1',
      nickname: '测试用户',
      avatar: 'https://example.com/avatar.png',
      createdAt: '2026-07-20T00:00:00Z',
    }
    useAuthStore.setState({
      token: 'mock_token',
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
    })

    await useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.token).toBeNull()
    expect(state.user).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.isLoading).toBe(false)
    expect(mockTaroClearStorageSync).toHaveBeenCalled()
  })

  it('getUserInfo 返回用户信息', async () => {
    const mockUser = {
      id: 'user1',
      openid: 'openid1',
      nickname: '测试用户',
      avatar: 'https://example.com/avatar.png',
      createdAt: '2026-07-20T00:00:00Z',
    }
    mockApiLogin.mockResolvedValue({
      token: 'mock_token',
      refreshToken: 'mock_refresh_token',
      user: mockUser,
    })

    await useAuthStore.getState().login()

    const userInfo = useAuthStore.getState().user
    expect(userInfo).toEqual(mockUser)
    expect(userInfo?.id).toBe('user1')
    expect(userInfo?.nickname).toBe('测试用户')
  })

  it('未登录时 getUserInfo 返回 null', () => {
    const userInfo = useAuthStore.getState().user
    expect(userInfo).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})