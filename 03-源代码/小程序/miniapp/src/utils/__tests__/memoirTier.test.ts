/**
 * 回忆录三档纯函数测试（B2 前端镜像 B1 契约）
 * 重点防两类回归：①边界值与后端 MEMOIR_TIER_CONFIG 漂移；②价格表取值方向搞反（member/free）
 */
import { describe, it, expect } from 'vitest'
import {
  MEMOIR_TIER_BOUNDS,
  MEMOIR_TIER_ORDER,
  isTierAvailable,
  availableTiers,
  recommendTier,
  pickTierPrice,
  formatYuan,
  tierUnavailableReason,
  tierFromRoutePath,
} from '../memoirTier'

describe('MEMOIR_TIER_BOUNDS 三档边界（与后端 MEMOIR_TIER_CONFIG 同步锁）', () => {
  it('边界值与 2026-09-09 后端定稿一致（light 1-3 / standard 5-7 / full 8-15）', () => {
    // 后端改边界时此处必红——提醒同步前端
    expect(MEMOIR_TIER_BOUNDS.light).toEqual({ minPhotos: 1, maxPhotos: 3, minDuration: 5, maxDuration: 30, defaultDuration: 20 })
    expect(MEMOIR_TIER_BOUNDS.standard).toEqual({ minPhotos: 5, maxPhotos: 7, minDuration: 40, maxDuration: 50, defaultDuration: 45 })
    expect(MEMOIR_TIER_BOUNDS.full).toEqual({ minPhotos: 8, maxPhotos: 15, minDuration: 60, maxDuration: 90, defaultDuration: 75 })
  })

  it('档位顺序从轻到重（确认页展示顺序）', () => {
    expect(MEMOIR_TIER_ORDER).toEqual(['light', 'standard', 'full'])
  })
})

describe('isTierAvailable / availableTiers 照片数档位判定', () => {
  it('1 张照片：仅 light 可选', () => {
    expect(isTierAvailable('light', 1)).toBe(true)
    expect(isTierAvailable('standard', 1)).toBe(false)
    expect(isTierAvailable('full', 1)).toBe(false)
    expect(availableTiers(1)).toEqual(['light'])
  })

  it('3 张照片：light 上界边界值可选', () => {
    expect(availableTiers(3)).toEqual(['light'])
  })

  it('4 张照片：无档可选（1-3 与 5-7 之间的空隙）', () => {
    expect(availableTiers(4)).toEqual([])
    expect(recommendTier(4)).toBeNull()
  })

  it('7 张照片：仅 standard 可选', () => {
    expect(availableTiers(7)).toEqual(['standard'])
  })

  it('8 张照片：standard 上界与 full 下界交界处双可选', () => {
    // standard 边界 5-7（7 含内、8 超界），full 边界 8-15 → 8 张仅 full 可选
    expect(availableTiers(8)).toEqual(['full'])
  })

  it('0 张与超上限照片：所有档位均不可用（审查补充边界）', () => {
    expect(availableTiers(0)).toEqual([])
    expect(availableTiers(16)).toEqual([])
    expect(recommendTier(0)).toBeNull()
    expect(recommendTier(16)).toBeNull()
  })

  it('15 张照片：full 上界边界值可选', () => {
    expect(availableTiers(15)).toEqual(['full'])
  })

  it('10 张照片：仅 full 可选', () => {
    expect(availableTiers(10)).toEqual(['full'])
  })
})

describe('recommendTier 默认推荐档', () => {
  it('5 张照片推荐 standard（可用档里最重）', () => {
    expect(recommendTier(5)).toBe('standard')
  })

  it('12 张照片推荐 full', () => {
    expect(recommendTier(12)).toBe('full')
  })

  it('4 张照片无推荐', () => {
    expect(recommendTier(4)).toBeNull()
  })
})

