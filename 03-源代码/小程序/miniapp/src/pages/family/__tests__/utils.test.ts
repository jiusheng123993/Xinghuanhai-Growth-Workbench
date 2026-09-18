/**
 * 家庭页工具函数单测
 *
 * 2026-09-11：全站年龄文案统一后，`calcAge` 变成了 `utils/date.formatPetAge` 的薄包装，
 * 而 `src/pages/family` 此前**一个测试文件都没有**，这个包装器等于零覆盖
 * （独立审查 P2-4 指出：它只剩 FamilyPetList 一个消费者 + 没有任何测试）。
 * 这里钉两件事：① 兜底文案是「未知」（与页面其它地方一致）；
 * ② 输出与 formatPetAge 逐字一致 —— 防止将来有人在这个包装器里又写一套算法。
 */
import { describe, it, expect } from 'vitest'
import {
  calcAge,
  roleIcon,
  groupPhotosByMonth,
  syncMemberOrder,
  isSameOrder,
  moveInOrder,
  type FamilyPhotoLike,
} from '../utils'
import { formatPetAge } from '../../../utils/date'

/** 本地时区 YYYY-MM-DD（不能用 toISOString：东八区晚上会退到前一天） */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('pages/family/utils - calcAge', () => {
  it('缺失 / 非法 / 未来日期返回「未知」兜底', () => {
    expect(calcAge('')).toBe('未知')
    expect(calcAge('2026-02-31')).toBe('未知')
    expect(calcAge('2099-01-01')).toBe('未知')
  })

  it('输出与 utils/date 的 formatPetAge 逐字一致（薄包装，不许有第二套算法）', () => {
    const now = new Date()
    // 用「n 个月前的 1 号」构造：任何一天都必然算满整月，期望值不随真实日历抖动
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    const fifteenMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth() - 3, 1)
    const fiveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    for (const d of [threeMonthsAgo, fifteenMonthsAgo, fiveMonthsAgo]) {
      const s = localDateStr(d)
      expect(calcAge(s)).toBe(formatPetAge(s, { fallback: '未知' }))
    }
  })

  it('满 1 岁用「X岁Y个月」格式（旧实现输出「1岁3月」，格式与别页不统一）', () => {
    const now = new Date()
    const fifteenMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth() - 3, 1)
    expect(calcAge(localDateStr(fifteenMonthsAgo))).toBe('1岁3个月')
  })

  it('不满 1 岁显示「N个月」（旧实现是「N月」）', () => {
    const now = new Date()
    const fiveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    expect(calcAge(localDateStr(fiveMonthsAgo))).toBe('5个月')
  })
})

// ============================================================
// 以下三组由 pagesPet/family/dashboard 并入时搬来（2026-09-12）
// ============================================================

/** 造一条合影记录（只填被测函数用得到的字段） */
function makePhoto(overrides: Partial<FamilyPhotoLike> = {}): FamilyPhotoLike {
  return {
    id: 'p1',
    memberCount: 2,
    createdAt: '2026-09-01T10:00:00+08:00',
    ...overrides,
  }
}

describe('pages/family/utils - roleIcon', () => {
  it('命中预置角色返回对应徽标', () => {
    expect(roleIcon('团宠')).toBe('💖')
    expect(roleIcon('守护者')).toBe('🛡️')
  })

  it('空角色 / 未知角色返回空串（由调用方回退，不能凭空造徽标）', () => {
    expect(roleIcon(undefined)).toBe('')
    expect(roleIcon('')).toBe('')
    expect(roleIcon('不存在的角色')).toBe('')
  })
})

describe('pages/family/utils - groupPhotosByMonth', () => {
  it('按月分组，且月内新的在前、同月连续（后端乱序也不会来回跳）', () => {
    const groups = groupPhotosByMonth([
      makePhoto({ id: 'a', createdAt: '2026-08-02T10:00:00+08:00' }),
      makePhoto({ id: 'b', createdAt: '2026-09-01T10:00:00+08:00' }),
      makePhoto({ id: 'c', createdAt: '2026-09-20T10:00:00+08:00' }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['2026年9月', '2026年8月'])
    expect(groups[0].photos.map((p) => p.id)).toEqual(['c', 'b'])
    expect(groups[1].photos.map((p) => p.id)).toEqual(['a'])
  })

  it('跨年分组标签带年份（12 月与次年 1 月不能被并成一组）', () => {
    const groups = groupPhotosByMonth([
      makePhoto({ id: 'x', createdAt: '2025-12-31T10:00:00+08:00' }),
      makePhoto({ id: 'y', createdAt: '2026-01-01T10:00:00+08:00' }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['2026年1月', '2025年12月'])
  })

  it('空数组返回空分组（不发散成含一个空组的数组）', () => {
    expect(groupPhotosByMonth([])).toEqual([])
  })

  it('不改动入参数组（后端 store 里的 photos 必须保持原引用顺序）', () => {
    const input = [
      makePhoto({ id: 'old', createdAt: '2026-01-01T10:00:00+08:00' }),
      makePhoto({ id: 'new', createdAt: '2026-09-01T10:00:00+08:00' }),
    ]
    groupPhotosByMonth(input)
    expect(input.map((p) => p.id)).toEqual(['old', 'new'])
  })
})

describe('pages/family/utils - syncMemberOrder', () => {
  it('保留用户已排好的相对次序，新成员追加到末尾', () => {
    expect(syncMemberOrder(['b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('成员被移出家庭时从座次里剔除（不能让已移出的宠物继续占位）', () => {
    expect(syncMemberOrder(['b', 'a', 'c'], ['a', 'c'])).toEqual(['a', 'c'])
  })

  it('首次进入（prev 为空）时等于后端顺序', () => {
    expect(syncMemberOrder([], ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('prev 里出现重复 id 时去重（否则同一个头像会在座次条里出现两次）', () => {
    expect(syncMemberOrder(['a', 'a', 'b'], ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('pages/family/utils - moveInOrder', () => {
  it('左移/右移各交换一位', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveInOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('越界时原样返回（首位继续左移 / 末位继续右移都不能变形）', () => {
    expect(moveInOrder(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
    expect(moveInOrder(['a', 'b'], 'b', 1)).toEqual(['a', 'b'])
  })

  it('petId 不在座次里时原样返回（不产生 NaN 位）', () => {
    expect(moveInOrder(['a', 'b'], 'zzz', 1)).toEqual(['a', 'b'])
  })
})

describe('pages/family/utils - isSameOrder', () => {
  it('内容与顺序都一致才为 true', () => {
    expect(isSameOrder(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(isSameOrder(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(isSameOrder(['a'], ['a', 'b'])).toBe(false)
  })

  it('空数组与空数组一致（首次进入时不应触发一次多余的重渲染）', () => {
    expect(isSameOrder([], [])).toBe(true)
  })
})
