/**
 * 认证状态管理
 * 小程序：微信登录 → Taro.login() 获取 code → 后端换取 token
 * App/H5：手机号+验证码登录 → 后端换取 token
 */
import Taro from '@tarojs/taro'
import create from 'zustand'
import { api } from '../services/api'
import { isTokenFormatValid } from '../utils/jwt'
import { wsClient } from '../services/wsClient'
import { getLoginCode, loginWithPhone, API_BASE_URL, isWeapp } from '../platform'
import { processPendingReferral } from '../services/shareService'
import { usePetStore } from './petStore'
import {
  storage,
  setStorageUserId,
  getStorage,
  setStorage,
  removeStorage,
  clearAllStorage,
} from '../utils/storage'
import type { User } from '../types'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  isInitialized: boolean
  login: () => Promise<void>
  loginByPhone: (phone: string, code: string) => Promise<void>
  /** 更新用户资料（昵称/头像），成功后同步到 store 与本地存储 */
  updateProfile: (nickname: string, avatarUrl: string) => Promise<User>
  logout: () => Promise<void>
  initialize: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isInitialized: false,

  /**
   * 初始化认证状态，从本地存储恢复登录态
   *
   * 过期 token 启动即拦截（2026-09-09 修复「打开即 401」）：
   * 服务端 JWT 有效期 7 天且无刷新端点，本地缓存的过期 token 若照旧恢复，
   * 启动首个业务请求（GET /api/pets）必然 401，进而触发全局 401 处理在启动期
   * reLaunch 登录页，与首屏路由竞态报「Page route 错误(webviewId not found)」。
   * 因此恢复前先本地校验 exp（不发起任何业务请求）：
   * - 微信端：静默重登（Taro.login 换新 token，用户无感，无需任何点击）；
   * - 非微信端（H5/App 需手机号验证码，无法静默重登）：清理会话回落未登录，
   *   由各页面登录守卫正常引导。
   */
  initialize: async () => {
    if (get().isInitialized) return
    set({ isLoading: true })
    try {
      const token = storage.getToken()
      if (token) {
        // 本地过期校验：JWT 三段结构 + exp 未过期才视为有效（isTokenFormatValid 内含）
        if (!isTokenFormatValid(token)) {
          if (isWeapp()) {
            // 静默重登：复用 login()（Taro.login → 后端 code 换 token），
            // 成功后 state 已含新 token/user 且 isAuthenticated=true
            await get().login()
            // login() 不负责 isInitialized（正常由用户点击登录路径消费），
            // 启动路径在此补齐，保证 app.js 的启动收尾逻辑只执行一次
            set({ isInitialized: true })
            return
          }
          // 非微信端无法静默重登：过期即视为未登录，清理残留会话。
          // 清理口径说明（审查 P2）：此处与 catch 一致用 storage.clear()（仅认证
          // 三键）而非 logout 的 Taro.clearStorageSync 全清——H5/App 端业务缓存
          // 带 userId 前缀隔离、无跨账号泄露，窄清理保住用户本地数据；残留由
          // 下次登录同账号复用，风险受控（取舍记录见 utils/storage.ts clear 实现）
          storage.clear()
          set({ isInitialized: true, isLoading: false })
          return
        }
        const user = storage.getUser()
        if (user) {
          set({ user, token, isAuthenticated: true, isInitialized: true, isLoading: false })
          // 已登录用户打开邀请链接时同样消费待处理邀请码
          void processPendingReferral(user.id)
          return
        }
        const freshUser = await api.getUser()
        storage.setUser(freshUser)
        set({ user: freshUser, token, isAuthenticated: true, isInitialized: true, isLoading: false })
        void processPendingReferral(freshUser.id)
        return
      }
    } catch (err) {
      // 覆盖静默重登失败：过期 token 清理掉，回落未登录态（不阻塞启动）。
      // 可观测性（2026-09-09 审查 P2）：线上「打开即回落未登录」需有迹可循；
      // 只记 Error 对象，禁止输出 token/user 值。清理口径说明：此处仅清认证
      // 三键（storage.clear），比 handleUnauthorized 的 logout 全清（Taro.clearStorageSync）
      // 轻——静默重登失败场景微信端 Taro.login 必为当前账号、业务缓存带 userId
      // 前缀隔离，无跨用户泄露；无需全清打断用户本地数据。
      console.warn('[authStore] 启动静默重登失败，已回落未登录:', err)
      storage.clear()
    }
    set({ isInitialized: true, isLoading: false })
  },

  /**
   * 微信登录（仅小程序）
   */
  login: async () => {
    set({ isLoading: true })
    try {
      const code = await getLoginCode()
      if (!code) {
        throw new Error('获取微信登录凭证失败')
      }
      const res = await api.login(code)
      storage.setToken(res.token)
      storage.setRefreshToken(res.refreshToken)
      storage.setUser(res.user)
      set({ user: res.user, token: res.token, isAuthenticated: true, isLoading: false })
      // 登录成功后加载宠物列表：app.js 的 initUser 只在「启动时已登录」才执行，
      // 「启动未登录→登录页登录」路径必须在这里补拉，否则首页/创作页等只读
      // petStore 的 tab 页会一直空宠物、头像不显示，直到用户手动进「宠物」tab。
      // fetchPets 内部自带 try/catch（失败只写 error 状态不会 reject），fire-and-forget 安全。
      void usePetStore.getState().initUser(res.user.id)
      // 登录成功后消费启动时记录的邀请码，建立推荐关系
      void processPendingReferral(res.user.id)
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  /**
   * 手机号验证码登录（App/H5）
   */
  loginByPhone: async (phone: string, code: string) => {
    set({ isLoading: true })
    try {
      const result = await loginWithPhone(phone, code, API_BASE_URL)
      if (!result.success || !result.token) {
        throw new Error(result.error || '登录失败')
      }
      storage.setToken(result.token)
      storage.setRefreshToken(result.refreshToken || '')
      storage.setUser(result.user)
      set({
        user: result.user,
        token: result.token,
        isAuthenticated: true,
        isLoading: false,
      })
      // 登录成功后加载宠物列表（与微信登录 login 同理，见 login 注释）
      void usePetStore.getState().initUser(result.user.id)
      void processPendingReferral(result.user.id)
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  /**
   * 更新用户资料（昵称/头像），成功后同步到 store 与本地存储
   * @param nickname - 用户昵称（跟随微信昵称）
   * @param avatarUrl - 头像地址（跟随微信头像，已上传到服务器）
   */
  updateProfile: async (nickname: string, avatarUrl: string) => {
    const updated = await api.updateProfile(nickname, avatarUrl)
    storage.setUser(updated)
    set({ user: updated })
    return updated
  },

  logout: async () => {
    wsClient.disconnect()
    // 清除所有本地数据（含认证 + 业务数据），防止数据残留和跨用户泄露
    try {
      Taro.clearStorageSync()
    } catch {}
    set({ user: null, token: null, isAuthenticated: false })
  },
}))
