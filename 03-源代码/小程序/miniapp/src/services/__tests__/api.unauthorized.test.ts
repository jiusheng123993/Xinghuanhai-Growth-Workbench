/**
 * API 401 统一处理（handleUnauthorized）专项测试
 *
 * 背景：services/__tests__/api.test.ts 将 ../api 模块整体 mock 后测试的是 mock
 * 行为，真实的 401 处理链路（logout + 启动期延迟 reLaunch）无覆盖。本文件加载
 * 真实 request/handleUnauthorized，专项验证 2026-09-09「打开即 401 + Page route
 * 错误(webviewId not found)」修复：
 *   1) 401 → 清会话（logout）→ reLaunch 登录页，并向调用方抛登录过期错误；
 *   2) 已在登录页不重复跳转；
 *   3) 启动期页面栈为空 → 真实轮询等待（进循环体多次）就绪后再跳（防 reLaunch
 *      销毁路由中的首屏 webview 触发微信框架路由竞态）；
 *   4) 栈非空后仍有 300ms 收尾缓冲（审查 P1-1：「栈非空」必要非充分，routeDone
 *      窗口持续到首屏路由完成，缓冲覆盖「栈已非空但路由消息未走完」的窗口）；
 *   5) 等待期间用户已手动到登录页 → 复查后不重复跳转；
 *   6) 等待超时（栈始终为空）仍兜底跳转，保证用户总能到达登录页；
 *   7) 并发 401 防重入：多个请求同时 401 只 logout/跳转各一次（handling401 锁）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { api } from '../api'

const {
  mockRequest,
  mockGetCurrentPages,
  mockReLaunch,
  mockShowToast,
  mockLogout,
} = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockGetCurrentPages: vi.fn(() => [] as Array<{ route?: string }>),
  mockReLaunch: vi.fn(() => Promise.resolve({ errMsg: 'reLaunch:ok' })),
  mockShowToast: vi.fn(() => Promise.resolve({ errMsg: 'showToast:ok' })),
  mockLogout: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    request: mockRequest,
    getCurrentPages: mockGetCurrentPages,
    reLaunch: mockReLaunch,
    showToast: mockShowToast,
  },
}))

// 真实 request() 顶层读取 token（401 分支本身不依赖其值）
vi.mock('../../utils/storage', () => ({
  storage: { getToken: vi.fn(() => 'test-token') },
}))

// handleUnauthorized 通过动态 import 拿 authStore 调 logout；
// 真实 authStore 牵出 wsClient/platform 等链路，这里只提供被消费的接口
vi.mock('../../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ logout: mockLogout }) },
}))

// USE_MOCK=false 不会走 mock 分支，但顶层 import 仍会加载 mock 模块，置空防副作用
vi.mock('../mock', () => ({ mockApi: {} }))

/** 构造 401 响应（Taro.request resolve 形态） */
function make401() {
  return Promise.resolve({ statusCode: 401, data: {} })
}

