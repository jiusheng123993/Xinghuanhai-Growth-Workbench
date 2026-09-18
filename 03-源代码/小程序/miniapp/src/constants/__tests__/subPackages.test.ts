/**
 * 分包 root 名单测试
 *
 * 【这个文件存在的意义：把"漏一个分包"从静默事故变成会红的标准】
 * 背景（真实事故）：2026-09-01「形象定制」页报 `routeDone with a webviewId 9 is not found`，
 * 根因是分包首载慢、用户连点触发框架级路由竞态。当时的修法是给**分包导航**开 8s 长占位窗，
 * 但那份名单是**硬编码**在 `utils/routeGuard.ts` 里的 `pagesPet / pagesUser` 两个前缀 ——
 * 于是 ① `pagesMemoir` 从上线起就一直漏在保护之外；② 2026-09-12 新增 `pagesYuantuan`
 * （团团全屏页，由底部中心圆钮打开、极易被连点）时又会漏一遍。
 * 现在名单收敛到 `constants/subPackages.ts`，并由本文件与 `app.config.ts` 逐项对齐。
 */
import { describe, it, expect, vi } from 'vitest'
import { SUB_PACKAGE_ROOTS, isSubPackageUrl } from '../subPackages'

/** 载入 app.config.ts（编译期全局 defineAppConfig 在单测里需要补一个透传实现） */
async function loadAppConfig(): Promise<any> {
  vi.stubGlobal('defineAppConfig', (config: unknown) => config)
  const mod = await import('../../app.config')
  return mod.default
}

describe('constants/subPackages', () => {
  it('名单与 app.config.ts 的 subPackages[].root 严格一致（新增分包忘了同步会红）', async () => {
    const appConfig = await loadAppConfig()
    const rootsInConfig = (appConfig.subPackages as Array<{ root: string }>).map(s => s.root)
    expect([...SUB_PACKAGE_ROOTS].sort()).toEqual([...rootsInConfig].sort())
  })

  it('四个分包都会被判定为分包目标（含此前漏掉的 pagesMemoir 与新增的 pagesYuantuan）', () => {
    // 用每个分包里真实存在的页面路径，而不是只测前缀本身
    expect(isSubPackageUrl('/pagesPet/avatar-customize/index')).toBe(true)
    expect(isSubPackageUrl('/pagesMemoir/memoir-center/index')).toBe(true)
    expect(isSubPackageUrl('/pagesUser/settings/index')).toBe(true)
    expect(isSubPackageUrl('/pagesYuantuan/agent/index')).toBe(true)
  })

  it('主包页面不会被误判成分包（否则每次进 tab 都要多等 8s 长窗口）', () => {
    expect(isSubPackageUrl('/pages/index/index')).toBe(false)
    expect(isSubPackageUrl('/pages/timeline/index')).toBe(false)
    expect(isSubPackageUrl('/pages/creative/index')).toBe(false)
    expect(isSubPackageUrl('/pages/mine/index')).toBe(false)
  })

  it('边界：空值、不带前导斜杠、前缀像但不同名', () => {
    expect(isSubPackageUrl(undefined)).toBe(false)
    expect(isSubPackageUrl('')).toBe(false)
    // 不带前导斜杠也要认（deep link / 分享 path 可能是这种写法）
    expect(isSubPackageUrl('pagesYuantuan/agent/index')).toBe(true)
    // ⚠️ 必须要求「root + /」才算命中：否则 pagesPetXxx 这种同前缀的别的东西会被误判
    expect(isSubPackageUrl('/pagesPetLegacy/foo/index')).toBe(false)
    expect(isSubPackageUrl('/pagesYuantuanX/foo/index')).toBe(false)
  })
})
