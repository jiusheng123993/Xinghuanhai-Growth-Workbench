/**
 * 插画 URL 季节解析测试（2026-09-12 新增）
 *
 * 为什么必须「逐字符」断言：Illustration 组件的 onError 是整块不渲染（静默少一张图），
 * 文件名拼错既不会报错也不会抛异常，只表现为「图上没有」——线上最难发现的一类事故。
 * 所以这里把「key + 主题 → 文件名」钉死，错一个字符就红。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SEASON,
  ILLUSTRATION_NAMES,
  illustrationUrl,
  isSeasonKey,
  seasonalIllustrationUrl,
  type IllustrationName,
  type SeasonKey,
} from '../illustrations'

/** 静态资源域名：与 src/config.ts 的默认 API_BASE_URL 一致（测试环境不注入 TARO_APP_API_BASE_URL） */
const BASE = 'https://api.xinghuanhai.com'
/** 旧 36 key 插画目录 */
const OLD_DIR = `${BASE}/uploads/illustrations`
/** 四季插画目录（服务器 uploads/illustrations/seasonal/） */
const SEASONAL_DIR = `${OLD_DIR}/seasonal`

/** 四季主题（顺序＝春→夏→秋→冬） */
const SEASONS: SeasonKey[] = ['spring', 'summer', 'autumn', 'winter']

/**
 * 有季节版的 16 个 key → autumn 主题下的文件名。
 * 槽位名与后缀必须与 02-UI设计/插画系统 产出的 15 个槽位一致；
 * 以后改 SEASONAL_SLOT 时这张表要同步改，否则「拼错文件名」的坑会重新出现。
 */
const MAPPED_AUTUMN: Array<[IllustrationName, string]> = [
  ['page-mine', 'mine-autumn-hero.jpg'],
  ['page-pet-profile', 'pet-profile-autumn-hero.jpg'],
  ['page-family', 'family-autumn.jpg'],
  ['page-creative', 'creative-autumn-hero.jpg'],
  ['page-timeline', 'timeline-autumn.jpg'],
  ['header-memoir', 'memoir-autumn.jpg'],
  ['header-avatar-studio', 'avatar-studio-autumn-hero.jpg'],
  ['header-naming', 'naming-autumn-card.jpg'],
  ['grid-checkin', 'checkin-autumn.jpg'],
  ['grid-vaccine', 'reminder-vaccine-autumn.jpg'],
  ['grid-report', 'health-record-autumn-hero.jpg'],
  ['empty-timeline', 'timeline-autumn.jpg'],
  ['empty-pet', 'pet-profile-autumn-hero.jpg'],
  ['empty-vaccine', 'reminder-vaccine-autumn.jpg'],
  ['empty-family', 'family-autumn.jpg'],
  ['empty-achievement', 'achievement-autumn-card.jpg'],
]

describe('illustrationUrl · 四季主题', () => {
  // 用例 1：一个 key × 四个季节，URL 逐字符正确（含目录与文件名后缀）
  it.each(SEASONS)('grid-checkin + %s 主题 → 拼出该季的健康打卡插画', (season) => {
    expect(illustrationUrl('grid-checkin', season)).toBe(`${SEASONAL_DIR}/checkin-${season}.jpg`)
  })

  // 用例 1 补充：把四个季度的完整 URL 逐个写死，避免上面的模板把它变成同义反复的断言
  it('四个季节的完整 URL 逐字符正确', () => {
    expect(illustrationUrl('grid-checkin', 'spring')).toBe(
      'https://api.xinghuanhai.com/uploads/illustrations/seasonal/checkin-spring.jpg',
    )
    expect(illustrationUrl('grid-checkin', 'summer')).toBe(
      'https://api.xinghuanhai.com/uploads/illustrations/seasonal/checkin-summer.jpg',
    )
    expect(illustrationUrl('grid-checkin', 'autumn')).toBe(
      'https://api.xinghuanhai.com/uploads/illustrations/seasonal/checkin-autumn.jpg',
    )
    expect(illustrationUrl('grid-checkin', 'winter')).toBe(
      'https://api.xinghuanhai.com/uploads/illustrations/seasonal/checkin-winter.jpg',
    )
  })

  // 用例 1 补充：16 个映射 key 的槽位名/后缀逐字符核对（-hero / -card / 无后缀三种形态都要覆盖）
  it.each(MAPPED_AUTUMN)('%s（autumn）→ %s', (name, file) => {
    expect(illustrationUrl(name, 'autumn')).toBe(`${SEASONAL_DIR}/${file}`)
  })
})

