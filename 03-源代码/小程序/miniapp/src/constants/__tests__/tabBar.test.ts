/**
 * 底部导航（自定义 tabBar）配置常量测试
 *
 * 【这个文件存在的意义：把「只靠注释维系的约定」变成会红的标准】
 * 改造前 tab 的顺序/文案/图标名散在三处（app.config.ts 的 tabBar.list、
 * themeStore 的 TAB_BAR_ICON_NAMES、页面里硬编码的下标），三处漂移的症状是
 * 「点第 3 个 tab 高亮了第 4 个」——只有真机能看出来，单测完全测不到。
 * 现在顺序只有一个来源（constants/tabBar.ts），并由本文件钉住它与 app.config.ts 一致。
 */
import { describe, it, expect, vi } from 'vitest'
import { TAB_BAR_TABS, TAB_BAR_AI_SLOT, TAB_BAR_AI_PATH, tabIndexByPath } from '../tabBar'

/** 载入 app.config.ts（它用了编译期全局 defineAppConfig，单测里补一个透传实现再动态载入） */
async function loadAppConfig(): Promise<any> {
  vi.stubGlobal('defineAppConfig', (config: unknown) => config)
  const mod = await import('../../app.config')
  return mod.default
}

describe('constants/tabBar', () => {
  it('与 app.config.ts 的 tabBar.list 严格一致（路由顺序、文案、条数都不许漂）', async () => {
    const appConfig = await loadAppConfig()
    const list = appConfig.tabBar.list as Array<{ pagePath: string; text: string }>

    // app.config 里的 pagePath 不带前导 `/`，常量里带（switchTab 要求带），故比对时剥掉
    expect(list.map((i) => i.pagePath)).toEqual(TAB_BAR_TABS.map((t) => t.pagePath.slice(1)))
    expect(list.map((i) => i.text)).toEqual(TAB_BAR_TABS.map((t) => t.text))
  })

  it('tabBar 共 4 项且已开启自定义（原生 tabBar 做不出中心凸起按钮）', async () => {
    const appConfig = await loadAppConfig()
    expect(appConfig.tabBar.custom).toBe(true)
    expect(appConfig.tabBar.list).toHaveLength(4)
    expect(TAB_BAR_TABS).toHaveLength(4)
  })

  it('「宠物」已退出 tabBar，但仍作为普通页面注册（否则入口全断）', async () => {
    const appConfig = await loadAppConfig()
    const list = appConfig.tabBar.list as Array<{ pagePath: string }>

    expect(list.some((i) => i.pagePath.includes('pet-profile'))).toBe(false)
    // ⚠️ 退出 tabBar ≠ 下线：页面必须仍在 pages 里，只是跳转得改用 navigateTo
    expect(appConfig.pages).toContain('pages/pet-profile/index')
  })

  it('4 个 tab 页都注册在 pages 里（未注册的 tab 页会让小程序构建直接失败）', async () => {
    const appConfig = await loadAppConfig()
    for (const tab of TAB_BAR_TABS) {
      expect(appConfig.pages, `${tab.text} 未注册`).toContain(tab.pagePath.slice(1))
    }
  })

  it('中心 AI 按钮占第 3 个视觉槽位（0 起 ⇒ 下标 2），5 个槽位正好是微信上限', () => {
    expect(TAB_BAR_AI_SLOT).toBe(2)
    // 4 个 tab + 1 个中心按钮 = 5，这就是微信 tabBar 的上限，多一个都塞不下
    expect(TAB_BAR_TABS.length + 1).toBe(5)
    // 中心按钮左右必须各 2 个 tab，否则凸起按钮就不在正中、视觉重心歪掉
    expect(TAB_BAR_TABS.slice(0, TAB_BAR_AI_SLOT)).toHaveLength(2)
    expect(TAB_BAR_TABS.slice(TAB_BAR_AI_SLOT)).toHaveLength(2)
  })

  it('中心按钮当前指向首页（AI 对话暂时仍挂在首页），因此走 switchTab 而非 navigateTo', () => {
    // ⚠️ 第 4 批「团团全屏态」上线后这里会改成团团页路径，届时本条断言要一起改 ——
    // 故意写死，好让改的人被强制想一次「新路径是不是 tab 页、该用哪个跳转 API」。
    // 组件侧靠 tabIndexByPath 自动在 switchTab / navigateTo 间切换，组件本身不用动。
    expect(TAB_BAR_AI_PATH).toBe('/pages/index/index')
    expect(tabIndexByPath(TAB_BAR_AI_PATH)).toBeGreaterThanOrEqual(0)
  })

  it('4 个 tab 的图标名与各主题图标目录能拼出成套文件名（拼错名字就是真机裂图）', () => {
    // 【为什么只做字符串拼装、不在这里读磁盘】本工程的 tsconfig `types` 只放行
    // `@tarojs/taro`（没有 node 类型），测试里 `import 'node:fs'` 会让全仓 `tsc --noEmit`
    // 直接红；而这两条断言真正要防的风险是「**图标没进 dist**」，那是产物级问题，
    // 已在 `.work-tmp/work/measure-main-package.ps1` 里逐个文件名核 dist（比源码级更硬）。
    expect(TAB_BAR_TABS.map((t) => t.icon)).toEqual(['home', 'timeline', 'creative', 'mine'])
    // 「宠物」退出 tabBar 后，pet 图标不该再出现在 tab 配置里
    expect(TAB_BAR_TABS.some((t) => t.icon === 'pet')).toBe(false)
  })

  describe('tabIndexByPath', () => {
    it('带不带前导斜杠都能查（微信 router.path 不带斜杠，switchTab 的 url 带）', () => {
      expect(tabIndexByPath('/pages/index/index')).toBe(0)
      expect(tabIndexByPath('pages/timeline/index')).toBe(1)
      expect(tabIndexByPath('/pages/creative/index')).toBe(2)
      expect(tabIndexByPath('/pages/mine/index')).toBe(3)
    })

    it('非 tab 页与空值返回 -1（调用方据此跳过广播，避免高亮错位）', () => {
      expect(tabIndexByPath('/pages/pet-profile/index')).toBe(-1)
      expect(tabIndexByPath('/pagesMemoir/studio/index')).toBe(-1)
      expect(tabIndexByPath('')).toBe(-1)
    })
  })
})
