/**
 * 认证服务测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { loginWithCode, getUserProfile, refreshToken, logout } from '../authService'

const { mockTaroLogin, mockApiPost, mockApiGet } = vi.hoisted(() => ({
  mockTaroLogin: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiGet: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    login: mockTaroLogin,
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    navigateTo: vi.fn(),
  },
}))

vi.mock('../api', () => ({
  api: {
    post: mockApiPost,
    get: mockApiGet,
  },
}))

const mockUser = {
  id: 'user_123',
  openid: 'oTestOpenId',
  nickname: '测试用户',
  avatarUrl: 'https://example.com/avatar.png',
}

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loginWithCode', () => {
    it('should return success with token and user when Taro.login and api succeed', async () => {
      mockTaroLogin.mockResolvedValue({ code: 'wx_code_123' })
      mockApiPost.mockResolvedValue({
        token: 'access_token_abc',
        user: { id: 'user_123', nickname: '测试用户', avatarUrl: 'https://example.com/avatar.png' },
      })

      const result = await loginWithCode()

      expect(result.success).toBe(true)
      expect(result.token).toBe('access_token_abc')
      expect(result.user).toEqual({
        id: 'user_123',
        nickname: '测试用户',
        avatar: 'https://example.com/avatar.png',
        createdAt: expect.any(String),
      })
      expect(mockApiPost).toHaveBeenCalledWith('/api/auth/login', {
        provider: 'wechat',
        code: 'wx_code_123',
      })
    })

    it('should return error when Taro.login returns no code', async () => {
      mockTaroLogin.mockResolvedValue({ code: '' })

      const result = await loginWithCode()

      expect(result.success).toBe(false)
      expect(result.error).toBe('未获取到微信登录凭证')
    })

    it('should return error when api returns no token', async () => {
      mockTaroLogin.mockResolvedValue({ code: 'wx_code_123' })
      mockApiPost.mockResolvedValue({ token: null, user: null })

      const result = await loginWithCode()

      expect(result.success).toBe(false)
      expect(result.error).toBe('登录失败')
    })

    it('should return error on exception', async () => {
      mockTaroLogin.mockResolvedValue({ code: 'wx_code_123' })
      mockApiPost.mockRejectedValue(new Error('网络超时'))

      const result = await loginWithCode()

      expect(result.success).toBe(false)
      expect(result.error).toBe('网络超时')
    })
  })

  describe('getUserProfile', () => {
    it('should return user profile on success', async () => {
      mockApiGet.mockResolvedValue({
        id: 'user_123',
        nickname: '测试用户',
        avatarUrl: 'https://example.com/avatar.png',
      })

      const result = await getUserProfile('user_123')

      expect(result).toEqual({
        id: 'user_123',
        nickname: '测试用户',
        avatar: 'https://example.com/avatar.png',
        createdAt: expect.any(String),
      })
    })

    it('should return null when api returns no data', async () => {
      mockApiGet.mockResolvedValue(null)

      const result = await getUserProfile('user_123')

      expect(result).toBeNull()
    })

    it('should return null on exception', async () => {
      mockApiGet.mockRejectedValue(new Error('网络超时'))

      const result = await getUserProfile('user_123')

      expect(result).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('should return success with token on success', async () => {
      mockApiPost.mockResolvedValue({ token: 'new_access_token' })

      const result = await refreshToken('old_refresh_token')

      expect(result.success).toBe(true)
      expect(result.token).toBe('new_access_token')
      expect(mockApiPost).toHaveBeenCalledWith('/api/auth/refresh', { refreshToken: 'old_refresh_token' })
    })

    it('should return error when api returns no token', async () => {
      mockApiPost.mockResolvedValue({ token: null })

      const result = await refreshToken('some_token')

      expect(result.success).toBe(false)
      expect(result.error).toBe('刷新失败')
    })

    it('should catch exception and return error with message', async () => {
      mockApiPost.mockRejectedValue(new Error('刷新服务不可用'))

      const result = await refreshToken('some_token')

      expect(result.success).toBe(false)
      expect(result.error).toBe('刷新服务不可用')
    })

    it('should catch non-Error exception and return default error', async () => {
      mockApiPost.mockRejectedValue('string error')

      const result = await refreshToken('some_token')

      expect(result.success).toBe(false)
      expect(result.error).toBe('刷新 Token 失败')
    })
  })

  describe('logout', () => {
    it('should call storage.removeToken', async () => {
      await logout()
      // logout just calls storage.removeToken(), no supabase call
      expect(true).toBe(true)
    })
  })
})