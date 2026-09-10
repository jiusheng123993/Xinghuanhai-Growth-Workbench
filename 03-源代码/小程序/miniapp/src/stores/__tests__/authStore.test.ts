/**
 * 认证状态管理 - 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockApi, mockStorage, mockIsTokenFormatValid, mockIsWeapp } = vi.hoisted(() => {
  return {
    mockApi: {
      login: vi.fn(),
      getUser: vi.fn(),
    },
    mockStorage: {
      getToken: vi.fn(),
      getUser: vi.fn(),
      setToken: vi.fn(),
      setRefreshToken: vi.fn(),
      setUser: vi.fn(),
      clear: vi.fn(),
    },
    // JWT 本地过期校验（2026-09-09 启动拦截用）：默认有效，过期用例单独覆盖
    mockIsTokenFormatValid: vi.fn(() => true),
    // 平台检测 mock：默认微信端（静默重登路径），非微信用例单独覆盖
    mockIsWeapp: vi.fn(() => true),
  }
})

vi.mock('../../services/api', () => ({
  api: mockApi,
}))

vi.mock('../../utils/storage', () => ({
  storage: mockStorage,
}))

// JWT 校验 mock：authStore.initialize 恢复会话前用它拦截过期 token
vi.mock('../../utils/jwt', () => ({
  isTokenFormatValid: mockIsTokenFormatValid,
}))

// 平台检测 mock：isWeapp 决定过期后走「静默重登」还是「清理回落未登录」；
// 其余导出（getLoginCode 等）保持真实实现，login 链路仍走 Taro.login mock
vi.mock('../../platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platform')>()
  return { ...actual, isWeapp: mockIsWeapp }
})

const { mockTaroClearStorageSync } = vi.hoisted(() => ({
  mockTaroClearStorageSync: vi.fn(),
}))

// 宠物 store mock：登录成功后 authStore 需要调 initUser 拉宠物列表
// （「启动未登录→登录页登录」路径不经过 app.js 的启动 initUser，
//   不补拉会让首页/创作页等只读 petStore 的 tab 页一直空宠物）
const { mockPetInitUser } = vi.hoisted(() => ({
  mockPetInitUser: vi.fn(() => Promise.resolve()),
}))

vi.mock('../petStore', () => ({
  usePetStore: {
    getState: () => ({ initUser: mockPetInitUser }),
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

import { useAuthStore } from '../authStore'
import type { User } from '../../types'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_001',
    nickname: '测试用户',
    avatar: 'https://example.com/avatar.png',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 每个用例默认「token 有效 + 微信端」，过期/非微信用例在用例内覆盖
    mockIsTokenFormatValid.mockReturnValue(true)
    mockIsWeapp.mockReturnValue(true)
    // clearAllMocks 会清掉实现，重新给出默认 resolved 实现
    mockPetInitUser.mockResolvedValue(undefined)
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
    })
  })

  describe('initial state', () => {
    it('should have null token', () => {
      expect(useAuthStore.getState().token).toBeNull()
    })

    it('should have null user', () => {
      expect(useAuthStore.getState().user).toBeNull()
    })

    it('should have isAuthenticated as false', () => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })

    it('should have isLoading as false', () => {
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('should have isInitialized as false', () => {
      expect(useAuthStore.getState().isInitialized).toBe(false)
    })
  })

  describe('initialize', () => {
    it('should restore state from storage when token and user exist', async () => {
      const user = makeUser()
      mockStorage.getToken.mockReturnValue('valid_token')
      mockStorage.getUser.mockReturnValue(user)

      await useAuthStore.getState().initialize()

      const state = useAuthStore.getState()
      expect(state.token).toBe('valid_token')
      expect(state.user).toEqual(user)
      expect(state.isAuthenticated).toBe(true)
      expect(state.isInitialized).toBe(true)
    })

    it('should fetch user from api when token exists but user is null', async () => {
      const user = makeUser()
      mockStorage.getToken.mockReturnValue('valid_token')
      mockStorage.getUser.mockReturnValue(null)
      mockApi.getUser.mockResolvedValue(user)

      await useAuthStore.getState().initialize()

      const state = useAuthStore.getState()
      expect(state.token).toBe('valid_token')
      expect(state.user).toEqual(user)
      expect(state.isAuthenticated).toBe(true)
      expect(state.isInitialized).toBe(true)
      expect(mockStorage.setUser).toHaveBeenCalledWith(user)
    })

    it('should clear state when no token in storage', async () => {
      mockStorage.getToken.mockReturnValue(null)

      await useAuthStore.getState().initialize()

      const state = useAuthStore.getState()
      expect(state.token).toBeNull()
      expect(state.user).toBeNull()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isInitialized).toBe(true)
    })

    it('should clear storage on error', async () => {
      mockStorage.getToken.mockReturnValue('valid_token')
      mockStorage.getUser.mockReturnValue(null)
      mockApi.getUser.mockRejectedValue(new Error('Network error'))

      await useAuthStore.getState().initialize()

      expect(mockStorage.clear).toHaveBeenCalled()
      const state = useAuthStore.getState()
      expect(state.isInitialized).toBe(true)
    })

    it('should skip if already initialized', async () => {
      useAuthStore.setState({ isInitialized: true })

      await useAuthStore.getState().initialize()

      expect(mockStorage.getToken).not.toHaveBeenCalled()
    })

    // ===== 过期 token 启动拦截（2026-09-09「打开即 401」修复）=====

    it('should silently re-login when stored token is expired on weapp', async () => {
      // 场景：本地缓存 token 已过服务端 7 天有效期 → 不带过期 token 发业务请求吃 401，
      // 而是启动时静默重登（Taro.login 换新 token），用户无感
      const user = makeUser()
      mockStorage.getToken.mockReturnValue('expired.jwt.token')
      mockIsTokenFormatValid.mockReturnValue(false)
      mockIsWeapp.mockReturnValue(true)
      mockApi.login.mockResolvedValue({ token: 'fresh_token', refreshToken: 'r', user })

      await useAuthStore.getState().initialize()

      const state = useAuthStore.getState()
      expect(state.token).toBe('fresh_token')
      expect(state.user).toEqual(user)
      expect(state.isAuthenticated).toBe(true)
      expect(state.isInitialized).toBe(true)
      expect(state.isLoading).toBe(false)
      // 显式锁定链路（审查 P2-4）：新 token 必须经由 login()（api.login）写入，
      // 且启动路径只静默重登一次
      expect(mockApi.login).toHaveBeenCalledTimes(1)
      // 静默重登成功不得清掉会话（新 token/user 已由 login 写入存储）
      expect(mockStorage.clear).not.toHaveBeenCalled()
      // 不应发起旧 token 的资料恢复请求（那是过期 token 吃 401 的路径）
      expect(mockApi.getUser).not.toHaveBeenCalled()
    })

    it('should clear session and fall back to logged-out when silent re-login fails', async () => {
      // 场景：静默重登失败（网络异常/微信 code 失效）→ 清理过期会话回落未登录，
      // 启动不被阻塞，由各页面登录守卫正常引导
      mockStorage.getToken.mockReturnValue('expired.jwt.token')
      mockIsTokenFormatValid.mockReturnValue(false)
      mockApi.login.mockRejectedValue(new Error('Network error'))

      await useAuthStore.getState().initialize()

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.token).toBeNull()
      expect(mockStorage.clear).toHaveBeenCalled()
      expect(state.isInitialized).toBe(true)
      expect(state.isLoading).toBe(false)
    })

    it('should clear session on expired token when platform is not weapp', async () => {
      // 场景：H5/App 端需手机号验证码登录、无法静默重登 → 过期即清理回落未登录
      mockStorage.getToken.mockReturnValue('expired.jwt.token')
      mockIsTokenFormatValid.mockReturnValue(false)
      mockIsWeapp.mockReturnValue(false)

      await useAuthStore.getState().initialize()

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(mockApi.login).not.toHaveBeenCalled()
      expect(mockStorage.clear).toHaveBeenCalled()
      expect(state.isInitialized).toBe(true)
    })

    it('should not trigger silent re-login when token is still valid', async () => {
      // 场景：token 未过期（默认 mock）→ 走原有恢复逻辑，绝不发起重登请求
      const user = makeUser()
      mockStorage.getToken.mockReturnValue('valid_token')
      mockStorage.getUser.mockReturnValue(user)

      await useAuthStore.getState().initialize()

      expect(mockApi.login).not.toHaveBeenCalled()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })
  })

  describe('login', () => {
    it('should login successfully', async () => {
      const user = makeUser()
      mockApi.login.mockResolvedValue({
        token: 'login_token',
        refreshToken: 'login_refresh_token',
        user,
      })

      await useAuthStore.getState().login()

      const state = useAuthStore.getState()
      expect(state.token).toBe('login_token')
      expect(state.user).toEqual(user)
      expect(state.isAuthenticated).toBe(true)
      expect(state.isLoading).toBe(false)
      expect(mockStorage.setToken).toHaveBeenCalledWith('login_token')
      expect(mockStorage.setRefreshToken).toHaveBeenCalledWith('login_refresh_token')
      expect(mockStorage.setUser).toHaveBeenCalledWith(user)
    })

    it('should load pets via petStore.initUser after login succeeds', async () => {
      // 回归：登录成功后必须补拉宠物列表，否则首页/创作页等只读 petStore 的
      // tab 页一直不显示宠物（要手动进「宠物」tab 触发 fetchPets 才出现）
      const user = makeUser({ id: 'user_pet_001' })
      mockApi.login.mockResolvedValue({
        token: 'login_token',
        refreshToken: 'login_refresh_token',
        user,
      })

      await useAuthStore.getState().login()

      expect(mockPetInitUser).toHaveBeenCalledWith('user_pet_001')
    })

    it('should not load pets when login fails', async () => {
      mockApi.login.mockRejectedValue(new Error('Network error'))

      try {
        await useAuthStore.getState().login()
      } catch {
        // expected
      }

      expect(mockPetInitUser).not.toHaveBeenCalled()
    })

    it('should set loading during login', async () => {
      let resolveLogin: (value: any) => void
      const loginPromise = new Promise(resolve => { resolveLogin = resolve })
      mockApi.login.mockReturnValue(loginPromise)

      const loginCall = useAuthStore.getState().login()

      expect(useAuthStore.getState().isLoading).toBe(true)

      resolveLogin!({ token: 't', refreshToken: 'r', user: makeUser() })
      await loginCall

      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('should set isLoading to false on failure', async () => {
      mockApi.login.mockRejectedValue(new Error('Network error'))

      try {
        await useAuthStore.getState().login()
      } catch {
        // expected
      }

      expect(useAuthStore.getState().isLoading).toBe(false)
    })
  })

  describe('logout', () => {
    it('should clear all state on logout', async () => {
      useAuthStore.setState({
        token: 'some_token',
        user: makeUser(),
        isAuthenticated: true,
      })

      await useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.token).toBeNull()
      expect(state.user).toBeNull()
      expect(state.isAuthenticated).toBe(false)
    })

    it('should clear storage on logout', async () => {
      await useAuthStore.getState().logout()

      expect(mockTaroClearStorageSync).toHaveBeenCalled()
    })
  })
})
