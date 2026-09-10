/**
 * 日期工具（自然日差）单元测试
 *
 * 覆盖目标：把「陪伴天数」的算法从
 *   Math.floor((Date.now() - new Date(birthDate).getTime()) / 86400000)
 * 换成 daysSinceLocalDate 后，必须在**本地凌晨**给出正确的自然日差。
 *
 * 注意：所有断言都不写死具体时区偏移 —— 输入用纯日期串或本地构造的 Date，
 * 这样测试在任何时区的机器上都能通过（只依赖"本地日历天"这一语义）。
 */
import { describe, it, expect } from 'vitest'
import { parseLocalDate, daysSinceLocalDate, formatPetAge } from '../date'

describe('parseLocalDate', () => {
  it('纯日期串解析为「本地当天零点」，不因 UTC 解析跳到前一天的 08:00', () => {
    const d = parseLocalDate('2026-07-01')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(6)
    expect(d!.getDate()).toBe(1)
    // 关键：零点就是零点，旧写法会得到"本地 08:00"（UTC 零点）
    expect(d!.getHours()).toBe(0)
    expect(d!.getMinutes()).toBe(0)
  })

  it('带时间的 ISO 串按它真实落在的本地日历日取零点', () => {
    const iso = '2026-07-01T10:00:00.000Z'
    const expected = new Date(iso)
    const d = parseLocalDate(iso)
    expect(d).not.toBeNull()
    // 与原生解析的本地日期一致（不写死具体是 7/1 还是 7/2，随时区自适应）
    expect(d!.getFullYear()).toBe(expected.getFullYear())
    expect(d!.getMonth()).toBe(expected.getMonth())
    expect(d!.getDate()).toBe(expected.getDate())
    expect(d!.getHours()).toBe(0)
  })

  it('Date 对象按本地日历日归一化到零点，时刻部分被丢弃', () => {
    const d = parseLocalDate(new Date(2026, 8, 11, 23, 59, 59))
    expect(d!.getDate()).toBe(11)
    expect(d!.getHours()).toBe(0)
  })

  it('不存在的日期被挡掉（2026-02-31 会被 Date 进位成 3 月 3 日）', () => {
    expect(parseLocalDate('2026-02-31')).toBeNull()
    expect(parseLocalDate('2026-13-01')).toBeNull()
  })

  it('非补零写法走同一套校验，不会被静默进位成别的日期', () => {
    // '2026-2-31' 若落到原生 new Date() 上会变成 2026-03-03（V8 静默进位），必须挡掉
    expect(parseLocalDate('2026-2-31')).toBeNull()
    // 合法的不补零日期仍要能解析（后端历史上出现过非补零输出）
    const d = parseLocalDate('2026-2-1')
    expect(d).not.toBeNull()
    expect(d!.getMonth()).toBe(1)
    expect(d!.getDate()).toBe(1)
  })

  it('带时间部分的非法日期同样挡掉（2026-02-31T00:00:00.000Z 会被进位成 3 月 3 日）', () => {
    expect(parseLocalDate('2026-02-31T00:00:00.000Z')).toBeNull()
    // 合法的带时间串照常解析（建档时间就是这种格式）
    expect(parseLocalDate('2026-07-01T10:00:00.000Z')).not.toBeNull()
  })

  it('兼容空格分隔的 YYYY-MM-DD HH:mm:ss（iOS/JSCore 原生解析不了这种格式）', () => {
    const d = parseLocalDate('2026-07-01 10:30:00')
    expect(d).not.toBeNull()
    expect(d!.getDate()).toBe(1)
    // 归一化到本地零点，时刻部分被丢弃
    expect(d!.getHours()).toBe(0)
  })

  it('空值与非法值一律返回 null', () => {
    expect(parseLocalDate(null)).toBeNull()
    expect(parseLocalDate(undefined)).toBeNull()
    expect(parseLocalDate('')).toBeNull()
    expect(parseLocalDate('不是日期')).toBeNull()
  })
})

