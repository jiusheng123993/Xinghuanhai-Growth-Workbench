/**
 * 新手引导闸门单测（utils/onboardingGate）
 *
 * 【本文件要钉死的三件事】
 *  1. **key 的唯一真相源**：`ONBOARDING_DONE_KEY` 必须是历史上那个 `onboarding_completed`
 *     字面量 —— 换 key 等于把所有老用户重新引导一遍，这条断言就是防回退的闸门。
 *  2. **读写都要 try/catch**：storage 在各端行为不同（可能抛），
 *     读异常必须保守返回 false，写异常必须静默吞掉（不能中断引导出口的跳转）。
 *  3. **老用户路径一个字节都没变**：已有标记时 `goAfterAuthEntry()` 必须走
 *     `reLaunch('/pages/index/index')`，既不去引导页、也不走 redirectTo
 *     （登录页/绑定页两处路由全部改走本函数，所以这条断言实际覆盖了整条老用户链路）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Taro from '@tarojs/taro'

// 【为什么本文件要自带 Taro mock】`src/test/setup.ts` 的全局 mock 为保持既有用例稳定，
// 只提供 getStorageSync/setStorageSync/navigateTo/reLaunch 等（未提供 redirectTo），
// 而本模块会用到 redirectTo 并对它挂 .catch 兜底，故这里覆盖成"同一对象的可控 mock"。
// 用 vi.hoisted 暴露引用，供 vi.mock 工厂与测试体共享同一实例。
const taro = vi.hoisted(() => ({
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
  navigateTo: vi.fn(),
  redirectTo: vi.fn(),
  reLaunch: vi.fn(),
  switchTab: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({ default: taro }))

import {
  ONBOARDING_DONE_KEY,
  ONBOARDING_URL,
  HOME_URL,
  hasCompletedOnboarding,
  markOnboardingCompleted,
  goAfterAuthEntry,
} from '../onboardingGate'

describe('utils/onboardingGate 新手引导闸门', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认"没有标记"（getStorageSync 无值时各端返回 null 或 ''，这里模拟小程序端的 ''）
    vi.mocked(Taro.getStorageSync).mockReturnValue('')
    // 路由 API 必须返回 Promise：实现里对 redirectTo 挂了 .catch 兜底（Taro 类型也声明返回 Promise）
    vi.mocked(Taro.redirectTo).mockResolvedValue({ errMsg: 'redirectTo:ok' } as never)
    vi.mocked(Taro.reLaunch).mockResolvedValue({ errMsg: 'reLaunch:ok' } as never)
  })

  it('标记 key 沿用历史字面量 onboarding_completed（换 key = 老用户被重新引导一遍）', () => {
    expect(ONBOARDING_DONE_KEY).toBe('onboarding_completed')
  })

  it('两个落点地址与登录/引导链路口径一致', () => {
    expect(ONBOARDING_URL).toBe('/pagesUser/onboarding/index')
    expect(HOME_URL).toBe('/pages/index/index')
  })

  describe('hasCompletedOnboarding 首次进入判定', () => {
    it('storage 里是字符串 true → 已完成', () => {
      vi.mocked(Taro.getStorageSync).mockReturnValue('true')
      expect(hasCompletedOnboarding()).toBe(true)
      expect(vi.mocked(Taro.getStorageSync)).toHaveBeenCalledWith('onboarding_completed')
    })

    it('storage 里是布尔 true / 字符串 1 → 同样算已完成（兼容其他写入写法）', () => {
      vi.mocked(Taro.getStorageSync).mockReturnValue(true)
      expect(hasCompletedOnboarding()).toBe(true)

      vi.mocked(Taro.getStorageSync).mockReturnValue('1')
      expect(hasCompletedOnboarding()).toBe(true)
    })

    it('从未写过标记（返回 null / 空串）→ 未完成', () => {
      vi.mocked(Taro.getStorageSync).mockReturnValue(null)
      expect(hasCompletedOnboarding()).toBe(false)

      vi.mocked(Taro.getStorageSync).mockReturnValue('')
      expect(hasCompletedOnboarding()).toBe(false)
    })

    it('storage 读取抛异常 → 保守返回 false（错误代价只是多看一次引导，不能打断登录）', () => {
      vi.mocked(Taro.getStorageSync).mockImplementation(() => {
        throw new Error('storage unavailable')
      })
      expect(hasCompletedOnboarding()).toBe(false)
    })
  })

  describe('markOnboardingCompleted 写标记', () => {
    it('写入 key/value 与历史实现完全一致（字符串 true）', () => {
      markOnboardingCompleted()
      expect(vi.mocked(Taro.setStorageSync)).toHaveBeenCalledWith('onboarding_completed', 'true')
    })

    it('写入抛异常 → 静默吞掉，不把异常抛给调用方（否则会中断引导页跳转）', () => {
      vi.mocked(Taro.setStorageSync).mockImplementation(() => {
        throw new Error('storage quota exceeded')
      })
      expect(() => markOnboardingCompleted()).not.toThrow()
    })
  })

  describe('goAfterAuthEntry 登录/绑定后的统一出口', () => {
    it('★ 老用户（已有标记）→ reLaunch 首页，行为与改动前完全一致，不被重新引导', () => {
      vi.mocked(Taro.getStorageSync).mockReturnValue('true')

      goAfterAuthEntry()

      expect(vi.mocked(Taro.reLaunch)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(Taro.reLaunch)).toHaveBeenCalledWith({ url: '/pages/index/index' })
      // 老用户路径上不该出现任何"进引导页"的导航
      expect(vi.mocked(Taro.redirectTo)).not.toHaveBeenCalled()
      expect(vi.mocked(Taro.navigateTo)).not.toHaveBeenCalled()
    })

    it('新用户（无标记）→ redirectTo 进新手引导页，且不 reLaunch 首页', () => {
      goAfterAuthEntry()

      expect(vi.mocked(Taro.redirectTo)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(Taro.redirectTo)).toHaveBeenCalledWith({ url: '/pagesUser/onboarding/index' })
      expect(vi.mocked(Taro.reLaunch)).not.toHaveBeenCalled()
    })

    it('新用户 + redirectTo 失败 → 回退 reLaunch 首页（不能把用户丢在空栈里）', async () => {
      vi.mocked(Taro.redirectTo).mockRejectedValue(new Error('route failed'))

      goAfterAuthEntry()
      // 等待 .catch 兜底执行
      await Promise.resolve()
      await Promise.resolve()

      expect(vi.mocked(Taro.reLaunch)).toHaveBeenCalledWith({ url: '/pages/index/index' })
    })

    it('引导走完（标记已写）后再走同一出口 → 直接进首页（形成闭环，不会二次引导）', () => {
      // 先模拟"引导页写了标记"：setStorageSync 后 storage 读到的就是 true
      let stored: unknown = ''
      vi.mocked(Taro.setStorageSync).mockImplementation((key: string, value: unknown) => {
        if (key === 'onboarding_completed') stored = value
      })
      vi.mocked(Taro.getStorageSync).mockImplementation(() => stored as string)

      markOnboardingCompleted()
      goAfterAuthEntry()

      expect(vi.mocked(Taro.reLaunch)).toHaveBeenCalledWith({ url: '/pages/index/index' })
      expect(vi.mocked(Taro.redirectTo)).not.toHaveBeenCalled()
    })
  })
})
