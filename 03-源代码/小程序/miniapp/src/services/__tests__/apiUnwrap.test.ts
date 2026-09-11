/**
 * api 层「解包契约」测试（直连真实实现）
 *
 * 【为什么必须有这个文件】
 *   2026-09-11 排查出一批 service 的"二次解包"缺陷（读 `res.data` 而 api 层已解包），
 *   而全仓库当时**没有任何测试**在验证 `api.ts` 的真实解包行为：
 *     · `apiContract.test.ts` 把整个 `../api` mock 掉了（只能证明 service 侧写法）；
 *     · `api.test.ts` 更彻底 —— 它 mock 掉真实模块后**自己重写了一份 request()**，
 *       那份"影子实现"没有 success 解包、也没有 401 会话清理，断言的是影子而不是真身。
 *   结果就是：改坏 `api.ts` 的解包逻辑 → 30+ 个 service 一起坏，却没有任何测试变红。
 *   本文件用**真实 `../api`** + mock 掉 `Taro.request`，把这几条行为钉死。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// 注意：import 必须全部放在模块顶部（eslint import/first）；
// vi.mock 虽然写在下面，但会被 vitest 提升到所有 import 之前，因此拿到的仍是 mock 版本
import { api } from '../api'

const { mockTaroRequest } = vi.hoisted(() => ({ mockTaroRequest: vi.fn() }))

vi.mock('@tarojs/taro', () => ({
  default: {
    request: mockTaroRequest,
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    reLaunch: vi.fn(),
    navigateTo: vi.fn(),
    showToast: vi.fn(),
    getCurrentPages: vi.fn(() => []),
  },
}))

describe('api 层解包契约（真实 request 实现）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('body.success 为真时返回的是 body.data 本体（不是整个响应体）', async () => {
    mockTaroRequest.mockResolvedValue({
      statusCode: 200,
      data: { success: true, data: { id: 'pet_1', name: '可乐' } },
    })

    // 这条断言就是所有 service 的"契约前提"：
    // 调用方拿到的是 data 本体，所以再写 `res.data` 一定是 undefined。
    await expect(api.get<{ id: string; name: string }>('/api/pets')).resolves.toEqual({
      id: 'pet_1',
      name: '可乐',
    })
  })

  it('成功响应没有 data 字段时返回 undefined（NPS 提交、邀请奖励就是这种形状）', async () => {
    mockTaroRequest.mockResolvedValue({
      statusCode: 200,
      data: { success: true, message: '感谢您的反馈' },
    })

    // 这正是 submitNpsFeedback / grantShareReward 的处境：
    // 调用方不能靠读返回值的 .success 判断成败，只能以"没有抛错"为准。
    await expect(api.post('/api/feedback/nps', {})).resolves.toBeUndefined()
  })

  it('body.success 为假时抛错，错误信息取自 body.message', async () => {
    mockTaroRequest.mockResolvedValue({
      statusCode: 200,
      data: { success: false, message: '还需邀请 2 位好友即可获得奖励' },
    })

    // 服务端把可读文案放在 message 里，前端 catch 才能如实展示
    // （若后端只给 error 字段，这里只会得到兜底的"请求失败"）
    await expect(api.post('/api/shares/grant-reward')).rejects.toThrow('还需邀请 2 位好友即可获得奖励')
  })

  it('success 为假且没有 message 时抛出兜底错误信息', async () => {
    mockTaroRequest.mockResolvedValue({ statusCode: 200, data: { success: false } })

    await expect(api.get('/api/whatever')).rejects.toThrow('请求失败')
  })

  // 说明：401 的会话清理 / 重登引导不在这里测 ——
  // 已由既有的 `api.unauthorized.test.ts` 专门覆盖（那里把 refresh 等相关依赖一并 mock 好了），
  // 本文件只负责"解包与错误抛出"这几条契约。

  it('网络失败（request:fail）抛出可读提示', async () => {
    mockTaroRequest.mockRejectedValue(new Error('request:fail'))

    await expect(api.get('/api/pets')).rejects.toThrow('网络异常，请检查网络连接')
  })
})