describe('daysSinceLocalDate', () => {
  it('本地凌晨（00:30）算出的天数与白天一致——旧算法此时会少 1 天', () => {
    // 旧算法：new Date('2026-09-01') 是 UTC 零点（东八区 09-01 08:00），
    // 与本地 09-11 00:30 相差 9 天 16.5 小时 → floor = 9（少一天）
    expect(daysSinceLocalDate('2026-09-01', new Date(2026, 8, 11, 0, 30))).toBe(10)
    // 白天同一日期必须给出同一个数
    expect(daysSinceLocalDate('2026-09-01', new Date(2026, 8, 11, 23, 30))).toBe(10)
  })

  it('同一天的凌晨与深夜给出同一个天数（时区无关的守护断言）', () => {
    // 旧算法在 UTC+8 / UTC-4 都会被这条打破（凌晨少一天），是最稳的回归护栏
    const early = daysSinceLocalDate('2026-09-01', new Date(2026, 8, 11, 0, 30))
    const late = daysSinceLocalDate('2026-09-01', new Date(2026, 8, 11, 23, 30))
    expect(early).toBe(late)
    expect(early).toBe(10)
  })

  it('今天出生为 0 天、昨天为 1 天', () => {
    expect(daysSinceLocalDate('2026-09-11', new Date(2026, 8, 11, 15, 0))).toBe(0)
    expect(daysSinceLocalDate('2026-09-10', new Date(2026, 8, 11, 15, 0))).toBe(1)
  })

  it('跨月与跨年按日历天计算', () => {
    expect(daysSinceLocalDate('2026-08-31', new Date(2026, 8, 1, 9, 0))).toBe(1)
    expect(daysSinceLocalDate('2025-12-31', new Date(2026, 0, 1, 9, 0))).toBe(1)
    expect(daysSinceLocalDate('2025-09-11', new Date(2026, 8, 11, 9, 0))).toBe(365)
  })

  it('闰年 2 月 29 日存在，算出来是 2 天而不是 1 天', () => {
    expect(daysSinceLocalDate('2024-02-28', new Date(2024, 2, 1, 9, 0))).toBe(2)
  })

  it('未来日期与非法输入返回 null（调用方据此隐藏字段，而不是显示 0）', () => {
    expect(daysSinceLocalDate('2026-09-12', new Date(2026, 8, 11, 9, 0))).toBeNull()
    expect(daysSinceLocalDate('2026-02-31', new Date(2026, 8, 11, 9, 0))).toBeNull()
    expect(daysSinceLocalDate(null)).toBeNull()
    expect(daysSinceLocalDate('')).toBeNull()
  })

  it('建档时间（带时间的 ISO 串）同样按本地日历天算', () => {
    const createdAt = new Date(2026, 6, 1, 18, 0).toISOString()
    expect(daysSinceLocalDate(createdAt, new Date(2026, 6, 11, 9, 0))).toBe(10)
  })
})

/**
 * 年龄文案（全站统一口径）
 *
 * 2026-09-11：全站原有 11 份各写各的实现，同一只宠物在不同页面会显示不同年龄
 * （生日 2025-09-20 在今天 2026-09-11：6 处显示「1岁」、3 处显示「11个月」、2 处只到「岁」）。
 * 这组用例锁死统一后的规则与边界。
 */
describe('formatPetAge', () => {
  /** 固定"今天"为本地 2026-09-11 15:00，避免用例随真实时钟漂移 */
  const NOW = new Date(2026, 8, 11, 15, 0)

  it('满月不满岁：显示月数', () => {
    expect(formatPetAge('2025-10-11', {}, NOW)).toBe('11个月')
    expect(formatPetAge('2026-01-11', {}, NOW)).toBe('8个月')
  })

  it('生日还没到当月对应日：必须少算一个月（这是各页旧实现的共同错误）', () => {
    // 2025-09-20 → 2026-09-11 还差 9 天满一岁，只能是 11 个月，不能显示「1岁」
    expect(formatPetAge('2025-09-20', {}, NOW)).toBe('11个月')
  })

  it('满 1 岁：显示「X岁」，有剩余月份时补上', () => {
    expect(formatPetAge('2025-09-11', {}, NOW)).toBe('1岁')
    expect(formatPetAge('2025-06-11', {}, NOW)).toBe('1岁3个月')
    expect(formatPetAge('2024-09-11', {}, NOW)).toBe('2岁')
  })

  it('不足 1 个月：显示天数（比「0个月」有信息量）', () => {
    expect(formatPetAge('2026-08-30', {}, NOW)).toBe('12天')
    expect(formatPetAge('2026-09-11', {}, NOW)).toBe('0天')
  })

  it('闰年 2/29 出生：次年 2/28 仍是 11 个月，3/1 才满一岁', () => {
    // 非闰年没有 2/29 —— "生日当天才算满岁"的口径要在这里说清楚
    expect(formatPetAge('2024-02-29', {}, new Date(2025, 1, 28, 12, 0))).toBe('11个月')
    expect(formatPetAge('2024-02-29', {}, new Date(2025, 2, 1, 12, 0))).toBe('1岁')
  })

  it('月末边界：1/31 出生、2/28 查看时不足一个月', () => {
    expect(formatPetAge('2026-01-31', {}, new Date(2026, 1, 28, 12, 0))).toBe('28天')
    // 到 3/1 时已算满一个月（2 月没有 31 号，按"当月没有对应日"处理），显示「1个月」
    expect(formatPetAge('2026-01-31', {}, new Date(2026, 2, 1, 12, 0))).toBe('1个月')
  })

  it('缺失/非法/未来日期一律返回兜底文案，不显示负数年龄', () => {
    expect(formatPetAge('', { fallback: '年龄未知' }, NOW)).toBe('年龄未知')
    expect(formatPetAge(null, { fallback: '年龄未知' }, NOW)).toBe('年龄未知')
    expect(formatPetAge(undefined, { fallback: '年龄未知' }, NOW)).toBe('年龄未知')
    expect(formatPetAge('2026-02-31', { fallback: '年龄未知' }, NOW)).toBe('年龄未知')
    expect(formatPetAge('2027-01-01', { fallback: '年龄未知' }, NOW)).toBe('年龄未知')
    // 默认兜底是空串（页面上就是"不显示年龄"）
    expect(formatPetAge('2026-02-31')).toBe('')
  })
})