describe('pickTierPrice 价格取值', () => {
  const prices = {
    light: { member: 1890, free: 2590 },
    standard: { member: 4500, free: 5900 },
    full: { member: 7900, free: 9900 },
  }

  it('会员取 member 价（18.9 元档）', () => {
    expect(pickTierPrice(prices, 'light', true)).toBe(1890)
    expect(pickTierPrice(prices, 'standard', true)).toBe(4500)
    expect(pickTierPrice(prices, 'full', true)).toBe(7900)
  })

  it('非会员取 free 价（25.9 元档）', () => {
    expect(pickTierPrice(prices, 'light', false)).toBe(2590)
    expect(pickTierPrice(prices, 'standard', false)).toBe(5900)
    expect(pickTierPrice(prices, 'full', false)).toBe(9900)
  })

  it('价格表缺失容错返回 0（调用方决定兜底提示）', () => {
    expect(pickTierPrice(null, 'light', true)).toBe(0)
    expect(pickTierPrice(undefined, 'full', false)).toBe(0)
    expect(pickTierPrice({ light: { member: 1890, free: 2590 } } as any, 'standard', true)).toBe(0)
  })
})

describe('formatYuan / tierUnavailableReason 展示工具', () => {
  it('分转元：整数不带小数点，非整数保留 1 位', () => {
    expect(formatYuan(1890)).toBe('18.9')
    expect(formatYuan(4500)).toBe('45')
    expect(formatYuan(9900)).toBe('99')
    expect(formatYuan(2590)).toBe('25.9')
  })

  it('不可选原因：照片不足给下限提示，超出给上限提示', () => {
    expect(tierUnavailableReason('standard', 3)).toBe('需至少 5 张照片')
    expect(tierUnavailableReason('light', 5)).toBe('最多 3 张照片')
    expect(tierUnavailableReason('full', 5)).toBe('需至少 8 张照片')
  })
})

/**
 * 2026-09-11 存量 P0 回归锁：完整档（8-15 张）在页面上曾永远选不出来
 *
 * 事故经过：memoir-full 与 memoir-vlog 是两份逐字节相同的实现，复制时把 standard 的照片边界
 * 一起复制了过去，导致 memoir-full 页面的选照片上限被死锁在 7 张，
 * isTierAvailable('full', n≤7) 恒为 false —— 最贵的完整档在任何入口都买不到。
 * 下面第一组断言就是"这个 bug 是否复发"的判定线。
 */
describe('tierFromRoutePath 路由→档位推导（防"复制页面连档位边界一起复制"复发）', () => {
  it('三条路由各自映射到正确档位', () => {
    expect(tierFromRoutePath('/pagesMemoir/memoir-full/index')).toBe('full')
    expect(tierFromRoutePath('/pagesMemoir/memoir-vlog/index')).toBe('standard')
    expect(tierFromRoutePath('/pagesMemoir/memoir-daily/index')).toBe('light')
  })

  it('带查询串/带前导斜杠差异的路由同样识别', () => {
    expect(tierFromRoutePath('pagesMemoir/memoir-full/index?petId=p1&tier=full')).toBe('full')
    expect(tierFromRoutePath('/pagesMemoir/memoir-vlog/index?petId=p1')).toBe('standard')
  })

  it('路由缺失或未知：兜底 standard（对旧链接最保守，不会误升档位）', () => {
    expect(tierFromRoutePath(undefined)).toBe('standard')
    expect(tierFromRoutePath('')).toBe('standard')
    expect(tierFromRoutePath('/pages/unknown/index')).toBe('standard')
  })

  it('【P0 回归线】完整档页面必须能选到 8 张及以上照片', () => {
    const fullRouteTier = tierFromRoutePath('/pagesMemoir/memoir-full/index')
    const bounds = MEMOIR_TIER_BOUNDS[fullRouteTier]
    // 上限必须够得着完整档的下限，否则该档永远不可选（本次事故就是这个不等式被破坏）
    expect(bounds.maxPhotos).toBeGreaterThanOrEqual(MEMOIR_TIER_BOUNDS.full.minPhotos)
    expect(bounds).toEqual(MEMOIR_TIER_BOUNDS.full)
    expect(isTierAvailable(fullRouteTier, 8)).toBe(true)
    expect(isTierAvailable(fullRouteTier, 15)).toBe(true)
    // 且完整档页面在 8 张时确实推荐完整档（而不是退化成标准档）
    expect(recommendTier(8)).toBe('full')
  })

  it('标准档页面仍按 5-7 张限制（不能被"顺手上调"到完整档边界）', () => {
    const standardRouteTier = tierFromRoutePath('/pagesMemoir/memoir-vlog/index')
    expect(MEMOIR_TIER_BOUNDS[standardRouteTier]).toEqual(MEMOIR_TIER_BOUNDS.standard)
    expect(isTierAvailable(standardRouteTier, 8)).toBe(false)
  })
})