describe('api 401 统一处理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // mockReset 清掉上一用例的 mockReturnValue 级实现，再重建各自默认行为
    mockRequest.mockReset()
    mockGetCurrentPages.mockReset().mockReturnValue([])
    mockReLaunch.mockReset().mockResolvedValue({ errMsg: 'reLaunch:ok' })
    mockShowToast.mockReset().mockResolvedValue({ errMsg: 'showToast:ok' })
    mockLogout.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('页面栈非空时清理会话并跳转登录页，同时向调用方抛登录过期错误', async () => {
    mockGetCurrentPages.mockReturnValue([{ route: 'pages/index/index' }])
    mockRequest.mockReturnValue(make401())

    await expect(api.get('/api/pets')).rejects.toThrow('登录已过期，请重新登录')

    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(mockReLaunch).toHaveBeenCalledWith({ url: '/pagesUser/login/index' })
  })

  it('当前已在登录页时只清理会话不重复跳转', async () => {
    mockGetCurrentPages.mockReturnValue([{ route: 'pagesUser/login/index' }])
    mockRequest.mockReturnValue(make401())

    await expect(api.get('/api/pets')).rejects.toThrow('登录已过期，请重新登录')

    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  it('启动期空栈时真实轮询等待，就绪后仍有 300ms 收尾缓冲才跳转', async () => {
    vi.useFakeTimers()
    // 调用序列：[启动判断空, poll1空, poll2空, poll3空, → 默认返回就绪首屏]
    // 用 4 次空栈保证 while 循环真实进入 3 轮轮询（审查 P2-3①：锁定轮询语义）
    mockGetCurrentPages
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValue([{ route: 'pages/index/index' }])
    mockRequest.mockReturnValue(make401())

    const pending = api.get('/api/pets')
    const assertion = expect(pending).rejects.toThrow('登录已过期，请重新登录')

    // 推进 3 轮轮询（300ms）：此时栈已非空、进入 300ms 收尾缓冲——
    // 缓冲期内不得跳转（审查 P1-1：栈非空 ≠ 路由完成，缓冲覆盖 routeDone 窗口）
    await vi.advanceTimersByTimeAsync(300)
    expect(mockReLaunch).not.toHaveBeenCalled()

    // 推进完收尾缓冲（累计 650ms > 300ms）：复查后放行跳转
    await vi.advanceTimersByTimeAsync(350)
    await assertion

    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(mockReLaunch).toHaveBeenCalledWith({ url: '/pagesUser/login/index' })
  })

  it('等待期间用户已手动进入登录页时，复查后不重复跳转', async () => {
    vi.useFakeTimers()
    // 等待过程中页面栈出现且栈顶已是登录页（用户手动跳转/其他守卫先跳了）
    mockGetCurrentPages
      .mockReturnValueOnce([]) // handleUnauthorized 启动期判断：空栈 → 进入等待
      .mockReturnValueOnce([]) // poll1
      .mockReturnValueOnce([]) // poll2
      .mockReturnValue([{ route: 'pagesUser/login/index' }]) // poll3 起为登录页
    mockRequest.mockReturnValue(make401())

    const pending = api.get('/api/pets')
    const assertion = expect(pending).rejects.toThrow('登录已过期，请重新登录')

    // 推进 2 轮轮询 + 收尾缓冲，冲刷完整处理链
    await vi.advanceTimersByTimeAsync(800)
    await assertion

    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(mockReLaunch).not.toHaveBeenCalled()
  })

  it('启动期页面栈始终为空时超时后仍兜底跳转', async () => {
    vi.useFakeTimers()
    // 首屏路由异常卡住：页面栈始终为空 → 80 次 × 100ms 轮询全部耗尽
    mockGetCurrentPages.mockReturnValue([])
    mockRequest.mockReturnValue(make401())

    const pending = api.get('/api/pets')
    const assertion = expect(pending).rejects.toThrow('登录已过期，请重新登录')

    // 推进超过轮询上限（80 × 100ms = 8s，与 routeGuard 分包占位窗对齐）
    await vi.advanceTimersByTimeAsync(8500)
    await assertion

    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(mockReLaunch).toHaveBeenCalledWith({ url: '/pagesUser/login/index' })
  })

  it('并发多个请求同时 401 时防重入：logout 与 reLaunch 各仅一次', async () => {
    // 运行期（栈非空）场景：两个并发请求同时收到 401
    mockGetCurrentPages.mockReturnValue([{ route: 'pages/index/index' }])
    mockRequest.mockReturnValue(make401())

    const p1 = api.get('/api/pets/a')
    const p2 = api.get('/api/pets/b')
    // 防重入锁只收敛「登出/跳转」副作用，不吞调用方错误：两者都抛登录过期
    await expect(p1).rejects.toThrow('登录已过期，请重新登录')
    await expect(p2).rejects.toThrow('登录已过期，请重新登录')

    expect(mockLogout).toHaveBeenCalledTimes(1)
    expect(mockReLaunch).toHaveBeenCalledTimes(1)
  })
})