describe('illustrationUrl · 回退规则', () => {
  // 用例 2：starry（星空银河）没有四季插画 → 回退默认季 autumn
  it('starry 主题回退到默认季 autumn', () => {
    expect(DEFAULT_SEASON).toBe('autumn')
    expect(illustrationUrl('grid-checkin', 'starry')).toBe(
      'https://api.xinghuanhai.com/uploads/illustrations/seasonal/checkin-autumn.jpg',
    )
    // 与显式传 autumn 完全一致，说明回退不是另一套逻辑
    expect(illustrationUrl('grid-checkin', 'starry')).toBe(illustrationUrl('grid-checkin', 'autumn'))
  })

  it('grid（奶油脂纹理）主题同样回退到默认季 autumn', () => {
    expect(illustrationUrl('page-mine', 'grid')).toBe(illustrationUrl('page-mine', 'autumn'))
  })

  it('不传主题时也按默认季 autumn 处理（结果确定，不受当前日期影响）', () => {
    expect(illustrationUrl('page-mine')).toBe(illustrationUrl('page-mine', 'autumn'))
  })

  // 用例 3：没有季节映射的 key 必须原样返回旧 URL（不能返回空串 —— 那会变成裂图）
  it.each([['share-card-warm'], ['moment-birthday'], ['grid-lineage'], ['empty-search']] as Array<
    [IllustrationName]
  >)('%s 没有季节版 → 仍返回旧图 URL', (name) => {
    expect(seasonalIllustrationUrl(name, 'spring')).toBeNull()
    expect(illustrationUrl(name, 'spring')).toBe(`${OLD_DIR}/${name}.jpg`)
  })

  // 兜底：任何 key × 任何主题都必须拿到非空、可用的绝对 URL（宁可用旧图也不要裂图）
  it.each([...SEASONS, 'starry', 'grid'] as Array<SeasonKey | 'starry' | 'grid'>)(
    '%s 主题下所有 key 都能拿到非空绝对 URL（且不会拼进非季节名）',
    (theme) => {
      ILLUSTRATION_NAMES.forEach((name) => {
        const url = illustrationUrl(name, theme)
        expect(url.startsWith(`${BASE}/uploads/illustrations/`)).toBe(true)
        expect(url.endsWith('.jpg')).toBe(true)
        expect(url).not.toContain('undefined')
        // 走季节目录的图必须落在「四季之一」上：
        // 非季节主题（starry / grid）只能回退到默认季 autumn，不许拼成 starry.jpg 这种不存在的文件名
        if (url.includes('/seasonal/')) {
          const seasonInUrl = SEASONS.find((season) => url.includes(`-${season}`))
          expect(seasonInUrl).toBe(isSeasonKey(theme) ? theme : DEFAULT_SEASON)
        }
      })
    },
  )

  it('不传主题时所有 key 也都能拿到非空绝对 URL', () => {
    ILLUSTRATION_NAMES.forEach((name) => {
      expect(illustrationUrl(name)).toBe(illustrationUrl(name, DEFAULT_SEASON))
    })
  })
})

describe('isSeasonKey', () => {
  it('四季主题返回 true', () => {
    SEASONS.forEach((season) => expect(isSeasonKey(season)).toBe(true))
  })

  it('starry / grid / undefined 返回 false（都不是四季主题）', () => {
    expect(isSeasonKey('starry')).toBe(false)
    expect(isSeasonKey('grid')).toBe(false)
    expect(isSeasonKey(undefined)).toBe(false)
  })
})
