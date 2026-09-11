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
import { calcAge } from '../utils'
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
